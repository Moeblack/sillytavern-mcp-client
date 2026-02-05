/**
 * MCP Connection Manager.
 * Manages connections to multiple MCP servers and aggregates their capabilities.
 */

import type {
  McpServerConfig,
  McpServerState,
  McpToolDefinition,
  McpToolResult,
  McpResource,
  McpResourceContent,
  McpPrompt,
  McpPromptMessage,
  ConnectionStatus,
  ServerCapabilities,
  ToolResultContent,
} from './types.js';

// ============================================================
// Types for the MCP SDK client abstraction
// ============================================================

/** Minimal interface matching the MCP SDK Client methods we use. */
export interface IMcpClient {
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
  getServerCapabilities(): ServerCapabilities | undefined;
  listTools(params?: { cursor?: string }): Promise<{ tools: McpToolDefinition[]; nextCursor?: string }>;
  listResources(params?: { cursor?: string }): Promise<{ resources: McpResource[]; nextCursor?: string }>;
  listPrompts(params?: { cursor?: string }): Promise<{ prompts: McpPrompt[]; nextCursor?: string }>;
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<{
    content: ToolResultContent[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  }>;
  readResource(params: { uri: string }): Promise<{ contents: McpResourceContent[] }>;
  getPrompt(params: { name: string; arguments?: Record<string, string> }): Promise<{
    messages: McpPromptMessage[];
    description?: string;
  }>;
  setNotificationHandler(method: string, handler: (...args: unknown[]) => void): void;
}

export type ClientFactory = (config: McpServerConfig) => IMcpClient;

// ============================================================
// Internal state per server
// ============================================================

interface ServerEntry {
  config: McpServerConfig;
  status: ConnectionStatus;
  error?: string;
  client?: IMcpClient;
  capabilities?: ServerCapabilities;
  tools: McpToolDefinition[];
  resources: McpResource[];
  prompts: McpPrompt[];
}

// ============================================================
// McpManager
// ============================================================

export class McpManager {
  private _servers = new Map<string, ServerEntry>();
  private _clientFactory: ClientFactory | null = null;

  // ---- Testing helper ----

  /** Inject a mock client factory for testing. */
  _setClientFactory(factory: ClientFactory): void {
    this._clientFactory = factory;
  }

  // ---- Server CRUD ----

  addServer(config: McpServerConfig): void {
    if (this._servers.has(config.id)) {
      throw new Error(`Server '${config.id}' already exists`);
    }
    this._servers.set(config.id, {
      config,
      status: 'disconnected',
      tools: [],
      resources: [],
      prompts: [],
    });
  }

  removeServer(id: string): void {
    const entry = this._servers.get(id);
    if (entry?.client && entry.status === 'connected') {
      entry.client.close().catch(() => {});
    }
    this._servers.delete(id);
  }

  getServers(): McpServerState[] {
    return Array.from(this._servers.values()).map(e => this._toState(e));
  }

  getServerState(id: string): McpServerState | undefined {
    const entry = this._servers.get(id);
    return entry ? this._toState(entry) : undefined;
  }

  // ---- Connect / Disconnect ----

  async connect(id: string): Promise<void> {
    const entry = this._servers.get(id);
    if (!entry) throw new Error(`Server '${id}' not found`);

    entry.status = 'connecting';
    entry.error = undefined;

    try {
      const client = this._createClient(entry.config);
      entry.client = client;

      await client.connect(entry.config.transport);

      entry.capabilities = client.getServerCapabilities() ?? {};
      entry.status = 'connected';

      // Fetch initial tool/resource/prompt lists
      await this._refreshLists(entry);
    } catch (err) {
      entry.status = 'error';
      entry.error = err instanceof Error ? err.message : String(err);
      entry.client = undefined;
    }
  }

  async disconnect(id: string): Promise<void> {
    const entry = this._servers.get(id);
    if (!entry) return;

    if (entry.client) {
      try {
        await entry.client.close();
      } catch {
        // Best-effort
      }
    }

    entry.status = 'disconnected';
    entry.client = undefined;
    entry.tools = [];
    entry.resources = [];
    entry.prompts = [];
  }

  async shutdownAll(): Promise<void> {
    const ids = Array.from(this._servers.keys());
    await Promise.allSettled(ids.map(id => this.disconnect(id)));
  }

  // ---- Aggregation ----

  getAllTools(): Array<McpToolDefinition & { serverId: string }> {
    const result: Array<McpToolDefinition & { serverId: string }> = [];
    for (const [id, entry] of this._servers) {
      if (entry.status === 'connected') {
        for (const tool of entry.tools) {
          result.push({ ...tool, serverId: id });
        }
      }
    }
    return result;
  }

  getAllResources(): Array<McpResource & { serverId: string }> {
    const result: Array<McpResource & { serverId: string }> = [];
    for (const [id, entry] of this._servers) {
      if (entry.status === 'connected') {
        for (const res of entry.resources) {
          result.push({ ...res, serverId: id });
        }
      }
    }
    return result;
  }

  getAllPrompts(): Array<McpPrompt & { serverId: string }> {
    const result: Array<McpPrompt & { serverId: string }> = [];
    for (const [id, entry] of this._servers) {
      if (entry.status === 'connected') {
        for (const prompt of entry.prompts) {
          result.push({ ...prompt, serverId: id });
        }
      }
    }
    return result;
  }

  // ---- Tool/Resource/Prompt operations ----

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    const entry = this._servers.get(serverId);
    if (!entry?.client || entry.status !== 'connected') {
      throw new Error(`Server '${serverId}' not connected`);
    }

    const result = await entry.client.callTool({
      name: toolName,
      arguments: args,
    });

    return {
      content: result.content,
      structuredContent: result.structuredContent,
      isError: result.isError,
    };
  }

  async readResource(serverId: string, uri: string): Promise<McpResourceContent[]> {
    const entry = this._servers.get(serverId);
    if (!entry?.client || entry.status !== 'connected') {
      throw new Error(`Server '${serverId}' not connected`);
    }
    const result = await entry.client.readResource({ uri });
    return result.contents;
  }

  async getPrompt(
    serverId: string,
    promptName: string,
    args?: Record<string, string>,
  ): Promise<{ messages: McpPromptMessage[]; description?: string }> {
    const entry = this._servers.get(serverId);
    if (!entry?.client || entry.status !== 'connected') {
      throw new Error(`Server '${serverId}' not connected`);
    }
    return entry.client.getPrompt({ name: promptName, arguments: args });
  }

  // ---- Internal ----

  private _createClient(config: McpServerConfig): IMcpClient {
    if (this._clientFactory) {
      return this._clientFactory(config);
    }
    // Real implementation will use @modelcontextprotocol/sdk Client
    throw new Error('No client factory configured. Set one via _setClientFactory() or use the real SDK.');
  }

  private async _refreshLists(entry: ServerEntry): Promise<void> {
    if (!entry.client) return;

    try {
      const toolsResult = await entry.client.listTools();
      entry.tools = toolsResult.tools;
    } catch {
      entry.tools = [];
    }

    try {
      const resourcesResult = await entry.client.listResources();
      entry.resources = resourcesResult.resources;
    } catch {
      entry.resources = [];
    }

    try {
      const promptsResult = await entry.client.listPrompts();
      entry.prompts = promptsResult.prompts;
    } catch {
      entry.prompts = [];
    }
  }

  private _toState(entry: ServerEntry): McpServerState {
    return {
      config: entry.config,
      status: entry.status,
      error: entry.error,
      capabilities: entry.capabilities,
      tools: entry.tools,
      resources: entry.resources,
      prompts: entry.prompts,
    };
  }
}
