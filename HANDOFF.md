# Handoff: DRM Ambience on NVIDIA RTX, Netflix trickplay lead

Written 2026-11-16. Branch: `claude/ambience-integration` (pushed to `origin`). **Not merged into `main`.**
`main` (1190728) has everything before this branch: native buttons, Stremio, gestures, faster activation, subtitle overlay.

## What this branch adds (on top of main)
| Area | State |
|---|---|
| DRM Ambience: protected video sampled via `chrome.tabs.captureVisibleTab` (`JZ_CAPTURE` in `entrypoints/background.ts`, `sampleProtected` in `src/features/frame-source.ts`) | works only on software-protected streams (see findings) |
| Cheap capture (JPEG q10), morph transitions (`src/features/ambience.ts`), fill black bars, UI cleanup, perf fixes 1–10 | from the earlier sessions; mostly **not verified** in the browser |
| **This session:** `drmWorkaround` now defaults to **off** (`src/shared/types.ts`), so sites that need screenshots start without Ambience | built, not browser-verified |
| **This session:** DRM workaround hint (`controls_drm_workaround_hint` in `locales/en.json` + fallback in `entrypoints/options/index.html`) warns it is not compatible with NVIDIA RTX Video/RTX HDR | built, not browser-verified |

Typecheck passes. The test build in `.testbuild/extension` (slot held by `ambience-test`) is this state.
Saved settings keep their old `drmWorkaround` value; only new/unsaved settings get the off default.

## Findings on the user's NVIDIA PC (RTX Video + RTX HDR on, Chrome, HW accel on)
1. **Every `captureVisibleTab` shot makes the screen flash.** Confirmed on Disney+ with a 3-phase test while playing:
   regular sampling = 10 shots / 10 s, DRM checkbox off = 0 shots, probe burst = 4 shots in 2.7 s; the user saw flashes
   exactly matching the shots. Extension code does nothing visual per shot, so the capture itself (most likely the video
   leaving the HW overlay where RTX Video/HDR is applied) is the cause. Not fixable from the extension except by not capturing.
   RTX doesn't run on paused video, so tests must run while playing.
2. **Netflix (3840x2160) and Prime (1920x1080) serve hardware-protected (L1) streams here: every capture of the video area
   is black** (Netflix shot video mean ~1/255, and Claude in Chrome's own screenshot is fully black). Canvas/WebGL read black,
   ImageBitmap/VideoFrame throw. So Ambience and bar fill can never work there via screenshots.
   - The debug probe (`src/features/drm-probe.ts`) labels these shots `real` because player UI pixels push `max` to ~239. Its
     verdict should use the mean/grid of the video rect, not max.
   - `sampleProtected` never checks for blank shots: it draws a black backdrop and still reports `status_protected_sampling`.
3. **Disney+ serves 854x480 (software-protected) → shots are real** (video mean 50–114), Ambience works but flickers per (1).

## Lead: Netflix trickplay (BIF) as a screenshot-free source
- Seek-bar preview = `img[data-uia="trick-play-image"]`, a 320x180 `blob:` JPEG. Drawing it to a canvas works (not tainted).
- Netflix keeps **one in-memory BIF buffer** (3,222,365 bytes for the test episode; header `89 42 49 46 0d 0a 1a 0a`,
  version 0, frame count `0x196` = 406, about one frame per 10 s). Each preview blob is a `Uint8Array` slice of it
  (JPEG `ff d8 ff e0`). Found by wrapping `window.Blob` while hovering.
- Hovering triggers **no network request**: the BIF is fetched at playback start. Note the page's resource-timing buffer is
  full (250 entries), so use a `PerformanceObserver` or `performance.clearResourceTimings()` when looking.
- Not yet known: how the BIF is downloaded (XHR vs fetch vs worker), its URL pattern, and whether a main-world hook at
  `document_start` can catch it. That is the first thing to check.
- Plan sketch: main-world script on netflix.com catches the BIF (magic check), parses the index (timestamp multiplier at
  offset 16, index from offset 64: pairs of little-endian uint32 timestamp × multiplier ms / byte offset; standard Roku BIF layout, verify on Netflix's file), hands JPEG bytes for `video.currentTime` to the
  content script; Ambience morphs between ~10 s frames. Bar detection could run on the 320x180 frames.

## Prime and Disney+
- **Prime:** no seek-bar previews at all for the test title, so no trickplay source. Only options: no Ambience (current
  default), a still backdrop tinted from the title artwork, or forcing software DRM (lower-quality stream, but it still needs
  screenshots, so it still flickers with RTX).
- **Disney+:** has seek previews; check whether they're BIF too. If so, the Netflix approach would also remove its flicker.

## Next steps
1. Netflix: find how the BIF is fetched and prototype the trickplay source (the user picked this direction; check Disney+ too).
2. `sampleProtected`: detect blank captures (video-rect mean/grid, several shots in a row), keep the last backdrop, show a
   "player blocks screenshots on this device" status, back off and stop. Fix the probe verdict the same way.
3. Then the remaining combined browser test from the earlier handoff (popup/options controls, YouTube, Stremio, service worker).
4. Follow-ups: translations for the new en keys (`controls_drm_workaround*`, fill-bars keys, protected-status keys,
   `options_info_ambience_desc`), a PRIVACY.md line about local screenshots, release the test slot
   (`node tools/test-build.mjs release ambience-test`), delete merged side branches after the merge into `main`.

## Notes
- `J-rtx-hdr-flicker.md` (analysis of the flicker) is in the side-session notes folder
  `C:\Users\artor\AppData\Local\Claude-Data\claude_pzs8sxrjxfjjc\side-session-notes\local_2ccd8008-c4a3-42e0-aaf5-7a110c180a21\`.
  The earlier `G-*`, `H-*`, `I-*` notes listed in the previous handoff are no longer on disk.
- Browser testing ran in a Claude in Chrome tab group (Netflix, YouTube, Prime, chrome://gpu tabs). The user focuses tabs,
  hovers seek bars and toggles settings by hand.

## Working rules the user set
- AGENTS.md applies: no tests by default, smallest verification, exact restore on cleanup.
- Merge into `main` only with the user's explicit OK.
- Don't turn off RTX Video/RTX HDR/Windows HDR for testing: test as is.
- Browser work only in a tab group the agent creates; never print or reuse page localStorage, auth data or URL tokens.
