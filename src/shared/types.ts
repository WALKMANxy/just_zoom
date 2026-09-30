export interface Crop { top: number; right: number; bottom: number; left: number }
export const EMPTY_CROP: Crop = { top: 0, right: 0, bottom: 0, left: 0 };
export type ZoomType = 'quick' | 'factor';
export type VideoFinderMode = 'treewalker' | 'bruteforce';
export type GestureModifier = 'alt' | 'ctrl' | 'shift' | 'meta';
export type DisplayProfile = 'auto' | '16:9' | '16:10' | '21:9' | '32:9' | 'custom';
export type Language = 'auto' | 'en' | 'de' | 'ja';
export interface Settings {
  enabled: boolean;
  controlMode: 'native' | 'floating' | 'both';
  animations: boolean;
  buttonAction: 'zoom-in' | 'zoom-out' | 'auto-zoom';
  buttonUseLast: boolean;
  buttonFactor: number;
  zoomApplied: boolean;
  zoomType: ZoomType;
  zoomStrategy: 'automatic' | 'manual';
  allowPortrait: boolean;
  mode: 'fit' | 'fill';
  zoom: number;
  panX: number;
  panY: number;
  autoCrop: boolean;
  ambience: 'off' | 'blur' | 'colour';
  ambienceRate: 'performance' | 'high' | 'quality';
  compatibility: boolean;
  rememberSiteState: boolean;
  videoFinderMode: VideoFinderMode;
  gesturesEnabled: boolean;
  gestureModifier: GestureModifier;
  hudEnabled: boolean;
  displayProfile: DisplayProfile;
  customDisplayAspectRatio: number;
  nativeHtml5Workaround: boolean;
  language: Language;
}
export const DEFAULT_SETTINGS: Settings = {
  enabled: true, animations: true, controlMode: 'both', buttonAction: 'zoom-in', buttonUseLast: true, buttonFactor: 1.34,
  zoomApplied: false, zoomType: 'factor', zoomStrategy: 'manual', allowPortrait: false,
  mode: 'fit', zoom: 1.34, panX: 0, panY: 0,
  autoCrop: false, ambience: 'blur', ambienceRate: 'high', compatibility: false,
  rememberSiteState: true,
  videoFinderMode: 'treewalker',
  gesturesEnabled: true,
  gestureModifier: 'alt',
  hudEnabled: false,
  displayProfile: 'auto',
  customDisplayAspectRatio: 2.39,
  nativeHtml5Workaround: true,
  language: 'auto',
};
export interface PlayerBinding {
  video: HTMLVideoElement;
  viewport: HTMLElement;
  controls: HTMLElement | null;
  controlBefore?: Element | null;
  controlAnchor?: HTMLElement | null;
  controlClassName?: string;
  adapter: string;
}
export type AspectRatioBucket = '16:9' | '21:9' | '32:9' | 'other';
export interface SiteEntry extends Partial<Settings> {
  profiles?: Partial<Record<AspectRatioBucket, Partial<Settings>>>;
}
export interface FeatureStatus { source: 'idle' | 'direct' | 'compatibility' | 'unavailable'; message: string }
export interface RuntimeSnapshot {
  available: boolean;
  hostname: string;
  adapter: string;
  settings: Settings;
  status: FeatureStatus;
  bucket?: AspectRatioBucket;
}
export interface ControlsHandlers {
  activate: () => void;
  action: (action: ZoomAction) => void;
  patch: (patch: Partial<Settings>) => void;
  reset: () => void;
  resetPan: () => void;
  saveSite: () => void;
  saveGlobal: () => void;
}
export type ZoomAction = 'toggle-zoom' | 'zoom-in' | 'zoom-out' | 'toggle-auto-crop' | 'toggle-ambience' | 'reset' | 'reset-pan' | 'toggle-controls' | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down';
export interface PlayerControls {
  update(settings: Settings, status: FeatureStatus): void;
  rebind(binding: PlayerBinding): void;
  toggle(): void;
  dispose(): void;
}
