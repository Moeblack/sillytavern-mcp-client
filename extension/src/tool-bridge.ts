/**
 * Tool Bridge — bridges MCP tools to SillyTavern's ToolManager.
 *
 * Responsibilities:
 * - Fetches tool list from backend plugin
 * - Registers/unregisters tools with ST ToolManager
 * - On tool invocation, calls backend and processes multimodal results
 * - Stores pending images for prompt injection by the multimodal handler
 */

import type {
  McpToolDefinition,
  ToolCallResponse,
  ToolResultContent,
  ImageContent,
  AudioContent,
  PendingImage,
} from './types.js';

// ============================================================
// Minimal ToolManager interface (what ST exposes)
// ============================================================

export interface IToolManager {
  registerFunctionTool(opts: {
    name: string;
    displayName?: string;
    description: string;
    parameters: Record<string, unknown>;
    action: (args: Record<string, unknown>) => Promise<string>;
  }): void;
  unregisterFunctionTool(name: string): void;
}

export type Fetcher = (url: string, opts?: RequestInit) => Promise<Response>;

export type UiImageHandler = (payload: {
  serverId: string;
  toolName: string;
  data: string;
  mimeType: string;
}) => void | Promise<void>;

// ============================================================
// ToolBridge
// ============================================================

export class ToolBridge {
  private _toolManager: IToolManager;
  private _fetcher: Fetcher;
  private _registeredNames = new Set<string>();
  private _pendingImages: PendingImage[] = [];
  private _onUiImage?: UiImageHandler;
  /** Maps registered ST tool name → { serverId, toolName } for call routing. */
  private _toolMap = new Map<string, { serverId: string; toolName: string }>();

  constructor(toolManager: IToolManager, fetcher: Fetcher, opts?: { onUiImage?: UiImageHandler }) {
    this._toolManager = toolManager;
    this._fetcher = fetcher;
    this._onUiImage = opts?.onUiImage;
  }

  /** Testing helper to swap fetcher. */
  _setFetcher(fetcher: Fetcher): void {
    this._fetcher = fetcher;
  }

  // ---- Tool sync ----

  /**
   * Fetches the current tool list from the backend and syncs with ToolManager.
   * New tools are registered, removed tools are unregistered.
   */
  async syncTools(): Promise<void> {
    const resp = await this._fetcher('/api/plugins/mcp-client/tools/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const data = await resp.json() as { tools: Array<McpToolDefinition & { serverId: string }> };
    const currentTools = data.tools ?? [];

    const newNames = new Set<string>();
    const newToolMap = new Map<string, { serverId: string; toolName: string }>();

    for (const tool of currentTools) {
      const stName = this._toStName(tool.serverId, tool.name);
      newNames.add(stName);
      newToolMap.set(stName, { serverId: tool.serverId, toolName: tool.name });

      if (!this._registeredNames.has(stName)) {
        this._registerTool(stName, tool);
      }
    }

    // Unregister tools that are no longer present
    for (const oldName of this._registeredNames) {
      if (!newNames.has(oldName)) {
        this._toolManager.unregisterFunctionTool(oldName);
      }
    }

    this._registeredNames = newNames;
    this._toolMap = newToolMap;
  }

  // ---- Pending images ----

  getPendingImages(): PendingImage[] {
    return [...this._pendingImages];
  }

  clearPendingImages(): void {
    this._pendingImages = [];
  }

  // ---- Internal ----

  /** Naming convention: mcp__serverId__toolName */
  private _toStName(serverId: string, toolName: string): string {
    return `mcp__${serverId}__${toolName}`;
  }

  private _registerTool(
    stName: string,
    tool: McpToolDefinition & { serverId: string },
  ): void {
    const serverId = tool.serverId;
    const toolName = tool.name;

    this._toolManager.registerFunctionTool({
      name: stName,
      displayName: tool.title ?? tool.name,
      description: tool.description ?? `MCP tool: ${tool.name}`,
      parameters: tool.inputSchema,
      action: async (args: Record<string, unknown>): Promise<string> => {
        return this._invokeToolAction(serverId, toolName, args);
      },
    });
  }

  /**
   * Called when ST invokes the tool. Calls backend, processes multimodal result.
   * Returns a string for ST's ToolManager (text + image placeholders).
   * Stores image data in pendingImages for later prompt injection.
   */
  private async _invokeToolAction(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const resp = await this._fetcher('/api/plugins/mcp-client/tools/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId, toolName, arguments: args }),
    });
    const result = await resp.json() as ToolCallResponse;

    return this._processToolResult({ serverId, toolName }, result.content ?? []);
  }

  /**
   * Processes MCP tool result content array.
   * - Text: collected as-is
   * - Image/Audio: replaced with placeholder, data stored for injection
   */
  private _processToolResult(
    ctx: { serverId: string; toolName: string },
    content: ToolResultContent[],
  ): string {
    const textParts: string[] = [];

    for (const item of content) {
      switch (item.type) {
        case 'text':
          textParts.push(item.text);
          break;
        case 'image': {
          const img = item as ImageContent;
          this._pendingImages.push({
            toolCallId: '', // Will be set during prompt injection
            data: img.data,
            mimeType: img.mimeType,
          });

          // UI render is best-effort and should not block tool execution.
          // Respect MCP audience annotations if present.
          const audience = img.annotations?.audience;
          const shouldShow = !Array.isArray(audience) || audience.length === 0 || audience.includes('user');
          if (shouldShow && this._onUiImage) {
            void Promise.resolve(
              this._onUiImage({
                serverId: ctx.serverId,
                toolName: ctx.toolName,
                data: img.data,
                mimeType: img.mimeType,
              }),
            ).catch((err) => {
              console.warn('[MCP Client] Failed to render image in UI:', err);
            });
          }

          textParts.push(`[Image: ${img.mimeType}, delivered to user]`);
          break;
        }
        case 'audio': {
          const audio = item as AudioContent;
          textParts.push(`[Audio: ${audio.mimeType}, delivered to user]`);
          break;
        }
        case 'resource_link':
          textParts.push(`[Resource: ${item.uri}]`);
          break;
        case 'resource':
          if (item.resource.text) {
            textParts.push(item.resource.text);
          } else {
            textParts.push(`[Embedded resource: ${item.resource.uri}]`);
          }
          break;
      }
    }

    return textParts.join('\n');
  }
}
