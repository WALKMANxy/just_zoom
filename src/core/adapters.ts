import type { PlayerBinding } from '../shared/types';
import { isNativeControlsVideo } from '../ui/native-player';

export interface AdapterSpec { name: string; host: RegExp; player: string; fullscreen: string }
export const services: AdapterSpec[] = [
  { name: 'YouTube', host: /(^|\.)youtube\.com$/, player: '#movie_player,.html5-video-player', fullscreen: '.ytp-fullscreen-button' },
  { name: 'Netflix', host: /(^|\.)netflix\.com$/, player: '.watch-video,.watch-video--player-view,[data-uia="video-canvas"]', fullscreen: 'button[data-uia="control-fullscreen-enter"],button[data-uia="control-fullscreen-exit"]' },
  { name: 'Prime Video', host: /(^|\.)(primevideo\.com|amazon\.[a-z.]+)$/, player: '#dv-web-player,[class*="webPlayerSDKContainer"]', fullscreen: 'button#atvwebplayersdk-fullscreen-toggle-button' },
  { name: 'Disney+', host: /(^|\.)disneyplus\.com$/, player: '.btm-media-client,[data-testid*="disney-web-player"],[data-testid="video-player"],[class*="video-player"]', fullscreen: 'toggle-fullscreen,button.toggle-fullscreen,[class*="toggle-fullscreen"],.control-icon-btn[aria-label*="full screen" i],.control-icon-btn[aria-label*="fullscreen" i],button[data-testid*="fullscreen" i],button[aria-label*="full screen" i],button[aria-label*="fullscreen" i]' },
  { name: 'Max', host: /(^|\.)(max\.com|hbomax\.com)$/, player: '[data-testid="video-player"],[class*="PlayerContainer"]', fullscreen: 'button[data-testid="player-ux-fullscreen-button"],button[data-testid="ExitFullscreenButton"]' },
  { name: 'Apple TV+', host: /(^|\.)tv\.apple\.com$/, player: '.video-player,[class*="video-player"]', fullscreen: 'button[aria-label*="full screen" i],button[aria-label*="fullscreen" i],button[class*="fullscreen" i]' },
  { name: 'Paramount+', host: /(^|\.)paramountplus\.com$/, player: '[data-testid="video-player"],.video-player,[class*="video-player"]', fullscreen: 'button[data-testid*="fullscreen" i],button[class*="fullscreen" i],button[aria-label*="fullscreen" i]' },
  { name: 'Hulu', host: /(^|\.)hulu\.com$/, player: '[data-testid="video-player"],.video-player,[class*="video-player"]', fullscreen: 'button[data-testid*="fullscreen" i],button[class*="fullscreen" i],button[aria-label*="full screen" i]' },
  { name: 'Peacock', host: /(^|\.)peacocktv\.com$/, player: '[data-testid="video-player"],[class*="video-player"]', fullscreen: 'button[data-testid*="fullscreen" i],button[aria-label*="full screen" i],button[aria-label*="fullscreen" i]' },
  { name: 'Twitch', host: /(^|\.)twitch\.tv$/, player: '[data-a-target="video-player"],[data-test-selector="video-player"]', fullscreen: 'button[data-a-target="player-fullscreen-button"]' },
  { name: 'Vimeo', host: /(^|\.)vimeo\.com$/, player: '.vp-video-wrapper,.player,[data-player]', fullscreen: 'button[data-fullscreen-button],button[aria-label*="fullscreen" i],button[aria-label*="full screen" i]' },
  { name: 'Crunchyroll', host: /(^|\.)crunchyroll\.com$/, player: '[data-testid="video-player"],[class*="video-player"]', fullscreen: 'button[data-testid="fullscreen-button"]' },
  { name: 'Plex Web', host: /(^|\.)plex\.tv$/, player: '[class*="PlayerContainer"],[class*="VideoPlayer"]', fullscreen: 'button[data-testid*="fullscreen" i],button[aria-label*="fullscreen" i],button[class*="fullscreen" i]' },
  { name: 'DAZN', host: /(^|\.)dazn\.com$/, player: '[data-test-id="video-player"],[class*="video-player"]', fullscreen: 'button[data-test-id*="fullscreen" i],button[data-test-id*="full-screen" i],button[aria-label*="fullscreen" i]' },
];
export const genericPlayer = '.video-js,.jwplayer,.plyr,.shaka-video-container,[data-player]';
const genericFullscreen = '.vjs-fullscreen-control,.jw-icon-fullscreen,button[data-plyr="fullscreen"],.shaka-fullscreen-button';
const wrapperSelector = 'button,[role="button"],.vjs-control,.jw-icon,.plyr__control,.shaka-tooltip';

function deepQuerySelector<T extends Element = Element>(selector: string, root: Element | Document | ShadowRoot = document): T | null {
  const el = root.querySelector<T>(selector);
  if (el) return el;
  const all = root.querySelectorAll('*');
  for (const node of all) {
    if (node.shadowRoot) {
      const found = deepQuerySelector<T>(selector, node.shadowRoot);
      if (found) return found;
    }
  }
  return null;
}

function localFullscreen(video: HTMLVideoElement, root: HTMLElement | null, selector: string): HTMLElement | null {
  // Disney+ renders the visible utility row inside nested open shadow roots.
  // Query all three responsive variations and pick the active (displayed) one.
  if (/(^|\.)disneyplus\.com$/.test(location.hostname)) {
    const candidates = [
      deepQuerySelector<HTMLElement>('.experience-controls > toggle-fullscreen'),
      deepQuerySelector<HTMLElement>('.experience-controls-narrow > toggle-fullscreen'),
      deepQuerySelector<HTMLElement>('.experience-controls-extra-narrow > toggle-fullscreen'),
    ].filter((el): el is HTMLElement => el !== null);
    return candidates.find(el => el.getClientRects().length > 0) ?? candidates[0] ?? null;
  }

  // Custom controls are often siblings of the video. Search only bounded
  // ancestors of this selected video, never document-wide player controls.
  let node = root ?? video.parentElement, depth = 0;
  while (node && node !== document.body && node !== document.documentElement && depth++ < 12) {
    // Streaming players retain hidden preload/ad videos. Only another visible,
    // actively playing video makes climbing outside our known player root ambiguous.
    if (node !== root && Array.from(node.querySelectorAll('video')).some(other => {
      if (other === video || other.paused) return false;
      const rect = other.getBoundingClientRect(), style = getComputedStyle(other);
      return rect.width >= 120 && rect.height >= 70 && style.display !== 'none'
        && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
    })) return null;
    const matches = Array.from(node.querySelectorAll<HTMLElement>(selector)).filter(item => !item.closest('.jz-controls-host'));
    const match = matches.find(item => item.getClientRects().length > 0)
      ?? (matches[0] && matches[0].isConnected && getComputedStyle(matches[0]).display !== 'none' ? matches[0] : null);
    if (match) return match;
    node = node.parentElement;
  }
  return null;
}

export function disneyControlRoots(): ShadowRoot[] {
  const ui = document.querySelector<HTMLElement>('disney-web-player-ui')
    ?? deepQuerySelector<HTMLElement>('disney-web-player-ui');
  const uiRoot = ui?.shadowRoot;
  // The UI host projects light-DOM controls through a slot in its shadow root.
  const overlay = ui?.querySelector<HTMLElement>('main-app-controls-overlay')
    ?? uiRoot?.querySelector<HTMLElement>('main-app-controls-overlay');
  return [uiRoot, overlay?.shadowRoot].filter((root): root is ShadowRoot => root instanceof ShadowRoot);
}

function isHostVisible(host: HTMLElement): boolean {
  if (!host.isConnected) return false;
  const rect = host.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (typeof host.checkVisibility === 'function') {
    if (!host.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  } else {
    const cs = getComputedStyle(host);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
  }
  for (let node: Node | null = host.parentNode; node; node = node instanceof ShadowRoot ? node.host : node.parentNode) {
    if (node instanceof HTMLElement) {
      const cs = getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0 || cs.pointerEvents === 'none') {
        return false;
      }
      if (node.tagName === 'MAIN-APP-CONTROLS-OVERLAY' || node.classList.contains('btm-media-player')) break;
    }
  }
  return true;
}

const CAPTURE_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick'] as const;

export function createDisneyPointerExclusion(host: HTMLElement, activate: () => void): { sync: (geometryChanged?: boolean) => void; dispose: () => void } {
  let mask: Element | null = null;
  let maskObserver: MutationObserver | null = null;
  let disposed = false;

  const killMask = () => {
    if (disposed || !mask?.shadowRoot) return;
    const paths = mask.shadowRoot.querySelectorAll('[data-pointer-mask-path]');
    for (const p of paths) p.remove();
    const svgs = mask.shadowRoot.querySelectorAll<SVGElement>('[data-pointer-mask-svg]');
    for (const s of svgs) s.style.setProperty('pointer-events', 'none', 'important');
  };

  const onPointerCapture = (event: MouseEvent | PointerEvent) => {
    if (disposed || !isHostVisible(host)) return;
    const rect = host.getBoundingClientRect();
    if (
      event.clientX >= rect.left && event.clientX <= rect.right &&
      event.clientY >= rect.top && event.clientY <= rect.bottom
    ) {
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.type === 'click' && (event.button === 0 || event.button === undefined)) {
        event.preventDefault();
        activate();
        host.dataset.suppressed = 'true';
        const btn = host.shadowRoot?.querySelector<HTMLButtonElement>('.native-button');
        btn?.blur();
      } else if (event.type === 'dblclick') {
        event.preventDefault();
      }
    }
  };

  for (const type of CAPTURE_EVENTS) {
    window.addEventListener(type, onPointerCapture, true);
  }

  const unregister = () => {
    maskObserver?.disconnect();
    maskObserver = null;
    mask = null;
  };

  return {
    sync() {
      if (disposed) return;
      let scope: Element | null = null;
      const scopeRootSymbol = Symbol.for('ui.ptr.scope.root');
      for (let node: Node | null = host.isConnected ? host : null; node;
        node = node instanceof ShadowRoot ? node.host : node.parentNode) {
        if (node instanceof Element && (node.hasAttribute('data-ui-ptr-scope') || (node as unknown as Record<symbol, unknown>)[scopeRootSymbol])) {
          scope = node;
          break;
        }
      }
      const nextMask = (scope ? deepQuerySelector('pointer-actions', scope) : null) ?? deepQuerySelector('pointer-actions');
      if (nextMask !== mask) {
        unregister();
        const maskRoot = nextMask?.shadowRoot;
        if (maskRoot) {
          mask = nextMask;
          killMask();
          maskObserver = new MutationObserver(records => {
            for (const r of records) {
              for (const node of r.addedNodes) {
                if (node instanceof Element) {
                  if (node.matches('[data-pointer-mask-path]')) {
                    node.remove();
                  } else {
                    for (const p of node.querySelectorAll('[data-pointer-mask-path]')) {
                      p.remove();
                    }
                  }
                  if (node.matches('[data-pointer-mask-svg]')) {
                    (node as SVGElement).style.setProperty('pointer-events', 'none', 'important');
                  }
                }
              }
            }
          });
          maskObserver.observe(maskRoot, { childList: true, subtree: true });
        }
      } else {
        killMask();
      }
    },
    dispose() {
      disposed = true;
      for (const type of CAPTURE_EVENTS) {
        window.removeEventListener(type, onPointerCapture, true);
      }
      unregister();
    },
  };
}

function insertionPoint(anchor: HTMLElement, service?: string): { controls: HTMLElement; before: HTMLElement } | null {
  if (service === 'Disney+') {
    const controls = anchor.parentElement;
    return controls && controls !== document.body && controls !== document.documentElement ? { controls, before: anchor } : null;
  }

  const wrapped = anchor.closest<HTMLElement>(wrapperSelector);
  let before = wrapped && wrapped.contains(anchor) ? wrapped : anchor;
  // Netflix and Prime Video isolate the fullscreen button inside its own wrapper container.
  // Inserting inside that isolated wrapper can clip the button or inherit hidden layout states.
  if (service === 'Netflix' || service === 'Prime Video') {
    const wrapper = anchor.parentElement;
    if (wrapper && wrapper.querySelectorAll('button,[role="button"]').length === 1) before = wrapper;
  }
  const controls = before.parentElement;
  return controls && controls !== document.body && controls !== document.documentElement ? { controls, before } : null;
}

export const TESTED_SERVICES = ['YouTube', 'Netflix', 'Prime Video', 'Disney+'] as const;
export type TestedService = (typeof TESTED_SERVICES)[number];

export function isTestedService(name?: string): boolean {
  return typeof name === 'string' && (TESTED_SERVICES as readonly string[]).includes(name);
}

export function bindPlayer(video: HTMLVideoElement, previous?: PlayerBinding): PlayerBinding {
  const service = services.find(item => item.host.test(location.hostname));
  const isTested = isTestedService(service?.name);
  const serviceRoot = service ? (video.parentElement?.closest<HTMLElement>(service.player) ?? video.closest<HTMLElement>(service.player)) : null;
  const stackRoot = video.parentElement?.closest<HTMLElement>(genericPlayer) ?? video.closest<HTMLElement>(genericPlayer);
  const player = (serviceRoot && serviceRoot !== video ? serviceRoot : null) ?? (stackRoot && stackRoot !== video ? stackRoot : null);
  const isNative = !service && !stackRoot && isNativeControlsVideo(video);
  let viewport: HTMLElement;
  if (isNative && video.parentElement?.classList.contains('jz-native-player')) {
    viewport = video.parentElement;
  } else {
    viewport = player ?? (video.parentElement && video.parentElement !== document.body && video.parentElement !== document.documentElement ? video.parentElement : video);
    if (viewport === document.body || viewport === document.documentElement) viewport = video;
  }

  // Only attempt native in-player toolbar injection for tested & verified services.
  // Untested services and generic stacks fall back to the floating popup controls.
  // Hover UI and periodic discovery must not rescan a stable toolbar (Disney's
  // fallback traverses the document and open shadow roots). Revalidate its DOM
  // relationships so a replaced/moved toolbar still takes the discovery path.
  const cachedAnchor = previous?.video === video && previous.viewport === viewport
    && previous.controls?.isConnected && previous.controlBefore?.parentElement === previous.controls
    && previous.controlAnchor?.isConnected && previous.controls.contains(previous.controlAnchor)
    && service && previous.controlAnchor.matches(service.fullscreen)
    && previous.controlAnchor.getClientRects().length > 0
    ? previous.controlAnchor : null;
  const anchor = isTested && service ? cachedAnchor ?? localFullscreen(video, serviceRoot, service.fullscreen) : null;
  const point = anchor ? insertionPoint(anchor, service?.name) : null;
  return {
    video, viewport,
    controls: point?.controls ?? null,
    controlBefore: point?.before ?? null,
    controlAnchor: anchor,
    controlClassName: service?.name === 'Netflix' ? point?.before.className
      : service?.name === 'Disney+' ? 'control'
      : service?.name === 'Prime Video' ? point?.before.className || anchor?.className
      : anchor?.className,
    adapter: service?.name ?? (stackRoot ? 'Generic HTML5' : 'Native HTML5'),
  };
}
