# Handoff: Ambience for DRM, bar fill, UI cleanup, perf fixes

Written 2026-11-13. Branch: `claude/ambience-integration` (worktree `.claude/worktrees/ambience-int`).
**Not merged into `main`. Not pushed.** `main` (1190728) already has everything before this work: native buttons, Stremio, gestures, faster activation, subtitle overlay.

## What this branch adds (on top of main)
| Area | Commit(s) | State |
|---|---|---|
| DRM Ambience: protected video sampled via `chrome.tabs.captureVisibleTab` (JZ_CAPTURE in `entrypoints/background.ts`, `src/features/frame-source.ts`) | from `claude/drm-ambience-51355a` | verified live on Netflix, Prime, Disney+ |
| Cheap capture: JPEG q10 (was 65), every shot freed before decode, debug `protectedSample` stats | from `claude/ambience-lowres-capture-59a104` | verified: ~27–41 KB/shot, ~6 ms decode, flat heap over 90 s |
| Morph transitions (`src/features/ambience.ts`), low-rate and direct path | from `claude/ambience-morph-8092de` | low-rate verified smooth; direct path (YouTube) **not verified** |
| Fill black bars (`ambienceFillBars`): temporal detector, clip-path on the video so the main Ambience shows through, 3 px sentinel line on DRM, fast retract / slow accept | `0ca37ea`, `eb2d1e9`, `0c946fd`, `134a03e` | verified on Netflix letterbox; user accepted the thin sentinel line. Pillarbox, IMAX-style changes, Prime/Disney+ **not verified** |
| UI cleanup + Fill black bars Off/On + `drmWorkaround` checkbox (default ON) gating the screenshot path | `1a33300` (merged in `9b78382`) | **not verified** |
| Perf audit fixes 1–10 (no 5 s status ping, discovery poll backoff 1.5→5→15 s, cached cue rules, bar-fill layout diffing, cached clipSafe/cue visibility, morph frame skipping, buffer reuse, canvas shrink) | `fc98a80..a541d9e` (merged in `2735bdd`) | **not verified** |

Typecheck (`npx tsc --noEmit`) and `npm run build` pass at `2735bdd`.

## Next steps
1. **Combined browser test** of `2735bdd` (the Chrome tab group the parent used was lost; make a new one):
   - Test slot: `node D:/coding/just_zoom/tools/test-build.mjs acquire|build|release <owner>`. It is currently **held by `ambience-int`**, and build `2735bdd` is already in `.testbuild/extension`. Reload from a page running a debug build: `window.postMessage({source:'jz-dev',type:'reload'},'*')`, then reload the tabs. Confirm via `JSON.parse(document.documentElement.dataset.jzDebug).build`.
   - captureVisibleTab only works when the tab is active and the Chrome window is focused. The user has to focus tabs and do fullscreen by hand.
   - Popup: Fill black bars Off/On, DRM checkbox (off → DRM Ambience/bar fill stop with "pixels unavailable", on → resumes without a reload), YouTube unaffected. Options page: same controls; Save and reload persist them.
   - Netflix/Prime/Disney+: Ambience morphs smoothly (`ambienceMorphFrame` well under 30/s on slow scenes), bar fill appears within ~10 s on letterboxed content and retracts when the picture grows. Clicking away from Chrome holds the backdrop; pausing settles it.
   - YouTube: activation as fast as before (`latency.attach`), direct morph smooth at each `ambienceRate`, the `schedule` counter rises slowly while paused.
   - Stremio: subtitle overlay styling unchanged; caption setting changes apply within ~5 s.
   - Service worker: with only a paused-video tab open it should stop after ~30 s (chrome://serviceworker-internals), and the popup still finds the player afterwards.
2. After the user OKs: merge `claude/ambience-integration` into `main`. Never push.
3. Follow-ups noted, not done:
   - Translations for the new en keys (`controls_drm_workaround`, `controls_drm_workaround_hint`, the fill-bars keys, the protected-status keys, the rewritten `options_info_ambience_desc`).
   - A PRIVACY.md line about local visible-tab screenshots on protected video.
   - Whether `drmWorkaround` should default to OFF (the UI session suggested it; the user asked for ON).
   - Known risk: a video swapped inside a shadow root can take up to 15 s to rebind.
   - Audit item 11 (Auto Crop readPixels) skipped on purpose: it would flip the sampling path.
   - Cleanup once merged: delete the merged branches/worktrees (`drm-ambience-51355a`, `ambience-lowres-capture-59a104`, `ambience-morph-8092de`, `ambience-bar-fill-c981f2`, `ui-cleanup-498aee`, `perf-fixes-223ff1`, plus the older `integration`, `native-buttons`, `cue-overlay` ones), and release the test slot.

## Evidence and design notes
In the shared side-session notes folder (outside the repo; `docs/` is gitignored):
`C:\Users\artor\AppData\Local\Claude-Data\claude_pzs8sxrjxfjjc\side-session-notes\local_2ccd8008-c4a3-42e0-aaf5-7a110c180a21\`
- `G-drm-results.md`: probe results. Chrome 157, AMD D3D11, HW accel on. Canvas, WebGL, ImageBitmap and VideoFrame are all black or throw on Netflix/Prime/Disney+; captureVisibleTab returns real frames windowed and fullscreen.
- `G-drm-frame-source.md`, `G2-drm-lowres-capture.md`, `H-ambience-morph.md`, `H-ambience-bar-fill.md`, `I-ui-cleanup.md`, `I-perf-fixes.md`: per-feature design, measurements and verification steps.

## Working rules the user set
- AGENTS.md applies: no tests by default, smallest verification, exact restore on cleanup.
- Merge only with the user's explicit OK; never push.
- Browser work only in a Chrome tab group the agent creates itself; the user adds the tabs and does the fullscreen steps.
- Never print or reuse page localStorage or auth data.
