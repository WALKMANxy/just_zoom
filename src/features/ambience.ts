import type { Crop, PlayerBinding, Settings } from '../shared/types';

export class AmbienceRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private lastFrame = 0;
  private saved: { property: string; value: string; priority: string; written: string }[] = [];
  constructor(private readonly binding: PlayerBinding) {}
  get available(): boolean { return this.binding.viewport !== this.binding.video && document.fullscreenElement !== this.binding.video; }
  update(mode: Settings['ambience']): void {
    if (mode === 'off') { this.dispose(); return; }
    const host = this.binding.viewport;
    // A video-only fullscreen subtree cannot display sibling backdrops.
    if (!this.available) { this.dispose(); return; }
    if (!this.canvas) {
      this.canvas = document.createElement('canvas'); this.canvas.width = 192; this.canvas.height = 108;
      this.canvas.dataset.justZoom = 'ambience'; this.canvas.setAttribute('aria-hidden', 'true');
      Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '-1', objectFit: 'cover', opacity: '0', transition: 'opacity 180ms ease' });
      this.ctx = this.canvas.getContext('2d');
      if (getComputedStyle(host).position === 'static') this.write('position', 'relative');
      // Clipping belongs to the transform owner; overlapping style ownership
      // would prevent exact restoration when controllers are disposed in order.
      this.write('isolation', 'isolate');
      host.prepend(this.canvas);
    }
    this.canvas.style.filter = mode === 'soft' ? 'blur(28px) brightness(.55)' : 'blur(38px) brightness(.8)';
    this.canvas.style.transform = mode === 'soft' ? 'scale(1.12)' : 'scale(1.25)';
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
    ctx.drawImage(source, crop.left * w, crop.top * h, w * (1 - crop.left - crop.right), h * (1 - crop.top - crop.bottom), 0, 0, 192, 108);
    ctx.globalAlpha = 1; this.lastFrame = now; this.canvas.style.opacity = '1';
  }
  dispose(): void {
    this.canvas?.remove(); this.canvas = null; this.ctx = null; this.lastFrame = 0;
    const style = this.binding.viewport.style;
    for (const entry of this.saved.reverse()) if (style.getPropertyValue(entry.property) === entry.written && style.getPropertyPriority(entry.property) === '') {
      if (entry.value) style.setProperty(entry.property, entry.value, entry.priority); else style.removeProperty(entry.property);
    }
    this.saved = [];
  }
}
