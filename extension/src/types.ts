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
