import { EMPTY_CROP, type Crop } from '../shared/types';

export interface Detection { crop: Crop; confidence: number }
const edges = ['top', 'right', 'bottom', 'left'] as const;
export const distance = (a: Crop, b: Crop) => Math.max(...edges.map(edge => Math.abs(a[edge] - b[edge])));

/** Conservative border evidence: ambiguous dark scenes produce no observation. */
export function detectBorders(image: ImageData): Detection | null {
  const { width: w, height: h, data } = image;
  if (w < 24 || h < 24) return null;
  const luma = new Float32Array(w * h);
  for (let i = 0; i < luma.length; i++) luma[i] = .2126 * data[i * 4]! + .7152 * data[i * 4 + 1]! + .0722 * data[i * 4 + 2]!;
  let bright = 0, centerCount = 0;
  for (let y = Math.floor(h * .3); y < h * .7; y++) for (let x = Math.floor(w * .3); x < w * .7; x++) {
    centerCount++; if (luma[y * w + x]! > 38) bright++;
  }
  if (bright / centerCount < .16) return null;
  const crop = { ...EMPTY_CROP };
  for (const edge of edges) {
    const horizontal = edge === 'top' || edge === 'bottom';
    const length = horizontal ? w : h, depth = horizontal ? h : w;
    const profiles: { dark: boolean; bright: number; mean: number }[] = [];
    // Central strips avoid the other pair of bars in windowboxed content.
    for (let d = 0; d < Math.ceil(depth * .3); d++) {
      const values: number[] = [];
      for (let p = Math.floor(length * .2); p < length * .8; p++) {
        const x = horizontal ? p : edge === 'left' ? d : w - 1 - d;
        const y = horizontal ? edge === 'top' ? d : h - 1 - d : p;
        values.push(luma[y * w + x]!);
      }
      values.sort((a, b) => a - b);
      const n = Math.max(1, Math.floor(values.length * .9));
      let sum = 0, squared = 0, light = 0;
      for (let i = 0; i < values.length; i++) {
        const value = values[i]!; if (value > 32) light++;
        if (i < n) { sum += value; squared += value * value; }
      }
      const mean = sum / n;
      profiles.push({ dark: values[n - 1]! <= 22 && mean <= 18 && squared / n - mean * mean <= 35, mean, bright: light / values.length });
    }
    let d = 0, skipped = 0;
    const maxBand = Math.max(2, Math.floor(depth * .06));
    while (d < profiles.length) {
      if (profiles[d]!.dark) { d++; continue; }
      // Subtitles/logos can occupy a few rows inside otherwise continuous
      // padding. Only bridge a narrow, partial-width band when at least two
      // fully dark rows resume beyond it; a real full-width picture boundary
      // cannot satisfy this condition. Bound both band depth and total holes.
      let resume = d;
      while (resume < profiles.length && resume - d < maxBand && !profiles[resume]!.dark && profiles[resume]!.bright <= .65) resume++;
      const band = resume - d;
      if (d >= 3 && band > 0 && skipped + band <= maxBand && profiles[resume]?.dark && profiles[resume + 1]?.dark) {
        skipped += band; d = resume; continue;
      }
      break;
    }
    if (d === profiles.length) return null;
    if (d < 2) continue;
    const boundary = profiles.slice(d, d + 4);
    const insideMean = boundary.reduce((sum, p) => sum + p.mean, 0) / boundary.length;
    const insideBright = boundary.reduce((sum, p) => sum + p.bright, 0) / boundary.length;
    const padding = profiles.slice(0, d).filter(profile => profile.dark);
    if (padding.length / d < .65) return null;
    const barMean = padding.reduce((sum, p) => sum + p.mean, 0) / padding.length;
    if (boundary.length < 3 || insideMean - barMean < 16 || insideBright < .25) return null;
    // Retain one source pixel at the boundary rather than eat real picture.
    crop[edge] = (d - 1) / depth;
  }
  return { crop, confidence: .9 };
}

export class CropTracker {
  private accepted: Crop = { ...EMPTY_CROP };
  private candidate: Crop | null = null;
  private since = 0;
  private count = 0;
  private last = 0;
  /** Longest gap between agreeing observations; low-rate screenshot sampling needs more than direct sampling. */
  maxGap = 1400;
  get crop(): Crop { return { ...this.accepted }; }
  setCrop(crop: Crop): void { this.accepted = { ...crop }; this.clearCandidate(); }
  clearCandidate(): void { this.candidate = null; this.count = 0; this.last = 0; }
  reset(): void { this.accepted = { ...EMPTY_CROP }; this.clearCandidate(); }
  observe(observation: Detection | null, now: number): Crop | null {
    if (!observation || observation.confidence < .8) { this.clearCandidate(); return null; }
    if (distance(observation.crop, this.accepted) < .015) { this.clearCandidate(); return null; }
    if (!this.candidate || distance(observation.crop, this.candidate) > .015 || now - this.last > this.maxGap) {
      this.candidate = { ...observation.crop }; this.since = now; this.count = 0;
    }
    this.count++; this.last = now;
    const enlarging = edges.some(edge => observation.crop[edge] > this.accepted[edge] + .015);
    if (this.count < 4 || now - this.since < (enlarging ? 1800 : 1200)) return null;
    this.accepted = { ...observation.crop }; this.clearCandidate(); return this.crop;
  }
}

type Edge = typeof edges[number];
export interface BarDiagnostics {
  reason: string; centre: number; frames: number; content: number;
  /** Dark run depth per edge, in sample rows/columns. */
  runs: Record<Edge, number>;
  /** Brightest windowed value just inside each run (the content boundary). */
  inside: Record<Edge, number>;
}
const BAR_WINDOW_MS = 16000;
const BAR_WINDOW_FRAMES = 48;

/**
 * Bar detector for Ambience fill. A single frame cannot separate padding from dark content,
 * and protected screenshots arrive at ~1 Hz as heavily quantised JPEG, so this keeps per-row
 * medians and takes the brightest value each row reached over a time window: padding never
 * lights up, content does at some point. Fades and black frames add nothing to the maximum,
 * so they cannot create bars; a bar also needs a clearly bright boundary and a matching
 * opposite bar (letterbox/pillarbox padding is centred).
 */
export class BarHistory {
  private frames: { at: number; content: boolean; rows: Record<Edge, Uint8Array> }[] = [];
  private size = '';
  diagnostics: BarDiagnostics = { reason: 'idle', centre: 0, frames: 0, content: 0, runs: { ...EMPTY_CROP }, inside: { ...EMPTY_CROP } };
  reset(): void { this.frames = []; this.size = ''; }
  observe(image: ImageData, now: number, quantised: boolean): Detection | null {
    const { width: w, height: h, data } = image;
    const runs = { ...EMPTY_CROP }, inside = { ...EMPTY_CROP };
    const finish = (reason: string, centre: number, result: Detection | null) => {
      this.diagnostics = { reason, centre: +centre.toFixed(3), frames: this.frames.length, content: this.frames.filter(f => f.content).length, runs, inside };
      return result;
    };
    if (w < 24 || h < 24) return finish('too-small', 0, null);
    if (this.size !== `${w}x${h}`) { this.reset(); this.size = `${w}x${h}`; }
    const luma = new Uint8Array(w * h);
    for (let i = 0; i < luma.length; i++) luma[i] = .2126 * data[i * 4]! + .7152 * data[i * 4 + 1]! + .0722 * data[i * 4 + 2]!;
    let bright = 0, count = 0;
    for (let y = Math.floor(h * .3); y < h * .7; y++) for (let x = Math.floor(w * .3); x < w * .7; x++) { count++; if (luma[y * w + x]! > 32) bright++; }
    const centre = bright / count;
    const rows = {} as Record<Edge, Uint8Array>;
    for (const edge of edges) {
      const horizontal = edge === 'top' || edge === 'bottom';
      const length = horizontal ? w : h, depth = horizontal ? h : w;
      const profile = new Uint8Array(Math.ceil(depth * .3)), values: number[] = [];
      for (let d = 0; d < profile.length; d++) {
        values.length = 0;
        // Central strip avoids the other bar pair; the median ignores captions, logos and JPEG ringing.
        for (let p = Math.floor(length * .2); p < length * .8; p++) {
          const x = horizontal ? p : edge === 'left' ? d : w - 1 - d;
          const y = horizontal ? edge === 'top' ? d : h - 1 - d : p;
          values.push(luma[y * w + x]!);
        }
        values.sort((a, b) => a - b);
        profile[d] = values[values.length >> 1]!;
      }
      rows[edge] = profile;
    }
    this.frames.push({ at: now, content: centre >= .05, rows });
    while (this.frames.length > BAR_WINDOW_FRAMES || this.frames[0]!.at < now - BAR_WINDOW_MS) this.frames.shift();
    if (this.frames.filter(f => f.content).length < 3) return finish('few-content-frames', centre, null);
    // Flat black compresses exactly even at low JPEG quality; ringing only reaches the boundary row,
    // which the run then stops at. Screenshots still get a little more headroom.
    const dark = quantised ? 22 : 20, boundary = dark + 12;
    const crop = { ...EMPTY_CROP };
    for (const edge of edges) {
      const n = rows[edge].length, depth = edge === 'top' || edge === 'bottom' ? h : w, peak = new Uint8Array(n);
      for (const frame of this.frames) for (let d = 0; d < n; d++) if (frame.rows[edge][d]! > peak[d]!) peak[d] = frame.rows[edge][d]!;
      let d = 0, skipped = 0;
      const maxBand = Math.max(2, Math.floor(depth * .08));
      while (d < n) {
        if (peak[d]! <= dark) { d++; continue; }
        // Bridge a narrow lit band (burned-in text, a progress line) only inside continuing padding.
        let resume = d;
        while (resume < n && resume - d < maxBand && peak[resume]! > dark) resume++;
        if (d >= 3 && skipped + resume - d <= maxBand && peak[resume] !== undefined && peak[resume]! <= dark && peak[resume + 1] !== undefined && peak[resume + 1]! <= dark) {
          skipped += resume - d; d = resume; continue;
        }
        break;
      }
      runs[edge] = d;
      inside[edge] = d < n ? Math.max(...peak.subarray(d, d + 3)) : 0;
      if (d === n) return finish(`ambiguous-${edge}`, centre, null);
      if (d < 2) continue;
      if (inside[edge] < boundary) return finish(`weak-boundary-${edge}`, centre, null);
      // Same convention as detectBorders: keep one boundary row; the fill adds it back.
      crop[edge] = (d - 1) / depth;
    }
    // Real padding is centred: keep a pair only when both sides have it, at the smaller depth.
    for (const [a, b] of [['top', 'bottom'], ['left', 'right']] as const) {
      const both = crop[a] > 0 && crop[b] > 0, value = both ? Math.min(crop[a], crop[b]) : 0;
      crop[a] = crop[b] = value;
    }
    return finish('ok', centre, { crop, confidence: .9 });
  }
}
