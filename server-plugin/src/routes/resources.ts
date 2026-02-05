/**
 * Express route handlers for /resources endpoints.
 */

import type { McpManager } from '../mcp-manager.js';

interface Req { body: Record<string, unknown> }
interface Res { json(data: unknown): void; status(code: number): Res }

export interface ResourceRouteHandlers {
  list(req: Req, res: Res): Promise<void>;
  read(req: Req, res: Res): Promise<void>;
}

export function createResourceRoutes(manager: McpManager): ResourceRouteHandlers {
  return {
    async list(_req, res) {
      const resources = manager.getAllResources();
      res.json({ resources });
    },

    async read(req, res) {
      const { serverId, uri } = req.body as {
        serverId?: string;
        uri?: string;
      };

      if (!serverId || !uri) {
        res.status(400).json({ error: 'serverId and uri are required' });
        return;
      }

      try {
        const contents = await manager.readResource(serverId, uri);
        res.json({ contents });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    },
  };
}
