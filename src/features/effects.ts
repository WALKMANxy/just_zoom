import { DEFAULT_SETTINGS, EMPTY_CROP, type Crop, type FeatureStatus, type PlayerBinding, type Settings } from '../shared/types';
import { AmbienceRenderer } from './ambience';
import { CropTracker, detectBorders } from './detector';
import { FrameSource } from './frame-source';
import { AUTO_CROP_AVAILABLE } from '../shared/features';

export class EffectsController {
  private settings: Settings = { ...DEFAULT_SETTINGS };
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
  private statusValue: FeatureStatus = { source: 'idle', message: '' };
  constructor(private readonly binding: PlayerBinding, private readonly onCrop: (crop: Crop) => void, private readonly onStatus: (status: FeatureStatus) => void) {
    this.sourceUrl = binding.video.currentSrc;
    this.source = new FrameSource(binding, status => this.report(status)); this.ambience = new AmbienceRenderer(binding);
    this.observer = new IntersectionObserver(entries => { this.intersection = entries.some(entry => entry.isIntersecting); this.wake(); });
    this.observer.observe(binding.video);
    this.resize = new ResizeObserver(() => this.wake()); this.resize.observe(binding.viewport);
    for (const event of ['play', 'pause', 'seeked', 'loadeddata', 'emptied']) binding.video.addEventListener(event, this.wake);
    binding.video.addEventListener('seeking', this.seeking);
    document.addEventListener('visibilitychange', this.wake); document.addEventListener('fullscreenchange', this.wake);
  }
  update(settings: Settings): void {
    settings = { ...settings, autoCrop: AUTO_CROP_AVAILABLE && settings.autoCrop };
    const changed = JSON.stringify(this.settings) !== JSON.stringify(settings);
    const autoChanged = this.settings.autoCrop !== settings.autoCrop;
    this.settings = { ...settings };
    if (autoChanged) this.tracker.clearCandidate();
    this.ambience.update(settings.enabled ? settings.ambience : 'off');
    if (changed) this.wake();
  }
  setCrop(crop: Crop): void { this.crop = { ...crop }; this.target = { ...crop }; this.tracker.setCrop(crop); }
  reset(): void { this.source.reset(); this.tracker.reset(); this.crop = { ...EMPTY_CROP }; this.target = { ...EMPTY_CROP }; this.onCrop(this.crop); this.wake(); }
  private report(value: FeatureStatus): void {
    if (this.settings.enabled && this.settings.ambience !== 'off' && !this.ambience.available && value.source !== 'idle') {
      value = { ...value, message: `${value.message} Ambience needs a separate player container.` };
    }
    if (this.disposed || value.source === this.statusValue.source && value.message === this.statusValue.message) return;
    this.statusValue = value; this.onStatus(value);
  }
  private seeking = (): void => { this.tracker.clearCandidate(); this.source.invalidate(); this.generation++; this.staticDone = false; };
  private wake = (): void => {
    if (this.disposed) return;
    this.staticDone = false; this.generation++; this.source.invalidate();
    this.ambience.update(this.settings.enabled ? this.settings.ambience : 'off');
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    if (!this.busy) void this.tick();
  };
  private wanted(): boolean { return this.settings.enabled && (this.settings.autoCrop || this.settings.ambience !== 'off' && this.ambience.available); }
  private async tick(): Promise<void> {
    if (this.disposed || this.busy) return;
    if (!this.wanted()) {
      this.report(this.settings.enabled && this.settings.ambience !== 'off' && !this.ambience.available
        ? { source: 'unavailable', message: 'Ambience needs a player container outside video-only fullscreen.' }
        : { source: 'idle', message: '' }); return;
    }
    if (document.hidden || !this.intersection || !this.binding.video.isConnected) return;
    if (this.binding.video.paused && this.staticDone) return;
    const generation = this.generation;
    this.busy = true;
    try {
      const video = this.binding.video;
      if (this.sourceUrl !== video.currentSrc) { this.sourceUrl = video.currentSrc; this.source.reset(); this.tracker.reset(); this.crop = { ...EMPTY_CROP }; this.target = { ...EMPTY_CROP }; this.onCrop(this.crop); }
      const sample = await this.source.sample(this.settings, this.crop);
      if (this.disposed || generation !== this.generation) return;
      const now = performance.now();
      if (sample) {
        if (this.settings.autoCrop && sample.detectorSafe && now - this.lastDetection >= 400) {
          this.lastDetection = now;
          const accepted = this.tracker.observe(detectBorders(sample.pixels), now); if (accepted) this.target = accepted;
        }
        if (this.settings.ambience !== 'off') this.ambience.render(sample.canvas, sample.canvas.width, sample.canvas.height, sample.source === 'direct' ? this.crop : EMPTY_CROP, now);
      }
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
      this.report({ source: 'unavailable', message: 'Advanced effects unavailable; manual framing still works.' });
    } finally {
      this.busy = false;
      if (!this.disposed && this.wanted() && !document.hidden && this.intersection && !(this.binding.video.paused && this.staticDone)) {
        this.timer = setTimeout(() => { this.timer = null; void this.tick(); }, this.binding.video.paused ? 1500 : this.settings.ambience !== 'off' ? 150 : 450);
      }
    }
  }
  dispose(): void {
    this.disposed = true; this.generation++; if (this.timer) clearTimeout(this.timer); this.timer = null;
    this.observer.disconnect(); this.resize.disconnect(); this.source.dispose(); this.ambience.dispose();
    for (const event of ['play', 'pause', 'seeked', 'loadeddata', 'emptied']) this.binding.video.removeEventListener(event, this.wake);
    this.binding.video.removeEventListener('seeking', this.seeking);
    document.removeEventListener('visibilitychange', this.wake); document.removeEventListener('fullscreenchange', this.wake);
  }
}
