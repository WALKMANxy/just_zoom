import { i18n } from '#i18n';
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, SHORTCUT_LABELS, formatShortcut, isMac, loadShortcuts, normalizeShortcuts, saveShortcuts, shortcutFromEvent, subscribeShortcuts, validateShortcuts, type ShortcutMap } from '../../src/shared/shortcuts';
import type { ZoomAction } from '../../src/shared/types';

export function setupShortcutSettings(): () => void {
  const list = document.querySelector<HTMLElement>('#shortcut-list')!;
  const message = document.querySelector<HTMLElement>('#shortcut-status')!;
  const cancel = document.querySelector<HTMLButtonElement>('#shortcut-cancel')!;
  const reset = document.querySelector<HTMLButtonElement>('#shortcut-reset')!;
  let map: ShortcutMap = normalizeShortcuts(undefined), recording: ZoomAction | null = null, active = true, revision = 0, pendingWrites = 0;
  let saving: Promise<void> = Promise.resolve();
  const rowCleanup: (() => void)[] = [];
  const buttons = new Map<ZoomAction, HTMLButtonElement>();
  const announce = (text: string) => { message.textContent = text; };
  const paint = () => {
    for (const action of SHORTCUT_ACTIONS) {
      const button = buttons.get(action)!;
      button.textContent = recording === action ? i18n.t('shortcut_press_shortcut') : formatShortcut(map[action]);
      button.setAttribute('aria-pressed', String(recording === action));
      button.setAttribute('aria-label', i18n.t('shortcut_aria_rebind', [SHORTCUT_LABELS[action].toLowerCase(), formatShortcut(map[action])]));
    }
    cancel.hidden = recording === null;
  };
  const stopRecording = () => { recording = null; paint(); };
  const setSaving = (busy: boolean) => {
    list.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = busy; }); reset.disabled = busy;
  };
  const commit = (next: ShortcutMap, text: string) => {
    const error = validateShortcuts(next); if (error) { announce(error); return; }
    map = normalizeShortcuts(next); stopRecording();
    const snapshot = normalizeShortcuts(map);
    pendingWrites++; setSaving(true);
    saving = saving.then(async () => {
      try { await saveShortcuts(snapshot); if (active) announce(text); }
      catch { if (active) announce(i18n.t('shortcut_save_failed')); }
      finally { pendingWrites--; if (active && pendingWrites === 0) setSaving(false); }
    });
  };
  for (const action of SHORTCUT_ACTIONS) {
    const row = document.createElement('div'); row.className = 'shortcut-row';
    const label = document.createElement('span'); label.textContent = SHORTCUT_LABELS[action];
    const record = document.createElement('button'); record.type = 'button'; record.disabled = true;
    const onRecord = () => {
      recording = action;
      paint();
      const mods = isMac() ? 'Option, Control or Command' : 'Alt, Ctrl or Meta';
      announce(i18n.t('shortcut_press_prompt', [mods, SHORTCUT_LABELS[action].toLowerCase()]));
    };
    record.addEventListener('click', onRecord);
    buttons.set(action, record);
    const unbind = document.createElement('button'); unbind.type = 'button'; unbind.className = 'shortcut-unbind'; unbind.textContent = i18n.t('shortcut_unbind_btn'); unbind.disabled = true;
    unbind.setAttribute('aria-label', i18n.t('shortcut_aria_unbind', [SHORTCUT_LABELS[action].toLowerCase()]));
    const onUnbind = () => commit({ ...map, [action]: null }, i18n.t('shortcut_announced_unbound', [SHORTCUT_LABELS[action]]));
    unbind.addEventListener('click', onUnbind);
    rowCleanup.push(() => { record.removeEventListener('click', onRecord); unbind.removeEventListener('click', onUnbind); });
    row.append(label, record, unbind); list.append(row);
  }
  paint(); reset.disabled = true;
  const onCancel = () => { stopRecording(); announce(i18n.t('shortcut_recording_cancelled')); };
  const onReset = () => commit(normalizeShortcuts(DEFAULT_SHORTCUTS), i18n.t('shortcut_restored_defaults'));
  cancel.addEventListener('click', onCancel); reset.addEventListener('click', onReset);
  const listener = (event: KeyboardEvent) => {
    if (!recording) return;
    if (event.code === 'Escape' || event.code === 'Tab') { if (event.code === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); } onCancel(); return; }
    if (event.isComposing || event.repeat || ['AltLeft', 'AltRight', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight'].includes(event.code)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const binding = shortcutFromEvent(event);
    if (!binding) { announce(i18n.t('shortcut_invalid_prompt')); return; }
    const action = recording;
    commit({ ...map, [action]: binding }, i18n.t('shortcut_saved_as', [SHORTCUT_LABELS[action], formatShortcut(binding)]));
  };
  document.addEventListener('keydown', listener, true);
  const unsubscribe = subscribeShortcuts(next => { revision++; if (pendingWrites === 0) { map = next; if (active) paint(); } });
  const initialRevision = revision;
  void loadShortcuts().then(next => { if (active && revision === initialRevision) { map = next; paint(); } }).catch(() => announce(i18n.t('shortcut_load_failed'))).finally(() => {
    if (!active) return;
    setSaving(pendingWrites > 0);
  });
  return () => { active = false; unsubscribe(); rowCleanup.forEach(cleanup => cleanup()); document.removeEventListener('keydown', listener, true); cancel.removeEventListener('click', onCancel); reset.removeEventListener('click', onReset); };
}
