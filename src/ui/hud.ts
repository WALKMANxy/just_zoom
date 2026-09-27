import type { PlayerBinding } from '../shared/types';

export interface HudController {
  show(text: string, iconType?: 'zoom' | 'pan' | 'reset' | 'mode' | 'ambience'): void;
  rebind(binding: PlayerBinding): void;
  dispose(): void;
}

const ICONS = {
  zoom: '<svg viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/><path d="M11 8v6M8 11h6"/></svg>',
  pan: '<svg viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l3 3"/></svg>',
  reset: '<svg viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
  mode: '<svg viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15l10-6"/></svg>',
  ambience: '<svg viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
};

const HUD_STYLE = `
:host {
  position: fixed;
  z-index: 2147483647;
  pointer-events: none;
  contain: layout style;
  user-select: none;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.hud-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 13px;
  background: rgba(18, 18, 20, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: 9999px;
  color: #f7f7f8;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.15px;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.42);
  opacity: 0;
  transform: translateY(-4px) scale(0.96);
  transition: opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1), transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  will-change: opacity, transform;
}
.hud-pill.is-visible {
  opacity: 1;
  transform: translateY(0) scale(1);
}
.hud-pill.is-fading {
  opacity: 0;
  transform: translateY(-2px) scale(0.98);
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.hud-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}
.hud-icon svg {
  width: 100%;
  height: 100%;
}
.hud-text {
  white-space: nowrap;
}
`;

export function createHud(initialBinding: PlayerBinding): HudController {
  let binding = initialBinding;
  let fadeTimer = 0;
  let removeTimer = 0;

  const host = document.createElement('div');
  host.className = 'jz-hud-host jz-controls-host';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = HUD_STYLE;
  shadow.append(style);

  const pill = document.createElement('div');
  pill.className = 'hud-pill';

  const iconSpan = document.createElement('span');
  iconSpan.className = 'hud-icon';
  iconSpan.setAttribute('aria-hidden', 'true');

  const textSpan = document.createElement('span');
  textSpan.className = 'hud-text';

  pill.append(iconSpan, textSpan);
  shadow.append(pill);

  const getParent = (): HTMLElement => {
    const fullscreen = document.fullscreenElement;
    if (fullscreen instanceof HTMLElement && fullscreen !== binding.video && fullscreen.contains(binding.video)) {
      return fullscreen;
    }
    return (document.body ?? document.documentElement) as HTMLElement;
  };

  const positionHost = () => {
    if (!host.isConnected) return;
    const rect = binding.viewport.getBoundingClientRect();
    const top = Math.max(16, Math.min(innerHeight - 50, rect.top + 20));
    const left = Math.max(16, Math.min(innerWidth - 120, rect.left + 24));
    host.style.top = `${Math.round(top)}px`;
    host.style.left = `${Math.round(left)}px`;
  };

  const show = (text: string, iconType?: 'zoom' | 'pan' | 'reset' | 'mode' | 'ambience') => {
    clearTimeout(fadeTimer);
    clearTimeout(removeTimer);

    textSpan.textContent = text;
    if (iconType && ICONS[iconType]) {
      iconSpan.innerHTML = ICONS[iconType];
      iconSpan.style.display = 'inline-flex';
    } else {
      iconSpan.style.display = 'none';
      iconSpan.innerHTML = '';
    }

    const parent = getParent();
    if (host.parentElement !== parent) {
      parent.append(host);
    }
    positionHost();

    pill.classList.remove('is-fading');
    pill.classList.add('is-visible');

    fadeTimer = window.setTimeout(() => {
      pill.classList.remove('is-visible');
      pill.classList.add('is-fading');
      removeTimer = window.setTimeout(() => {
        pill.classList.remove('is-fading');
        host.remove();
      }, 400);
    }, 1200);
  };

  return {
    show,
    rebind: (next: PlayerBinding) => {
      binding = next;
      if (host.isConnected) positionHost();
    },
    dispose: () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
      host.remove();
    },
  };
}
