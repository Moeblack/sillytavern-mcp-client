import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createToolRoutes } from '../../src/routes/tools.js';
import type { McpManager } from '../../src/mcp-manager.js';

/** Minimal mock of Express req/res. */
function mockReqRes(body: Record<string, unknown> = {}) {
  const req = { body } as any;
  const res = {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  } as any;
  return { req, res };
}

function createMockManager(overrides: Partial<McpManager> = {}): McpManager {
  return {
    getAllTools: vi.fn(() => []),
    callTool: vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
      isError: false,
    })),
    ...overrides,
  } as any;
}

describe('Routes: /tools', () => {
  describe('POST /list', () => {
    it('should return all tools from manager', async () => {
      const manager = createMockManager({
        getAllTools: vi.fn(() => [
          { name: 'tool_a', inputSchema: {}, serverId: 's1' },
          { name: 'tool_b', inputSchema: {}, serverId: 's2' },
        ]),
      });
      const routes = createToolRoutes(manager);
      const { req, res } = mockReqRes();

      await routes.list(req, res);

      expect(res.json).toHaveBeenCalledWith({
        tools: [
          { name: 'tool_a', inputSchema: {}, serverId: 's1' },
          { name: 'tool_b', inputSchema: {}, serverId: 's2' },
        ],
      });
    });
  });

  describe('POST /call', () => {
    it('should call tool and return full multimodal result', async () => {
      const manager = createMockManager({
        callTool: vi.fn(async () => ({
          content: [
            { type: 'text' as const, text: 'Generated!' },
            { type: 'image' as const, data: 'base64data', mimeType: 'image/png' },
          ],
          isError: false,
        })),
      });
      const routes = createToolRoutes(manager);
      const { req, res } = mockReqRes({
        serverId: 'srv-1',
        toolName: 'gen_image',
        arguments: { prompt: 'cat' },
      });

      await routes.call(req, res);

      expect(manager.callTool).toHaveBeenCalledWith('srv-1', 'gen_image', { prompt: 'cat' });
      expect(res.json).toHaveBeenCalledWith({
        content: [
          { type: 'text', text: 'Generated!' },
          { type: 'image', data: 'base64data', mimeType: 'image/png' },
        ],
        isError: false,
      });
    });

    it('should return 400 for missing serverId', async () => {
      const manager = createMockManager();
      const routes = createToolRoutes(manager);
      const { req, res } = mockReqRes({ toolName: 'x' });

      await routes.call(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 500 on manager error', async () => {
      const manager = createMockManager({
        callTool: vi.fn(async () => { throw new Error('boom'); }),
      });
      const routes = createToolRoutes(manager);
      const { req, res } = mockReqRes({
        serverId: 's', toolName: 't', arguments: {},
      });

      await routes.call(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
