import { DEFAULT_SETTINGS, type AspectRatioBucket, type DisplayProfile, type GestureModifier, type Settings, type SiteEntry } from './types';
import { AUTO_CROP_AVAILABLE } from './features';

const KEY = 'justZoomSettings';
interface Store { version: 1; global: Settings; sites: Record<string, SiteEntry> }

export const FRAMING_KEYS: (keyof Settings)[] = [
  'zoomApplied',
  'zoomType',
  'zoomStrategy',
  'zoom',
  'mode',
  'panX',
  'panY',
  'autoCrop',
  'ambience',
];
const clamp = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function normalizeSettings(value: Partial<Settings> | unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const v = value && typeof value === 'object' ? value as Partial<Settings> : {};
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : base.enabled,
    controlMode: v.controlMode === 'native' || v.controlMode === 'floating' || v.controlMode === 'both' ? v.controlMode : base.controlMode,
    animations: typeof v.animations === 'boolean' ? v.animations : base.animations,
    buttonAction: ['zoom-in', 'zoom-out', 'auto-zoom'].includes(v.buttonAction as string) ? v.buttonAction! : base.buttonAction,
    buttonUseLast: typeof v.buttonUseLast === 'boolean' ? v.buttonUseLast : base.buttonUseLast,
    buttonFactor: clamp(v.buttonFactor, base.buttonFactor, 1, 3),
    zoomApplied: typeof v.zoomApplied === 'boolean' ? v.zoomApplied : base.zoomApplied,
    zoomType: v.zoomType === 'quick' || v.zoomType === 'factor' ? v.zoomType : base.zoomType,
    zoomStrategy: v.zoomStrategy === 'automatic' || v.zoomStrategy === 'manual' ? v.zoomStrategy : base.zoomStrategy,
    allowPortrait: typeof v.allowPortrait === 'boolean' ? v.allowPortrait : base.allowPortrait,
    mode: v.mode === 'fit' || v.mode === 'fill' ? v.mode : base.mode,
    zoom: clamp(v.zoom, base.zoom, 1 / 3, 3),
    panX: clamp(v.panX, base.panX, -1, 1), panY: clamp(v.panY, base.panY, -1, 1),
    autoCrop: AUTO_CROP_AVAILABLE && (typeof v.autoCrop === 'boolean' ? v.autoCrop : base.autoCrop),
    ambience: ['off', 'soft', 'full'].includes(v.ambience as string) ? v.ambience! : base.ambience,
    compatibility: typeof v.compatibility === 'boolean' ? v.compatibility : base.compatibility,
    rememberSiteState: typeof v.rememberSiteState === 'boolean' ? v.rememberSiteState : base.rememberSiteState,
    videoFinderMode: v.videoFinderMode === 'bruteforce' ? 'bruteforce' : (v.videoFinderMode === 'treewalker' ? 'treewalker' : base.videoFinderMode),
    gesturesEnabled: typeof v.gesturesEnabled === 'boolean' ? v.gesturesEnabled : base.gesturesEnabled,
    gestureModifier: ['alt', 'ctrl', 'shift', 'meta'].includes(v.gestureModifier as string) ? v.gestureModifier! as GestureModifier : base.gestureModifier,
    hudEnabled: typeof v.hudEnabled === 'boolean' ? v.hudEnabled : base.hudEnabled,
    displayProfile: ['auto', '16:9', '16:10', '21:9', '32:9', 'custom'].includes(v.displayProfile as string)
      ? (v.displayProfile! as DisplayProfile)
      : base.displayProfile,
    customDisplayAspectRatio: clamp(v.customDisplayAspectRatio, base.customDisplayAspectRatio, 1, 4),
  };
}
let contextInvalid = false;

export function isContextInvalidationError(error: unknown): boolean {
  if (!error) return false;
  const message = typeof error === 'string' ? error
    : error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message)
    : String(error);
  return typeof message === 'string' && /extension context (?:was )?invalidated/i.test(message);
}

export function markContextInvalid(): void {
  contextInvalid = true;
}

export function extensionContextAlive(): boolean {
  try {
    return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

export function isContextValid(): boolean {
  if (!contextInvalid && !extensionContextAlive()) contextInvalid = true;
  return !contextInvalid;
}

async function readStore(): Promise<Store> {
  if (!isContextValid()) {
    return { version: 1, global: normalizeSettings(undefined), sites: {} };
  }
  try {
    const stored = (await chrome.storage.local.get(KEY))[KEY];
    const raw = stored && typeof stored === 'object' ? stored as Partial<Store> : {};
    const sites = raw?.sites && typeof raw.sites === 'object' ? { ...raw.sites } : {};
    for (const k of Object.keys(sites)) {
      if (sites[k] && typeof sites[k] === 'object' && 'enabled' in sites[k]) {
        delete (sites[k] as Partial<Settings>).enabled;
      }
    }
    return { version: 1, global: normalizeSettings(raw?.global), sites };
  } catch (error) {
    if (!isContextInvalidationError(error) && isContextValid()) throw error;
    markContextInvalid();
    return { version: 1, global: normalizeSettings(undefined), sites: {} };
  }
}
export async function loadSettings(host: string, bucket?: AspectRatioBucket): Promise<Settings> {
  const store = await readStore();
  const siteEntry = Object.hasOwn(store.sites, host) ? store.sites[host] : undefined;
  if (!siteEntry) {
    return { ...store.global, enabled: store.global.enabled };
  }
  const siteConfig: Partial<Settings> = { ...siteEntry };
  delete siteConfig.enabled;
  delete (siteConfig as SiteEntry).profiles;

  if (bucket && siteEntry.profiles?.[bucket]) {
    Object.assign(siteConfig, siteEntry.profiles[bucket]);
  }

  return { ...normalizeSettings(siteConfig, store.global), enabled: store.global.enabled };
}
export async function loadFullStore(): Promise<{ global: Settings; sites: Record<string, SiteEntry> }> {
  const store = await readStore();
  return { global: store.global, sites: store.sites };
}
// Serialize read/modify/write in the worker so frames cannot overwrite each other's preferences.
export async function saveSiteSettings(host: string, settings: Settings, bucket?: AspectRatioBucket): Promise<void> {
  if (!isContextValid()) return;
  const sitePayload = normalizeSettings(settings);
  delete (sitePayload as Partial<Settings>).enabled;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'JZ_STORE', scope: 'site', host, settings: sitePayload, bucket });
    if (!result?.ok) throw new Error(result?.error || 'Could not save settings');
  } catch (error) {
    if (isContextInvalidationError(error) || !isContextValid()) {
      markContextInvalid();
      return;
    }
    throw error;
  }
}
export async function saveGlobalSettings(settings: Settings): Promise<void> {
  if (!isContextValid()) return;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'JZ_STORE', scope: 'global', settings: normalizeSettings(settings) });
    if (!result?.ok) throw new Error(result?.error || 'Could not save settings');
  } catch (error) {
    if (isContextInvalidationError(error) || !isContextValid()) {
      markContextInvalid();
      return;
    }
    throw error;
  }
}
export function subscribeSettings(host: string, callback: (settings: Settings) => void, getBucket?: () => AspectRatioBucket): () => void {
  let active = true;
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && KEY in changes) {
      if (!isContextValid()) { active = false; return; }
      const bucket = getBucket ? getBucket() : undefined;
      void loadSettings(host, bucket).then(s => { if (active) callback(s); }).catch(error => {
        if (isContextInvalidationError(error) || !isContextValid()) { markContextInvalid(); active = false; return; }
        console.error('Just Zoom could not reload settings.', error);
      });
    }
  };
  try {
    if (isContextValid() && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(listener);
    }
  } catch (error) {
    if (!isContextInvalidationError(error) && isContextValid()) throw error;
    markContextInvalid(); active = false;
  }
  return () => {
    active = false;
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
export async function writeSettings(scope: 'global' | 'site', host: string, settings: Settings, bucket?: AspectRatioBucket): Promise<void> {
  if (!isContextValid()) return;
  try {
    const store = await readStore();
    if (scope === 'global') {
      store.global = normalizeSettings(settings);
    } else {
      const siteSettings = normalizeSettings(settings);
      delete (siteSettings as Partial<Settings>).enabled;
      const existing = (store.sites[host] ? { ...store.sites[host] } : {}) as SiteEntry;
      const existingProfiles: Partial<Record<AspectRatioBucket, Partial<Settings>>> = existing.profiles ? { ...existing.profiles } : {};

      if (bucket) {
        const bucketProfile: Partial<Settings> = {};
        for (const key of FRAMING_KEYS) {
          if (siteSettings[key] !== undefined) {
            (bucketProfile as Record<string, unknown>)[key] = siteSettings[key];
          }
        }
        existingProfiles[bucket] = bucketProfile;
      }

      store.sites = {
        ...store.sites,
        [host]: {
          ...existing,
          ...siteSettings,
          profiles: existingProfiles,
        },
      };
    }
    for (const k of Object.keys(store.sites)) {
      if (store.sites[k] && typeof store.sites[k] === 'object' && 'enabled' in store.sites[k]) {
        delete (store.sites[k] as Partial<Settings>).enabled;
      }
    }
    await chrome.storage.local.set({ [KEY]: store });
  } catch (error) {
    if (!isContextInvalidationError(error) && isContextValid()) throw error;
    markContextInvalid();
  }
}
export async function eraseSettings(scope: 'global' | 'site' | 'all' | 'sites', host?: string, bucket?: AspectRatioBucket): Promise<void> {
  if (!isContextValid()) return;
  try {
    if (scope === 'all') {
      await chrome.storage.local.set({ [KEY]: { version: 1, global: DEFAULT_SETTINGS, sites: {} } });
      return;
    }
    const store = await readStore();
    if (scope === 'global') {
      store.global = DEFAULT_SETTINGS;
    } else if (scope === 'site' && host) {
      if (bucket && store.sites[host]?.profiles?.[bucket]) {
        delete store.sites[host].profiles![bucket];
        if (Object.keys(store.sites[host].profiles ?? {}).length === 0) {
          delete store.sites[host];
        }
      } else {
        delete store.sites[host];
      }
    } else if (scope === 'sites') {
      store.sites = {};
    }
    await chrome.storage.local.set({ [KEY]: store });
  } catch (error) {
    if (!isContextInvalidationError(error) && isContextValid()) throw error;
    markContextInvalid();
  }
}
