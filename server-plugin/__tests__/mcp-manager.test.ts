import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpManager } from '../src/mcp-manager.js';
import type {
  McpServerConfig,
  McpToolDefinition,
  McpResource,
  McpPrompt,
  McpToolResult,
} from '../../shared/types.js';

// ============================================================
// Mock MCP SDK Client
// ============================================================

function createMockSdkClient(opts?: {
  tools?: McpToolDefinition[];
  resources?: McpResource[];
  prompts?: McpPrompt[];
}) {
  const tools = opts?.tools ?? [];
  const resources = opts?.resources ?? [];
  const prompts = opts?.prompts ?? [];

  return {
    connect: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    getServerCapabilities: vi.fn(() => ({
      tools: { listChanged: true },
      resources: { listChanged: true },
      prompts: { listChanged: true },
    })),
    listTools: vi.fn(async () => ({ tools })),
    listResources: vi.fn(async () => ({ resources })),
    listPrompts: vi.fn(async () => ({ prompts })),
    callTool: vi.fn(async (_params: { name: string; arguments?: Record<string, unknown> }) => ({
      content: [{ type: 'text' as const, text: 'mock result' }],
      isError: false,
    } satisfies McpToolResult) as any),
    readResource: vi.fn(async (_params: { uri: string }) => ({
      contents: [{ uri: 'test://file', text: 'content' }],
    })),
    getPrompt: vi.fn(async (_params: { name: string; arguments?: Record<string, string> }) => ({
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'hello' } }],
    })),
    setNotificationHandler: vi.fn(),
  };
}

describe('McpManager', () => {
  let manager: McpManager;

  beforeEach(() => {
    manager = new McpManager();
  });

  describe('server management', () => {
    it('should start with no servers', () => {
      expect(manager.getServers()).toEqual([]);
    });

    it('should add a server config', () => {
      const config: McpServerConfig = {
        id: 'test-1',
        name: 'Test Server',
        transport: { type: 'stdio', command: 'node', args: ['server.js'] },
        enabled: true,
      };

      manager.addServer(config);
      const servers = manager.getServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].config).toEqual(config);
      expect(servers[0].status).toBe('disconnected');
    });

    it('should remove a server', () => {
      const config: McpServerConfig = {
        id: 'test-1',
        name: 'Test',
        transport: { type: 'stdio', command: 'echo' },
      };
      manager.addServer(config);
      manager.removeServer('test-1');
      expect(manager.getServers()).toHaveLength(0);
    });

    it('should reject duplicate server IDs', () => {
      const config: McpServerConfig = {
        id: 'dup',
        name: 'Dup',
        transport: { type: 'stdio', command: 'echo' },
      };
      manager.addServer(config);
      expect(() => manager.addServer(config)).toThrow('already exists');
    });
  });

  describe('connect / disconnect', () => {
    it('should connect to a server using a mock client', async () => {
      const config: McpServerConfig = {
        id: 'srv-1',
        name: 'Mock',
        transport: { type: 'stdio', command: 'node' },
      };
      manager.addServer(config);

      const mockClient = createMockSdkClient({
        tools: [{ name: 'get_weather', inputSchema: { type: 'object' } }],
      });
      // Inject mock client factory
      manager._setClientFactory(() => mockClient as any);

      await manager.connect('srv-1');

      const state = manager.getServerState('srv-1');
      expect(state?.status).toBe('connected');
      expect(state?.tools).toHaveLength(1);
      expect(state?.tools?.[0].name).toBe('get_weather');
      expect(mockClient.connect).toHaveBeenCalledOnce();
      expect(mockClient.listTools).toHaveBeenCalledOnce();
    });

    it('should disconnect from a server', async () => {
      const config: McpServerConfig = {
        id: 'srv-2',
        name: 'Mock2',
        transport: { type: 'stdio', command: 'node' },
      };
      manager.addServer(config);

      const mockClient = createMockSdkClient();
      manager._setClientFactory(() => mockClient as any);

      await manager.connect('srv-2');
      await manager.disconnect('srv-2');

      const state = manager.getServerState('srv-2');
      expect(state?.status).toBe('disconnected');
      expect(mockClient.close).toHaveBeenCalledOnce();
    });

    it('should set error state on connection failure', async () => {
      const config: McpServerConfig = {
        id: 'srv-fail',
        name: 'Fail',
        transport: { type: 'stdio', command: 'nonexistent' },
      };
      manager.addServer(config);

      manager._setClientFactory(() => {
        const c = createMockSdkClient();
        c.connect.mockRejectedValueOnce(new Error('spawn failed'));
        return c as any;
      });

      await manager.connect('srv-fail');

      const state = manager.getServerState('srv-fail');
      expect(state?.status).toBe('error');
      expect(state?.error).toContain('spawn failed');
    });
  });

  describe('aggregation', () => {
    it('should aggregate tools across multiple servers', async () => {
      const cfg1: McpServerConfig = {
        id: 's1', name: 'S1',
        transport: { type: 'stdio', command: 'node' },
      };
      const cfg2: McpServerConfig = {
        id: 's2', name: 'S2',
        transport: { type: 'stdio', command: 'node' },
      };
      manager.addServer(cfg1);
      manager.addServer(cfg2);

      const mock1 = createMockSdkClient({
        tools: [{ name: 'tool_a', inputSchema: {} }],
      });
      const mock2 = createMockSdkClient({
        tools: [{ name: 'tool_b', inputSchema: {} }, { name: 'tool_c', inputSchema: {} }],
      });

      let callCount = 0;
      manager._setClientFactory(() => {
        callCount++;
        return (callCount === 1 ? mock1 : mock2) as any;
      });

      await manager.connect('s1');
      await manager.connect('s2');

      const allTools = manager.getAllTools();
      expect(allTools).toHaveLength(3);
      expect(allTools.map(t => t.name)).toEqual(['tool_a', 'tool_b', 'tool_c']);
      expect(allTools[0].serverId).toBe('s1');
      expect(allTools[1].serverId).toBe('s2');
    });

    it('should aggregate resources across servers', async () => {
      const cfg: McpServerConfig = {
        id: 'sr', name: 'SR',
        transport: { type: 'stdio', command: 'node' },
      };
      manager.addServer(cfg);

      const mock = createMockSdkClient({
        resources: [{ uri: 'file:///a.txt', name: 'a.txt' }],
      });
      manager._setClientFactory(() => mock as any);

      await manager.connect('sr');

      const allResources = manager.getAllResources();
      expect(allResources).toHaveLength(1);
      expect(allResources[0].uri).toBe('file:///a.txt');
      expect(allResources[0].serverId).toBe('sr');
    });

    it('should aggregate prompts across servers', async () => {
      const cfg: McpServerConfig = {
        id: 'sp', name: 'SP',
        transport: { type: 'stdio', command: 'node' },
      };
      manager.addServer(cfg);

      const mock = createMockSdkClient({
        prompts: [{ name: 'greet', description: 'Say hello' }],
      });
      manager._setClientFactory(() => mock as any);

      await manager.connect('sp');

      const allPrompts = manager.getAllPrompts();
      expect(allPrompts).toHaveLength(1);
      expect(allPrompts[0].name).toBe('greet');
    });
  });

  describe('tool call', () => {
    it('should call a tool on the correct server and return full result', async () => {
      const cfg: McpServerConfig = {
        id: 'tc', name: 'TC',
        transport: { type: 'stdio', command: 'node' },
      };
      manager.addServer(cfg);

      const mock = createMockSdkClient({
        tools: [{ name: 'gen_image', inputSchema: {} }],
      });
      mock.callTool.mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'Generated!' },
          { type: 'image', data: 'aWJhc2U2NA==', mimeType: 'image/png' },
        ],
        isError: false,
      });
      manager._setClientFactory(() => mock as any);

      await manager.connect('tc');

      const result = await manager.callTool('tc', 'gen_image', { prompt: 'test' });
      expect(result.content).toHaveLength(2);
      expect(result.content[0].type).toBe('text');
      expect(result.content[1].type).toBe('image');
      expect(result.isError).toBe(false);
      expect(mock.callTool).toHaveBeenCalledWith({
        name: 'gen_image',
        arguments: { prompt: 'test' },
      });
    });
  });

  describe('shutdown', () => {
    it('should disconnect all servers on shutdown', async () => {
      const cfg1: McpServerConfig = {
        id: 'sd1', name: 'SD1',
        transport: { type: 'stdio', command: 'node' },
      };
      const cfg2: McpServerConfig = {
        id: 'sd2', name: 'SD2',
        transport: { type: 'stdio', command: 'node' },
      };
      manager.addServer(cfg1);
      manager.addServer(cfg2);

      const mock1 = createMockSdkClient();
      const mock2 = createMockSdkClient();
      let callCount = 0;
      manager._setClientFactory(() => {
        callCount++;
        return (callCount === 1 ? mock1 : mock2) as any;
      });

      await manager.connect('sd1');
      await manager.connect('sd2');

      await manager.shutdownAll();

      expect(manager.getServers().every(s => s.status === 'disconnected')).toBe(true);
      expect(mock1.close).toHaveBeenCalled();
      expect(mock2.close).toHaveBeenCalled();
    });
  });
});
