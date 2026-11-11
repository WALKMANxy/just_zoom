// Debug-only DRM capture probes (stripped from release builds via DEBUG).
// Trigger from the page console or automation:
//   window.postMessage({ source: 'jz-dev', type: 'drm-probe' }, '*')
// The result is posted back as { source: 'jz-dev-result', type: 'drm-probe', result } and
// mirrored to <html data-jz-drm-probe>. Each method reports whether the pixels look black
// (protected output) or real, using luminance mean/std over a small downsample.
import { DEBUG } from '../shared/debug';

interface Stats { w: number; h: number; mean: number; std: number; max: number; bright: number; grid: number[] }
type Result = { ok: true; verdict: 'black' | 'flat' | 'real'; stats: Stats; ms: number; note?: string } | { ok: false; error: string; ms: number };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const round = (value: number, digits = 1) => +value.toFixed(digits);

function stats(data: Uint8ClampedArray | Uint8Array, w: number, h: number): Stats {
  let sum = 0, sq = 0, max = 0, bright = 0, n = 0;
  const grid = new Array<number>(32).fill(0), counts = new Array<number>(32).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, lum = .2126 * data[i]! + .7152 * data[i + 1]! + .0722 * data[i + 2]!;
    sum += lum; sq += lum * lum; max = Math.max(max, lum); if (lum > 24) bright++; n++;
    const cell = Math.min(3, Math.floor(y / h * 4)) * 8 + Math.min(7, Math.floor(x / w * 8));
    grid[cell]! += lum; counts[cell]!++;
  }
  const mean = sum / n;
  return { w, h, mean: round(mean), std: round(Math.sqrt(Math.max(0, sq / n - mean * mean))), max: round(max), bright: round(bright / n, 3),
    grid: grid.map((value, i) => Math.round(value / Math.max(1, counts[i]!))) };
}
const verdict = (s: Stats): 'black' | 'flat' | 'real' => s.max <= 16 ? 'black' : s.std < 3 ? 'flat' : 'real';
const gridDiff = (a: Stats, b: Stats) => round(a.grid.reduce((total, value, i) => total + Math.abs(value - b.grid[i]!), 0) / a.grid.length);

async function timed(fn: () => Promise<{ stats: Stats; note?: string }> | { stats: Stats; note?: string }): Promise<Result> {
  const start = performance.now();
  try {
    const { stats: s, note } = await fn();
    return { ok: true, verdict: verdict(s), stats: s, ms: round(performance.now() - start), ...(note ? { note } : {}) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error), ms: round(performance.now() - start) };
  }
}

function read2d(source: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, w = 64, h = 36): Stats {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
  return stats(ctx.getImageData(0, 0, w, h).data, w, h);
}

function findVideo(): HTMLVideoElement | null {
  const videos: HTMLVideoElement[] = [];
  const walk = (root: Document | ShadowRoot) => {
    videos.push(...root.querySelectorAll('video'));
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
  };
  walk(document);
  const area = (v: HTMLVideoElement) => { const r = v.getBoundingClientRect(); return r.width * r.height; };
  return videos.filter(v => v.readyState >= 2 && v.videoWidth > 0).sort((a, b) => Number(a.paused) - Number(b.paused) || area(b) - area(a))[0] ?? null;
}

function pictureRect(video: HTMLVideoElement): DOMRect {
  const rect = video.getBoundingClientRect(), fit = getComputedStyle(video).objectFit;
  if (fit === 'fill') return rect;
  const scale = (fit === 'cover' ? Math.max : Math.min)(rect.width / video.videoWidth, rect.height / video.videoHeight);
  const w = video.videoWidth * scale, h = video.videoHeight * scale;
  return new DOMRect(rect.x + (rect.width - w) / 2, rect.y + (rect.height - h) / 2, w, h);
}

function webgl(video: HTMLVideoElement): Stats {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: false });
  if (!gl) throw new Error('WebGL unavailable');
  try {
    const texture = gl.createTexture(), fb = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    const error = gl.getError(); if (error) throw new Error(`texImage2D GL error ${error}`);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const w = video.videoWidth, h = video.videoHeight, out = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    // Subsample to 64x36 so the stats are comparable with the 2D paths.
    const small = new Uint8Array(64 * 36 * 4);
    for (let y = 0; y < 36; y++) for (let x = 0; x < 64; x++) {
      const src = (Math.floor(y / 36 * h) * w + Math.floor(x / 64 * w)) * 4, dst = (y * 64 + x) * 4;
      small.set(out.subarray(src, src + 4), dst);
    }
    return stats(small, 64, 36);
  } finally { gl.getExtension('WEBGL_lose_context')?.loseContext(); }
}

async function decodeDataUrl(dataUrl: string): Promise<ImageBitmap> {
  return createImageBitmap(await (await fetch(dataUrl)).blob());
}

async function screenshot(video: HTMLVideoElement): Promise<{ video: Stats; page: Stats; note: string }> {
  if (window.top !== window) throw new Error('captureVisibleTab probe runs in the top frame only');
  const rect = pictureRect(video), viewW = innerWidth, viewH = innerHeight;
  const response = await chrome.runtime.sendMessage({ type: 'JZ_CAPTURE', requestId: crypto.randomUUID() }) as { ok: boolean; dataUrl?: string; error?: string };
  if (!response?.ok || !response.dataUrl) throw new Error(response?.error ?? 'capture failed');
  const bitmap = await decodeDataUrl(response.dataUrl);
  try {
    const sx = bitmap.width / viewW, sy = bitmap.height / viewH;
    const x = Math.max(0, rect.x), y = Math.max(0, rect.y), w = Math.min(viewW, rect.right) - x, h = Math.min(viewH, rect.bottom) - y;
    if (w < 8 || h < 8) throw new Error('video rect not visible');
    return { video: read2d(bitmap, x * sx, y * sy, w * sx, h * sy), page: read2d(bitmap, 0, 0, bitmap.width, bitmap.height),
      note: `shot ${bitmap.width}x${bitmap.height}, view ${viewW}x${viewH}, dpr ${devicePixelRatio}` };
  } finally { bitmap.close(); }
}

function artworkCandidates(video: HTMLVideoElement): { kind: string; url: string }[] {
  const list: { kind: string; url: string }[] = [];
  if (video.poster) list.push({ kind: 'poster', url: video.poster });
  const art = navigator.mediaSession?.metadata?.artwork ?? [];
  const best = [...art].sort((a, b) => parseInt(b.sizes ?? '0') - parseInt(a.sizes ?? '0'))[0];
  if (best?.src) list.push({ kind: 'mediaSession', url: new URL(best.src, location.href).href });
  const og = document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content;
  if (og) list.push({ kind: 'og:image', url: new URL(og, location.href).href });
  const imgs = [...document.querySelectorAll('img')].filter(img => img.complete && img.naturalWidth >= 320 && img.getBoundingClientRect().width > 0)
    .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight);
  if (imgs[0]) list.push({ kind: 'largest-img', url: imgs[0].currentSrc || imgs[0].src });
  return list.filter(item => /^https?:/i.test(item.url)).slice(0, 4);
}

async function probe(): Promise<Record<string, unknown>> {
  const video = findVideo();
  if (!video) return { error: 'no ready <video> in this frame', frame: window === window.top ? 'top' : location.href };
  const rect = pictureRect(video);
  const meta = {
    host: location.hostname, frame: window === window.top ? 'top' : 'iframe', video: `${video.videoWidth}x${video.videoHeight}`,
    rect: [rect.x, rect.y, rect.width, rect.height].map(v => Math.round(v)), paused: video.paused, t: round(video.currentTime),
    mediaKeys: video.mediaKeys !== null, fullscreen: !!document.fullscreenElement, focused: document.hasFocus(), dpr: devicePixelRatio,
  };
  const direct2d = await timed(() => ({ stats: read2d(video, 0, 0, video.videoWidth, video.videoHeight) }));
  const imageBitmap = await timed(async () => {
    const bitmap = await createImageBitmap(video);
    try { return { stats: read2d(bitmap, 0, 0, bitmap.width, bitmap.height) }; } finally { bitmap.close(); }
  });
  const videoFrame = await timed(() => {
    if (typeof VideoFrame === 'undefined') throw new Error('VideoFrame unsupported');
    const frame = new VideoFrame(video, { timestamp: 0 });
    try { return { stats: read2d(frame, 0, 0, frame.displayWidth, frame.displayHeight), note: `format ${frame.format}` }; } finally { frame.close(); }
  });
  const gl = await timed(() => ({ stats: webgl(video) }));
  // Several spaced shots: a playing real video changes between shots, a frozen/black surface does not.
  const shots: (Result & { page?: Stats })[] = [];
  for (let i = 0; i < 4; i++) {
    if (i) await sleep(800);
    let page: Stats | undefined;
    const result = await timed(async () => { const s = await screenshot(video); page = s.page; return { stats: s.video, note: s.note }; });
    shots.push(page ? { ...result, page } : result);
  }
  const okShots = shots.filter((s): s is Extract<Result, { ok: true }> => s.ok);
  const shotMotion = okShots.slice(1).map((s, i) => gridDiff(okShots[i]!.stats, s.stats));
  const artwork = [];
  for (const candidate of artworkCandidates(video)) {
    artwork.push({ ...candidate, result: await timed(async () => {
      const response = await chrome.runtime.sendMessage({ type: 'JZ_DEV_FETCH_IMAGE', url: candidate.url }) as { ok: boolean; dataUrl?: string; error?: string };
      if (!response?.ok || !response.dataUrl) throw new Error(response?.error ?? 'fetch failed');
      const bitmap = await decodeDataUrl(response.dataUrl);
      try { return { stats: read2d(bitmap, 0, 0, bitmap.width, bitmap.height), note: `${bitmap.width}x${bitmap.height}` }; } finally { bitmap.close(); }
    }) });
  }
  return { meta, direct2d, imageBitmap, videoFrame, webgl: gl, captureVisibleTab: { shots, motion: shotMotion }, artwork, at: new Date().toISOString() };
}

export function installDrmProbe(): () => void {
  if (!DEBUG) return () => {};
  let running = false;
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window || event.data?.source !== 'jz-dev' || event.data.type !== 'drm-probe' || running) return;
    running = true;
    void probe().catch(error => ({ error: String(error) })).then(result => {
      running = false;
      if (!('error' in result) || window === window.top) {
        try { document.documentElement.dataset.jzDrmProbe = JSON.stringify(result); } catch { /* detached */ }
        window.postMessage({ source: 'jz-dev-result', type: 'drm-probe', result }, '*');
        console.debug('[jz] drm-probe', result);
      }
    });
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}
