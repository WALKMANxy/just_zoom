import { defineBackground } from 'wxt/utils/define-background';
import { clearStoredSettings, isSettingsClearedError, loadFullStore, loadSettings, normalizeSettings, isSitePreferenceKey, writeGlobalPatch, writeSettings } from '../src/shared/storage';
import type { RuntimeSnapshot } from '../src/shared/types';

export default defineBackground(() => {
  const frames = new Map<number, Map<number, { score: number; updated: number }>>();
  let storeQueue = Promise.resolve();
  let captureBusy = false;
  let lastCapture = 0;

  function isScriptableUrl(url?: string): boolean {
    if (!url) return false;
    return !/^(chrome|chrome-extension|edge|about|devtools|view-source|file):/i.test(url)
      && !/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i.test(url);
  }

  async function target(): Promise<{ tabId: number; frameId: number; state: RuntimeSnapshot } | null> {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
    if (!tab?.id || !isScriptableUrl(tab.url)) return null;
    const candidates = [...(frames.get(tab.id)?.entries() ?? [])]
      .sort((a, b) => b[1].score - a[1].score);
    for (const [frameId] of candidates) {
      try {
        const state = await chrome.tabs.sendMessage(tab.id, { type: 'JZ_GET_STATE' }, { frameId }) as RuntimeSnapshot;
        if (state?.available) return { tabId: tab.id, frameId, state };
      } catch { frames.get(tab.id)?.delete(frameId); }
    }
    // Top-frame fallback also covers newly attached runtimes before their first report, or after worker restart.
    // JZ_GET_STATE runs discovery there; a reachable page without a player is returned
    // unavailable so callers can treat it as the no-player/global-defaults case.
    try {
      const state = await chrome.tabs.sendMessage(tab.id, { type: 'JZ_GET_STATE' }, { frameId: 0 }) as RuntimeSnapshot;
      if (state?.available) {
        const tabFrames = frames.get(tab.id) ?? new Map();
        tabFrames.set(0, { score: 1000, updated: Date.now() });
        frames.set(tab.id, tabFrames);
      }
      if (state) return { tabId: tab.id, frameId: 0, state };
    } catch {
      // Tab is not yet ready, restricted, or has no content script running
    }
    return null;
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'JZ_OPEN_SETTINGS' && sender.id === chrome.runtime.id) {
      // Firefox/Safari MV2 bundles expose browserAction, not action; a missing API must
      // reach the tab fallback instead of throwing synchronously.
      void Promise.resolve().then(() => chrome.action.openPopup()).then(() => respond({ ok: true })).catch(() =>
        chrome.tabs.create({ url: chrome.runtime.getURL('/popup.html') }).then(() => respond({ ok: true })));
      return true;
    }
    if (message.type === 'JZ_OPEN_OPTIONS' && sender.id === chrome.runtime.id) {
      void chrome.runtime.openOptionsPage(); respond({ ok: true }); return;
    }
    if (message.type === 'JZ_DOWNLOAD_VIDEO' && sender.id === chrome.runtime.id && typeof message.url === 'string') {
      const filename = typeof message.filename === 'string' ? message.filename : 'video.mp4';
      chrome.downloads.download({
        url: message.url,
        filename,
        saveAs: false,
      }).then(id => respond({ ok: true, id })).catch(err => respond({ ok: false, error: String(err) }));
      return true;
    }
    if (message.type === 'JZ_SHORTCUT' && sender.id === chrome.runtime.id && sender.tab?.id !== undefined) {
      void target().then(t => {
        if (t && t.tabId === sender.tab!.id) return chrome.tabs.sendMessage(t.tabId, { type: 'JZ_ACTION', action: message.action }, { frameId: t.frameId });
      }).then(respond).catch(() => respond({ ok: false }));
      return true;
    }
    if (message.type === 'JZ_FRAME_STATUS' && sender.tab?.id !== undefined) {
      const tabFrames = frames.get(sender.tab.id) ?? new Map();
      if (message.available && typeof message.score === 'number' && Number.isFinite(message.score))
        tabFrames.set(sender.frameId ?? 0, { score: message.score, updated: Date.now() });
      else tabFrames.delete(sender.frameId ?? 0);
      frames.set(sender.tab.id, tabFrames);
      respond({ ok: true }); return;
    }
    if (message.type === 'JZ_STORE_GLOBAL_PATCH') {
      // writeGlobalPatch accepts only global-only keys; anything else in the patch is ignored.
      if (sender.id !== chrome.runtime.id || !message.patch || typeof message.patch !== 'object' || Array.isArray(message.patch)) {
        respond({ ok: false, error: 'Invalid settings request' }); return;
      }
      storeQueue = storeQueue.catch(() => {}).then(() => writeGlobalPatch(message.patch));
      void storeQueue.then(() => respond({ ok: true }), () => respond({ ok: false, error: 'Settings could not be saved' }));
      return true;
    }
    if (message.type === 'JZ_STORE') {
      const ownPage = sender.id === chrome.runtime.id;
      let host = '';
      try { host = new URL(sender.url ?? '').hostname; } catch { /* invalid sender */ }
      if (!ownPage || !['site', 'global'].includes(message.scope)
        || !Number.isSafeInteger(message.baseEpoch) || message.baseEpoch < 0
        || (message.bucket !== undefined && !['16:9', '21:9', '32:9', 'other'].includes(message.bucket))
        || (message.scope === 'site' && (!host || message.host !== host))
        || (message.siteKeys !== undefined && (!Array.isArray(message.siteKeys) || message.siteKeys.length > 32 || !message.siteKeys.every(isSitePreferenceKey)))) {
        respond({ ok: false, error: 'Invalid settings request' }); return;
      }
      storeQueue = storeQueue.catch(() => {}).then(() => writeSettings(message.scope, host, message.settings, message.bucket, message.baseEpoch, message.siteKeys));
      void storeQueue.then(() => respond({ ok: true }), error => respond({ ok: false,
        code: isSettingsClearedError(error) ? 'stale-after-clear' : undefined,
        error: isSettingsClearedError(error) ? error.message : 'Settings could not be saved' }));
      return true;
    }
    if (message.type === 'JZ_STORE_CLEAR') {
      const ownPage = sender.id === chrome.runtime.id;
      const extensionPage = sender.url?.startsWith(chrome.runtime.getURL('/'));
      let host = '';
      try { host = new URL(sender.url ?? '').hostname; } catch { /* invalid sender */ }
      if (!ownPage || !['global', 'site', 'sites', 'all'].includes(message.scope)
        || (message.bucket !== undefined && !['16:9', '21:9', '32:9', 'other'].includes(message.bucket))
        || (message.scope === 'site' && (typeof message.host !== 'string' || !message.host || message.host.length > 253
          || (!extensionPage && message.host !== host)))
        || (message.scope !== 'site' && (message.host !== undefined || message.bucket !== undefined))
        || (!extensionPage && message.scope !== 'site' && message.scope !== 'all')) {
        respond({ ok: false, error: 'Invalid settings request' }); return;
      }
      storeQueue = storeQueue.catch(() => {}).then(() => clearStoredSettings(message.scope, message.host, message.bucket));
      void storeQueue.then(() => respond({ ok: true }), () => respond({ ok: false, error: 'Settings could not be cleared' }));
      return true;
    }
    if (message.type === 'JZ_CAPTURE') {
      void (async () => {
        if (!sender.tab?.id || sender.frameId !== 0 || sender.id !== chrome.runtime.id) throw new Error('Screenshot sampling is available only in the top page');
        if (typeof message.requestId !== 'string' || message.requestId.length > 100) throw new Error('Invalid capture request');
        if (captureBusy || Date.now() - lastCapture < 700) throw new Error('Capture busy');
        captureBusy = true; lastCapture = Date.now();
        try {
          const tabId = sender.tab.id;
          const before = await chrome.tabs.get(tabId);
          const win = await chrome.windows.get(before.windowId);
          if (!before.active || !win.focused || before.url !== sender.tab.url) throw new Error('Video tab is not focused');
          const dataUrl = await chrome.tabs.captureVisibleTab(before.windowId, { format: 'jpeg', quality: 65 });
          const [active] = await chrome.tabs.query({ active: true, windowId: before.windowId });
          const afterWin = await chrome.windows.get(before.windowId);
          if (active?.id !== tabId || active.url !== before.url || !afterWin.focused) throw new Error('Tab changed during capture');
          return { ok: true, dataUrl, requestId: message.requestId };
        } finally { captureBusy = false; }
      })().then(respond).catch(error => respond({ ok: false, error: error instanceof Error ? error.message : 'Capture unavailable' }));
      return true;
    }
    if (message.type === 'JZ_POPUP_STATE' || message.type === 'JZ_POPUP_COMMAND') {
      if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('/popup.html'))) return;
      void (async () => {
        const reached = await target().catch(() => null);
        const selected = reached?.state.available ? reached : null;
        if (!selected) {
          if (message.type === 'JZ_POPUP_COMMAND') {
            if (message.command?.type === 'JZ_CLEAR_ALL') {
              storeQueue = storeQueue.catch(() => {}).then(() => clearStoredSettings('all'));
              await storeQueue;
            } else if (message.command?.type !== 'JZ_PATCH' && message.command?.type !== 'JZ_SAVE_GLOBAL') {
              throw new Error('Play a video to use this action.');
            } else {
              storeQueue = storeQueue.catch(() => {}).then(async () => {
                const current = await loadFullStore();
                await writeSettings('global', '', normalizeSettings(message.command.patch ?? {}, current.global), undefined, current.epoch);
              });
              await storeQueue;
            }
          }
          return { available: false, hostname: reached?.state.hostname ?? '', adapter: 'Global preferences', settings: await loadSettings(''),
            status: { source: 'idle', message: 'No active video. Changes here save as global defaults.' } } satisfies RuntimeSnapshot;
        }
        if (message.type === 'JZ_POPUP_STATE') return selected.state;
        if (!['JZ_PATCH', 'JZ_RESET', 'JZ_RESET_PAN', 'JZ_TOGGLE', 'JZ_ACTION', 'JZ_ACTIVATE', 'JZ_SAVE_SITE', 'JZ_SAVE_GLOBAL', 'JZ_CLEAR_SITE', 'JZ_CLEAR_ALL'].includes(message.command?.type)) throw new Error('Unknown command');
        return chrome.tabs.sendMessage(selected.tabId, message.command, { frameId: selected.frameId });
      })().then(respond).catch(error => respond({ available: false, error: error instanceof Error ? error.message : 'No video found' }));
      return true;
    }
  });
  chrome.tabs.onRemoved.addListener(id => frames.delete(id));
  chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'loading') frames.delete(id); });
  chrome.commands.onCommand.addListener(command => {
    void target().then(t => {
      if (t?.state.available) chrome.tabs.sendMessage(t.tabId, { type: 'JZ_ACTION', action: command }, { frameId: t.frameId });
    }).catch(() => {});
  });
});
