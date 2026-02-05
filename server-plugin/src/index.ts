/**
 * SillyTavern Server Plugin entry point.
 * Exports: info, init(router), exit()
 */

import type { Router } from 'express';
import { McpManager } from './mcp-manager.js';
import { createToolRoutes } from './routes/tools.js';
import { createResourceRoutes } from './routes/resources.js';
import { createPromptRoutes } from './routes/prompts.js';
import { createServerRoutes } from './routes/servers.js';
import { createConfigRoutes } from './routes/config.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import type { McpClientConfig, McpServerConfig } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const info = {
  id: 'mcp-client',
  name: 'MCP Client',
  description: 'Model Context Protocol client for SillyTavern — connect to external MCP servers for tools, resources, and prompts.',
};

const manager = new McpManager();
const configPath = path.join(__dirname, '..', 'mcp-servers.json');

async function loadServersFromConfig(): Promise<void> {
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const cfg = JSON.parse(raw) as McpClientConfig;
    const servers = Array.isArray(cfg?.servers) ? cfg.servers : [];

    for (const server of servers) {
      const s = server as McpServerConfig;
      if (s?.enabled === false) continue;
      try {
        manager.addServer(s);
      } catch {
        // ignore duplicates
      }
    }

    // Auto-connect enabled servers
    const toConnect = servers
      .filter((s) => (s as McpServerConfig)?.enabled !== false)
      .filter((s) => (s as McpServerConfig)?.autoConnect)
      .map((s) => (s as McpServerConfig).id)
      .filter(Boolean);

    for (const id of toConnect) {
      // best-effort: don't block init if a server fails
      manager.connect(id).catch(() => {});
    }
  } catch {
    // no config yet
  }
}

export async function init(router: Router): Promise<void> {
  // Load persistent server list (best-effort)
  await loadServersFromConfig();

  const toolRoutes = createToolRoutes(manager);
  const resourceRoutes = createResourceRoutes(manager);
  const promptRoutes = createPromptRoutes(manager);
  const serverRoutes = createServerRoutes(manager);
  const configRoutes = createConfigRoutes(configPath);

  // Tools
  router.post('/tools/list', (req, res) => toolRoutes.list(req as any, res as any));
  router.post('/tools/call', (req, res) => toolRoutes.call(req as any, res as any));

  // Resources
  router.post('/resources/list', (req, res) => resourceRoutes.list(req as any, res as any));
  router.post('/resources/read', (req, res) => resourceRoutes.read(req as any, res as any));

  // Prompts
  router.post('/prompts/list', (req, res) => promptRoutes.list(req as any, res as any));
  router.post('/prompts/get', (req, res) => promptRoutes.get(req as any, res as any));

  // Servers
  router.post('/servers/list', (req, res) => serverRoutes.list(req as any, res as any));
  router.post('/servers/add', (req, res) => serverRoutes.add(req as any, res as any));
  router.post('/servers/remove', (req, res) => serverRoutes.remove(req as any, res as any));
  router.post('/servers/connect', (req, res) => serverRoutes.connect(req as any, res as any));
  router.post('/servers/disconnect', (req, res) => serverRoutes.disconnect(req as any, res as any));

  // Config
  router.post('/config/get', (req, res) => configRoutes.get(req as any, res as any));
  router.post('/config/set', (req, res) => configRoutes.set(req as any, res as any));

  console.log('[MCP Client] Plugin initialized. Routes registered at /api/plugins/mcp-client/*');
}

export async function exit(): Promise<void> {
  await manager.shutdownAll();
  console.log('[MCP Client] Plugin shutdown complete.');
}
