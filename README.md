# just_zoom

A lightweight, privacy-focused browser extension that makes web video fit ultrawide and custom displays correctly.

Built with Manifest V3 and WXT. Runs 100% locally in your browser with no accounts, subscriptions, telemetry, or background services.

---

## Features

- **Fit & Fill modes:** Scale videos to fill ultrawide (21:9, 32:9) or custom screens without stretching or distortion.
- **Mouse gestures:**
  - Hold `Alt` + scroll wheel over the video to zoom smoothly.
  - Hold `Alt` + click and drag to pan (reframe X/Y).
  - Dedicated **Reset Pan** button to re-center framing without losing your zoom level.
- **Display profiles & auto-detection:** Automatically reads screen aspect ratios to apply correct fill dimensions, with manual overrides for multi-monitor setups.
- **Action HUD:** Subtle pill in the player corner showing current zoom multiplier and pan offset during gestures.
- **Player controls:**
  - Integrated in-player button for tested services: YouTube, Netflix, Prime Video, and Disney+.
  - Floating player panel and browser toolbar popup for all other video platforms and generic HTML5 players.
- **Ambience backdrops (non-DRM video):** Optional soft or full blurred background lighting matching video colors on standard HTML5 players.

---

## Installation

### From Release Zips
1. Download the zip for your browser from [Releases](https://github.com/WALKMANxy/just_zoom/releases):
   - `just-zoom-*-chrome.zip` (Chrome, Brave, Edge, Opera, Vivaldi)
   - `just-zoom-*-firefox.zip` (Firefox)
   - `just-zoom-*-safari.zip` (Safari)
2. **Chrome / Brave / Edge:**
   - Go to `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
   - Unzip the downloaded file and click **Load unpacked**, then select the extracted folder.
3. **Firefox:**
   - Go to `about:debugging#/runtime/this-firefox`.
   - Click **Load Temporary Add-on…** and select the extension zip or manifest.

---

## Controls

### Mouse Gestures
| Action | Input |
|---|---|
| Zoom | Hold `Alt` + Scroll wheel over video |
| Pan | Hold `Alt` + Click & drag video |
| Reset pan | Click **Reset pan** in toolbar popup or player panel |

*(The modifier key can be changed to `Ctrl`, `Shift`, or `Cmd` in settings).*

### Keyboard Shortcuts
| Action | Shortcut |
|---|---|
| Toggle Zoom on/off | `Alt` + `Shift` + `Z` |
| Zoom in / out | `Alt` + `=` / `Alt` + `-` |
| Toggle Ambience | `Alt` + `Shift` + `B` |
| Reset framing | `Alt` + `Shift` + `R` |
| Open controls | `Alt` + `Shift` + `S` |
| Pan video | `Alt` + `Shift` + Arrow keys |

*All shortcuts can be remapped in settings.*

---

## Building from Source

Prerequisites: Node.js 18+

```bash
# Clone repository
git clone https://github.com/WALKMANxy/just_zoom.git
cd just_zoom

# Install dependencies
npm install

# Dev mode with hot reload
npm run dev

# Typecheck
npm run typecheck

# Build extension for Chrome, Firefox, and Safari
npm run build:all

# Package distribution zips
npm run zip:all
```

Build artifacts are written to `.output/`.

---

## License

MIT
