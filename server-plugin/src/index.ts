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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const info = {
  id: 'mcp-client',
  name: 'MCP Client',
  description: 'Model Context Protocol client for SillyTavern — connect to external MCP servers for tools, resources, and prompts.',
};

const manager = new McpManager();
const configPath = path.join(__dirname, '..', 'mcp-servers.json');

export async function init(router: Router): Promise<void> {
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
