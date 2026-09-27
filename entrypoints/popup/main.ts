import { DEFAULT_SETTINGS, type RuntimeSnapshot, type Settings } from '../../src/shared/types';
import { formatModifier } from '../../src/shared/shortcuts';
import './style.css';
import { AUTO_CROP_AVAILABLE } from '../../src/shared/features';

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
    if (!result?.settings) throw new Error(result?.error || 'Could not update the player.');
    snapshot = result;
    render();
  }).catch(error => reportError(error instanceof Error ? error.message : 'Could not update settings.'));
}

const patch = (value: Partial<Settings>) => run({ type: 'JZ_PATCH', patch: value });

function button(text: string, click: () => void, disabled = false) {
  const result = node('button', text);
  result.type = 'button';
  result.disabled = disabled;
  result.addEventListener('click', click);
  return result;
}

function choices(label: string, values: Array<[string, string | number]>, current: string | number, change: (value: string | number) => void) {
  const group = node('fieldset');
  group.append(node('legend', label));
  const buttons = node('div', '', 'segments');
  for (const [text, value] of values) {
    const item = button(text, () => change(value));
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
  const { settings: s, available } = snapshot;
  app.replaceChildren(node('h1', 'just_zoom'));
  const hostLabel = snapshot.hostname
    ? (available ? snapshot.hostname : `${snapshot.hostname} · no active video`)
    : 'Global defaults · no active video';
  app.append(node('p', hostLabel, 'subtitle'));

  // Master Enable / Disable Toggle
  const masterToggle = button(
    s.enabled ? 'just_zoom: Enabled' : 'just_zoom: Disabled',
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
  quickGroup.append(node('legend', 'Quick zoom'));
  const quickRow = node('div', '', 'segments');

  const quickOff = button('Off', () => patch({ zoomApplied: false, zoomType: 'quick' }));
  quickOff.setAttribute('aria-pressed', String(!s.zoomApplied && s.zoomType === 'quick'));
  quickRow.append(quickOff);

  const quickFit = button('Fit', () => patch({ mode: 'fit', zoomType: 'quick', zoomApplied: true }));
  quickFit.setAttribute('aria-pressed', String(s.zoomApplied && s.zoomType === 'quick' && s.mode === 'fit'));
  quickRow.append(quickFit);

  const quickFill = button('Fill', () => patch({ mode: 'fill', zoomType: 'quick', zoomApplied: true }));
  quickFill.setAttribute('aria-pressed', String(s.zoomApplied && s.zoomType === 'quick' && s.mode === 'fill'));
  quickRow.append(quickFill);

  quickGroup.append(quickRow);
  quickZoomSection.append(quickGroup);
  mainControls.append(quickZoomSection);

  // Zoom factor section
  const factorZoomSection = node('section', '', `zoom-section ${s.zoomType === 'quick' ? 'dimmed' : ''}`);
  const factorGroup = node('fieldset');
  factorGroup.append(node('legend', 'Zoom factor'));
  const factorRow = node('div', '', 'segments');

  const isFactorActive = Boolean(s.zoomApplied && s.zoomType === 'factor');
  const isFactorAuto = Boolean(isFactorActive && s.zoomStrategy === 'automatic');
  const isFactorManual = Boolean(isFactorActive && s.zoomStrategy === 'manual');
  const isFactorOff = !isFactorAuto && !isFactorManual;

  const factorOff = button('Off', () => patch({ zoomApplied: false }));
  factorOff.setAttribute('aria-pressed', String(isFactorOff));
  factorRow.append(factorOff);

  const factorAuto = button('Screen ratio', () => patch({ zoomStrategy: 'automatic', zoomType: 'factor', zoomApplied: true }));
  factorAuto.setAttribute('aria-pressed', String(isFactorAuto));
  factorRow.append(factorAuto);

  const factorManual = button('Manual', () => {
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
      slider('Zoom', 'zoom', .34, 3, .01, true, Number(screenFactor.toFixed(2))),
    );
  } else if (isFactorManual) {
    // Manual presets: 1.18x, 1.25x, 1.34x, 1.5x, 2x (appear ONLY when manual is selected)
    const presetGroup = node('fieldset');
    presetGroup.append(node('legend', 'Manual presets'));
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
    factorZoomSection.append(presetGroup, slider('Zoom', 'zoom', .34, 3));
  }
  mainControls.append(factorZoomSection);

  // Framing adjustments (Pan & Reset)
  const framingSection = node('section', '', 'framing-section');
  const panActionsRow = node('div', '', 'segments');
  const isPanned = Math.abs(s.panX) > 0.001 || Math.abs(s.panY) > 0.001;
  panActionsRow.append(
    button('Reset pan', () => run({ type: 'JZ_RESET_PAN' }), !available || !isPanned),
    button('Reset all', () => run({ type: 'JZ_RESET' }), !available),
  );
  const gestureTip = node('p', `💡 Hold ${formatModifier(s.gestureModifier ?? 'alt')} + scroll to zoom, drag to pan`, 'hint gesture-tip');
  framingSection.append(
    slider('Pan X', 'panX', -1, 1, .05),
    slider('Pan Y', 'panY', -1, 1, .05),
    panActionsRow,
    gestureTip,
  );
  mainControls.append(framingSection);

  // Extras and settings
  const extras = node('section', '', 'extras');
  extras.append(node('h2', 'Player button'));
  extras.append(choices('Player controls', [['Native button', 'native'], ['Floating popup', 'floating'], ['Both', 'both']], s.controlMode, value => patch({ controlMode: value as Settings['controlMode'] })));
  extras.append(node('p', s.controlMode === 'native' ? 'Inserted before fullscreen where the player exposes compatible controls.' : 'Reveals within 200px of the video box’s right-center edge. Opens leftward.', 'hint'));
  extras.append(check('Animate zoom transitions', 'animations'));
  if (snapshot.adapter === 'Netflix' || /(^|\.)netflix\.com$/.test(snapshot.hostname)) {
    extras.append(node('p', 'Zoom animations are always disabled on Netflix for stability.', 'hint'));
  }
  extras.append(node('h2', 'Ambience'));
  const ambience = choices('Ambience', [['Off', 'off'], ['Soft', 'soft'], ['Full', 'full']], s.ambience, value => patch({ ambience: value as Settings['ambience'] }));
  ambience.setAttribute('aria-describedby', 'local-pixels');
  extras.append(ambience);
  const pixels = node('p', 'Video pixels are processed only on this device. They are not saved or uploaded.', 'hint');
  pixels.id = 'local-pixels';
  extras.append(pixels, check('Allow portrait video / player', 'allowPortrait'));
  // Note: Compatibility capture hidden and disabled for now

  // Storage section: Save site, Save global, Clear site, Clear all
  const storageSection = node('div', '', 'storage-section');
  storageSection.append(node('h2', 'Storage'));
  storageSection.append(check('Remember zoom state per website', 'rememberSiteState'));
  const saves = node('div', '', 'segments');
  saves.append(
    button('Save site', () => run({ type: 'JZ_SAVE_SITE' }), !available),
    button('Save global', () => run({ type: 'JZ_SAVE_GLOBAL' })),
  );
  const clears = node('div', '', 'segments');
  clears.style.marginTop = '4px';
  clears.append(
    button('Clear site', () => run({ type: 'JZ_CLEAR_SITE' }), !available),
    button('Clear all', () => run({ type: 'JZ_CLEAR_ALL' })),
  );
  storageSection.append(
    saves,
    clears,
    node('p', available ? 'Site preferences override global defaults. Clear site removes site preferences; Clear all resets all saved preferences.' : 'Changes save automatically as global defaults.', 'hint'),
  );
  extras.append(storageSection);
  extras.append(button('Keyboard shortcuts & player lab', () => { void chrome.runtime.openOptionsPage(); }));
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
