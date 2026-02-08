var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
(function() {
  "use strict";
  const NAME_PREFIX = "mcp__";
  const NAME_SEP = "__";
  class ToolCatalog {
    constructor(fetcher) {
      __publicField(this, "_fetcher");
      __publicField(this, "_tools", []);
      this._fetcher = fetcher;
    }
    setFetcher(fetcher) {
      this._fetcher = fetcher;
    }
    async syncTools() {
      const resp = await this._fetcher("/api/plugins/mcp-client/tools/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const data = await resp.json().catch(() => ({}));
      this._tools = Array.isArray(data.tools) ? data.tools : [];
      return this.getTools();
    }
    getTools() {
      return this._tools.slice();
    }
    /**
     * Converts cached MCP tools to OpenAI-compatible `tools[]` definitions.
     *
     * Name format:
     *   mcp__{serverId}__{toolName}
     */
    toOpenAiTools() {
      return this._tools.map((t) => ({
        type: "function",
        function: {
          name: ToolCatalog.toQualifiedName(t.serverId, t.name),
          description: t.description ?? t.title ?? `MCP tool: ${t.name}`,
          parameters: t.inputSchema ?? {}
        }
      }));
    }
    /**
     * Parses a qualified tool name into serverId/toolName.
     */
    static parseQualifiedName(name) {
      if (typeof name !== "string" || !name.startsWith(NAME_PREFIX)) return null;
      const rest = name.slice(NAME_PREFIX.length);
      const sepIdx = rest.indexOf(NAME_SEP);
      if (sepIdx <= 0) return null;
      const serverId = rest.slice(0, sepIdx);
      const toolName = rest.slice(sepIdx + NAME_SEP.length);
      if (!serverId || !toolName) return null;
      return { serverId, toolName };
    }
    static toQualifiedName(serverId, toolName) {
      return `${NAME_PREFIX}${serverId}${NAME_SEP}${toolName}`;
    }
  }
  function extractToolCallsFromData(data) {
    var _a, _b, _c, _d, _e, _f, _g;
    const getRandomId = () => Math.random().toString(36).substring(2);
    const isClaudeToolCall = (c) => Array.isArray(c) ? c.filter(Boolean).every(isClaudeToolCall) : !!((c == null ? void 0 : c.input) && (c == null ? void 0 : c.name) && (c == null ? void 0 : c.id));
    const isGoogleToolCall = (c) => Array.isArray(c) ? c.filter(Boolean).every(isGoogleToolCall) : !!((c == null ? void 0 : c.name) && (c == null ? void 0 : c.args));
    const convertClaudeToolCall = (c) => ({
      id: String(c.id),
      function: { name: String(c.name), arguments: c.input }
    });
    const convertGoogleToolCall = (c, signature = null) => ({
      id: getRandomId(),
      function: { name: String(c.name), arguments: c.args },
      signature
    });
    if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
      if (isClaudeToolCall(data[0])) {
        return data[0].filter(Boolean).map(convertClaudeToolCall);
      }
      if (isGoogleToolCall(data[0])) {
        return data[0].filter(Boolean).map((c) => convertGoogleToolCall(c, c.thoughtSignature));
      }
      if (typeof ((_b = (_a = data[0]) == null ? void 0 : _a[0]) == null ? void 0 : _b.tool_calls) === "object") {
        const tc = (_d = (_c = data[0]) == null ? void 0 : _c[0]) == null ? void 0 : _d.tool_calls;
        return Array.isArray(tc) ? tc : [tc];
      }
      return Array.isArray(data[0]) ? data[0] : [];
    }
    if (Array.isArray((_e = data == null ? void 0 : data.responseContent) == null ? void 0 : _e.parts)) {
      return data.responseContent.parts.filter((p) => p.functionCall).map((p) => convertGoogleToolCall(p.functionCall, p.thoughtSignature));
    }
    if (Array.isArray(data == null ? void 0 : data.choices)) {
      const choice = data.choices.find((c) => (c == null ? void 0 : c.index) === 0) ?? data.choices[0];
      if (choice && typeof choice.message === "object" && Array.isArray(choice.message.tool_calls)) {
        if (Array.isArray(choice.message.reasoning_details)) {
          for (const toolCall of choice.message.tool_calls) {
            const reasoningDetail = choice.message.reasoning_details.find((rd) => (rd == null ? void 0 : rd.id) === (toolCall == null ? void 0 : toolCall.id));
            if (reasoningDetail && reasoningDetail.type === "reasoning.encrypted" && reasoningDetail.data) {
              toolCall.signature = reasoningDetail.data;
            }
          }
        }
        return choice.message.tool_calls;
      }
    }
    if (Array.isArray(data == null ? void 0 : data.content)) {
      const content = data.content.filter((c) => (c == null ? void 0 : c.type) === "tool_use").map(convertClaudeToolCall);
      if (Array.isArray(content)) {
        return content;
      }
    }
    if (typeof ((_f = data == null ? void 0 : data.message) == null ? void 0 : _f.tool_calls) === "object") {
      return Array.isArray((_g = data == null ? void 0 : data.message) == null ? void 0 : _g.tool_calls) ? data.message.tool_calls : [data.message.tool_calls];
    }
    return [];
  }
  function extractAssistantTextFromData(data, ctx) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
    try {
      if ((ctx == null ? void 0 : ctx.extractMessageFromData) && typeof ctx.extractMessageFromData === "function") {
        return String(ctx.extractMessageFromData(data, ctx.mainApi) ?? "");
      }
    } catch {
    }
    const text = ((_c = (_b = (_a = data == null ? void 0 : data.content) == null ? void 0 : _a.find) == null ? void 0 : _b.call(_a, (p) => (p == null ? void 0 : p.type) === "text")) == null ? void 0 : _c.text) ?? ((_f = (_e = (_d = data == null ? void 0 : data.choices) == null ? void 0 : _d[0]) == null ? void 0 : _e.message) == null ? void 0 : _f.content) ?? ((_h = (_g = data == null ? void 0 : data.choices) == null ? void 0 : _g[0]) == null ? void 0 : _h.text) ?? (data == null ? void 0 : data.text) ?? ((_k = (_j = (_i = data == null ? void 0 : data.message) == null ? void 0 : _i.content) == null ? void 0 : _j[0]) == null ? void 0 : _k.text) ?? "";
    if (Array.isArray(text)) {
      return text.map((x) => x == null ? void 0 : x.text).filter(Boolean).join("");
    }
    return String(text ?? "");
  }
  function includeByAudience(annotations, target) {
    const aud = annotations == null ? void 0 : annotations.audience;
    if (!Array.isArray(aud) || aud.length === 0) return true;
    return target === "model" ? aud.includes("assistant") : aud.includes("user");
  }
  async function formatToolResult(content, opts = {}) {
    var _a, _b;
    const modelParts = [];
    const uiTexts = [];
    const uiImages = [];
    for (const item of content ?? []) {
      switch (item.type) {
        case "text": {
          if (includeByAudience(item.annotations, "model")) {
            modelParts.push(String(item.text ?? ""));
          }
          if (includeByAudience(item.annotations, "ui")) {
            uiTexts.push(String(item.text ?? ""));
          }
          break;
        }
        case "image": {
          const img = item;
          if (includeByAudience(img.annotations, "model")) {
            modelParts.push(`[Image: ${img.mimeType}, delivered to user]`);
          }
          if (includeByAudience(img.annotations, "ui") && opts.uploadMedia) {
            try {
              const url = await opts.uploadMedia({ base64: img.data, mimeType: img.mimeType });
              uiImages.push({ url, mimeType: img.mimeType });
            } catch {
            }
          }
          if (includeByAudience(img.annotations, "ui")) {
            uiTexts.push(`[Image: ${img.mimeType}]`);
          }
          break;
        }
        case "audio": {
          const audio = item;
          if (includeByAudience(audio.annotations, "model")) {
            modelParts.push(`[Audio: ${audio.mimeType}, delivered to user]`);
          }
          if (includeByAudience(audio.annotations, "ui")) {
            uiTexts.push(`[Audio: ${audio.mimeType}]`);
          }
          break;
        }
        case "resource_link": {
          if (includeByAudience(item.annotations, "model")) {
            modelParts.push(`[Resource: ${String(item.uri ?? "")}]`);
          }
          if (includeByAudience(item.annotations, "ui")) {
            uiTexts.push(`[Resource: ${String(item.uri ?? "")}]`);
          }
          break;
        }
        case "resource": {
          const text = (_a = item.resource) == null ? void 0 : _a.text;
          const uri = (_b = item.resource) == null ? void 0 : _b.uri;
          if (includeByAudience(item.annotations, "model")) {
            modelParts.push(text ? String(text) : `[Embedded resource: ${String(uri ?? "")}]`);
          }
          if (includeByAudience(item.annotations, "ui")) {
            uiTexts.push(text ? String(text) : `[Embedded resource: ${String(uri ?? "")}]`);
          }
          break;
        }
      }
    }
    return {
      modelText: modelParts.join("\n"),
      ui: {
        texts: uiTexts,
        images: uiImages
      }
    };
  }
  async function runToolLoop(opts) {
    var _a, _b, _c, _d;
    const { ctx, toolCatalog: toolCatalog2 } = opts;
    const maxIterations = typeof opts.maxIterations === "number" && Number.isFinite(opts.maxIterations) ? Math.max(1, Math.trunc(opts.maxIterations)) : 10;
    if (String(ctx.mainApi) !== "openai") {
      throw new Error(`tool loop currently supports mainApi=openai only (got ${String(ctx.mainApi)})`);
    }
    const ST_API = window.ST_API;
    if (!((_a = ST_API == null ? void 0 : ST_API.prompt) == null ? void 0 : _a.buildRequest)) {
      throw new Error("st-api-wrapper not available: ST_API.prompt.buildRequest not found");
    }
    const req = await ST_API.prompt.buildRequest({ includeGenerateData: true });
    const generateData = req == null ? void 0 : req.generateData;
    if (!generateData || typeof generateData !== "object") {
      throw new Error("Failed to build generateData (did you select an OpenAI-like chat completion API?)");
    }
    const messages = Array.isArray(generateData.messages) ? generateData.messages : Array.isArray(req == null ? void 0 : req.chatCompletionMessages) ? req.chatCompletionMessages : [];
    generateData.messages = messages;
    generateData.tools = toolCatalog2.toOpenAiTools();
    generateData.tool_choice = "auto";
    generateData.stream = false;
    const traceEntries = [];
    let lastRaw = null;
    for (let iter = 0; iter < maxIterations; iter++) {
      const resp = await fetch("/api/backends/chat-completions/generate", {
        method: "POST",
        headers: {
          ...ctx.getRequestHeaders(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(generateData)
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = ((_b = data == null ? void 0 : data.error) == null ? void 0 : _b.message) || (data == null ? void 0 : data.error) || `${resp.status} ${resp.statusText}`;
        throw new Error(`Chat completion request failed: ${msg}`);
      }
      lastRaw = data;
      const toolCalls = extractToolCallsFromData(data);
      const assistantText = extractAssistantTextFromData(data, ctx);
      if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
        return {
          finalText: String(assistantText ?? ""),
          trace: {
            version: 1,
            iterations: iter + 1,
            tools: traceEntries
          },
          lastRawResponse: lastRaw
        };
      }
      messages.push({
        role: "assistant",
        content: String(assistantText ?? ""),
        tool_calls: toolCalls
      });
      for (const tc of toolCalls) {
        const qualifiedName = String(((_c = tc == null ? void 0 : tc.function) == null ? void 0 : _c.name) ?? "");
        const id = String((tc == null ? void 0 : tc.id) ?? "");
        const parsed = ToolCatalog.parseQualifiedName(qualifiedName);
        const rawArgs = (_d = tc == null ? void 0 : tc.function) == null ? void 0 : _d.arguments;
        let args = {};
        if (rawArgs && typeof rawArgs === "object") {
          args = rawArgs;
        } else if (typeof rawArgs === "string" && rawArgs.trim()) {
          try {
            args = JSON.parse(rawArgs);
          } catch {
            args = {};
          }
        }
        const start = Date.now();
        let isError = false;
        let resultText = "";
        let uiImages;
        if (!parsed) {
          isError = true;
          resultText = `Invalid MCP tool name: ${qualifiedName}`;
        } else {
          const toolResp = await fetch("/api/plugins/mcp-client/tools/call", {
            method: "POST",
            headers: {
              ...ctx.getRequestHeaders(),
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              serverId: parsed.serverId,
              toolName: parsed.toolName,
              arguments: args ?? {}
            })
          });
          const toolData = await toolResp.json().catch(() => ({}));
          if (!toolResp.ok) {
            isError = true;
            resultText = String((toolData == null ? void 0 : toolData.error) ?? `${toolResp.status} ${toolResp.statusText}`);
          } else {
            isError = Boolean(toolData == null ? void 0 : toolData.isError);
            const formatted = await formatToolResult(toolData.content ?? [], {
              uploadMedia: opts.uploadMedia
            });
            resultText = formatted.modelText;
            uiImages = formatted.ui.images;
          }
        }
        const durationMs = Date.now() - start;
        messages.push({
          role: "tool",
          tool_call_id: id,
          content: isError ? `ERROR: ${resultText}` : resultText
        });
        traceEntries.push({
          toolCallId: id,
          qualifiedName,
          serverId: (parsed == null ? void 0 : parsed.serverId) ?? "",
          toolName: (parsed == null ? void 0 : parsed.toolName) ?? "",
          arguments: args,
          isError,
          resultText,
          images: uiImages,
          durationMs
        });
      }
      generateData.messages = messages;
    }
    return {
      finalText: extractAssistantTextFromData(lastRaw, ctx),
      trace: {
        version: 1,
        iterations: maxIterations,
        tools: traceEntries
      },
      lastRawResponse: lastRaw
    };
  }
  let toolCatalog = null;
  let interceptInstalled = false;
  let isRunning = false;
  const HOOKS_ID = "mcp-client-tooluse";
  function escapeHtml(s) {
    return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }
  function generateUniqueId() {
    return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
  }
  function getJsonHeaders() {
    var _a;
    const ctx = (_a = SillyTavern == null ? void 0 : SillyTavern.getContext) == null ? void 0 : _a.call(SillyTavern);
    return {
      ...(ctx == null ? void 0 : ctx.getRequestHeaders) ? ctx.getRequestHeaders() : {},
      "Content-Type": "application/json"
    };
  }
  async function fetchJson(url, body = {}) {
    const resp = await fetch(url, {
      method: "POST",
      headers: getJsonHeaders(),
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`${resp.status} ${resp.statusText}${text ? `: ${text}` : ""}`);
    }
    return resp.json();
  }
  async function uploadMediaToSt(base64, mimeType) {
    const ext = (mimeType.split("/")[1] || "png").toLowerCase();
    const filename = `mcp_${Date.now()}_${generateUniqueId()}`;
    const resp = await fetch("/api/images/upload", {
      method: "POST",
      headers: getJsonHeaders(),
      body: JSON.stringify({
        image: base64,
        format: ext,
        ch_name: "mcp-client",
        filename
      })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error((data == null ? void 0 : data.error) || `${resp.status} ${resp.statusText}`);
    }
    return data.path;
  }
  function restoreUiOnlyIgnores(ctx) {
    var _a, _b;
    const ignore = (_a = ctx.symbols) == null ? void 0 : _a.ignore;
    if (!ignore) return;
    for (const m of ctx.chat ?? []) {
      if ((_b = m == null ? void 0 : m.extra) == null ? void 0 : _b.mcp_client_ui_only) {
        m.extra[ignore] = true;
      }
    }
  }
  async function probeBackend() {
    try {
      const ctx = SillyTavern.getContext();
      const headers = {
        ...ctx.getRequestHeaders(),
        "Content-Type": "application/json"
      };
      const resp = await fetch("/api/plugins/mcp-client/servers/list", {
        method: "POST",
        headers,
        body: "{}"
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
  function getMessageElement(messageId) {
    return document.querySelector(`#chat .mes[mesid="${messageId}"]`);
  }
  function renderToolTrace(messageId, trace) {
    var _a;
    const mesEl = getMessageElement(messageId);
    if (!mesEl) return;
    const existing = mesEl.querySelector(`#mcp-tool-trace-${messageId}`);
    if (existing) existing.remove();
    const details = document.createElement("details");
    details.id = `mcp-tool-trace-${messageId}`;
    details.className = "mcp-tool-trace";
    const summary = document.createElement("summary");
    summary.innerHTML = `MCP Tools (${trace.tools.length})`;
    details.appendChild(summary);
    const body = document.createElement("div");
    body.className = "mcp-tool-trace-body";
    const rows = trace.tools.map((t, idx) => {
      const argsStr = (() => {
        try {
          return escapeHtml(JSON.stringify(t.arguments ?? {}, null, 2));
        } catch {
          return escapeHtml(String(t.arguments ?? ""));
        }
      })();
      const resultStr = escapeHtml(String(t.resultText ?? ""));
      const imagesHtml = Array.isArray(t.images) && t.images.length > 0 ? `<div class="mcp-tool-trace-images">${t.images.map((img) => {
        const url = escapeHtml(img.url);
        const label = escapeHtml(img.mimeType);
        return `<a class="mcp-tool-trace-image-link" href="${url}" target="_blank" rel="noopener noreferrer">
            <img class="mcp-tool-trace-thumb" src="${url}" alt="${label}" loading="lazy" />
            <span class="mcp-tool-trace-image-label">${label}</span>
          </a>`;
      }).join("")}</div>` : "";
      return `
      <div class="mcp-tool-trace-item">
        <div class="mcp-tool-trace-head">
          <span class="mcp-tool-trace-idx">#${idx + 1}</span>
          <code class="mcp-tool-trace-name">${escapeHtml(t.qualifiedName)}</code>
          ${t.isError ? '<span class="mcp-tool-trace-error">ERROR</span>' : ""}
          ${typeof t.durationMs === "number" ? `<span class="mcp-tool-trace-ms">${t.durationMs}ms</span>` : ""}
        </div>
        <details>
          <summary>Arguments</summary>
          <pre class="mcp-tool-trace-pre">${argsStr}</pre>
        </details>
        <details>
          <summary>Result</summary>
          <pre class="mcp-tool-trace-pre">${resultStr}</pre>
        </details>
        ${imagesHtml}
      </div>
    `;
    }).join("");
    body.innerHTML = rows || '<div class="mcp-empty">No tool calls.</div>';
    details.appendChild(body);
    const textEl = mesEl.querySelector(".mes_text");
    if (textEl) {
      (_a = textEl.parentElement) == null ? void 0 : _a.insertBefore(details, textEl.nextSibling);
    } else {
      mesEl.appendChild(details);
    }
  }
  async function ensureHooksInstalled(ctx) {
    var _a, _b, _c;
    if (interceptInstalled) return;
    const ST_API = window.ST_API;
    if (!((_a = ST_API == null ? void 0 : ST_API.hooks) == null ? void 0 : _a.install)) {
      throw new Error("st-api-wrapper not available: ST_API.hooks.install not found");
    }
    try {
      await ((_c = (_b = ST_API.functionCalling) == null ? void 0 : _b.setEnabled) == null ? void 0 : _c.call(_b, { enabled: false }));
    } catch {
    }
    await ST_API.hooks.install({
      id: HOOKS_ID,
      intercept: {
        block: {
          sendButton: true,
          sendEnter: true,
          regenerate: true,
          continue: true,
          impersonate: false,
          stopButton: false
        },
        targets: ["sendButton", "sendEnter", "regenerate", "continue", "stopButton"],
        onlyWhenSendOnEnter: true
      },
      observe: {
        targets: ["generationLifecycle", "stopButtonVisibility"]
      },
      broadcast: {
        target: "st",
        stPrefix: "st_api_wrapper"
      }
    });
    interceptInstalled = true;
    const onIntercept = async (payload) => {
      if (!payload || payload.id !== HOOKS_ID) return;
      if (payload.blocked !== true) return;
      if (payload.target === "sendButton" || payload.target === "sendEnter") {
        await handleSend(ctx);
        return;
      }
      if (payload.target === "regenerate") {
        await handleRegenerate(ctx);
        return;
      }
    };
    ctx.eventSource.on("st_api_wrapper:intercept", onIntercept);
  }
  function getSendTextarea() {
    return document.getElementById("send_textarea");
  }
  function clearSendTextarea() {
    const el = getSendTextarea();
    if (!el) return;
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  async function handleSend(ctx) {
    var _a, _b, _c, _d, _e;
    if (!toolCatalog) return;
    if (isRunning) return;
    const ta = getSendTextarea();
    const text = String((ta == null ? void 0 : ta.value) ?? "").trim();
    if (!text) return;
    isRunning = true;
    try {
      clearSendTextarea();
      const ST_API = window.ST_API;
      if (!((_a = ST_API == null ? void 0 : ST_API.chatHistory) == null ? void 0 : _a.create)) {
        throw new Error("st-api-wrapper not available: ST_API.chatHistory.create not found");
      }
      await ST_API.chatHistory.create({ role: "user", content: text });
      const { finalText, trace } = await runToolLoop({
        ctx,
        toolCatalog,
        uploadMedia: ({ base64, mimeType }) => uploadMediaToSt(base64, mimeType),
        maxIterations: 10
      });
      const created = await ST_API.chatHistory.create({ role: "model", content: finalText });
      const idx = Number(created == null ? void 0 : created.index);
      if (Number.isFinite(idx) && idx >= 0 && ctx.chat[idx]) {
        ctx.chat[idx].extra = {
          ...ctx.chat[idx].extra ?? {},
          mcp_tool_trace: trace
        };
        try {
          await ((_b = ctx.saveChat) == null ? void 0 : _b.call(ctx));
        } catch {
        }
        try {
          (_c = ctx.updateMessageBlock) == null ? void 0 : _c.call(ctx, idx, ctx.chat[idx]);
        } catch {
        }
        renderToolTrace(idx, trace);
      }
    } catch (e) {
      console.error("[MCP Client] send failed:", e);
      (_e = (_d = window.toastr) == null ? void 0 : _d.error) == null ? void 0 : _e.call(_d, e instanceof Error ? e.message : String(e), "MCP Client");
    } finally {
      isRunning = false;
    }
  }
  async function handleRegenerate(ctx) {
    var _a, _b, _c, _d, _e, _f;
    if (!toolCatalog) return;
    if (isRunning) return;
    isRunning = true;
    try {
      const ST_API = window.ST_API;
      if (!((_a = ST_API == null ? void 0 : ST_API.chatHistory) == null ? void 0 : _a.delete)) {
        throw new Error("st-api-wrapper not available: ST_API.chatHistory.delete not found");
      }
      let lastAssistantIdx = -1;
      for (let i = (((_b = ctx.chat) == null ? void 0 : _b.length) ?? 0) - 1; i >= 0; i--) {
        const m = ctx.chat[i];
        if (!m) continue;
        if (m.is_system) continue;
        if (m.is_user) continue;
        lastAssistantIdx = i;
        break;
      }
      if (lastAssistantIdx < 0) {
        return;
      }
      await ST_API.chatHistory.delete({ index: lastAssistantIdx });
      const { finalText, trace } = await runToolLoop({
        ctx,
        toolCatalog,
        uploadMedia: ({ base64, mimeType }) => uploadMediaToSt(base64, mimeType),
        maxIterations: 10
      });
      const created = await ST_API.chatHistory.create({ role: "model", content: finalText });
      const idx = Number(created == null ? void 0 : created.index);
      if (Number.isFinite(idx) && idx >= 0 && ctx.chat[idx]) {
        ctx.chat[idx].extra = {
          ...ctx.chat[idx].extra ?? {},
          mcp_tool_trace: trace
        };
        try {
          await ((_c = ctx.saveChat) == null ? void 0 : _c.call(ctx));
        } catch {
        }
        try {
          (_d = ctx.updateMessageBlock) == null ? void 0 : _d.call(ctx, idx, ctx.chat[idx]);
        } catch {
        }
        renderToolTrace(idx, trace);
      }
    } catch (e) {
      console.error("[MCP Client] regenerate failed:", e);
      (_f = (_e = window.toastr) == null ? void 0 : _e.error) == null ? void 0 : _f.call(_e, e instanceof Error ? e.message : String(e), "MCP Client");
    } finally {
      isRunning = false;
    }
  }
  function setServerManagerVisible(visible) {
    const el = document.getElementById("mcp-server-manager");
    if (!el) return;
    el.style.display = visible ? "block" : "none";
  }
  function isServerManagerVisible() {
    const el = document.getElementById("mcp-server-manager");
    if (!el) return false;
    return el.style.display !== "none";
  }
  async function loadConfig() {
    try {
      return await fetchJson("/api/plugins/mcp-client/config/get", {});
    } catch {
      return { servers: [] };
    }
  }
  async function saveConfig(servers) {
    await fetchJson("/api/plugins/mcp-client/config/set", { servers });
  }
  async function upsertServerInConfig(server) {
    const cfg = await loadConfig();
    const servers = Array.isArray(cfg.servers) ? [...cfg.servers] : [];
    const idx = servers.findIndex((s) => (s == null ? void 0 : s.id) === (server == null ? void 0 : server.id));
    if (idx >= 0) servers[idx] = server;
    else servers.push(server);
    await saveConfig(servers);
  }
  async function removeServerFromConfig(id) {
    const cfg = await loadConfig();
    const servers = Array.isArray(cfg.servers) ? cfg.servers.filter((s) => (s == null ? void 0 : s.id) !== id) : [];
    await saveConfig(servers);
  }
  async function refreshServersUI() {
    const listEl = document.getElementById("mcp-server-list");
    if (!listEl) return;
    try {
      const data = await fetchJson("/api/plugins/mcp-client/servers/list", {});
      const servers = data.servers ?? [];
      if (servers.length === 0) {
        listEl.innerHTML = '<div class="mcp-empty">No servers. Click "Add Server (JSON)".</div>';
        return;
      }
      listEl.innerHTML = servers.map((s) => {
        var _a, _b;
        const id = escapeHtml(((_a = s == null ? void 0 : s.config) == null ? void 0 : _a.id) ?? "");
        const name = escapeHtml(((_b = s == null ? void 0 : s.config) == null ? void 0 : _b.name) ?? "");
        const status = escapeHtml((s == null ? void 0 : s.status) ?? "unknown");
        const err = (s == null ? void 0 : s.error) ? `<div class="mcp-muted">${escapeHtml(String(s.error))}</div>` : "";
        const btn = status === "connected" ? `<button class="menu_button mcp-srv-disconnect" data-id="${id}">Disconnect</button>` : `<button class="menu_button mcp-srv-connect" data-id="${id}">Connect</button>`;
        return `
        <div class="mcp-tool-item" style="margin-top:8px">
          <div><code>${id}</code> <small class="mcp-muted">${name}</small> <small class="mcp-muted">(${status})</small></div>
          ${err}
          <div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;">
            ${btn}
            <button class="menu_button mcp-srv-remove" data-id="${id}">Remove</button>
          </div>
        </div>
      `;
      }).join("");
      listEl.querySelectorAll("button.mcp-srv-connect").forEach((b) => {
        b.onclick = async () => {
          const id = b.dataset.id;
          if (!id) return;
          await fetchJson("/api/plugins/mcp-client/servers/connect", { id });
          await refreshServersUI();
          if (toolCatalog) {
            await toolCatalog.syncTools();
            await updateToolList();
          }
          await updateStatus();
        };
      });
      listEl.querySelectorAll("button.mcp-srv-disconnect").forEach((b) => {
        b.onclick = async () => {
          const id = b.dataset.id;
          if (!id) return;
          await fetchJson("/api/plugins/mcp-client/servers/disconnect", { id });
          await refreshServersUI();
          if (toolCatalog) {
            await toolCatalog.syncTools();
            await updateToolList();
          }
          await updateStatus();
        };
      });
      listEl.querySelectorAll("button.mcp-srv-remove").forEach((b) => {
        b.onclick = async () => {
          const id = b.dataset.id;
          if (!id) return;
          await fetchJson("/api/plugins/mcp-client/servers/remove", { id });
          await removeServerFromConfig(id);
          await refreshServersUI();
          if (toolCatalog) {
            await toolCatalog.syncTools();
            await updateToolList();
          }
          await updateStatus();
        };
      });
    } catch (e) {
      listEl.innerHTML = `<div class="mcp-empty">Failed to load servers: ${escapeHtml(e instanceof Error ? e.message : String(e))}</div>`;
    }
  }
  function registerSettingsPanel() {
    var _a, _b, _c, _d;
    try {
      const container = document.getElementById("extensions_settings");
      if (!container) return;
      const hasStApiWrapper = !!window.ST_API;
      const panelHtml = `
      <div id="mcp-client-settings" class="extension_container">
        <div class="inline-drawer">
          <div class="inline-drawer-toggle inline-drawer-header">
            <b>MCP Client</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down"></div>
          </div>
          <div class="inline-drawer-content">
            <div class="mcp-client-panel">
              ${hasStApiWrapper ? "" : '<div class="mcp-empty">Requires <code>st-api-wrapper</code> extension to enable tool-use mode.</div>'}
              <div class="mcp-status">
                <span>Status: <span id="mcp-status-text">Checking...</span></span>
              </div>
              <div class="mcp-actions">
                <button id="mcp-sync-tools" class="menu_button">Sync Tools</button>
                <button id="mcp-open-config" class="menu_button">Manage Servers</button>
              </div>
              <div id="mcp-server-manager" style="display:none; margin-top:10px;">
                <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px;">
                  <button id="mcp-servers-refresh" class="menu_button">Refresh</button>
                  <button id="mcp-servers-add" class="menu_button">Add Server (JSON)</button>
                </div>
                <div id="mcp-server-list"></div>
              </div>
              <div id="mcp-tool-list" class="mcp-tool-list"></div>
            </div>
          </div>
        </div>
      </div>
    `;
      container.insertAdjacentHTML("beforeend", panelHtml);
      (_a = document.getElementById("mcp-sync-tools")) == null ? void 0 : _a.addEventListener("click", async () => {
        if (toolCatalog) {
          await toolCatalog.syncTools();
          updateToolList();
        }
      });
      (_b = document.getElementById("mcp-open-config")) == null ? void 0 : _b.addEventListener("click", async () => {
        const nextVisible = !isServerManagerVisible();
        setServerManagerVisible(nextVisible);
        if (nextVisible) await refreshServersUI();
      });
      (_c = document.getElementById("mcp-servers-refresh")) == null ? void 0 : _c.addEventListener("click", async () => {
        await refreshServersUI();
        await updateStatus();
      });
      (_d = document.getElementById("mcp-servers-add")) == null ? void 0 : _d.addEventListener("click", async () => {
        const example = { id: "my-server", name: "My MCP Server", transport: { type: "stdio", command: "node", args: ["path/to/server.js"] }, enabled: true, autoConnect: true };
        const input = window.prompt("Paste MCP server config JSON:", JSON.stringify(example, null, 2));
        if (!input) return;
        let cfg;
        try {
          cfg = JSON.parse(input);
        } catch (e) {
          window.alert(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
          return;
        }
        try {
          await fetchJson("/api/plugins/mcp-client/servers/add", cfg);
          await upsertServerInConfig(cfg);
          if (cfg.autoConnect) await fetchJson("/api/plugins/mcp-client/servers/connect", { id: cfg.id });
          await refreshServersUI();
          await updateStatus();
          if (toolCatalog) {
            await toolCatalog.syncTools();
            await updateToolList();
          }
        } catch (e) {
          window.alert(`Failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
      updateStatus();
      updateToolList();
    } catch (err) {
      console.warn("[MCP Client] Failed to register settings panel:", err);
    }
  }
  async function updateStatus() {
    const el = document.getElementById("mcp-status-text");
    if (!el) return;
    try {
      const resp = await fetch("/api/plugins/mcp-client/servers/list", { method: "POST", headers: getJsonHeaders(), body: "{}" });
      const data = await resp.json();
      const servers = data.servers ?? [];
      const connected = servers.filter((s) => s.status === "connected").length;
      el.textContent = `${connected}/${servers.length} servers connected`;
    } catch {
      el.textContent = "Backend unavailable";
    }
  }
  async function updateToolList() {
    const el = document.getElementById("mcp-tool-list");
    if (!el) return;
    try {
      const resp = await fetch("/api/plugins/mcp-client/tools/list", { method: "POST", headers: getJsonHeaders(), body: "{}" });
      const data = await resp.json();
      const tools = data.tools ?? [];
      if (tools.length === 0) {
        el.innerHTML = '<div class="mcp-empty">No MCP tools registered</div>';
        return;
      }
      el.innerHTML = tools.map(
        (t) => `<div class="mcp-tool-item"><code>${escapeHtml(t.name)}</code> <small class="mcp-muted">${escapeHtml(t.serverId)}</small><div class="mcp-tool-desc">${escapeHtml(String(t.description ?? ""))}</div></div>`
      ).join("");
    } catch {
      el.innerHTML = '<div class="mcp-empty">Failed to load tools</div>';
    }
  }
  async function initExtension() {
    const ctx = SillyTavern.getContext();
    restoreUiOnlyIgnores(ctx);
    const backendAvailable = await probeBackend();
    if (!backendAvailable) {
      console.warn("[MCP Client] Backend plugin not available. Extension will not initialize.");
      registerSettingsPanel();
      return;
    }
    const fetcher = async (url, opts) => {
      const headers = {
        ...ctx.getRequestHeaders(),
        ...(opts == null ? void 0 : opts.headers) ?? {}
      };
      return fetch(url, { ...opts, headers });
    };
    toolCatalog = new ToolCatalog(fetcher);
    try {
      await toolCatalog.syncTools();
    } catch (e) {
      console.warn("[MCP Client] Failed to sync tools:", e);
    }
    if (!window.ST_API) {
      console.error("[MCP Client] st-api-wrapper is required for tool-use mode.");
    } else {
      try {
        await ensureHooksInstalled(ctx);
      } catch (e) {
        console.error("[MCP Client] Failed to install hooks:", e);
      }
    }
    const ev = ctx.event_types.CHARACTER_MESSAGE_RENDERED;
    if (ev) {
      ctx.eventSource.on(ev, (messageId) => {
        var _a, _b;
        const msg = (_a = ctx.chat) == null ? void 0 : _a[messageId];
        const trace = (_b = msg == null ? void 0 : msg.extra) == null ? void 0 : _b.mcp_tool_trace;
        if (trace) {
          try {
            renderToolTrace(messageId, trace);
          } catch {
          }
        }
      });
    }
    registerSettingsPanel();
    console.log("[MCP Client] Extension initialized (dev tool-use mode).");
  }
  (async () => {
    var _a;
    const ctx = (_a = SillyTavern == null ? void 0 : SillyTavern.getContext) == null ? void 0 : _a.call(SillyTavern);
    if (!ctx) return;
    const { eventSource, event_types } = ctx;
    let initialized = false;
    const tryInit = async () => {
      if (initialized) return;
      initialized = true;
      await initExtension();
    };
    eventSource.on(event_types.APP_READY, tryInit);
    tryInit();
  })();
})();
//# sourceMappingURL=index.iife.js.map
