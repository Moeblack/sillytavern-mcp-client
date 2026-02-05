/**
 * MCP Connection Manager.
 * Manages connections to multiple MCP servers using the official MCP SDK.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
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
// Types
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
  setNotificationHandler?(method: string, handler: (...args: unknown[]) => void): void;
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
  transport?: StdioClientTransport;
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

  /** Inject a mock/custom client factory (for testing or custom transports). */
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
      if (this._clientFactory) {
        // Use injected factory (tests or custom)
        const client = this._clientFactory(entry.config);
        entry.client = client;
        await client.connect(entry.config.transport);
      } else {
        // Use real MCP SDK
        const { client, transport } = this._createRealClient(entry.config);
        entry.client = client as unknown as IMcpClient;
        entry.transport = transport;
        await client.connect(transport);
      }

      entry.capabilities = entry.client.getServerCapabilities() ?? {};
      entry.status = 'connected';

      // Fetch initial lists
      await this._refreshLists(entry);
    } catch (err) {
      entry.status = 'error';
      entry.error = err instanceof Error ? err.message : String(err);
      entry.client = undefined;
      entry.transport = undefined;
    }
  }

  async disconnect(id: string): Promise<void> {
    const entry = this._servers.get(id);
    if (!entry) return;

    if (entry.client) {
      try { await entry.client.close(); } catch { /* best-effort */ }
    }

    entry.status = 'disconnected';
    entry.client = undefined;
    entry.transport = undefined;
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

  // ---- Operations ----

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
      content: result.content as ToolResultContent[],
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
    return result.contents as McpResourceContent[];
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
    return entry.client.getPrompt({ name: promptName, arguments: args }) as any;
  }

  // ---- Real MCP SDK Client creation ----

  private _createRealClient(config: McpServerConfig) {
    const client = new Client(
      { name: 'sillytavern-mcp-client', version: '0.1.0' },
      { capabilities: { roots: { listChanged: true } } },
    );

    let transport: StdioClientTransport;

    if (config.transport.type === 'stdio') {
      transport = new StdioClientTransport({
        command: config.transport.command,
        args: config.transport.args,
        env: config.transport.env,
        cwd: config.transport.cwd,
        stderr: 'pipe',
      });
    } else {
      // TODO: StreamableHTTP transport
      throw new Error(`Transport type '${config.transport.type}' not yet supported. Use 'stdio'.`);
    }

    return { client, transport };
  }

  // ---- Internal ----

  private async _refreshLists(entry: ServerEntry): Promise<void> {
    if (!entry.client) return;

    try {
      const toolsResult = await entry.client.listTools();
      entry.tools = toolsResult.tools as McpToolDefinition[];
    } catch { entry.tools = []; }

    try {
      const resourcesResult = await entry.client.listResources();
      entry.resources = resourcesResult.resources as McpResource[];
    } catch { entry.resources = []; }

    try {
      const promptsResult = await entry.client.listPrompts();
      entry.prompts = promptsResult.prompts as McpPrompt[];
    } catch { entry.prompts = []; }
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
