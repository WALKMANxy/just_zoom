# Privacy Policy for just_zoom

*Last updated: October 7, 2026*

**just_zoom** is committed to protecting your privacy. This Privacy Policy explains what the extension handles on your device and why it needs each browser permission.

---

### 1. No Data Collection by the Developer
**just_zoom does not collect, transmit, or sell any personal information or user data. The developer receives nothing from the extension.**
* No analytics or telemetry services are used.
* No browsing history or media consumption habits are tracked, logged, or sent anywhere.
* No accounts, sign-ins, or profile registrations are required.
* No remote servers or cloud backends receive data from the extension.

Everything described below happens locally in your browser.

---

### 2. What the Extension Handles Locally

* **Saved preferences, including website hostnames:**
  Your settings (such as Fit or Fill mode, zoom level, pan offsets, Ambience, display profile overrides, language, and custom keyboard shortcuts) are stored in `chrome.storage.local`. When you keep per-site settings, they are saved under the website's hostname (for example `www.youtube.com`) so they can be restored on your next visit. This data stays in your browser profile; you can review and delete it from the extension's Options page, and it is removed when you uninstall the extension.

* **Video frames for Ambience:**
  When Ambience is on, the extension draws small, downscaled copies of the playing video's frames into an in-memory canvas to paint the blurred or coloured backdrop. These frames are processed immediately and are never saved, uploaded, or shared.

* **Changes to the web page:**
  To fit, fill, zoom, and pan a video, the extension modifies the player on the page: it applies visual styles (scale and translation) to the video, adds its own buttons to player toolbars, and on plain HTML5 videos can replace the browser's built-in controls with its own player bar. On some streaming services it also adjusts the player's own overlays so its buttons remain clickable. These changes are removed when you turn the extension off or leave the page. The extension does not read or change form fields, messages, credentials, or other page content.

---

### 3. Use of Browser Permissions

The extension requests only the permissions it needs:

* **Storage:**
  Used to keep the preferences described above on your device.

* **Downloads:**
  Used only when you choose **Download** in the extension's player menu on a plain HTML5 video. The browser downloads that video's own file directly from the website that serves it; the extension does not send it anywhere else.

* **Host Permissions (`<all_urls>`):**
  Required to find HTML5 `<video>` players on the websites you visit and apply the page changes described above.

---

### 4. Remote Code
**just_zoom contains zero remote code.** All scripts, styles, and assets are packaged and executed entirely from your local browser installation in compliance with Chrome Web Store Manifest V3 policies.

---

### 5. Third-Party Sharing
Because just_zoom does not collect data, **no user data is ever sold, transferred, or disclosed to third parties.**

---

### 6. Contact
If you have any questions or feedback regarding this Privacy Policy, please contact:
* **Email:** justzoom.dev@gmail.com
* **GitHub:** [https://github.com/WALKMANxy/just_zoom](https://github.com/WALKMANxy/just_zoom)
