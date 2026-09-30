import type { Crop, PlayerBinding, Settings } from '../shared/types';

export class AmbienceRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private lastFrame = 0;
  private mode: Settings['ambience'] = 'off';
  private stage: HTMLCanvasElement | null = null;
  private stageCtx: CanvasRenderingContext2D | null = null;
  private saved: { property: string; value: string; priority: string; written: string }[] = [];
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
      host.prepend(this.canvas);
    }
    this.canvas.style.filter = 'none';
    this.canvas.style.transform = 'scale(1.25)';
    this.canvas.style.transition = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'none' : 'opacity 180ms ease';
  }
  private write(property: string, written: string): void {
    const style = this.binding.viewport.style;
    this.saved.push({ property, value: style.getPropertyValue(property), priority: style.getPropertyPriority(property), written });
    style.setProperty(property, written);
  }
  render(source: CanvasImageSource, w: number, h: number, crop: Crop, now: number): void {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx, first = this.lastFrame === 0;
    ctx.globalAlpha = first || matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 1 - Math.exp(-Math.min(1, Math.max(.001, (now - this.lastFrame) / 1000)) / .3);
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
    ctx.globalAlpha = 1; this.lastFrame = now; this.canvas.style.opacity = '1';
  }
  dispose(): void {
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
