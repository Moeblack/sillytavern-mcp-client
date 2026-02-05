/**
 * Server-plugin-specific types.
 * Re-exports shared types and adds backend-only types.
 */
export type {
  McpServerConfig,
  McpServerState,
  McpToolDefinition,
  McpToolResult,
  McpResource,
  McpResourceContent,
  McpPrompt,
  McpPromptMessage,
  ServerCapabilities,
  ClientCapabilities,
  ConnectionStatus,
  TransportConfig,
  StdioTransportConfig,
  StreamableHttpTransportConfig,
  ToolCallRequest,
  ToolCallResponse,
  ToolResultContent,
} from '../../shared/types.js';

/** Persistent configuration file shape. */
export interface McpClientConfig {
  servers: import('../../shared/types.js').McpServerConfig[];
}

/** Plugin info object as required by SillyTavern plugin-loader. */
export interface StPluginInfo {
  id: string;
  name: string;
  description: string;
}
