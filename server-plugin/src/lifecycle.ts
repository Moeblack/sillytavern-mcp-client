/**
 * MCP Lifecycle management.
 * Handles initialize / capability negotiation / shutdown per MCP 2025-06-18 spec.
 */

import type { ClientCapabilities, ServerCapabilities } from './types.js';

// ============================================================
// Constants
// ============================================================

/** Protocol versions this client supports (newest first). */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  '2025-06-18',
  '2025-03-26',
] as const;

/** Client info sent during initialization. */
export const CLIENT_INFO = {
  name: 'sillytavern-mcp-client',
  version: '0.1.0',
} as const;

/** Default capabilities declared by this client. */
export const DEFAULT_CLIENT_CAPABILITIES: ClientCapabilities = {
  roots: { listChanged: true },
};

// ============================================================
// Types
// ============================================================

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: Record<string, unknown>;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export interface InitializeParams {
  protocolVersion: string;
  capabilities: ClientCapabilities;
  clientInfo: { name: string; version: string };
}

export interface InitializeResult {
  protocolVersion: string;
  capabilities: ServerCapabilities;
  serverInfo: { name: string; version: string };
  instructions?: string;
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: number;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface JsonRpcSuccessResponse {
  jsonrpc: '2.0';
  id: number;
  result: InitializeResult;
}

type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

export interface VersionNegotiationResult {
  accepted: boolean;
  version?: string;
}

// ============================================================
// Functions
// ============================================================

/**
 * Creates a JSON-RPC `initialize` request.
 * Per MCP spec: client MUST initiate initialization with its protocol version,
 * capabilities, and implementation info.
 */
export function createInitializeRequest(id: number): JsonRpcRequest & { params: InitializeParams } {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: SUPPORTED_PROTOCOL_VERSIONS[0],
      capabilities: DEFAULT_CLIENT_CAPABILITIES,
      clientInfo: { ...CLIENT_INFO },
    },
  };
}

/**
 * Parses the server's response to an `initialize` request.
 * Extracts capabilities, server info, and optional instructions.
 * Throws on JSON-RPC error responses.
 */
export function parseInitializeResponse(response: JsonRpcResponse): InitializeResult {
  if ('error' in response && response.error) {
    throw new Error(response.error.message);
  }

  const success = response as JsonRpcSuccessResponse;
  return success.result;
}

/**
 * Creates the `notifications/initialized` notification.
 * Per MCP spec: client MUST send this after successful initialization
 * to indicate it is ready to begin normal operations.
 */
export function createInitializedNotification(): JsonRpcNotification {
  return {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  };
}

/**
 * Checks if a server-returned protocol version is supported by this client.
 * Per MCP spec: if the server responds with a different version than requested,
 * the client should check if it supports that version.
 */
export function negotiateVersion(serverVersion: string): VersionNegotiationResult {
  const isSupported = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(serverVersion);
  return {
    accepted: isSupported,
    version: isSupported ? serverVersion : undefined,
  };
}
