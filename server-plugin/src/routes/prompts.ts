/**
 * Express route handlers for /prompts endpoints.
 */

import type { McpManager } from '../mcp-manager.js';

interface Req { body: Record<string, unknown> }
interface Res { json(data: unknown): void; status(code: number): Res }

export interface PromptRouteHandlers {
  list(req: Req, res: Res): Promise<void>;
  get(req: Req, res: Res): Promise<void>;
}

export function createPromptRoutes(manager: McpManager): PromptRouteHandlers {
  return {
    async list(_req, res) {
      const prompts = manager.getAllPrompts();
      res.json({ prompts });
    },

    async get(req, res) {
      const { serverId, promptName, arguments: args } = req.body as {
        serverId?: string;
        promptName?: string;
        arguments?: Record<string, string>;
      };

      if (!serverId || !promptName) {
        res.status(400).json({ error: 'serverId and promptName are required' });
        return;
      }

      try {
        const result = await manager.getPrompt(serverId, promptName, args);
        res.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    },
  };
}
