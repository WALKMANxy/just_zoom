import type {
  ControlsHandlers,
  FeatureStatus,
  PlayerBinding,
  PlayerControls,
  Settings,
} from '../shared/types';
import { isContextValid } from '../shared/storage';
import { portraitBlocked } from '../core/eligibility';
import { createDisneyPointerExclusion } from '../core/adapters';
import { formatModifier } from '../shared/shortcuts';

const EVENT_TYPES = [
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'click',
  'wheel',
  'keydown',
  'keyup',
] as const;

const ICON_OPPOSING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4.5L3.5 12L9 19.5"/><path d="M15 4.5L20.5 12L15 19.5"/></svg>';
const ICON_FACING = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4.5L9.5 12L4 19.5"/><path d="M20 4.5L14.5 12L20 19.5"/></svg>';

const STYLE = `
  :host { all: initial; }
  :host([hidden]) { display: none !important; }
  *, *::before, *::after { box-sizing: border-box; }
  button {
    appearance: none;
    border: 1px solid rgba(255, 255, 255, .28);
    border-radius: 8px;
    background: #202124;
    color: #f5f5f5;
    cursor: pointer;
    font: 600 12px/1 system-ui, sans-serif;
  }
  button:hover { background: #303134; }
  button:disabled { opacity: .4; cursor: default; }
  button:disabled:hover { background: #232427; }
  button:focus-visible { outline: 2px solid #d7d7d7; outline-offset: 2px; }
  :host(.native-host) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    align-self: center;
    flex: 0 0 auto;
    vertical-align: middle;
  }
  .native-button {
    width: 100%;
    height: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 0;
    color: #fff;
    opacity: 1;
    padding: 0;
    cursor: pointer;
    transition: opacity .15s ease, transform .15s ease;
  }
  .native-button svg {
    display: block;
    width: var(--jz-icon-size, 20px);
    height: var(--jz-icon-size, 20px);
    stroke: currentColor;
    fill: none;
  }
  .native-button:hover {
    background: transparent;
    opacity: 1;
  }
  .native-button:focus-visible {
    outline: 2px solid #fff;
    outline-offset: -2px;
  }
  :host(.is-netflix) .native-button {
    transition: transform 150ms ease;
    transform-origin: center center;
    will-change: transform;
  }
  :host(.is-netflix:hover) .native-button,
  :host(.is-netflix) .native-button:focus-visible {
    transform: scale(1.3);
  }
  :host(.is-netflix) .native-button:active {
    transform: scale(1.15);
  }
  .jz-disney-tooltip {
    display: none;
  }
  :host(.is-disney) .jz-disney-tooltip {
    position: absolute;
    bottom: calc(100% + 14px);
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 7px 12px;
    background: #000;
    color: #fff;
    border-radius: 4px;
    font-family: Inspire, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    font-weight: 700;
    line-height: 14px;
    letter-spacing: normal;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    transition: opacity .15s ease, visibility .15s ease;
    z-index: 1000;
    box-shadow: 0 2px 8px rgba(0, 0, 0, .5);
  }
  :host(.is-disney) .jz-disney-tooltip-arrow {
    position: absolute;
    bottom: -4px;
    left: 50%;
    width: 8px;
    height: 8px;
    background: #000;
    transform: translateX(-50%) rotate(45deg);
    pointer-events: none;
  }
  :host(.is-disney:hover:not([data-suppressed])) .jz-disney-tooltip,
  :host(.is-disney) .native-button:focus-visible ~ .jz-disney-tooltip {
    opacity: 1;
    visibility: visible;
  }
  .panel-action svg { width: 18px; height: 18px; }
  .floating-button {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: #171717;
    box-shadow: 0 2px 12px rgba(0, 0, 0, .42);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .floating-button svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.8; }
  :host(.floating-host) {
    position: fixed;
    width: 34px;
    height: 34px;
    z-index: 2147483646;
    pointer-events: none;
    contain: layout style;
  }
  .floating-surface {
    position: relative;
    width: 34px;
    height: 34px;
    opacity: 1;
    pointer-events: auto;
    transition: opacity .16s ease;
    will-change: opacity;
  }
  .floating-surface.is-concealed { opacity: 0; pointer-events: none; }
  .panel {
    position: absolute;
    right: calc(100% + 8px);
    top: 50%;
    width: min(200px, calc(100vw - 58px));
    padding: 10px;
    border: 1px solid rgba(255, 255, 255, .2);
    border-radius: 10px;
    background: #171717;
    box-shadow: 0 8px 28px rgba(0, 0, 0, .48);
    color: #eee;
    font: 12px/1.35 system-ui, sans-serif;
    transform: translateY(-50%);
  }
  .panel[hidden] { display: none; }
  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin: 1px 2px 8px;
    color: #c9c9c9;
    font-size: 11px;
  }
  .panel-factor {
    font-weight: 600;
    color: #fff;
  }
  .panel-action {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    min-height: 32px;
    margin-top: 6px;
    padding: 0 9px;
  }
  .panel-section-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .5px;
    color: #9c9ca4;
    margin: 8px 1px 3px;
    font-weight: 600;
  }
  .panel-presets {
    display: flex;
    gap: 4px;
    margin: 3px 0 6px;
  }
  .panel-preset {
    flex: 1;
    min-height: 26px;
    padding: 2px 0;
    font-size: 11px;
    text-align: center;
    border: 1px solid rgba(255, 255, 255, .2);
    border-radius: 5px;
    background: #232427;
    color: #eee;
    font-weight: 600;
    cursor: pointer;
    transition: background .15s ease, color .15s ease, border-color .15s ease;
  }
  .panel-preset:hover, .panel-toggle:hover { background: #35363b; }
  .panel-preset[aria-pressed="true"], .panel-toggle[aria-pressed="true"] {
    background: #e6eefc !important;
    color: #0a0e16 !important;
    font-weight: 700 !important;
    border-color: #fff !important;
  }
  .panel-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 28px;
    margin: 4px 0;
    padding: 0 9px;
    font-size: 11px;
    font-weight: 600;
    border: 1px solid rgba(255, 255, 255, .2);
    border-radius: 5px;
    background: #232427;
    color: #eee;
    cursor: pointer;
    transition: background .15s ease, color .15s ease, border-color .15s ease;
  }
  .panel-settings {
    display: block;
    width: 100%;
    min-height: 26px;
    margin-top: 4px;
    padding: 0 9px;
    text-align: left;
    background: transparent;
    border-color: rgba(255, 255, 255, .15);
    color: #bbb;
    font-size: 11px;
  }
  .panel-settings:hover { background: #242528; color: #eee; }
  .panel-tip {
    margin: 6px 0 2px;
    padding: 0 4px;
    font-size: 10px;
    line-height: 1.35;
    color: #888;
    text-align: center;
    user-select: none;
  }
`;

function makeButton(label: string, action: string, className = ''): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.dataset.action = action;
  button.className = className;
  return button;
}

function isNativeAnchor(binding: PlayerBinding): binding is PlayerBinding & {
  controls: HTMLElement;
  controlBefore: Element;
} {
  return Boolean(
    binding.controls
    && binding.controlBefore
    && binding.controlBefore.parentElement === binding.controls,
  );
}

export function createControls(initialBinding: PlayerBinding, handlers: ControlsHandlers): PlayerControls {
  let binding = initialBinding;
  const nativeHost = document.createElement('div');
  nativeHost.className = 'jz-controls-host';
  const nativeShadow = nativeHost.attachShadow({ mode: 'open' });
  let pointerExclusion = initialBinding.adapter === 'Disney+' ? createDisneyPointerExclusion(nativeHost, handlers.activate) : null;
  let netflixSpacer: HTMLElement | null = null;
  const floatingHost = document.createElement('div');
  floatingHost.className = 'jz-controls-host floating-host';
  const floatingShadow = floatingHost.attachShadow({ mode: 'open' });
  // Keep the page-visible host stable. Reveal state belongs to a shadow child
  // so provider selectors/attribute observers cannot react to its class changes.
  const floatingSurface = document.createElement('div');
  floatingSurface.className = 'floating-surface is-concealed';
  const style = document.createElement('style');
  style.textContent = STYLE;
  nativeShadow.append(style.cloneNode(true));
  floatingShadow.append(style.cloneNode(true));

  const nativeButton = makeButton('', 'activate', 'native-button');
  nativeButton.setAttribute('aria-label', 'Toggle Zoom');
  nativeButton.title = 'Toggle Zoom';
  nativeButton.innerHTML = ICON_OPPOSING;

  const disneyTooltip = document.createElement('div');
  disneyTooltip.className = 'jz-disney-tooltip';
  disneyTooltip.setAttribute('role', 'tooltip');
  disneyTooltip.setAttribute('aria-hidden', 'true');
  const disneyTooltipLabel = document.createElement('span');
  disneyTooltipLabel.className = 'jz-disney-tooltip-label';
  disneyTooltipLabel.textContent = 'Zoom';
  const disneyTooltipArrow = document.createElement('span');
  disneyTooltipArrow.className = 'jz-disney-tooltip-arrow';
  disneyTooltip.append(disneyTooltipLabel, disneyTooltipArrow);

  const floatingButton = makeButton('', 'toggle-controls', 'floating-button');
  floatingButton.setAttribute('aria-label', 'Open just_zoom controls');
  floatingButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6M4 4v6M20 4h-6M20 4v6M4 20h6M4 20v-6M20 20h-6M20 20v-6"/></svg>';

  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'just_zoom quick controls');

  const panelHeader = document.createElement('div');
  panelHeader.className = 'panel-header';
  const panelTitle = document.createElement('span');
  panelTitle.textContent = 'just_zoom';
  const panelFactor = document.createElement('span');
  panelFactor.className = 'panel-factor';
  panelFactor.textContent = 'Off';
  panelHeader.append(panelTitle, panelFactor);

  const activateButton = makeButton('', 'activate', 'panel-action');
  activateButton.setAttribute('aria-label', 'Toggle Zoom');
  activateButton.innerHTML = `${ICON_OPPOSING} <span>Toggle Zoom</span>`;

  // Quick zoom section: Fit and Fill
  const quickTitle = document.createElement('div');
  quickTitle.className = 'panel-section-title';
  quickTitle.textContent = 'Quick zoom';
  const quickRow = document.createElement('div');
  quickRow.className = 'panel-presets';
  const fitBtn = makeButton('Fit', 'quick-fit', 'panel-preset');
  fitBtn.addEventListener('click', () => {
    if (settings?.zoomApplied && settings?.zoomType === 'quick' && settings?.mode === 'fit') {
      handlers.patch({ zoomApplied: false });
    } else {
      handlers.patch({ mode: 'fit', zoomType: 'quick', zoomApplied: true });
    }
  });
  const fillBtn = makeButton('Fill', 'quick-fill', 'panel-preset');
  fillBtn.addEventListener('click', () => {
    if (settings?.zoomApplied && settings?.zoomType === 'quick' && settings?.mode === 'fill') {
      handlers.patch({ zoomApplied: false });
    } else {
      handlers.patch({ mode: 'fill', zoomType: 'quick', zoomApplied: true });
    }
  });
  quickRow.append(fitBtn, fillBtn);

  // Zoom factor section: OFF, SCREEN RATIO, MANUAL
  const factorTitle = document.createElement('div');
  factorTitle.className = 'panel-section-title';
  factorTitle.textContent = 'Zoom factor';

  const factorModeRow = document.createElement('div');
  factorModeRow.className = 'panel-presets';

  const factorOffBtn = makeButton('Off', 'factor-off', 'panel-preset');
  factorOffBtn.addEventListener('click', () => {
    handlers.patch({ zoomApplied: false });
  });

  const factorRatioBtn = makeButton('Screen ratio', 'factor-ratio', 'panel-preset');
  factorRatioBtn.addEventListener('click', () => {
    handlers.patch({ zoomStrategy: 'automatic', zoomType: 'factor', zoomApplied: true });
  });

  const factorManualBtn = makeButton('Manual', 'factor-manual', 'panel-preset');
  factorManualBtn.addEventListener('click', () => {
    const nextZoom = (settings?.zoom && settings.zoom > 1.0) ? settings.zoom : 1.34;
    handlers.patch({ zoomStrategy: 'manual', zoomType: 'factor', zoomApplied: true, zoom: nextZoom });
  });

  factorModeRow.append(factorOffBtn, factorRatioBtn, factorManualBtn);

  // Multiplier presets row: visible ONLY when manual is selected
  const presetRow = document.createElement('div');
  presetRow.className = 'panel-presets';
  presetRow.style.marginTop = '4px';
  const presets = [
    { label: '1.18×', factor: 1.18 },
    { label: '1.25×', factor: 1.25 },
    { label: '1.34×', factor: 1.34 },
    { label: '1.5×', factor: 1.5 },
    { label: '2×', factor: 2.0 },
  ];
  const presetButtons = presets.map(({ label, factor }) => {
    const btn = makeButton(label, 'preset', 'panel-preset');
    btn.addEventListener('click', () => {
      handlers.patch({ zoom: factor, zoomType: 'factor', zoomStrategy: 'manual', zoomApplied: true });
    });
    presetRow.append(btn);
    return { btn, factor };
  });

  // Reset pan button
  const resetPanBtn = makeButton('Reset pan', 'reset-pan', 'panel-toggle');
  resetPanBtn.addEventListener('click', () => {
    handlers.resetPan();
  });

  // Ambience toggle with last used mode memory
  let lastAmbienceMode: 'soft' | 'full' = 'soft';
  const ambienceButton = makeButton('Ambience: Off', 'toggle-ambience', 'panel-toggle');
  ambienceButton.addEventListener('click', () => {
    const isOff = !settings || settings.ambience === 'off';
    if (isOff) {
      handlers.patch({ ambience: lastAmbienceMode || 'soft' });
    } else {
      if (settings?.ambience && settings.ambience !== 'off') {
        lastAmbienceMode = settings.ambience as 'soft' | 'full';
      }
      handlers.patch({ ambience: 'off' });
    }
  });

  const gestureTip = document.createElement('div');
  gestureTip.className = 'panel-tip';
  gestureTip.textContent = `Hold ${formatModifier('alt')} + scroll to zoom, drag to pan`;

  const settingsButton = makeButton('Extension settings…', 'open-settings', 'panel-settings');
  panel.append(panelHeader, activateButton, quickTitle, quickRow, factorTitle, factorModeRow, presetRow, resetPanBtn, ambienceButton, gestureTip, settingsButton);
  nativeShadow.append(nativeButton, disneyTooltip);
  floatingSurface.append(floatingButton, panel);
  floatingShadow.append(floatingSurface);

  let settings: Settings | null = null;
  let status: FeatureStatus | null = null;
  let floating = false;
  let disposed = false;
  let previousFocus: Element | null = null;
  let floatingVisible = false;
  let hideTimer = 0;
  let isSurfaceHovered = false;
  let lastPointerPos: { x: number; y: number } | null = null;

  const cancelHide = () => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = 0;
    }
  };

  const setFloatingVisible = (visible: boolean) => {
    if (floatingVisible === visible) return;
    floatingVisible = visible;
    floatingSurface.classList.toggle('is-concealed', !visible);
  };

  const scheduleHide = (delay = 500) => {
    cancelHide();
    if (!floating || !floatingHost.isConnected) return;
    hideTimer = window.setTimeout(() => {
      hideTimer = 0;
      if (panel.hidden && !isSurfaceHovered && !floatingButton.matches?.(':focus-visible')) {
        setFloatingVisible(false);
      }
    }, delay);
  };

  const isPointerNear = (x: number, y: number): boolean => {
    if (!floating || !floatingHost.isConnected) return false;
    if (!floatingCenter) positionFloating();
    if (!floatingCenter) return false;
    const rect = binding.viewport.getBoundingClientRect();
    const inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    if (!inside) return false;
    const dx = x - floatingCenter.x, dy = y - floatingCenter.y;
    return dx * dx + dy * dy <= 200 * 200;
  };

  const onOutsidePointerDown = (event: Event) => {
    if (panel.hidden) return;
    const path = event.composedPath();
    if (path.includes(floatingHost) || path.includes(floatingShadow) || path.includes(panel) || path.includes(floatingButton)) return;
    if ('clientX' in event && typeof (event as MouseEvent).clientX === 'number') {
      lastPointerPos = { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY };
    }
    closePanel();
  };

  const closePanel = (restoreFocus = false) => {
    if (panel.hidden) return;
    panel.hidden = true;
    window.removeEventListener('pointerdown', onOutsidePointerDown, true);
    floatingButton.setAttribute('aria-expanded', 'false');
    if (restoreFocus && floatingButton.isConnected) {
      floatingButton.focus();
    } else if (floatingShadow.activeElement instanceof HTMLElement) {
      floatingShadow.activeElement.blur();
    }
    if (lastPointerPos && isPointerNear(lastPointerPos.x, lastPointerPos.y)) {
      scheduleHide(1500);
    } else {
      scheduleHide(300);
    }
  };

  const setPanelOpen = (open: boolean) => {
    if (!floating) return;
    if (open) {
      previousFocus = document.activeElement;
      panel.hidden = false;
      floatingButton.setAttribute('aria-expanded', 'true');
      cancelHide();
      setFloatingVisible(true);
      window.addEventListener('pointerdown', onOutsidePointerDown, true);
      activateButton.focus();
    } else {
      closePanel();
    }
  };

  const openSettings = () => {
    closePanel();
    if (!isContextValid()) return;
    try { void chrome.runtime.sendMessage({ type: 'JZ_OPEN_SETTINGS' }).catch(() => undefined); } catch { /* context invalidated */ }
  };

  const suppressNativeTooltip = () => {
    nativeHost.dataset.suppressed = 'true';
    nativeButton.blur();
  };
  const unsuppressNativeTooltip = () => {
    delete nativeHost.dataset.suppressed;
  };
  nativeHost.addEventListener('pointerleave', unsuppressNativeTooltip);
  nativeHost.addEventListener('mouseleave', unsuppressNativeTooltip);

  nativeButton.addEventListener('click', (event) => {
    handlers.activate();
    if (event.detail > 0) suppressNativeTooltip();
  });
  activateButton.addEventListener('click', handlers.activate);
  floatingButton.addEventListener('click', () => setPanelOpen(Boolean(panel.hidden)));
  settingsButton.addEventListener('click', openSettings);

  const onZoomWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.deltaY === 0 || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    handlers.action(event.deltaY < 0 ? 'zoom-in' : 'zoom-out');
  };
  // Attach only to zoom controls so ordinary player scrolling and pinch zoom
  // remain untouched. These are separate elements, so each event has one handler.
  nativeButton.addEventListener('wheel', onZoomWheel, { passive: false });
  activateButton.addEventListener('wheel', onZoomWheel, { passive: false });
  floatingButton.addEventListener('wheel', onZoomWheel, { passive: false });

  const onSurfaceEnter = () => {
    isSurfaceHovered = true;
    cancelHide();
  };
  const onSurfaceLeave = () => {
    isSurfaceHovered = false;
    if (panel.hidden) scheduleHide(600);
  };
  floatingSurface.addEventListener('pointerenter', onSurfaceEnter);
  floatingSurface.addEventListener('pointerleave', onSurfaceLeave);

  const isolateEvents = (shadow: ShadowRoot, host: HTMLElement) => {
    shadow.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key !== 'Escape') return;
      event.preventDefault();
      closePanel(true);
    });
    if (host === floatingHost) {
      shadow.addEventListener('focusin', () => {
        cancelHide();
        setFloatingVisible(true);
      });
      shadow.addEventListener('focusout', (event) => {
        const nextTarget = (event as FocusEvent).relatedTarget;
        if (!nextTarget || !(nextTarget instanceof Node) || !shadow.contains(nextTarget)) {
          if (panel.hidden) scheduleHide(300);
        }
      });
    }
    // Bubble-phase isolation preserves each control's own target event handlers.
    for (const type of EVENT_TYPES) {
      shadow.addEventListener(type, (event) => event.stopPropagation());
    }
  };
  isolateEvents(nativeShadow, nativeHost);
  isolateEvents(floatingShadow, floatingHost);

  let floatingCenter: { x: number; y: number } | null = null;
  const positionFloating = () => {
    floatingCenter = null;
    if (!floating || !floatingHost.isConnected) return;
    const hidden = document.fullscreenElement === binding.video;
    if (floatingHost.hidden !== hidden) floatingHost.hidden = hidden;
    if (floatingHost.hidden) return;
    // Anchor to the player box, not the transformed video picture: zooming
    // must not push the control outside the player.
    const rect = binding.viewport.getBoundingClientRect();
    const left = Math.max(8, Math.min(innerWidth - 42, rect.right - 42));
    const top = Math.max(8, Math.min(innerHeight - 42, rect.top + (rect.height - 34) / 2));
    floatingCenter = { x: left + 17, y: top + 17 };
    if (floatingHost.style.left !== `${left}px`) floatingHost.style.left = `${left}px`;
    if (floatingHost.style.top !== `${top}px`) floatingHost.style.top = `${top}px`;
    const panelWidth = `${Math.max(0, Math.min(184, left - 16))}px`;
    if (panel.style.width !== panelWidth) panel.style.width = panelWidth;
  };

  const floatingParent = (): HTMLElement => {
    const fullscreen = document.fullscreenElement;
    if (fullscreen instanceof HTMLElement && fullscreen !== binding.video && fullscreen.contains(binding.video)) {
      return fullscreen;
    }
    return (document.body ?? document.documentElement) as HTMLElement;
  };

  const revealIfNear = (event: PointerEvent) => {
    if (!settings?.enabled || !floating || !floatingHost.isConnected) return;
    lastPointerPos = { x: event.clientX, y: event.clientY };
    if (!panel.hidden) return;
    if (isSurfaceHovered) return;

    if (isPointerNear(event.clientX, event.clientY)) {
      cancelHide();
      setFloatingVisible(true);
      hideTimer = window.setTimeout(() => {
        hideTimer = 0;
        if (panel.hidden && !isSurfaceHovered && !floatingButton.matches?.(':focus-visible')) {
          setFloatingVisible(false);
        }
      }, 2500);
    } else {
      if (floatingVisible && !hideTimer) {
        scheduleHide(500);
      }
    }
  };

  const onPointerLeaveDoc = (event: PointerEvent) => {
    if (!event.relatedTarget && panel.hidden) {
      lastPointerPos = null;
      scheduleHide(300);
    }
  };

  const onWindowBlur = () => {
    if (panel.hidden) {
      scheduleHide(300);
    }
  };

  const mount = () => {
    if (disposed || !settings) return;
    const blocked = portraitBlocked(binding, settings.allowPortrait);
    if (!settings.enabled || blocked) {
      cancelHide();
      closePanel();
      setFloatingVisible(false);
      floating = false;
      floatingHost.remove();
      netflixSpacer?.remove();
      nativeHost.remove();
      return;
    }
    const wantsNative = settings.controlMode === 'native' || settings.controlMode === 'both';
    const hasNative = isNativeAnchor(binding) && binding.controls.isConnected;
    const canNative = hasNative;
    const wantsFloating = settings.controlMode !== 'native' || !canNative || !panel.hidden;
    // Reconcile the two hosts independently. A provider rebuilding its toolbar
    // must not detach the focused/open floating panel or replace its children.
    if (wantsFloating) {
      floating = true;
      const parent = floatingParent();
      if (floatingHost.parentElement !== parent) {
        const focused = floatingShadow.activeElement;
        parent.append(floatingHost);
        if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
      }
      positionFloating();
    } else {
      cancelHide();
      closePanel();
      setFloatingVisible(false);
      floating = false;
      floatingHost.remove();
    }

    if (wantsNative && hasNative && isNativeAnchor(binding)) {
      const isDisney = binding.adapter === 'Disney+';
      const isNetflix = binding.adapter === 'Netflix';
      const className = `jz-controls-host native-host ${isDisney ? 'is-disney ' : ''}${isNetflix ? 'is-netflix ' : ''}${binding.controlClassName ?? ''}`;
      if (nativeHost.className !== className) nativeHost.className = className;
      const anchor = binding.controlAnchor ?? binding.controlBefore;
      const before = binding.controlBefore;
      if (anchor instanceof HTMLElement) {
        const width = anchor.offsetWidth, height = anchor.offsetHeight;
        const anchorCs = getComputedStyle(anchor);
        const beforeCs = before instanceof HTMLElement ? getComputedStyle(before) : null;
        nativeHost.style.top = '';
        nativeHost.style.left = '';

        if (binding.adapter === 'Netflix') {
          const w = Math.max(40, width || 44);
          const h = Math.max(40, height || 44);
          nativeHost.style.display = 'inline-flex';
          nativeHost.style.position = 'relative';
          nativeHost.style.top = '-3px';
          nativeHost.style.left = '-3px';
          nativeHost.style.flex = '0 0 auto';
          nativeHost.style.alignItems = 'center';
          nativeHost.style.justifyContent = 'center';
          nativeHost.style.alignSelf = 'center';
          nativeHost.style.verticalAlign = 'middle';
          nativeHost.style.width = `${w}px`;
          nativeHost.style.height = `${h}px`;
          nativeHost.style.padding = '0';
          nativeHost.style.lineHeight = '0';
          if (beforeCs?.margin && beforeCs.margin !== '0px') {
            nativeHost.style.margin = beforeCs.margin;
          } else if (anchorCs.margin && anchorCs.margin !== '0px') {
            nativeHost.style.margin = anchorCs.margin;
          } else {
            nativeHost.style.margin = '0';
          }
          nativeHost.style.pointerEvents = 'auto';
          nativeHost.style.setProperty('--jz-icon-size', '38px');
          nativeButton.style.color = '#fff';

          if (!netflixSpacer) {
            netflixSpacer = document.createElement('div');
          }
          const prevSpacer = (before.previousElementSibling !== nativeHost && before.previousElementSibling !== netflixSpacer)
            ? before.previousElementSibling as HTMLElement | null
            : null;
          if (prevSpacer && prevSpacer.className) {
            if (netflixSpacer.className !== prevSpacer.className) netflixSpacer.className = prevSpacer.className;
            const styleText = prevSpacer.getAttribute('style');
            if (styleText && netflixSpacer.getAttribute('style') !== styleText) {
              netflixSpacer.setAttribute('style', styleText);
            }
          } else if (!netflixSpacer.style.width) {
            netflixSpacer.style.cssText = 'min-width: 3rem; width: 3rem;';
          }
        } else if (binding.adapter === 'Prime Video') {
          if (netflixSpacer) {
            netflixSpacer.remove();
            netflixSpacer = null;
          }
          const w = width || 44, h = height || 44;
          nativeHost.style.display = 'inline-flex';
          nativeHost.style.position = 'relative';
          nativeHost.style.flex = '0 0 auto';
          nativeHost.style.alignItems = 'center';
          nativeHost.style.justifyContent = 'center';
          nativeHost.style.verticalAlign = 'middle';
          nativeHost.style.width = `${w}px`;
          nativeHost.style.height = `${h}px`;
          if (beforeCs?.margin && beforeCs.margin !== '0px') {
            nativeHost.style.margin = beforeCs.margin;
          } else if (anchorCs.margin && anchorCs.margin !== '0px') {
            nativeHost.style.margin = anchorCs.margin;
          }
          nativeHost.style.pointerEvents = 'auto';
          // Match Prime Video's internal icon proportion (~48% of button box)
          const iconSize = Math.max(18, Math.min(32, Math.round(w * 0.48)));
          nativeHost.style.setProperty('--jz-icon-size', `${iconSize}px`);
          nativeButton.style.color = '#fff';
        } else if (binding.adapter === 'Disney+') {
          // Compensate for Disney+ custom element bounds so button matches adjacent controls
          const w = Math.max(24, Math.min(60, Math.round((width || 36) * 1.2)));
          const h = Math.max(24, Math.min(60, Math.round((height || 36) * 1.2)));
          nativeHost.style.display = 'inline-flex';
          nativeHost.style.position = 'relative';
          nativeHost.style.flex = '0 0 auto';
          nativeHost.style.alignItems = 'center';
          nativeHost.style.justifyContent = 'center';
          nativeHost.style.verticalAlign = 'middle';
          nativeHost.style.width = `${w}px`;
          nativeHost.style.height = `${h}px`;
          if (anchorCs.margin && anchorCs.margin !== '0px') nativeHost.style.margin = anchorCs.margin;
          nativeHost.style.pointerEvents = 'auto';
          const iconSize = Math.max(18, Math.min(32, Math.round(w * 0.55)));
          nativeHost.style.setProperty('--jz-icon-size', `${iconSize}px`);
          nativeButton.style.color = '#fff';
          nativeButton.removeAttribute('title');
        } else {
          if (width > 0 && height > 0) {
            const properties = { display: 'inline-flex', position: 'relative', flex: '0 0 auto', 'align-items': 'center', 'justify-content': 'center', 'vertical-align': 'middle', width: `${width}px`, height: `${height}px`, 'min-width': `${width}px`, 'pointer-events': 'auto' };
            for (const [property, value] of Object.entries(properties)) {
              if (nativeHost.style.getPropertyValue(property) !== value) nativeHost.style.setProperty(property, value);
            }
            nativeHost.style.setProperty('--jz-icon-size', `${Math.max(16, Math.min(28, Math.round(width * 0.55)))}px`);
            const csColor = anchorCs.color;
            nativeButton.style.color = csColor && csColor !== 'rgba(0, 0, 0, 0)' && csColor !== 'rgb(0, 0, 0)' ? csColor : '#fff';
          } else if (!nativeHost.style.width) {
            nativeHost.style.cssText = 'display:inline-flex;position:relative;flex:0 0 auto;vertical-align:middle;width:40px;height:40px;pointer-events:auto';
            nativeHost.style.setProperty('--jz-icon-size', '20px');
            nativeButton.style.color = '#fff';
          }
        }
      }
      if (binding.adapter === 'Netflix' && netflixSpacer) {
        if (nativeHost.parentElement !== binding.controls || nativeHost.nextElementSibling !== netflixSpacer || netflixSpacer.nextElementSibling !== binding.controlBefore) {
          binding.controls.insertBefore(nativeHost, binding.controlBefore);
          binding.controls.insertBefore(netflixSpacer, binding.controlBefore);
        }
      } else {
        if (netflixSpacer) {
          netflixSpacer.remove();
          netflixSpacer = null;
        }
        if (nativeHost.parentElement !== binding.controls || nativeHost.nextElementSibling !== binding.controlBefore) {
          binding.controls.insertBefore(nativeHost, binding.controlBefore);
        }
      }
    } else {
      netflixSpacer?.remove();
      nativeHost.remove();
    }
    pointerExclusion?.sync(true);
  };

  const syncLabels = () => {
    const active = Boolean(settings?.zoomApplied);
    const icon = active ? ICON_FACING : ICON_OPPOSING;
    if (nativeButton.dataset.active !== String(active)) {
      nativeButton.dataset.active = String(active);
      nativeButton.innerHTML = icon;
      activateButton.innerHTML = `${icon} <span>Toggle Zoom</span>`;
    }
    const isDisney = binding.adapter === 'Disney+';
    const defaultTitle = isDisney ? (active ? 'Reset Zoom' : 'Zoom') : 'Toggle Zoom';
    nativeButton.setAttribute('aria-label', defaultTitle);
    if (isDisney) {
      nativeButton.removeAttribute('title');
      disneyTooltipLabel.textContent = defaultTitle;
    } else {
      nativeButton.title = defaultTitle;
    }

    activateButton.setAttribute('aria-label', 'Toggle Zoom');
    activateButton.disabled = false;
    activateButton.title = status?.source === 'unavailable' ? status.message : '';

    if (!settings || !active) {
      panelFactor.textContent = 'Off';
    } else if (settings.zoomType === 'quick') {
      panelFactor.textContent = settings.mode === 'fill' ? 'Fill' : 'Fit';
    } else if (settings.zoomStrategy === 'automatic') {
      panelFactor.textContent = 'Screen';
    } else {
      panelFactor.textContent = `${Math.round(settings.zoom * 100)}%`;
    }

    const isFit = Boolean(active && settings?.zoomType === 'quick' && settings?.mode === 'fit');
    const isFill = Boolean(active && settings?.zoomType === 'quick' && settings?.mode === 'fill');
    fitBtn.setAttribute('aria-pressed', String(isFit));
    fillBtn.setAttribute('aria-pressed', String(isFill));

    const isFactorActive = Boolean(active && settings?.zoomType === 'factor');
    const isFactorAuto = Boolean(isFactorActive && settings?.zoomStrategy === 'automatic');
    const isFactorManual = Boolean(isFactorActive && settings?.zoomStrategy === 'manual');
    const isFactorOff = !isFactorAuto && !isFactorManual;

    factorOffBtn.setAttribute('aria-pressed', String(isFactorOff));
    factorRatioBtn.setAttribute('aria-pressed', String(isFactorAuto));
    factorManualBtn.setAttribute('aria-pressed', String(isFactorManual));

    // Multipliers appear only when selecting manual
    presetRow.style.display = isFactorManual ? 'flex' : 'none';

    for (const { btn, factor } of presetButtons) {
      const isSelected = Boolean(
        active
        && isFactorManual
        && Math.abs((settings?.zoom ?? 1) - factor) < 0.01
      );
      btn.setAttribute('aria-pressed', String(isSelected));
    }

    const isAmbienceOn = Boolean(settings && settings.ambience !== 'off');
    if (isAmbienceOn && settings?.ambience) {
      lastAmbienceMode = settings.ambience as 'soft' | 'full';
    }
    ambienceButton.textContent = isAmbienceOn
      ? `Ambience: ${settings?.ambience === 'soft' ? 'Soft' : 'Full'}`
      : 'Ambience: Off';
    ambienceButton.setAttribute('aria-pressed', String(isAmbienceOn));

    const isPanned = Boolean(settings && (Math.abs(settings.panX) > 0.001 || Math.abs(settings.panY) > 0.001));
    resetPanBtn.disabled = !isPanned;

    const mod = settings?.gestureModifier ?? 'alt';
    gestureTip.textContent = `Hold ${formatModifier(mod)} + scroll to zoom, drag to pan`;
  };

  let layoutFrame = 0;
  let layoutNeedsMount = false;
  const scheduleLayout = (remount: boolean) => {
    layoutNeedsMount ||= remount;
    if (layoutFrame || disposed || !settings?.enabled) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      if (!settings?.enabled) return;
      const remount = layoutNeedsMount;
      layoutNeedsMount = false;
      if (remount) mount();
      else {
        positionFloating();
      }
    });
  };
  const onViewportChange = () => scheduleLayout(true);
  const onScroll = () => scheduleLayout(false);

  document.addEventListener('pointermove', revealIfNear, true);
  document.addEventListener('pointerleave', onPointerLeaveDoc, true);
  window.addEventListener('blur', onWindowBlur);
  document.addEventListener('fullscreenchange', onViewportChange);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('scroll', onScroll, true);
  const playerResize = new ResizeObserver(onViewportChange);
  playerResize.observe(binding.viewport);
  if (binding.controlAnchor) playerResize.observe(binding.controlAnchor);

  return {
    update(nextSettings, nextStatus) {
      const prevSettings = settings;
      const prevEnabled = prevSettings?.enabled;
      const settingsChanged = !prevSettings || (Object.keys(nextSettings) as (keyof Settings)[])
        .some(key => nextSettings[key] !== prevSettings[key]);

      settings = { ...nextSettings };
      status = nextStatus;

      if (!nextSettings.enabled) {
        cancelHide();
        closePanel();
        setFloatingVisible(false);
        floating = false;
        floatingHost.remove();
        netflixSpacer?.remove();
        nativeHost.remove();
        pointerExclusion?.sync();
        return;
      }

      const hasNative = isNativeAnchor(binding) && binding.controls.isConnected;
      const canNative = hasNative;
      const wantsNative = (nextSettings.controlMode === 'native' || nextSettings.controlMode === 'both') && canNative;
      const wantsFloating = nextSettings.controlMode !== 'native' || !canNative || !panel.hidden;
      const needsMount = !prevSettings || prevEnabled !== true
        || prevSettings.controlMode !== nextSettings.controlMode
        || nativeHost.isConnected !== wantsNative
        || floating !== wantsFloating
        || (wantsFloating && !floatingHost.isConnected);

      // Discovery polls and status messages must not remeasure the toolbar or
      // rewrite labels/styles. Resize/fullscreen/rebind handle layout changes.
      if (needsMount) mount();
      pointerExclusion?.sync();
      if (settingsChanged) syncLabels();
      else {
        const title = status?.source === 'unavailable' ? status.message : '';
        if (activateButton.title !== title) activateButton.title = title;
        const isDisney = binding.adapter === 'Disney+';
        const active = Boolean(settings?.zoomApplied);
        const defaultTitle = isDisney ? (active ? 'Reset Zoom' : 'Zoom') : 'Toggle Zoom';
        if (isDisney) {
          nativeButton.removeAttribute('title');
          disneyTooltipLabel.textContent = defaultTitle;
        } else if (nativeButton.title !== defaultTitle) {
          nativeButton.title = defaultTitle;
        }
      }
    },
    rebind(next: PlayerBinding) {
      binding = next;
      if (binding.adapter !== 'Netflix' && netflixSpacer) {
        netflixSpacer.remove();
        netflixSpacer = null;
      }
      if (binding.adapter === 'Disney+' && !pointerExclusion) {
        pointerExclusion = createDisneyPointerExclusion(nativeHost, handlers.activate);
      } else if (binding.adapter !== 'Disney+' && pointerExclusion) {
        pointerExclusion.dispose();
        pointerExclusion = null;
      }
      playerResize.disconnect();
      playerResize.observe(binding.viewport);
      if (binding.controlAnchor) playerResize.observe(binding.controlAnchor);
      mount();
    },
    toggle() {
      if (floating) {
        setPanelOpen(Boolean(panel.hidden));
      } else {
        openSettings();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelHide();
      closePanel();
      cancelAnimationFrame(layoutFrame);
      pointerExclusion?.dispose();
      netflixSpacer?.remove();
      netflixSpacer = null;
      nativeHost.remove();
      floatingHost.remove();
      playerResize.disconnect();
      floatingSurface.removeEventListener('pointerenter', onSurfaceEnter);
      floatingSurface.removeEventListener('pointerleave', onSurfaceLeave);
      document.removeEventListener('pointermove', revealIfNear, true);
      document.removeEventListener('pointerleave', onPointerLeaveDoc, true);
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('fullscreenchange', onViewportChange);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onScroll, true);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    },
  };
}
