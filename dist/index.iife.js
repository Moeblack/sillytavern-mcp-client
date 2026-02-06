var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
(function() {
  "use strict";
  class ToolBridge {
    constructor(toolManager, fetcher, opts) {
      __publicField(this, "_toolManager");
      __publicField(this, "_fetcher");
      __publicField(this, "_registeredNames", /* @__PURE__ */ new Set());
      /** Base64 image data pending injection into the AI prompt (multimodal). */
      __publicField(this, "_pendingImages", []);
      /** Uploaded image URLs pending attachment to the tool invocation message. */
      __publicField(this, "_pendingImageUrls", []);
      __publicField(this, "_onMediaUpload");
      __publicField(this, "_toolMap", /* @__PURE__ */ new Map());
      this._toolManager = toolManager;
      this._fetcher = fetcher;
      this._onMediaUpload = opts == null ? void 0 : opts.onMediaUpload;
    }
    _setFetcher(fetcher) {
      this._fetcher = fetcher;
    }
    // ---- Tool sync ----
    async syncTools() {
      const resp = await this._fetcher("/api/plugins/mcp-client/tools/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const data = await resp.json();
      const currentTools = data.tools ?? [];
      const newNames = /* @__PURE__ */ new Set();
      const newToolMap = /* @__PURE__ */ new Map();
      for (const tool of currentTools) {
        const stName = this._toStName(tool.serverId, tool.name);
        newNames.add(stName);
        newToolMap.set(stName, { serverId: tool.serverId, toolName: tool.name });
        if (!this._registeredNames.has(stName)) {
          this._registerTool(stName, tool);
        }
      }
      for (const oldName of this._registeredNames) {
        if (!newNames.has(oldName)) {
          this._toolManager.unregisterFunctionTool(oldName);
        }
      }
      this._registeredNames = newNames;
      this._toolMap = newToolMap;
    }
    // ---- Pending images (for multimodal prompt injection) ----
    getPendingImages() {
      return [...this._pendingImages];
    }
    clearPendingImages() {
      this._pendingImages = [];
    }
    // ---- Pending image URLs (for tool invocation message attachment) ----
    getPendingImageUrls() {
      return [...this._pendingImageUrls];
    }
    clearPendingImageUrls() {
      this._pendingImageUrls = [];
    }
    // ---- Internal ----
    _toStName(serverId, toolName) {
      return `mcp__${serverId}__${toolName}`;
    }
    _registerTool(stName, tool) {
      const serverId = tool.serverId;
      const toolName = tool.name;
      this._toolManager.registerFunctionTool({
        name: stName,
        displayName: tool.title ?? tool.name,
        description: tool.description ?? `MCP tool: ${tool.name}`,
        parameters: tool.inputSchema,
        action: async (args) => {
          return this._invokeToolAction(serverId, toolName, args);
        }
      });
    }
    async _invokeToolAction(serverId, toolName, args) {
      const resp = await this._fetcher("/api/plugins/mcp-client/tools/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverId, toolName, arguments: args })
      });
      const result = await resp.json();
      return this._processToolResult({ serverId, toolName }, result.content ?? []);
    }
    /**
     * Processes MCP tool result content array.
     * - text / resource / resource_link → returned as-is
     * - image → uploaded to server, URL stored, placeholder in text
     * - audio → placeholder in text
     */
    async _processToolResult(ctx, content) {
      var _a;
      const textParts = [];
      for (const item of content) {
        switch (item.type) {
          case "text":
            textParts.push(item.text);
            break;
          case "image": {
            const img = item;
            this._pendingImages.push({
              toolCallId: "",
              data: img.data,
              mimeType: img.mimeType
            });
            const audience = (_a = img.annotations) == null ? void 0 : _a.audience;
            const shouldUpload = !Array.isArray(audience) || audience.length === 0 || audience.includes("user");
            if (shouldUpload && this._onMediaUpload) {
              try {
                const url = await this._onMediaUpload({
                  serverId: ctx.serverId,
                  toolName: ctx.toolName,
                  data: img.data,
                  mimeType: img.mimeType
                });
                this._pendingImageUrls.push(url);
              } catch (err) {
                console.warn("[MCP Client] Failed to upload image:", err);
              }
            }
            textParts.push(`[Image: ${img.mimeType}, delivered to user]`);
            break;
          }
          case "audio": {
            const audio = item;
            textParts.push(`[Audio: ${audio.mimeType}, delivered to user]`);
            break;
          }
          case "resource_link":
            textParts.push(`[Resource: ${item.uri}]`);
            break;
          case "resource":
            if (item.resource.text) {
              textParts.push(item.resource.text);
            } else {
              textParts.push(`[Embedded resource: ${item.resource.uri}]`);
            }
            break;
        }
      }
      return textParts.join("\n");
    }
  }
  const IMAGE_CAPABLE_PROVIDERS = /* @__PURE__ */ new Set([
    "openai",
    "claude",
    "makersuite",
    // Gemini
    "openrouter"
  ]);
  const IMAGE_PLACEHOLDER_RE = /\[Image: [^\]]+, delivered to user\]/g;
  function shouldSendImagesToModel(strategy) {
    return strategy.sendImages === true;
  }
  function formatImageForProvider(image, provider) {
    if (IMAGE_CAPABLE_PROVIDERS.has(provider)) {
      return {
        type: "image_url",
        image_url: {
          url: `data:${image.mimeType};base64,${image.data}`,
          detail: "auto"
        }
      };
    }
    return {
      type: "text",
      text: `[Image: ${image.mimeType}, delivered to user]`
    };
  }
  function processPromptForImages(chat, pendingImages, strategy) {
    if (!shouldSendImagesToModel(strategy) || pendingImages.length === 0) {
      return chat;
    }
    const imageQueue = [...pendingImages];
    for (const message of chat) {
      if (message.role !== "tool" || typeof message.content !== "string") {
        continue;
      }
      const placeholders = message.content.match(IMAGE_PLACEHOLDER_RE);
      if (!placeholders || placeholders.length === 0) {
        continue;
      }
      const contentArray = [
        { type: "text", text: message.content }
      ];
      for (let i = 0; i < placeholders.length && imageQueue.length > 0; i++) {
        const image = imageQueue.shift();
        const formatted = formatImageForProvider(image, strategy.provider);
        contentArray.push(formatted);
      }
      message.content = contentArray;
    }
    return chat;
  }
  let bridge = null;
  let sendImages = false;
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
  function generateUniqueId() {
    return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
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
  function getJsonHeaders() {
    var _a;
    const ctx = (_a = SillyTavern == null ? void 0 : SillyTavern.getContext) == null ? void 0 : _a.call(SillyTavern);
    return {
      ...(ctx == null ? void 0 : ctx.getRequestHeaders) ? ctx.getRequestHeaders() : {},
      "Content-Type": "application/json"
    };
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
  async function initExtension() {
    const ctx = SillyTavern.getContext();
    restoreUiOnlyIgnores(ctx);
    const backendAvailable = await probeBackend();
    if (!backendAvailable) {
      console.warn("[MCP Client] Backend plugin not available. Extension will not initialize.");
      return;
    }
    const toolManager = {
      registerFunctionTool: (opts) => ctx.ToolManager.registerFunctionTool(opts),
      unregisterFunctionTool: (name) => ctx.ToolManager.unregisterFunctionTool(name)
    };
    const fetcher = async (url, opts) => {
      const headers = {
        ...ctx.getRequestHeaders(),
        ...(opts == null ? void 0 : opts.headers) ?? {}
      };
      return fetch(url, { ...opts, headers });
    };
    bridge = new ToolBridge(toolManager, fetcher, {
      onMediaUpload: async (payload) => {
        return await uploadMediaToSt(payload.data, payload.mimeType);
      }
    });
    try {
      await bridge.syncTools();
      console.log("[MCP Client] Tools synced with ToolManager.");
    } catch (err) {
      console.error("[MCP Client] Failed to sync tools:", err);
    }
    ctx.eventSource.on(
      ctx.event_types.TOOL_CALLS_PERFORMED,
      () => {
        if (!bridge) return;
        const urls = bridge.getPendingImageUrls();
        if (urls.length === 0) return;
        const lastMsg = ctx.chat[ctx.chat.length - 1];
        if (!(lastMsg == null ? void 0 : lastMsg.extra) || typeof lastMsg.extra !== "object") return;
        lastMsg.extra.mcp_images = urls;
        bridge.clearPendingImageUrls();
        console.log(`[MCP Client] Stored ${urls.length} image URL(s) on tool invocation message.`);
      }
    );
    ctx.eventSource.on(
      ctx.event_types.CHAT_COMPLETION_PROMPT_READY,
      (eventData) => {
        if (eventData.dryRun || !bridge) return;
        const pendingImages = bridge.getPendingImages();
        if (pendingImages.length === 0) return;
        const strategy = {
          sendImages,
          provider: ctx.mainApi
        };
        processPromptForImages(eventData.chat, pendingImages, strategy);
        bridge.clearPendingImages();
      }
    );
    registerSettingsPanel();
    console.log("[MCP Client] Extension initialized.");
  }
  function escapeHtml(s) {
    return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
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
          if (bridge) {
            await bridge.syncTools();
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
          if (bridge) {
            await bridge.syncTools();
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
          if (bridge) {
            await bridge.syncTools();
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
    var _a, _b, _c, _d, _e;
    try {
      const ctx = SillyTavern.getContext();
      const container = document.getElementById("extensions_settings");
      if (!container) return;
      const panelHtml = `
      <div id="mcp-client-settings" class="extension_container">
        <div class="inline-drawer">
          <div class="inline-drawer-toggle inline-drawer-header">
            <b>MCP Client</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down"></div>
          </div>
          <div class="inline-drawer-content">
            <div class="mcp-client-panel">
              <div class="mcp-status">
                <span>Status: <span id="mcp-status-text">Checking...</span></span>
              </div>
              <div class="mcp-controls">
                <label class="checkbox_label">
                  <input type="checkbox" id="mcp-send-images" ${sendImages ? "checked" : ""}>
                  <span>Send images to model (provider-aware)</span>
                </label>
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
      (_a = document.getElementById("mcp-send-images")) == null ? void 0 : _a.addEventListener("change", (e) => {
        sendImages = e.target.checked;
      });
      (_b = document.getElementById("mcp-sync-tools")) == null ? void 0 : _b.addEventListener("click", async () => {
        if (bridge) {
          await bridge.syncTools();
          updateToolList();
        }
      });
      (_c = document.getElementById("mcp-open-config")) == null ? void 0 : _c.addEventListener("click", async () => {
        const nextVisible = !isServerManagerVisible();
        setServerManagerVisible(nextVisible);
        if (nextVisible) await refreshServersUI();
      });
      (_d = document.getElementById("mcp-servers-refresh")) == null ? void 0 : _d.addEventListener("click", async () => {
        await refreshServersUI();
        await updateStatus();
      });
      (_e = document.getElementById("mcp-servers-add")) == null ? void 0 : _e.addEventListener("click", async () => {
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
          if (bridge) {
            await bridge.syncTools();
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
    if (!el || !bridge) return;
    try {
      const resp = await fetch("/api/plugins/mcp-client/tools/list", { method: "POST", headers: getJsonHeaders(), body: "{}" });
      const data = await resp.json();
      const tools = data.tools ?? [];
      if (tools.length === 0) {
        el.innerHTML = '<div class="mcp-empty">No MCP tools registered</div>';
        return;
      }
      el.innerHTML = tools.map(
        (t) => `<div class="mcp-tool-item"><code>${t.name}</code> <small class="mcp-muted">${t.serverId}</small><div class="mcp-tool-desc">${t.description ?? ""}</div></div>`
      ).join("");
    } catch {
      el.innerHTML = '<div class="mcp-empty">Failed to load tools</div>';
    }
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
