/**
 * Multimodal handler for MCP tool results.
 *
 * Core responsibility: inject images from MCP tool results into the message
 * array that gets sent to the AI provider, using SillyTavern's
 * CHAT_COMPLETION_PROMPT_READY event hook.
 *
 * Key design decisions:
 * - Images are ALWAYS shown in the UI (via formatMessage / DOM injection)
 * - Images sent to the model are OPTIONAL (controlled by sendImages toggle)
 * - Provider-aware formatting: ST already converts image_url to provider-specific
 *   formats (Claude image source, Gemini inlineData) in prompt-converters.js,
 *   so we just need to use the standard image_url format for known providers.
 * - Unknown/custom providers get text-only placeholders (safe default).
 * - MCP annotations.audience is respected for filtering.
 */

import type {
  PendingImage,
  AiProvider,
  MultimodalStrategy,
  ContentAnnotations,
} from './types.js';

// Providers where ST backend handles image format conversion
const IMAGE_CAPABLE_PROVIDERS = new Set<string>([
  'openai',
  'claude',
  'makersuite', // Gemini
  'openrouter',
]);

/** Placeholder pattern used in tool result text. */
const IMAGE_PLACEHOLDER_RE = /\[Image: [^\]]+, delivered to user\]/g;

// ============================================================
// Public API
// ============================================================

/**
 * Whether image data should be sent to the model based on strategy settings.
 */
export function shouldSendImagesToModel(strategy: MultimodalStrategy): boolean {
  return strategy.sendImages === true;
}

/**
 * Formats a pending image for a specific AI provider.
 *
 * For known providers (OpenAI, Claude, Gemini, OpenRouter):
 *   Returns image_url format with data URL — ST backend will convert to
 *   provider-specific format in prompt-converters.js.
 *
 * For unknown/custom providers:
 *   Returns a text placeholder (safe, avoids size limit issues).
 */
export function formatImageForProvider(
  image: PendingImage,
  provider: AiProvider,
): { type: 'image_url'; image_url: { url: string; detail: string } } | { type: 'text'; text: string } {
  if (IMAGE_CAPABLE_PROVIDERS.has(provider)) {
    return {
      type: 'image_url',
      image_url: {
        url: `data:${image.mimeType};base64,${image.data}`,
        detail: 'auto',
      },
    };
  }

  // Safe fallback for unknown providers
  return {
    type: 'text',
    text: `[Image: ${image.mimeType}, delivered to user]`,
  };
}

/**
 * Processes the chat messages array (from CHAT_COMPLETION_PROMPT_READY)
 * and injects pending images into tool result messages.
 *
 * This is the core function called from the event hook. It mutates
 * (or returns a modified copy of) the chat array.
 *
 * Strategy:
 * 1. Find tool result messages (role === 'tool')
 * 2. Check if they contain image placeholders
 * 3. If sendImages is true AND provider supports it:
 *    Convert content from string to [text, image_url, image_url, ...]
 * 4. If sendImages is false: leave as-is (text placeholder remains)
 */
export function processPromptForImages(
  chat: Array<{ role: string; content: string | unknown[]; tool_call_id?: string; [k: string]: unknown }>,
  pendingImages: PendingImage[],
  strategy: MultimodalStrategy,
): typeof chat {
  if (!shouldSendImagesToModel(strategy) || pendingImages.length === 0) {
    return chat;
  }

  // Create a queue of images to inject (consumed in order)
  const imageQueue = [...pendingImages];

  for (const message of chat) {
    if (message.role !== 'tool' || typeof message.content !== 'string') {
      continue;
    }

    // Count how many image placeholders are in this message
    const placeholders = message.content.match(IMAGE_PLACEHOLDER_RE);
    if (!placeholders || placeholders.length === 0) {
      continue;
    }

    // Build multimodal content array
    const contentArray: unknown[] = [
      { type: 'text', text: message.content },
    ];

    // Inject images (one per placeholder, consuming from queue)
    for (let i = 0; i < placeholders.length && imageQueue.length > 0; i++) {
      const image = imageQueue.shift()!;
      const formatted = formatImageForProvider(image, strategy.provider);
      contentArray.push(formatted);
    }

    // Replace string content with multimodal array
    message.content = contentArray;
  }

  return chat;
}

/**
 * Filters content based on MCP annotations.audience.
 *
 * Per MCP spec:
 * - audience: ["user"] → only for UI display
 * - audience: ["assistant"] → only for model
 * - audience: ["user", "assistant"] → both
 * - no audience → default to both
 *
 * @param target 'model' or 'ui'
 */
export function filterByAudience(
  annotations: ContentAnnotations | undefined,
  target: 'model' | 'ui',
): boolean {
  if (!annotations?.audience || annotations.audience.length === 0) {
    return true; // No audience specified → include everywhere
  }

  if (target === 'model') {
    return annotations.audience.includes('assistant');
  }

  if (target === 'ui') {
    return annotations.audience.includes('user');
  }

  return true;
}
