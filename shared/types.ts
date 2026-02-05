/**
 * Shared types for SillyTavern MCP Client.
 * Aligned with MCP 2025-06-18 specification.
 */

// ============================================================
// MCP Content Types (tool results)
// ============================================================

export interface TextContent {
  type: 'text';
  text: string;
  annotations?: ContentAnnotations;
}

export interface ImageContent {
  type: 'image';
  data: string; // base64-encoded
  mimeType: string;
  annotations?: ContentAnnotations;
}

export interface AudioContent {
  type: 'audio';
  data: string; // base64-encoded
  mimeType: string;
  annotations?: ContentAnnotations;
}

export interface ResourceLink {
  type: 'resource_link';
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  annotations?: ContentAnnotations;
}

export interface EmbeddedResource {
  type: 'resource';
  resource: {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string; // base64-encoded
  };
  annotations?: ContentAnnotations;
}

export interface ContentAnnotations {
  audience?: Array<'user' | 'assistant'>;
  priority?: number; // 0.0 to 1.0
  lastModified?: string; // ISO 8601
}

/** All possible content items in a tool result. */
export type ToolResultContent =
  | TextContent
  | ImageContent
  | AudioContent
  | ResourceLink
  | EmbeddedResource;

/** The result of calling an MCP tool. */
export interface McpToolResult {
  content: ToolResultContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

// ============================================================
// MCP Tool / Resource / Prompt definitions
// ============================================================

export interface McpToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface McpResource {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
  annotations?: ContentAnnotations;
}

export interface McpResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string; // base64
}

export interface McpPrompt {
  name: string;
  title?: string;
  description?: string;
  arguments?: McpPromptArgument[];
}

export interface McpPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface McpPromptMessage {
  role: 'user' | 'assistant';
  content: TextContent | ImageContent | EmbeddedResource;
}

// ============================================================
// Server configuration
// ============================================================

export type TransportType = 'stdio' | 'streamable-http';

export interface StdioTransportConfig {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface StreamableHttpTransportConfig {
  type: 'streamable-http';
  url: string;
  headers?: Record<string, string>;
}

export type TransportConfig = StdioTransportConfig | StreamableHttpTransportConfig;

export interface McpServerConfig {
  /** Unique identifier for this server. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Transport configuration. */
  transport: TransportConfig;
  /** Whether to connect automatically on startup. */
  autoConnect?: boolean;
  /** Whether this server is enabled. */
  enabled?: boolean;
}

// ============================================================
// Connection state
// ============================================================

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export interface McpServerState {
  config: McpServerConfig;
  status: ConnectionStatus;
  error?: string;
  capabilities?: ServerCapabilities;
  tools?: McpToolDefinition[];
  resources?: McpResource[];
  prompts?: McpPrompt[];
}

export interface ServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  logging?: Record<string, unknown>;
  completions?: Record<string, unknown>;
}

export interface ClientCapabilities {
  roots?: { listChanged?: boolean };
  sampling?: Record<string, unknown>;
  elicitation?: Record<string, unknown>;
}

// ============================================================
// REST API request/response types (backend ↔ frontend)
// ============================================================

export interface ToolCallRequest {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResponse {
  content: ToolResultContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface ServerListResponse {
  servers: McpServerState[];
}

export interface ToolListResponse {
  tools: Array<McpToolDefinition & { serverId: string }>;
}

export interface ResourceListResponse {
  resources: Array<McpResource & { serverId: string }>;
}

export interface ResourceReadRequest {
  serverId: string;
  uri: string;
}

export interface ResourceReadResponse {
  contents: McpResourceContent[];
}

export interface PromptListResponse {
  prompts: Array<McpPrompt & { serverId: string }>;
}

export interface PromptGetRequest {
  serverId: string;
  promptName: string;
  arguments?: Record<string, string>;
}

export interface PromptGetResponse {
  messages: McpPromptMessage[];
  description?: string;
}

// ============================================================
// Multimodal processing
// ============================================================

export type AiProvider =
  | 'openai'
  | 'claude'
  | 'makersuite' // Gemini
  | 'openrouter'
  | 'custom'
  | string;

export interface MultimodalStrategy {
  /** Whether to send images to the model. */
  sendImages: boolean;
  /** Provider-specific format to use. */
  provider: AiProvider;
}
