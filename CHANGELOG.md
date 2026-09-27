# Changelog

All notable changes to **just_zoom** are documented in this file.

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
