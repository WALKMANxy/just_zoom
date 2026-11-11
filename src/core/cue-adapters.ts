// Adapter hooks for the native-cue overlay: site selectors only, no rendering logic.
// A hook returns the player's control bar so subtitles can be lifted above it while
// it is visible. Sites without a hook keep the plain bottom-anchored overlay.

type ControlsHook = (video: HTMLVideoElement) => HTMLElement | null;

const hooks: { host: RegExp; controls: ControlsHook }[] = [
  {
    // Stremio Web: the player is a stack of `.layer-*` siblings; the control bar layer
    // keeps its box when idle and is moved/faded out by the `immersed` player state.
    host: /(^|\.)(stremio\.com|strem\.io)$/,
    controls: video => video.closest<HTMLElement>('[class*="player-container"]')
      ?.querySelector<HTMLElement>('[class*="control-bar-layer"], [class*="control-bar-container"]') ?? null,
  },
];

export function cueControlsElement(video: HTMLVideoElement): HTMLElement | null {
  const hook = hooks.find(item => item.host.test(location.hostname));
  try { return hook?.controls(video) ?? null; } catch { return null; }
}
