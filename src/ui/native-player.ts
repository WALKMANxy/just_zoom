import type { ControlsHandlers, PlayerBinding, Settings } from '../shared/types';
import { i18n } from '#i18n';

export interface NativePlayerController {
  update(settings: Settings): void;
  rebind(binding: PlayerBinding): void;
  dispose(): void;
}

const STYLE_DOC = `
.jz-native-player {
  position: relative !important;
  display: block !important;
  width: 100% !important;
  height: 100% !important;
  max-width: 100% !important;
  max-height: 100% !important;
  overflow: hidden !important;
  box-sizing: border-box !important;
  line-height: 0 !important;
  font-size: 0 !important;
  vertical-align: top !important;
  margin: 0 auto !important;
  padding: 0 !important;
  border: none !important;
  background-color: #000 !important;
}
.jz-native-player.jz-direct-media {
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  background-color: #0e0e0e !important;
}
.jz-native-player > video {
  display: block !important;
  width: 100% !important;
  height: 100% !important;
  max-width: 100% !important;
  max-height: 100% !important;
  object-fit: contain !important;
  margin: 0 auto !important;
  padding: 0 !important;
  border: none !important;
}
.jz-native-player:fullscreen,
.jz-native-player:-webkit-full-screen {
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  max-width: none !important;
  max-height: none !important;
  margin: 0 !important;
  padding: 0 !important;
  border: none !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  background-color: #000 !important;
  z-index: 2147483647 !important;
}
.jz-native-player:fullscreen > video,
.jz-native-player:-webkit-full-screen > video {
  max-width: 100vw !important;
  max-height: 100vh !important;
  width: 100% !important;
  height: 100% !important;
  object-fit: contain !important;
}
.jz-native-player.jz-fullscreen-idle,
.jz-native-player.jz-fullscreen-idle * {
  cursor: none !important;
}
`;

const STYLE_SHADOW = `
:host {
  all: initial;
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2147483645;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  user-select: none;
  -webkit-user-select: none;
}
*, *::before, *::after {
  box-sizing: border-box;
}

.jz-surface {
  position: absolute;
  inset: 0;
  bottom: 48px;
  pointer-events: auto;
  cursor: default;
}

.jz-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 48px;
  padding: 0 12px 6px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.78) 0%, rgba(0, 0, 0, 0.45) 60%, transparent 100%);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

.jz-bar.is-visible {
  opacity: 1;
  pointer-events: auto;
}

.jz-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  margin: 0;
  background: transparent;
  border: none;
  border-radius: 50%;
  color: #fff;
  cursor: pointer;
  outline: none;
  flex-shrink: 0;
  transition: background 0.15s ease, transform 0.1s ease;
}

.jz-btn:hover {
  background: rgba(255, 255, 255, 0.18);
}

.jz-btn:active {
  background: rgba(255, 255, 255, 0.28);
  transform: scale(0.95);
}

.jz-btn svg {
  width: 20px;
  height: 20px;
  display: block;
}

.jz-time {
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  margin: 0 4px;
  flex-shrink: 0;
}

.jz-timeline-wrap {
  flex: 1;
  height: 24px;
  display: flex;
  align-items: center;
  position: relative;
  cursor: pointer;
  margin: 0 4px;
}

.jz-timeline-rail {
  width: 100%;
  height: 3.5px;
  background: rgba(255, 255, 255, 0.28);
  border-radius: 2px;
  position: relative;
  transition: height 0.12s ease;
}

.jz-timeline-wrap:hover .jz-timeline-rail,
.jz-timeline-wrap.is-dragging .jz-timeline-rail {
  height: 6px;
}

.jz-timeline-buffered {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 0%;
  background: rgba(255, 255, 255, 0.45);
  border-radius: 2px;
  pointer-events: none;
}

.jz-timeline-played {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 0%;
  background: #fff;
  border-radius: 2px;
  pointer-events: none;
}

.jz-timeline-thumb {
  position: absolute;
  top: 50%;
  left: 0%;
  width: 10px;
  height: 10px;
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  transform: translate(-50%, -50%) scale(0);
  pointer-events: none;
  transition: transform 0.12s cubic-bezier(0.16, 1, 0.3, 1);
}

.jz-timeline-wrap:hover .jz-timeline-thumb,
.jz-timeline-wrap.is-dragging .jz-timeline-thumb {
  transform: translate(-50%, -50%) scale(1.3);
}

.jz-timeline-tip {
  position: absolute;
  bottom: 26px;
  left: 0%;
  transform: translateX(-50%);
  background: rgba(18, 18, 20, 0.9);
  color: #fff;
  font-size: 11px;
  padding: 3px 6px;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease;
  font-variant-numeric: tabular-nums;
  border: 1px solid rgba(255, 255, 255, 0.15);
}

.jz-timeline-wrap:hover .jz-timeline-tip,
.jz-timeline-wrap.is-dragging .jz-timeline-tip {
  opacity: 1;
}

.jz-volume-group {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.jz-volume-popup {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  width: 32px;
  height: 106px;
  padding: 13px 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(28, 28, 30, 0.95);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 16px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.55);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  z-index: 15;
}

.jz-volume-popup::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  height: 10px;
}

.jz-volume-group:hover .jz-volume-popup,
.jz-volume-group.is-active .jz-volume-popup {
  opacity: 1;
  pointer-events: auto;
}

.jz-volume-track {
  width: 4px;
  height: 80px;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 2px;
  position: relative;
  cursor: pointer;
}

.jz-volume-level {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: #fff;
  border-radius: 2px;
  pointer-events: none;
}

.jz-volume-thumb {
  position: absolute;
  left: 50%;
  bottom: 100%;
  transform: translate(-50%, 50%);
  width: 12px;
  height: 12px;
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  pointer-events: none;
  transition: transform 0.1s ease;
}

.jz-volume-track:hover .jz-volume-thumb,
.jz-volume-group.is-active .jz-volume-thumb {
  transform: translate(-50%, 50%) scale(1.2);
}

.jz-options-group {
  position: relative;
}

.jz-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  min-width: 160px;
  background: rgba(28, 28, 30, 0.95);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  padding: 4px 0;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.55);
  color: #f5f5f5;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  z-index: 20;
}

.jz-menu[hidden] {
  display: none;
}

.jz-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.12s ease;
  font-weight: 500;
  gap: 8px;
}

.jz-menu-item:hover {
  background: rgba(255, 255, 255, 0.12);
}

.jz-item-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.jz-item-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: rgba(255, 255, 255, 0.85);
  flex-shrink: 0;
}

.jz-item-icon svg {
  width: 16px;
  height: 16px;
}

.jz-menu-val {
  color: rgba(255, 255, 255, 0.65);
  font-size: 11px;
}

.jz-speed-list {
  display: flex;
  flex-direction: column;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  margin-top: 4px;
  padding-top: 4px;
}

.jz-speed-list[hidden] {
  display: none;
}

.jz-speed-opt {
  padding: 6px 12px 6px 28px;
  cursor: pointer;
  position: relative;
  font-size: 11.5px;
}

.jz-speed-opt:hover {
  background: rgba(255, 255, 255, 0.12);
}

.jz-speed-opt.is-selected {
  font-weight: 700;
  color: #fff;
}

.jz-speed-opt.is-selected::before {
  content: '✓';
  position: absolute;
  left: 10px;
  font-size: 11px;
}
`;

const ICONS = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" fill="currentColor"/></svg>',
  replay: '<svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" fill="currentColor"/></svg>',
  volHigh: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" fill="currentColor"/></svg>',
  volLow: '<svg viewBox="0 0 24 24"><path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" fill="currentColor"/></svg>',
  volMuted: '<svg viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" fill="currentColor"/></svg>',
  zoom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4.5L3.5 12L9 19.5"/><path d="M15 4.5L20.5 12L15 19.5"/></svg>',
  options: '<svg viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" fill="currentColor"/></svg>',
  fsEnter: '<svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" fill="currentColor"/></svg>',
  fsExit: '<svg viewBox="0 0 24 24"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" fill="currentColor"/></svg>',
  speed: '<svg viewBox="0 0 24 24"><path d="M20.38 8.57l-1.23 1.85a8 8 0 0 1-.22 7.58H5.07A8 8 0 0 1 15.58 6.85l1.85-1.23A10 10 0 0 0 3.35 19a2 2 0 0 0 1.72 1h13.85a2 2 0 0 0 1.74-1 10 10 0 0 0-.28-10.43zM10.59 15.41a2 2 0 1 1 2.83-2.83l2.83-2.83 1.41 1.41-2.83 2.83a2 2 0 0 1-4.24 1.42z" fill="currentColor"/></svg>',
  pip: '<svg viewBox="0 0 24 24"><path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16.01H3V4.99h18v14.02z" fill="currentColor"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="currentColor"/></svg>',
};

function formatTime(seconds: number): string {
  if (isNaN(seconds) || !isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function isNativeControlsVideo(video: HTMLVideoElement): boolean {
  if (video.parentElement?.classList.contains('jz-native-player')) return true;
  if (video.hasAttribute('data-jz-native')) return true;
  return Boolean(video.controls || video.hasAttribute('controls'));
}

export function createPlayerWrapper(video: HTMLVideoElement): HTMLElement {
  const existing = video.parentElement?.classList.contains('jz-native-player') ? video.parentElement : null;
  if (existing) return existing;

  const isDirect = video.parentElement === document.body || video.parentElement === document.documentElement;
  const wrapper = document.createElement('div');
  wrapper.className = `jz-native-player ${isDirect ? 'jz-direct-media' : ''}`;
  wrapper.tabIndex = -1;

  if (video.style.width && video.style.width !== '100%') {
    wrapper.style.width = video.style.width;
  }
  if (video.style.height && video.style.height !== '100%') {
    wrapper.style.height = video.style.height;
  }

  if (!document.getElementById('jz-native-style')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'jz-native-style';
    styleEl.textContent = STYLE_DOC;
    (document.head || document.documentElement).appendChild(styleEl);
  }

  video.parentElement?.insertBefore(wrapper, video);
  wrapper.appendChild(video);
  video.setAttribute('data-jz-native', 'true');
  video.controls = false;
  return wrapper;
}

export function unwrapPlayer(video: HTMLVideoElement): void {
  const wrapper = video.parentElement;
  if (wrapper?.classList.contains('jz-native-player')) {
    wrapper.parentElement?.insertBefore(video, wrapper);
    wrapper.remove();
  }
  video.removeAttribute('data-jz-native');
  video.controls = true;
}

function getDownloadUrl(video: HTMLVideoElement): string | null {
  const controlsList = (video.getAttribute('controlslist') || '').toLowerCase();
  const cl = (video as HTMLVideoElement & { controlsList?: DOMTokenList }).controlsList;
  if (cl && typeof cl.contains === 'function' && cl.contains('nodownload')) return null;

  let src = video.currentSrc || video.src;
  if (!src) {
    const source = video.querySelector('source');
    if (source) src = source.getAttribute('src') || source.src;
  }
  if (!src || src.startsWith('mediastream:')) return null;
  return src;
}

function fallbackAnchorDownload(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function triggerDownload(url: string) {
  let filename = 'video.mp4';
  try {
    const parsed = new URL(url, location.href);
    const last = parsed.pathname.split('/').pop();
    if (last && last.includes('.')) {
      filename = decodeURIComponent(last);
    }
  } catch { /* ignore */ }

  if (url.startsWith('blob:') || url.startsWith('file:') || url.startsWith('data:')) {
    fallbackAnchorDownload(url, filename);
    return;
  }

  try {
    chrome.runtime.sendMessage({
      type: 'JZ_DOWNLOAD_VIDEO',
      url,
      filename,
    }).then(res => {
      if (!res?.ok) {
        fallbackAnchorDownload(url, filename);
      }
    }).catch(() => {
      fallbackAnchorDownload(url, filename);
    });
  } catch {
    fallbackAnchorDownload(url, filename);
  }
}

export function createNativePlayer(
  initialBinding: PlayerBinding,
  handlers: ControlsHandlers,
): NativePlayerController {
  let binding = initialBinding;
  const { video } = binding;
  const wrapper = createPlayerWrapper(video);
  binding.viewport = wrapper;

  // Intercept video.requestFullscreen so external or browser triggers target wrapper
  const origRequestFs = video.requestFullscreen?.bind(video);
  if (origRequestFs) {
    video.requestFullscreen = async function (options?: FullscreenOptions) {
      if (wrapper.isConnected) {
        return wrapper.requestFullscreen(options);
      }
      return origRequestFs(options);
    };
  }

  const host = document.createElement('div');
  host.className = 'jz-controls-host jz-native-controls-host';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLE_SHADOW;
  shadow.appendChild(style);

  // Surface overlay (for video click/double-click)
  const surface = document.createElement('div');
  surface.className = 'jz-surface';

  // Bottom controls bar
  const bar = document.createElement('div');
  bar.className = 'jz-bar';

  // Left controls: Play button & Time display
  const playBtn = document.createElement('button');
  playBtn.className = 'jz-btn jz-play-btn';
  playBtn.type = 'button';
  playBtn.setAttribute('aria-label', i18n.t('player_play'));
  playBtn.innerHTML = ICONS.play;

  const timeDisplay = document.createElement('div');
  timeDisplay.className = 'jz-time';
  const timeCurrent = document.createElement('span');
  timeCurrent.textContent = '0:00';
  const timeSep = document.createTextNode(' / ');
  const timeDuration = document.createElement('span');
  timeDuration.textContent = '0:00';
  timeDisplay.append(timeCurrent, timeSep, timeDuration);

  // Center controls: Scrubber timeline
  const timelineWrap = document.createElement('div');
  timelineWrap.className = 'jz-timeline-wrap';

  const timelineRail = document.createElement('div');
  timelineRail.className = 'jz-timeline-rail';

  const timelineBuffered = document.createElement('div');
  timelineBuffered.className = 'jz-timeline-buffered';

  const timelinePlayed = document.createElement('div');
  timelinePlayed.className = 'jz-timeline-played';

  const timelineThumb = document.createElement('div');
  timelineThumb.className = 'jz-timeline-thumb';

  timelineRail.append(timelineBuffered, timelinePlayed, timelineThumb);

  const timelineTip = document.createElement('div');
  timelineTip.className = 'jz-timeline-tip';
  timelineTip.textContent = '0:00';

  timelineWrap.append(timelineRail, timelineTip);

  // Right controls: Volume, Zoom, Options, Fullscreen
  const volGroup = document.createElement('div');
  volGroup.className = 'jz-volume-group';

  // Vertical Volume Popup
  const volPopup = document.createElement('div');
  volPopup.className = 'jz-volume-popup';

  const volTrack = document.createElement('div');
  volTrack.className = 'jz-volume-track';
  volTrack.setAttribute('role', 'slider');
  volTrack.setAttribute('aria-label', i18n.t('player_volume'));
  volTrack.setAttribute('aria-valuemin', '0');
  volTrack.setAttribute('aria-valuemax', '100');
  volTrack.setAttribute('aria-valuenow', `${Math.round((video.muted ? 0 : video.volume) * 100)}`);

  const volLevel = document.createElement('div');
  volLevel.className = 'jz-volume-level';

  const volThumb = document.createElement('div');
  volThumb.className = 'jz-volume-thumb';

  volTrack.append(volLevel, volThumb);
  volPopup.appendChild(volTrack);

  const volBtn = document.createElement('button');
  volBtn.className = 'jz-btn jz-vol-btn';
  volBtn.type = 'button';
  volBtn.setAttribute('aria-label', i18n.t('player_mute'));
  volBtn.innerHTML = ICONS.volHigh;

  volGroup.append(volPopup, volBtn);

  // just_zoom button in the toolbar
  const zoomBtn = document.createElement('button');
  zoomBtn.className = 'jz-btn jz-zoom-btn';
  zoomBtn.type = 'button';
  zoomBtn.setAttribute('aria-label', i18n.t('controls_toggle_zoom'));
  zoomBtn.title = i18n.t('player_zoom_btn_title');
  zoomBtn.innerHTML = ICONS.zoom;

  // 3-dots options menu
  const optionsGroup = document.createElement('div');
  optionsGroup.className = 'jz-options-group';

  const optionsBtn = document.createElement('button');
  optionsBtn.className = 'jz-btn jz-options-btn';
  optionsBtn.type = 'button';
  optionsBtn.setAttribute('aria-label', i18n.t('player_options'));
  optionsBtn.title = i18n.t('player_options');
  optionsBtn.innerHTML = ICONS.options;

  const menu = document.createElement('div');
  menu.className = 'jz-menu';
  menu.hidden = true;

  // 1. Playback Speed item
  const speedItem = document.createElement('div');
  speedItem.className = 'jz-menu-item jz-speed-item';
  speedItem.innerHTML = `<div class="jz-item-left"><span class="jz-item-icon">${ICONS.speed}</span><span>${i18n.t('player_speed')}</span></div><span class="jz-menu-val jz-speed-val">1×</span>`;

  const speedList = document.createElement('div');
  speedList.className = 'jz-speed-list';
  speedList.hidden = true;

  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
  speeds.forEach(sp => {
    const opt = document.createElement('div');
    opt.className = `jz-speed-opt ${sp === (video.playbackRate || 1) ? 'is-selected' : ''}`;
    opt.dataset.speed = `${sp}`;
    opt.textContent = sp === 1 ? i18n.t('player_speed_normal') : `${sp}×`;
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      video.playbackRate = sp;
      speedList.querySelectorAll('.jz-speed-opt').forEach(el => el.classList.remove('is-selected'));
      opt.classList.add('is-selected');
      const valEl = speedItem.querySelector('.jz-speed-val');
      if (valEl) valEl.textContent = sp === 1 ? '1×' : `${sp}×`;
      speedList.hidden = true;
      menu.hidden = true;
    });
    speedList.appendChild(opt);
  });

  speedItem.addEventListener('click', (e) => {
    e.stopPropagation();
    speedList.hidden = !speedList.hidden;
  });

  // 2. Picture in Picture item
  const pipItem = document.createElement('div');
  pipItem.className = 'jz-menu-item jz-pip-item';
  pipItem.innerHTML = `<div class="jz-item-left"><span class="jz-item-icon">${ICONS.pip}</span><span>${i18n.t('player_pip')}</span></div>`;
  pipItem.addEventListener('click', async (e) => {
    e.stopPropagation();
    menu.hidden = true;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch { /* ignored */ }
  });

  // 3. Download item
  const downloadItem = document.createElement('div');
  downloadItem.className = 'jz-menu-item jz-download-item';
  downloadItem.innerHTML = `<div class="jz-item-left"><span class="jz-item-icon">${ICONS.download}</span><span>${i18n.t('player_download')}</span></div>`;
  downloadItem.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = true;
    const url = getDownloadUrl(video);
    if (url) {
      void triggerDownload(url);
    }
  });

  const syncMenuOptions = () => {
    const dl = getDownloadUrl(video);
    downloadItem.style.display = dl ? 'flex' : 'none';
  };

  menu.append(speedItem, speedList, pipItem, downloadItem);
  optionsGroup.append(optionsBtn, menu);

  // Fullscreen button
  const fsBtn = document.createElement('button');
  fsBtn.className = 'jz-btn jz-fs-btn';
  fsBtn.type = 'button';
  fsBtn.setAttribute('aria-label', i18n.t('player_fullscreen'));
  fsBtn.innerHTML = ICONS.fsEnter;

  bar.append(playBtn, timeDisplay, timelineWrap, volGroup, zoomBtn, optionsGroup, fsBtn);
  shadow.append(surface, bar);
  wrapper.appendChild(host);

  // State
  let isScrubbing = false;
  let isDraggingVolume = false;
  let isHoveringControls = false;
  let hideTimer = 0;
  let clickTimeout = 0;
  let prevVolume = video.volume || 1;

  const showControls = () => {
    clearTimeout(hideTimer);
    bar.classList.add('is-visible');
    wrapper.classList.remove('jz-fullscreen-idle');
    hideTimer = window.setTimeout(() => {
      if (!isHoveringControls && !isScrubbing && !isDraggingVolume && menu.hidden && !video.paused) {
        bar.classList.remove('is-visible');
        if (document.fullscreenElement === wrapper) {
          wrapper.classList.add('jz-fullscreen-idle');
        }
      }
    }, 2500);
  };

  const togglePlay = () => {
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
    showControls();
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await wrapper.requestFullscreen();
      }
    } catch { /* ignored */ }
  };

  // Play/Pause button
  playBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePlay();
  });

  // Video Surface click (single: play/pause, double: fullscreen)
  surface.addEventListener('click', (e) => {
    if (e.detail === 1) {
      clickTimeout = window.setTimeout(() => {
        togglePlay();
      }, 220);
    } else if (e.detail === 2) {
      clearTimeout(clickTimeout);
      void toggleFullscreen();
    }
  });

  // Timeline Scrubbing
  const updateScrub = (e: PointerEvent) => {
    const rect = timelineRail.getBoundingClientRect();
    if (!rect.width || !video.duration) return;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const target = ratio * video.duration;
    video.currentTime = target;
    timelinePlayed.style.width = `${ratio * 100}%`;
    timelineThumb.style.left = `${ratio * 100}%`;
    timeCurrent.textContent = formatTime(target);
  };

  const onTimelineMove = (e: PointerEvent) => {
    if (!isScrubbing) return;
    updateScrub(e);
  };

  const onTimelineUp = (e: PointerEvent) => {
    if (!isScrubbing) return;
    isScrubbing = false;
    timelineWrap.classList.remove('is-dragging');
    window.removeEventListener('pointermove', onTimelineMove);
    window.removeEventListener('pointerup', onTimelineUp);
    window.removeEventListener('pointercancel', onTimelineUp);
    showControls();
  };

  timelineWrap.addEventListener('pointerdown', (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isScrubbing = true;
    timelineWrap.classList.add('is-dragging');
    updateScrub(e);
    window.addEventListener('pointermove', onTimelineMove);
    window.addEventListener('pointerup', onTimelineUp);
    window.addEventListener('pointercancel', onTimelineUp);
  });

  timelineWrap.addEventListener('pointermove', (e: PointerEvent) => {
    const rect = timelineRail.getBoundingClientRect();
    if (!rect.width || !video.duration) return;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const hoverTime = ratio * video.duration;
    timelineTip.textContent = formatTime(hoverTime);
    timelineTip.style.left = `${ratio * 100}%`;
  });

  // Volume UI & Events
  const updateVolUI = () => {
    const effectiveVol = video.muted ? 0 : video.volume;
    const pct = Math.round(effectiveVol * 100);
    volLevel.style.height = `${pct}%`;
    volThumb.style.bottom = `${pct}%`;
    volTrack.setAttribute('aria-valuenow', `${pct}`);

    if (video.muted || effectiveVol === 0) {
      volBtn.innerHTML = ICONS.volMuted;
    } else if (effectiveVol <= 0.5) {
      volBtn.innerHTML = ICONS.volLow;
    } else {
      volBtn.innerHTML = ICONS.volHigh;
    }
  };

  const updateVolumeFromPointer = (e: PointerEvent) => {
    const rect = volTrack.getBoundingClientRect();
    if (!rect.height) return;
    const ratio = Math.max(0, Math.min(1, (rect.bottom - e.clientY) / rect.height));
    video.volume = ratio;
    video.muted = ratio === 0;
    if (ratio > 0) prevVolume = ratio;
    updateVolUI();
  };

  const onVolPointerMove = (e: PointerEvent) => {
    if (!isDraggingVolume) return;
    updateVolumeFromPointer(e);
  };

  const onVolPointerUp = (e: PointerEvent) => {
    if (!isDraggingVolume) return;
    isDraggingVolume = false;
    volGroup.classList.remove('is-active');
    window.removeEventListener('pointermove', onVolPointerMove);
    window.removeEventListener('pointerup', onVolPointerUp);
    window.removeEventListener('pointercancel', onVolPointerUp);
    showControls();
  };

  volTrack.addEventListener('pointerdown', (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingVolume = true;
    volGroup.classList.add('is-active');
    updateVolumeFromPointer(e);
    window.addEventListener('pointermove', onVolPointerMove);
    window.addEventListener('pointerup', onVolPointerUp);
    window.addEventListener('pointercancel', onVolPointerUp);
  });

  volBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (video.muted) {
      video.muted = false;
      if (video.volume === 0) video.volume = prevVolume || 0.5;
    } else {
      prevVolume = video.volume;
      video.muted = true;
    }
    updateVolUI();
    showControls();
  });

  volGroup.addEventListener('wheel', (e: WheelEvent) => {
    if (e.deltaY === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    const next = Math.max(0, Math.min(1, +(video.volume + delta).toFixed(2)));
    video.volume = next;
    video.muted = next === 0;
    if (next > 0) prevVolume = next;
    updateVolUI();
    showControls();
  }, { passive: false });

  // Zoom button
  zoomBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handlers.activate();
  });
  zoomBtn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handlers.action('toggle-controls');
  });
  zoomBtn.addEventListener('wheel', (e) => {
    if (e.deltaY === 0) return;
    e.preventDefault();
    e.stopPropagation();
    handlers.action(e.deltaY < 0 ? 'zoom-in' : 'zoom-out');
  }, { passive: false });

  // 3-dots menu
  optionsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    if (!menu.hidden) {
      speedList.hidden = true;
      syncMenuOptions();
    }
  });

  const onWindowPointerDown = (e: MouseEvent) => {
    if (menu.hidden) return;
    const path = e.composedPath();
    if (!path.includes(optionsGroup)) {
      menu.hidden = true;
      speedList.hidden = true;
    }
  };
  window.addEventListener('pointerdown', onWindowPointerDown);

  // Fullscreen button
  fsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    void toggleFullscreen();
  });

  // Auto-hide hover tracking
  bar.addEventListener('pointerenter', () => { isHoveringControls = true; clearTimeout(hideTimer); });
  bar.addEventListener('pointerleave', () => { isHoveringControls = false; showControls(); });

  const onWrapperPointerMove = () => {
    showControls();
  };
  wrapper.addEventListener('pointermove', onWrapperPointerMove);

  // Keyboard Navigation
  const onKeyDown = (e: KeyboardEvent) => {
    const active = document.activeElement;
    if (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return;
    const isPlayerFocused = wrapper.contains(active) || document.fullscreenElement === wrapper;
    if (!isPlayerFocused) return;

    if (e.key === ' ' || e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      void toggleFullscreen();
    } else if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      video.muted = !video.muted;
      updateVolUI();
      showControls();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      video.currentTime = Math.max(0, video.currentTime - 5);
      showControls();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
      showControls();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      video.volume = Math.min(1, +(video.volume + 0.05).toFixed(2));
      video.muted = false;
      updateVolUI();
      showControls();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      video.volume = Math.max(0, +(video.volume - 0.05).toFixed(2));
      updateVolUI();
      showControls();
    }
  };
  window.addEventListener('keydown', onKeyDown);

  // Video Events
  const onPlayPause = () => {
    if (video.ended) {
      playBtn.innerHTML = ICONS.replay;
      playBtn.setAttribute('aria-label', i18n.t('player_replay'));
    } else if (video.paused) {
      playBtn.innerHTML = ICONS.play;
      playBtn.setAttribute('aria-label', i18n.t('player_play'));
    } else {
      playBtn.innerHTML = ICONS.pause;
      playBtn.setAttribute('aria-label', i18n.t('player_pause'));
    }
    showControls();
  };

  const onTimeUpdate = () => {
    if (!isScrubbing) {
      const cur = video.currentTime || 0;
      const dur = video.duration || 0;
      timeCurrent.textContent = formatTime(cur);
      if (dur > 0) {
        timeDuration.textContent = formatTime(dur);
        const pct = (cur / dur) * 100;
        timelinePlayed.style.width = `${pct}%`;
        timelineThumb.style.left = `${pct}%`;
      }
    }
  };

  const onProgress = () => {
    const dur = video.duration;
    if (dur > 0 && video.buffered.length > 0) {
      const end = video.buffered.end(video.buffered.length - 1);
      timelineBuffered.style.width = `${Math.min(100, (end / dur) * 100)}%`;
    }
  };

  const onFullscreenChange = () => {
    const isFs = document.fullscreenElement === wrapper;
    fsBtn.innerHTML = isFs ? ICONS.fsExit : ICONS.fsEnter;
    if (!isFs) {
      wrapper.classList.remove('jz-fullscreen-idle');
    }
    showControls();
  };

  video.addEventListener('play', onPlayPause);
  video.addEventListener('pause', onPlayPause);
  video.addEventListener('ended', onPlayPause);
  video.addEventListener('timeupdate', onTimeUpdate);
  video.addEventListener('durationchange', onTimeUpdate);
  video.addEventListener('progress', onProgress);
  video.addEventListener('volumechange', updateVolUI);
  document.addEventListener('fullscreenchange', onFullscreenChange);

  // Initial sync
  onPlayPause();
  onTimeUpdate();
  onProgress();
  updateVolUI();
  syncMenuOptions();
  showControls();

  return {
    update(settings: Settings) {
      if (!settings.enabled) {
        bar.classList.remove('is-visible');
      }
    },
    rebind(next: PlayerBinding) {
      binding = next;
    },
    dispose() {
      clearTimeout(hideTimer);
      clearTimeout(clickTimeout);
      window.removeEventListener('pointermove', onTimelineMove);
      window.removeEventListener('pointerup', onTimelineUp);
      window.removeEventListener('pointercancel', onTimelineUp);
      window.removeEventListener('pointermove', onVolPointerMove);
      window.removeEventListener('pointerup', onVolPointerUp);
      window.removeEventListener('pointercancel', onVolPointerUp);
      window.removeEventListener('pointerdown', onWindowPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      wrapper.removeEventListener('pointermove', onWrapperPointerMove);
      document.removeEventListener('fullscreenchange', onFullscreenChange);

      video.removeEventListener('play', onPlayPause);
      video.removeEventListener('pause', onPlayPause);
      video.removeEventListener('ended', onPlayPause);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onTimeUpdate);
      video.removeEventListener('progress', onProgress);
      video.removeEventListener('volumechange', updateVolUI);

      if (origRequestFs) {
        video.requestFullscreen = origRequestFs;
      }
      host.remove();
      unwrapPlayer(video);
      binding.viewport = (video.parentElement && video.parentElement !== document.body && video.parentElement !== document.documentElement)
        ? video.parentElement
        : video;
    },
  };
}
