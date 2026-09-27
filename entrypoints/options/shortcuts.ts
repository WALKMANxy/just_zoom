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
      button.textContent = recording === action ? 'Press shortcut…' : formatShortcut(map[action]);
      button.setAttribute('aria-pressed', String(recording === action));
      button.setAttribute('aria-label', `Rebind ${SHORTCUT_LABELS[action].toLowerCase()}; ${formatShortcut(map[action])}`);
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
      catch { if (active) announce('Could not save shortcuts. Try again.'); }
      finally { pendingWrites--; if (active && pendingWrites === 0) setSaving(false); }
    });
  };
  for (const action of SHORTCUT_ACTIONS) {
    const row = document.createElement('div'); row.className = 'shortcut-row';
    const label = document.createElement('span'); label.textContent = SHORTCUT_LABELS[action];
    const record = document.createElement('button'); record.type = 'button'; record.disabled = true;
    const onRecord = () => { recording = action; paint(); announce(`Press a key with ${isMac() ? 'Option, Control or Command' : 'Alt, Ctrl or Meta'} for ${SHORTCUT_LABELS[action].toLowerCase()}. Escape cancels.`); };
    record.addEventListener('click', onRecord);
    buttons.set(action, record);
    const unbind = document.createElement('button'); unbind.type = 'button'; unbind.className = 'shortcut-unbind'; unbind.textContent = 'Unbind'; unbind.disabled = true;
    unbind.setAttribute('aria-label', `Unbind ${SHORTCUT_LABELS[action].toLowerCase()}`);
    const onUnbind = () => commit({ ...map, [action]: null }, `${SHORTCUT_LABELS[action]} unbound.`);
    unbind.addEventListener('click', onUnbind);
    rowCleanup.push(() => { record.removeEventListener('click', onRecord); unbind.removeEventListener('click', onUnbind); });
    row.append(label, record, unbind); list.append(row);
  }
  paint(); reset.disabled = true;
  const onCancel = () => { stopRecording(); announce('Recording cancelled.'); };
  const onReset = () => commit(normalizeShortcuts(DEFAULT_SHORTCUTS), 'Default shortcuts restored.');
  cancel.addEventListener('click', onCancel); reset.addEventListener('click', onReset);
  const listener = (event: KeyboardEvent) => {
    if (!recording) return;
    if (event.code === 'Escape' || event.code === 'Tab') { if (event.code === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); } onCancel(); return; }
    if (event.isComposing || event.repeat || ['AltLeft', 'AltRight', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight'].includes(event.code)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const binding = shortcutFromEvent(event);
    if (!binding) { announce('Choose a supported key with Alt, Ctrl or Meta. Escape cancels.'); return; }
    const action = recording;
    commit({ ...map, [action]: binding }, `${SHORTCUT_LABELS[action]} saved as ${formatShortcut(binding)}.`);
  };
  document.addEventListener('keydown', listener, true);
  const unsubscribe = subscribeShortcuts(next => { revision++; if (pendingWrites === 0) { map = next; if (active) paint(); } });
  const initialRevision = revision;
  void loadShortcuts().then(next => { if (active && revision === initialRevision) { map = next; paint(); } }).catch(() => announce('Using defaults; stored shortcuts could not be read.')).finally(() => {
    if (!active) return;
    setSaving(pendingWrites > 0);
  });
  return () => { active = false; unsubscribe(); rowCleanup.forEach(cleanup => cleanup()); document.removeEventListener('keydown', listener, true); cancel.removeEventListener('click', onCancel); reset.removeEventListener('click', onReset); };
}
