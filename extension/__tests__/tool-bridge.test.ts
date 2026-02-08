import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolCatalog } from '../src/tool-bridge.js';
import type { McpToolDefinition } from '../../shared/types.js';

function createMockFetcher(responses: Record<string, any> = {}) {
  return vi.fn(async (url: string) => {
    const data = responses[url] ?? {};
    return { ok: true, json: async () => data } as any;
  });
}

describe('ToolCatalog', () => {
  let fetcher: ReturnType<typeof createMockFetcher>;
  let catalog: ToolCatalog;

  beforeEach(() => {
    fetcher = createMockFetcher();
    catalog = new ToolCatalog(fetcher);
  });

  it('syncTools should cache tools from backend', async () => {
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
    catalog = new ToolCatalog(fetcher);

    const cached = await catalog.syncTools();
    expect(cached).toHaveLength(1);
    expect(cached[0].serverId).toBe('srv-1');
    expect(cached[0].name).toBe('get_weather');
  });

  it('toOpenAiTools should convert MCP tools to OpenAI tools[] format', async () => {
    fetcher = createMockFetcher({
      '/api/plugins/mcp-client/tools/list': {
        tools: [
          { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' }, serverId: 'fs' },
        ],
      },
    });
    catalog = new ToolCatalog(fetcher);
    await catalog.syncTools();

    const tools = catalog.toOpenAiTools();
    expect(tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'mcp__fs__read_file',
          description: 'Read a file',
          parameters: { type: 'object' },
        },
      },
    ]);
  });

  it('parseQualifiedName should decode mcp__serverId__toolName', () => {
    expect(ToolCatalog.parseQualifiedName('mcp__filesystem__read_file')).toEqual({
      serverId: 'filesystem',
      toolName: 'read_file',
    });

    expect(ToolCatalog.parseQualifiedName('not_mcp')).toBeNull();
  });
});
