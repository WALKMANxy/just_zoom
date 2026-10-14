import { DEFAULT_SETTINGS, VALID_LANGUAGES, type AspectRatioBucket, type DisplayProfile, type GestureModifier, type Language, type Settings, type SiteEntry } from './types';
import { AUTO_CROP_AVAILABLE } from './features';

const KEY = 'justZoomSettings';
export type SettingsClearScope = 'global' | 'site' | 'sites' | 'all';

interface ClearBarriers {
  epoch: number;
  all: number;
  global: number;
  sites: number;
  hosts: Record<string, number>;
  buckets: Record<string, Partial<Record<AspectRatioBucket, number>>>;
}
interface Store { version: 2; global: Settings; sites: Record<string, SiteEntry>; clear: ClearBarriers }

export class SettingsClearedError extends Error {
  readonly code = 'stale-after-clear';
  constructor(message = 'Settings changed after these edits were made.') {
    super(message);
    this.name = 'SettingsClearedError';
  }
}

export function isSettingsClearedError(error: unknown): error is SettingsClearedError {
  return error instanceof SettingsClearedError
    || Boolean(error instanceof Error && 'code' in error && error.code === 'stale-after-clear');
}

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
  'ambienceRate',
];
// Preferences a site may override. Everything outside framing and this list is
// global-only; a site entry never shadows it.
export const SITE_PREFERENCE_KEYS: (keyof Settings)[] = [
  'controlMode',
  'gesturesEnabled',
  'gestureModifier',
  'hudEnabled',
  'buttonAction',
  'buttonUseLast',
  'buttonFactor',
  'allowPortrait',
  'rememberSiteState',
];
export const GLOBAL_ONLY_KEYS = (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[])
  .filter(key => !FRAMING_KEYS.includes(key) && !SITE_PREFERENCE_KEYS.includes(key));
export function isSitePreferenceKey(key: unknown): key is keyof Settings {
  return typeof key === 'string' && (SITE_PREFERENCE_KEYS as string[]).includes(key);
}
const pick = (source: Partial<Settings>, keys: readonly (keyof Settings)[]): Partial<Settings> => {
  const next: Partial<Settings> = {};
  for (const key of keys) if (source[key] !== undefined) (next as Record<string, unknown>)[key] = source[key];
  return next;
};

const clamp = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function normalizeSettings(value: Partial<Settings> | unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const v = value && typeof value === 'object' ? value as Partial<Settings> & { ambienceRenderer?: unknown } : {};
  const ambience = v.ambience as string | undefined;
  const rate = v.ambienceRate as string | undefined;
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
    // Preserve explicit Off and convert saved experiment choices to the two retained paths.
    ambience: ['off', 'blur', 'colour'].includes(ambience ?? '') ? ambience as Settings['ambience']
      : ambience === 'soft' || ambience === 'full' ? v.ambienceRenderer === 'p3' ? 'colour' : 'blur' : base.ambience,
    ambienceRate: ['performance', 'high', 'quality'].includes(rate ?? '') ? rate as Settings['ambienceRate']
      : rate === 'low' ? 'performance' : base.ambienceRate,
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
    nativeHtml5Workaround: typeof v.nativeHtml5Workaround === 'boolean' ? v.nativeHtml5Workaround : base.nativeHtml5Workaround,
    nativePlayerSkin: v.nativePlayerSkin === 'liquid-glass' ? 'liquid-glass' : v.nativePlayerSkin === 'classic' ? 'classic' : base.nativePlayerSkin,
    language: (VALID_LANGUAGES as readonly string[]).includes(v.language as string) ? (v.language as Language) : base.language,
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

const dictionary = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

const emptyClearBarriers = (): ClearBarriers => ({
  epoch: 0, all: 0, global: 0, sites: 0, hosts: dictionary<number>(), buckets: dictionary<Partial<Record<AspectRatioBucket, number>>>(),
});

const validEpoch = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

function normalizeClearBarriers(value: unknown): ClearBarriers {
  const raw = value && typeof value === 'object' ? value as Partial<ClearBarriers> : {};
  const hosts = dictionary<number>();
  if (raw.hosts && typeof raw.hosts === 'object') {
    for (const [host, value] of Object.entries(raw.hosts)) {
      const epoch = validEpoch(value);
      if (host && epoch) hosts[host] = epoch;
    }
  }
  const buckets = dictionary<Partial<Record<AspectRatioBucket, number>>>();
  if (raw.buckets && typeof raw.buckets === 'object') {
    for (const [host, values] of Object.entries(raw.buckets)) {
      if (!host || !values || typeof values !== 'object') continue;
      const normalized: Partial<Record<AspectRatioBucket, number>> = {};
      for (const bucket of ['16:9', '21:9', '32:9', 'other'] as const) {
        const epoch = validEpoch(values[bucket]);
        if (epoch) normalized[bucket] = epoch;
      }
      if (Object.keys(normalized).length) buckets[host] = normalized;
    }
  }
  const clear: ClearBarriers = {
    epoch: validEpoch(raw.epoch),
    all: validEpoch(raw.all),
    global: validEpoch(raw.global),
    sites: validEpoch(raw.sites),
    hosts,
    buckets,
  };
  clear.epoch = Math.max(clear.epoch, clear.all, clear.global, clear.sites,
    ...Object.values(hosts),
    ...Object.values(buckets).flatMap(value => Object.values(value).map(validEpoch)));
  return clear;
}

function normalizeStore(value: unknown): Store {
  const raw = value && typeof value === 'object'
    ? value as Partial<Omit<Store, 'clear' | 'version'>> & { clear?: unknown; version?: unknown }
    : {};
  const global = normalizeSettings(raw.global);
  const legacy = raw.version !== 2;
  const rawSites = raw.sites && typeof raw.sites === 'object' ? raw.sites : {};
  const sites: Record<string, SiteEntry> = {};
  for (const [host, value] of Object.entries(rawSites)) {
    if (!host || !value || typeof value !== 'object') continue;
    const entry = normalizeSiteEntry(value as SiteEntry, global, legacy);
    if (entry) sites[host] = entry;
  }
  return { version: 2, global, sites, clear: normalizeClearBarriers(raw.clear) };
}

// Version 1 site entries were full settings snapshots. Keep only keys a site may own;
// in those snapshots a site value equal to the global one is indistinguishable from a
// copied default, so it follows the global value again. Version 2 entries hold only
// deliberate site edits and are just filtered. The first write persists the result.
function normalizeSiteEntry(value: SiteEntry, global: Settings, legacy: boolean): SiteEntry | null {
  const profiles: Partial<Record<AspectRatioBucket, Partial<Settings>>> = {};
  if (value.profiles && typeof value.profiles === 'object') {
    for (const bucket of ['16:9', '21:9', '32:9', 'other'] as const) {
      const profile = value.profiles[bucket];
      if (profile && typeof profile === 'object') profiles[bucket] = pick(profile, FRAMING_KEYS);
    }
  }
  const hasProfiles = Object.keys(profiles).length > 0;
  const prefs = pick(value, SITE_PREFERENCE_KEYS);
  // Earlier versions copied the last-saved bucket's framing to the site level. It is
  // the site's framing only for entries saved before display profiles existed.
  const legacyFraming = hasProfiles ? {} : pick(value, FRAMING_KEYS);
  if (legacy) {
    for (const [values, keys] of [[prefs, SITE_PREFERENCE_KEYS], [legacyFraming, FRAMING_KEYS]] as const) {
      const normalized = normalizeSettings(values, global);
      for (const key of keys) if (key in values && normalized[key] === global[key]) delete values[key];
    }
  }
  const entry: SiteEntry = { ...legacyFraming, ...prefs };
  if (hasProfiles) entry.profiles = profiles;
  return Object.keys(entry).length ? entry : null;
}

function withoutFraming(entry: SiteEntry): SiteEntry {
  const next = { ...entry };
  for (const key of FRAMING_KEYS) delete next[key];
  return next;
}

function settingsFromStore(store: Store, host: string, bucket?: AspectRatioBucket): Settings {
  const siteEntry = Object.hasOwn(store.sites, host) ? store.sites[host] : undefined;
  if (!siteEntry) return { ...store.global, enabled: store.global.enabled };
  const siteConfig: Partial<Settings> = { ...siteEntry };
  delete siteConfig.enabled;
  delete (siteConfig as SiteEntry).profiles;
  if (bucket && siteEntry.profiles?.[bucket]) Object.assign(siteConfig, siteEntry.profiles[bucket]);
  return { ...normalizeSettings(siteConfig, store.global), enabled: store.global.enabled };
}

function effectiveClearBarrier(store: Store, host: string, bucket?: AspectRatioBucket): number {
  if (!host) return Math.max(store.clear.all, store.clear.global);
  return Math.max(store.clear.all, store.clear.global, store.clear.sites,
    store.clear.hosts[host] ?? 0,
    bucket ? store.clear.buckets[host]?.[bucket] ?? 0 : 0);
}

function writeClearBarrier(store: Store, scope: SettingsClearScope, host?: string, bucket?: AspectRatioBucket): void {
  const epoch = store.clear.epoch + 1;
  if (!Number.isSafeInteger(epoch)) throw new Error('Settings clear epoch is exhausted.');
  store.clear.epoch = epoch;
  if (scope === 'all') {
    store.clear.all = epoch;
    store.clear.hosts = dictionary<number>();
    store.clear.buckets = dictionary<Partial<Record<AspectRatioBucket, number>>>();
  } else if (scope === 'global') {
    store.clear.global = epoch;
  } else if (scope === 'sites') {
    store.clear.sites = epoch;
    store.clear.hosts = dictionary<number>();
    store.clear.buckets = dictionary<Partial<Record<AspectRatioBucket, number>>>();
  } else {
    if (!host) throw new Error('A hostname is required to clear site settings.');
    if (bucket) {
      store.clear.buckets[host] = { ...store.clear.buckets[host], [bucket]: epoch };
    } else {
      store.clear.hosts[host] = epoch;
      delete store.clear.buckets[host];
    }
  }
}

async function readStore(): Promise<Store> {
  if (!isContextValid()) {
    return { version: 2, global: normalizeSettings(undefined), sites: {}, clear: emptyClearBarriers() };
  }
  try {
    const stored = (await chrome.storage.local.get(KEY))[KEY];
    return normalizeStore(stored);
  } catch (error) {
    if (!isContextInvalidationError(error) && isContextValid()) throw error;
    markContextInvalid();
    return { version: 2, global: normalizeSettings(undefined), sites: {}, clear: emptyClearBarriers() };
  }
}
export async function loadSettings(host: string, bucket?: AspectRatioBucket): Promise<Settings> {
  return (await loadSettingsSnapshot(host, bucket)).settings;
}
export async function loadSettingsSnapshot(host: string, bucket?: AspectRatioBucket): Promise<{ settings: Settings; epoch: number }> {
  const store = await readStore();
  return { settings: settingsFromStore(store, host, bucket), epoch: store.clear.epoch };
}
export async function loadFullStore(): Promise<{ global: Settings; sites: Record<string, SiteEntry>; epoch: number }> {
  const store = await readStore();
  return { global: store.global, sites: store.sites, epoch: store.clear.epoch };
}
// Serialize read/modify/write in the worker so frames cannot overwrite each other's preferences.
// Framing always goes to the bucket profile; only `siteKeys` (preferences actually edited
// on this site, or an explicit Save site snapshot) become site overrides.
export async function saveSiteSettings(host: string, settings: Settings, epoch: number, bucket: AspectRatioBucket, siteKeys: readonly (keyof Settings)[]): Promise<void> {
  if (!isContextValid()) return;
  const keys = siteKeys.filter(isSitePreferenceKey);
  const sitePayload = pick(normalizeSettings(settings), [...FRAMING_KEYS, ...keys]);
  try {
    const result = await chrome.runtime.sendMessage({ type: 'JZ_STORE', scope: 'site', host, settings: sitePayload, siteKeys: keys, bucket, baseEpoch: epoch });
    if (result?.code === 'stale-after-clear') throw new SettingsClearedError(result.error);
    if (!result?.ok) throw new Error(result?.error || 'Could not save settings');
  } catch (error) {
    if (isContextInvalidationError(error) || !isContextValid()) {
      markContextInvalid();
      return;
    }
    throw error;
  }
}
export async function saveGlobalSettings(settings: Settings, epoch: number): Promise<void> {
  if (!isContextValid()) return;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'JZ_STORE', scope: 'global', settings: normalizeSettings(settings), baseEpoch: epoch });
    if (result?.code === 'stale-after-clear') throw new SettingsClearedError(result.error);
    if (!result?.ok) throw new Error(result?.error || 'Could not save settings');
  } catch (error) {
    if (isContextInvalidationError(error) || !isContextValid()) {
      markContextInvalid();
      return;
    }
    throw error;
  }
}
export async function saveGlobalEnabled(enabled: boolean): Promise<void> {
  return saveGlobalPatch({ enabled });
}
// Global-only keys edited from a page (e.g. the popup) update the stored global settings
// directly instead of promoting the page's effective site settings.
export async function saveGlobalPatch(patch: Partial<Settings>): Promise<void> {
  if (!isContextValid()) return;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'JZ_STORE_GLOBAL_PATCH', patch: pick(patch, GLOBAL_ONLY_KEYS) });
    if (!result?.ok) throw new Error(result?.error || 'Could not save settings');
  } catch (error) {
    if (isContextInvalidationError(error) || !isContextValid()) {
      markContextInvalid();
      return;
    }
    throw error;
  }
}
export function subscribeSettings(host: string, callback: (settings: Settings, epoch: number, cleared: boolean) => void, getBucket?: () => AspectRatioBucket): () => void {
  let active = true;
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && KEY in changes) {
      if (!isContextValid()) { active = false; return; }
      const bucket = getBucket ? getBucket() : undefined;
      const previous = normalizeStore(changes[KEY].oldValue);
      const next = normalizeStore(changes[KEY].newValue);
      const cleared = effectiveClearBarrier(next, host, bucket) > effectiveClearBarrier(previous, host, bucket);
      callback(settingsFromStore(next, host, bucket), next.clear.epoch, cleared);
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
export async function writeSettings(scope: 'global' | 'site', host: string, settings: Partial<Settings>, bucket?: AspectRatioBucket, baseEpoch?: number, siteKeys: readonly (keyof Settings)[] = []): Promise<void> {
  if (!isContextValid()) return;
  try {
    const store = await readStore();
    if (!Number.isSafeInteger(baseEpoch) || baseEpoch! < 0 || baseEpoch! > store.clear.epoch) {
      throw new Error('A valid settings epoch is required.');
    }
    const barrier = scope === 'global'
      ? Math.max(store.clear.all, store.clear.global)
      : Math.max(store.clear.all, store.clear.global, store.clear.sites, store.clear.hosts[host] ?? 0,
        bucket ? store.clear.buckets[host]?.[bucket] ?? 0 : 0);
    if (baseEpoch! < barrier) throw new SettingsClearedError();
    if (scope === 'global') {
      store.global = normalizeSettings(settings);
    } else {
      const next = normalizeSettings(settings, store.global);
      const keys = siteKeys.filter(isSitePreferenceKey);
      if (keys.includes('rememberSiteState') && next.rememberSiteState === false) {
        // Turning "remember this site" off drops what the site had saved and keeps only the opt-out.
        store.sites = { ...store.sites, [host]: { rememberSiteState: false } };
      } else {
        const existing: SiteEntry = store.sites[host] ?? {};
        const profiles: Partial<Record<AspectRatioBucket, Partial<Settings>>> = { ...existing.profiles };
        if (bucket) profiles[bucket] = pick(next, FRAMING_KEYS);
        // Bucketed framing lives only in its profile so deleting a profile falls back
        // to global framing instead of another display's copy.
        const base = bucket ? withoutFraming(existing) : { ...existing, ...pick(next, FRAMING_KEYS) };
        const entry: SiteEntry = { ...base, ...pick(next, keys) };
        if (Object.keys(profiles).length) entry.profiles = profiles; else delete entry.profiles;
        store.sites = { ...store.sites, [host]: entry };
      }
    }
    await chrome.storage.local.set({ [KEY]: store });
  } catch (error) {
    if (!isContextInvalidationError(error) && isContextValid()) throw error;
    markContextInvalid();
  }
}
// Called inside the worker's queue: page edits of global-only keys must not promote
// effective site settings or overwrite global preferences cached by an open options page.
export async function writeGlobalPatch(patch: Partial<Settings>): Promise<void> {
  if (!isContextValid()) return;
  try {
    const store = await readStore();
    store.global = normalizeSettings(pick(patch, GLOBAL_ONLY_KEYS), store.global);
    await chrome.storage.local.set({ [KEY]: store });
  } catch (error) {
    if (!isContextInvalidationError(error) && isContextValid()) throw error;
    markContextInvalid();
  }
}
export async function clearSettings(scope: SettingsClearScope, host?: string, bucket?: AspectRatioBucket): Promise<void> {
  if (!isContextValid()) return;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'JZ_STORE_CLEAR', scope, host, bucket });
    if (!result?.ok) throw new Error(result?.error || 'Could not clear settings');
  } catch (error) {
    if (isContextInvalidationError(error) || !isContextValid()) {
      markContextInvalid();
      return;
    }
    throw error;
  }
}

export async function clearStoredSettings(scope: SettingsClearScope, host?: string, bucket?: AspectRatioBucket): Promise<void> {
  if (!isContextValid()) return;
  try {
    const store = await readStore();
    writeClearBarrier(store, scope, host, bucket);
    if (scope === 'global') {
      store.global = DEFAULT_SETTINGS;
    } else if (scope === 'site' && host) {
      if (bucket && store.sites[host]?.profiles?.[bucket]) {
        delete store.sites[host].profiles![bucket];
        // Removing the last display profile keeps the site's own preferences (and opt-out).
        if (Object.keys(store.sites[host].profiles ?? {}).length === 0) {
          delete store.sites[host].profiles;
          if (Object.keys(store.sites[host]).length === 0) delete store.sites[host];
        }
      } else {
        delete store.sites[host];
      }
    } else if (scope === 'sites') {
      store.sites = {};
    } else if (scope === 'all') {
      store.global = DEFAULT_SETTINGS;
      store.sites = {};
    }
    await chrome.storage.local.set({ [KEY]: store });
  } catch (error) {
    if (!isContextInvalidationError(error) && isContextValid()) throw error;
    markContextInvalid();
  }
}
