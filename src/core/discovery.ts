import { genericPlayer, services } from './adapters';
import type { VideoFinderMode } from '../shared/types';

const PLAYER_CONTAINER_HINTS = '[class*="player" i], [class*="video-container" i], [id*="player" i], [data-testid*="player" i]';
const CONTROLS_SELECTOR = 'button, [role="button"], .vjs-control, .jw-icon, .plyr__control, [class*="control" i], [class*="scrubber" i], [class*="progress" i], [aria-label*="play" i], [aria-label*="pause" i]';
const BACKGROUND_PATTERN = /\b(?:bg|background|hero|banner|ambient|decorative|looping)[-_]video\b/i;

export function isBackgroundVideo(video: HTMLVideoElement, style: CSSStyleDeclaration): boolean {
  if (video.controls || video.hasAttribute('controls') || video.hasAttribute('data-jz-native')) return false;
  if (video.mediaKeys) return false;
  const service = services.find(item => item.host.test(location.hostname));
  const player = Boolean(video.closest(genericPlayer) || (service && video.closest(service.player)));
  if (player && !video.loop) return false;

  // 1. Explicit decorative pattern in class or id
  if (video.matches('.background-video__media, .background-video video')) return true;
  const videoIdentifiers = `${video.className || ''} ${video.id || ''}`;
  if (BACKGROUND_PATTERN.test(videoIdentifiers)) return true;

  // 2. Explicit accessibility or presentation role
  if (!player && video.muted && video.loop && (video.getAttribute('aria-hidden') === 'true' || video.getAttribute('role') === 'presentation' || video.getAttribute('role') === 'none')) {
    return true;
  }
  // 3. Explicit background attributes
  if (video.hasAttribute('data-bg') || video.hasAttribute('data-background')) {
    return true;
  }
  // 4. Muted + loop + no controls (the classic decorative background video signature)
  if (video.muted && video.loop) {
    return true;
  }
  // 5. Muted fixed/absolute covering full viewport without controls
  if (video.muted && (style.position === 'fixed' || style.position === 'absolute')) {
    const rect = video.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    if (vw > 0 && vh > 0 && rect.width >= vw * 0.9 && rect.height >= vh * 0.9 && video.loop) {
      return true;
    }
  }
  return false;
}

export function isEligibleVideo(video: HTMLVideoElement): boolean {
  const style = getComputedStyle(video);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
    return false;
  }
  const rect = video.getBoundingClientRect();
  if (rect.width < 120 || rect.height < 70) {
    return false;
  }

  // If this video is currently in fullscreen or inside the fullscreen element, it is eligible
  const fs = document.fullscreenElement;
  if (fs && (fs === video || fs.contains(video))) {
    return true;
  }

  // Check if it belongs to a recognized dedicated service adapter
  const service = services.find(item => item.host.test(location.hostname));
  if (service) {
    // On known streaming services, any visible media-keyed or non-looping video is eligible
    if (video.mediaKeys || !video.loop) return true;
  }

  if (isBackgroundVideo(video, style)) {
    return false;
  }

  // If actively playing or ready, keep it eligible
  if (!video.paused && !video.ended && video.readyState >= 1) {
    return true;
  }

  // Check if it belongs to a recognized generic player stack
  if (video.closest(genericPlayer)) {
    return true;
  }

  // Check if it has native HTML5 player controls
  if (video.controls || video.hasAttribute('controls') || video.hasAttribute('data-jz-native') || video.parentElement?.classList.contains('jz-native-player')) {
    return true;
  }

  // Check if it's inside a video player container with interactive controls
  let parent = video.parentElement;
  let depth = 0;
  while (parent && parent !== document.body && parent !== document.documentElement && depth++ < 6) {
    if (parent.matches(PLAYER_CONTAINER_HINTS) || parent.querySelector(CONTROLS_SELECTOR)) {
      return true;
    }
    parent = parent.parentElement;
  }

  // Fallback for standalone video elements with valid decoded dimensions
  if (video.videoWidth > 0 && video.videoHeight > 0) {
    const area = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(0, rect.left)) * Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(0, rect.top));
    const viewportArea = innerWidth * innerHeight;
    if (viewportArea > 0 && area >= viewportArea * 0.05) {
      return true;
    }
  }

  return false;
}

const EXCLUDED_INCLUDES = [
  'netflix.com/browse',
  'netflix.com/title',
  'hbomax.com/page',
  'music.youtube.',
  'teams.live.',
  'teams.microsoft.',
];
const EXCLUDED_ENDS_WITH = [
  'youtube.com/',
  'netflix.com/',
  'primevideo.com/',
  'disneyplus.com/',
  'hbomax.com/',
];

export function isNotExcludedURL(): boolean {
  const url = location.href;
  if (EXCLUDED_INCLUDES.some(pattern => url.includes(pattern))) return false;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (path === '/' || path === '') {
      if (EXCLUDED_ENDS_WITH.some(pattern => (parsed.hostname + '/').endsWith(pattern))) return false;
    }
  } catch { /* invalid url */ }
  return true;
}

function findShadowVideosTreeWalker(root: Element | ShadowRoot): HTMLVideoElement[] {
  const videos: HTMLVideoElement[] = [];
  try {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          return (node as Element).shadowRoot ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        },
      },
    );
    const hosts: Element[] = [];
    while (walker.nextNode()) {
      hosts.push(walker.currentNode as Element);
    }
    for (const host of hosts) {
      const sr = host.shadowRoot;
      if (sr) {
        videos.push(...Array.from(sr.querySelectorAll('video')));
        videos.push(...findShadowVideosTreeWalker(sr));
      }
    }
  } catch { /* disconnected or restricted root */ }
  return videos;
}

function findShadowVideosBruteforce(root: Element | ShadowRoot): HTMLVideoElement[] {
  const videos: HTMLVideoElement[] = [];
  try {
    const elements = root.querySelectorAll('*');
    for (const el of elements) {
      const sr = el.shadowRoot;
      if (sr) {
        videos.push(...Array.from(sr.querySelectorAll('video')));
        videos.push(...findShadowVideosBruteforce(sr));
      }
    }
  } catch { /* disconnected or restricted root */ }
  return videos;
}

export function findShadowVideos(root: Element | ShadowRoot, mode: VideoFinderMode = 'treewalker'): HTMLVideoElement[] {
  return mode === 'bruteforce' ? findShadowVideosBruteforce(root) : findShadowVideosTreeWalker(root);
}

export function collectVideos(root: Document | ShadowRoot = document): HTMLVideoElement[] {
  const videos = Array.from(root.querySelectorAll('video'));
  if (root === document) {
    if (videos.length === 0 && document.body) {
      videos.push(...findShadowVideos(document.body));
    }
  } else {
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) videos.push(...collectVideos(element.shadowRoot));
    }
  }
  return videos;
}

export function selectVideo(current?: HTMLVideoElement | null, finderMode: VideoFinderMode = 'treewalker'): HTMLVideoElement | null {
  if (!isNotExcludedURL()) return null;

  // 1. Fast path: evaluate direct document videos first
  const docVideos = Array.from(document.querySelectorAll('video'));
  let winner: HTMLVideoElement | null = null;
  let best = 0;
  for (const video of docVideos) {
    if (!isEligibleVideo(video)) continue;
    const rect = video.getBoundingClientRect();
    const area = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(0, rect.left)) * Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(0, rect.top));
    if (!area) {
      if (video === current && current.isConnected && (document.hidden || current.mediaKeys || current.readyState >= 1)) {
        let score = 1000 * (!video.paused ? 3 : 1);
        if (score > best) { winner = video; best = score; }
      }
      continue;
    }
    let score = area * (!video.paused ? 3 : 1) * (video.readyState >= 2 ? 1.3 : 1);
    if (video === current) score *= 1.15;
    if (document.fullscreenElement?.contains(video) || document.fullscreenElement === video) score *= 10;
    if (score > best) { winner = video; best = score; }
  }
  if (winner) return winner;

  // 2. Only if no document video is eligible, search open shadow roots
  if (document.body) {
    const shadowVideos = findShadowVideos(document.body, finderMode);
    for (const video of shadowVideos) {
      if (!isEligibleVideo(video)) continue;
      const rect = video.getBoundingClientRect();
      const area = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(0, rect.left)) * Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(0, rect.top));
      if (!area) {
        if (video === current && current.isConnected && (document.hidden || current.mediaKeys || current.readyState >= 1)) {
          let score = 1000 * (!video.paused ? 3 : 1);
          if (score > best) { winner = video; best = score; }
        }
        continue;
      }
      let score = area * (!video.paused ? 3 : 1) * (video.readyState >= 2 ? 1.3 : 1);
      if (video === current) score *= 1.15;
      if (document.fullscreenElement?.contains(video) || document.fullscreenElement === video) score *= 10;
      if (score > best) { winner = video; best = score; }
    }
  }
  return winner;
}
