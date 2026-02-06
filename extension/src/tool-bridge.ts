/**
 * Tool Bridge — bridges MCP tools to SillyTavern's ToolManager.
 *
 * Pure protocol layer:
 * - Fetches tool list from backend plugin
 * - Registers/unregisters tools with ST ToolManager
 * - On tool invocation, calls backend and processes multimodal results
 * - Uploads images to ST server, stores URLs for external consumption
 * - Stores pending base64 images for multimodal prompt injection
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

/**
 * Uploads a multimedia item to the server and returns the persisted URL.
 * Called for each image/audio in tool results.
 */
export type MediaUploadHandler = (payload: {
  serverId: string;
  toolName: string;
  data: string;
  mimeType: string;
}) => Promise<string>;

// ============================================================
// ToolBridge
// ============================================================

export class ToolBridge {
  private _toolManager: IToolManager;
  private _fetcher: Fetcher;
  private _registeredNames = new Set<string>();
  /** Base64 image data pending injection into the AI prompt (multimodal). */
  private _pendingImages: PendingImage[] = [];
  /** Uploaded image URLs pending attachment to the tool invocation message. */
  private _pendingImageUrls: string[] = [];
  private _onMediaUpload?: MediaUploadHandler;
  private _toolMap = new Map<string, { serverId: string; toolName: string }>();

  constructor(toolManager: IToolManager, fetcher: Fetcher, opts?: { onMediaUpload?: MediaUploadHandler }) {
    this._toolManager = toolManager;
    this._fetcher = fetcher;
    this._onMediaUpload = opts?.onMediaUpload;
  }

  _setFetcher(fetcher: Fetcher): void {
    this._fetcher = fetcher;
  }

  // ---- Tool sync ----

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

    for (const oldName of this._registeredNames) {
      if (!newNames.has(oldName)) {
        this._toolManager.unregisterFunctionTool(oldName);
      }
    }

    this._registeredNames = newNames;
    this._toolMap = newToolMap;
  }

  // ---- Pending images (for multimodal prompt injection) ----

  getPendingImages(): PendingImage[] {
    return [...this._pendingImages];
  }

  clearPendingImages(): void {
    this._pendingImages = [];
  }

  // ---- Pending image URLs (for tool invocation message attachment) ----

  getPendingImageUrls(): string[] {
    return [...this._pendingImageUrls];
  }

  clearPendingImageUrls(): void {
    this._pendingImageUrls = [];
  }

  // ---- Internal ----

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
   * - text / resource / resource_link → returned as-is
   * - image → uploaded to server, URL stored, placeholder in text
   * - audio → placeholder in text
   */
  private async _processToolResult(
    ctx: { serverId: string; toolName: string },
    content: ToolResultContent[],
  ): Promise<string> {
    const textParts: string[] = [];

    for (const item of content) {
      switch (item.type) {
        case 'text':
          textParts.push(item.text);
          break;
        case 'image': {
          const img = item as ImageContent;

          // Store base64 for multimodal prompt injection
          this._pendingImages.push({
            toolCallId: '',
            data: img.data,
            mimeType: img.mimeType,
          });

          // Upload and store URL
          const audience = img.annotations?.audience;
          const shouldUpload = !Array.isArray(audience) || audience.length === 0 || audience.includes('user');
          if (shouldUpload && this._onMediaUpload) {
            try {
              const url = await this._onMediaUpload({
                serverId: ctx.serverId,
                toolName: ctx.toolName,
                data: img.data,
                mimeType: img.mimeType,
              });
              this._pendingImageUrls.push(url);
            } catch (err) {
              console.warn('[MCP Client] Failed to upload image:', err);
            }
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
