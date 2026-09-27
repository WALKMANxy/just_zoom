import type { AspectRatioBucket, DisplayProfile, PlayerBinding } from '../shared/types';

export function portraitBlocked(binding: PlayerBinding, allowPortrait: boolean): boolean {
  if (allowPortrait) return false;
  const isShorts = location.pathname.includes('/shorts');
  const { video, viewport } = binding;
  const intrinsicPortrait = video.videoWidth > 0 && video.videoHeight > video.videoWidth;
  const target = document.fullscreenElement === video ? video : viewport;
  // Layout dimensions avoid testing our own in-flight transformed video box.
  const width = target.clientWidth, height = target.clientHeight;
  return isShorts || intrinsicPortrait || (width > 0 && height > width);
}

export function getDisplayAspectRatio(
  profile: DisplayProfile = 'auto',
  customRatio = 2.39,
  width = screen.width,
  height = screen.height
): number {
  switch (profile) {
    case '16:9': return 16 / 9;
    case '16:10': return 16 / 10;
    case '21:9': return 21 / 9;
    case '32:9': return 32 / 9;
    case 'custom': return Number.isFinite(customRatio) && customRatio > 0 ? customRatio : 2.39;
    case 'auto':
    default:
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 16 / 9;
      return width / height;
  }
}

export function automaticZoomFactor(
  profile: DisplayProfile = 'auto',
  customRatio = 2.39,
  width = screen.width,
  height = screen.height
): number {
  const screenAR = getDisplayAspectRatio(profile, customRatio, width, height);
  const contentAR = 16 / 9;
  return Math.min(3, Math.max(1, +(screenAR / contentAR).toFixed(2)));
}

export function getDisplayAspectBucket(
  profile: DisplayProfile = 'auto',
  customRatio = 2.39,
  width = typeof screen !== 'undefined' ? screen.width : 1920,
  height = typeof screen !== 'undefined' ? screen.height : 1080
): AspectRatioBucket {
  const ar = getDisplayAspectRatio(profile, customRatio, width, height);
  if (ar >= 3.0) return '32:9';
  if (ar >= 2.0) return '21:9';
  if (ar >= 1.5) return '16:9';
  return 'other';
}
