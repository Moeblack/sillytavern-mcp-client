import { describe, it, expect, vi } from 'vitest';
import { createResourceRoutes } from '../../src/routes/resources.js';
import type { McpManager } from '../../src/mcp-manager.js';

function mockReqRes(body: Record<string, unknown> = {}) {
  const req = { body } as any;
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;
  return { req, res };
}

describe('Routes: /resources', () => {
  describe('POST /list', () => {
    it('should return all resources', async () => {
      const manager = {
        getAllResources: vi.fn(() => [
          { uri: 'file:///a.txt', name: 'a.txt', serverId: 's1' },
        ]),
      } as any;
      const routes = createResourceRoutes(manager);
      const { req, res } = mockReqRes();

      await routes.list(req, res);

      expect(res.json).toHaveBeenCalledWith({
        resources: [{ uri: 'file:///a.txt', name: 'a.txt', serverId: 's1' }],
      });
    });
  });

  describe('POST /read', () => {
    it('should read resource and return contents', async () => {
      const manager = {
        readResource: vi.fn(async () => [
          { uri: 'file:///a.txt', text: 'hello world', mimeType: 'text/plain' },
        ]),
      } as any;
      const routes = createResourceRoutes(manager);
      const { req, res } = mockReqRes({ serverId: 's1', uri: 'file:///a.txt' });

      await routes.read(req, res);

      expect(res.json).toHaveBeenCalledWith({
        contents: [{ uri: 'file:///a.txt', text: 'hello world', mimeType: 'text/plain' }],
      });
    });

    it('should return 400 for missing uri', async () => {
      const manager = {} as any;
      const routes = createResourceRoutes(manager);
      const { req, res } = mockReqRes({ serverId: 's1' });

      await routes.read(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
