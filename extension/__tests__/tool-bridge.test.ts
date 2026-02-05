import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolBridge } from '../src/tool-bridge.js';
import type { McpToolDefinition, ToolCallResponse } from '../../shared/types.js';

// ============================================================
// Mock SillyTavern ToolManager
// ============================================================

function createMockToolManager() {
  const registered = new Map<string, any>();
  return {
    registerFunctionTool: vi.fn((opts: any) => {
      registered.set(opts.name, opts);
    }),
    unregisterFunctionTool: vi.fn((name: string) => {
      registered.delete(name);
    }),
    _registered: registered,
  };
}

function createMockFetcher(responses: Record<string, any> = {}) {
  return vi.fn(async (url: string, opts?: any) => {
    const body = opts?.body ? JSON.parse(opts.body) : {};
    const key = url;
    const data = typeof responses[key] === 'function'
      ? await responses[key](body)
      : responses[key] ?? { content: [{ type: 'text', text: 'ok' }], isError: false };
    return { ok: true, json: async () => data } as any;
  });
}

describe('ToolBridge', () => {
  let toolManager: ReturnType<typeof createMockToolManager>;
  let fetcher: ReturnType<typeof createMockFetcher>;
  let bridge: ToolBridge;

  beforeEach(() => {
    toolManager = createMockToolManager();
    fetcher = createMockFetcher();
    bridge = new ToolBridge(toolManager as any, fetcher);
  });

  describe('syncTools', () => {
    it('should register MCP tools with ToolManager', async () => {
      const tools: Array<McpToolDefinition & { serverId: string }> = [
        {
          name: 'get_weather',
          description: 'Get weather for a city',
          inputSchema: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          },
          serverId: 'srv-1',
        },
      ];

      fetcher = createMockFetcher({
        '/api/plugins/mcp-client/tools/list': { tools },
      });
      bridge = new ToolBridge(toolManager as any, fetcher);

      await bridge.syncTools();

      expect(toolManager.registerFunctionTool).toHaveBeenCalledOnce();
      const call = toolManager.registerFunctionTool.mock.calls[0][0];
      expect(call.name).toBe('mcp__srv-1__get_weather');
      expect(call.description).toContain('Get weather');
      expect(call.parameters).toEqual(tools[0].inputSchema);
    });

    it('should unregister tools that no longer exist', async () => {
      // First sync: register tool_a
      fetcher = createMockFetcher({
        '/api/plugins/mcp-client/tools/list': {
          tools: [{ name: 'tool_a', inputSchema: {}, serverId: 's1' }],
        },
      });
      bridge = new ToolBridge(toolManager as any, fetcher);
      await bridge.syncTools();
      expect(toolManager.registerFunctionTool).toHaveBeenCalledOnce();

      // Second sync: tool_a gone, tool_b appears
      fetcher = createMockFetcher({
        '/api/plugins/mcp-client/tools/list': {
          tools: [{ name: 'tool_b', inputSchema: {}, serverId: 's1' }],
        },
      });
      bridge._setFetcher(fetcher);
      await bridge.syncTools();

      expect(toolManager.unregisterFunctionTool).toHaveBeenCalledWith('mcp__s1__tool_a');
    });

    it('should use mcp__serverId__toolName naming convention', async () => {
      fetcher = createMockFetcher({
        '/api/plugins/mcp-client/tools/list': {
          tools: [
            { name: 'read_file', inputSchema: {}, serverId: 'filesystem' },
            { name: 'gen_image', inputSchema: {}, serverId: 'anima-tool' },
          ],
        },
      });
      bridge = new ToolBridge(toolManager as any, fetcher);
      await bridge.syncTools();

      const names = toolManager.registerFunctionTool.mock.calls.map((c: any) => c[0].name);
      expect(names).toEqual(['mcp__filesystem__read_file', 'mcp__anima-tool__gen_image']);
    });
  });

  describe('action callback', () => {
    it('should call backend /tools/call and return text content', async () => {
      const toolResult: ToolCallResponse = {
        content: [{ type: 'text', text: 'sunny, 25C' }],
        isError: false,
      };
      fetcher = createMockFetcher({
        '/api/plugins/mcp-client/tools/list': {
          tools: [{ name: 'weather', inputSchema: {}, serverId: 'srv' }],
        },
        '/api/plugins/mcp-client/tools/call': toolResult,
      });
      bridge = new ToolBridge(toolManager as any, fetcher);
      await bridge.syncTools();

      // Get the registered action and call it
      const action = toolManager.registerFunctionTool.mock.calls[0][0].action;
      const result = await action({ city: 'Tokyo' });

      // action should return stringified text for ST ToolManager
      expect(result).toBe('sunny, 25C');
    });

    it('should return JSON for mixed content (text + image placeholder)', async () => {
      const toolResult: ToolCallResponse = {
        content: [
          { type: 'text', text: 'Generated!' },
          { type: 'image', data: 'base64...', mimeType: 'image/png' },
        ],
        isError: false,
      };
      fetcher = createMockFetcher({
        '/api/plugins/mcp-client/tools/list': {
          tools: [{ name: 'gen', inputSchema: {}, serverId: 'srv' }],
        },
        '/api/plugins/mcp-client/tools/call': toolResult,
      });
      bridge = new ToolBridge(toolManager as any, fetcher);
      await bridge.syncTools();

      const action = toolManager.registerFunctionTool.mock.calls[0][0].action;
      const result = await action({});

      // Should contain text + image placeholder
      expect(result).toContain('Generated!');
      expect(result).toContain('[Image: image/png');
    });

    it('should store image data for later prompt injection', async () => {
      const toolResult: ToolCallResponse = {
        content: [
          { type: 'text', text: 'ok' },
          { type: 'image', data: 'IMGDATA', mimeType: 'image/png' },
        ],
      };
      fetcher = createMockFetcher({
        '/api/plugins/mcp-client/tools/list': {
          tools: [{ name: 'img', inputSchema: {}, serverId: 'srv' }],
        },
        '/api/plugins/mcp-client/tools/call': toolResult,
      });
      bridge = new ToolBridge(toolManager as any, fetcher);
      await bridge.syncTools();

      const action = toolManager.registerFunctionTool.mock.calls[0][0].action;
      await action({});

      const pending = bridge.getPendingImages();
      expect(pending).toHaveLength(1);
      expect(pending[0].data).toBe('IMGDATA');
      expect(pending[0].mimeType).toBe('image/png');
    });
  });

  describe('clearPendingImages', () => {
    it('should clear pending images after consumption', async () => {
      const toolResult: ToolCallResponse = {
        content: [{ type: 'image', data: 'X', mimeType: 'image/jpeg' }],
      };
      fetcher = createMockFetcher({
        '/api/plugins/mcp-client/tools/list': {
          tools: [{ name: 't', inputSchema: {}, serverId: 's' }],
        },
        '/api/plugins/mcp-client/tools/call': toolResult,
      });
      bridge = new ToolBridge(toolManager as any, fetcher);
      await bridge.syncTools();

      const action = toolManager.registerFunctionTool.mock.calls[0][0].action;
      await action({});
      expect(bridge.getPendingImages()).toHaveLength(1);

      bridge.clearPendingImages();
      expect(bridge.getPendingImages()).toHaveLength(0);
    });
  });
});
