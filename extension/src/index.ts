/**
 * SillyTavern Extension entry point for MCP Client.
 *
 * Pure protocol layer — no DOM manipulation, no message display logic.
 *
 * Responsibilities:
 * 1. Probe backend plugin availability
 * 2. Register MCP tools with ST ToolManager
 * 3. Upload images to ST server, store URLs on tool invocation message
 * 4. Hook CHAT_COMPLETION_PROMPT_READY for multimodal image injection
 * 5. Register settings panel UI
 */

import { ToolBridge } from './tool-bridge.js';
import { processPromptForImages } from './multimodal.js';
import type { AiProvider, MultimodalStrategy } from './types.js';

// ============================================================
// Globals from SillyTavern (injected at runtime)
// ============================================================

declare const SillyTavern: {
  getContext(): {
    eventSource: {
      on(event: string, handler: (...args: any[]) => void): void;
    };
    event_types: {
      APP_READY: string;
      CHAT_COMPLETION_PROMPT_READY: string;
      TOOL_CALLS_PERFORMED: string;
    };
    mainApi: string;
    getRequestHeaders(): Record<string, string>;
    chat: Array<{ mes: string; is_user: boolean; is_system: boolean; name: string; extra?: Record<PropertyKey, any> }>;
    symbols?: {
      ignore?: symbol;
    };
    registerFunctionTool(opts: any): void;
    unregisterFunctionTool(name: string): void;
    ToolManager: any;
  };
};

// ============================================================
// Plugin state
// ============================================================

let bridge: ToolBridge | null = null;
let sendImages = false;

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

function generateUniqueId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2);
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

function getJsonHeaders(): Record<string, string> {
  const ctx = SillyTavern?.getContext?.();
  return {
    ...(ctx?.getRequestHeaders ? ctx.getRequestHeaders() : {}),
    'Content-Type': 'application/json',
  };
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
// Initialization
// ============================================================

async function initExtension() {
  const ctx = SillyTavern.getContext();

  restoreUiOnlyIgnores(ctx);

  // 1. Check backend availability
  const backendAvailable = await probeBackend();
  if (!backendAvailable) {
    console.warn('[MCP Client] Backend plugin not available. Extension will not initialize.');
    return;
  }

  // 2. Create ToolBridge (pure upload, no DOM)
  const toolManager = {
    registerFunctionTool: (opts: any) => ctx.ToolManager.registerFunctionTool(opts),
    unregisterFunctionTool: (name: string) => ctx.ToolManager.unregisterFunctionTool(name),
  };

  const fetcher = async (url: string, opts?: RequestInit) => {
    const headers = {
      ...ctx.getRequestHeaders(),
      ...((opts?.headers as Record<string, string>) ?? {}),
    };
    return fetch(url, { ...opts, headers });
  };

  bridge = new ToolBridge(toolManager, fetcher, {
    onMediaUpload: async (payload) => {
      return await uploadMediaToSt(payload.data, payload.mimeType);
    },
  });

  // 3. Sync tools initially
  try {
    await bridge.syncTools();
    console.log('[MCP Client] Tools synced with ToolManager.');
  } catch (err) {
    console.error('[MCP Client] Failed to sync tools:', err);
  }

  // 4. TOOL_CALLS_PERFORMED: write pending image URLs to the tool invocation message.
  //    This is the interface between MCP client (protocol) and tooluse-fix (UX).
  //    MCP client writes extra.mcp_images, tooluse-fix reads it.
  ctx.eventSource.on(
    ctx.event_types.TOOL_CALLS_PERFORMED,
    () => {
      if (!bridge) return;

      const urls = bridge.getPendingImageUrls();
      if (urls.length === 0) return;

      const lastMsg = ctx.chat[ctx.chat.length - 1];
      if (!lastMsg?.extra || typeof lastMsg.extra !== 'object') return;

      lastMsg.extra.mcp_images = urls;
      bridge.clearPendingImageUrls();

      console.log(`[MCP Client] Stored ${urls.length} image URL(s) on tool invocation message.`);
    },
  );

  // 5. Hook into prompt pipeline for multimodal image injection
  ctx.eventSource.on(
    ctx.event_types.CHAT_COMPLETION_PROMPT_READY,
    (eventData: { chat: any[]; dryRun: boolean }) => {
      if (eventData.dryRun || !bridge) return;

      const pendingImages = bridge.getPendingImages();
      if (pendingImages.length === 0) return;

      const strategy: MultimodalStrategy = {
        sendImages,
        provider: ctx.mainApi as AiProvider,
      };

      processPromptForImages(eventData.chat, pendingImages, strategy);
      bridge.clearPendingImages();
    },
  );

  // 6. Register settings panel
  registerSettingsPanel();

  console.log('[MCP Client] Extension initialized.');
}

// ============================================================
// Server manager (basic)
// ============================================================

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

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
        if (bridge) { await bridge.syncTools(); await updateToolList(); }
        await updateStatus();
      };
    });
    listEl.querySelectorAll<HTMLButtonElement>('button.mcp-srv-disconnect').forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.id;
        if (!id) return;
        await fetchJson('/api/plugins/mcp-client/servers/disconnect', { id });
        await refreshServersUI();
        if (bridge) { await bridge.syncTools(); await updateToolList(); }
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
        if (bridge) { await bridge.syncTools(); await updateToolList(); }
        await updateStatus();
      };
    });
  } catch (e) {
    listEl.innerHTML = `<div class="mcp-empty">Failed to load servers: ${escapeHtml(e instanceof Error ? e.message : String(e))}</div>`;
  }
}

// ============================================================
// Settings panel
// ============================================================

function registerSettingsPanel() {
  try {
    const ctx = SillyTavern.getContext();
    const container = document.getElementById('extensions_settings');
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
                  <input type="checkbox" id="mcp-send-images" ${sendImages ? 'checked' : ''}>
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

    container.insertAdjacentHTML('beforeend', panelHtml);

    document.getElementById('mcp-send-images')?.addEventListener('change', (e) => {
      sendImages = (e.target as HTMLInputElement).checked;
    });
    document.getElementById('mcp-sync-tools')?.addEventListener('click', async () => {
      if (bridge) { await bridge.syncTools(); updateToolList(); }
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
        if (bridge) { await bridge.syncTools(); await updateToolList(); }
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
  } catch { el.textContent = 'Backend unavailable'; }
}

async function updateToolList() {
  const el = document.getElementById('mcp-tool-list');
  if (!el || !bridge) return;
  try {
    const resp = await fetch('/api/plugins/mcp-client/tools/list', { method: 'POST', headers: getJsonHeaders(), body: '{}' });
    const data = await resp.json();
    const tools = data.tools ?? [];
    if (tools.length === 0) { el.innerHTML = '<div class="mcp-empty">No MCP tools registered</div>'; return; }
    el.innerHTML = tools.map((t: any) =>
      `<div class="mcp-tool-item"><code>${t.name}</code> <small class="mcp-muted">${t.serverId}</small><div class="mcp-tool-desc">${t.description ?? ''}</div></div>`
    ).join('');
  } catch { el.innerHTML = '<div class="mcp-empty">Failed to load tools</div>'; }
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
