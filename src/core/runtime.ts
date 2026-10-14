import { DEFAULT_SETTINGS, EMPTY_CROP, type AspectRatioBucket, type Crop, type FeatureStatus, type PlayerBinding, type PlayerControls, type RuntimeSnapshot, type Settings, type ZoomAction } from '../shared/types';
import { FRAMING_KEYS, GLOBAL_ONLY_KEYS, SITE_PREFERENCE_KEYS, clearSettings, isContextInvalidationError, isContextValid, isSettingsClearedError, loadSettingsSnapshot, markContextInvalid, normalizeSettings, saveGlobalPatch, saveGlobalSettings, saveSiteSettings, subscribeSettings } from '../shared/storage';
import { createControls } from '../ui/controls';
import { createNativePlayer, type NativePlayerController } from '../ui/native-player';
import { EffectsController } from '../features/effects';
import { bindPlayer, disneyControlRoots } from './adapters';
import { findShadowVideos, isNotExcludedURL, selectVideo } from './discovery';
import { TransformEngine } from './transform';
import { automaticZoomFactor, getDisplayAspectBucket, portraitBlocked } from './eligibility';
import { attachShortcuts } from '../shared/shortcuts';
import { attachGestures, type GesturesController } from './gestures';
import { createHud, type HudController } from '../ui/hud';
import { i18n, setLanguage } from '../shared/i18n';

export function startRuntime(): () => void {
  const hostname = location.hostname;
  let settings: Settings = { ...DEFAULT_SETTINGS };
  let status: FeatureStatus = { source: 'idle', message: i18n.t('status_select_video') };
  let binding: PlayerBinding | null = null;
  let controls: PlayerControls | null = null;
  let transform: TransformEngine | null = null;
  let gestures: GesturesController | null = null;
  let hud: HudController | null = null;
  let nativePlayer: NativePlayerController | null = null;
  let effects: EffectsController | null = null;
  let crop: Crop = { ...EMPTY_CROP };
  let generation = 0, disposed = false, scheduled = 0;
  let ready = false;
  let readyPromise: Promise<void> | null = null;
  let settingsRevision = 0;

  function applyRuntimeSettings(next: Settings) {
    settings = next;
    if (settings.language) {
      setLanguage(settings.language);
      controls?.update(settings, status);
    }
  }
  let localEditRevision = 0;
  let localSettingsDirty = false;
  let siteSaveTimer = 0;
  let settingsEpoch = 0;
  let pendingSiteEpoch: number | null = null;
  let clearInProgress = false;
  // Site preferences changed on this page since the last successful save. Autosaves
  // write only these, so untouched preferences keep following the global settings.
  const editedSiteKeys = new Set<keyof Settings>();
  const discardPendingSave = () => {
    clearTimeout(siteSaveTimer); siteSaveTimer = 0;
    localEditRevision++;
    localSettingsDirty = false;
    pendingSiteEpoch = null;
    editedSiteKeys.clear();
  };
  let geometryObserver: ResizeObserver | null = null;
  let lastScreenWidth = typeof screen !== 'undefined' ? screen.width : 0;
  let lastScreenHeight = typeof screen !== 'undefined' ? screen.height : 0;
  const currentBucket = (): AspectRatioBucket => getDisplayAspectBucket(settings?.displayProfile, settings?.customDisplayAspectRatio);
  let lastBucket: AspectRatioBucket = currentBucket();
  const snapshot = (): RuntimeSnapshot => ({ available: !!binding, hostname, adapter: binding?.adapter ?? 'Generic HTML5', settings: { ...settings }, status: { ...status }, bucket: currentBucket() });
  const updateControls = () => controls?.update(settings, status);
  const showHud = (text: string, icon?: 'zoom' | 'pan' | 'reset' | 'mode' | 'ambience', force = false) => {
    if (settings.hudEnabled || force) hud?.show(text, icon);
  };
  const checkScreenChange = () => {
    if (typeof screen === 'undefined') return;
    const sw = screen.width, sh = screen.height;
    const bucket = currentBucket();
    const bucketChanged = bucket !== lastBucket;
    if (sw !== lastScreenWidth || sh !== lastScreenHeight || bucketChanged) {
      lastScreenWidth = sw;
      lastScreenHeight = sh;
      lastBucket = bucket;

      if (bucketChanged && settings.rememberSiteState) {
        const revision = settingsRevision;
        void loadSettingsSnapshot(hostname, bucket).then(next => {
          if (!disposed && isContextValid() && isActive && revision === settingsRevision && !localSettingsDirty) {
            settingsEpoch = next.epoch;
            applyRuntimeSettings(next.settings);
            transform?.refresh();
            update();
            if (settings.hudEnabled) {
              const factor = automaticZoomFactor(settings.displayProfile, settings.customDisplayAspectRatio);
              showHud(i18n.t('hud_display_profile', [bucket.toUpperCase(), factor.toFixed(2)]), 'mode');
            }
          }
        });
        return;
      }

      if (settings.zoomStrategy === 'automatic' && settings.zoomApplied) {
        transform?.refresh();
        update();
        if (settings.hudEnabled) {
          const factor = automaticZoomFactor(settings.displayProfile, settings.customDisplayAspectRatio);
          showHud(i18n.t('hud_screen_profile', [String(sw), String(sh), factor.toFixed(2)]), 'mode');
        }
      }
    }
  };
  const update = (animateZoom = false, immediate = false) => {
    if (!binding) return;
    const blocked = portraitBlocked(binding, settings.allowPortrait);
    if (!settings.enabled || blocked) {
      if (effects || transform) generation++;
      effects?.dispose(); effects = null; transform?.dispose(); transform = null;
      gestures?.dispose(); gestures = null;
      hud?.dispose(); hud = null;
      if (nativePlayer) {
        nativePlayer.dispose();
        nativePlayer = null;
        if (binding) {
          geometryObserver?.disconnect();
          geometryObserver = new ResizeObserver(() => update());
          geometryObserver.observe(binding.viewport);
          geometryObserver.observe(binding.video);
        }
      }
      status = { source: 'idle', message: blocked ? 'Portrait video or player: visual processing paused. Allow portrait to apply.' : 'Disabled on this player. Enable to resume.' }; updateControls(); return;
    }
    if (binding.adapter === 'Native HTML5' && settings.nativeHtml5Workaround) {
      if (!nativePlayer) {
        nativePlayer = createNativePlayer(binding, {
          patch, reset, resetPan, action, activate,
          saveSite: () => { void save('site', true); },
          saveGlobal: () => { void save('global'); },
        }, settings);
        geometryObserver?.disconnect();
        geometryObserver = new ResizeObserver(() => update());
        geometryObserver.observe(binding.viewport);
        geometryObserver.observe(binding.video);
      } else {
        nativePlayer.update(settings);
      }
    } else if (nativePlayer) {
      nativePlayer.dispose();
      nativePlayer = null;
      geometryObserver?.disconnect();
      geometryObserver = new ResizeObserver(() => update());
      geometryObserver.observe(binding.viewport);
      geometryObserver.observe(binding.video);
    }
    if (!transform) transform = new TransformEngine(binding);
    if (!hud) hud = createHud(binding);
    if (!gestures) {
      gestures = attachGestures(binding, {
        getSettings: () => settings,
        onPan: (panX, panY) => {
          patch({ panX, panY }, true);
          if (panX === 0 && panY === 0) showHud(i18n.t('hud_pan_centered'), 'pan', true);
          else showHud(i18n.t('hud_pan_offset', [String(Math.round(panX * 100)), String(Math.round(panY * 100))]), 'pan', true);
        },
        onZoom: (zoom) => {
          crop = { ...EMPTY_CROP };
          effects?.reset();
          patch({ zoom, zoomApplied: true, zoomStrategy: 'manual', zoomType: 'factor', autoCrop: false }, true);
          showHud(i18n.t('hud_zoom_level', [zoom.toFixed(2)]), 'zoom', true);
        },
      });
    }
    if (!effects) {
      status = { source: 'idle', message: i18n.t('status_manual_available') };
      const identity = generation;
      effects = new EffectsController(binding, next => {
        if (disposed || identity !== generation) return;
        crop = next; transform?.update(settings, crop);
      }, next => {
        if (disposed || identity !== generation) return;
        status = next; updateControls();
      });
      effects.setCrop(crop);
    }
    transform.update(settings, crop, animateZoom, immediate); effects.update({ ...settings, autoCrop: settings.autoCrop && settings.zoomApplied }); updateControls();
  };
  const patch = (change: Partial<Settings>, immediate = false) => {
    if (clearInProgress) return;
    // Manual framing holds the last accepted crop; analysis must not fight gestures.
    const manualEdit = change.zoom !== undefined || change.panX !== undefined || change.panY !== undefined;
    if (change.autoCrop === false && !manualEdit) { crop = { ...EMPTY_CROP }; effects?.reset(); }
    if (change.zoom !== undefined) change = { ...change, autoCrop: false, zoomApplied: change.zoomApplied !== undefined ? change.zoomApplied : true, zoomStrategy: 'manual' };
    if (change.panX !== undefined || change.panY !== undefined) change = { ...change, autoCrop: false, zoomApplied: true };
    if (change.autoCrop === true) change = { ...change, zoomApplied: true };
    const willToggle = change.zoomApplied !== undefined && change.zoomApplied !== settings.zoomApplied;
    applyRuntimeSettings(normalizeSettings(change, settings)); update(willToggle, immediate);
    if (change.mode === 'fit' && (change.zoomApplied ?? settings.zoomApplied)) showHud(i18n.t('hud_fit'), 'mode');
    else if (change.mode === 'fill' && (change.zoomApplied ?? settings.zoomApplied)) showHud(i18n.t('hud_fill'), 'mode');
    // Global-only preferences (enabled, animations, language, …) never become site overrides.
    const globalKeys = GLOBAL_ONLY_KEYS.filter(key => change[key] !== undefined);
    if (globalKeys.length) {
      const globalPatch: Partial<Settings> = {};
      for (const key of globalKeys) (globalPatch as Record<string, unknown>)[key] = settings[key];
      void saveGlobalPatch(globalPatch).catch(() => {
        status = { ...status, message: i18n.t('status_save_failed') }; updateControls();
      });
    }
    const siteKeys = SITE_PREFERENCE_KEYS.filter(key => change[key] !== undefined);
    for (const key of siteKeys) editedSiteKeys.add(key);
    const stateEdit = FRAMING_KEYS.some(key => change[key] !== undefined) || siteKeys.length > 0;
    if (change.rememberSiteState !== undefined || (stateEdit && settings.rememberSiteState)) {
      pendingSiteEpoch ??= settingsEpoch;
      localEditRevision++; localSettingsDirty = true;
      clearTimeout(siteSaveTimer);
      siteSaveTimer = window.setTimeout(() => { siteSaveTimer = 0; void save('site'); }, 350);
    }
  };
  const reset = () => {
    if (clearInProgress) return;
    applyRuntimeSettings(normalizeSettings({ mode: 'fit', zoomApplied: false, panX: 0, panY: 0, autoCrop: false }, settings));
    crop = { ...EMPTY_CROP }; effects?.reset(); update();
    showHud(i18n.t('hud_framing_reset'), 'reset');
    if (settings.rememberSiteState) {
      pendingSiteEpoch ??= settingsEpoch;
      localEditRevision++; localSettingsDirty = true;
      clearTimeout(siteSaveTimer);
      siteSaveTimer = window.setTimeout(() => { siteSaveTimer = 0; void save('site'); }, 350);
    }
  };
  const resetPan = () => {
    patch({ panX: 0, panY: 0 });
    showHud(i18n.t('hud_pan_centered'), 'reset');
  };
  const action = (value: ZoomAction) => {
    if (clearInProgress) return;
    const currentFactor = settings.autoCrop ? 1 : settings.zoomStrategy === 'manual' ? settings.zoom
      : Object.values(crop).some(edge => edge > .001) ? 1 : automaticZoomFactor(settings.displayProfile, settings.customDisplayAspectRatio);
    switch (value) {
      case 'toggle-zoom': {
        const next = !settings.zoomApplied;
        patch({ zoomApplied: next });
        showHud(next ? i18n.t('hud_zoom_level', [settings.zoom.toFixed(2)]) : i18n.t('hud_zoom_off'), 'zoom');
        break;
      }
      case 'zoom-in': {
        const factor = Math.min(3, +(currentFactor * 1.05).toFixed(2));
        crop = { ...EMPTY_CROP }; effects?.reset();
        patch({ zoom: factor, zoomApplied: true, zoomStrategy: 'manual', autoCrop: false, zoomType: 'factor' });
        showHud(i18n.t('hud_zoom_level', [factor.toFixed(2)]), 'zoom');
        break;
      }
      case 'zoom-out': {
        const factor = Math.max(.34, +(currentFactor / 1.05).toFixed(2));
        crop = { ...EMPTY_CROP }; effects?.reset();
        patch({ zoom: factor, zoomApplied: true, zoomStrategy: 'manual', autoCrop: false, zoomType: 'factor' });
        showHud(i18n.t('hud_zoom_level', [factor.toFixed(2)]), 'zoom');
        break;
      }
      case 'toggle-auto-crop':
        patch({ autoCrop: !settings.autoCrop }); break;
      case 'toggle-ambience': {
        const next = settings.ambience === 'off' ? 'blur' : 'off';
        patch({ ambience: next });
        showHud(next === 'off' ? i18n.t('hud_ambience_off') : next === 'blur' ? i18n.t('hud_ambience_blur') : i18n.t('hud_ambience_colour'), 'ambience');
        break;
      }
      case 'toggle-controls': controls?.toggle(); break;
      case 'reset': reset(); break;
      case 'reset-pan': resetPan(); break;
      case 'pan-left': {
        const p = Math.max(-1, +(settings.panX - .05).toFixed(2));
        patch({ panX: p });
        showHud(p === 0 && settings.panY === 0 ? i18n.t('hud_pan_centered') : i18n.t('hud_pan_offset', [String(Math.round(p * 100)), String(Math.round(settings.panY * 100))]), 'pan');
        break;
      }
      case 'pan-right': {
        const p = Math.min(1, +(settings.panX + .05).toFixed(2));
        patch({ panX: p });
        showHud(p === 0 && settings.panY === 0 ? i18n.t('hud_pan_centered') : i18n.t('hud_pan_offset', [String(Math.round(p * 100)), String(Math.round(settings.panY * 100))]), 'pan');
        break;
      }
      case 'pan-up': {
        const p = Math.max(-1, +(settings.panY - .05).toFixed(2));
        patch({ panY: p });
        showHud(settings.panX === 0 && p === 0 ? i18n.t('hud_pan_centered') : i18n.t('hud_pan_offset', [String(Math.round(settings.panX * 100)), String(Math.round(p * 100))]), 'pan');
        break;
      }
      case 'pan-down': {
        const p = Math.min(1, +(settings.panY + .05).toFixed(2));
        patch({ panY: p });
        showHud(settings.panX === 0 && p === 0 ? i18n.t('hud_pan_centered') : i18n.t('hud_pan_offset', [String(Math.round(settings.panX * 100)), String(Math.round(p * 100))]), 'pan');
        break;
      }
    }
  };
  const activate = () => {
    if (clearInProgress) return;
    if (settings.zoomApplied) {
      patch({ zoomApplied: false });
      showHud(i18n.t('hud_zoom_off'), 'zoom');
      return;
    }
    if (settings.buttonAction === 'auto-zoom') {
      patch({ autoCrop: true, zoomApplied: true });
      showHud(i18n.t('hud_auto_framing'), 'zoom');
      return;
    }
    if (settings.buttonUseLast) {
      if (settings.zoomType === 'quick') {
        patch({ zoomApplied: true, zoomType: 'quick', mode: settings.mode });
        showHud(settings.mode === 'fill' ? i18n.t('hud_fill') : i18n.t('hud_fit'), 'mode');
        return;
      }
      if (settings.zoomType === 'factor' && settings.zoomStrategy === 'automatic') {
        patch({ zoomApplied: true, zoomType: 'factor', zoomStrategy: 'automatic' });
        showHud(i18n.t('hud_screen_ratio'), 'mode');
        return;
      }
      if (settings.autoCrop) {
        patch({ autoCrop: true, zoomApplied: true });
        showHud(i18n.t('hud_auto_framing'), 'zoom');
        return;
      }
      const factor = settings.zoom < 1 ? 1 / settings.zoom : settings.zoom;
      crop = { ...EMPTY_CROP }; effects?.reset();
      const nextZoom = settings.buttonAction === 'zoom-out' ? 1 / factor : factor;
      patch({ zoom: nextZoom, zoomApplied: true, zoomStrategy: 'manual', zoomType: 'factor', autoCrop: false });
      showHud(i18n.t('hud_zoom_level', [nextZoom.toFixed(2)]), 'zoom');
      return;
    }
    const factor = settings.buttonFactor < 1 ? 1 / settings.buttonFactor : settings.buttonFactor;
    crop = { ...EMPTY_CROP }; effects?.reset();
    const nextZoom = settings.buttonAction === 'zoom-out' ? 1 / factor : factor;
    patch({ zoom: nextZoom, zoomApplied: true, zoomStrategy: 'manual', zoomType: 'factor', autoCrop: false });
    showHud(i18n.t('hud_zoom_level', [nextZoom.toFixed(2)]), 'zoom');
  };
  // `snapshot` (explicit Save site) stores every site preference except the remember
  // opt-out; autosaves store only preferences edited on this page.
  const save = async (scope: 'site' | 'global', snapshot = false) => {
    if (clearInProgress) return;
    const revision = localEditRevision, value = settings;
    const epoch = pendingSiteEpoch ?? settingsEpoch;
    const siteKeys = snapshot
      ? [...new Set([...SITE_PREFERENCE_KEYS.filter(key => key !== 'rememberSiteState'), ...editedSiteKeys])]
      : [...editedSiteKeys];
    if (scope === 'site') { clearTimeout(siteSaveTimer); siteSaveTimer = 0; }
    try {
      if (scope === 'site') await saveSiteSettings(hostname, value, epoch, currentBucket(), siteKeys); else await saveGlobalSettings(value, epoch);
      if (revision === localEditRevision) { localSettingsDirty = false; pendingSiteEpoch = null; editedSiteKeys.clear(); }
    }
    catch (error) {
      if (revision !== localEditRevision || disposed) return;
      if (isSettingsClearedError(error)) {
        discardPendingSave();
        const reloadRevision = localEditRevision;
        try {
          const next = await loadSettingsSnapshot(hostname, currentBucket());
          if (disposed || reloadRevision !== localEditRevision) return;
          settingsEpoch = next.epoch;
          applyRuntimeSettings(next.settings);
          crop = { ...EMPTY_CROP }; effects?.reset(); update();
          return;
        } catch { /* Report a failed reload through the existing save status below. */ }
      }
      localSettingsDirty = false; pendingSiteEpoch = null;
      status = { ...status, message: i18n.t('status_save_failed') }; updateControls();
    }
  };
  const clear = async (scope: 'site' | 'all') => {
    if (clearInProgress) throw new Error(i18n.t('status_clear_in_progress'));
    discardPendingSave();
    clearInProgress = true;
    try { await clearSettings(scope, scope === 'site' ? hostname : undefined, scope === 'site' ? currentBucket() : undefined); }
    finally {
      try {
        const next = await loadSettingsSnapshot(hostname, currentBucket());
        if (!disposed) {
          settingsEpoch = next.epoch;
          applyRuntimeSettings(next.settings);
          crop = { ...EMPTY_CROP }; effects?.reset(); update();
        }
      } finally { clearInProgress = false; }
    }
  };
  const sourceChanged = () => { crop = { ...EMPTY_CROP }; effects?.reset(); update(); };
  const detach = () => {
    if (!binding) return;
    generation++;
    geometryObserver?.disconnect(); geometryObserver = null;
    binding.video.removeEventListener('loadedmetadata', sourceChanged);
    binding.video.removeEventListener('emptied', sourceChanged);
    gestures?.dispose(); gestures = null;
    hud?.dispose(); hud = null;
    effects?.dispose(); transform?.dispose(); controls?.dispose();
    nativePlayer?.dispose(); nativePlayer = null;
    effects = null; transform = null; controls = null; binding = null; crop = { ...EMPTY_CROP };
    report();
  };
  let isActive = false;
  let activeObserver: MutationObserver | null = null;
  let dormantObserver: MutationObserver | null = null;
  let disneyObserver: MutationObserver | null = null;
  let observedDisneyRoots: ShadowRoot[] = [];
  let poll = 0;
  let reportTimer = 0;
  let unsubscribe: (() => void) | null = null;
  let removeShortcuts: (() => void) | null = null;

  // Custom elements often attach their shadow root or render its <video> after the
  // insertion record is delivered. Recheck a few such hosts briefly instead of polling.
  const dormantHosts = new Set<Element>();
  let dormantRecheck = 0;
  const cancelDormantRecheck = () => { clearTimeout(dormantRecheck); dormantRecheck = 0; dormantHosts.clear(); };
  const hostHasVideo = (host: Element) => Boolean(host.querySelector('video')
    || (host.shadowRoot && (host.shadowRoot.querySelector('video') || findShadowVideos(host.shadowRoot).length))
    || findShadowVideos(host).length);
  const scheduleDormantRecheck = (step = 0) => {
    const delays = [250, 1000, 3000];
    if (dormantRecheck || step >= delays.length) { if (step >= delays.length) dormantHosts.clear(); return; }
    dormantRecheck = window.setTimeout(() => {
      dormantRecheck = 0;
      if (disposed || isActive || !isContextValid() || !isNotExcludedURL()) { dormantHosts.clear(); return; }
      for (const host of dormantHosts) {
        if (!host.isConnected) { dormantHosts.delete(host); continue; }
        if (hostHasVideo(host)) { cancelDormantRecheck(); wakeUp(); return; }
      }
      if (dormantHosts.size) scheduleDormantRecheck(step + 1);
    }, delays[step]);
  };
  const armDormant = () => {
    if (disposed || isActive || dormantObserver) return;
    dormantObserver = new MutationObserver(records => {
      if (!isContextValid() || disposed || isActive || !isNotExcludedURL()) return;
      let pending = false;
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLVideoElement || (node instanceof Element && (node.querySelector('video') || node.shadowRoot?.querySelector('video')))) {
            cancelDormantRecheck();
            wakeUp();
            return;
          }
          if (node instanceof Element && (node.shadowRoot || node.localName.includes('-')) && dormantHosts.size < 32) {
            dormantHosts.add(node); pending = true;
          }
        }
      }
      if (pending) {
        // New hosts restart the short sequence; earlier hosts get the same extra chances.
        clearTimeout(dormantRecheck); dormantRecheck = 0;
        scheduleDormantRecheck();
      }
    });
    const targetNode = document.body ?? document.documentElement;
    if (targetNode) dormantObserver.observe(targetNode, { childList: true, subtree: true });
  };

  const fallAsleep = () => {
    if (disposed || !isActive) return;
    // Detach while still active so its terminal available:false report reaches the worker.
    detach();
    isActive = false;
    ready = false;
    readyPromise = null;
    if (poll) { clearInterval(poll); poll = 0; }
    if (reportTimer) { clearInterval(reportTimer); reportTimer = 0; }
    if (scheduled) { clearTimeout(scheduled); scheduled = 0; }
    if (siteSaveTimer) { clearTimeout(siteSaveTimer); siteSaveTimer = 0; }
    activeObserver?.disconnect(); activeObserver = null;
    disneyObserver?.disconnect(); disneyObserver = null; observedDisneyRoots = [];
    try { removeShortcuts?.(); } catch {} removeShortcuts = null;
    try { unsubscribe?.(); } catch {} unsubscribe = null;
    armDormant();
  };

  const wakeUp = () => {
    if (disposed || isActive || !isContextValid()) return;
    isActive = true;
    dormantObserver?.disconnect(); dormantObserver = null;
    cancelDormantRecheck();

    unsubscribe = subscribeSettings(hostname, (next, epoch, cleared) => {
      settingsRevision++;
      if (cleared) discardPendingSave();
      if (localSettingsDirty) return;
      settingsEpoch = epoch;
      // A site that does not remember framing keeps this page's live framing when
      // unrelated storage writes (other tabs, global edits) arrive.
      if (!cleared && next.rememberSiteState === false) {
        const live: Partial<Settings> = {};
        for (const key of FRAMING_KEYS) (live as Record<string, unknown>)[key] = settings[key];
        next = { ...next, ...live };
      }
      applyRuntimeSettings(next);
      if (cleared) { crop = { ...EMPTY_CROP }; effects?.reset(); }
      if (ready) update();
    }, currentBucket);
    const initialRevision = settingsRevision;
    readyPromise = loadSettingsSnapshot(hostname, currentBucket()).then(next => {
      if (!disposed && isContextValid() && isActive) {
        if (settingsRevision === initialRevision) {
          discardPendingSave();
          settingsEpoch = next.epoch;
          applyRuntimeSettings(next.settings);
        }
        ready = true;
        discover();
      }
    }).catch(err => {
      if (isContextInvalidationError(err)) markContextInvalid();
      if (!disposed && isActive) { ready = true; discover(); }
    });

    const targetNode = document.body ?? document.documentElement;
    activeObserver = new MutationObserver(records => {
      if (document.hidden || !isContextValid() || disposed || !isActive) return;
      if (records.some(record => !isOwnedNode(record.target)
        && [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && !isOwnedNode(node)))) {
        schedule();
      }
    });
    if (targetNode) activeObserver.observe(targetNode, { childList: true, subtree: true });
    syncDisneyControlObserver();

    poll = window.setInterval(() => {
      if (!isContextValid()) { teardown(); return; }
      if (!document.hidden && isActive) {
        checkScreenChange();
        transform?.refresh();
        schedule();
      }
    }, 1500);

    reportTimer = window.setInterval(() => {
      if (!isContextValid()) { teardown(); return; }
      if (!document.hidden && isActive && binding) report();
    }, 5000);

    removeShortcuts = attachShortcuts(value => {
      if (!isActive) wakeUp();
      if (ready && binding) {
        action(value);
      } else {
        discover();
        if (binding) action(value);
      }
    });

    discover();
  };

  const discover = () => {
    scheduled = 0;
    if (disposed || !ready || !isContextValid() || !isActive) return;
    syncDisneyControlObserver();
    const currentVideo = binding ? binding.video : null;
    const video = selectVideo(currentVideo, settings.videoFinderMode);
    if (video === currentVideo) {
      if (!video) {
        // Excluded routes (e.g. feeds with hover previews) sleep even if preview videos remain.
        if (!isNotExcludedURL() || !document.querySelector('video')) fallAsleep();
        return;
      }
      const fresh = bindPlayer(video, binding!);
      const viewportChanged = fresh.viewport !== binding!.viewport;
      const controlsChanged = fresh.controls !== binding!.controls || fresh.controlBefore !== binding!.controlBefore
        || fresh.controlAnchor !== binding!.controlAnchor || fresh.adapter !== binding!.adapter;
      if (!viewportChanged && !controlsChanged) {
        transform?.refresh();
        update();
        return;
      }
      binding = fresh;
      if (viewportChanged) {
        nativePlayer?.rebind(fresh);
        transform?.rebind(fresh);
        gestures?.dispose(); gestures = null;
        hud?.rebind(fresh);
        geometryObserver?.disconnect();
        geometryObserver = new ResizeObserver(() => update());
        geometryObserver.observe(fresh.viewport);
        geometryObserver.observe(fresh.video);
        const savedCrop = { ...crop };
        if (effects) { effects.dispose(); effects = null; }
        crop = savedCrop;
      }
      if (controlsChanged || viewportChanged) {
        controls?.rebind(fresh);
      }
      update();
      if (viewportChanged && effects) effects.setCrop(crop);
      return;
    }
    detach();
    if (video) {
      attach(bindPlayer(video));
    } else {
      status = { source: 'idle', message: i18n.t('status_no_visible_video') };
      if (!isNotExcludedURL() || !document.querySelector('video')) fallAsleep();
    }
  };

  const attach = (next: PlayerBinding) => {
    binding = next;
    next.video.addEventListener('loadedmetadata', sourceChanged);
    next.video.addEventListener('emptied', sourceChanged);
    status = { source: 'idle', message: i18n.t('status_manual_available') };
    controls = createControls(next, { patch, reset, resetPan, action, activate,
      saveSite: () => { void save('site', true); },
      saveGlobal: () => { void save('global'); },
    });
    geometryObserver = new ResizeObserver(() => update());
    geometryObserver.observe(next.viewport); geometryObserver.observe(next.video);
    update();
    report();
  };

  const schedule = (immediate = false) => {
    if (disposed || !isContextValid() || !isActive) return;
    if (scheduled) {
      if (!immediate) return;
      clearTimeout(scheduled);
    }
    scheduled = window.setTimeout(discover, immediate ? 0 : 200);
  };
  const isOwnedNode = (node: Node) => node instanceof Element
    && (node.matches('.jz-controls-host,.jz-native-player,[data-just-zoom="ambience"]') || !!node.closest('.jz-controls-host,.jz-native-player'));
  const syncDisneyControlObserver = () => {
    if (!/(^|\.)disneyplus\.com$/.test(hostname)) return;
    const roots = disneyControlRoots();
    if (roots.length === observedDisneyRoots.length && roots.every((root, index) => root === observedDisneyRoots[index])) return;
    disneyObserver?.disconnect();
    observedDisneyRoots = roots;
    if (!roots.length) return;
    disneyObserver ??= new MutationObserver(records => {
      if (document.hidden || disposed || !isActive) return;
      const changed = records.some(record => [...record.addedNodes, ...record.removedNodes].some(node =>
        node instanceof Element && !isOwnedNode(node)
        && (node.matches('main-app-controls-overlay,.controls-container,.experience-controls,toggle-fullscreen')
          || !!node.querySelector('main-app-controls-overlay,.controls-container,.experience-controls,toggle-fullscreen'))));
      if (changed) schedule(true);
    });
    for (const root of roots) disneyObserver.observe(root, { childList: true, subtree: true });
  };

  let lastReportedAvailable = false;
  const report = () => {
    if (disposed || !isContextValid() || !isActive) return;
    const isAvailable = Boolean(binding && !disposed);
    if (!isAvailable && !lastReportedAvailable) return;
    lastReportedAvailable = isAvailable;
    try {
      const rect = binding?.video.getBoundingClientRect();
      const area = rect ? Math.max(0, Math.min(rect.right, innerWidth) - Math.max(0, rect.left)) * Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(0, rect.top)) : 0;
      void chrome.runtime.sendMessage({
        type: 'JZ_FRAME_STATUS',
        available: isAvailable,
        score: disposed || !binding ? 0 : area * (binding.video.paused ? 1 : 3),
      }).catch(err => {
        if (isContextInvalidationError(err)) {
          markContextInvalid();
          teardown();
        }
      });
    } catch (err) {
      if (isContextInvalidationError(err)) {
        markContextInvalid();
        teardown();
      }
    }
  };

  const onPlay = () => {
    if (!isContextValid() || disposed) return;
    if (!isActive) { if (isNotExcludedURL()) wakeUp(); }
    else schedule();
  };

  const onWake = () => {
    if (!isContextValid() || disposed) return;
    if (!document.hidden) {
      if (!isActive) {
        if (document.querySelector('video')) wakeUp();
      } else {
        discover();
        transform?.refresh();
        if (binding) report();
      }
    }
  };

  const onFullscreenChange = () => {
    if (!isContextValid() || disposed) return;
    if (isActive) schedule();
    else if (document.querySelector('video')) wakeUp();
  };

  const onResize = () => {
    if (!isContextValid() || disposed) return;
    if (isActive && !document.hidden) {
      checkScreenChange();
      schedule();
    }
  };

  document.addEventListener('play', onPlay, true);
  document.addEventListener('visibilitychange', onWake);
  window.addEventListener('focus', onWake);
  window.addEventListener('pageshow', onWake);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  window.addEventListener('resize', onResize);

  const HANDLED_MESSAGES = new Set([
    'JZ_GET_STATE', 'JZ_PATCH', 'JZ_RESET', 'JZ_RESET_PAN', 'JZ_TOGGLE',
    'JZ_ACTION', 'JZ_ACTIVATE', 'JZ_SAVE_SITE', 'JZ_SAVE_GLOBAL',
    'JZ_CLEAR_SITE', 'JZ_CLEAR_ALL',
  ]);

  const onMessage = (message: unknown, _sender: chrome.runtime.MessageSender, respond: (response: unknown) => void) => {
    if (!message || typeof message !== 'object' || !('type' in message)) return;
    const msg = message as { type: string; patch?: Partial<Settings>; action?: ZoomAction };
    if (!HANDLED_MESSAGES.has(msg.type)) return;

    if (!isActive && (document.querySelector('video') || msg.type === 'JZ_ACTIVATE' || msg.type === 'JZ_PATCH' || msg.type === 'JZ_ACTION' || msg.type === 'JZ_GET_STATE')) {
      wakeUp();
    }
    void (async () => {
      if (!ready && readyPromise) await readyPromise;
      if (isActive) {
        discover();
        transform?.refresh();
      }
      if (msg.type === 'JZ_GET_STATE') respond(snapshot());
      else if (msg.type === 'JZ_PATCH') { patch(msg.patch ?? {}); respond(snapshot()); }
      else if (msg.type === 'JZ_RESET') { reset(); respond(snapshot()); }
      else if (msg.type === 'JZ_RESET_PAN') { resetPan(); respond(snapshot()); }
      else if (msg.type === 'JZ_TOGGLE') { controls?.toggle(); respond(snapshot()); }
      else if (msg.type === 'JZ_ACTION' && msg.action) { action(msg.action); respond(snapshot()); }
      else if (msg.type === 'JZ_ACTIVATE') { activate(); respond(snapshot()); }
      else if (msg.type === 'JZ_SAVE_SITE') { await save('site', true); respond(snapshot()); }
      else if (msg.type === 'JZ_SAVE_GLOBAL') { await save('global'); respond(snapshot()); }
      else if (msg.type === 'JZ_CLEAR_SITE') {
        await clear('site');
        respond(snapshot());
      }
      else if (msg.type === 'JZ_CLEAR_ALL') {
        await clear('all');
        respond(snapshot());
      }
    })().catch(error => {
      const message = error instanceof Error ? error.message : 'Could not update preferences. Please try again.';
      if (!disposed) { status = { ...status, message }; updateControls(); }
      respond({ error: message });
    });
    return true;
  };
  chrome.runtime.onMessage.addListener(onMessage);

  const onNavigate = () => {
    if (!isContextValid() || disposed) return;
    if (!isActive) {
      if (document.querySelector('video') && isNotExcludedURL()) wakeUp();
    } else {
      schedule();
    }
  };
  window.addEventListener('popstate', onNavigate);
  document.addEventListener('yt-navigate-finish', onNavigate);



  // Initial startup: check if video element already exists in document
  if (document.querySelector('video') && isNotExcludedURL()) {
    wakeUp();
  } else {
    armDormant();
  }

  const teardown = () => {
    if (disposed) return;
    disposed = true;
    isActive = false;
    clearTimeout(scheduled); scheduled = 0;
    clearTimeout(siteSaveTimer); siteSaveTimer = 0;
    if (poll) { clearInterval(poll); poll = 0; }
    if (reportTimer) { clearInterval(reportTimer); reportTimer = 0; }
    dormantObserver?.disconnect(); dormantObserver = null; cancelDormantRecheck();
    activeObserver?.disconnect(); activeObserver = null;
    disneyObserver?.disconnect(); disneyObserver = null; observedDisneyRoots = [];
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('play', onPlay, true);
    document.removeEventListener('visibilitychange', onWake);
    window.removeEventListener('focus', onWake);
    window.removeEventListener('pageshow', onWake);
    window.removeEventListener('popstate', onNavigate);
    document.removeEventListener('yt-navigate-finish', onNavigate);
    try { removeShortcuts?.(); } catch { /* context invalidated */ } removeShortcuts = null;
    try { unsubscribe?.(); } catch { /* context invalidated */ } unsubscribe = null;
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch { /* context invalidated */ }
    report();
    detach();
  };
  return teardown;
}
