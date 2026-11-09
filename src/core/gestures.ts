import type { GestureModifier, PlayerBinding, Settings } from '../shared/types';
import { debugCount } from '../shared/debug';
import { automaticZoomFactor } from './eligibility';

export interface GesturesHandlers {
  getSettings: () => Settings;
  onPan: (panX: number, panY: number) => void;
  onZoom: (zoom: number) => void;
}

export interface GesturesController {
  dispose: () => void;
}

function isModifierPressed(event: MouseEvent | KeyboardEvent | WheelEvent, modifier: GestureModifier): boolean {
  switch (modifier) {
    case 'alt': return event.altKey;
    case 'ctrl': return event.ctrlKey;
    case 'shift': return event.shiftKey;
    case 'meta': return event.metaKey;
    default: return event.altKey;
  }
}

const INTERACTIVE = 'button, input, select, textarea, [role="button"], [role="slider"], [role="menuitem"], .jz-controls-host, [data-just-zoom="controls"]';
const OWN_SURFACE_HOSTS = '.jz-native-controls-host, .jz-hud-host';

export function attachGestures(binding: PlayerBinding, handlers: GesturesHandlers): GesturesController {
  const { viewport, video } = binding;
  let isDragging = false;
  let pointerId = -1;
  let startX = 0;
  let startY = 0;
  let startPanX = 0;
  let startPanY = 0;
  let boxWidth = 1920;
  let boxHeight = 1080;
  let suppressClick = false;
  let clickTimeout = 0;

  // Cursor claims follow the transform engine's ownership rule: snapshot the page's
  // inline declaration, and restore it only while our written value is still present.
  const cursorClaims = new Map<HTMLElement, { original: string; priority: string; written: string }>();
  const claimCursor = (el: HTMLElement, value: string) => {
    const current = el.style.getPropertyValue('cursor'), priority = el.style.getPropertyPriority('cursor');
    let saved = cursorClaims.get(el);
    if (!saved) cursorClaims.set(el, saved = { original: current, priority, written: '' });
    else if (current !== saved.written || priority !== 'important') { saved.original = current; saved.priority = priority; }
    el.style.setProperty('cursor', value, 'important');
    saved.written = el.style.getPropertyValue('cursor');
  };
  const releaseCursor = (el: HTMLElement) => {
    const saved = cursorClaims.get(el);
    if (!saved) return;
    cursorClaims.delete(el);
    if (el.style.getPropertyValue('cursor') !== saved.written || el.style.getPropertyPriority('cursor') !== 'important') return;
    if (saved.original) el.style.setProperty('cursor', saved.original, saved.priority);
    else el.style.removeProperty('cursor');
  };
  const updateCursor = (cursor: 'grab' | 'grabbing' | '') => {
    if (cursor === 'grabbing') {
      claimCursor(document.documentElement, 'grabbing');
      claimCursor(viewport, 'grabbing');
    } else if (cursor === 'grab') {
      // Covering layers outside the viewport keep their own cursor; the root claim is drag-only.
      releaseCursor(document.documentElement);
      claimCursor(viewport, 'grab');
    } else {
      releaseCursor(document.documentElement);
      releaseCursor(viewport);
    }
  };

  // Listeners live on the window in the capture phase rather than on the viewport:
  // many players stack their click/hover layers as siblings of the video's parent
  // (outside our viewport) or stop propagation before the event reaches it, which
  // made Alt+drag/wheel silently do nothing. A gesture qualifies when its path goes
  // through the viewport, or when it lands inside the viewport box on a covering layer.
  const inViewportBox = (x: number, y: number) => {
    const rect = viewport.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  };
  const targetsPlayer = (event: MouseEvent, allowInteractive: boolean) => {
    // composedPath reaches into open shadow roots, where window-level targets are retargeted.
    const path = event.composedPath();
    const inside = path.includes(viewport);
    if (!inside && !inViewportBox(event.clientX, event.clientY)) return false;
    if (allowInteractive) return true;
    for (const node of path) {
      if (node === viewport) break;
      if (!(node instanceof Element)) continue;
      // The native-player skin covers the whole video with an open-shadow host; only its
      // control bar is interactive, its click surface is the video for gesture purposes.
      if (node.matches(OWN_SURFACE_HOSTS)) continue;
      const root = node.getRootNode();
      if (root instanceof ShadowRoot && root.host.matches('.jz-native-controls-host') && node.matches('.jz-bar')) return false;
      if (node.matches(INTERACTIVE)) return false;
      // Links in a covering layer outside the player (sticky headers, page chrome) are not ours.
      if (!inside && node.matches('a[href]')) return false;
    }
    return true;
  };
  const gestureSettings = () => {
    const settings = handlers.getSettings();
    return settings.enabled && settings.gesturesEnabled !== false ? settings : null;
  };

  let lastX = Number.NaN;
  let lastY = Number.NaN;
  let cursorShown = false;
  // A gesture performed during the current Alt hold. On Windows a bare Alt release
  // otherwise moves focus to Chrome's app menu, which swallows the next key/wheel input
  // and makes the following Alt gesture appear dead.
  let usedDuringHold = false;
  const pointerOverPlayer = () => Number.isFinite(lastX) && inViewportBox(lastX, lastY);

  const refreshHoverCursor = (show: boolean) => {
    if (isDragging || show === cursorShown) return;
    cursorShown = show;
    updateCursor(show ? 'grab' : '');
  };

  const finishDrag = (suppressTrailingClick = true) => {
    if (!isDragging) return;
    isDragging = false;

    if (pointerId !== -1) {
      try {
        if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
      } catch {
        // Ignore
      }
      pointerId = -1;
    }

    cursorShown = false;
    updateCursor('');

    // Any modifier press on the player is a gesture, moved or not: its trailing click must not
    // reach the site's click-to-play surface.
    if (!suppressTrailingClick) return;
    suppressClick = true;
    clearTimeout(clickTimeout);
    clickTimeout = window.setTimeout(() => {
      suppressClick = false;
    }, 80);
  };

  const onKeyChange = (event: KeyboardEvent) => {
    const settings = gestureSettings();
    if (!settings) { refreshHoverCursor(false); return; }
    if (event.key === 'Alt' && settings.gestureModifier === 'alt') {
      if (event.type === 'keydown') {
        if (!event.repeat) usedDuringHold = false;
      } else {
        if (usedDuringHold || pointerOverPlayer()) {
          debugCount('gestureAltMenuBlocked');
          event.preventDefault();
        }
        usedDuringHold = false;
      }
    }
    const pressed = isModifierPressed(event, settings.gestureModifier);
    refreshHoverCursor(pressed && pointerOverPlayer());
  };

  const onPointerDown = (event: PointerEvent) => {
    lastX = event.clientX; lastY = event.clientY;
    if (event.button !== 0) return;
    // A new press from the dragging pointer means its pointerup was lost (e.g. released over
    // browser UI with no capture and no move since); otherwise the next move would resume
    // the old drag from its stale start point.
    if (isDragging) {
      if (event.pointerId !== pointerId) return;
      finishDrag(false);
    }
    const settings = gestureSettings();
    if (!settings || !isModifierPressed(event, settings.gestureModifier)) return;
    debugCount('gestureDownModifier');
    if (!targetsPlayer(event, false)) return;
    debugCount('gestureDragStart');

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    isDragging = true;
    usedDuringHold = true;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startPanX = settings.panX;
    startPanY = settings.panY;

    const rect = viewport.getBoundingClientRect();
    boxWidth = rect.width || video.videoWidth || 1920;
    boxHeight = rect.height || video.videoHeight || 1080;

    try {
      viewport.setPointerCapture(pointerId);
    } catch {
      // Window-level move/up listeners keep the drag alive without capture.
    }

    cursorShown = true;
    updateCursor('grabbing');
  };

  const onPointerMove = (event: PointerEvent) => {
    lastX = event.clientX; lastY = event.clientY;
    if (!isDragging) {
      // Only read layout while the modifier is held or our cursor is showing.
      const settings = gestureSettings();
      if (settings && isModifierPressed(event, settings.gestureModifier)) refreshHoverCursor(targetsPlayer(event, false));
      else if (cursorShown) refreshHoverCursor(false);
      return;
    }
    if (event.pointerId !== pointerId) return;
    // A release outside the window without capture never delivers pointerup.
    if (!gestureSettings() || (event.buttons & 1) === 0) { finishDrag(); return; }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    let nextPanX = startPanX + (deltaX / boxWidth);
    let nextPanY = startPanY + (deltaY / boxHeight);
    nextPanX = Math.max(-1, Math.min(1, Math.round(nextPanX * 1000) / 1000));
    nextPanY = Math.max(-1, Math.min(1, Math.round(nextPanY * 1000) / 1000));

    handlers.onPan(nextPanX, nextPanY);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!isDragging || event.pointerId !== pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    finishDrag();
  };

  const onPointerCancel = (event: PointerEvent) => {
    if (!isDragging || event.pointerId !== pointerId) return;
    debugCount('gestureDragCancel');
    finishDrag();
  };

  const onClickCapture = (event: MouseEvent) => {
    // A quick second modifier press would otherwise reach the player's double-click fullscreen.
    const settings = event.type === 'dblclick' ? gestureSettings() : null;
    if (settings && isModifierPressed(event, settings.gestureModifier) && targetsPlayer(event, false)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
    if (event.type === 'click' && suppressClick) {
      suppressClick = false;
      clearTimeout(clickTimeout);
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  };

  // Fractional zoom carried between wheel events. Rounding every event to 0.01 from the
  // stored factor turned small precision-touchpad/high-resolution-wheel deltas into no-ops.
  let wheelZoom = Number.NaN;
  let wheelEmitted = Number.NaN;
  const onWheel = (event: WheelEvent) => {
    lastX = event.clientX; lastY = event.clientY;
    const settings = gestureSettings();
    if (!settings || !isModifierPressed(event, settings.gestureModifier)) return;
    debugCount('gestureWheelModifier');
    if (!targetsPlayer(event, true)) return;
    debugCount('gestureWheel');

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    usedDuringHold = true;

    // Shift+wheel arrives as horizontal scroll on Windows/Linux.
    let delta = event.deltaY || event.deltaX;
    if (event.deltaMode === 1) delta *= 33;
    else if (event.deltaMode === 2) delta *= 100;
    if (Math.abs(delta) < 0.1) return;

    const manual = settings.zoomApplied && settings.zoomStrategy === 'manual';
    const currentZoom = manual
      ? settings.zoom
      : (settings.autoCrop ? 1 : automaticZoomFactor(settings.displayProfile, settings.customDisplayAspectRatio));
    if (!Number.isFinite(wheelZoom) || currentZoom !== wheelEmitted) wheelZoom = currentZoom;
    wheelZoom = Math.max(0.34, Math.min(3.0, wheelZoom * Math.exp(-delta * 0.001)));
    const nextZoom = Math.round(wheelZoom * 100) / 100;
    wheelEmitted = nextZoom;
    if (manual && nextZoom === currentZoom) return;
    handlers.onZoom(nextZoom);
  };

  const resetTransient = () => {
    lastX = Number.NaN; lastY = Number.NaN;
    usedDuringHold = false;
    if (isDragging) finishDrag();
    cursorShown = false;
    updateCursor('');
  };
  const onVisibility = () => { if (document.hidden) resetTransient(); };

  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('pointercancel', onPointerCancel, true);
  window.addEventListener('lostpointercapture', onPointerCancel, true);
  window.addEventListener('wheel', onWheel, { passive: false, capture: true });
  window.addEventListener('click', onClickCapture, true);
  window.addEventListener('dblclick', onClickCapture, true);
  window.addEventListener('keydown', onKeyChange, true);
  window.addEventListener('keyup', onKeyChange, true);
  window.addEventListener('blur', resetTransient);
  document.addEventListener('visibilitychange', onVisibility);
  // Fullscreen transitions drop pointer capture and can swallow the matching pointerup.
  document.addEventListener('fullscreenchange', resetTransient);

  return {
    dispose: () => {
      clearTimeout(clickTimeout);
      resetTransient();
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerCancel, true);
      window.removeEventListener('lostpointercapture', onPointerCancel, true);
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('dblclick', onClickCapture, true);
      window.removeEventListener('keydown', onKeyChange, true);
      window.removeEventListener('keyup', onKeyChange, true);
      window.removeEventListener('blur', resetTransient);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('fullscreenchange', resetTransient);
    },
  };
}
