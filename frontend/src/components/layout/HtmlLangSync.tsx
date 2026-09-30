'use client';

import { useEffect } from 'react';
import { usePosSettingsStore } from '@/store/pos-settings';
import { getLanguageDirection, getLanguageLocale, isLanguage } from '@/lib/i18n';

/** Syncs <html lang> and <html dir> with active UI language.
 * Reads language from posSettingsStore directly so RTL direction
 * is never affected by the enforced latn-digit locale suffix added
 * to the IntlProvider locale for digit formatting in 3.11.10. */
export function HtmlLangSync() {
  const storedLanguage = usePosSettingsStore((s) => s.language);
  const language = isLanguage(storedLanguage) ? storedLanguage : 'en';
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const el = document.documentElement;
    el.lang = getLanguageLocale(language);
    el.dir = getLanguageDirection(language);
  }, [language]);
  return null;
}
