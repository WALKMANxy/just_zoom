# Changelog

All notable changes to **just_zoom** are documented in this file.

## [0.7.0] - 2026-09-30

### Added
- **Full Internationalization (i18n)**:
  - Added complete localization across 18 languages: English (`en`), German (`de`), Japanese (`ja`), Spanish (`es`), French (`fr`), Portuguese (Brazil) (`pt_BR`), Simplified Chinese (`zh_CN`), Traditional Chinese (`zh_TW`), Korean (`ko`), Italian (`it`), Russian (`ru`), Polish (`pl`), Dutch (`nl`), Turkish (`tr`), Ukrainian (`uk`), Vietnamese (`vi`), Indonesian (`id`), and Czech (`cs`).
  - 100% key parity (294 keys per locale) covering all extension interfaces: in-player toolbar buttons, quick controls menu, floating popups, on-screen display (HUD) feedback, browser action popup, keyboard shortcut recorder, player test lab, and extension settings.
- **Dedicated Language Tab**:
  - Added a dedicated "Language" tab to the extension options page to allow manual language selection with instant UI updates or automatic fallback to browser default.
- **Dynamic Runtime Translation**:
  - Implemented client-side dictionary loading and reactive translation listeners so language changes apply immediately across all open player instances and popups without needing a reload.

### Fixed
- **Chromium Variable Syntax Compliance**: Resolved message placeholder collisions (`$1×` / `$2×`) ensuring strict compatibility with Chromium, Firefox, and Safari manifest/locale parsers.
- **Settings Language Validation**: Updated settings normalization and storage synchronization to securely validate all 18 supported languages.

## [0.6.5] - 2026-09-30

### Changed
- **Ambience modes**: Replaced Soft/Full and experimental renderer buttons with Off, Blur, and Colour. Blur uses a padded low-resolution video image blurred before enlargement; Colour uses a smoothed spatial color field. Both retain Full's brightness and backdrop extent.
- **Ambience processing**: Separated visual sampling from pixel analysis, using small periodic readability checks rather than reading every backdrop frame. Ticks are skipped while media time is unchanged, with existing pause, visibility, fullscreen, and teardown handling preserved.
- **Update rate**: Added Default (75 ms), Performance (150 ms), and Quality (40 ms), ordered with Default first. These delays run after each sampling/rendering tick finishes.
- **New-install defaults**: Ambience now starts with Blur and the Default update rate. Player controls default to Both, listed before Native button and Floating popup. Existing saved preferences are migrated, including explicit Off choices.
- **Settings interface**: Added concise explanations for ambience appearance and update rate across the player panel, toolbar popup, and options page. Saved-site labels reflect migrated preferences.

### Fixed
- **Player panel layout**: Added scrolling and viewport positioning limits so the expanded quick controls remain accessible in smaller windows.

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
