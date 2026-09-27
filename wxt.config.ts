import { defineConfig } from 'wxt';

export default defineConfig({
  zip: {
    excludeSources: ['**/artifacts/**', '**/framing/**', '**/docs/**', '**/scripts/**', '**/store_media/**', '**/AGENTS.md', 'index*.html'],
  },
  manifest: {
    name: 'just_zoom',
    description: 'Fit, fill, frame and softly illuminate web video. Entirely local.',
    version: '0.5.0',
    permissions: ['storage'],
    icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
    options_ui: { page: 'options.html', open_in_tab: true },
    host_permissions: ['<all_urls>'],
    commands: {
      'toggle-zoom': { description: 'Apply or disable zoom' },
      'zoom-in': { description: 'Increase zoom' },
      'zoom-out': { description: 'Decrease zoom' },
      // 'toggle-auto-crop': { description: 'Start or stop Auto Zoom' },
      'toggle-ambience': { description: 'Start or stop Ambience' },
      'toggle-controls': { description: 'Open just_zoom controls' },
      'reset': { description: 'Reset video framing' },
      'pan-left': { description: 'Pan left' },
      'pan-right': { description: 'Pan right' },
      'pan-up': { description: 'Pan up' },
      'pan-down': { description: 'Pan down' },
    },
    browser_specific_settings: {
      gecko: {
        id: 'just_zoom@local',
        strict_min_version: '109.0',
      },
    },
  },
});
