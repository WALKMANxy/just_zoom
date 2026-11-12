import { DEFAULT_SETTINGS, EMPTY_CROP, type Crop, type FeatureStatus, type PlayerBinding, type Settings } from '../shared/types';
import { AmbienceRenderer } from './ambience';
import { BarFill, hasBars } from './bar-fill';
import { BarHistory, CropTracker, detectBorders, distance } from './detector';
import { DEBUG, debugCount, debugState } from '../shared/debug';
import { FrameSource, type Sample } from './frame-source';
import { AUTO_CROP_AVAILABLE } from '../shared/features';
import { i18n } from '../shared/i18n';

const AMBIENCE_INTERVAL: Record<Settings['ambienceRate'], number> = { performance: 150, high: 75, quality: 40 };
// Settings the effects pipeline reads. Framing (zoom/pan/mode) changes neither the sampled
// frame nor the backdrop, so it must not restart sampling on every gesture step.
// If screenshot compatibility capture returns, its detectorSafe check reads framing too.
const EFFECT_KEYS = ['enabled', 'ambience', 'ambienceRate', 'ambienceFillBars', 'autoCrop', 'compatibility'] as const;

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
  constructor(private readonly binding: PlayerBinding, private readonly onCrop: (crop: Crop) => void, private readonly onStatus: (status: FeatureStatus) => void) {
    this.sourceUrl = binding.video.currentSrc;
    this.source = new FrameSource(binding, status => this.report(status)); this.ambience = new AmbienceRenderer(binding);
    this.barFill = new BarFill(binding);
    this.ambience.onFrame = () => this.barFill.repaint(this.ambience.backdrop);
    this.observer = new IntersectionObserver(entries => { this.intersection = entries.some(entry => entry.isIntersecting); this.wake(); });
    this.observer.observe(binding.video);
    this.resize = new ResizeObserver(() => this.wake()); this.resize.observe(binding.viewport);
    for (const event of ['play', 'pause', 'seeked']) binding.video.addEventListener(event, this.wake);
    for (const event of ['loadeddata', 'emptied']) binding.video.addEventListener(event, this.sourceChanged);
    binding.video.addEventListener('seeking', this.seeking);
    document.addEventListener('visibilitychange', this.wake); document.addEventListener('fullscreenchange', this.wake);
  }
  update(settings: Settings): void {
    settings = { ...settings, autoCrop: AUTO_CROP_AVAILABLE && settings.autoCrop };
    const changed = !this.initialized || EFFECT_KEYS.some(key => this.settings[key] !== settings[key]);
    this.initialized = true;
    const autoChanged = this.settings.autoCrop !== settings.autoCrop;
    if (this.settings.ambience !== settings.ambience) this.source.reset();
    this.settings = { ...settings };
    if (autoChanged) this.tracker.clearCandidate();
    this.ambience.update(settings.enabled ? settings.ambience : 'off');
    if (!settings.ambienceFillBars) this.resetBars();
    this.syncBarFill();
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
    if (this.barCanvas) this.barCanvas.width = this.barCanvas.height = 0;
    this.barCanvas = null; this.barCtx = null;
    this.debugBars();
  }
  /**
   * Fill region in source fractions. The detector keeps one boundary row (its last dark row).
   * Direct frames show the real video under the fill, so the fill covers that row too. Protected
   * screenshots include the fill itself, so the last two dark rows stay unfilled as a seam: picture
   * appearing there is the only way a screenshot can show bars shrinking (IMAX opening up, a new
   * clip). Two rows, because the screenshot crop can land one sample row off between captures.
   */
  private barRegion(): Crop {
    const crop = this.bars.crop;
    if (!hasBars(crop)) return crop;
    const { w, h } = this.barDepth;
    if (this.barProtected) return {
      top: Math.max(0, crop.top - 1 / h), bottom: Math.max(0, crop.bottom - 1 / h),
      left: Math.max(0, crop.left - 1 / w), right: Math.max(0, crop.right - 1 / w),
    };
    return {
      top: crop.top && crop.top + 1 / h, bottom: crop.bottom && crop.bottom + 1 / h,
      left: crop.left && crop.left + 1 / w, right: crop.right && crop.right + 1 / w,
    };
  }
  private syncBarFill(): void {
    if (!this.fillWanted()) { this.barFill.dispose(); return; }
    this.barFill.setBars(this.barRegion());
  }
  private detectBars(sample: Sample, now: number): void {
    this.barSafe = sample.detectorSafe;
    if (!sample.detectorSafe) return;
    const protectedFrame = sample.source === 'compatibility';
    if (protectedFrame !== this.barProtected) { this.barProtected = protectedFrame; this.bars.clearCandidate(); this.barHistory.reset(); }
    if (!protectedFrame && now - this.lastBarDetection < 400) return;
    this.lastBarDetection = now;
    const { width: w, height: h } = sample.canvas;
    if (!this.barCanvas) { this.barCanvas = document.createElement('canvas'); this.barCtx = this.barCanvas.getContext('2d', { willReadFrequently: true }); }
    if (!this.barCtx) return;
    if (this.barCanvas.width !== w || this.barCanvas.height !== h) { this.barCanvas.width = w; this.barCanvas.height = h; }
    this.barCtx.drawImage(sample.canvas, 0, 0);
    const pixels = this.barCtx.getImageData(0, 0, w, h);
    const filled = protectedFrame && this.barFill.visible;
    // The screenshot shows our own fill where the bars were; restore them as black so the
    // detector still sees the accepted padding and can track bars that grow beyond it.
    if (filled) {
      const region = this.barRegion(), data = pixels.data;
      const top = Math.round(region.top * h), bottom = h - Math.round(region.bottom * h);
      const left = Math.round(region.left * w), right = w - Math.round(region.right * w);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (y >= top && y < bottom && x >= left && x < right) continue;
        const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
    this.barDepth = { w, h };
    this.bars.maxGap = protectedFrame ? 4000 : 1400;
    const observation = this.barHistory.observe(pixels, now, protectedFrame);
    debugCount(observation ? 'barObservation' : 'barObservationNone');
    // Ambiguous (dark scene, fade, black frame): keep the accepted bars, never create or remove them.
    if (!observation) return;
    const accepted = this.bars.crop, size = { top: h, bottom: h, left: w, right: w };
    const shrunk = (['top', 'right', 'bottom', 'left'] as const).filter(edge => observation.crop[edge] < accepted[edge] - (filled ? 1.5 : .5) / size[edge]);
    if (shrunk.length) {
      // Picture where bars were: retract at once (growth still goes through hysteresis below).
      debugCount('barRetract');
      this.lastRetract = shrunk.join(',');
      if (filled) {
        // Picture opening up is centred, while player overlays (progress bar, captions) sit on one
        // side: in a screenshot, retract only when both seams of a pair lit up.
        const runs = this.barHistory.diagnostics.runs, lit = (edge: keyof Crop) => runs[edge] < accepted[edge] * size[edge] + 1 - 1.5;
        if (!(accepted.top && lit('top') && lit('bottom') || accepted.left && lit('left') && lit('right'))) { debugCount('barRetractIgnored'); return; }
        // Masked screenshot: only the seam is real, the true new extent is unknown. Drop the fill
        // and the masked history; re-acquire from unfilled captures with normal hysteresis.
        this.bars.reset(); this.barHistory.reset(); this.barFill.hold(true); this.barFill.setBars(EMPTY_CROP); this.barFill.hold(false);
        return;
      }
      const next = { ...accepted };
      for (const edge of shrunk) next[edge] = observation.crop[edge];
      this.bars.setCrop(next);
      return;
    }
    const next = this.bars.observe(observation, now);
    if (next) debugCount('barAccepted');
  }
  private wake = (): void => {
    if (this.disposed) return;
    this.staticDone = false; this.generation++; this.source.invalidate();
    this.sampledTime = -1;
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
    // Out of sight: finish any low-rate morph now instead of animating unseen.
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
          if (sample.detectorSafe) ambienceCrop = this.barRegion();
        }
        if (this.settings.ambience !== 'off') this.ambience.render(sample.canvas, sample.canvas.width, sample.canvas.height, ambienceCrop, now, sample.source === 'compatibility');
      }
      if (fill) { this.syncBarFill(); if (sample) this.barFill.paint(this.ambience.backdrop); this.debugBars(); }
      else this.barFill.dispose();
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
      lastRetract: this.lastRetract, sample: `${this.barDepth.w}x${this.barDepth.h}`, safe: this.barSafe,
      diag: this.barHistory.diagnostics,
    } });
  }
}
