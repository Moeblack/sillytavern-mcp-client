import { describe, it, expect, vi } from 'vitest';
import { formatToolResult } from '../src/mcp-tool-result.js';

// Minimal MCP content fixtures

describe('formatToolResult', () => {
  it('should join text parts for model', async () => {
    const out = await formatToolResult([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ] as any);

    expect(out.modelText).toBe('a\nb');
  });

  it('should upload images for UI and keep placeholder for model', async () => {
    const upload = vi.fn(async () => '/user/images/x.png');

    const out = await formatToolResult([
      { type: 'text', text: 'ok' },
      { type: 'image', data: 'BASE64', mimeType: 'image/png' },
    ] as any, { uploadMedia: upload });

    expect(out.modelText).toContain('ok');
    expect(out.modelText).toContain('[Image: image/png');
    expect(upload).toHaveBeenCalledOnce();
    expect(out.ui.images).toEqual([{ url: '/user/images/x.png', mimeType: 'image/png' }]);
  });

  it('should respect annotations.audience for model/ui', async () => {
    const upload = vi.fn(async () => '/user/images/x.png');

    const out = await formatToolResult([
      {
        type: 'text',
        text: 'ui only',
        annotations: { audience: ['user'] },
      },
      {
        type: 'image',
        data: 'BASE64',
        mimeType: 'image/png',
        annotations: { audience: ['assistant'] },
      },
    ] as any, { uploadMedia: upload });

    // model should NOT include ui-only text
    expect(out.modelText).not.toContain('ui only');

    // ui should include ui-only text
    expect(out.ui.texts.join('\n')).toContain('ui only');

    // assistant-only image should NOT be uploaded for UI
    expect(upload).not.toHaveBeenCalled();
  });
});
