import { EMPTY_CROP, type Crop, type FeatureStatus, type PlayerBinding, type Settings } from '../shared/types';
import { isContextInvalidationError, isContextValid, markContextInvalid } from '../shared/storage';

export interface Sample { canvas: HTMLCanvasElement; pixels: ImageData | null; source: 'direct' | 'compatibility'; detectorSafe: boolean }
export interface SampleRequest { readPixels?: boolean; width?: number }
const hasCrop = (crop: Crop) => Object.values(crop).some(value => value > .001);
const sameRect = (a: DOMRect, b: DOMRect) => ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key as keyof DOMRect] as number - (b[key as keyof DOMRect] as number)) < 1);

export class FrameSource {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  private unreadable = false;
  private lowInformation = 0;
  private lastCapture = 0;
  private generation = 0;
  private failureCount = 0;
  private retryAt = 0;
  private visual: HTMLCanvasElement | null = null;
  private visualCtx: CanvasRenderingContext2D | null = null;
  private probe: HTMLCanvasElement | null = null;
  private probeCtx: CanvasRenderingContext2D | null = null;
  private lastProbe = -Infinity;
  constructor(private readonly binding: PlayerBinding, private readonly status: (value: FeatureStatus) => void) {}
  invalidate(): void { this.generation++; }
  reset(): void {
    this.invalidate(); this.unreadable = false; this.lowInformation = 0; this.failureCount = 0; this.retryAt = 0;
    this.canvas.width = 192;
    this.lastProbe = -Infinity;
  }
  dispose(): void {
    this.invalidate(); this.canvas.width = 0; this.canvas.height = 0;
    if (this.visual) this.visual.width = this.visual.height = 0;
    if (this.probe) this.probe.width = this.probe.height = 0;
    this.visual = this.probe = null; this.visualCtx = this.probeCtx = null;
  }
  async sample(settings: Settings, crop: Crop = EMPTY_CROP, request: SampleRequest = {}): Promise<Sample | null> {
    const video = this.binding.video;
    if (!this.ctx || document.hidden || !video.isConnected || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
    if (request.readPixels === false) return this.sampleVisual(settings, request.width ?? 192);
    const size = { w: 192, h: Math.max(64, Math.min(192, Math.round(192 * video.videoHeight / video.videoWidth))) };
    if (this.canvas.width !== size.w || this.canvas.height !== size.h) { this.canvas.width = size.w; this.canvas.height = size.h; }
    if (!this.unreadable) {
      try {
        this.ctx.drawImage(video, 0, 0, size.w, size.h);
        const pixels = this.ctx.getImageData(0, 0, size.w, size.h);
        let bright = 0;
        for (let i = 0; i < pixels.data.length; i += 16) if (Math.max(pixels.data[i]!, pixels.data[i + 1]!, pixels.data[i + 2]!) > 24) bright++;
        this.lowInformation = bright > pixels.data.length / 16 * .03 ? 0 : this.lowInformation + 1;
        if (this.lowInformation < 6 || !settings.compatibility) {
          this.status({ source: 'direct', message: this.lowInformation >= 6 ? 'Dark or unreadable pixels; crop held.' : 'Local video sampling' });
          return { canvas: this.canvas, pixels, source: 'direct', detectorSafe: true };
        }
      } catch {
        this.unreadable = true;
        // Changing dimensions clears a security-tainted canvas before screenshots.
        this.canvas.width = size.w;
      }
    }
    // Compatibility capture doesn't work for DRM; logic gate activation commented out for now.
    /*
    if (!settings.compatibility) { this.status({ source: 'unavailable', message: 'Video pixels unavailable. Manual framing still works.' }); return null; }
    if (window.top !== window) { this.status({ source: 'unavailable', message: 'Compatibility sampling is limited to top-level players.' }); return null; }
    const rect = video.getBoundingClientRect(), picture = this.pictureRect(rect);
    if (!picture || !this.fullyVisible(picture)) { this.status({ source: 'unavailable', message: 'Compatibility needs an unclipped complete picture; crop and backdrop held.' }); return null; }
    const neutralZoom = !settings.zoomApplied || settings.autoCrop;
    const detectorSafe = !hasCrop(crop) && settings.mode === 'fit' && neutralZoom && settings.panX === 0 && settings.panY === 0;
    // Screenshots of already-cropped pictures cannot reveal the missing source edges.
    if (settings.autoCrop && settings.ambience === 'off' && !detectorSafe) {
      this.status({ source: 'compatibility', message: 'Crop held: screenshot framing is already cropped or manually adjusted.' }); return null;
    }
    const now = performance.now();
    if (now < this.retryAt || now - this.lastCapture < 750) return null;
    this.lastCapture = now;
    if (!isContextValid()) {
      this.status({ source: 'unavailable', message: 'Extension context invalidated.' });
      return null;
    }
    const generation = this.generation, requestId = crypto.randomUUID(), viewportW = window.innerWidth, viewportH = window.innerHeight;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'JZ_CAPTURE', requestId }) as { ok: boolean; dataUrl?: string; requestId?: string; error?: string };
      if (generation !== this.generation) return null;
      const dataUrl = response?.dataUrl;
      // The compatibility path accepts only the worker's in-memory JPEG data URL, never a network URL.
      if (!response?.ok || response.requestId !== requestId || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/jpeg;base64,')) {
        throw new Error(response?.error || 'Capture unavailable');
      }
      const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
      try {
        if (generation !== this.generation || document.hidden || !video.isConnected || !sameRect(rect, video.getBoundingClientRect()) || viewportW !== window.innerWidth || viewportH !== window.innerHeight) return null;
        const sx = bitmap.width / viewportW, sy = bitmap.height / viewportH;
        this.ctx.drawImage(bitmap, picture.x * sx, picture.y * sy, picture.width * sx, picture.height * sy, 0, 0, size.w, size.h);
        const pixels = this.ctx.getImageData(0, 0, size.w, size.h);
        let bright = 0;
        for (let i = 0; i < pixels.data.length; i += 16) if (Math.max(pixels.data[i]!, pixels.data[i + 1]!, pixels.data[i + 2]!) > 24) bright++;
        if (bright < pixels.data.length / 16 * .03) {
          this.failureCount++; this.retryAt = performance.now() + (this.failureCount >= 3 ? 20000 : 1500);
          this.status({ source: 'unavailable', message: 'Screenshot pixels are dark or unavailable; validated crop held.' }); return null;
        }
        this.failureCount = 0; this.retryAt = 0;
        this.status({ source: 'compatibility', message: detectorSafe ? 'Local visible-tab sampling' : 'Visible-tab Ambience; detected crop held.' });
        return { canvas: this.canvas, pixels, source: 'compatibility', detectorSafe };
      } finally { bitmap.close(); }
    } catch (error) {
      if (generation !== this.generation) return null;
      if (isContextInvalidationError(error) || !isContextValid()) {
        markContextInvalid();
        this.status({ source: 'unavailable', message: 'Extension context invalidated.' });
        return null;
      }
      this.failureCount++; this.retryAt = performance.now() + (this.failureCount >= 3 ? 20000 : 1500);
      this.status({ source: 'unavailable', message: 'Compatibility capture unavailable; manual framing still works.' }); return null;
    }
    */
    this.status({ source: 'unavailable', message: 'Video pixels unavailable. Manual framing still works.' });
    return null;
  }
  private sampleVisual(settings: Settings, width: number): Sample | null {
    if (this.unreadable) {
      this.status({ source: 'unavailable', message: 'Video pixels unavailable. Manual framing still works.' });
      return null;
    }
    if (!this.visual) {
      this.visual = document.createElement('canvas');
      // Visual frames should not inherit the detector canvas's frequent-read hint.
      this.visualCtx = this.visual.getContext('2d');
      this.probe = document.createElement('canvas'); this.probe.width = 16; this.probe.height = 9;
      this.probeCtx = this.probe.getContext('2d', { willReadFrequently: true });
    }
    if (!this.visualCtx || !this.probeCtx || !this.probe) return null;
    const video = this.binding.video, height = Math.max(Math.round(width / 3), Math.min(width, Math.round(width * video.videoHeight / video.videoWidth)));
    if (this.visual.width !== width || this.visual.height !== height) {
      this.visual.width = width; this.visual.height = height;
    }
    try {
      this.visualCtx.drawImage(video, 0, 0, width, height);
      const now = performance.now();
      // Preserve a readability/black-frame check without reading every visual frame.
      if (now - this.lastProbe >= 1000) {
        this.probeCtx.drawImage(this.visual, 0, 0, 16, 9);
        const pixels = this.probeCtx.getImageData(0, 0, 16, 9);
        let bright = 0;
        for (let i = 0; i < pixels.data.length; i += 4) if (Math.max(pixels.data[i]!, pixels.data[i + 1]!, pixels.data[i + 2]!) > 24) bright++;
        this.lowInformation = bright > 16 * 9 * .03 ? 0 : this.lowInformation + 1;
        this.lastProbe = now;
      }
      if (this.lowInformation >= 6 && settings.compatibility) {
        this.status({ source: 'unavailable', message: 'Video pixels unavailable. Manual framing still works.' });
        return null;
      }
      this.status({ source: 'direct', message: this.lowInformation >= 6 ? 'Dark or unreadable pixels; crop held.' : 'Local video sampling' });
      return { canvas: this.visual, pixels: null, source: 'direct', detectorSafe: false };
    } catch {
      this.unreadable = true;
      this.visual.width = width; this.probe.width = 16;
      this.status({ source: 'unavailable', message: 'Video pixels unavailable. Manual framing still works.' });
      return null;
    }
  }
  private pictureRect(rect: DOMRect): DOMRect | null {
    const video = this.binding.video, cs = getComputedStyle(video);
    if (cs.objectPosition !== '50% 50%' || cs.clipPath !== 'none') return null;
    if (!['contain', 'scale-down', 'fill'].includes(cs.objectFit)) return null;
    // Rotated/skewed elements cannot be mapped from an axis-aligned screenshot box.
    if (cs.transform !== 'none') { const matrix = new DOMMatrix(cs.transform); if (!matrix.is2D || Math.abs(matrix.b) > .001 || Math.abs(matrix.c) > .001 || matrix.a <= 0 || matrix.d <= 0 || Math.abs(matrix.a - matrix.d) > .001) return null; }
    if (cs.objectFit === 'fill') return rect;
    const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight, cs.objectFit === 'scale-down' ? 1 : Infinity);
    const w = video.videoWidth * scale, h = video.videoHeight * scale;
    return new DOMRect(rect.x + (rect.width - w) / 2, rect.y + (rect.height - h) / 2, w, h);
  }
  private fullyVisible(rect: DOMRect): boolean {
    if (rect.width < 24 || rect.height < 24 || rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight) return false;
    for (let ancestor = this.binding.video.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const cs = getComputedStyle(ancestor), box = ancestor.getBoundingClientRect();
      if (cs.transform !== 'none') { const matrix = new DOMMatrix(cs.transform); if (!matrix.is2D || Math.abs(matrix.b) > .001 || Math.abs(matrix.c) > .001 || matrix.a <= 0 || matrix.d <= 0 || Math.abs(matrix.a - matrix.d) > .001) return false; }
      if (['hidden', 'clip', 'scroll', 'auto'].includes(cs.overflowX) && (rect.left < box.left - 1 || rect.right > box.right + 1)) return false;
      if (['hidden', 'clip', 'scroll', 'auto'].includes(cs.overflowY) && (rect.top < box.top - 1 || rect.bottom > box.bottom + 1)) return false;
      if (cs.clipPath !== 'none') return false;
    }
    return true;
  }
}
