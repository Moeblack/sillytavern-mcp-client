import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  processPromptForImages,
  shouldSendImagesToModel,
  formatImageForProvider,
  filterByAudience,
} from '../src/multimodal.js';
import type { PendingImage, AiProvider, ContentAnnotations } from '../../shared/types.js';

describe('Multimodal', () => {
  describe('shouldSendImagesToModel', () => {
    it('should return true when sendImages setting is true', () => {
      expect(shouldSendImagesToModel({ sendImages: true, provider: 'openai' })).toBe(true);
    });

    it('should return false when sendImages setting is false', () => {
      expect(shouldSendImagesToModel({ sendImages: false, provider: 'openai' })).toBe(false);
    });
  });

  describe('formatImageForProvider', () => {
    const image: PendingImage = {
      toolCallId: 'tc-1',
      data: 'iVBORw0KGgo=',
      mimeType: 'image/png',
    };

    it('should format for OpenAI as image_url with data URL', () => {
      const result = formatImageForProvider(image, 'openai');
      expect(result).toEqual({
        type: 'image_url',
        image_url: {
          url: 'data:image/png;base64,iVBORw0KGgo=',
          detail: 'auto',
        },
      });
    });

    it('should format for Claude as image source with base64', () => {
      const result = formatImageForProvider(image, 'claude');
      expect(result).toEqual({
        type: 'image_url',
        image_url: {
          url: 'data:image/png;base64,iVBORw0KGgo=',
          detail: 'auto',
        },
      });
      // Claude conversion happens in ST backend (prompt-converters.js)
      // Frontend just needs to use data URL format — ST handles the rest
    });

    it('should format for Gemini as image_url (ST handles inlineData conversion)', () => {
      const result = formatImageForProvider(image, 'makersuite');
      expect(result).toEqual({
        type: 'image_url',
        image_url: {
          url: 'data:image/png;base64,iVBORw0KGgo=',
          detail: 'auto',
        },
      });
    });

    it('should use text placeholder for unknown providers', () => {
      const result = formatImageForProvider(image, 'custom');
      expect(result).toEqual({
        type: 'text',
        text: '[Image: image/png, delivered to user]',
      });
    });
  });

  describe('processPromptForImages', () => {
    it('should inject images into tool result messages when enabled', () => {
      const pendingImages: PendingImage[] = [
        { toolCallId: '', data: 'IMG1', mimeType: 'image/png' },
      ];

      const chat = [
        { role: 'user', content: 'Generate an image' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'tc-1', function: { name: 'mcp__srv__gen', arguments: '{}' } }] },
        { role: 'tool', content: 'Generated!\n[Image: image/png, delivered to user]', tool_call_id: 'tc-1' },
        { role: 'assistant', content: '' },
      ];

      const modified = processPromptForImages(chat, pendingImages, {
        sendImages: true,
        provider: 'openai',
      });

      // The tool message content should now be an array with text + image
      const toolMsg = modified.find(m => m.role === 'tool');
      expect(Array.isArray(toolMsg!.content)).toBe(true);

      const contentArray = toolMsg!.content as any[];
      expect(contentArray).toHaveLength(2);
      expect(contentArray[0]).toEqual({
        type: 'text',
        text: 'Generated!\n[Image: image/png, delivered to user]',
      });
      expect(contentArray[1].type).toBe('image_url');
      expect(contentArray[1].image_url.url).toContain('data:image/png;base64,IMG1');
    });

    it('should NOT inject images when sendImages is false', () => {
      const pendingImages: PendingImage[] = [
        { toolCallId: '', data: 'IMG1', mimeType: 'image/png' },
      ];

      const chat = [
        { role: 'tool', content: 'ok\n[Image: image/png, delivered to user]', tool_call_id: 'tc-1' },
      ];

      const modified = processPromptForImages(chat, pendingImages, {
        sendImages: false,
        provider: 'openai',
      });

      // Content should remain a string (unmodified)
      const toolMsg = modified.find(m => m.role === 'tool');
      expect(typeof toolMsg!.content).toBe('string');
    });

    it('should not modify non-tool messages', () => {
      const chat = [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ];

      const modified = processPromptForImages(chat, [], {
        sendImages: true,
        provider: 'openai',
      });

      expect(modified[0].content).toBe('hello');
      expect(modified[1].content).toBe('hi');
    });

    it('should consume pending images (match by placeholder presence)', () => {
      const pendingImages: PendingImage[] = [
        { toolCallId: '', data: 'A', mimeType: 'image/jpeg' },
        { toolCallId: '', data: 'B', mimeType: 'image/png' },
      ];

      const chat = [
        { role: 'tool', content: 'Result\n[Image: image/jpeg, delivered to user]\n[Image: image/png, delivered to user]', tool_call_id: 'tc-1' },
      ];

      const modified = processPromptForImages(chat, pendingImages, {
        sendImages: true,
        provider: 'openai',
      });

      const toolMsg = modified.find(m => m.role === 'tool');
      const contentArray = toolMsg!.content as any[];
      // text + 2 images
      expect(contentArray).toHaveLength(3);
      expect(contentArray[1].image_url.url).toContain('A');
      expect(contentArray[2].image_url.url).toContain('B');
    });
  });

  describe('filterByAudience', () => {
    it('should keep content with audience=["assistant"] for model', () => {
      const annotations: ContentAnnotations = { audience: ['assistant'] };
      expect(filterByAudience(annotations, 'model')).toBe(true);
    });

    it('should keep content with audience=["user"] for ui', () => {
      const annotations: ContentAnnotations = { audience: ['user'] };
      expect(filterByAudience(annotations, 'ui')).toBe(true);
    });

    it('should keep content with audience=["user","assistant"] for both', () => {
      const annotations: ContentAnnotations = { audience: ['user', 'assistant'] };
      expect(filterByAudience(annotations, 'model')).toBe(true);
      expect(filterByAudience(annotations, 'ui')).toBe(true);
    });

    it('should filter out content with audience=["user"] from model', () => {
      const annotations: ContentAnnotations = { audience: ['user'] };
      expect(filterByAudience(annotations, 'model')).toBe(false);
    });

    it('should include content with no annotations (default: both)', () => {
      expect(filterByAudience(undefined, 'model')).toBe(true);
      expect(filterByAudience(undefined, 'ui')).toBe(true);
    });
  });
});
