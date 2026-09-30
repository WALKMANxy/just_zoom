import type { GestureModifier, ZoomAction } from './types';
import { isContextInvalidationError, isContextValid, markContextInvalid } from './storage';
import { i18n } from './i18n';

export interface Shortcut { code: string; alt: boolean; ctrl: boolean; shift: boolean; meta: boolean }
export type ShortcutMap = Record<ZoomAction, Shortcut | null>;
export const SHORTCUT_ACTIONS: readonly ZoomAction[] = [
  'toggle-zoom',
  'zoom-in',
  'zoom-out',
  // 'toggle-auto-crop', // Paused / hidden
  'toggle-ambience',
  'reset',
  'reset-pan',
  'toggle-controls',
  'pan-left',
  'pan-right',
  'pan-up',
  'pan-down',
];
export function getShortcutLabel(action: ZoomAction): string {
  switch (action) {
    case 'toggle-zoom': return i18n.t('shortcut_toggle_zoom');
    case 'zoom-in': return i18n.t('shortcut_zoom_in');
    case 'zoom-out': return i18n.t('shortcut_zoom_out');
    case 'toggle-auto-crop': return i18n.t('shortcut_toggle_auto_crop');
    case 'toggle-ambience': return i18n.t('shortcut_toggle_ambience');
    case 'reset': return i18n.t('shortcut_reset');
    case 'reset-pan': return i18n.t('shortcut_reset_pan');
    case 'toggle-controls': return i18n.t('shortcut_toggle_controls');
    case 'pan-left': return i18n.t('shortcut_pan_left');
    case 'pan-right': return i18n.t('shortcut_pan_right');
    case 'pan-up': return i18n.t('shortcut_pan_up');
    case 'pan-down': return i18n.t('shortcut_pan_down');
    default: return action;
  }
}
export const SHORTCUT_LABELS: Record<ZoomAction, string> = new Proxy({} as Record<ZoomAction, string>, {
  get: (_, prop: string) => getShortcutLabel(prop as ZoomAction),
});
const alt = (code: string, shift = false): Shortcut => ({ code, alt: true, shift, ctrl: false, meta: false });
export const DEFAULT_SHORTCUTS: ShortcutMap = {
  'toggle-zoom': alt('KeyZ', true), 'zoom-in': alt('Equal'), 'zoom-out': alt('Minus'),
  'toggle-auto-crop': null, // Paused: alt('KeyA', true)
  'toggle-ambience': alt('KeyB', true),
  reset: alt('KeyR', true), 'reset-pan': null, 'toggle-controls': alt('KeyS', true),
  'pan-left': alt('ArrowLeft', true), 'pan-right': alt('ArrowRight', true),
  'pan-up': alt('ArrowUp', true), 'pan-down': alt('ArrowDown', true),
};
const KEY = 'justZoomShortcuts';
const supportedCode = /^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Arrow(?:Left|Right|Up|Down)|Equal|Minus|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Backquote|Space|Enter|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter))$/;
const identity = (binding: Shortcut) => `${binding.code}:${+binding.alt}${+binding.ctrl}${+binding.shift}${+binding.meta}`;
const valid = (binding: unknown): binding is Shortcut => {
  if (!binding || typeof binding !== 'object') return false;
  const b = binding as Partial<Shortcut>;
  return typeof b.code === 'string' && supportedCode.test(b.code) && ['alt', 'ctrl', 'shift', 'meta'].every(key => typeof b[key as keyof Shortcut] === 'boolean') && Boolean(b.alt || b.ctrl || b.meta);
};
export function shortcutFromEvent(event: KeyboardEvent): Shortcut | null {
  const binding = { code: event.code, alt: event.altKey, ctrl: event.ctrlKey, shift: event.shiftKey, meta: event.metaKey };
  return !event.isComposing && event.key !== 'Dead' && valid(binding) ? binding : null;
}
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const uaData = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData;
  if (uaData?.platform) return uaData.platform.toLowerCase().includes('mac');
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

export function formatModifier(modifier: GestureModifier = 'alt'): string {
  const mac = isMac();
  switch (modifier) {
    case 'alt': return mac ? 'Option' : 'Alt';
    case 'ctrl': return mac ? 'Control' : 'Ctrl';
    case 'shift': return 'Shift';
    case 'meta': return mac ? 'Cmd' : 'Win';
    default: return mac ? 'Option' : 'Alt';
  }
}

export function formatShortcut(binding: Shortcut | null): string {
  if (!binding) return i18n.t('shortcut_unbound');
  const names: Record<string, string> = { Equal: '=', Minus: '−', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`' };
  const key = names[binding.code] || binding.code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ');
  const mac = isMac();
  const ctrlName = mac ? 'Control' : 'Ctrl';
  const altName = mac ? 'Option' : 'Alt';
  const metaName = mac ? 'Cmd' : 'Meta';
  return [...(binding.ctrl ? [ctrlName] : []), ...(binding.alt ? [altName] : []), ...(binding.shift ? ['Shift'] : []), ...(binding.meta ? [metaName] : []), key].join('+');
}
export function validateShortcuts(map: ShortcutMap): string | null {
  const seen = new Map<string, ZoomAction>();
  for (const action of SHORTCUT_ACTIONS) {
    const binding = map[action]; if (binding === null) continue;
    if (!valid(binding)) {
      const modifierReq = isMac() ? 'Option, Control or Command' : 'Alt, Ctrl or Meta';
      return i18n.t('shortcut_validation_need_key', [SHORTCUT_LABELS[action], modifierReq]);
    }
    const duplicate = seen.get(identity(binding));
    if (duplicate) {
      return i18n.t('shortcut_validation_duplicate', [formatShortcut(binding), SHORTCUT_LABELS[duplicate].toLowerCase()]);
    }
    seen.set(identity(binding), action);
  }
  return null;
}
export function normalizeShortcuts(value: unknown): ShortcutMap {
  const raw = value && typeof value === 'object' ? value as Partial<ShortcutMap> : {};
  const map = {} as ShortcutMap, seen = new Set<string>();
  for (const action of SHORTCUT_ACTIONS) {
    const candidate = Object.hasOwn(raw, action) ? raw[action] : DEFAULT_SHORTCUTS[action];
    map[action] = valid(candidate) && !seen.has(identity(candidate)) ? { ...candidate } : null;
    if (map[action]) seen.add(identity(map[action]!));
  }
  return map;
}

export async function loadShortcuts(): Promise<ShortcutMap> {
  if (!isContextValid()) return normalizeShortcuts(undefined);
  try {
    const stored = (await chrome.storage.local.get(KEY))[KEY];
    return unpack(stored);
  } catch (error) {
    if (!isContextInvalidationError(error) && isContextValid()) throw error;
    markContextInvalid();
    return normalizeShortcuts(undefined);
  }
}
function unpack(value: unknown): ShortcutMap {
  return normalizeShortcuts(value && typeof value === 'object' && 'shortcuts' in value ? value.shortcuts : undefined);
}
export async function saveShortcuts(map: ShortcutMap): Promise<void> {
  if (!isContextValid()) return;
  const error = validateShortcuts(map); if (error) throw new Error(error);
  try {
    await chrome.storage.local.set({ [KEY]: { version: 1, shortcuts: normalizeShortcuts(map) } });
  } catch (error) {
    if (!isContextInvalidationError(error) && isContextValid()) throw error;
    markContextInvalid();
  }
}
export async function resetShortcuts(): Promise<void> { await saveShortcuts(DEFAULT_SHORTCUTS); }
export function subscribeShortcuts(callback: (map: ShortcutMap) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && KEY in changes) {
      if (!isContextValid()) return;
      callback(unpack(changes[KEY]?.newValue));
    }
  };
  try {
    if (isContextValid() && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(listener);
    }
  } catch (error) {
    if (!isContextInvalidationError(error) && isContextValid()) throw error;
    markContextInvalid();
  }
  return () => {
    try {
      if (isContextValid() && chrome.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(listener);
      }
    } catch (error) {
      if (!isContextInvalidationError(error) && isContextValid()) throw error;
      markContextInvalid();
    }
  };
}
function editable(event: KeyboardEvent): boolean {
  return event.composedPath().some(target => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.getAttribute('role') === 'textbox'));
}
export function attachShortcuts(callback: (action: ZoomAction) => void): () => void {
  let active = true, revision = 0, bindings = normalizeShortcuts(undefined);
  const unsubscribe = subscribeShortcuts(map => { revision++; bindings = map; });
  const initialRevision = revision;
  void loadShortcuts().then(map => { if (active && revision === initialRevision) bindings = map; }).catch(error => {
    if (isContextInvalidationError(error) || !isContextValid()) { markContextInvalid(); active = false; return; }
    console.error('Just Zoom could not load shortcuts.', error);
  });
  const listener = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || editable(event)) return;
    const binding = shortcutFromEvent(event); if (!binding) return;
    const action = SHORTCUT_ACTIONS.find(action => bindings[action] && identity(bindings[action]!) === identity(binding));
    if (!action || event.repeat && !['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down'].includes(action)) return;
    event.preventDefault(); callback(action);
  };
  document.addEventListener('keydown', listener);
  return () => { active = false; unsubscribe(); document.removeEventListener('keydown', listener); };
}
