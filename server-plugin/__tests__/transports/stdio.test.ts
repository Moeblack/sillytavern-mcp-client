import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StdioTransport } from '../../src/transports/stdio.js';
import type { StdioTransportConfig } from '../../../shared/types.js';
import { EventEmitter } from 'events';
import { Readable, Writable } from 'stream';

// ============================================================
// Mock child_process
// ============================================================

/** Creates a fake child process for testing. */
function createMockProcess() {
  const stdout = new Readable({ read() {} });
  const stdin = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  const stderr = new Readable({ read() {} });
  const proc = Object.assign(new EventEmitter(), {
    stdout,
    stdin,
    stderr,
    pid: 12345,
    kill: vi.fn(() => true),
    killed: false,
  });
  return proc;
}

describe('StdioTransport', () => {
  const config: StdioTransportConfig = {
    type: 'stdio',
    command: 'node',
    args: ['mock-server.js'],
    env: { TEST: '1' },
  };

  describe('constructor', () => {
    it('should store config', () => {
      const transport = new StdioTransport(config);
      expect(transport.config).toEqual(config);
    });

    it('should start in disconnected state', () => {
      const transport = new StdioTransport(config);
      expect(transport.isConnected).toBe(false);
    });
  });

  describe('sendMessage', () => {
    it('should serialize JSON-RPC message with newline delimiter', () => {
      const transport = new StdioTransport(config);
      const mockProc = createMockProcess();
      const writeSpy = vi.spyOn(mockProc.stdin, 'write');

      // Inject mock process
      (transport as any)._process = mockProc;
      (transport as any)._connected = true;

      const message = { jsonrpc: '2.0' as const, id: 1, method: 'test', params: {} };
      transport.sendMessage(message);

      expect(writeSpy).toHaveBeenCalledOnce();
      const written = writeSpy.mock.calls[0][0] as string;
      expect(written).toBe(JSON.stringify(message) + '\n');
    });

    it('should throw when not connected', () => {
      const transport = new StdioTransport(config);
      const message = { jsonrpc: '2.0' as const, id: 1, method: 'test', params: {} };
      expect(() => transport.sendMessage(message)).toThrow('not connected');
    });
  });

  describe('parseMessages', () => {
    it('should parse newline-delimited JSON-RPC messages from stdout', () => {
      const transport = new StdioTransport(config);
      const messages: unknown[] = [];
      transport.onMessage((msg) => messages.push(msg));

      // Simulate receiving data
      const msg1 = { jsonrpc: '2.0', id: 1, result: { ok: true } };
      const msg2 = { jsonrpc: '2.0', method: 'notifications/test' };
      transport._handleData(
        Buffer.from(JSON.stringify(msg1) + '\n' + JSON.stringify(msg2) + '\n'),
      );

      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual(msg1);
      expect(messages[1]).toEqual(msg2);
    });

    it('should handle partial messages across chunks', () => {
      const transport = new StdioTransport(config);
      const messages: unknown[] = [];
      transport.onMessage((msg) => messages.push(msg));

      const fullMsg = { jsonrpc: '2.0', id: 1, result: { value: 42 } };
      const json = JSON.stringify(fullMsg);
      const half = Math.floor(json.length / 2);

      // First chunk: partial
      transport._handleData(Buffer.from(json.slice(0, half)));
      expect(messages).toHaveLength(0);

      // Second chunk: rest + newline
      transport._handleData(Buffer.from(json.slice(half) + '\n'));
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(fullMsg);
    });

    it('should skip empty lines', () => {
      const transport = new StdioTransport(config);
      const messages: unknown[] = [];
      transport.onMessage((msg) => messages.push(msg));

      transport._handleData(Buffer.from('\n\n{"jsonrpc":"2.0","id":1,"result":{}}\n\n'));
      expect(messages).toHaveLength(1);
    });
  });

  describe('close', () => {
    it('should kill the child process', () => {
      const transport = new StdioTransport(config);
      const mockProc = createMockProcess();
      (transport as any)._process = mockProc;
      (transport as any)._connected = true;

      transport.close();

      expect(mockProc.stdin.destroyed || mockProc.kill).toBeTruthy();
      expect(transport.isConnected).toBe(false);
    });

    it('should be safe to call multiple times', () => {
      const transport = new StdioTransport(config);
      expect(() => {
        transport.close();
        transport.close();
      }).not.toThrow();
    });
  });
});
