import type { GestureModifier, PlayerBinding, Settings } from '../shared/types';
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

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('button, input, select, textarea, [role="button"], [role="slider"], [role="menuitem"], .jz-controls-host, [data-just-zoom="controls"]'));
}

export function attachGestures(binding: PlayerBinding, handlers: GesturesHandlers): GesturesController {
  const { viewport, video } = binding;
  let isHovering = false;
  let isDragging = false;
  let hasDragged = false;
  let pointerId = -1;
  let startX = 0;
  let startY = 0;
  let startPanX = 0;
  let startPanY = 0;
  let boxWidth = 1920;
  let boxHeight = 1080;
  let suppressClick = false;
  let clickTimeout = 0;

  const updateCursor = (cursor: 'grab' | 'grabbing' | '') => {
    if (cursor === 'grabbing') {
      document.documentElement.style.setProperty('cursor', 'grabbing', 'important');
      viewport.style.setProperty('cursor', 'grabbing', 'important');
    } else if (cursor === 'grab') {
      document.documentElement.style.removeProperty('cursor');
      viewport.style.setProperty('cursor', 'grab', 'important');
    } else {
      document.documentElement.style.removeProperty('cursor');
      viewport.style.removeProperty('cursor');
    }
  };

  const onPointerEnter = (event: PointerEvent) => {
    isHovering = true;
    const settings = handlers.getSettings();
    if (!settings.enabled || settings.gesturesEnabled === false) return;
    if (isModifierPressed(event, settings.gestureModifier) && !isInteractiveTarget(event.target)) {
      updateCursor('grab');
    }
  };

  const onPointerLeave = () => {
    isHovering = false;
    if (!isDragging) updateCursor('');
  };

  const onKeyChange = (event: KeyboardEvent) => {
    if (isDragging) return;
    const settings = handlers.getSettings();
    if (!settings.enabled || settings.gesturesEnabled === false) return;
    if (isHovering && isModifierPressed(event, settings.gestureModifier)) {
      updateCursor('grab');
    } else if (!isModifierPressed(event, settings.gestureModifier)) {
      updateCursor('');
    }
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const settings = handlers.getSettings();
    if (!settings.enabled || settings.gesturesEnabled === false) return;
    if (!isModifierPressed(event, settings.gestureModifier)) return;
    if (isInteractiveTarget(event.target)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    isDragging = true;
    hasDragged = false;
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
      // Ignore browsers/elements that reject pointer capture
    }

    updateCursor('grabbing');
  };

  const onPointerMove = (event: PointerEvent) => {
    const settings = handlers.getSettings();
    if (!settings.enabled || settings.gesturesEnabled === false) {
      if (isDragging) finishDrag();
      return;
    }

    if (!isDragging) {
      if (isHovering) {
        if (isModifierPressed(event, settings.gestureModifier) && !isInteractiveTarget(event.target)) {
          updateCursor('grab');
        } else {
          updateCursor('');
        }
      }
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    if (Math.hypot(deltaX, deltaY) > 2) {
      hasDragged = true;
    }

    let nextPanX = startPanX + (deltaX / boxWidth);
    let nextPanY = startPanY + (deltaY / boxHeight);
    nextPanX = Math.max(-1, Math.min(1, Math.round(nextPanX * 1000) / 1000));
    nextPanY = Math.max(-1, Math.min(1, Math.round(nextPanY * 1000) / 1000));

    handlers.onPan(nextPanX, nextPanY);
  };

  const finishDrag = () => {
    if (!isDragging) return;
    isDragging = false;

    if (pointerId !== -1) {
      try {
        viewport.releasePointerCapture(pointerId);
      } catch {
        // Ignore
      }
      pointerId = -1;
    }

    const settings = handlers.getSettings();
    if (isHovering && settings.enabled && settings.gesturesEnabled !== false && settings.gestureModifier) {
      updateCursor('grab');
    } else {
      updateCursor('');
    }

    if (hasDragged) {
      suppressClick = true;
      clearTimeout(clickTimeout);
      clickTimeout = window.setTimeout(() => {
        suppressClick = false;
      }, 80);
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!isDragging) return;
    event.preventDefault();
    event.stopPropagation();
    finishDrag();
  };

  const onPointerCancel = () => {
    if (!isDragging) return;
    finishDrag();
  };

  const onClickCapture = (event: MouseEvent) => {
    if (suppressClick) {
      suppressClick = false;
      clearTimeout(clickTimeout);
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  };

  const onWheel = (event: WheelEvent) => {
    const settings = handlers.getSettings();
    if (!settings.enabled || settings.gesturesEnabled === false) return;
    if (!isModifierPressed(event, settings.gestureModifier)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    let delta = event.deltaY;
    if (event.deltaMode === 1) delta *= 33;
    else if (event.deltaMode === 2) delta *= 100;
    if (Math.abs(delta) < 0.1) return;

    const factorRatio = Math.exp(-delta * 0.001);
    const currentZoom = (settings.zoomApplied && settings.zoomStrategy === 'manual')
      ? settings.zoom
      : (settings.autoCrop ? 1 : automaticZoomFactor(settings.displayProfile, settings.customDisplayAspectRatio));
    let nextZoom = currentZoom * factorRatio;
    nextZoom = Math.max(0.34, Math.min(3.0, Math.round(nextZoom * 100) / 100));

    handlers.onZoom(nextZoom);
  };

  const onWindowBlur = () => {
    isHovering = false;
    if (isDragging) finishDrag();
    updateCursor('');
  };

  viewport.addEventListener('pointerenter', onPointerEnter);
  viewport.addEventListener('pointerleave', onPointerLeave);
  viewport.addEventListener('pointerdown', onPointerDown, { capture: true });
  viewport.addEventListener('pointermove', onPointerMove, { capture: true });
  viewport.addEventListener('pointerup', onPointerUp, { capture: true });
  viewport.addEventListener('pointercancel', onPointerCancel, { capture: true });
  viewport.addEventListener('lostpointercapture', onPointerCancel);
  viewport.addEventListener('wheel', onWheel, { passive: false, capture: true });
  window.addEventListener('click', onClickCapture, { capture: true });
  window.addEventListener('keydown', onKeyChange);
  window.addEventListener('keyup', onKeyChange);
  window.addEventListener('blur', onWindowBlur);

  return {
    dispose: () => {
      clearTimeout(clickTimeout);
      if (isDragging) finishDrag();
      updateCursor('');
      viewport.removeEventListener('pointerenter', onPointerEnter);
      viewport.removeEventListener('pointerleave', onPointerLeave);
      viewport.removeEventListener('pointerdown', onPointerDown, true);
      viewport.removeEventListener('pointermove', onPointerMove, true);
      viewport.removeEventListener('pointerup', onPointerUp, true);
      viewport.removeEventListener('pointercancel', onPointerCancel, true);
      viewport.removeEventListener('lostpointercapture', onPointerCancel);
      viewport.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('keydown', onKeyChange);
      window.removeEventListener('keyup', onKeyChange);
      window.removeEventListener('blur', onWindowBlur);
    },
  };
}
