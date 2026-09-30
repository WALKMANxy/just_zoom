import { i18n } from '../../src/shared/i18n';

export function hydrateOptionsI18n(): void {
  document.title = i18n.t('options_title');

  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (key) {
      const msg = i18n.t(key as any);
      if (msg) el.textContent = msg;
    }
  });

  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const key = el.dataset.i18nTitle;
    if (key) {
      const msg = i18n.t(key as any);
      if (msg) el.title = msg;
    }
  });

  document.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    const key = el.dataset.i18nAria;
    if (key) {
      const msg = i18n.t(key as any);
      if (msg) el.setAttribute('aria-label', msg);
    }
  });
}
