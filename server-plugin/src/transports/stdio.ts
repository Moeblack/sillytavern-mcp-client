/**
 * stdio Transport for MCP.
 *
 * Per MCP 2025-06-18 spec:
 * - The client launches the MCP server as a subprocess.
 * - Messages are newline-delimited JSON-RPC on stdin/stdout.
 * - The server MUST NOT write non-MCP content to stdout.
 */

import { spawn, type ChildProcess } from 'child_process';
import type { StdioTransportConfig } from '../types.js';

export type MessageHandler = (message: unknown) => void;
export type ErrorHandler = (error: Error) => void;
export type CloseHandler = (code: number | null) => void;

export class StdioTransport {
  readonly config: StdioTransportConfig;

  private _process: ChildProcess | null = null;
  private _connected = false;
  private _buffer = '';
  private _messageHandlers: MessageHandler[] = [];
  private _errorHandlers: ErrorHandler[] = [];
  private _closeHandlers: CloseHandler[] = [];

  constructor(config: StdioTransportConfig) {
    this.config = config;
  }

  get isConnected(): boolean {
    return this._connected;
  }

  // ============================================================
  // Connection
  // ============================================================

  /**
   * Spawns the child process and sets up stdio communication.
   */
  async connect(): Promise<void> {
    if (this._connected) {
      throw new Error('Already connected');
    }

    const proc = spawn(this.config.command, this.config.args ?? [], {
      env: { ...process.env, ...this.config.env },
      cwd: this.config.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    this._process = proc;
    this._connected = true;
    this._buffer = '';

    proc.stdout!.on('data', (chunk: Buffer) => {
      this._handleData(chunk);
    });

    proc.stderr!.on('data', (chunk: Buffer) => {
      // Per spec: server MAY write to stderr for logging. We forward as errors.
      const text = chunk.toString('utf-8').trim();
      if (text) {
        for (const handler of this._errorHandlers) {
          handler(new Error(`[stderr] ${text}`));
        }
      }
    });

    proc.on('error', (err: Error) => {
      this._connected = false;
      for (const handler of this._errorHandlers) {
        handler(err);
      }
    });

    proc.on('close', (code: number | null) => {
      this._connected = false;
      for (const handler of this._closeHandlers) {
        handler(code);
      }
    });
  }

  // ============================================================
  // Sending
  // ============================================================

  /**
   * Sends a JSON-RPC message to the server's stdin.
   * Per spec: messages are newline-delimited and MUST NOT contain embedded newlines.
   */
  sendMessage(message: unknown): void {
    if (!this._connected || !this._process) {
      throw new Error('Transport not connected');
    }

    const json = JSON.stringify(message);
    this._process.stdin!.write(json + '\n');
  }

  // ============================================================
  // Receiving
  // ============================================================

  /**
   * Handles raw data from stdout. Buffers partial messages
   * and emits complete newline-delimited JSON-RPC messages.
   * Exposed as `_handleData` for testing.
   */
  _handleData(chunk: Buffer): void {
    this._buffer += chunk.toString('utf-8');
    const lines = this._buffer.split('\n');

    // Last element is either empty (if chunk ended with \n) or a partial line
    this._buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed);
        for (const handler of this._messageHandlers) {
          handler(parsed);
        }
      } catch {
        for (const handler of this._errorHandlers) {
          handler(new Error(`Failed to parse JSON-RPC message: ${trimmed.slice(0, 200)}`));
        }
      }
    }
  }

  // ============================================================
  // Event handlers
  // ============================================================

  onMessage(handler: MessageHandler): void {
    this._messageHandlers.push(handler);
  }

  onError(handler: ErrorHandler): void {
    this._errorHandlers.push(handler);
  }

  onClose(handler: CloseHandler): void {
    this._closeHandlers.push(handler);
  }

  // ============================================================
  // Shutdown
  // ============================================================

  /**
   * Gracefully shuts down the transport.
   * Per MCP spec for stdio:
   * 1. Close stdin to the child process
   * 2. Wait / send SIGTERM
   * 3. Send SIGKILL if needed
   */
  close(): void {
    if (!this._process) return;

    this._connected = false;

    try {
      // Close stdin first (signals the server to exit)
      if (this._process.stdin && !this._process.stdin.destroyed) {
        this._process.stdin.end();
      }
      // Then kill if still alive
      if (!this._process.killed) {
        this._process.kill('SIGTERM');
      }
    } catch {
      // Best-effort cleanup
    }

    this._process = null;
    this._buffer = '';
  }
}
