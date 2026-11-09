// Dev-only diagnostics. `__JZ_DEBUG__` is a build-time constant (see wxt.config.ts), so
// every call below is dead code in release builds and gets stripped by the minifier.
//
// Content scripts live in an isolated world, so page-side tooling (DevTools console,
// automated browser checks) cannot read runtime variables. The state is mirrored to
// `<html data-jz-debug="…json…">`, which both worlds can see.

declare const __JZ_DEBUG__: boolean;
declare const __JZ_BUILD_ID__: string;

export const DEBUG = __JZ_DEBUG__;

const counters: Record<string, number> = {};
const timings: Record<string, { n: number; total: number; max: number }> = {};
let state: Record<string, unknown> = {};
let lastError: string | null = null;
let flushQueued = false;

function flush() {
  flushQueued = false;
  try {
    document.documentElement.dataset.jzDebug = JSON.stringify({
      build: __JZ_BUILD_ID__, frame: window === window.top ? 'top' : location.href,
      at: Math.round(performance.now()), state, counters, timings, lastError,
    });
  } catch { /* document not ready or detached */ }
}

function queueFlush() {
  if (flushQueued) return;
  flushQueued = true;
  // Coalesce bursts (ResizeObserver storms during fullscreen) into one DOM write.
  setTimeout(flush, 50);
}

export function debugCount(name: string) {
  if (!DEBUG) return;
  counters[name] = (counters[name] ?? 0) + 1;
  queueFlush();
}

export function debugTime<T>(name: string, fn: () => T): T {
  if (!DEBUG) return fn();
  const start = performance.now();
  try { return fn(); }
  finally {
    const ms = performance.now() - start;
    const t = timings[name] ??= { n: 0, total: 0, max: 0 };
    t.n++; t.total = +(t.total + ms).toFixed(2); t.max = Math.max(t.max, +ms.toFixed(2));
    queueFlush();
  }
}

export function debugState(patch: Record<string, unknown>) {
  if (!DEBUG) return;
  Object.assign(state, patch);
  queueFlush();
}

export function debugLog(...args: unknown[]) {
  if (!DEBUG) return;
  console.debug('[jz]', ...args);
}

export function debugError(where: string, error: unknown) {
  if (!DEBUG) return;
  lastError = `${where}: ${error instanceof Error ? error.message : String(error)}`;
  console.warn('[jz]', lastError, error);
  queueFlush();
}

/**
 * Page-side control channel: `window.postMessage({ source: 'jz-dev', type }, '*')`.
 * - `reset-counters`: zero counters/timings before measuring an interaction.
 * - `reload`: reload the unpacked extension from disk (then reload the tab).
 * Only top-frame content scripts answer `reload` so one request triggers one reload.
 */
export function installDebugChannel(): () => void {
  if (!DEBUG) return () => {};
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window || event.data?.source !== 'jz-dev') return;
    if (event.data.type === 'reset-counters') {
      for (const key of Object.keys(counters)) delete counters[key];
      for (const key of Object.keys(timings)) delete timings[key];
      lastError = null;
      flush();
    } else if (event.data.type === 'reload' && window === window.top) {
      void chrome.runtime.sendMessage({ type: 'JZ_DEV_RELOAD' }).catch(() => {});
    }
  };
  window.addEventListener('message', onMessage);
  debugLog('debug build', __JZ_BUILD_ID__);
  flush();
  return () => {
    window.removeEventListener('message', onMessage);
    try { delete document.documentElement.dataset.jzDebug; } catch { /* detached */ }
  };
}
