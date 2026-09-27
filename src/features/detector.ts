import { EMPTY_CROP, type Crop } from '../shared/types';

export interface Detection { crop: Crop; confidence: number }
const edges = ['top', 'right', 'bottom', 'left'] as const;
const distance = (a: Crop, b: Crop) => Math.max(...edges.map(edge => Math.abs(a[edge] - b[edge])));

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
  get crop(): Crop { return { ...this.accepted }; }
  setCrop(crop: Crop): void { this.accepted = { ...crop }; this.clearCandidate(); }
  clearCandidate(): void { this.candidate = null; this.count = 0; this.last = 0; }
  reset(): void { this.accepted = { ...EMPTY_CROP }; this.clearCandidate(); }
  observe(observation: Detection | null, now: number): Crop | null {
    if (!observation || observation.confidence < .8) { this.clearCandidate(); return null; }
    if (distance(observation.crop, this.accepted) < .015) { this.clearCandidate(); return null; }
    if (!this.candidate || distance(observation.crop, this.candidate) > .015 || now - this.last > 1400) {
      this.candidate = { ...observation.crop }; this.since = now; this.count = 0;
    }
    this.count++; this.last = now;
    const enlarging = edges.some(edge => observation.crop[edge] > this.accepted[edge] + .015);
    if (this.count < 4 || now - this.since < (enlarging ? 1800 : 1200)) return null;
    this.accepted = { ...observation.crop }; this.clearCandidate(); return this.crop;
  }
}
