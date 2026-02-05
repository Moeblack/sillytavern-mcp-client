import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createInitializeRequest,
  parseInitializeResponse,
  createInitializedNotification,
  negotiateVersion,
  SUPPORTED_PROTOCOL_VERSIONS,
  CLIENT_INFO,
  DEFAULT_CLIENT_CAPABILITIES,
} from '../src/lifecycle.js';

describe('Lifecycle', () => {
  describe('createInitializeRequest', () => {
    it('should create a valid JSON-RPC initialize request', () => {
      const req = createInitializeRequest(1);
      expect(req).toEqual({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: SUPPORTED_PROTOCOL_VERSIONS[0],
          capabilities: DEFAULT_CLIENT_CAPABILITIES,
          clientInfo: CLIENT_INFO,
        },
      });
    });

    it('should use the latest supported protocol version', () => {
      const req = createInitializeRequest(1);
      expect(req.params.protocolVersion).toBe('2025-06-18');
    });

    it('should include client info with name and version', () => {
      const req = createInitializeRequest(1);
      expect(req.params.clientInfo.name).toBe('sillytavern-mcp-client');
      expect(req.params.clientInfo.version).toBeDefined();
    });
  });

  describe('parseInitializeResponse', () => {
    it('should parse a valid server response', () => {
      const response = {
        jsonrpc: '2.0' as const,
        id: 1,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: {
            tools: { listChanged: true },
            resources: { subscribe: true, listChanged: true },
            prompts: { listChanged: true },
          },
          serverInfo: {
            name: 'test-server',
            version: '1.0.0',
          },
          instructions: 'Test instructions',
        },
      };

      const parsed = parseInitializeResponse(response);
      expect(parsed.protocolVersion).toBe('2025-06-18');
      expect(parsed.capabilities.tools?.listChanged).toBe(true);
      expect(parsed.serverInfo.name).toBe('test-server');
      expect(parsed.instructions).toBe('Test instructions');
    });

    it('should handle a response with minimal capabilities', () => {
      const response = {
        jsonrpc: '2.0' as const,
        id: 1,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          serverInfo: {
            name: 'minimal-server',
            version: '0.1.0',
          },
        },
      };

      const parsed = parseInitializeResponse(response);
      expect(parsed.capabilities).toEqual({});
      expect(parsed.instructions).toBeUndefined();
    });

    it('should throw on JSON-RPC error response', () => {
      const errorResponse = {
        jsonrpc: '2.0' as const,
        id: 1,
        error: {
          code: -32602,
          message: 'Unsupported protocol version',
        },
      };

      expect(() => parseInitializeResponse(errorResponse)).toThrow(
        'Unsupported protocol version',
      );
    });
  });

  describe('createInitializedNotification', () => {
    it('should create a valid initialized notification', () => {
      const notif = createInitializedNotification();
      expect(notif).toEqual({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      });
    });
  });

  describe('negotiateVersion', () => {
    it('should accept matching version', () => {
      const result = negotiateVersion('2025-06-18');
      expect(result.accepted).toBe(true);
      expect(result.version).toBe('2025-06-18');
    });

    it('should accept older supported version', () => {
      const result = negotiateVersion('2025-03-26');
      expect(result.accepted).toBe(true);
      expect(result.version).toBe('2025-03-26');
    });

    it('should reject unsupported version', () => {
      const result = negotiateVersion('2024-01-01');
      expect(result.accepted).toBe(false);
      expect(result.version).toBeUndefined();
    });

    it('should reject malformed version string', () => {
      const result = negotiateVersion('not-a-version');
      expect(result.accepted).toBe(false);
    });
  });
});
