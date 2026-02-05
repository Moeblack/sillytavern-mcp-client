/**
 * Express route handlers for /config endpoints.
 * Handles reading/writing the persistent mcp-servers.json configuration.
 */

import fs from 'fs/promises';
import path from 'path';
import type { McpServerConfig } from '../types.js';

export interface ConfigRouteHandlers {
  get(req: unknown, res: { json(data: unknown): void; status(code: number): any }): Promise<void>;
  set(req: { body: Record<string, unknown> }, res: { json(data: unknown): void; status(code: number): any }): Promise<void>;
}

export function createConfigRoutes(configPath: string): ConfigRouteHandlers {
  return {
    async get(_req, res) {
      try {
        const raw = await fs.readFile(configPath, 'utf-8');
        const config = JSON.parse(raw);
        res.json(config);
      } catch {
        res.json({ servers: [] });
      }
    },

    async set(req, res) {
      const { servers } = req.body as { servers?: McpServerConfig[] };
      if (!Array.isArray(servers)) {
        res.status(400).json({ error: 'servers array is required' });
        return;
      }
      try {
        await fs.mkdir(path.dirname(configPath), { recursive: true });
        await fs.writeFile(configPath, JSON.stringify({ servers }, null, 2), 'utf-8');
        res.json({ ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    },
  };
}
