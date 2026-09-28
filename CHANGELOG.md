# Changelog

All notable changes to **just_zoom** are documented in this file.

## [0.6.0] - 2026-09-28

### Added
- **Native HTML5 Player Controls Workaround**:
  - Replaces standard `<video controls>` with an unscaled, pixel-faithful Shadow DOM controls bar that remains visible and interactive regardless of zoom factor or pan offset.
  - Complete control suite: Play/Pause/Replay, scrub timeline with buffered progress and hover preview, upward vertical volume slider popup with mute toggle, dedicated `just_zoom` button, and 3-dots options menu.
  - 3-dots menu features: Playback speed selection (0.25× to 2×), Picture-in-Picture, and Video Download for accessible media streams via background service worker with fallback.
  - Container-level fullscreen support that fixes Chromium top-layer occlusion bugs, keeping controls and overlays visible.
  - Keyboard shortcut navigation (Space/K, arrows, F, M) and idle cursor/bar auto-suppression.
- **Experimental Settings Toggle**:
  - Added "HTML5 native player controls workaround" setting under the Experimental tab, enabled by default, with complete toggle support and seamless fallback to generic floating controls.
- **Background Downloads Permission**: Added Chromium `downloads` permission to handle cross-origin video downloads cleanly without CORS rejection.

### Fixed
- **Player Lifecycle & Disable Restoration**:
  - Fixed a lifecycle bug where disabling `just_zoom` caused the native controls to flash for a split second before vanishing. Decoupled DOM wrapping from the discovery pass, ensuring native controls are cleanly restored and stay active when disabled.
- **Layout Sliver Padding**:
  - Fixed an 18px baseline descender spacing issue on standalone video elements when not in fullscreen.

## [0.5.0] - 2026-09-27

### Added
- **Multi-Monitor Aspect Ratio Buckets**: Per-site framing preferences are now bucketed by display aspect ratio (`16:9`, `21:9`, `32:9`, `other`), automatically restoring the correct framing when moving a player between different displays.
- **Display Detection & Profile Lab**: Options page now displays live screen resolution, aspect ratio, and active bucket detection with per-site profile inspection and deletion.

### Fixed
- **Floating Badge Auto-Hide & Focus Trapping**:
  - Fixed an issue where closing the quick controls panel left focus inside the shadow DOM, preventing the floating badge from concealing when moving the cursor away.
  - Added auto-hide timeouts: 500ms on leaving proximity, 2.5s inactivity timeout when stationary near the button, and 300ms on panel close, window blur, or cursor leaving the document.
  - Restricted focus-based visibility to genuine keyboard `:focus-visible` navigation.
- **Settings Synchronization**: Hardened storage serialization across frames and background workers to prevent race conditions during site-profile writes.
- **Provider Controls**: Refined Disney+ pointer exclusion synchronization and Netflix player button spacer alignment.

## [0.4.0] - 2026-09-25

### Added
- Native in-player control integration for Disney+ and Netflix with custom styling and spacer alignment.
- Pointer exclusion overlay handling for Disney+ custom control masks.

### Fixed
- Zoom mode restoration across player navigation and fullscreen changes.
- In-player toolbar button sizing, positioning, and hover state transitions.

## [0.3.0] - 2026-09-24

### Added
- Initial release of **just_zoom**.
- Fit and Fill modes for ultrawide (21:9, 32:9) and custom displays.
- Alt + scroll zoom and Alt + drag pan gestures.
- Action HUD indicator for real-time zoom multiplier and pan offset feedback.
- Ambience lighting effect for standard HTML5 video.
- In-player quick controls and browser action toolbar popup.
