# Project Roadmap & Immediate TODOs

This document tracks upcoming features and enhancements for **just_zoom**, ordered by execution priority.

---

## 1. Power Gestures: Mouse Wheel Zoom & Pan + "Reset Pan"
- [ ] **Mouse Wheel Zoom**:
  - Hold modifier key (`Alt` or configurable) + mouse wheel over video player to smoothly adjust zoom factor.
  - Rate-limited with smooth RAF interpolation to prevent stutter.
- [ ] **Drag-to-Pan**:
  - Hold modifier key (`Alt` or configurable) + click & drag video canvas to adjust X/Y pan offsets in real-time.
  - Visual cursor indicator (grab / grabbing) while gesture is active.
- [ ] **Dedicated "Reset Pan" Action**:
  - Add a distinct "Reset pan" button in the Toolbar popup and floating panel to reset `panX = 0, panY = 0` without resetting the current zoom level or mode.

---

## 2. Minimal On-Screen Display (HUD)
- [ ] **Optional In-Player HUD**:
  - Setting in Options & Popup: "Show on-screen action indicator" (default: **disabled**).
  - Minimalist semi-transparent pill overlay in the player corner.
  - Displays brief (~1.2s fade) feedback when shortcuts or gestures are used (e.g., `Zoom 1.35×`, `Pan Reset`, `Fit`, `Fill`).

---

## 3. Multi-Monitor Display Profiles
- [ ] **Automatic Screen Geometry Detection**:
  - Read `window.screen.width`, `window.screen.height`, and aspect ratio without extra permissions.
  - Automatically adapt target fill ratios when window is moved between screens (e.g. 16:10 laptop screen vs. 21:9 ultrawide monitor).
- [ ] **Settings Integration**:
  - Allow automatic screen-matching (default) with an optional manual aspect ratio override in settings.

---

## 4. Cross-Browser Distribution (Firefox & Safari)
- [ ] **WXT Multi-Target Configuration**:
  - Add build scripts and manifest tweaks for Firefox (`npm run build:firefox`) and Safari.
  - Verify storage, content script injection, and MV3/MV2 permission parity.

---

## 5. Auto-Crop & Dynamic Aspect Ratio (Standby)
- [ ] **Standby / Future Milestone**:
  - Baked-in black bar detection using temporal confidence & hysteresis.
  - Dynamic aspect ratio / IMAX scene change smoothing (e.g. 1.5s transition window).

---

## 6. Subtitle & Caption Safe-Zone Clamping
- [ ] **Feasibility & Architecture Investigation**:
  - Research DOM subtitle containers for primary streaming services (YouTube, Netflix, Prime, Disney+).
  - Evaluate dynamic vertical translation (`translateY`) to pull captions into the visible video frame during 21:9 zoom.
