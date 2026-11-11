import type { Crop, PlayerBinding, Settings } from '../shared/types';
import { debugCount, debugState } from '../shared/debug';

const W = 192, H = 108;
// Low-rate (screenshot) samples arrive every 0.75-1.5 s. Each new sample starts a
// near-linear cross-fade from what is on screen now to the new frame, lasting a little
// longer than the measured sample gap, so the backdrop keeps drifting toward the
// latest picture instead of stepping. A scene cut gets a short eased fade instead.
const MORPH_MIN = 450, MORPH_MAX = 1800, MORPH_CUT = 380, MORPH_REDUCED = 300, MORPH_FRAME = 30;
const CUT_DIFF = 48; // mean absolute 0-255 channel difference over an 8x6 grid
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export class AmbienceRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private lastFrame = 0;
  private mode: Settings['ambience'] = 'off';
  private stage: HTMLCanvasElement | null = null;
  private stageCtx: CanvasRenderingContext2D | null = null;
  private saved: { property: string; value: string; priority: string; written: string }[] = [];
  // Low-rate morph state: `from` holds the display at transition start, `next` the
  // processed incoming frame. Both stay at the backdrop's 192x108 size.
  private from: HTMLCanvasElement | null = null;
  private next: HTMLCanvasElement | null = null;
  private probe: HTMLCanvasElement | null = null;
  private probeLast: Uint8ClampedArray | null = null;
  private morphStart = 0;
  private morphDuration = 0;
  private morphCut = false;
  private morphDrawn = 0;
  private raf = 0;
  private gap = 1000;
  private lastSlow = 0;
  constructor(private readonly binding: PlayerBinding) {}
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
      this.canvas.style.transition = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'none' : 'opacity 180ms ease';
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
    if (lowRate) { this.renderLowRate(source, w, h, crop, now); return; }
    // Direct path: unchanged short exponential cross-fade per sample.
    this.stopMorph(); this.lastSlow = 0; this.probeLast = null;
    const ctx = this.ctx, first = this.lastFrame === 0;
    ctx.globalAlpha = first || reducedMotion() ? 1 : 1 - Math.exp(-Math.min(1, Math.max(.001, (now - this.lastFrame) / 1000)) / .3);
    this.compose(ctx, source, w, h, crop);
    ctx.globalAlpha = 1; this.lastFrame = now; this.canvas.style.opacity = '1';
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
  private renderLowRate(source: CanvasImageSource, w: number, h: number, crop: Crop, now: number): void {
    const ctx = this.ctx!, canvas = this.canvas!;
    this.next ??= sized(document.createElement('canvas'));
    this.from ??= sized(document.createElement('canvas'));
    const nextCtx = this.next.getContext('2d'), fromCtx = this.from.getContext('2d');
    if (!nextCtx || !fromCtx) return;
    const first = this.lastFrame === 0;
    if (this.lastSlow) this.gap = this.gap * .6 + Math.min(4000, now - this.lastSlow) * .4;
    this.lastSlow = now;
    const cut = this.sceneCut(source, w, h, crop);
    // Freeze whatever is on screen (possibly mid-transition) as the new starting point.
    fromCtx.globalAlpha = 1; fromCtx.drawImage(canvas, 0, 0);
    nextCtx.globalAlpha = 1; nextCtx.clearRect(0, 0, W, H);
    this.compose(nextCtx, source, w, h, crop);
    this.lastFrame = now;
    if (first) {
      this.stopMorph(); ctx.globalAlpha = 1; ctx.drawImage(this.next, 0, 0); canvas.style.opacity = '1';
      debugState({ ambienceMorph: 'settled' }); return;
    }
    const reduced = reducedMotion();
    this.morphCut = cut && !reduced;
    this.morphDuration = reduced ? MORPH_REDUCED : cut ? MORPH_CUT : Math.min(MORPH_MAX, Math.max(MORPH_MIN, this.gap * 1.15));
    this.morphStart = performance.now(); this.morphDrawn = 0;
    debugState({ ambienceMorph: reduced ? 'fade' : cut ? 'cut' : 'morph', ambienceMorphMs: Math.round(this.morphDuration), ambienceGapMs: Math.round(this.gap) });
    if (!this.raf) this.raf = requestAnimationFrame(this.step);
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
    ctx.globalAlpha = 1; ctx.drawImage(this.from, 0, 0);
    ctx.globalAlpha = k; ctx.drawImage(this.next, 0, 0);
    ctx.globalAlpha = 1;
    debugCount('ambienceMorphFrame');
    if (t < 1) this.raf = requestAnimationFrame(this.step);
    else debugState({ ambienceMorph: 'settled' });
  };
  /** Cheap scene-cut test on an 8x6 average-colour grid; false when pixels are unreadable. */
  private sceneCut(source: CanvasImageSource, w: number, h: number, crop: Crop): boolean {
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
    if (this.ctx && this.next) { this.ctx.globalAlpha = 1; this.ctx.drawImage(this.next, 0, 0); }
    debugState({ ambienceMorph: 'settled' });
  }
  private stopMorph(): void { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
  dispose(): void {
    this.stopMorph(); this.lastSlow = 0; this.probeLast = null; this.gap = 1000;
    for (const c of [this.from, this.next, this.probe]) if (c) c.width = c.height = 0;
    this.from = this.next = this.probe = null;
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
