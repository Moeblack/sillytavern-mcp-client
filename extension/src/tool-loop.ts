/**
 * Tool loop orchestrator.
 *
 * - Builds the base request via st-api-wrapper (dry-run)
 * - Sends requests via SillyTavern backend (so we don't touch API keys)
 * - Parses native tool_calls from responses
 * - Executes MCP tools via mcp-client server-plugin
 * - Feeds tool results back into next iteration
 */

import { ToolCatalog } from './tool-bridge.js';
import { extractAssistantTextFromData, extractToolCallsFromData } from './native-toolcalls.js';
import { formatToolResult, type UploadMedia } from './mcp-tool-result.js';
import type { McpToolTrace, McpToolTraceEntry, ToolCallResponse } from './types.js';

export interface StContextLike {
  mainApi: string;
  getRequestHeaders(): Record<string, string>;
  extractMessageFromData?: (data: any, activeApi?: string | null) => string;
}

export async function runToolLoop(opts: {
  ctx: StContextLike;
  toolCatalog: ToolCatalog;
  maxIterations?: number;
  uploadMedia?: UploadMedia;
}): Promise<{ finalText: string; trace: McpToolTrace; lastRawResponse: any }>{
  const { ctx, toolCatalog } = opts;
  const maxIterations = typeof opts.maxIterations === 'number' && Number.isFinite(opts.maxIterations)
    ? Math.max(1, Math.trunc(opts.maxIterations))
    : 10;

  if (String(ctx.mainApi) !== 'openai') {
    throw new Error(`tool loop currently supports mainApi=openai only (got ${String(ctx.mainApi)})`);
  }

  const ST_API = (window as any).ST_API;
  if (!ST_API?.prompt?.buildRequest) {
    throw new Error('st-api-wrapper not available: ST_API.prompt.buildRequest not found');
  }

  // 1) Build initial generateData/messages via dry-run
  const req = await ST_API.prompt.buildRequest({ includeGenerateData: true });
  const generateData = req?.generateData;
  if (!generateData || typeof generateData !== 'object') {
    throw new Error('Failed to build generateData (did you select an OpenAI-like chat completion API?)');
  }

  // Ensure we operate on the same messages array as generateData
  const messages: any[] = Array.isArray(generateData.messages)
    ? generateData.messages
    : (Array.isArray(req?.chatCompletionMessages) ? req.chatCompletionMessages : []);
  generateData.messages = messages;

  // 2) Inject tools (OpenAI format)
  generateData.tools = toolCatalog.toOpenAiTools();
  generateData.tool_choice = 'auto';

  // Phase 1: keep non-streaming for simplicity
  generateData.stream = false;

  const traceEntries: McpToolTraceEntry[] = [];
  let lastRaw: any = null;

  for (let iter = 0; iter < maxIterations; iter++) {
    // 3) Call ST backend chat-completions endpoint directly.
    //    (Do not use ctx.sendGenerationRequest for openai, because it rebuilds generate_data internally.)
    const resp = await fetch('/api/backends/chat-completions/generate', {
      method: 'POST',
      headers: {
        ...ctx.getRequestHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(generateData),
    });

    const data = await resp.json().catch(() => ({} as any));
    if (!resp.ok) {
      const msg = data?.error?.message || data?.error || `${resp.status} ${resp.statusText}`;
      throw new Error(`Chat completion request failed: ${msg}`);
    }

    lastRaw = data;

    const toolCalls = extractToolCallsFromData(data);
    const assistantText = extractAssistantTextFromData(data, ctx);

    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return {
        finalText: String(assistantText ?? ''),
        trace: {
          version: 1,
          iterations: iter + 1,
          tools: traceEntries,
        },
        lastRawResponse: lastRaw,
      };
    }

    // 4) Add assistant message with tool_calls
    messages.push({
      role: 'assistant',
      content: String(assistantText ?? ''),
      tool_calls: toolCalls,
    });

    // 5) Execute tools sequentially (Phase 1)
    for (const tc of toolCalls) {
      const qualifiedName = String(tc?.function?.name ?? '');
      const id = String(tc?.id ?? '');

      const parsed = ToolCatalog.parseQualifiedName(qualifiedName);
      const rawArgs = tc?.function?.arguments;

      let args: any = {};
      if (rawArgs && typeof rawArgs === 'object') {
        args = rawArgs;
      } else if (typeof rawArgs === 'string' && rawArgs.trim()) {
        try {
          args = JSON.parse(rawArgs);
        } catch {
          args = {};
        }
      }

      const start = Date.now();

      let isError = false;
      let resultText = '';
      let uiImages: Array<{ url: string; mimeType: string }> | undefined;

      if (!parsed) {
        isError = true;
        resultText = `Invalid MCP tool name: ${qualifiedName}`;
      } else {
        const toolResp = await fetch('/api/plugins/mcp-client/tools/call', {
          method: 'POST',
          headers: {
            ...ctx.getRequestHeaders(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            serverId: parsed.serverId,
            toolName: parsed.toolName,
            arguments: args ?? {},
          }),
        });

        const toolData = (await toolResp.json().catch(() => ({} as any))) as ToolCallResponse;

        if (!toolResp.ok) {
          isError = true;
          resultText = String((toolData as any)?.error ?? `${toolResp.status} ${toolResp.statusText}`);
        } else {
          isError = Boolean(toolData?.isError);
          const formatted = await formatToolResult(toolData.content ?? [], {
            uploadMedia: opts.uploadMedia,
          });
          resultText = formatted.modelText;
          uiImages = formatted.ui.images;
        }
      }

      const durationMs = Date.now() - start;

      // 6) Feed back tool result to messages
      messages.push({
        role: 'tool',
        tool_call_id: id,
        content: isError ? `ERROR: ${resultText}` : resultText,
      });

      traceEntries.push({
        toolCallId: id,
        qualifiedName,
        serverId: parsed?.serverId ?? '',
        toolName: parsed?.toolName ?? '',
        arguments: args,
        isError,
        resultText,
        images: uiImages,
        durationMs,
      });
    }

    // Continue loop with updated messages
    generateData.messages = messages;
  }

  // Max iterations reached; return best-effort
  return {
    finalText: extractAssistantTextFromData(lastRaw, ctx),
    trace: {
      version: 1,
      iterations: maxIterations,
      tools: traceEntries,
    },
    lastRawResponse: lastRaw,
  };
}
