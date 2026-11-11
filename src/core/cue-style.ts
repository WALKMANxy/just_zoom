// Reads the page's own `::cue` styling so overlay subtitles keep the site look.
// getComputedStyle(video, '::cue') does not reflect page rules reliably, so the
// same-origin CSSOM is scanned instead. Sites often rewrite these rules through
// CSSOM (no DOM mutation), so callers re-read on every cuechange; the signature
// lets them skip work when nothing changed.

const PROPS = ['color', 'background-color', 'text-shadow', 'font-family', 'font-weight', 'font-style', 'font-size', 'opacity',
  '-webkit-text-stroke-width', '-webkit-text-stroke-color'] as const;

export interface CueRules { signature: string; decls: [string, string][] }

// Whether one selector of a list targets the whole cue of this video (`::cue(x)` styles inner nodes only).
const targets = (selector: string, video: HTMLVideoElement) => {
  const at = selector.indexOf('::cue');
  if (at < 0 || selector.startsWith('(', at + 5)) return false;
  if (selector.slice(at + 5).trim()) return false;
  const base = selector.slice(0, at).trim();
  if (!base || base === '*') return true;
  try { return video.matches(base); } catch { return false; }
};

export function readCueRules(video: HTMLVideoElement): CueRules {
  const texts: string[] = [], decls = new Map<string, string>();
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        if (!rule.selectorText.includes('::cue') || !rule.selectorText.split(',').some(part => targets(part.trim(), video))) continue;
        texts.push(rule.cssText);
        // Later rules win; specificity between cue rules is not modelled.
        for (const prop of PROPS) {
          const value = rule.style.getPropertyValue(prop);
          if (value) { decls.delete(prop); decls.set(prop, value); }
        }
      } else if (rule instanceof CSSMediaRule) {
        if (matchMedia(rule.media.mediaText || 'all').matches) visit(rule.cssRules);
      } else if ('cssRules' in rule && !(rule instanceof CSSImportRule)) {
        visit((rule as CSSGroupingRule).cssRules);
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    if (sheet.disabled) continue;
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; } // Cross-origin sheet.
    visit(rules);
  }
  return { signature: texts.join('\n'), decls: [...decls] };
}

// Viewport units on a native cue resolve against the video box, so map them to the visible player box.
export function resolveCueValue(value: string, box: { width: number; height: number }) {
  return value.replace(/(-?\d*\.?\d+)(vmin|vmax|vh|vw)\b/g, (_, n: string, unit: string) => {
    const base = unit === 'vh' ? box.height : unit === 'vw' ? box.width
      : unit === 'vmin' ? Math.min(box.width, box.height) : Math.max(box.width, box.height);
    return `${(Number.parseFloat(n) * base) / 100}px`;
  });
}
