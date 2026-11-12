// One shared MediaQueryList: `.matches` stays live, so callers on hot paths
// (morph frames, fades) don't build a new query object each time.
let query: MediaQueryList | null = null;

export const reducedMotion = (): boolean => (query ??= matchMedia('(prefers-reduced-motion: reduce)')).matches;
