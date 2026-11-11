import { debugLog } from '../shared/debug';
import type { PlayerBinding } from '../shared/types';
import { cueControlsElement } from './cue-adapters';
import { readCueRules, resolveCueValue, type CueRules } from './cue-style';

// Chrome paints native text-track cues (`::cue`) inside the video box, so our
// scale/translate also zooms the subtitles and Fill/zoom can push them off-screen.
// While just_zoom is active on the player (this controller lives exactly as long as
// the TransformEngine) we set showing subtitle/caption tracks to `hidden` (cues and
// `cuechange` keep firing, Chrome stops painting) and draw the active cues ourselves
// over the visible player box, at any zoom, for consistent styling and the control
// bar lift. A native video fullscreen (nothing can be layered over it) or dispose
// hands the tracks back.

export interface CueOverlayController { dispose(): void }

const STYLE = `
:host { all: initial; }
.box { position: absolute; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; gap: .15em;
  text-align: center; transition: bottom .2s ease; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; line-height: 1.25; }
.cue { max-width: 90%; white-space: pre-line; color: #fff; }
.cue > span { background: rgba(0, 0, 0, .8); padding: .05em .3em; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
`;
const isSubtitleTrack = (track: TextTrack) => track.kind === 'subtitles' || track.kind === 'captions';
// A site that keeps forcing a track back to `showing` wins after this many takeovers.
const MAX_TAKEOVERS = 6, TAKEOVER_WINDOW_MS = 3000;

export function createCueOverlay(getBinding: () => PlayerBinding): CueOverlayController {
  const video = getBinding().video;
  const tracks = video.textTracks;
  // Tracks we switched to `hidden`, with the mode to hand back.
  const owned = new Map<TextTrack, TextTrackMode>();
  const takeovers = new Map<TextTrack, number[]>();
  const yielded = new WeakSet<TextTrack>();
  let host: HTMLDivElement | null = null, box: HTMLDivElement | null = null;
  let frame = 0, disposed = false, needsRender = false;
  // Optional site control bar: subtitles sit above it while it is visible.
  let bar: HTMLElement | null = null, barTimer = 0;
  const barMutations = new MutationObserver(() => onBarChange());
  const barResize = new ResizeObserver(() => onBarChange());
  // The page's own ::cue rules, re-read on cuechange and <head> changes.
  let pageStyle: HTMLStyleElement | null = null, cueRules: CueRules = { signature: '', decls: [] }, appliedCss = '';
  const headObserver = new MutationObserver(() => { if (refreshStyle()) schedule(); });
  const refreshStyle = () => {
    const next = readCueRules(video);
    if (next.signature === cueRules.signature) return false;
    cueRules = next; appliedCss = '';
    return true;
  };

  const onCueChange = () => { try { if (refreshStyle()) schedule(); render(); } catch (error) { debugLog('cueOverlay', String(error)); } };

  const takeOver = (track: TextTrack) => {
    if (yielded.has(track)) return;
    const now = performance.now();
    const recent = (takeovers.get(track) ?? []).filter(t => now - t < TAKEOVER_WINDOW_MS);
    recent.push(now); takeovers.set(track, recent);
    if (recent.length > MAX_TAKEOVERS) {
      // The page re-shows the track as fast as we hide it: leave it native.
      yielded.add(track); release(track); return;
    }
    if (!owned.has(track)) { owned.set(track, track.mode); track.addEventListener('cuechange', onCueChange); needsRender = true; }
    track.mode = 'hidden';
  };

  const release = (track: TextTrack, restore = true) => {
    const original = owned.get(track);
    if (original === undefined) return;
    owned.delete(track);
    track.removeEventListener('cuechange', onCueChange);
    needsRender = true;
    // Only hand back a mode we set; a page that disabled the track keeps its choice.
    if (restore && track.mode === 'hidden') track.mode = original;
  };

  const releaseAll = () => {
    for (const track of [...owned.keys()]) release(track);
    host?.remove(); host = box = pageStyle = null; appliedCss = '';
    headObserver.disconnect();
    watchBar(null);
  };

  // Hiding is usually a class on an ancestor that starts a transform/opacity
  // transition, so re-measure once more after it has run. Only the bar and a few
  // ancestors' attributes are watched: the seek bar and clock update constantly.
  function onBarChange() {
    schedule();
    clearTimeout(barTimer);
    barTimer = window.setTimeout(schedule, 350);
  }
  const onBarTransition = (event: Event) => { if (event.target === bar) onBarChange(); };
  const watchBar = (next: HTMLElement | null) => {
    if (next === bar) return;
    barMutations.disconnect(); barResize.disconnect();
    bar?.removeEventListener('transitionend', onBarTransition);
    clearTimeout(barTimer); barTimer = 0;
    bar = next;
    if (!bar) return;
    for (let el: HTMLElement | null = bar, depth = 0; el && depth < 4; el = el.parentElement, depth++) {
      barMutations.observe(el, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    }
    barResize.observe(bar);
    bar.addEventListener('transitionend', onBarTransition);
  };
  // Pixels the bar covers at the bottom of the visible box, 0 when hidden.
  const barOverlap = (r: { left: number; top: number; width: number; height: number }) => {
    if (!bar?.isConnected) return 0;
    const b = bar.getBoundingClientRect();
    const bottom = r.top + r.height;
    if (!b.width || !b.height || b.top >= bottom || b.bottom <= r.top || b.right <= r.left || b.left >= r.left + r.width) return 0;
    for (let el: HTMLElement | null = bar, depth = 0; el && depth < 6; el = el.parentElement, depth++) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number.parseFloat(cs.opacity) < 0.05) return 0;
    }
    return Math.max(0, Math.min(r.height * 0.5, bottom - b.top));
  };

  const mount = () => {
    const parent = video.parentElement;
    if (!parent) return false;
    if (!host) {
      host = document.createElement('div');
      // jz-controls-host keeps discovery and gestures from treating it as page UI.
      host.className = 'jz-cue-host jz-controls-host';
      host.setAttribute('aria-hidden', 'true');
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = STYLE;
      box = document.createElement('div');
      box.className = 'box';
      pageStyle = document.createElement('style');
      shadow.append(style, pageStyle, box);
      refreshStyle();
      if (document.head) headObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
    }
    // A sibling right after the video paints above it but below later player
    // controls, and is inside whatever element the site fullscreens.
    if (host.parentElement !== parent || host.previousSibling !== video) video.after(host);
    const z = Number.parseInt(getComputedStyle(video).zIndex, 10);
    host.style.cssText = `position:absolute!important;margin:0!important;padding:0!important;border:0!important;pointer-events:none!important;user-select:none!important;overflow:hidden!important;z-index:${Number.isFinite(z) ? z : 'auto'}!important;`;
    return true;
  };

  // The visible player box in viewport coordinates, never the scaled video rect.
  const visibleRect = () => {
    const { viewport } = getBinding();
    let left: number, top: number, width: number, height: number;
    if (viewport !== video) {
      ({ left, top, width, height } = viewport.getBoundingClientRect());
    } else {
      // Bare video: undo our scale/translate around its transform origin.
      const rect = video.getBoundingClientRect(), cs = getComputedStyle(video);
      const scale = Number.parseFloat(cs.scale) || 1;
      const [tx = 0, ty = 0] = cs.translate === 'none' ? [] : cs.translate.split(' ').map(v => Number.parseFloat(v) || 0);
      const [ox = 0, oy = 0] = cs.transformOrigin.split(' ').map(v => Number.parseFloat(v) || 0);
      width = video.offsetWidth; height = video.offsetHeight;
      left = rect.left - ox * (1 - scale) - tx; top = rect.top - oy * (1 - scale) - ty;
    }
    const right = Math.min(left + width, innerWidth), bottom = Math.min(top + height, innerHeight);
    left = Math.max(0, left); top = Math.max(0, top);
    return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  };

  const position = () => {
    if (!host || !box) return;
    const r = visibleRect();
    // Absolute coordinates are relative to the host's containing block.
    const container = host.offsetParent as HTMLElement | null;
    let ox = scrollX, oy = scrollY;
    if (container && !(container === document.body && getComputedStyle(container).position === 'static')) {
      const c = container.getBoundingClientRect();
      ox = -c.left + container.scrollLeft - container.clientLeft;
      oy = -c.top + container.scrollTop - container.clientTop;
    }
    host.style.setProperty('left', `${r.left + ox}px`, 'important');
    host.style.setProperty('top', `${r.top + oy}px`, 'important');
    host.style.setProperty('width', `${r.width}px`, 'important');
    host.style.setProperty('height', `${r.height}px`, 'important');
    // Chrome's default ::cue size is 5% of the video box; a page rule replaces it.
    const fallback = Math.max(12, r.height * 0.05);
    let fontSize = `${fallback}px`, css = '';
    for (const [prop, value] of cueRules.decls) {
      const resolved = resolveCueValue(value, r);
      if (prop === 'font-size') fontSize = resolved.endsWith('%') ? `${fallback * Number.parseFloat(resolved) / 100}px` : resolved;
      else css += `${prop}:${resolved}!important;`;
    }
    box.style.fontSize = fontSize;
    if (css !== appliedCss && pageStyle) { appliedCss = css; pageStyle.textContent = css ? `.cue > span{${css}}` : ''; }
    box.style.bottom = `${Math.round(r.height * 0.05 + barOverlap(r))}px`;
  };

  const render = () => {
    if (!box) return;
    box.replaceChildren();
    // A torn-down or failed source (readyState 0) paints no cues natively either.
    if (video.readyState === HTMLMediaElement.HAVE_NOTHING) return;
    for (const track of owned.keys()) {
      for (const cue of Array.from(track.activeCues ?? [])) {
        const line = document.createElement('div'), span = document.createElement('span');
        line.className = 'cue';
        // getCueAsHTML() is the browser's own WebVTT parse: inert nodes, no markup injection.
        if (cue instanceof VTTCue) span.append(cue.getCueAsHTML());
        else span.textContent = (cue as { text?: string }).text ?? '';
        line.append(span); box.append(line);
      }
    }
  };

  const sync = () => {
    frame = 0;
    if (disposed) return;
    try {
      const active = video.isConnected && document.fullscreenElement !== video;
      if (!active) { if (owned.size || host) releaseAll(); return; }
      for (const track of Array.from(tracks)) {
        if (!isSubtitleTrack(track)) continue;
        if (track.mode === 'showing') takeOver(track);
        // The page or user turned it off: stop drawing, keep their choice.
        else if (track.mode === 'disabled' && owned.has(track)) release(track, false);
      }
      if (!owned.size) { host?.remove(); host = box = pageStyle = null; appliedCss = ''; headObserver.disconnect(); watchBar(null); return; }
      if (!host) needsRender = true;
      if (!mount()) { releaseAll(); return; }
      watchBar(cueControlsElement(video));
      position();
      if (needsRender) { needsRender = false; render(); }
    } catch (error) {
      // Never leave a track stuck hidden because the overlay failed.
      debugLog('cueOverlay', String(error));
      try { releaseAll(); } catch { /* Playback stays untouched. */ }
    }
  };
  const schedule = () => { if (!frame && !disposed) frame = requestAnimationFrame(sync); };
  const onRemoveTrack = (event: TrackEvent) => {
    if (event.track instanceof TextTrack) { owned.delete(event.track); event.track.removeEventListener('cuechange', onCueChange); }
    needsRender = true; schedule();
  };

  // A bare video's visible box depends on our inline scale/translate: re-position on writes.
  const styleObserver = new MutationObserver(() => { if (host) schedule(); });
  styleObserver.observe(video, { attributes: true, attributeFilter: ['style'] });
  const resizeObserver = new ResizeObserver(() => { if (host) schedule(); });
  resizeObserver.observe(getBinding().viewport);
  // Source swaps, failures and seeks can leave activeCues changed without a cuechange
  // on the old track, so redraw from activeCues (empty clears the text).
  const rerender = () => { needsRender = true; schedule(); };
  const MEDIA_RESETS = ['emptied', 'loadstart', 'abort', 'error', 'seeking', 'seeked', 'ended'] as const;
  for (const type of MEDIA_RESETS) video.addEventListener(type, rerender);
  tracks.addEventListener('change', rerender);
  tracks.addEventListener('addtrack', schedule);
  tracks.addEventListener('removetrack', onRemoveTrack);
  document.addEventListener('fullscreenchange', schedule);
  window.addEventListener('resize', schedule);
  schedule();

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame); frame = 0;
      styleObserver.disconnect(); resizeObserver.disconnect();
      watchBar(null);
      for (const type of MEDIA_RESETS) video.removeEventListener(type, rerender);
      tracks.removeEventListener('change', rerender);
      tracks.removeEventListener('addtrack', schedule);
      tracks.removeEventListener('removetrack', onRemoveTrack);
      document.removeEventListener('fullscreenchange', schedule);
      window.removeEventListener('resize', schedule);
      try { releaseAll(); } catch { /* Playback stays untouched. */ }
    },
  };
}
