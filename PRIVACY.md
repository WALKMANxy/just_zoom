# Privacy Policy for just_zoom

*Last updated: September 27, 2026*

**just_zoom** is committed to protecting your privacy. This Privacy Policy explains our practices regarding user data and permissions.

---

### 1. Zero Data Collection
**just_zoom does not collect, store, track, transmit, or sell any personal information or user data.**
* No analytics or telemetry services are used.
* No browsing history, visited URLs, or media consumption habits are tracked or logged.
* No accounts, sign-ins, or profile registrations are required.
* No remote servers or cloud backends receive data from the extension.

---

### 2. Use of Browser Permissions

The extension requests only the minimum permissions necessary to function:

* **Storage (`chrome.storage.local`):**
  Used exclusively on your local device to remember your framing settings (such as Fit or Fill mode, custom zoom multipliers, pan offsets, display profile overrides, and custom keyboard shortcuts). This data never leaves your browser.

* **Host Permissions (`<all_urls>`):**
  Required to detect and interact with standard HTML5 `<video>` elements across websites where you choose to play video. The extension's content script inspects the DOM solely to locate the video element and apply CSS visual transforms (scale and translation) when you activate zoom or pan controls. The extension does not read, modify, or transmit any web page content, personal data, or credentials.

---

### 3. Remote Code
**just_zoom contains zero remote code.** All scripts, styles, and assets are packaged and executed entirely from your local browser installation in compliance with Chrome Web Store Manifest V3 policies.

---

### 4. Third-Party Sharing
Because just_zoom collects no data, **no user data is ever sold, transferred, or disclosed to third parties.**

---

### 5. Contact
If you have any questions or feedback regarding this Privacy Policy, please contact:
* **Email:** justzoom.dev@gmail.com
* **GitHub:** [https://github.com/WALKMANxy/just_zoom](https://github.com/WALKMANxy/just_zoom)
