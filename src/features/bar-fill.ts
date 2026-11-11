import { EMPTY_CROP, type Crop, type PlayerBinding } from '../shared/types';

export const hasBars = (crop: Crop) => Object.values(crop).some(value => value > .001);
// Mirrored from the video so zoom/pan (scale/translate written by the transform engine) moves the fill with the picture.
const MIRRORED = ['transform', 'transform-origin', 'scale', 'translate', 'rotate', 'transition'] as const;

/** Picture box inside the video's layout box (CSS px, before transforms), or null when object-fit can't be mapped. */
function pictureBox(cs: CSSStyleDeclaration, w: number, h: number, vw: number, vh: number) {
  if (!vw || !vh || w < 2 || h < 2 || cs.objectPosition !== '50% 50%') return null;
  let pw: number, ph: number;
  if (cs.objectFit === 'fill') { pw = w; ph = h; }
  else if (cs.objectFit === 'none') { pw = vw; ph = vh; }
  else if (['contain', 'scale-down', 'cover'].includes(cs.objectFit)) {
    const scale = cs.objectFit === 'cover' ? Math.max(w / vw, h / vh) : Math.min(w / vw, h / vh, cs.objectFit === 'scale-down' ? 1 : Infinity);
    pw = vw * scale; ph = vh * scale;
  } else return null;
  return { x: (w - pw) / 2, y: (h - ph) / 2, w: pw, h: ph };
}

/**
 * Paints the Ambience backdrop into baked-in letterbox/pillarbox padding. The layer is the
 * video's next sibling, so it stacks above the picture and below later siblings (captions,
 * controls). It writes no styles on page elements; dispose() removes it entirely.
 */
export class BarFill {
  private host: HTMLDivElement | null = null;
  private frame: HTMLDivElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private bars: Crop = { ...EMPTY_CROP };
  private painted = false;
  private shown = false;
  private held = false;
  private mutations: MutationObserver | null = null;
  private resize: ResizeObserver | null = null;
  constructor(private readonly binding: PlayerBinding) {}
  /** True while bar regions are actually covered on screen. */
  get visible(): boolean { return this.shown && this.placed; }
  /** False when the video's box can't be mirrored (unsupported object-fit/position); nothing is painted then. */
  get placed(): boolean { return this.host?.style.display === 'block'; }
  /** Bar padding as fractions of the source picture; an empty crop fades the fill out. */
  setBars(bars: Crop): void {
    if (!hasBars(bars)) { this.bars = { ...EMPTY_CROP }; this.apply(); return; }
    if ((['top', 'right', 'bottom', 'left'] as const).every(edge => Math.abs(bars[edge] - this.bars[edge]) < .0005) && this.host) return;
    this.bars = { ...bars };
    if (!this.host && !this.create()) return;
    this.sync(); this.apply();
  }
  /** Copy the already-rendered Ambience backdrop; the layer appears after its first frame. */
  paint(backdrop: HTMLCanvasElement | null): void {
    if (!backdrop || !this.ctx || !hasBars(this.bars)) return;
    this.ctx.drawImage(backdrop, 0, 0, 192, 108);
    this.sync();
    if (!this.painted) { this.painted = true; this.apply(); }
  }
  /** Cheap per-frame copy while the backdrop morphs between samples; layout is synced by paint(). */
  repaint(backdrop: HTMLCanvasElement | null): void {
    if (backdrop && this.ctx && this.painted && hasBars(this.bars)) this.ctx.drawImage(backdrop, 0, 0, 192, 108);
  }
  /** Hide without a fade so the next screenshot sees the real bars (protected-video re-check). */
  hold(held: boolean): void {
    if (this.held === held) return;
    this.held = held;
    if (this.frame && held) this.frame.style.transition = 'none';
    this.apply();
  }
  private create(): boolean {
    const video = this.binding.video;
    if (!video.parentElement) return false;
    const host = document.createElement('div');
    // Shares the Ambience marker so player discovery ignores this node's mutations.
    host.dataset.justZoom = 'ambience'; host.dataset.jzPart = 'bar-fill'; host.setAttribute('aria-hidden', 'true');
    Object.assign(host.style, { position: 'absolute', pointerEvents: 'none', overflow: 'hidden', margin: '0', padding: '0', border: '0', display: 'none' });
    const frame = document.createElement('div');
    Object.assign(frame.style, { position: 'absolute', opacity: '0' });
    const canvas = document.createElement('canvas'); canvas.width = 192; canvas.height = 108;
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
    frame.append(canvas); host.append(frame);
    this.ctx = canvas.getContext('2d');
    video.after(host);
    this.host = host; this.frame = frame;
    this.mutations = new MutationObserver(this.sync);
    this.mutations.observe(video, { attributes: true, attributeFilter: ['style', 'class'] });
    this.resize = new ResizeObserver(this.sync); this.resize.observe(video);
    return true;
  }
  private sync = (): void => {
    const host = this.host, frame = this.frame, video = this.binding.video;
    if (!host || !frame) return;
    const cs = getComputedStyle(video);
    const box = pictureBox(cs, video.offsetWidth, video.offsetHeight, video.videoWidth, video.videoHeight);
    // Offsets only map to our absolute position when both resolve against the same containing block.
    if (!box || cs.display === 'none' || cs.position === 'fixed' || !video.offsetParent || host.offsetParent && host.offsetParent !== video.offsetParent) {
      host.style.display = 'none'; return;
    }
    host.style.display = 'block';
    Object.assign(host.style, { left: `${video.offsetLeft}px`, top: `${video.offsetTop}px`, width: `${video.offsetWidth}px`, height: `${video.offsetHeight}px`, zIndex: cs.zIndex });
    // Inline values are the transform engine's targets; computed values would be mid-transition.
    for (const property of MIRRORED) host.style.setProperty(property, video.style.getPropertyValue(property) || cs.getPropertyValue(property));
    if (host.offsetParent && host.offsetParent !== video.offsetParent) { host.style.display = 'none'; return; }
    Object.assign(frame.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
  };
  private apply(): void {
    const frame = this.frame;
    if (!frame) { this.shown = false; return; }
    const b = this.bars, on = hasBars(b) && this.painted && !this.held;
    if (hasBars(b)) {
      const l = b.left * 100, t = b.top * 100, r = (1 - b.right) * 100, bt = (1 - b.bottom) * 100;
      // Even-odd ring: the outer picture box minus the content rectangle.
      frame.style.clipPath = `polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${l}% ${t}%, ${l}% ${bt}%, ${r}% ${bt}%, ${r}% ${t}%, ${l}% ${t}%)`;
    }
    if (on) {
      // Force the hidden state to commit so a fade-in after hold() still animates.
      void frame.offsetWidth;
      frame.style.transition = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'none' : 'opacity 180ms ease';
    }
    frame.style.opacity = on ? '1' : '0';
    this.shown = on;
  }
  dispose(): void {
    this.mutations?.disconnect(); this.resize?.disconnect(); this.mutations = null; this.resize = null;
    this.host?.remove(); this.host = this.frame = null; this.ctx = null;
    this.bars = { ...EMPTY_CROP }; this.painted = false; this.shown = false; this.held = false;
  }
}
