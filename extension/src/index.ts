/**
 * SillyTavern Extension entry point for MCP Client.
 *
 * Responsibilities:
 * 1. Probe backend plugin availability
 * 2. Register MCP tools with ST ToolManager
 * 3. Hook CHAT_COMPLETION_PROMPT_READY for multimodal image injection
 * 4. Register settings panel UI
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
    };
    mainApi: string;
    getRequestHeaders(): Record<string, string>;
    registerFunctionTool(opts: any): void;
    unregisterFunctionTool(name: string): void;
    ToolManager: any;
  };
};

// ============================================================
// Plugin state
// ============================================================

let bridge: ToolBridge | null = null;
let sendImages = true; // Default: send images to model

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

  // 1. Check backend availability
  const backendAvailable = await probeBackend();
  if (!backendAvailable) {
    console.warn('[MCP Client] Backend plugin not available. Extension will not initialize.');
    return;
  }

  // 2. Create ToolBridge
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

  bridge = new ToolBridge(toolManager, fetcher);

  // 3. Sync tools initially
  try {
    await bridge.syncTools();
    console.log('[MCP Client] Tools synced with ToolManager.');
  } catch (err) {
    console.error('[MCP Client] Failed to sync tools:', err);
  }

  // 4. Hook into prompt pipeline for multimodal image injection
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

  // 5. Register settings panel
  registerSettingsPanel();

  console.log('[MCP Client] Extension initialized.');
}

// ============================================================
// Settings panel
// ============================================================

function registerSettingsPanel() {
  try {
    const ctx = SillyTavern.getContext();
    // Find the extensions settings container
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
              <div id="mcp-tool-list" class="mcp-tool-list"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    container.insertAdjacentHTML('beforeend', panelHtml);

    // Event listeners
    document.getElementById('mcp-send-images')?.addEventListener('change', (e) => {
      sendImages = (e.target as HTMLInputElement).checked;
    });

    document.getElementById('mcp-sync-tools')?.addEventListener('click', async () => {
      if (bridge) {
        await bridge.syncTools();
        updateToolList();
      }
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
    const resp = await fetch('/api/plugins/mcp-client/servers/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
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
  if (!el || !bridge) return;

  try {
    const resp = await fetch('/api/plugins/mcp-client/tools/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const data = await resp.json();
    const tools = data.tools ?? [];

    if (tools.length === 0) {
      el.innerHTML = '<div class="mcp-empty">No MCP tools registered</div>';
      return;
    }

    el.innerHTML = tools.map((t: any) =>
      `<div class="mcp-tool-item">
        <code>${t.name}</code>
        <small class="mcp-muted">${t.serverId}</small>
        <div class="mcp-tool-desc">${t.description ?? ''}</div>
      </div>`,
    ).join('');
  } catch {
    el.innerHTML = '<div class="mcp-empty">Failed to load tools</div>';
  }
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

  // Fallback: try immediately
  tryInit();
})();
