import type { Crop, PlayerBinding, Settings } from '../shared/types';
import { debugCount, debugState } from '../shared/debug';
import { reducedMotion } from '../shared/motion';

const W = 192, H = 108;
// Each new sample starts a near-linear cross-fade from what is on screen now to the new
// frame, lasting a little longer than the measured sample gap, so the backdrop keeps
// drifting toward the latest picture instead of stepping. Low-rate (screenshot) samples
// arrive every 0.75-1.5 s; direct samples every ~40-170 ms, where the 300 ms floor keeps
// the old exponential fade's smoothing. A scene cut gets a short eased fade instead.
const MORPH_MIN = 450, MORPH_DIRECT_MIN = 300, MORPH_MAX = 1800, MORPH_CUT = 380, MORPH_REDUCED = 300, MORPH_FRAME = 30;
const GAP_IGNORE = 2500, PROBE_EVERY = 100;
const CUT_DIFF = 48; // mean absolute 0-255 channel difference over an 8x6 grid
// Low-rate morphs skip frames that could not change any pixel by a full 8-bit level.
const RANGE_W = 48, RANGE_H = 27, RANGE_MARGIN = 2;

export class AmbienceRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private lastFrame = 0;
  private mode: Settings['ambience'] = 'off';
  private stage: HTMLCanvasElement | null = null;
  private stageCtx: CanvasRenderingContext2D | null = null;
  private saved: { property: string; value: string; priority: string; written: string }[] = [];
  // Morph state: `from` holds the display at transition start, `next` the
  // processed incoming frame. Both stay at the backdrop's 192x108 size.
  private from: HTMLCanvasElement | null = null;
  private next: HTMLCanvasElement | null = null;
  private probe: HTMLCanvasElement | null = null;
  private probeLast: Uint8ClampedArray | null = null;
  private morphStart = 0;
  private morphDuration = 0;
  private morphCut = false;
  private morphDrawn = 0;
  // Largest channel difference between `from` and `next` (with margin), -1 when unknown.
  private morphRange = -1;
  private morphK = 0;
  private rangeProbe: HTMLCanvasElement | null = null;
  private raf = 0;
  private gap = -1;
  private lastSample = 0;
  private lowRate = false;
  private probeAt = 0;
  /** Called after each morph frame so mirrors of the backdrop (bar fill) move with it. */
  onFrame: (() => void) | null = null;
  constructor(private readonly binding: PlayerBinding) {}
  /** Last rendered backdrop, for consumers that repaint it elsewhere (bar fill). */
  get backdrop(): HTMLCanvasElement | null { return this.lastFrame ? this.canvas : null; }
  get available(): boolean { return this.binding.viewport !== this.binding.video && document.fullscreenElement !== this.binding.video; }
  update(mode: Settings['ambience']): void {
    if (mode === 'off') { this.dispose(); return; }
    if (mode !== this.mode) this.dispose();
    this.mode = mode;
    const host = this.binding.viewport;
    // A video-only fullscreen subtree cannot display sibling backdrops.
    if (!this.available) { this.dispose(); return; }
    if (!this.canvas) {
      this.canvas = document.createElement('canvas'); this.canvas.width = 192; this.canvas.height = 108;
      this.canvas.dataset.justZoom = 'ambience'; this.canvas.setAttribute('aria-hidden', 'true');
      this.canvas.dataset.ambienceMode = mode;
      Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '-1', objectFit: 'cover', opacity: '0', transition: 'opacity 180ms ease' });
      this.ctx = this.canvas.getContext('2d');
      if (getComputedStyle(host).position === 'static') this.write('position', 'relative');
      // Clipping belongs to the transform owner; overlapping style ownership
      // would prevent exact restoration when controllers are disposed in order.
      this.write('isolation', 'isolate');
      // Styled once at creation: update() runs on every effects wake (fullscreen,
      // resize, play/pause), and rewriting styles there only produced style mutations.
      this.canvas.style.filter = 'none';
      this.canvas.style.transform = 'scale(1.25)';
      this.canvas.style.transition = reducedMotion() ? 'none' : 'opacity 180ms ease';
      host.prepend(this.canvas);
    }
  }
  private write(property: string, written: string): void {
    const style = this.binding.viewport.style;
    this.saved.push({ property, value: style.getPropertyValue(property), priority: style.getPropertyPriority(property), written });
    style.setProperty(property, written);
  }
  render(source: CanvasImageSource, w: number, h: number, crop: Crop, now: number, lowRate = false): void {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx, canvas = this.canvas, reduced = reducedMotion();
    if (lowRate !== this.lowRate) { this.lowRate = lowRate; this.lastSample = 0; this.gap = -1; this.probeLast = null; }
    // Reduced motion on direct samples: replace the frame outright, as before.
    if (!lowRate && reduced) {
      this.stopMorph(); ctx.globalAlpha = 1; this.compose(ctx, source, w, h, crop);
      this.lastFrame = now; canvas.style.opacity = '1'; debugState({ ambienceMorph: 'settled' }); return;
    }
    this.next ??= sized(document.createElement('canvas'));
    this.from ??= sized(document.createElement('canvas'));
    const nextCtx = this.next.getContext('2d'), fromCtx = this.from.getContext('2d');
    if (!nextCtx || !fromCtx) return;
    const first = this.lastFrame === 0;
    // Effective sample gap (EMA). Gaps across pauses/holds would stretch the morph, so skip them.
    if (this.lastSample) {
      const gap = now - this.lastSample;
      if (gap < GAP_IGNORE) this.gap = this.gap < 0 ? gap : this.gap * .6 + gap * .4;
    }
    this.lastSample = now;
    const cut = this.sceneCut(source, w, h, crop, now);
    // Freeze whatever is on screen (possibly mid-transition) as the new starting point.
    fromCtx.globalAlpha = 1; fromCtx.drawImage(canvas, 0, 0);
    nextCtx.globalAlpha = 1; nextCtx.clearRect(0, 0, W, H);
    this.compose(nextCtx, source, w, h, crop);
    this.lastFrame = now;
    if (first) {
      this.stopMorph(); ctx.globalAlpha = 1; ctx.drawImage(this.next, 0, 0); canvas.style.opacity = '1';
      debugState({ ambienceMorph: 'settled' }); return;
    }
    // Glide across the whole gap (slightly longer, so motion never pauses between
    // samples). Fast direct sampling keeps at least the old 0.3 s smoothing window.
    const gap = this.gap < 0 ? (lowRate ? 1000 : 100) : this.gap;
    const glide = Math.min(MORPH_MAX, Math.max(lowRate ? MORPH_MIN : MORPH_DIRECT_MIN, gap * 1.15));
    this.morphCut = cut && !reduced;
    this.morphDuration = reduced ? MORPH_REDUCED : cut ? Math.min(MORPH_CUT, glide * .66) : glide;
    this.morphStart = performance.now();
    this.morphK = 0;
    this.morphRange = lowRate && !this.morphCut && !reduced ? this.range() : -1;
    debugState({ ambienceMorph: reduced ? 'fade' : cut ? 'cut' : 'morph', ambienceMorphPath: lowRate ? 'low-rate' : 'direct', ambienceMorphMs: Math.round(this.morphDuration), ambienceGapMs: Math.round(gap) });
    if (!this.raf) this.raf = requestAnimationFrame(this.step);
  }
  /** Draws the processed backdrop (blur or colour field, dimmed) into `ctx` at its current globalAlpha. */
  private compose(ctx: CanvasRenderingContext2D, source: CanvasImageSource, w: number, h: number, crop: Crop): void {
    const sx = crop.left * w, sy = crop.top * h, sw = w * (1 - crop.left - crop.right), sh = h * (1 - crop.top - crop.bottom);
    if (!this.stage) { this.stage = document.createElement('canvas'); this.stageCtx = this.stage.getContext('2d'); }
    if (!this.stageCtx || !this.stage) return;
    const stage = this.stage, stageCtx = this.stageCtx;
    const brightness = .8;
    if (this.mode === 'blur') {
      // Match the CSS blur's apparent radius after the small bitmap is enlarged.
      const scale = Math.max(.5, this.binding.viewport.clientWidth / 192, this.binding.viewport.clientHeight / 108);
      const blur = 38 / scale, pad = Math.ceil(blur * 3);
      if (stage.width !== 192 + pad * 2 || stage.height !== 108 + pad * 2) {
        stage.width = 192 + pad * 2; stage.height = 108 + pad * 2;
      }
      stageCtx.drawImage(source, sx, sy, sw, sh, pad, pad, 192, 108);
      // Extend edge pixels so blurring doesn't introduce transparent/dark seams.
      stageCtx.drawImage(stage, pad, pad, 192, 1, pad, 0, 192, pad);
      stageCtx.drawImage(stage, pad, pad + 107, 192, 1, pad, pad + 108, 192, pad);
      stageCtx.drawImage(stage, pad, 0, 1, stage.height, 0, 0, pad, stage.height);
      stageCtx.drawImage(stage, pad + 191, 0, 1, stage.height, pad + 192, 0, pad, stage.height);
      ctx.filter = `blur(${blur}px) brightness(${brightness})`;
      ctx.drawImage(stage, -pad, -pad);
    } else {
      // A coarse color field deliberately drops image detail, with no display blur.
      if (stage.width !== 4 || stage.height !== 3) { stage.width = 4; stage.height = 3; }
      stageCtx.imageSmoothingEnabled = true; stageCtx.imageSmoothingQuality = 'high';
      stageCtx.drawImage(source, sx, sy, sw, sh, 0, 0, 4, 3);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.filter = `brightness(${brightness})`;
      ctx.drawImage(stage, 0, 0, 192, 108);
    }
    ctx.filter = 'none';
  }
  private step = (time: number): void => {
    this.raf = 0;
    const ctx = this.ctx;
    if (!ctx || !this.from || !this.next) return;
    const t = Math.min(1, Math.max(0, (time - this.morphStart) / this.morphDuration));
    // ~30 fps is ample for a blurred field and halves the draw count.
    if (t < 1 && time - this.morphDrawn < MORPH_FRAME) { this.raf = requestAnimationFrame(this.step); return; }
    this.morphDrawn = time;
    // Steady morph: mostly linear so the colour keeps moving at an even speed across
    // sample boundaries, with a slightly soft start. Scene cut: quick ease-out.
    const k = this.morphCut ? 1 - (1 - t) ** 3 : t * t * (3 - 2 * t) * .35 + t * .65;
    // A blurred low-rate field often differs by only a few levels: frames that move no pixel
    // by a full level would draw the same image, so wait for one that does (or the end).
    if (t < 1 && this.morphRange >= 0 && (k - this.morphK) * this.morphRange < 1) { this.raf = requestAnimationFrame(this.step); return; }
    this.morphK = k;
    ctx.globalAlpha = 1; ctx.drawImage(this.from, 0, 0);
    ctx.globalAlpha = k; ctx.drawImage(this.next, 0, 0);
    ctx.globalAlpha = 1;
    this.onFrame?.();
    debugCount('ambienceMorphFrame');
    if (t < 1) this.raf = requestAnimationFrame(this.step);
    else debugState({ ambienceMorph: 'settled' });
  };
  /** Max channel difference between the morph endpoints on a coarse grid, scaled up as a safety margin; -1 if unreadable. */
  private range(): number {
    if (!this.from || !this.next) return -1;
    try {
      this.rangeProbe ??= Object.assign(document.createElement('canvas'), { width: RANGE_W * 2, height: RANGE_H });
      const pctx = this.rangeProbe.getContext('2d', { willReadFrequently: true });
      if (!pctx) return -1;
      pctx.drawImage(this.from, 0, 0, RANGE_W, RANGE_H); pctx.drawImage(this.next, RANGE_W, 0, RANGE_W, RANGE_H);
      const data = pctx.getImageData(0, 0, RANGE_W * 2, RANGE_H).data;
      let max = 0;
      for (let y = 0; y < RANGE_H; y++) for (let x = 0; x < RANGE_W; x++) {
        const a = (y * RANGE_W * 2 + x) * 4, b = a + RANGE_W * 4;
        max = Math.max(max, Math.abs(data[a]! - data[b]!), Math.abs(data[a + 1]! - data[b + 1]!), Math.abs(data[a + 2]! - data[b + 2]!));
      }
      return max * RANGE_MARGIN;
    } catch { return -1; }
  }
  /** Cheap scene-cut test on an 8x6 average-colour grid; false when pixels are unreadable. */
  private sceneCut(source: CanvasImageSource, w: number, h: number, crop: Crop, now: number): boolean {
    // Direct samples arrive up to 25x/s; probing every ~100 ms still catches cuts (vs the older probe).
    if (now - this.probeAt < PROBE_EVERY) return false;
    this.probeAt = now;
    try {
      this.probe ??= Object.assign(document.createElement('canvas'), { width: 8, height: 6 });
      const pctx = this.probe.getContext('2d', { willReadFrequently: true });
      if (!pctx) return false;
      pctx.drawImage(source, crop.left * w, crop.top * h, w * (1 - crop.left - crop.right), h * (1 - crop.top - crop.bottom), 0, 0, 8, 6);
      const data = pctx.getImageData(0, 0, 8, 6).data, last = this.probeLast;
      this.probeLast = data;
      if (!last) return false;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += Math.abs(data[i]! - last[i]!) + Math.abs(data[i + 1]! - last[i + 1]!) + Math.abs(data[i + 2]! - last[i + 2]!);
      return sum / (48 * 3) > CUT_DIFF;
    } catch { this.probeLast = null; return false; }
  }
  /** Ends a running transition at once, leaving the newest frame fully shown. */
  settle(): void {
    if (!this.raf) return;
    this.stopMorph();
    if (this.ctx && this.next) { this.ctx.globalAlpha = 1; this.ctx.drawImage(this.next, 0, 0); this.onFrame?.(); }
    debugState({ ambienceMorph: 'settled' });
  }
  private stopMorph(): void { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
  dispose(): void {
    this.stopMorph(); this.lastSample = 0; this.probeLast = null; this.probeAt = 0; this.gap = -1;
    for (const c of [this.from, this.next, this.probe, this.rangeProbe, this.canvas]) if (c) c.width = c.height = 0;
    this.from = this.next = this.probe = this.rangeProbe = null; this.morphRange = -1;
    this.canvas?.remove(); this.canvas = null; this.ctx = null; this.lastFrame = 0;
    if (this.stage) this.stage.width = this.stage.height = 0;
    this.stage = null; this.stageCtx = null;
    const style = this.binding.viewport.style;
    for (const entry of this.saved.reverse()) if (style.getPropertyValue(entry.property) === entry.written && style.getPropertyPriority(entry.property) === '') {
      if (entry.value) style.setProperty(entry.property, entry.value, entry.priority); else style.removeProperty(entry.property);
    }
    this.saved = [];
  }
}

function sized(canvas: HTMLCanvasElement): HTMLCanvasElement { canvas.width = W; canvas.height = H; return canvas; }
