/**
 * Extension-specific types.
 * Re-exports shared types and adds frontend-only types.
 */
export type {
  McpToolDefinition,
  ToolCallRequest,
  ToolCallResponse,
  ToolResultContent,
  TextContent,
  ImageContent,
  AudioContent,
  ResourceLink,
  EmbeddedResource,
  ContentAnnotations,
  McpServerState,
  McpResource,
  McpResourceContent,
  McpPrompt,
  McpPromptMessage,
  AiProvider,
  MultimodalStrategy,
  ServerListResponse,
  ToolListResponse,
  ResourceListResponse,
  PromptListResponse,
} from '../../shared/types.js';

/** Cached image data keyed by tool_call_id for prompt injection. */
export interface PendingImage {
  toolCallId: string;
  data: string; // base64
  mimeType: string;
}

/**
 * Tool trace stored on the final assistant message as `extra.mcp_tool_trace`.
 * This is UI-only metadata and should not be sent back to the model.
 */
export interface McpToolTraceEntry {
  toolCallId: string;
  qualifiedName: string;
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown> | unknown;
  isError: boolean;
  resultText: string;
  /** Optional UI image URLs uploaded to ST server. */
  images?: Array<{ url: string; mimeType: string }>;
  durationMs?: number;
}

export interface McpToolTrace {
  version: 1;
  iterations: number;
  tools: McpToolTraceEntry[];
}
