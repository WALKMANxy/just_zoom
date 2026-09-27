# Project Roadmap & Upcoming Milestones

This document tracks future features and planned enhancements for **just_zoom**, ordered by execution priority.

---

## 1. Internationalization & Localization (i18n)
- [ ] **Extension i18n Architecture**:
  - Implement Chrome extension localization infrastructure using standard `_locales/` message bundles (`messages.json`).
  - Configure `default_locale: "en"` in extension manifest.
- [ ] **UI String Extraction**:
  - Replace hardcoded text in options page, toolbar popup, Action HUD, and in-player shadow DOM controls with `chrome.i18n.getMessage(...)`.
  - Maintain symbolic consistency for AV terms, ratios (`21:9`, `32:9`), and multipliers (`1.34×`).
- [ ] **Targeted Language Releases**:
  - Review Chrome Web Store geographic installation analytics after initial release to prioritize localization.
  - Initial target tier: German, French, Spanish, Japanese, Simplified Chinese, and Portuguese (Brazil).
  - Add localized store metadata, titles, and descriptions in the Chrome Developer Console.

---

## 2. Subtitle & Caption Safe-Zone Clamping
- [ ] **DOM Subtitle Container Discovery**:
  - Research DOM subtitle hierarchies across primary streaming services (YouTube, Netflix, Prime Video, Disney+).
  - Identify whether subtitles render inside the transformed video container, as sibling DOM overlays, or inside closed shadow roots.
- [ ] **Dynamic Caption Translation (`translateY`)**:
  - Evaluate dynamic vertical translation to pull subtitles upward into the visible video frame during ultrawide zoom/fill framing.
  - Implement configurable safety margin padding to prevent captions from clipping against bottom display borders.

---

## 3. Auto-Crop & Dynamic Aspect Ratio (Standby)
- [ ] **Baked-In Black Bar Detection**:
  - Reactivate and refine `src/features/detector.ts` for automated border detection.
  - Downsampled luminance/variance sampling with temporal confidence and hysteresis to resist dark scenes, fades, and logos.
- [ ] **Dynamic Aspect Ratio Transitions**:
  - Smooth interpolation for scene changes with alternating aspect ratios (e.g. IMAX sequences).
  - User-configurable sensitivity and instant manual override fallback.
