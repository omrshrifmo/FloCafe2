import { parseDbTimestamp } from '@/lib/utils';
import { toWesternDigits, enforceLatnLocale } from '@/lib/countries';

export function formatDate(iso?: string, locale: string = 'en-US', options?: Intl.DateTimeFormatOptions): string {
  if (!iso) return '';
  try {
    const d = parseDbTimestamp(iso);
    if (isNaN(d.getTime())) return iso;
    const targetLocale = enforceLatnLocale(locale);
    const formatted = new Intl.DateTimeFormat(targetLocale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      numberingSystem: 'latn',
      ...options,
    }).format(d);
    return toWesternDigits(formatted);
  } catch {
    return iso;
  }
}

export function formatTime(iso?: string, locale: string = 'en-US', options?: Intl.DateTimeFormatOptions): string {
  if (!iso) return '';
  try {
    const d = parseDbTimestamp(iso);
    if (isNaN(d.getTime())) return iso;
    const targetLocale = enforceLatnLocale(locale);
    const formatted = new Intl.DateTimeFormat(targetLocale, {
      hour: '2-digit',
      minute: '2-digit',
      numberingSystem: 'latn',
      ...options,
    }).format(d);
    return toWesternDigits(formatted);
  } catch {
    return iso;
  }
}
