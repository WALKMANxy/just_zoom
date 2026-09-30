import enMessages from '../../locales/en.json';
import deMessages from '../../locales/de.json';
import jaMessages from '../../locales/ja.json';
import esMessages from '../../locales/es.json';
import frMessages from '../../locales/fr.json';
import ptBrMessages from '../../locales/pt_BR.json';
import zhCnMessages from '../../locales/zh_CN.json';
import koMessages from '../../locales/ko.json';
import itMessages from '../../locales/it.json';
import ruMessages from '../../locales/ru.json';
import plMessages from '../../locales/pl.json';
import nlMessages from '../../locales/nl.json';
import zhTwMessages from '../../locales/zh_TW.json';
import type { GeneratedI18nStructure } from '../../.wxt/i18n/structure';

export type Language = 'auto' | 'en' | 'de' | 'ja' | 'es' | 'fr' | 'pt_BR' | 'zh_CN' | 'ko' | 'it' | 'ru' | 'pl' | 'nl' | 'zh_TW';

export const SUPPORTED_LANGUAGES: { value: Language; label: string }[] = [
  { value: 'auto', label: 'Auto (Browser default)' },
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
  { value: 'ja', label: '日本語' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'pt_BR', label: 'Português (Brasil)' },
  { value: 'zh_CN', label: '简体中文' },
  { value: 'ko', label: '한국어' },
  { value: 'it', label: 'Italiano' },
  { value: 'ru', label: 'Русский' },
  { value: 'pl', label: 'Polski' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'zh_TW', label: '繁體中文' },
];

const DICTIONARIES: Record<Exclude<Language, 'auto'>, Record<string, string>> = {
  en: enMessages,
  de: deMessages,
  ja: jaMessages,
  es: esMessages,
  fr: frMessages,
  pt_BR: ptBrMessages,
  zh_CN: zhCnMessages,
  ko: koMessages,
  it: itMessages,
  ru: ruMessages,
  pl: plMessages,
  nl: nlMessages,
  zh_TW: zhTwMessages,
};

let currentLanguage: Language = 'auto';

type LanguageListener = (lang: Language) => void;
const listeners = new Set<LanguageListener>();

export function getLanguage(): Language {
  return currentLanguage;
}

export function setLanguage(lang: Language): void {
  if (currentLanguage !== lang) {
    currentLanguage = lang;
    for (const listener of listeners) {
      try {
        listener(lang);
      } catch (err) {
        console.error('Error in language listener:', err);
      }
    }
  }
}

export function subscribeLanguage(listener: LanguageListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function formatTemplate(template: string, args: unknown[]): string {
  const subs: string[] = [];
  for (const arg of args) {
    if (Array.isArray(arg)) {
      subs.push(...arg.map(String));
    } else if (typeof arg === 'string' || typeof arg === 'number') {
      subs.push(String(arg));
    }
  }
  if (subs.length === 0) return template;
  return template.replace(/\$(\d+)/g, (match, n) => {
    const idx = parseInt(n, 10) - 1;
    return idx >= 0 && idx < subs.length ? (subs[idx] ?? match) : match;
  });
}

export function t(key: keyof GeneratedI18nStructure | (string & {}), ...args: unknown[]): string {
  const normKey = String(key).replaceAll('.', '_');

  if (currentLanguage !== 'auto') {
    const dict = DICTIONARIES[currentLanguage];
    if (dict && dict[normKey] != null) {
      return formatTemplate(dict[normKey]!, args);
    }
    if (DICTIONARIES.en[normKey] != null) {
      return formatTemplate(DICTIONARIES.en[normKey]!, args);
    }
  }

  // Auto mode: attempt to use the browser's native localization API
  try {
    if (typeof chrome !== 'undefined' && chrome.i18n?.getMessage) {
      const subs: string[] = [];
      for (const arg of args) {
        if (Array.isArray(arg)) subs.push(...arg.map(String));
        else if (typeof arg === 'string' || typeof arg === 'number') subs.push(String(arg));
      }
      const msg = subs.length > 0
        ? chrome.i18n.getMessage(normKey, subs)
        : chrome.i18n.getMessage(normKey);
      if (msg) return msg;
    }
  } catch {}

  // Fallback to English dictionary if native getMessage is not available or returned empty
  if (DICTIONARIES.en[normKey] != null) {
    return formatTemplate(DICTIONARIES.en[normKey]!, args);
  }

  return normKey;
}

export const i18n = {
  t,
  getLanguage,
  setLanguage,
  subscribeLanguage,
};
