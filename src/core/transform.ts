import { EMPTY_CROP, type Crop, type PlayerBinding, type Settings } from '../shared/types';
import { automaticZoomFactor, portraitBlocked } from './eligibility';

interface OwnedStyle { original: string; priority: string; written: string; writtenPriority: string; requested: string }
export class TransformEngine {
  private owned = new Map<HTMLElement, Map<string, OwnedStyle>>();
  private settings: Settings | null = null;
  private crop: Crop = EMPTY_CROP;
  private renderedCrop: Crop = { ...EMPTY_CROP };
  private tweenFrom: Crop = { ...EMPTY_CROP };
  private tweenStarted = 0;
  private transitionMs = 0;
  private restoreTimer = 0;
  private origin = 'center center';
  private observer: ResizeObserver;
  private styleObserver: MutationObserver | null = null;
  private isWriting = false;
  private pending = 0;
  private geometryPending = 0;
  private onStyleMutation = () => {
    if (this.isWriting) return;
    this.refresh();
  };
  constructor(private binding: PlayerBinding) {
    // Determine transform origin once per bound video. Sampling an intermediate
    // fullscreen transition transform can cause origin jitter and visible scaling jumps.
    try {
      const matrix = new DOMMatrix(getComputedStyle(binding.video).transform);
      if (matrix.m41 < 0 && matrix.m42 < 0) this.origin = 'left top';
    } catch { /* A video with no transform uses the centered origin. */ }
    this.observer = new ResizeObserver(this.geometryChanged);
    this.observer.observe(binding.viewport);
    this.observer.observe(binding.video);
    this.styleObserver = new MutationObserver(this.onStyleMutation);
    this.styleObserver.observe(binding.video, { attributes: true, attributeFilter: ['style', 'class'] });
    if (binding.viewport !== binding.video) {
      this.styleObserver.observe(binding.viewport, { attributes: true, attributeFilter: ['style'] });
    }
    window.addEventListener('resize', this.geometryChanged);
    document.addEventListener('fullscreenchange', this.geometryChanged);
    binding.video.addEventListener('loadedmetadata', this.schedule);
    binding.video.addEventListener('resize', this.schedule);
    binding.video.addEventListener('playing', this.schedule);
  }
  update(settings: Settings, crop: Crop = this.crop, animateZoom = false, immediate = false) {
    const previous = this.settings;
    this.settings = settings;
    const framingChanged = previous === null || (['zoomApplied', 'zoom', 'zoomType', 'zoomStrategy', 'mode', 'panX', 'panY', 'displayProfile', 'customDisplayAspectRatio'] as const)
      .some(key => previous[key] !== settings[key]);
    if (framingChanged) {
      clearTimeout(this.restoreTimer); this.restoreTimer = 0;
      this.transitionMs = !immediate && previous && this.animationsAllowed() && (settings.zoomApplied || animateZoom)
        ? previous.zoom !== settings.zoom ? 400 : 300 : 0;
    }
    if (!settings.enabled || !this.animationsAllowed()) {
      this.transitionMs = 0;
      clearTimeout(this.restoreTimer); this.restoreTimer = 0;
    }
    if (Object.keys(crop).some(edge => crop[edge as keyof Crop] !== this.crop[edge as keyof Crop])) {
      this.tweenFrom = { ...this.renderedCrop }; this.crop = { ...crop };
      this.transitionMs = 0; // Crop already has its own interpolation.
      this.tweenStarted = this.animationsAllowed() ? performance.now() : 0;
      if (!this.tweenStarted) this.renderedCrop = { ...crop };
    }
    this.schedule();
  }
  rebind(binding: PlayerBinding) {
    if (binding.video !== this.binding.video) throw new Error('TransformEngine cannot rebind to a different video');
    if (binding.viewport === this.binding.viewport) { this.binding = binding; this.schedule(); return; }
    cancelAnimationFrame(this.pending); this.pending = 0;
    // Keep video claims intact: releasing scale during a container swap can
    // expose the site's neutral layout before fullscreen geometry is ready.
    this.restoreElement(this.binding.viewport === this.binding.video ? null : this.binding.viewport);
    this.binding = binding;
    this.observer.disconnect();
    this.observer.observe(binding.viewport);
    this.observer.observe(binding.video);
    this.styleObserver?.disconnect();
    this.styleObserver = new MutationObserver(this.onStyleMutation);
    this.styleObserver.observe(binding.video, { attributes: true, attributeFilter: ['style', 'class'] });
    if (binding.viewport !== binding.video) {
      this.styleObserver.observe(binding.viewport, { attributes: true, attributeFilter: ['style'] });
    }
    this.geometryChanged();
    this.schedule();
  }
  refresh() {
    // Discovery polls and mutation guards repair styles that the page actually overwrote.
    for (const [el, entries] of this.owned) for (const [property, saved] of entries) {
      if (el.style.getPropertyValue(property) !== saved.written || el.style.getPropertyPriority(property) !== saved.writtenPriority) {
        this.schedule(); return;
      }
    }
  }
  private animationsAllowed() {
    return this.settings?.animations === true && this.binding.adapter !== 'Netflix'
      && !/(^|\.)netflix\.com$/.test(location.hostname)
      && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  private geometryChanged = () => {
    // Fixed manual zoom factors remain constant across viewport resize/fullscreen.
    // Only geometry-dependent framing requires recalculation, avoiding interrupting CSS transitions.
    const s = this.settings;
    if (s && !s.autoCrop && s.zoomType === 'factor' && s.zoomStrategy !== 'automatic' && !s.panX && !s.panY && !Object.values(this.crop).some(Boolean)) return;
    cancelAnimationFrame(this.pending); this.pending = 0;
    cancelAnimationFrame(this.geometryPending);
    // Coalesce layout changes across two animation frames to allow the browser
    // and player DOM to settle their fullscreen layout before recalculating transforms.
    this.geometryPending = requestAnimationFrame(() => {
      this.geometryPending = requestAnimationFrame(() => {
        this.geometryPending = 0;
        this.apply();
      });
    });
  };
  private write(el: HTMLElement, property: string, value: string) {
    let entries = this.owned.get(el);
    if (!entries) this.owned.set(el, entries = new Map());
    let saved = entries.get(property);
    if (saved && saved.requested === value && el.style.getPropertyValue(property) === saved.written && el.style.getPropertyPriority(property) === saved.writtenPriority) return;
    if (!saved) entries.set(property, saved = { original: el.style.getPropertyValue(property), priority: el.style.getPropertyPriority(property), written: '', writtenPriority: 'important', requested: value });
    else if (el.style.getPropertyValue(property) !== saved.written || el.style.getPropertyPriority(property) !== saved.writtenPriority) {
      saved.original = el.style.getPropertyValue(property); saved.priority = el.style.getPropertyPriority(property);
    }
    this.isWriting = true;
    try {
      el.style.setProperty(property, value, 'important');
    } finally {
      this.isWriting = false;
    }
    saved.requested = value;
    // Compare against CSSOM serialization, which can normalize whitespace/values.
    saved.written = el.style.getPropertyValue(property);
    saved.writtenPriority = el.style.getPropertyPriority(property);
  }
  private restoreElement(el: HTMLElement | null) {
    if (!el) return;
    this.isWriting = true;
    try {
      for (const [property, saved] of this.owned.get(el) ?? []) {
        if (el.style.getPropertyValue(property) !== saved.written || el.style.getPropertyPriority(property) !== saved.writtenPriority) continue;
        if (saved.original) el.style.setProperty(property, saved.original, saved.priority); else el.style.removeProperty(property);
      }
    } finally {
      this.isWriting = false;
    }
    this.owned.delete(el);
  }
  private release(el: HTMLElement, property: string) {
    const entries = this.owned.get(el), saved = entries?.get(property);
    if (!saved) return;
    if (el.style.getPropertyValue(property) === saved.written && el.style.getPropertyPriority(property) === saved.writtenPriority) {
      this.isWriting = true;
      try {
        if (saved.original) el.style.setProperty(property, saved.original, saved.priority);
        else el.style.removeProperty(property);
      } finally {
        this.isWriting = false;
      }
    }
    entries!.delete(property);
  }
  private restore() { for (const el of this.owned.keys()) this.restoreElement(el); }
  private schedule = () => { if (!this.pending && !this.geometryPending) this.pending = requestAnimationFrame(() => { this.pending = 0; this.apply(); }); };
  private apply() {
    const s = this.settings, { video, viewport } = this.binding;
    if (!s?.enabled || !video.isConnected || portraitBlocked(this.binding, s.allowPortrait)) {
      this.restore();
      return;
    }
    // If video is temporarily buffering or loading dimensions (e.g. bitrate switch on Disney+/Netflix/Prime),
    // wait for metadata instead of clearing previously applied transforms.
    if (!video.videoWidth || !video.videoHeight) {
      if (!s.zoomApplied) this.restore();
      return;
    }
    if (!s.zoomApplied) {
      if (this.restoreTimer) return;
      if (this.transitionMs && this.owned.get(video)?.has('scale')) {
        this.write(video, 'transition', `scale ${this.transitionMs}ms ease, translate ${this.transitionMs}ms ease`);
        this.write(video, 'scale', '1');
        this.write(video, 'translate', '0px 0px');
        this.restoreTimer = window.setTimeout(() => {
          this.restoreTimer = 0; this.transitionMs = 0; this.schedule();
        }, this.transitionMs);
        return;
      }
      this.restore();
      // Ambience can remain enabled without taking ownership of video framing.
      if (s.ambience !== 'off') {
        this.write(video, 'background-color', 'transparent');
        if (viewport !== video) this.write(viewport, 'overflow', 'hidden');
      }
      return;
    }
    // Native video fullscreen cannot safely host a sibling backdrop or resize its parent.
    const target = document.fullscreenElement === video ? video : viewport;
    // A bare/fullscreen video is also the viewport. Its bounding rectangle
    // includes our scale, which would feed the previous zoom into the next one.
    const box = target === video ? { width: video.clientWidth, height: video.clientHeight } : target.getBoundingClientRect();
    if (!box.width || !box.height) return;
    // Leverage compositor transitions for scale and translate without per-frame JS writes.
    this.write(video, 'transition', this.transitionMs
      ? `scale ${this.transitionMs}ms ease, translate ${this.transitionMs}ms ease` : 'none');

    // Manual zoom preserves the player's intrinsic object-fit layout.
    // Fit/Fill and Auto Crop explicitly normalize object-fit to 'contain' for geometry math.
    if (s.zoomType === 'quick' || s.autoCrop || Object.values(this.crop).some(Boolean)) {
      this.write(video, 'object-fit', 'contain');
      this.write(video, 'object-position', '50% 50%');
    } else {
      this.release(video, 'object-fit');
      this.release(video, 'object-position');
    }
    if (s.ambience !== 'off') this.write(video, 'background-color', 'transparent');

    const layoutW = video.offsetWidth || video.videoWidth;
    const layoutH = video.offsetHeight || video.videoHeight;
    const intrinsicAR = video.videoWidth / video.videoHeight;
    let pw = layoutW, ph = layoutH;
    if (pw / ph > intrinsicAR) pw = ph * intrinsicAR; else ph = pw * (1 / intrinsicAR);

    if (this.tweenStarted) {
      const progress = Math.min(1, (performance.now() - this.tweenStarted) / 240);
      const eased = progress * progress * (3 - 2 * progress);
      for (const edge of ['top', 'right', 'bottom', 'left'] as const) this.renderedCrop[edge] = this.tweenFrom[edge] + (this.crop[edge] - this.tweenFrom[edge]) * eased;
      if (progress === 1) this.tweenStarted = 0; else this.schedule();
    }
    const c = this.renderedCrop;
    const cw = pw * (1 - c.left - c.right), ch = ph * (1 - c.top - c.bottom);
    if (cw <= 0 || ch <= 0) return;

    let targetScale = 1;
    if (s.autoCrop) {
      targetScale = Math.max(box.width / cw, box.height / ch);
    } else if (s.zoomType === 'quick') {
      targetScale = s.mode === 'fit' ? Math.min(box.width / cw, box.height / ch) : Math.max(box.width / cw, box.height / ch);
    } else {
      if (s.zoomStrategy === 'automatic') {
        targetScale = automaticZoomFactor(s.displayProfile, s.customDisplayAspectRatio);
      } else {
        targetScale = s.zoom;
      }
    }
    targetScale = Math.max(.05, Math.min(12, targetScale));
    this.write(video, 'transform-origin', this.origin);
    this.write(video, 'scale', `${targetScale}`);

    const cropDX = (c.left - c.right) * pw / 2;
    const cropDY = (c.top - c.bottom) * ph / 2;
    const panDX = s.panX * box.width;
    const panDY = s.panY * box.height;
    const dx = panDX - cropDX * targetScale;
    const dy = panDY - cropDY * targetScale;
    if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
      this.write(video, 'translate', `${dx}px ${dy}px`);
    } else {
      this.write(video, 'translate', '0px 0px');
    }

    if (c.top || c.right || c.bottom || c.left) {
      const verticalPadding = (layoutH - ph) / 2;
      const horizontalPadding = (layoutW - pw) / 2;
      this.write(video, 'clip-path', `inset(${verticalPadding + c.top * ph}px ${horizontalPadding + c.right * pw}px ${verticalPadding + c.bottom * ph}px ${horizontalPadding + c.left * pw}px)`);
    } else {
      this.release(video, 'clip-path');
    }
    if (viewport !== video) this.write(viewport, 'overflow', 'hidden');
  }
  dispose() {
    clearTimeout(this.restoreTimer);
    this.restoreTimer = 0;
    cancelAnimationFrame(this.pending);
    cancelAnimationFrame(this.geometryPending);
    this.pending = 0;
    this.geometryPending = 0;
    this.observer.disconnect();
    this.styleObserver?.disconnect();
    this.styleObserver = null;
    window.removeEventListener('resize', this.geometryChanged);
    document.removeEventListener('fullscreenchange', this.geometryChanged);
    this.binding.video.removeEventListener('loadedmetadata', this.schedule);
    this.binding.video.removeEventListener('resize', this.schedule);
    this.binding.video.removeEventListener('playing', this.schedule);
    this.restore();
  }
}
