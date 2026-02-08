/**
 * Formats MCP tool results for:
 * - model consumption (role: 'tool' message content)
 * - UI trace display (uploaded image URLs, etc)
 */

import type { ToolResultContent, ImageContent, AudioContent, ContentAnnotations } from './types.js';

export type UploadMedia = (payload: { base64: string; mimeType: string }) => Promise<string>;

export interface FormattedToolResult {
  /** Text to be used as the `content` of the OpenAI-style `role:'tool'` message. */
  modelText: string;
  /** Additional UI-only info. */
  ui: {
    texts: string[];
    images: Array<{ url: string; mimeType: string }>;
  };
}

function includeByAudience(annotations: ContentAnnotations | undefined, target: 'model' | 'ui'): boolean {
  const aud = annotations?.audience;
  if (!Array.isArray(aud) || aud.length === 0) return true;
  return target === 'model' ? aud.includes('assistant') : aud.includes('user');
}

/**
 * Phase 1 default behavior:
 * - Model: text-only; images/audio become placeholders.
 * - UI: upload images and keep URLs in trace.
 */
export async function formatToolResult(
  content: ToolResultContent[],
  opts: {
    uploadMedia?: UploadMedia;
  } = {},
): Promise<FormattedToolResult> {
  const modelParts: string[] = [];
  const uiTexts: string[] = [];
  const uiImages: Array<{ url: string; mimeType: string }> = [];

  for (const item of content ?? []) {
    switch (item.type) {
      case 'text': {
        if (includeByAudience(item.annotations, 'model')) {
          modelParts.push(String(item.text ?? ''));
        }
        if (includeByAudience(item.annotations, 'ui')) {
          uiTexts.push(String(item.text ?? ''));
        }
        break;
      }

      case 'image': {
        const img = item as ImageContent;

        // Model placeholder (only if assistant audience)
        if (includeByAudience(img.annotations, 'model')) {
          modelParts.push(`[Image: ${img.mimeType}, delivered to user]`);
        }

        // UI upload
        if (includeByAudience(img.annotations, 'ui') && opts.uploadMedia) {
          try {
            const url = await opts.uploadMedia({ base64: img.data, mimeType: img.mimeType });
            uiImages.push({ url, mimeType: img.mimeType });
          } catch {
            // ignore upload errors; still show placeholder text
          }
        }

        if (includeByAudience(img.annotations, 'ui')) {
          uiTexts.push(`[Image: ${img.mimeType}]`);
        }

        break;
      }

      case 'audio': {
        const audio = item as AudioContent;
        if (includeByAudience(audio.annotations, 'model')) {
          modelParts.push(`[Audio: ${audio.mimeType}, delivered to user]`);
        }
        if (includeByAudience(audio.annotations, 'ui')) {
          uiTexts.push(`[Audio: ${audio.mimeType}]`);
        }
        break;
      }

      case 'resource_link': {
        if (includeByAudience(item.annotations, 'model')) {
          modelParts.push(`[Resource: ${String(item.uri ?? '')}]`);
        }
        if (includeByAudience(item.annotations, 'ui')) {
          uiTexts.push(`[Resource: ${String(item.uri ?? '')}]`);
        }
        break;
      }

      case 'resource': {
        const text = (item.resource as any)?.text;
        const uri = (item.resource as any)?.uri;
        if (includeByAudience(item.annotations, 'model')) {
          modelParts.push(text ? String(text) : `[Embedded resource: ${String(uri ?? '')}]`);
        }
        if (includeByAudience(item.annotations, 'ui')) {
          uiTexts.push(text ? String(text) : `[Embedded resource: ${String(uri ?? '')}]`);
        }
        break;
      }

      default: {
        // future-proof
        break;
      }
    }
  }

  return {
    modelText: modelParts.join('\n'),
    ui: {
      texts: uiTexts,
      images: uiImages,
    },
  };
}
