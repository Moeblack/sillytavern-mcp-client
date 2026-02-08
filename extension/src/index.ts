/**
 * SillyTavern Extension entry point for MCP Client.
 *
 * New architecture (dev branch):
 * - Hard-depends on st-api-wrapper (window.ST_API)
 * - Takes over send/regenerate via ST_API.hooks (no native Generate loop)
 * - Runs tool loop in extension using native `tool_calls` (OpenAI tools[])
 * - Calls MCP tools via server-plugin (/api/plugins/mcp-client/tools/call)
 * - Writes ONLY the final assistant message to chat, with tool trace in extra
 */

import { ToolCatalog } from './tool-bridge.js';
import { runToolLoop } from './tool-loop.js';
import type { McpToolTrace } from './types.js';

// ============================================================
// Globals from SillyTavern (injected at runtime)
// ============================================================

declare const SillyTavern: {
  getContext(): {
    eventSource: {
      on(event: string, handler: (...args: any[]) => void): void;
      removeListener(event: string, handler: (...args: any[]) => void): void;
    };
    event_types: {
      APP_READY: string;
      CHARACTER_MESSAGE_RENDERED?: string;
      CHAT_CHANGED?: string;
    };
    mainApi: string;
    getRequestHeaders(): Record<string, string>;
    chat: Array<{ mes: string; is_user: boolean; is_system: boolean; name: string; extra?: Record<PropertyKey, any> }>;
    symbols?: { ignore?: symbol };
    saveChat?: () => Promise<void>;
    updateMessageBlock?: (idx: number, message: any) => void;
    addOneMessage?: (message: any, opts?: any) => void;
    extractMessageFromData?: (data: any, activeApi?: string | null) => string;
    name1?: string;
    name2?: string;
  };
};

// ============================================================
// Plugin state
// ============================================================

let toolCatalog: ToolCatalog | null = null;
let interceptInstalled = false;
let isRunning = false;

const HOOKS_ID = 'mcp-client-tooluse';

// ============================================================
// Utils
// ============================================================

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function generateUniqueId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2);
}

function getJsonHeaders(): Record<string, string> {
  const ctx = SillyTavern?.getContext?.();
  return {
    ...(ctx?.getRequestHeaders ? ctx.getRequestHeaders() : {}),
    'Content-Type': 'application/json',
  };
}

async function fetchJson(url: string, body: unknown = {}): Promise<any> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: getJsonHeaders(),
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`${resp.status} ${resp.statusText}${text ? `: ${text}` : ''}`);
  }
  return resp.json();
}

/**
 * Uploads a base64-encoded media file to the SillyTavern server.
 * Returns the persisted URL path.
 */
async function uploadMediaToSt(base64: string, mimeType: string): Promise<string> {
  const ext = (mimeType.split('/')[1] || 'png').toLowerCase();
  const filename = `mcp_${Date.now()}_${generateUniqueId()}`;
  const resp = await fetch('/api/images/upload', {
    method: 'POST',
    headers: getJsonHeaders(),
    body: JSON.stringify({
      image: base64,
      format: ext,
      ch_name: 'mcp-client',
      filename,
    }),
  });
  const data = await resp.json().catch(() => ({} as any));
  if (!resp.ok) {
    throw new Error(data?.error || `${resp.status} ${resp.statusText}`);
  }
  return data.path as string;
}

/**
 * Backward compatibility: mark old-style standalone image messages
 * (created by previous versions) as ignored.
 */
function restoreUiOnlyIgnores(ctx: ReturnType<typeof SillyTavern.getContext>): void {
  const ignore = ctx.symbols?.ignore;
  if (!ignore) return;
  for (const m of ctx.chat ?? []) {
    if (m?.extra?.mcp_client_ui_only) {
      m.extra[ignore] = true;
    }
  }
}

// ============================================================
// Backend probe
// ============================================================

async function probeBackend(): Promise<boolean> {
  try {
    const ctx = SillyTavern.getContext();
    const headers = {
      ...ctx.getRequestHeaders(),
      'Content-Type': 'application/json',
    };
    const resp = await fetch('/api/plugins/mcp-client/servers/list', {
      method: 'POST',
      headers,
      body: '{}',
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// ============================================================
// Tool trace renderer
// ============================================================

function getMessageElement(messageId: number): HTMLElement | null {
  // ST message blocks typically have: .mes[mesid="{index}"]
  return document.querySelector(`#chat .mes[mesid="${messageId}"]`) as HTMLElement | null;
}

function renderToolTrace(messageId: number, trace: McpToolTrace) {
  const mesEl = getMessageElement(messageId);
  if (!mesEl) return;

  const existing = mesEl.querySelector(`#mcp-tool-trace-${messageId}`);
  if (existing) existing.remove();

  const details = document.createElement('details');
  details.id = `mcp-tool-trace-${messageId}`;
  details.className = 'mcp-tool-trace';

  const summary = document.createElement('summary');
  summary.innerHTML = `MCP Tools (${trace.tools.length})`;
  details.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'mcp-tool-trace-body';

  const rows = trace.tools.map((t, idx) => {
    const argsStr = (() => {
      try {
        return escapeHtml(JSON.stringify(t.arguments ?? {}, null, 2));
      } catch {
        return escapeHtml(String(t.arguments ?? ''));
      }
    })();

    const resultStr = escapeHtml(String(t.resultText ?? ''));
    const imagesHtml = Array.isArray(t.images) && t.images.length > 0
      ? `<div class="mcp-tool-trace-images">${t.images.map((img) => {
          const url = escapeHtml(img.url);
          const label = escapeHtml(img.mimeType);
          return `<a class="mcp-tool-trace-image-link" href="${url}" target="_blank" rel="noopener noreferrer">
            <img class="mcp-tool-trace-thumb" src="${url}" alt="${label}" loading="lazy" />
            <span class="mcp-tool-trace-image-label">${label}</span>
          </a>`;
        }).join('')}</div>`
      : '';

    return `
      <div class="mcp-tool-trace-item">
        <div class="mcp-tool-trace-head">
          <span class="mcp-tool-trace-idx">#${idx + 1}</span>
          <code class="mcp-tool-trace-name">${escapeHtml(t.qualifiedName)}</code>
          ${t.isError ? '<span class="mcp-tool-trace-error">ERROR</span>' : ''}
          ${typeof t.durationMs === 'number' ? `<span class="mcp-tool-trace-ms">${t.durationMs}ms</span>` : ''}
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
  }).join('');

  body.innerHTML = rows || '<div class="mcp-empty">No tool calls.</div>';
  details.appendChild(body);

  const textEl = mesEl.querySelector('.mes_text') as HTMLElement | null;
  if (textEl) {
    textEl.parentElement?.insertBefore(details, textEl.nextSibling);
  } else {
    mesEl.appendChild(details);
  }
}

// ============================================================
// Main flow (intercept send / regenerate)
// ============================================================

async function ensureHooksInstalled(ctx: ReturnType<typeof SillyTavern.getContext>) {
  if (interceptInstalled) return;

  const ST_API = (window as any).ST_API;
  if (!ST_API?.hooks?.install) {
    throw new Error('st-api-wrapper not available: ST_API.hooks.install not found');
  }

  // Disable native function calling in settings (avoid conflicts with other flows)
  try {
    await ST_API.functionCalling?.setEnabled?.({ enabled: false });
  } catch {
    // ignore
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
        stopButton: false,
      },
      targets: ['sendButton', 'sendEnter', 'regenerate', 'continue', 'stopButton'],
      onlyWhenSendOnEnter: true,
    },
    observe: {
      targets: ['generationLifecycle', 'stopButtonVisibility'],
    },
    broadcast: {
      target: 'st',
      stPrefix: 'st_api_wrapper',
    },
  });

  interceptInstalled = true;

  const onIntercept = async (payload: any) => {
    if (!payload || payload.id !== HOOKS_ID) return;
    if (payload.blocked !== true) return;

    // Phase 1: only send + regenerate
    if (payload.target === 'sendButton' || payload.target === 'sendEnter') {
      await handleSend(ctx);
      return;
    }

    if (payload.target === 'regenerate') {
      await handleRegenerate(ctx);
      return;
    }
  };

  ctx.eventSource.on('st_api_wrapper:intercept', onIntercept);
}

function getSendTextarea(): HTMLTextAreaElement | null {
  return document.getElementById('send_textarea') as HTMLTextAreaElement | null;
}

function clearSendTextarea() {
  const el = getSendTextarea();
  if (!el) return;
  el.value = '';
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function handleSend(ctx: ReturnType<typeof SillyTavern.getContext>) {
  if (!toolCatalog) return;
  if (isRunning) return;

  const ta = getSendTextarea();
  const text = String(ta?.value ?? '').trim();
  if (!text) return;

  isRunning = true;

  try {
    clearSendTextarea();

    const ST_API = (window as any).ST_API;
    if (!ST_API?.chatHistory?.create) {
      throw new Error('st-api-wrapper not available: ST_API.chatHistory.create not found');
    }

    // 1) Write user message
    await ST_API.chatHistory.create({ role: 'user', content: text });

    // 2) Run tool loop
    const { finalText, trace } = await runToolLoop({
      ctx,
      toolCatalog,
      uploadMedia: ({ base64, mimeType }) => uploadMediaToSt(base64, mimeType),
      maxIterations: 10,
    });

    // 3) Write assistant message, then attach trace into extra
    const created = await ST_API.chatHistory.create({ role: 'model', content: finalText });
    const idx = Number(created?.index);
    if (Number.isFinite(idx) && idx >= 0 && ctx.chat[idx]) {
      ctx.chat[idx].extra = {
        ...(ctx.chat[idx].extra ?? {}),
        mcp_tool_trace: trace,
      };
      try {
        await ctx.saveChat?.();
      } catch {
        // ignore
      }
      try {
        ctx.updateMessageBlock?.(idx, ctx.chat[idx]);
      } catch {
        // ignore
      }
      renderToolTrace(idx, trace);
    }
  } catch (e) {
    console.error('[MCP Client] send failed:', e);
    (window as any).toastr?.error?.(e instanceof Error ? e.message : String(e), 'MCP Client');
  } finally {
    isRunning = false;
  }
}

async function handleRegenerate(ctx: ReturnType<typeof SillyTavern.getContext>) {
  if (!toolCatalog) return;
  if (isRunning) return;

  isRunning = true;

  try {
    const ST_API = (window as any).ST_API;
    if (!ST_API?.chatHistory?.delete) {
      throw new Error('st-api-wrapper not available: ST_API.chatHistory.delete not found');
    }

    // Delete last assistant message
    let lastAssistantIdx = -1;
    for (let i = (ctx.chat?.length ?? 0) - 1; i >= 0; i--) {
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

    // Run tool loop again based on current chat
    const { finalText, trace } = await runToolLoop({
      ctx,
      toolCatalog,
      uploadMedia: ({ base64, mimeType }) => uploadMediaToSt(base64, mimeType),
      maxIterations: 10,
    });

    const created = await ST_API.chatHistory.create({ role: 'model', content: finalText });
    const idx = Number(created?.index);
    if (Number.isFinite(idx) && idx >= 0 && ctx.chat[idx]) {
      ctx.chat[idx].extra = {
        ...(ctx.chat[idx].extra ?? {}),
        mcp_tool_trace: trace,
      };
      try {
        await ctx.saveChat?.();
      } catch {
        // ignore
      }
      try {
        ctx.updateMessageBlock?.(idx, ctx.chat[idx]);
      } catch {
        // ignore
      }
      renderToolTrace(idx, trace);
    }
  } catch (e) {
    console.error('[MCP Client] regenerate failed:', e);
    (window as any).toastr?.error?.(e instanceof Error ? e.message : String(e), 'MCP Client');
  } finally {
    isRunning = false;
  }
}

// ============================================================
// Server manager UI (keep existing)
// ============================================================

function setServerManagerVisible(visible: boolean) {
  const el = document.getElementById('mcp-server-manager');
  if (!el) return;
  el.style.display = visible ? 'block' : 'none';
}

function isServerManagerVisible(): boolean {
  const el = document.getElementById('mcp-server-manager');
  if (!el) return false;
  return el.style.display !== 'none';
}

async function loadConfig(): Promise<{ servers: any[] }> {
  try {
    return await fetchJson('/api/plugins/mcp-client/config/get', {});
  } catch {
    return { servers: [] };
  }
}

async function saveConfig(servers: any[]): Promise<void> {
  await fetchJson('/api/plugins/mcp-client/config/set', { servers });
}

async function upsertServerInConfig(server: any): Promise<void> {
  const cfg = await loadConfig();
  const servers = Array.isArray(cfg.servers) ? [...cfg.servers] : [];
  const idx = servers.findIndex((s) => s?.id === server?.id);
  if (idx >= 0) servers[idx] = server;
  else servers.push(server);
  await saveConfig(servers);
}

async function removeServerFromConfig(id: string): Promise<void> {
  const cfg = await loadConfig();
  const servers = Array.isArray(cfg.servers) ? cfg.servers.filter((s) => s?.id !== id) : [];
  await saveConfig(servers);
}

async function refreshServersUI(): Promise<void> {
  const listEl = document.getElementById('mcp-server-list');
  if (!listEl) return;
  try {
    const data = await fetchJson('/api/plugins/mcp-client/servers/list', {});
    const servers = data.servers ?? [];
    if (servers.length === 0) {
      listEl.innerHTML = '<div class="mcp-empty">No servers. Click "Add Server (JSON)".</div>';
      return;
    }

    listEl.innerHTML = servers.map((s: any) => {
      const id = escapeHtml(s?.config?.id ?? '');
      const name = escapeHtml(s?.config?.name ?? '');
      const status = escapeHtml(s?.status ?? 'unknown');
      const err = s?.error ? `<div class="mcp-muted">${escapeHtml(String(s.error))}</div>` : '';
      const btn = status === 'connected'
        ? `<button class="menu_button mcp-srv-disconnect" data-id="${id}">Disconnect</button>`
        : `<button class="menu_button mcp-srv-connect" data-id="${id}">Connect</button>`;
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
    }).join('');

    listEl.querySelectorAll<HTMLButtonElement>('button.mcp-srv-connect').forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.id;
        if (!id) return;
        await fetchJson('/api/plugins/mcp-client/servers/connect', { id });
        await refreshServersUI();
        if (toolCatalog) { await toolCatalog.syncTools(); await updateToolList(); }
        await updateStatus();
      };
    });
    listEl.querySelectorAll<HTMLButtonElement>('button.mcp-srv-disconnect').forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.id;
        if (!id) return;
        await fetchJson('/api/plugins/mcp-client/servers/disconnect', { id });
        await refreshServersUI();
        if (toolCatalog) { await toolCatalog.syncTools(); await updateToolList(); }
        await updateStatus();
      };
    });
    listEl.querySelectorAll<HTMLButtonElement>('button.mcp-srv-remove').forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.id;
        if (!id) return;
        await fetchJson('/api/plugins/mcp-client/servers/remove', { id });
        await removeServerFromConfig(id);
        await refreshServersUI();
        if (toolCatalog) { await toolCatalog.syncTools(); await updateToolList(); }
        await updateStatus();
      };
    });
  } catch (e) {
    listEl.innerHTML = `<div class="mcp-empty">Failed to load servers: ${escapeHtml(e instanceof Error ? e.message : String(e))}</div>`;
  }
}

function registerSettingsPanel() {
  try {
    const container = document.getElementById('extensions_settings');
    if (!container) return;

    const hasStApiWrapper = !!(window as any).ST_API;

    const panelHtml = `
      <div id="mcp-client-settings" class="extension_container">
        <div class="inline-drawer">
          <div class="inline-drawer-toggle inline-drawer-header">
            <b>MCP Client</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down"></div>
          </div>
          <div class="inline-drawer-content">
            <div class="mcp-client-panel">
              ${hasStApiWrapper ? '' : '<div class="mcp-empty">Requires <code>st-api-wrapper</code> extension to enable tool-use mode.</div>'}
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

    container.insertAdjacentHTML('beforeend', panelHtml);

    document.getElementById('mcp-sync-tools')?.addEventListener('click', async () => {
      if (toolCatalog) { await toolCatalog.syncTools(); updateToolList(); }
    });
    document.getElementById('mcp-open-config')?.addEventListener('click', async () => {
      const nextVisible = !isServerManagerVisible();
      setServerManagerVisible(nextVisible);
      if (nextVisible) await refreshServersUI();
    });
    document.getElementById('mcp-servers-refresh')?.addEventListener('click', async () => {
      await refreshServersUI();
      await updateStatus();
    });
    document.getElementById('mcp-servers-add')?.addEventListener('click', async () => {
      const example = { id: 'my-server', name: 'My MCP Server', transport: { type: 'stdio', command: 'node', args: ['path/to/server.js'] }, enabled: true, autoConnect: true };
      const input = window.prompt('Paste MCP server config JSON:', JSON.stringify(example, null, 2));
      if (!input) return;
      let cfg: any;
      try { cfg = JSON.parse(input); } catch (e) { window.alert(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`); return; }
      try {
        await fetchJson('/api/plugins/mcp-client/servers/add', cfg);
        await upsertServerInConfig(cfg);
        if (cfg.autoConnect) await fetchJson('/api/plugins/mcp-client/servers/connect', { id: cfg.id });
        await refreshServersUI(); await updateStatus();
        if (toolCatalog) { await toolCatalog.syncTools(); await updateToolList(); }
      } catch (e) { window.alert(`Failed: ${e instanceof Error ? e.message : String(e)}`); }
    });

    updateStatus();
    updateToolList();
  } catch (err) {
    console.warn('[MCP Client] Failed to register settings panel:', err);
  }
}

async function updateStatus() {
  const el = document.getElementById('mcp-status-text');
  if (!el) return;
  try {
    const resp = await fetch('/api/plugins/mcp-client/servers/list', { method: 'POST', headers: getJsonHeaders(), body: '{}' });
    const data = await resp.json();
    const servers = data.servers ?? [];
    const connected = servers.filter((s: any) => s.status === 'connected').length;
    el.textContent = `${connected}/${servers.length} servers connected`;
  } catch {
    el.textContent = 'Backend unavailable';
  }
}

async function updateToolList() {
  const el = document.getElementById('mcp-tool-list');
  if (!el) return;
  try {
    const resp = await fetch('/api/plugins/mcp-client/tools/list', { method: 'POST', headers: getJsonHeaders(), body: '{}' });
    const data = await resp.json();
    const tools = data.tools ?? [];
    if (tools.length === 0) {
      el.innerHTML = '<div class="mcp-empty">No MCP tools registered</div>';
      return;
    }
    el.innerHTML = tools.map((t: any) =>
      `<div class="mcp-tool-item"><code>${escapeHtml(t.name)}</code> <small class="mcp-muted">${escapeHtml(t.serverId)}</small><div class="mcp-tool-desc">${escapeHtml(String(t.description ?? ''))}</div></div>`
    ).join('');
  } catch {
    el.innerHTML = '<div class="mcp-empty">Failed to load tools</div>';
  }
}

// ============================================================
// Initialization
// ============================================================

async function initExtension() {
  const ctx = SillyTavern.getContext();

  restoreUiOnlyIgnores(ctx);

  // 1) Backend availability
  const backendAvailable = await probeBackend();
  if (!backendAvailable) {
    console.warn('[MCP Client] Backend plugin not available. Extension will not initialize.');
    registerSettingsPanel();
    return;
  }

  // 2) Fetcher (with ST headers)
  const fetcher = async (url: string, opts?: RequestInit) => {
    const headers = {
      ...ctx.getRequestHeaders(),
      ...((opts?.headers as Record<string, string>) ?? {}),
    };
    return fetch(url, { ...opts, headers });
  };

  toolCatalog = new ToolCatalog(fetcher);

  try {
    await toolCatalog.syncTools();
  } catch (e) {
    console.warn('[MCP Client] Failed to sync tools:', e);
  }

  // 3) Tool-use mode requires st-api-wrapper
  if (!(window as any).ST_API) {
    console.error('[MCP Client] st-api-wrapper is required for tool-use mode.');
  } else {
    try {
      await ensureHooksInstalled(ctx);
    } catch (e) {
      console.error('[MCP Client] Failed to install hooks:', e);
    }
  }

  // 4) Re-render tool trace on message render (e.g. after reload)
  const ev = ctx.event_types.CHARACTER_MESSAGE_RENDERED;
  if (ev) {
    ctx.eventSource.on(ev, (messageId: number) => {
      const msg = ctx.chat?.[messageId];
      const trace = msg?.extra?.mcp_tool_trace as McpToolTrace | undefined;
      if (trace) {
        try {
          renderToolTrace(messageId, trace);
        } catch {
          // ignore
        }
      }
    });
  }

  // 5) Settings panel
  registerSettingsPanel();

  console.log('[MCP Client] Extension initialized (dev tool-use mode).');
}

// ============================================================
// Bootstrap
// ============================================================

(async () => {
  const ctx = SillyTavern?.getContext?.();
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
