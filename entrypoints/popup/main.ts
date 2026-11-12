import { DEFAULT_SETTINGS, type RuntimeSnapshot, type Settings } from '../../src/shared/types';
import { formatModifier } from '../../src/shared/shortcuts';
import './style.css';
import { automaticZoomFactor } from '../../src/core/eligibility';
import { i18n, setLanguage } from '../../src/shared/i18n';

const app = document.querySelector<HTMLElement>('#app')!;
let snapshot: RuntimeSnapshot = { available: false, hostname: '', adapter: '', settings: DEFAULT_SETTINGS, status: { source: 'idle', message: '' } };
let queue = Promise.resolve();

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => {
  const result = document.createElement(tag);
  result.textContent = text;
  result.className = className;
  return result;
};
const hint = (text: string) => node('p', text, 'hint');

function reportError(message: string) {
  const status = app.querySelector<HTMLElement>('[role=status]');
  if (status) status.textContent = message;
}

function run(command: unknown) {
  queue = queue.then(async () => {
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

interface Segment { text: string; pressed: boolean; click: () => void; title?: string }

/** A labelled row of mutually exclusive buttons. */
function segments(label: string, items: Segment[], disabled = false) {
  const group = node('fieldset');
  group.append(node('legend', label));
  const row = node('div', '', 'segments');
  for (const { text, pressed, click, title } of items) {
    const item = button(text, click, disabled);
    if (title) {
      item.title = title;
      item.setAttribute('aria-label', `${text}: ${title}`);
    }
    item.setAttribute('aria-pressed', String(pressed));
    row.append(item);
  }
  group.append(row);
  return group;
}

/** Segments bound to one setting value. */
function choices<T extends string | number | boolean>(label: string, values: Array<[string, T, string?]>, current: T, change: (value: T) => void, disabled = false) {
  return segments(label, values.map(([text, value, title]) => ({ text, title, pressed: value === current, click: () => change(value) })), disabled);
}

function slider(label: string, key: 'zoom' | 'panX' | 'panY', min: number, max: number, step = .01, disabled = false, overrideValue?: number) {
  const wrap = node('div', '', 'row');
  const caption = node('label', label);
  const input = node('input');
  input.type = 'range';
  input.id = `setting-${key}`;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(overrideValue ?? snapshot.settings[key]);
  input.disabled = disabled;
  caption.htmlFor = input.id;
  const output = node('output');
  output.htmlFor = input.id;
  const format = () => { output.value = Number(input.value).toFixed(2) + (key === 'zoom' ? '×' : ''); };
  format();
  input.addEventListener('input', format);
  input.addEventListener('change', () => {
    if (key === 'zoom') patch({ zoom: Number(input.value), zoomType: 'factor', zoomStrategy: 'manual', zoomApplied: true });
    else patch({ [key]: Number(input.value) });
  });
  wrap.append(caption, input, output);
  return wrap;
}

function check(label: string, key: 'animations' | 'allowPortrait' | 'rememberSiteState' | 'drmWorkaround', disabled = false) {
  const wrap = node('label', '', 'check');
  const input = node('input');
  input.type = 'checkbox';
  input.checked = snapshot.settings[key];
  input.disabled = disabled;
  input.addEventListener('change', () => patch({ [key]: input.checked }));
  wrap.append(input, document.createTextNode(label));
  return wrap;
}

const ZOOM_PRESETS = [1.18, 1.25, 1.34, 1.5, 2];

function zoomSections(s: Settings) {
  const quick = s.zoomApplied && s.zoomType === 'quick';
  const quickSection = node('section', '', `zoom-section ${s.zoomType === 'factor' ? 'dimmed' : ''}`);
  quickSection.append(segments(i18n.t('controls_quick_zoom'), [
    { text: i18n.t('common_off'), pressed: !s.zoomApplied && s.zoomType === 'quick', click: () => patch({ zoomApplied: false, zoomType: 'quick' }) },
    { text: i18n.t('common_fit'), pressed: quick && s.mode === 'fit', click: () => patch({ mode: 'fit', zoomType: 'quick', zoomApplied: true }) },
    { text: i18n.t('common_fill'), pressed: quick && s.mode === 'fill', click: () => patch({ mode: 'fill', zoomType: 'quick', zoomApplied: true }) },
  ]));

  const factor = s.zoomApplied && s.zoomType === 'factor';
  const auto = factor && s.zoomStrategy === 'automatic';
  const manual = factor && s.zoomStrategy === 'manual';
  const factorSection = node('section', '', `zoom-section ${s.zoomType === 'quick' ? 'dimmed' : ''}`);
  factorSection.append(segments(i18n.t('controls_zoom_factor'), [
    { text: i18n.t('common_off'), pressed: !auto && !manual, click: () => patch({ zoomApplied: false }) },
    { text: i18n.t('common_screen_ratio'), pressed: auto, click: () => patch({ zoomStrategy: 'automatic', zoomType: 'factor', zoomApplied: true }) },
    { text: i18n.t('common_manual'), pressed: manual, click: () => patch({ zoomStrategy: 'manual', zoomType: 'factor', zoomApplied: true, zoom: s.zoom > 1.0 ? s.zoom : 1.34 }) },
  ]));
  if (auto) {
    // The factor the runtime applies, including the display profile chosen in settings.
    const screenFactor = automaticZoomFactor(s.displayProfile, s.customDisplayAspectRatio);
    factorSection.append(
      hint(i18n.t('popup_screen_factor', [screenFactor.toFixed(2)])),
      slider(i18n.t('popup_zoom_slider'), 'zoom', .34, 3, .01, true, screenFactor),
    );
  } else if (manual) {
    factorSection.append(
      choices(i18n.t('popup_manual_presets'), ZOOM_PRESETS.map(v => [`${v}×`, v] as [string, number]),
        ZOOM_PRESETS.find(v => Math.abs(s.zoom - v) < 0.01) ?? 0,
        zoom => patch({ zoom, zoomType: 'factor', zoomStrategy: 'manual', zoomApplied: true })),
      slider(i18n.t('popup_zoom_slider'), 'zoom', .34, 3),
    );
  }
  return [quickSection, factorSection];
}

function framingSection(s: Settings, available: boolean) {
  const section = node('section', '', 'framing-section');
  const actions = node('div', '', 'segments');
  const isPanned = Math.abs(s.panX) > 0.001 || Math.abs(s.panY) > 0.001;
  actions.append(
    button(i18n.t('common_reset_pan'), () => run({ type: 'JZ_RESET_PAN' }), !available || !isPanned),
    button(i18n.t('common_reset_all'), () => run({ type: 'JZ_RESET' }), !available),
  );
  section.append(
    slider(i18n.t('popup_pan_x'), 'panX', -1, 1, .05),
    slider(i18n.t('popup_pan_y'), 'panY', -1, 1, .05),
    actions,
    node('p', `💡 ${i18n.t('controls_gesture_tip', [formatModifier(s.gestureModifier ?? 'alt')])}`, 'hint gesture-tip'),
  );
  return section;
}

function ambienceControls(s: Settings) {
  const off = s.ambience === 'off';
  const mode = choices(i18n.t('controls_ambience_appearance_aria'),
    [[i18n.t('common_off'), 'off'], [i18n.t('common_blur'), 'blur'], [i18n.t('common_colour'), 'colour']] as Array<[string, Settings['ambience']]>,
    s.ambience, ambience => patch({ ambience }));
  mode.setAttribute('aria-describedby', 'local-pixels');
  const pixels = hint(i18n.t('popup_local_pixels'));
  pixels.id = 'local-pixels';
  return [
    node('h2', i18n.t('common_ambience')),
    mode, hint(i18n.t('controls_ambience_hint')),
    choices(i18n.t('controls_update_rate'), [
      [i18n.t('common_default'), 'high', i18n.t('controls_rate_high_title')],
      [i18n.t('common_performance'), 'performance', i18n.t('controls_rate_performance_title')],
      [i18n.t('common_quality'), 'quality', i18n.t('controls_rate_quality_title')],
    ] as Array<[string, Settings['ambienceRate'], string]>, s.ambienceRate, ambienceRate => patch({ ambienceRate }), off),
    hint(i18n.t('controls_rate_hint')),
    choices(i18n.t('controls_fill_bars'), [[i18n.t('common_off'), false], [i18n.t('common_on'), true]], s.ambienceFillBars, ambienceFillBars => patch({ ambienceFillBars }), off),
    hint(i18n.t('controls_fill_bars_hint')),
    check(i18n.t('controls_drm_workaround'), 'drmWorkaround', off),
    hint(i18n.t('controls_drm_workaround_hint')),
    pixels,
  ];
}

function storageSection(available: boolean) {
  const section = node('div', '', 'storage-section');
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
  section.append(
    node('h2', i18n.t('popup_storage')),
    check(i18n.t('popup_remember_site'), 'rememberSiteState'),
    saves,
    clears,
    hint(available ? i18n.t('popup_storage_hint_active') : i18n.t('popup_storage_hint_global')),
  );
  return section;
}

function render() {
  if (snapshot.settings?.language) setLanguage(snapshot.settings.language);
  const { settings: s, available } = snapshot;
  app.replaceChildren(node('h1', 'just_zoom'));
  const hostLabel = snapshot.hostname
    ? (available ? snapshot.hostname : i18n.t('popup_no_active_video', [snapshot.hostname]))
    : i18n.t('popup_global_defaults_no_video');
  app.append(node('p', hostLabel, 'subtitle'));

  const masterToggle = button(s.enabled ? i18n.t('popup_enabled_label') : i18n.t('popup_disabled_label'), () => patch({ enabled: !s.enabled }));
  masterToggle.className = `master-toggle ${s.enabled ? 'active' : 'inactive'}`;
  masterToggle.setAttribute('aria-pressed', String(s.enabled));
  app.append(masterToggle);

  const mainControls = node('div', '', s.enabled ? 'popup-controls' : 'popup-controls disabled-content');
  mainControls.append(...zoomSections(s), framingSection(s, available));

  const extras = node('section', '', 'extras');
  extras.append(
    node('h2', i18n.t('popup_player_button')),
    choices(i18n.t('popup_player_controls'),
      [[i18n.t('popup_mode_both'), 'both'], [i18n.t('popup_mode_native'), 'native'], [i18n.t('popup_mode_floating'), 'floating']] as Array<[string, Settings['controlMode']]>,
      s.controlMode, controlMode => patch({ controlMode })),
    hint(i18n.t(s.controlMode === 'both' ? 'popup_mode_hint_both' : s.controlMode === 'native' ? 'popup_mode_hint_native' : 'popup_mode_hint_floating')),
    check(i18n.t('popup_animate_zoom'), 'animations'),
  );
  if (snapshot.adapter === 'Netflix' || /(^|\.)netflix\.com$/.test(snapshot.hostname)) extras.append(hint(i18n.t('popup_netflix_animation_hint')));
  extras.append(
    ...ambienceControls(s),
    check(i18n.t('popup_allow_portrait'), 'allowPortrait'),
    storageSection(available),
    button(i18n.t('popup_open_shortcuts'), () => { void chrome.runtime.openOptionsPage(); }),
  );
  mainControls.append(extras);

  if (!s.enabled) {
    mainControls.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input').forEach(el => { el.disabled = true; });
  }
  app.append(mainControls);

  // The worker has no language context; render its no-player and loading states here.
  const statusText = !snapshot.adapter ? i18n.t('popup_status_loading')
    : !available ? i18n.t('popup_status_no_video') : snapshot.status.message;
  const status = node('p', statusText, 'status');
  status.setAttribute('role', 'status');
  app.append(status);
}

async function loadInitialState() {
  const state = await chrome.runtime.sendMessage({ type: 'JZ_POPUP_STATE' });
  if (!state?.settings) throw new Error(state?.error || 'Could not load settings.');
  snapshot = state;
  render();
}

void loadInitialState().catch(error => {
  render();
  reportError(error.message);
});
