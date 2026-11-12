import { DEFAULT_SETTINGS, EMPTY_CROP, type Crop, type FeatureStatus, type PlayerBinding, type Settings } from '../shared/types';
import { AmbienceRenderer } from './ambience';
import { BarFill, hasBars } from './bar-fill';
import { BarHistory, CropTracker, detectBorders, distance } from './detector';
import { DEBUG, debugCount, debugState } from '../shared/debug';
import { FrameSource, type Sample, type Strip, type StripRequest } from './frame-source';
import { AUTO_CROP_AVAILABLE } from '../shared/features';
import { i18n } from '../shared/i18n';

const AMBIENCE_INTERVAL: Record<Settings['ambienceRate'], number> = { performance: 150, high: 75, quality: 40 };
// Settings the effects pipeline reads. Framing (zoom/pan/mode) changes neither the sampled
// frame nor the backdrop, so it must not restart sampling on every gesture step.
// If screenshot compatibility capture returns, its detectorSafe check reads framing too.
const EFFECT_KEYS = ['enabled', 'ambience', 'ambienceRate', 'ambienceFillBars', 'drmWorkaround', 'autoCrop', 'compatibility'] as const;

export class EffectsController {
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private initialized = false;
  private crop: Crop = { ...EMPTY_CROP };
  private target: Crop = { ...EMPTY_CROP };
  private tracker = new CropTracker();
  private source: FrameSource;
  private ambience: AmbienceRenderer;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private disposed = false;
  private generation = 0;
  private intersection = false;
  private observer: IntersectionObserver;
  private resize: ResizeObserver;
  private staticDone = false;
  private lastDetection = 0;
  private sourceUrl = '';
  private sampledTime = -1;
  private statusValue: FeatureStatus = { source: 'idle', message: '' };
  // Bar fill: same detector and hysteresis as Auto Crop, own tracker so neither fights the other.
  private bars = new CropTracker();
  private barHistory = new BarHistory();
  private barFill: BarFill;
  private barCanvas: HTMLCanvasElement | null = null;
  private barCtx: CanvasRenderingContext2D | null = null;
  private barDepth = { w: 192, h: 108 };
  private lastBarDetection = 0;
  private barProtected = false;
  private barSafe = false;
  private lastRetract = '';
  // Exact picture start per edge (fraction of picture depth), refined from full-resolution strips;
  // 0 = no bar or not refined yet. `sentinel` = unfilled rows left on the protected path.
  private exact: Crop = { ...EMPTY_CROP };
  private sentinel: Crop = { ...EMPTY_CROP };
  private barMode: 'off' | 'clip' | 'paint' = 'off';
  private clipSent = false;
  private sentinelLuma: Partial<Record<keyof Crop, number>> = {};
  private stripsRead = 0;
  // applyFill() runs every sample tick; both checks are cached and invalidated by events.
  private clipSafeCache: boolean | null = null;
  private clipChain: MutationObserver | null = null;
  private cuesShowing: boolean | null = null;
  private cuesChanged = (): void => { this.cuesShowing = null; };
  constructor(private readonly binding: PlayerBinding, private readonly onCrop: (crop: Crop) => void, private readonly onStatus: (status: FeatureStatus) => void,
    private readonly onBarClip: (clip: Crop) => void = () => {}) {
    this.sourceUrl = binding.video.currentSrc;
    this.source = new FrameSource(binding, status => this.report(status)); this.ambience = new AmbienceRenderer(binding);
    this.barFill = new BarFill(binding);
    this.ambience.onFrame = () => this.barFill.repaint(this.ambience.backdrop);
    this.observer = new IntersectionObserver(entries => { this.intersection = entries.some(entry => entry.isIntersecting); this.wake(); });
    this.observer.observe(binding.video);
    this.resize = new ResizeObserver(() => { this.clipSafeCache = null; this.wake(); }); this.resize.observe(binding.viewport);
    for (const event of ['play', 'pause', 'seeked']) binding.video.addEventListener(event, this.wake);
    for (const event of ['loadeddata', 'emptied']) binding.video.addEventListener(event, this.sourceChanged);
    binding.video.addEventListener('seeking', this.seeking);
    document.addEventListener('visibilitychange', this.wake); document.addEventListener('fullscreenchange', this.wake);
    for (const event of ['change', 'addtrack', 'removetrack']) binding.video.textTracks.addEventListener(event, this.cuesChanged);
  }
  update(settings: Settings): void {
    settings = { ...settings, autoCrop: AUTO_CROP_AVAILABLE && settings.autoCrop };
    const changed = !this.initialized || EFFECT_KEYS.some(key => this.settings[key] !== settings[key]);
    this.initialized = true;
    const autoChanged = this.settings.autoCrop !== settings.autoCrop;
    if (this.settings.ambience !== settings.ambience || this.settings.drmWorkaround !== settings.drmWorkaround) this.source.reset();
    this.settings = { ...settings };
    if (autoChanged) this.tracker.clearCandidate();
    this.ambience.update(settings.enabled ? settings.ambience : 'off');
    if (!settings.ambienceFillBars) this.resetBars();
    this.applyFill();
    if (changed) this.wake();
  }
  setCrop(crop: Crop): void { this.crop = { ...crop }; this.target = { ...crop }; this.tracker.setCrop(crop); }
  reset(): void { this.source.reset(); this.tracker.reset(); this.crop = { ...EMPTY_CROP }; this.target = { ...EMPTY_CROP }; this.onCrop(this.crop); this.wake(); }
  private report(value: FeatureStatus): void {
    if (this.settings.enabled && this.settings.ambience !== 'off' && !this.ambience.available && value.source !== 'idle') {
      value = { ...value, message: `${value.message} ${i18n.t('status_ambience_container')}` };
    }
    if (this.disposed || value.source === this.statusValue.source && value.message === this.statusValue.message) return;
    this.statusValue = value; this.onStatus(value);
  }
  private seeking = (): void => {
    this.tracker.clearCandidate(); this.source.invalidate(); this.generation++; this.staticDone = false;
    this.bars.clearCandidate();
  };
  // A new media resource may be readable even if the previous one tainted the canvas.
  private sourceChanged = (): void => { this.source.reset(); this.resetBars(); this.wake(); };
  private fillWanted(): boolean {
    const s = this.settings;
    // Auto Crop already removes the bars; a video-only fullscreen subtree can't show siblings.
    return s.enabled && s.ambience !== 'off' && s.ambienceFillBars && !s.autoCrop && this.ambience.available;
  }
  private resetBars(): void {
    this.bars.reset(); this.barHistory.reset(); this.barFill.dispose();
    this.exact = { ...EMPTY_CROP }; this.sentinel = { ...EMPTY_CROP }; this.sentinelLuma = {};
    if (this.barCanvas) this.barCanvas.width = this.barCanvas.height = 0;
    this.barCanvas = null; this.barCtx = null;
    this.applyFill();
    this.debugBars();
  }
  private pairs(crop: Crop): Crop {
    // Show a pair only once both of its edges are refined.
    const out = { ...EMPTY_CROP };
    if (crop.top > 0 && crop.bottom > 0) { out.top = crop.top; out.bottom = crop.bottom; }
    if (crop.left > 0 && crop.right > 0) { out.left = crop.left; out.right = crop.right; }
    return out;
  }
  /** Padding to keep out of the Ambience source: every refined bar row, sentinel included. */
  private contentCrop(): Crop { return this.pairs(this.exact); }
  /** What is clipped/painted: the refined bars minus the protected-path sentinel. */
  private barRegion(): Crop {
    const region = { ...EMPTY_CROP };
    for (const edge of ['top', 'right', 'bottom', 'left'] as const) if (this.exact[edge] > 0) region[edge] = Math.max(1e-4, this.exact[edge] - this.sentinel[edge]);
    return this.pairs(region);
  }
  /**
   * Clipping the video lets the main backdrop show through the bars: one continuous Ambience at no
   * draw cost. It needs nothing opaque between the video and the backdrop's host; otherwise a copy
   * of the backdrop is painted over the bars with the same mapping.
   */
  private clipSafe(): boolean {
    // Cached; a style/class write on the chain, a resize or any wake() recomputes it.
    if (this.clipSafeCache !== null) return this.clipSafeCache;
    const { video, viewport } = this.binding;
    const opaque = (el: Element) => {
      const cs = getComputedStyle(el), alpha = /rgba\([^)]*,\s*([\d.]+)\)$/.exec(cs.backgroundColor);
      return cs.backgroundImage !== 'none' || cs.backgroundColor !== 'transparent' && (!alpha || Number(alpha[1]) > .05);
    };
    if (!this.clipChain) {
      this.clipChain = new MutationObserver(() => { this.clipSafeCache = null; });
      for (let el: Element | null = video; el && el !== viewport; el = el.parentElement) this.clipChain.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    let safe = !opaque(video);
    for (let el: Element | null = video.parentElement; safe && el !== viewport; el = el?.parentElement ?? null) if (!el || opaque(el)) safe = false;
    return this.clipSafeCache = safe;
  }
  /** Native cues paint inside the video box (in the bottom bar), so neither fill mode may cover them. */
  private nativeCuesShowing(): boolean {
    // Mode changes fire `change` on the track list; cached between them.
    return this.cuesShowing ??= Array.from(this.binding.video.textTracks).some(track => track.mode === 'showing' && (track.kind === 'subtitles' || track.kind === 'captions'));
  }
  private applyFill(): void {
    const region = this.barRegion();
    const mode = !this.fillWanted() || !hasBars(region) || this.nativeCuesShowing() ? 'off' : this.clipSafe() ? 'clip' : 'paint';
    this.barMode = mode;
    if (mode === 'clip') { this.onBarClip(region); this.clipSent = true; }
    else if (this.clipSent) { this.onBarClip({ ...EMPTY_CROP }); this.clipSent = false; }
    if (mode === 'paint') this.barFill.setBars(region); else this.barFill.dispose();
  }
  /** True while the bars on screen (and in screenshots) show Ambience instead of the video. */
  private fillShown(): boolean { return this.barMode === 'clip' || this.barMode === 'paint' && this.barFill.visible; }
  /** Full-resolution bands around each coarse boundary; the coarse sample row is ~8-10 CSS px. */
  private stripRequests(): StripRequest[] {
    const coarse = hasBars(this.bars.crop) ? this.bars.crop : this.barHistory.diagnostics.reason === 'ok' ? this.lastObservation : EMPTY_CROP;
    const out: StripRequest[] = [];
    for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
      if (!(coarse[edge] > 0)) continue;
      const step = 1 / (edge === 'top' || edge === 'bottom' ? this.barDepth.h : this.barDepth.w), end = coarse[edge] + step;
      out.push({ edge, from: Math.max(0, end - 3 * step), to: Math.min(.36, end + 3 * step) });
    }
    return out;
  }
  private lastObservation: Crop = { ...EMPTY_CROP };
  /** First row (outer → inner) where the picture starts, as a picture fraction; null if the band is all dark. */
  private refineEdge(strip: Strip, dark: number): number | null {
    const m = strip.medians;
    for (let i = 1; i + 1 < m.length; i++) if (m[i]! > dark && m[i + 1]! > dark) return strip.from + i / strip.depth;
    return null;
  }
  private detectBars(sample: Sample, now: number): void {
    this.barSafe = sample.detectorSafe;
    if (!sample.detectorSafe) return;
    const protectedFrame = sample.source === 'compatibility';
    if (protectedFrame !== this.barProtected) { this.barProtected = protectedFrame; this.bars.clearCandidate(); this.barHistory.reset(); this.exact = { ...EMPTY_CROP }; this.sentinel = { ...EMPTY_CROP }; }
    if (!protectedFrame && now - this.lastBarDetection < 400) return;
    this.lastBarDetection = now;
    const { width: w, height: h } = sample.canvas;
    if (!this.barCanvas) { this.barCanvas = document.createElement('canvas'); this.barCtx = this.barCanvas.getContext('2d', { willReadFrequently: true }); }
    if (!this.barCtx) return;
    if (this.barCanvas.width !== w || this.barCanvas.height !== h) { this.barCanvas.width = w; this.barCanvas.height = h; }
    this.barCtx.drawImage(sample.canvas, 0, 0);
    const pixels = this.barCtx.getImageData(0, 0, w, h);
    const filled = protectedFrame && this.fillShown(), dark = protectedFrame ? 16 : 14;
    // The screenshot shows Ambience where the bars were; restore them as black (rounding outward)
    // so the coarse detector still sees the accepted padding and can track bars that grow.
    if (filled) {
      const region = this.contentCrop(), data = pixels.data;
      const top = Math.ceil(region.top * h), bottom = h - Math.ceil(region.bottom * h);
      const left = Math.ceil(region.left * w), right = w - Math.ceil(region.right * w);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (y >= top && y < bottom && x >= left && x < right) continue;
        const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
    this.barDepth = { w, h };
    this.bars.maxGap = protectedFrame ? 4000 : 1400;
    const observation = this.barHistory.observe(pixels, now, protectedFrame);
    if (observation) this.lastObservation = { ...observation.crop };
    debugCount(observation ? 'barObservation' : 'barObservationNone');
    const strips = sample.strips ?? [];
    if (strips.length) this.stripsRead++;
    const accepted = this.bars.crop, size = { top: h, bottom: h, left: w, right: w };
    if (filled) {
      // Only the sentinel rows still show the video. Picture there on both sides of a pair means the
      // picture opened up (IMAX, a new clip): retract within this capture. One side alone is a player
      // overlay (progress bar, captions) and is ignored.
      const lit: Partial<Record<keyof Crop, boolean>> = {};
      for (const strip of strips) {
        const e = this.exact[strip.edge], sv = this.sentinel[strip.edge];
        if (!(e > 0)) continue;
        const i0 = Math.max(0, Math.round((e - sv - strip.from) * strip.depth)), i1 = Math.min(strip.medians.length, Math.round((e - strip.from) * strip.depth));
        if (i1 <= i0) continue;
        let min = 255; for (let i = i0; i < i1; i++) min = Math.min(min, strip.medians[i]!);
        this.sentinelLuma[strip.edge] = min; lit[strip.edge] = min > dark;
      }
      if (lit.top && lit.bottom || lit.left && lit.right) {
        debugCount('barRetract'); this.lastRetract = (['top', 'right', 'bottom', 'left'] as const).filter(edge => lit[edge]).join(',');
        // Under the fill the true new extent is unknown: drop it and the masked history, re-acquire unfilled.
        this.bars.reset(); this.barHistory.reset(); this.exact = { ...EMPTY_CROP }; this.sentinel = { ...EMPTY_CROP };
        this.applyFill(); return;
      }
      if (Object.values(lit).some(Boolean)) debugCount('barRetractIgnored');
      // Growth still goes through hysteresis; coarse shrink can't be seen under the fill.
      if (observation && this.bars.observe(observation, now)) { debugCount('barAccepted'); this.exact = { ...EMPTY_CROP }; this.applyFill(); }
      return;
    }
    // Unfilled frames show the real bars: refine the exact boundary from full-resolution rows.
    const refined: Partial<Record<keyof Crop, number>> = {};
    for (const strip of strips) { const value = this.refineEdge(strip, dark); if (value !== null) refined[strip.edge] = value; }
    // Ambiguous (dark scene, fade, black frame): never create or remove bars; only a lit row inside
    // the refined bar (picture there for real) may shrink it.
    if (observation) {
      const shrunk = (['top', 'right', 'bottom', 'left'] as const).filter(edge => observation.crop[edge] < accepted[edge] - .5 / size[edge]);
      if (shrunk.length) {
        debugCount('barRetract'); this.lastRetract = shrunk.join(',');
        const next = { ...accepted };
        for (const edge of shrunk) { next[edge] = observation.crop[edge]; this.exact[edge] = 0; }
        this.bars.setCrop(next);
      } else if (this.bars.observe(observation, now)) { debugCount('barAccepted'); this.exact = { ...EMPTY_CROP }; }
    }
    const crop = this.bars.crop;
    for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
      const value = refined[edge], step = 1 / size[edge];
      if (!(crop[edge] > 0)) { this.exact[edge] = 0; continue; }
      // Trust a refinement only near the accepted coarse boundary; afterwards it may only shrink the bar.
      if (value === undefined || Math.abs(value - (crop[edge] + step)) > 2.5 * step) continue;
      this.exact[edge] = this.exact[edge] > 0 ? Math.min(this.exact[edge], value) : value;
      this.sentinel[edge] = protectedFrame ? 3 / strips.find(strip => strip.edge === edge)!.depth : 0;
    }
    this.applyFill();
  }
  private wake = (): void => {
    if (this.disposed) return;
    this.staticDone = false; this.generation++; this.source.invalidate();
    this.sampledTime = -1; this.clipSafeCache = null; this.cuesShowing = null;
    this.ambience.update(this.settings.enabled ? this.settings.ambience : 'off');
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    if (!this.busy) void this.tick();
  };
  private wanted(): boolean { return this.settings.enabled && (this.settings.autoCrop || this.settings.ambience !== 'off' && this.ambience.available); }
  private async tick(): Promise<void> {
    if (this.disposed || this.busy) return;
    if (!this.wanted()) {
      this.report(this.settings.enabled && this.settings.ambience !== 'off' && !this.ambience.available
        ? { source: 'unavailable', message: i18n.t('status_ambience_fullscreen') }
        : { source: 'idle', message: '' }); return;
    }
    // Out of sight: finish any Ambience morph now instead of animating unseen.
    if (document.hidden || !this.intersection || !this.binding.video.isConnected) { this.ambience.settle(); return; }
    if (this.binding.video.paused && this.staticDone) return;
    const generation = this.generation;
    this.busy = true;
    try {
      const video = this.binding.video;
      if (this.sourceUrl !== video.currentSrc) { this.sourceUrl = video.currentSrc; this.sampledTime = -1; this.source.reset(); this.tracker.reset(); this.resetBars(); this.crop = { ...EMPTY_CROP }; this.target = { ...EMPTY_CROP }; this.onCrop(this.crop); }
      // Buffering/stalled media can keep the timer alive without producing new frames.
      if (this.sampledTime === video.currentTime) return;
      const fill = this.fillWanted();
      const sample = await this.source.sample(this.settings, this.crop, {
        readPixels: this.settings.autoCrop,
        // The detector needs real resolution; Colour mode alone would sample 32 px wide.
        width: this.settings.ambience === 'colour' && !fill ? 32 : 192,
        strips: fill && (this.barProtected || performance.now() - this.lastBarDetection >= 400) ? this.stripRequests() : undefined,
      });
      if (this.disposed || generation !== this.generation) return;
      const now = performance.now();
      if (sample) {
        this.sampledTime = video.currentTime;
        if (this.settings.autoCrop && sample.detectorSafe && sample.pixels && now - this.lastDetection >= 400) {
          this.lastDetection = now;
          const accepted = this.tracker.observe(detectBorders(sample.pixels), now); if (accepted) this.target = accepted;
        }
        let ambienceCrop = sample.source === 'direct' ? this.crop : EMPTY_CROP;
        if (fill) {
          this.detectBars(sample, now);
          // Backdrop from content only: keeps black (or, in screenshots, our own fill) out of it.
          if (sample.detectorSafe) ambienceCrop = this.contentCrop();
        }
        if (this.settings.ambience !== 'off') this.ambience.render(sample.canvas, sample.canvas.width, sample.canvas.height, ambienceCrop, now, sample.source === 'compatibility');
      }
      if (fill) { this.applyFill(); if (sample && this.barMode === 'paint') this.barFill.paint(this.ambience.backdrop); this.debugBars(); }
      else if (this.barMode !== 'off') this.applyFill();
      // The transform engine owns visual interpolation. Do not ease the same
      // crop again here: that would freeze partway when screenshot sampling
      // must hold because the accepted crop hides the source boundaries.
      if (this.settings.autoCrop) {
        const next = { ...this.crop }; let moved = false;
        for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
          next[edge] = this.target[edge];
          moved ||= Math.abs(next[edge] - this.crop[edge]) > .0001;
        }
        if (moved) { this.crop = next; this.onCrop({ ...next }); }
      }
      this.staticDone = video.paused && sample !== null;
    } catch {
      this.report({ source: 'unavailable', message: i18n.t('status_effects_unavailable') });
    } finally {
      this.busy = false;
      // An unreadable source returns null immediately; keep it dormant until wake()
      // (lifecycle/settings) or a source change gives sampling a reason to retry.
      if (!this.disposed && this.wanted() && !document.hidden && this.intersection && !(this.binding.video.paused && this.staticDone)
        && !this.source.isTerminal(this.settings)) {
        const interval = this.binding.video.paused ? 1500 : this.settings.ambience !== 'off' ? AMBIENCE_INTERVAL[this.settings.ambienceRate] : 450;
        // Protected screenshot sampling is rate-limited; skip no-op ticks until it can capture again.
        this.timer = setTimeout(() => { this.timer = null; void this.tick(); }, Math.max(interval, this.source.nextSampleDelay()));
      }
    }
  }
  dispose(): void {
    this.disposed = true; this.generation++; if (this.timer) clearTimeout(this.timer); this.timer = null;
    this.observer.disconnect(); this.resize.disconnect(); this.source.dispose(); this.ambience.dispose(); this.resetBars();
    this.clipChain?.disconnect(); this.clipChain = null;
    for (const event of ['change', 'addtrack', 'removetrack']) this.binding.video.textTracks.removeEventListener(event, this.cuesChanged);
    for (const event of ['play', 'pause', 'seeked']) this.binding.video.removeEventListener(event, this.wake);
    for (const event of ['loadeddata', 'emptied']) this.binding.video.removeEventListener(event, this.sourceChanged);
    this.binding.video.removeEventListener('seeking', this.seeking);
    document.removeEventListener('visibilitychange', this.wake); document.removeEventListener('fullscreenchange', this.wake);
  }
  private debugBars(): void {
    if (!DEBUG) return;
    const round = (crop: Crop) => Object.fromEntries(Object.entries(crop).map(([edge, value]) => [edge, +value.toFixed(3)]));
    debugState({ barFill: {
      wanted: !this.disposed && this.fillWanted(), path: this.barProtected ? 'protected' : 'direct',
      bars: round(this.bars.crop), region: round(this.barRegion()), visible: this.barFill.visible, placed: this.barFill.placed,
      lastRetract: this.lastRetract, mode: this.barMode, exact: round(this.exact), sentinel: round(this.sentinel),
      sentinelLuma: this.sentinelLuma, stripsRead: this.stripsRead, sample: `${this.barDepth.w}x${this.barDepth.h}`, safe: this.barSafe,
      diag: this.barHistory.diagnostics,
    } });
  }
}
