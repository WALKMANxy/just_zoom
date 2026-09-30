import { DEFAULT_SETTINGS, type RuntimeSnapshot, type Settings } from '../../src/shared/types';
import { formatModifier } from '../../src/shared/shortcuts';
import './style.css';
import { AUTO_CROP_AVAILABLE } from '../../src/shared/features';
import { i18n, setLanguage } from '../../src/shared/i18n';

const app = document.querySelector<HTMLElement>('#app')!;
let snapshot: RuntimeSnapshot = { available: false, hostname: '', adapter: '', settings: DEFAULT_SETTINGS, status: { source: 'idle', message: 'Loading…' } };
let queue = Promise.resolve();

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => {
  const result = document.createElement(tag);
  result.textContent = text;
  result.className = className;
  return result;
};

function reportError(message: string) {
  const status = app.querySelector<HTMLElement>('[role=status]');
  if (status) status.textContent = message;
}

function run(command: unknown) {
  queue = queue.then(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
    if (tab?.id && snapshot.available) {
      try {
        const direct = await chrome.tabs.sendMessage(tab.id, command) as RuntimeSnapshot;
        if (direct?.settings) {
          snapshot = direct;
          render();
          return;
        }
      } catch { /* fallback to background */ }
    }
    const result = await chrome.runtime.sendMessage({ type: 'JZ_POPUP_COMMAND', command });
    if (!result?.settings) throw new Error(result?.error || i18n.t('popup_error_player'));
    snapshot = result;
    render();
  }).catch(error => reportError(error instanceof Error ? error.message : i18n.t('popup_error_update')));
}

const patch = (value: Partial<Settings>) => run({ type: 'JZ_PATCH', patch: value });

function button(text: string, click: () => void, disabled = false) {
  const result = node('button', text);
  result.type = 'button';
  result.disabled = disabled;
  result.addEventListener('click', click);
  return result;
}

function choices(label: string, values: Array<[string, string | number, string?]>, current: string | number, change: (value: string | number) => void) {
  const group = node('fieldset');
  group.append(node('legend', label));
  const buttons = node('div', '', 'segments');
  for (const [text, value, title] of values) {
    const item = button(text, () => change(value));
    if (title) {
      item.title = title;
      item.setAttribute('aria-label', `${text}: ${title}`);
    }
    if (value === 'auto-zoom' && !AUTO_CROP_AVAILABLE) {
      item.disabled = true;
      item.title = 'Auto Zoom is temporarily paused.';
    }
    item.setAttribute('aria-pressed', String(value === current));
    buttons.append(item);
  }
  group.append(buttons);
  return group;
}

function slider(
  label: string,
  key: 'zoom' | 'panX' | 'panY' | 'buttonFactor',
  min: number,
  max: number,
  step = .01,
  disabled = false,
  overrideValue?: number,
) {
  const wrap = node('div', '', 'row');
  const caption = node('label', label);
  const input = node('input');
  input.type = 'range';
  input.id = `setting-${key}`;
  input.dataset.key = key;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  const val = overrideValue !== undefined ? overrideValue : snapshot.settings[key];
  input.value = String(val);
  caption.htmlFor = input.id;
  input.disabled = disabled;
  const output = node('output');
  output.htmlFor = input.id;
  const format = () => {
    output.value = Number(input.value).toFixed(2) + (key === 'zoom' || key === 'buttonFactor' ? '×' : '');
  };
  format();
  input.addEventListener('input', format);
  input.addEventListener('change', () => {
    if (key === 'zoom') {
      patch({ zoom: Number(input.value), zoomType: 'factor', zoomStrategy: 'manual', zoomApplied: true });
    } else {
      patch({ [key]: Number(input.value) });
    }
  });
  wrap.append(caption, input, output);
  return wrap;
}

function check(label: string, key: 'enabled' | 'animations' | 'buttonUseLast' | 'autoCrop' | 'allowPortrait' | 'compatibility' | 'rememberSiteState', description?: string) {
  const wrap = node('label', '', 'check');
  const input = node('input');
  input.type = 'checkbox';
  input.dataset.key = key;
  input.checked = snapshot.settings[key];
  if (key === 'autoCrop' && !AUTO_CROP_AVAILABLE) input.disabled = true;
  if (description) input.setAttribute('aria-describedby', description);
  input.addEventListener('change', () => patch({ [key]: input.checked }));
  wrap.append(input, document.createTextNode(label));
  return wrap;
}

function render() {
  if (snapshot.settings?.language) setLanguage(snapshot.settings.language);
  const { settings: s, available } = snapshot;
  app.replaceChildren(node('h1', 'just_zoom'));
  const hostLabel = snapshot.hostname
    ? (available ? snapshot.hostname : i18n.t('popup_no_active_video', [snapshot.hostname]))
    : i18n.t('popup_global_defaults_no_video');
  app.append(node('p', hostLabel, 'subtitle'));

  // Master Enable / Disable Toggle
  const masterToggle = button(
    s.enabled ? i18n.t('popup_enabled_label') : i18n.t('popup_disabled_label'),
    () => patch({ enabled: !s.enabled }),
  );
  masterToggle.className = `master-toggle ${s.enabled ? 'active' : 'inactive'}`;
  masterToggle.setAttribute('aria-pressed', String(s.enabled));
  masterToggle.dataset.action = 'toggle-zoom';
  app.append(masterToggle);

  const mainControls = node('div', '', s.enabled ? 'popup-controls' : 'popup-controls disabled-content');

  // Quick zoom section
  const quickZoomSection = node('section', '', `zoom-section ${s.zoomType === 'factor' ? 'dimmed' : ''}`);
  const quickGroup = node('fieldset');
  quickGroup.append(node('legend', i18n.t('controls_quick_zoom')));
  const quickRow = node('div', '', 'segments');

  const quickOff = button(i18n.t('common_off'), () => patch({ zoomApplied: false, zoomType: 'quick' }));
  quickOff.setAttribute('aria-pressed', String(!s.zoomApplied && s.zoomType === 'quick'));
  quickRow.append(quickOff);

  const quickFit = button(i18n.t('common_fit'), () => patch({ mode: 'fit', zoomType: 'quick', zoomApplied: true }));
  quickFit.setAttribute('aria-pressed', String(s.zoomApplied && s.zoomType === 'quick' && s.mode === 'fit'));
  quickRow.append(quickFit);

  const quickFill = button(i18n.t('common_fill'), () => patch({ mode: 'fill', zoomType: 'quick', zoomApplied: true }));
  quickFill.setAttribute('aria-pressed', String(s.zoomApplied && s.zoomType === 'quick' && s.mode === 'fill'));
  quickRow.append(quickFill);

  quickGroup.append(quickRow);
  quickZoomSection.append(quickGroup);
  mainControls.append(quickZoomSection);

  // Zoom factor section
  const factorZoomSection = node('section', '', `zoom-section ${s.zoomType === 'quick' ? 'dimmed' : ''}`);
  const factorGroup = node('fieldset');
  factorGroup.append(node('legend', i18n.t('controls_zoom_factor')));
  const factorRow = node('div', '', 'segments');

  const isFactorActive = Boolean(s.zoomApplied && s.zoomType === 'factor');
  const isFactorAuto = Boolean(isFactorActive && s.zoomStrategy === 'automatic');
  const isFactorManual = Boolean(isFactorActive && s.zoomStrategy === 'manual');
  const isFactorOff = !isFactorAuto && !isFactorManual;

  const factorOff = button(i18n.t('common_off'), () => patch({ zoomApplied: false }));
  factorOff.setAttribute('aria-pressed', String(isFactorOff));
  factorRow.append(factorOff);

  const factorAuto = button(i18n.t('common_screen_ratio'), () => patch({ zoomStrategy: 'automatic', zoomType: 'factor', zoomApplied: true }));
  factorAuto.setAttribute('aria-pressed', String(isFactorAuto));
  factorRow.append(factorAuto);

  const factorManual = button(i18n.t('common_manual'), () => {
    const nextZoom = s.zoom > 1.0 ? s.zoom : 1.34;
    patch({ zoomStrategy: 'manual', zoomType: 'factor', zoomApplied: true, zoom: nextZoom });
  });
  factorManual.setAttribute('aria-pressed', String(isFactorManual));
  factorRow.append(factorManual);

  factorGroup.append(factorRow);
  factorZoomSection.append(factorGroup);

  const screenFactor = Math.min(3, Math.max(1, screen.width / screen.height / (16 / 9)));

  if (isFactorAuto) {
    factorZoomSection.append(
      node('p', `Screen-derived factor: ${screenFactor.toFixed(2)}×`, 'hint'),
      slider(i18n.t('popup_zoom_slider'), 'zoom', .34, 3, .01, true, Number(screenFactor.toFixed(2))),
    );
  } else if (isFactorManual) {
    // Manual presets: 1.18x, 1.25x, 1.34x, 1.5x, 2x (appear ONLY when manual is selected)
    const presetGroup = node('fieldset');
    presetGroup.append(node('legend', i18n.t('popup_manual_presets')));
    const presetRow = node('div', '', 'segments');
    for (const v of [1.18, 1.25, 1.34, 1.5, 2]) {
      const item = button(`${v}×`, () => {
        patch({ zoom: v, zoomType: 'factor', zoomStrategy: 'manual', zoomApplied: true });
      });
      const isPresetActive = Boolean(
        s.zoomApplied && Math.abs(s.zoom - v) < 0.01,
      );
      item.setAttribute('aria-pressed', String(isPresetActive));
      presetRow.append(item);
    }
    presetGroup.append(presetRow);
    factorZoomSection.append(presetGroup, slider(i18n.t('popup_zoom_slider'), 'zoom', .34, 3));
  }
  mainControls.append(factorZoomSection);

  // Framing adjustments (Pan & Reset)
  const framingSection = node('section', '', 'framing-section');
  const panActionsRow = node('div', '', 'segments');
  const isPanned = Math.abs(s.panX) > 0.001 || Math.abs(s.panY) > 0.001;
  panActionsRow.append(
    button(i18n.t('common_reset_pan'), () => run({ type: 'JZ_RESET_PAN' }), !available || !isPanned),
    button(i18n.t('common_reset_all'), () => run({ type: 'JZ_RESET' }), !available),
  );
  const gestureTip = node('p', `💡 ${i18n.t('controls_gesture_tip', [formatModifier(s.gestureModifier ?? 'alt')])}`, 'hint gesture-tip');
  framingSection.append(
    slider(i18n.t('popup_pan_x'), 'panX', -1, 1, .05),
    slider(i18n.t('popup_pan_y'), 'panY', -1, 1, .05),
    panActionsRow,
    gestureTip,
  );
  mainControls.append(framingSection);

  // Extras and settings
  const extras = node('section', '', 'extras');
  extras.append(node('h2', i18n.t('popup_player_button')));
  extras.append(choices(i18n.t('popup_player_controls'), [[i18n.t('popup_mode_both'), 'both'], [i18n.t('popup_mode_native'), 'native'], [i18n.t('popup_mode_floating'), 'floating']], s.controlMode, value => patch({ controlMode: value as Settings['controlMode'] })));
  extras.append(node('p', s.controlMode === 'both' ? i18n.t('popup_mode_hint_both') : s.controlMode === 'native' ? i18n.t('popup_mode_hint_native') : i18n.t('popup_mode_hint_floating'), 'hint'));
  extras.append(check(i18n.t('popup_animate_zoom'), 'animations'));
  if (snapshot.adapter === 'Netflix' || /(^|\.)netflix\.com$/.test(snapshot.hostname)) {
    extras.append(node('p', i18n.t('popup_netflix_animation_hint'), 'hint'));
  }
  extras.append(node('h2', i18n.t('common_ambience')));
  const ambience = choices(i18n.t('common_ambience'), [[i18n.t('common_off'), 'off'], [i18n.t('common_blur'), 'blur'], [i18n.t('common_colour'), 'colour']], s.ambience, value => patch({ ambience: value as Settings['ambience'] }));
  ambience.setAttribute('aria-describedby', 'local-pixels');
  extras.append(ambience, node('p', i18n.t('controls_ambience_hint'), 'hint'));
  const ambienceRate = choices(i18n.t('controls_update_rate'), [
    [i18n.t('common_default'), 'high', i18n.t('controls_rate_high_title')],
    [i18n.t('common_performance'), 'performance', i18n.t('controls_rate_performance_title')],
    [i18n.t('common_quality'), 'quality', i18n.t('controls_rate_quality_title')],
  ], s.ambienceRate, value => patch({ ambienceRate: value as Settings['ambienceRate'] }));
  if (s.ambience === 'off') {
    ambienceRate.querySelectorAll('button').forEach(item => { item.disabled = true; });
  }
  extras.append(ambienceRate, node('p', i18n.t('controls_rate_hint'), 'hint'));
  const pixels = node('p', i18n.t('popup_local_pixels'), 'hint');
  pixels.id = 'local-pixels';
  extras.append(pixels, check(i18n.t('popup_allow_portrait'), 'allowPortrait'));
  // Note: Compatibility capture hidden and disabled for now

  // Storage section: Save site, Save global, Clear site, Clear all
  const storageSection = node('div', '', 'storage-section');
  storageSection.append(node('h2', i18n.t('popup_storage')));
  storageSection.append(check(i18n.t('popup_remember_site'), 'rememberSiteState'));
  const saves = node('div', '', 'segments');
  saves.append(
    button(i18n.t('popup_save_site'), () => run({ type: 'JZ_SAVE_SITE' }), !available),
    button(i18n.t('popup_save_global'), () => run({ type: 'JZ_SAVE_GLOBAL' })),
  );
  const clears = node('div', '', 'segments');
  clears.style.marginTop = '4px';
  clears.append(
    button(i18n.t('popup_clear_site'), () => run({ type: 'JZ_CLEAR_SITE' }), !available),
    button(i18n.t('popup_clear_all'), () => run({ type: 'JZ_CLEAR_ALL' })),
  );
  storageSection.append(
    saves,
    clears,
    node('p', available ? i18n.t('popup_storage_hint_active') : i18n.t('popup_storage_hint_global'), 'hint'),
  );
  extras.append(storageSection);
  extras.append(button(i18n.t('popup_open_shortcuts'), () => { void chrome.runtime.openOptionsPage(); }));
  mainControls.append(extras);

  if (!s.enabled) {
    mainControls.querySelectorAll('button, input, select').forEach(el => {
      (el as HTMLButtonElement | HTMLInputElement | HTMLSelectElement).disabled = true;
    });
  }

  app.append(mainControls);

  const status = node('p', snapshot.status.message, 'status');
  status.setAttribute('role', 'status');
  app.append(status);
}

async function loadInitialState() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
    if (tab?.id) {
      try {
        const direct = await chrome.tabs.sendMessage(tab.id, { type: 'JZ_GET_STATE' }) as RuntimeSnapshot;
        if (direct?.settings) {
          snapshot = direct;
          render();
          return;
        }
      } catch { /* direct message to tab failed or restricted URL, fall back to background */ }
    }
  } catch {}

  const state = await chrome.runtime.sendMessage({ type: 'JZ_POPUP_STATE' });
  if (!state?.settings) throw new Error(state?.error || 'Could not load settings.');
  snapshot = state;
  render();
}

void loadInitialState().catch(error => {
  render();
  reportError(error.message);
});
