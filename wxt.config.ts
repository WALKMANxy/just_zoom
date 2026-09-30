import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/i18n/module'],
  zip: {
    excludeSources: ['**/artifacts/**', '**/framing/**', '**/docs/**', '**/scripts/**', '**/store_media/**', '**/AGENTS.md', 'index*.html'],
  },
  manifest: {
    default_locale: 'en',
    name: '__MSG_manifest_name__',
    description: '__MSG_manifest_description__',
    version: '0.7.0',
    permissions: ['storage', 'downloads'],
    icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
    options_ui: { page: 'options.html', open_in_tab: true },
    host_permissions: ['<all_urls>'],
    commands: {
      'toggle-zoom': { description: '__MSG_command_toggle_zoom__' },
      'zoom-in': { description: '__MSG_command_zoom_in__' },
      'zoom-out': { description: '__MSG_command_zoom_out__' },
      // 'toggle-auto-crop': { description: '__MSG_command_toggle_auto_crop__' },
      'toggle-ambience': { description: '__MSG_command_toggle_ambience__' },
      'toggle-controls': { description: '__MSG_command_toggle_controls__' },
      'reset': { description: '__MSG_command_reset__' },
      'pan-left': { description: '__MSG_command_pan_left__' },
      'pan-right': { description: '__MSG_command_pan_right__' },
      'pan-up': { description: '__MSG_command_pan_up__' },
      'pan-down': { description: '__MSG_command_pan_down__' },
    },
    browser_specific_settings: {
      gecko: {
        id: 'just_zoom@local',
        strict_min_version: '109.0',
      },
    },
  },
});
