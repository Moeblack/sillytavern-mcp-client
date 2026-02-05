/**
 * Express route handlers for /servers endpoints.
 */

import type { McpManager } from '../mcp-manager.js';
import type { McpServerConfig } from '../types.js';

interface Req { body: Record<string, unknown> }
interface Res { json(data: unknown): void; status(code: number): Res }

export interface ServerRouteHandlers {
  list(req: Req, res: Res): Promise<void>;
  add(req: Req, res: Res): Promise<void>;
  remove(req: Req, res: Res): Promise<void>;
  connect(req: Req, res: Res): Promise<void>;
  disconnect(req: Req, res: Res): Promise<void>;
}

export function createServerRoutes(manager: McpManager): ServerRouteHandlers {
  return {
    async list(_req, res) {
      res.json({ servers: manager.getServers() });
    },

    async add(req, res) {
      const config = req.body as unknown as McpServerConfig;
      if (!config.id || !config.name || !config.transport) {
        res.status(400).json({ error: 'id, name, and transport are required' });
        return;
      }
      try {
        manager.addServer(config);
        res.json({ ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: message });
      }
    },

    async remove(req, res) {
      const { id } = req.body as { id?: string };
      if (!id) {
        res.status(400).json({ error: 'id is required' });
        return;
      }
      manager.removeServer(id);
      res.json({ ok: true });
    },

    async connect(req, res) {
      const { id } = req.body as { id?: string };
      if (!id) {
        res.status(400).json({ error: 'id is required' });
        return;
      }
      try {
        await manager.connect(id);
        res.json({ ok: true, state: manager.getServerState(id) });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    },

    async disconnect(req, res) {
      const { id } = req.body as { id?: string };
      if (!id) {
        res.status(400).json({ error: 'id is required' });
        return;
      }
      await manager.disconnect(id);
      res.json({ ok: true });
    },
  };
}
