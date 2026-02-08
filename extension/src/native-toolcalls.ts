/**
 * Extract tool calls from SillyTavern backend responses.
 *
 * This is a side-effect-free port of SillyTavern's:
 *   ToolManager.#getToolCallsFromData(data)
 *
 * Source reference:
 *   SillyTavern/public/scripts/tool-calling.js
 */

export type OpenAiToolCall = {
  id: string;
  function: {
    name: string;
    // ST uses either object or string; keep as unknown.
    arguments: unknown;
  };
  /** Optional OpenRouter encrypted reasoning signature attached to a tool call. */
  signature?: string | null;
};

/**
 * Best-effort extraction of tool_calls in OpenAI format.
 */
export function extractToolCallsFromData(data: any): OpenAiToolCall[] {
  const getRandomId = () => Math.random().toString(36).substring(2);

  const isClaudeToolCall = (c: any): boolean =>
    Array.isArray(c)
      ? c.filter(Boolean).every(isClaudeToolCall)
      : !!(c?.input && c?.name && c?.id);

  const isGoogleToolCall = (c: any): boolean =>
    Array.isArray(c)
      ? c.filter(Boolean).every(isGoogleToolCall)
      : !!(c?.name && c?.args);

  const convertClaudeToolCall = (c: any): OpenAiToolCall => ({
    id: String(c.id),
    function: { name: String(c.name), arguments: c.input },
  });

  const convertGoogleToolCall = (c: any, signature: string | null = null): OpenAiToolCall => ({
    id: getRandomId(),
    function: { name: String(c.name), arguments: c.args },
    signature,
  });

  // Parsed tool calls from streaming data
  if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
    if (isClaudeToolCall(data[0])) {
      return data[0].filter(Boolean).map(convertClaudeToolCall);
    }

    if (isGoogleToolCall(data[0])) {
      return data[0].filter(Boolean).map((c: any) => convertGoogleToolCall(c, c.thoughtSignature));
    }

    if (typeof data[0]?.[0]?.tool_calls === 'object') {
      const tc = data[0]?.[0]?.tool_calls;
      return Array.isArray(tc) ? tc : [tc];
    }

    return Array.isArray(data[0]) ? data[0] : [];
  }

  // Google AI Studio tool calls
  if (Array.isArray(data?.responseContent?.parts)) {
    return data.responseContent.parts
      .filter((p: any) => p.functionCall)
      .map((p: any) => convertGoogleToolCall(p.functionCall, p.thoughtSignature));
  }

  // Parsed tool calls from non-streaming data
  if (Array.isArray(data?.choices)) {
    // Find a choice with 0-index
    const choice = data.choices.find((c: any) => c?.index === 0) ?? data.choices[0];

    if (choice && typeof choice.message === 'object' && Array.isArray(choice.message.tool_calls)) {
      // Add OpenRouter signatures
      if (Array.isArray(choice.message.reasoning_details)) {
        for (const toolCall of choice.message.tool_calls) {
          const reasoningDetail = choice.message.reasoning_details.find((rd: any) => rd?.id === toolCall?.id);
          if (reasoningDetail && reasoningDetail.type === 'reasoning.encrypted' && reasoningDetail.data) {
            toolCall.signature = reasoningDetail.data;
          }
        }
      }

      return choice.message.tool_calls;
    }
  }

  // Claude tool calls to OpenAI tool calls
  if (Array.isArray(data?.content)) {
    const content = data.content.filter((c: any) => c?.type === 'tool_use').map(convertClaudeToolCall);
    if (Array.isArray(content)) {
      return content;
    }
  }

  // Cohere tool calls
  if (typeof data?.message?.tool_calls === 'object') {
    return Array.isArray(data?.message?.tool_calls) ? data.message.tool_calls : [data.message.tool_calls];
  }

  return [];
}

export function hasToolCalls(data: any): boolean {
  const calls = extractToolCallsFromData(data);
  return Array.isArray(calls) && calls.length > 0;
}

/**
 * Extract assistant text (best-effort).
 *
 * If SillyTavern exposes extractMessageFromData on context, prefer it.
 */
export function extractAssistantTextFromData(data: any, ctx?: { extractMessageFromData?: Function; mainApi?: string }): string {
  try {
    if (ctx?.extractMessageFromData && typeof ctx.extractMessageFromData === 'function') {
      return String(ctx.extractMessageFromData(data, ctx.mainApi) ?? '');
    }
  } catch {
    // ignore
  }

  // Fallback for OpenAI-like
  const text =
    data?.content?.find?.((p: any) => p?.type === 'text')?.text ??
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.text ??
    data?.text ??
    data?.message?.content?.[0]?.text ??
    '';

  if (Array.isArray(text)) {
    return text.map((x: any) => x?.text).filter(Boolean).join('');
  }

  return String(text ?? '');
}
