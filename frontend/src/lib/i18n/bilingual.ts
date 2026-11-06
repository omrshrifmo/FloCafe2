'use client';

import { usePosSettingsStore } from '@/store/pos-settings';

/**
 * Universal Hook for Bilingual UI & RTL Handling
 * Synced with FloCafe's active POS language store
 */
export function useAppLanguage() {
  const language = usePosSettingsStore((s) => s.language);
  const lang = (language === 'ar' ? 'ar' : 'en') as 'ar' | 'en';
  const isAr = lang === 'ar';
  const dir = (isAr ? 'rtl' : 'ltr') as 'rtl' | 'ltr';

  const tr = (en: string, ar: string) => (isAr ? ar : en);

  return {
    lang,
    isAr,
    dir,
    tr,
  };
}
