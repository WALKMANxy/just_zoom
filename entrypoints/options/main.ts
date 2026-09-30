import './style.css';
import { startRuntime } from '../../src/core/runtime';
import { setupShortcutSettings } from './shortcuts';
import { eraseSettings, loadFullStore, normalizeSettings, saveGlobalSettings } from '../../src/shared/storage';
import { DEFAULT_SETTINGS, type AspectRatioBucket, type DisplayProfile, type GestureModifier, type Settings, type SiteEntry } from '../../src/shared/types';
import { automaticZoomFactor } from '../../src/core/eligibility';
import { isMac } from '../../src/shared/shortcuts';
import { i18n } from '#i18n';
import { hydrateOptionsI18n } from './i18n';

hydrateOptionsI18n();

// ----------------------------------------------------------------------------
// 1. Tab Navigation
// ----------------------------------------------------------------------------
const tabButtons = document.querySelectorAll<HTMLButtonElement>('.tab-btn');
const tabPanels = document.querySelectorAll<HTMLElement>('.tab-panel');

function switchTab(tabId: string) {
  tabButtons.forEach(btn => {
    const isTarget = btn.id === `tab-btn-${tabId}`;
    btn.classList.toggle('active', isTarget);
    btn.setAttribute('aria-selected', String(isTarget));
  });

  tabPanels.forEach(panel => {
    const isTarget = panel.id === `tab-panel-${tabId}`;
    panel.hidden = !isTarget;
  });

  if (tabId === 'sites') {
    void renderSavedSites();
  }
}

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const tabId = btn.id.replace('tab-btn-', '');
    switchTab(tabId);
  });
});

// ----------------------------------------------------------------------------
// 2. Global Settings
// ----------------------------------------------------------------------------
const masterToggleBtn = document.querySelector<HTMLButtonElement>('#setting-master-toggle')!;
const settingsGrid = document.querySelector<HTMLElement>('#settings-grid')!;
const controlModeSelect = document.querySelector<HTMLSelectElement>('#setting-controlMode')!;
const buttonActionSelect = document.querySelector<HTMLSelectElement>('#setting-buttonAction')!;
const rememberSiteStateCheckbox = document.querySelector<HTMLInputElement>('#setting-rememberSiteState')!;
const animationsCheckbox = document.querySelector<HTMLInputElement>('#setting-animations')!;
const allowPortraitCheckbox = document.querySelector<HTMLInputElement>('#setting-allowPortrait')!;
const gesturesEnabledCheckbox = document.querySelector<HTMLInputElement>('#setting-gesturesEnabled')!;
const gestureModifierSelect = document.querySelector<HTMLSelectElement>('#setting-gestureModifier')!;
if (isMac() && gestureModifierSelect) {
  for (const opt of Array.from(gestureModifierSelect.options)) {
    if (opt.value === 'alt') opt.textContent = 'Option (default)';
    else if (opt.value === 'ctrl') opt.textContent = 'Control';
    else if (opt.value === 'meta') opt.textContent = 'Command (Cmd)';
  }
}
const hudEnabledCheckbox = document.querySelector<HTMLInputElement>('#setting-hudEnabled')!;
const modeSelect = document.querySelector<HTMLSelectElement>('#setting-mode')!;
const zoomStrategySelect = document.querySelector<HTMLSelectElement>('#setting-zoomStrategy')!;
const zoomSlider = document.querySelector<HTMLInputElement>('#setting-zoom')!;
const zoomVal = document.querySelector<HTMLElement>('#setting-zoom-val')!;
const ambienceButtons = document.querySelectorAll<HTMLButtonElement>('#setting-ambience button');
const ambienceRateButtons = document.querySelectorAll<HTMLButtonElement>('#setting-ambienceRate button');
const settingsStatus = document.querySelector<HTMLElement>('#settings-status')!;
const settingsSaveBtn = document.querySelector<HTMLButtonElement>('#settings-save-btn')!;
const settingsResetBtn = document.querySelector<HTMLButtonElement>('#settings-reset-btn')!;
const videoFinderModeSelect = document.querySelector<HTMLSelectElement>('#setting-videoFinderMode')!;
const nativeHtml5WorkaroundCheckbox = document.querySelector<HTMLInputElement>('#setting-nativeHtml5Workaround')!;
const displayProfileSelect = document.querySelector<HTMLSelectElement>('#setting-displayProfile')!;
const customRatioGroup = document.querySelector<HTMLElement>('#custom-ratio-group')!;
const customRatioInput = document.querySelector<HTMLInputElement>('#setting-customDisplayAspectRatio')!;
const detectedScreenText = document.querySelector<HTMLElement>('#detected-screen-text')!;
const experimentalSaveBtn = document.querySelector<HTMLButtonElement>('#experimental-save-btn')!;
const experimentalStatus = document.querySelector<HTMLElement>('#experimental-status')!;

let currentGlobal: Settings = { ...DEFAULT_SETTINGS };

const zoomPresetChips = document.querySelectorAll<HTMLButtonElement>('.preset-chip');

function setExclusiveButtons(buttons: NodeListOf<HTMLButtonElement>, value: string) {
  buttons.forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.value === value));
  });
}

function selectedButtonValue(buttons: NodeListOf<HTMLButtonElement>, fallback: string) {
  return Array.from(buttons).find(button => button.getAttribute('aria-pressed') === 'true')?.dataset.value || fallback;
}

ambienceButtons.forEach(button => {
  button.addEventListener('click', () => setExclusiveButtons(ambienceButtons, button.dataset.value || 'blur'));
});

ambienceRateButtons.forEach(button => {
  button.addEventListener('click', () => setExclusiveButtons(ambienceRateButtons, button.dataset.value || 'high'));
});

function updateZoomDisplay() {
  const val = Number.parseFloat(zoomSlider.value);
  zoomVal.textContent = `${val.toFixed(2)}×`;
  zoomPresetChips.forEach(chip => {
    const chipVal = Number.parseFloat(chip.dataset.zoom || '0');
    chip.classList.toggle('active', Math.abs(val - chipVal) < 0.01);
  });
}

zoomSlider.addEventListener('input', updateZoomDisplay);

zoomPresetChips.forEach(chip => {
  chip.addEventListener('click', () => {
    const chipVal = Number.parseFloat(chip.dataset.zoom || '0');
    if (chipVal > 0) {
      zoomSlider.value = String(chipVal);
      updateZoomDisplay();
    }
  });
});

function updateMasterToggleUI(enabled: boolean) {
  masterToggleBtn.classList.toggle('active', enabled);
  masterToggleBtn.classList.toggle('inactive', !enabled);
  masterToggleBtn.setAttribute('aria-pressed', String(enabled));
  const label = masterToggleBtn.querySelector('.toggle-label');
  if (label) label.textContent = enabled ? i18n.t('popup_enabled_label') : i18n.t('popup_disabled_label');
  settingsGrid.classList.toggle('disabled-grid', !enabled);
  controlModeSelect.disabled = !enabled;
  buttonActionSelect.disabled = !enabled;
  rememberSiteStateCheckbox.disabled = !enabled;
  animationsCheckbox.disabled = !enabled;
  allowPortraitCheckbox.disabled = !enabled;
  gesturesEnabledCheckbox.disabled = !enabled;
  gestureModifierSelect.disabled = !enabled;
  hudEnabledCheckbox.disabled = !enabled;
  modeSelect.disabled = !enabled;
  zoomStrategySelect.disabled = !enabled;
  zoomSlider.disabled = !enabled;
  ambienceButtons.forEach(button => { button.disabled = !enabled; });
  ambienceRateButtons.forEach(button => { button.disabled = !enabled; });
  displayProfileSelect.disabled = !enabled;
  customRatioInput.disabled = !enabled;
  zoomPresetChips.forEach(chip => { chip.disabled = !enabled; });
}

function updateDisplayProfileUI() {
  const isCustom = displayProfileSelect.value === 'custom';
  customRatioGroup.style.display = isCustom ? 'block' : 'none';

  if (typeof screen !== 'undefined') {
    const sw = screen.width, sh = screen.height;
    const ratio = (sw / sh).toFixed(2);
    let name = i18n.t('options_display_name_generic_widescreen');
    if (Math.abs(sw / sh - 16 / 9) < 0.05) name = i18n.t('options_display_name_widescreen');
    else if (Math.abs(sw / sh - 16 / 10) < 0.05) name = i18n.t('options_display_name_widescreen_16_10');
    else if (Math.abs(sw / sh - 21 / 9) < 0.1) name = i18n.t('options_display_name_ultrawide_21_9');
    else if (Math.abs(sw / sh - 32 / 9) < 0.15) name = i18n.t('options_display_name_super_ultrawide_32_9');
    else if (Math.abs(sw / sh - 4 / 3) < 0.05) name = i18n.t('options_display_name_standard_4_3');

    const selectedProfile = displayProfileSelect.value as DisplayProfile;
    const customRatio = Number.parseFloat(customRatioInput.value) || 2.39;
    const effectiveFactor = automaticZoomFactor(selectedProfile, customRatio, sw, sh);

    if (detectedScreenText) {
      detectedScreenText.textContent = i18n.t('options_detected_display_info', [
        String(sw),
        String(sh),
        name,
        ratio,
        effectiveFactor.toFixed(2),
      ]);
    }
  }
}

displayProfileSelect.addEventListener('change', updateDisplayProfileUI);
customRatioInput.addEventListener('input', updateDisplayProfileUI);
window.addEventListener('resize', updateDisplayProfileUI);

masterToggleBtn.addEventListener('click', async () => {
  currentGlobal.enabled = !currentGlobal.enabled;
  updateMasterToggleUI(currentGlobal.enabled);
  try {
    await saveGlobalSettings(currentGlobal);
    settingsStatus.textContent = currentGlobal.enabled
      ? i18n.t('options_status_enabled_globally')
      : i18n.t('options_status_disabled_globally');
  } catch {
    settingsStatus.textContent = i18n.t('options_status_update_failed');
  }
});

function applySettingsToForm(settings: Settings) {
  updateMasterToggleUI(settings.enabled);
  controlModeSelect.value = settings.controlMode;
  buttonActionSelect.value = settings.buttonAction === 'zoom-out' ? 'zoom-out' : 'zoom-in';
  rememberSiteStateCheckbox.checked = settings.rememberSiteState;
  animationsCheckbox.checked = settings.animations;
  allowPortraitCheckbox.checked = settings.allowPortrait;
  gesturesEnabledCheckbox.checked = settings.gesturesEnabled ?? true;
  gestureModifierSelect.value = settings.gestureModifier || 'alt';
  hudEnabledCheckbox.checked = settings.hudEnabled ?? false;
  displayProfileSelect.value = settings.displayProfile || 'auto';
  customRatioInput.value = String(settings.customDisplayAspectRatio ?? 2.39);
  updateDisplayProfileUI();
  modeSelect.value = settings.mode;
  zoomStrategySelect.value = settings.zoomStrategy;
  zoomSlider.value = String(settings.zoom);
  updateZoomDisplay();
  setExclusiveButtons(ambienceButtons, settings.ambience);
  setExclusiveButtons(ambienceRateButtons, settings.ambienceRate);
  videoFinderModeSelect.value = settings.videoFinderMode || 'treewalker';
  nativeHtml5WorkaroundCheckbox.checked = settings.nativeHtml5Workaround ?? true;
}

function readSettingsFromForm(): Settings {
  return {
    ...currentGlobal,
    enabled: currentGlobal.enabled,
    controlMode: controlModeSelect.value as 'both' | 'native' | 'floating',
    buttonAction: buttonActionSelect.value as 'zoom-in' | 'zoom-out',
    rememberSiteState: rememberSiteStateCheckbox.checked,
    animations: animationsCheckbox.checked,
    allowPortrait: allowPortraitCheckbox.checked,
    gesturesEnabled: gesturesEnabledCheckbox.checked,
    gestureModifier: (gestureModifierSelect.value as GestureModifier) || 'alt',
    hudEnabled: hudEnabledCheckbox.checked,
    displayProfile: (displayProfileSelect.value as DisplayProfile) || 'auto',
    customDisplayAspectRatio: Number.parseFloat(customRatioInput.value) || 2.39,
    mode: modeSelect.value as 'fit' | 'fill',
    zoomStrategy: zoomStrategySelect.value as 'manual' | 'automatic',
    zoom: Number.parseFloat(zoomSlider.value) || 1.34,
    ambience: selectedButtonValue(ambienceButtons, 'blur') as Settings['ambience'],
    ambienceRate: selectedButtonValue(ambienceRateButtons, 'high') as Settings['ambienceRate'],
    videoFinderMode: (videoFinderModeSelect.value as 'treewalker' | 'bruteforce') || 'treewalker',
    nativeHtml5Workaround: nativeHtml5WorkaroundCheckbox.checked,
  };
}

async function loadGlobalSettings() {
  try {
    const store = await loadFullStore();
    currentGlobal = store.global;
    applySettingsToForm(currentGlobal);
  } catch (error) {
    console.error('Failed to load settings:', error);
    applySettingsToForm(DEFAULT_SETTINGS);
  }
}

settingsSaveBtn.addEventListener('click', async () => {
  const next = readSettingsFromForm();
  currentGlobal = next;
  settingsSaveBtn.disabled = true;
  try {
    await saveGlobalSettings(next);
    settingsStatus.textContent = i18n.t('options_status_saved_at', [new Date().toLocaleTimeString()]);
  } catch {
    settingsStatus.textContent = i18n.t('options_status_save_failed');
  } finally {
    settingsSaveBtn.disabled = false;
  }
});

settingsResetBtn.addEventListener('click', async () => {
  applySettingsToForm(DEFAULT_SETTINGS);
  currentGlobal = { ...DEFAULT_SETTINGS };
  settingsResetBtn.disabled = true;
  try {
    await saveGlobalSettings(DEFAULT_SETTINGS);
    settingsStatus.textContent = i18n.t('options_status_restored_defaults');
  } catch {
    settingsStatus.textContent = i18n.t('options_status_restore_failed');
  } finally {
    settingsResetBtn.disabled = false;
  }
});

experimentalSaveBtn.addEventListener('click', async () => {
  const next = readSettingsFromForm();
  currentGlobal = next;
  experimentalSaveBtn.disabled = true;
  try {
    await saveGlobalSettings(next);
    experimentalStatus.textContent = i18n.t('options_status_experimental_saved_at', [new Date().toLocaleTimeString()]);
  } catch {
    experimentalStatus.textContent = i18n.t('options_status_experimental_save_failed');
  } finally {
    experimentalSaveBtn.disabled = false;
  }
});

void loadGlobalSettings();

// ----------------------------------------------------------------------------
// 3. Saved Sites Manager
// ----------------------------------------------------------------------------
const sitesList = document.querySelector<HTMLElement>('#sites-list')!;
const sitesClearAllBtn = document.querySelector<HTMLButtonElement>('#sites-clear-all')!;
const sitesStatus = document.querySelector<HTMLElement>('#sites-status')!;

async function renderSavedSites() {
  try {
    const store = await loadFullStore();
    const entries = Object.entries(store.sites);
    sitesList.innerHTML = '';

    if (entries.length === 0) {
      sitesClearAllBtn.disabled = true;
      sitesList.innerHTML = `
        <div class="sites-empty">
          <p style="font-weight: 600; font-size: 15px; color: #ededee; margin-bottom: 6px;">${i18n.t('options_sites_empty_title')}</p>
          <p>${i18n.t('options_sites_empty_desc')}</p>
        </div>
      `;
      return;
    }

    sitesClearAllBtn.disabled = false;

    function makeChipsForProfile(data: Partial<Settings>): HTMLElement[] {
      const chips: HTMLElement[] = [];
      const normalized = normalizeSettings(data);
      if (data.zoomApplied === false) {
        const chip = document.createElement('span');
        chip.className = 'site-chip';
        chip.textContent = `${i18n.t('common_zoom')}: ${i18n.t('common_off')}`;
        chips.push(chip);
      } else {
        if (data.zoomType === 'quick') {
          const chip = document.createElement('span');
          chip.className = 'site-chip';
          chip.textContent = `Mode: ${(data.mode || 'fit').toUpperCase()}`;
          chips.push(chip);
        } else if (data.zoomStrategy === 'automatic') {
          const chip = document.createElement('span');
          chip.className = 'site-chip';
          chip.textContent = i18n.t('options_sites_strategy_screen');
          chips.push(chip);
        } else if (data.zoom !== undefined) {
          const chip = document.createElement('span');
          chip.className = 'site-chip';
          chip.textContent = `${i18n.t('common_zoom')}: ${(data.zoom * 100).toFixed(0)}%`;
          chips.push(chip);
        }
      }

      if (data.ambience && data.ambience !== 'off') {
        const chip = document.createElement('span');
        chip.className = 'site-chip';
        chip.textContent = `${i18n.t('common_ambience')}: ${normalized.ambience === 'colour' ? i18n.t('common_colour') : i18n.t('common_blur')}`;
        chips.push(chip);
        if (data.ambienceRate) {
          const rateChip = document.createElement('span');
          rateChip.className = 'site-chip';
          const rateLabel = normalized.ambienceRate === 'performance' ? i18n.t('common_performance') : normalized.ambienceRate === 'quality' ? i18n.t('common_quality') : i18n.t('common_default');
          rateChip.textContent = `Rate: ${rateLabel}`;
          chips.push(rateChip);
        }
      }

      if (data.autoCrop) {
        const chip = document.createElement('span');
        chip.className = 'site-chip';
        chip.textContent = `Auto Crop: ${i18n.t('common_on')}`;
        chips.push(chip);
      }

      if (data.controlMode) {
        const chip = document.createElement('span');
        chip.className = 'site-chip';
        chip.textContent = `Controls: ${data.controlMode}`;
        chips.push(chip);
      }

      return chips;
    }

    for (const [host, site] of entries) {
      const card = document.createElement('div');
      card.className = 'site-card';

      const info = document.createElement('div');
      info.className = 'site-info';

      const title = document.createElement('div');
      title.className = 'site-host';
      title.textContent = host;
      info.append(title);

      const profileEntries = site.profiles ? (Object.entries(site.profiles) as [AspectRatioBucket, Partial<Settings>][]) : [];

      if (profileEntries.length > 0) {
        const profilesList = document.createElement('div');
        profilesList.className = 'site-profiles-list';

        for (const [bucket, profile] of profileEntries) {
          const row = document.createElement('div');
          row.className = 'site-profile-row';

          const rowInfo = document.createElement('div');
          rowInfo.className = 'site-profile-row-info';

          const bucketChip = document.createElement('span');
          bucketChip.className = 'site-chip site-chip-bucket';
          bucketChip.textContent = bucket.toUpperCase();
          rowInfo.append(bucketChip, ...makeChipsForProfile(profile));

          const rowDelBtn = document.createElement('button');
          rowDelBtn.type = 'button';
          rowDelBtn.className = 'site-profile-del-btn';
          rowDelBtn.textContent = i18n.t('options_sites_btn_delete');
          rowDelBtn.setAttribute('aria-label', i18n.t('options_sites_aria_delete_profile', [bucket, host]));
          rowDelBtn.addEventListener('click', async () => {
            rowDelBtn.disabled = true;
            try {
              await eraseSettings('site', host, bucket);
              sitesStatus.textContent = i18n.t('options_sites_status_deleted_profile', [bucket, host]);
              void renderSavedSites();
            } catch {
              sitesStatus.textContent = i18n.t('options_sites_status_delete_profile_failed', [host]);
              rowDelBtn.disabled = false;
            }
          });

          row.append(rowInfo, rowDelBtn);
          profilesList.append(row);
        }
        info.append(profilesList);
      } else {
        const chips = document.createElement('div');
        chips.className = 'site-chips';
        chips.append(...makeChipsForProfile(site));
        info.append(chips);
      }

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'site-delete-btn';
      delBtn.textContent = profileEntries.length > 1 ? i18n.t('options_sites_btn_delete_all') : i18n.t('options_sites_btn_delete');
      delBtn.setAttribute('aria-label', i18n.t('options_sites_aria_delete_all', [host]));
      delBtn.addEventListener('click', async () => {
        delBtn.disabled = true;
        try {
          await eraseSettings('site', host);
          sitesStatus.textContent = i18n.t('options_sites_status_deleted_site', [host]);
          void renderSavedSites();
        } catch {
          sitesStatus.textContent = i18n.t('options_sites_status_delete_profile_failed', [host]);
          delBtn.disabled = false;
        }
      });

      card.append(info, delBtn);
      sitesList.append(card);
    }
  } catch (error) {
    console.error('Failed to render saved sites:', error);
    sitesList.innerHTML = `<p class="hint">${i18n.t('options_sites_read_failed')}</p>`;
  }
}

sitesClearAllBtn.addEventListener('click', async () => {
  sitesClearAllBtn.disabled = true;
  try {
    await eraseSettings('sites');
    sitesStatus.textContent = i18n.t('options_sites_status_cleared_all');
    void renderSavedSites();
  } catch {
    sitesStatus.textContent = i18n.t('options_sites_status_clear_failed');
    sitesClearAllBtn.disabled = false;
  }
});

// ----------------------------------------------------------------------------
// 4. Keyboard Shortcuts Setup
// ----------------------------------------------------------------------------
const disposeShortcuts = setupShortcutSettings();

// ----------------------------------------------------------------------------
// 5. Player Lab Setup
// ----------------------------------------------------------------------------
const stage = document.querySelector<HTMLElement>('.stage')!;
let video = document.querySelector<HTMLVideoElement>('#video')!;
const scene = document.querySelector<HTMLSelectElement>('#scene')!;
const source = document.createElement('canvas');
source.width = 960;
source.height = 540;
const ctx = source.getContext('2d')!;
const stream = source.captureStream(15);
video.srcObject = stream;
void video.play().catch(() => {});

let frame = 0;
const timer = window.setInterval(() => {
  const kind = scene.value === 'changing' ? (Math.floor(frame / 150) % 2 ? 'clean' : 'letterbox') : scene.value;
  let x = 0, y = 0, w = 960, h = 540;
  if (kind === 'letterbox' || kind === 'gray') { y = 68; h = 404; }
  if (kind === 'pillarbox') { x = 150; w = 660; }
  if (kind === 'windowbox') { x = 96; y = 54; w = 768; h = 432; }
  if (kind === 'asymmetric') { x = 140; y = 35; w = 760; h = 410; }
  ctx.fillStyle = kind === 'gray' ? '#0c0c0c' : '#000';
  ctx.fillRect(0, 0, 960, 540);
  const gradient = ctx.createLinearGradient(x, y, x + w, y + h);
  gradient.addColorStop(0, '#22b8ab');
  gradient.addColorStop(0.5, '#376ee0');
  gradient.addColorStop(1, '#d9619d');
  ctx.fillStyle = kind === 'dark' ? '#050609' : gradient;
  ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  if (kind !== 'dark') {
    ctx.fillStyle = '#ffffff33';
    ctx.beginPath();
    ctx.arc(x + w * (0.5 + 0.3 * Math.sin(frame / 45)), y + h / 2, h / 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.font = '600 30px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('just_zoom', x + w / 2, y + h / 2);
    ctx.font = '18px system-ui';
    ctx.fillText(kind.replaceAll('box', ' box'), x + w / 2, y + h / 2 + 32);
  }
  ctx.restore();
  if (document.querySelector<HTMLInputElement>('#subtitle')!.checked) {
    ctx.fillStyle = 'white';
    ctx.font = '24px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('A subtitle across the lower edge', 480, 510);
  }
  if (document.querySelector<HTMLInputElement>('#logo')!.checked) {
    ctx.fillStyle = 'white';
    ctx.font = 'bold 18px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('TV', 30, 35);
  }
  frame++;
}, 1000 / 15);

document.querySelector('#shape')!.addEventListener('change', e => {
  stage.style.aspectRatio = (e.target as HTMLSelectElement).value;
});

document.querySelector('#fullscreen')!.addEventListener('click', () => {
  void stage.requestFullscreen();
});

document.querySelector('#replace')!.addEventListener('click', () => {
  const replacement = video.cloneNode(false) as HTMLVideoElement;
  video.pause();
  video.srcObject = null;
  video.replaceWith(replacement);
  video = replacement;
  video.srcObject = stream;
  void video.play().catch(() => {});
});

const disposeRuntime = startRuntime();

window.addEventListener('pagehide', () => {
  disposeShortcuts();
  clearInterval(timer);
  disposeRuntime();
  stream.getTracks().forEach(track => track.stop());
}, { once: true });
