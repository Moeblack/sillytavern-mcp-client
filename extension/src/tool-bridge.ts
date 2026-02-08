/**
 * ToolCatalog — fetches MCP tool definitions from server-plugin and converts
 * them into OpenAI-compatible `tools[]` definitions.
 *
 * This replaces the old ToolBridge behavior of registering tools into
 * SillyTavern's ToolManager.
 */

import type { McpToolDefinition } from './types.js';

export type Fetcher = (url: string, opts?: RequestInit) => Promise<Response>;

export type OpenAiToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

export type CatalogTool = McpToolDefinition & { serverId: string };

const NAME_PREFIX = 'mcp__';
const NAME_SEP = '__';

export class ToolCatalog {
  private _fetcher: Fetcher;
  private _tools: CatalogTool[] = [];

  constructor(fetcher: Fetcher) {
    this._fetcher = fetcher;
  }

  setFetcher(fetcher: Fetcher): void {
    this._fetcher = fetcher;
  }

  async syncTools(): Promise<CatalogTool[]> {
    const resp = await this._fetcher('/api/plugins/mcp-client/tools/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    const data = (await resp.json().catch(() => ({} as any))) as {
      tools?: Array<McpToolDefinition & { serverId: string }>;
    };

    this._tools = Array.isArray(data.tools) ? data.tools : [];
    return this.getTools();
  }

  getTools(): CatalogTool[] {
    return this._tools.slice();
  }

  /**
   * Converts cached MCP tools to OpenAI-compatible `tools[]` definitions.
   *
   * Name format:
   *   mcp__{serverId}__{toolName}
   */
  toOpenAiTools(): OpenAiToolDefinition[] {
    return this._tools.map((t) => ({
      type: 'function',
      function: {
        name: ToolCatalog.toQualifiedName(t.serverId, t.name),
        description: t.description ?? t.title ?? `MCP tool: ${t.name}`,
        parameters: (t.inputSchema ?? {}) as Record<string, unknown>,
      },
    }));
  }

  /**
   * Parses a qualified tool name into serverId/toolName.
   */
  static parseQualifiedName(name: string): { serverId: string; toolName: string } | null {
    if (typeof name !== 'string' || !name.startsWith(NAME_PREFIX)) return null;
    const rest = name.slice(NAME_PREFIX.length);
    const sepIdx = rest.indexOf(NAME_SEP);
    if (sepIdx <= 0) return null;
    const serverId = rest.slice(0, sepIdx);
    const toolName = rest.slice(sepIdx + NAME_SEP.length);
    if (!serverId || !toolName) return null;
    return { serverId, toolName };
  }

  static toQualifiedName(serverId: string, toolName: string): string {
    return `${NAME_PREFIX}${serverId}${NAME_SEP}${toolName}`;
  }
}
