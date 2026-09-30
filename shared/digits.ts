/**
 * Centralized Western/Latin digit policy and normalizers for FloCafe.
 *
 * Invariant: FloCafe always renders Western digits (0123456789) across all locales,
 * including Arabic and Persian, while retaining native script labels and RTL layout.
 */

const DIGIT_MAP: Record<string, string> = {
  // Arabic-Indic digits (U+0660 - U+0669)
  '\u0660': '0', '\u0661': '1', '\u0662': '2', '\u0663': '3', '\u0664': '4',
  '\u0665': '5', '\u0666': '6', '\u0667': '7', '\u0668': '8', '\u0669': '9',
  // Eastern Arabic-Indic / Persian digits (U+06F0 - U+06F9)
  '\u06F0': '0', '\u06F1': '1', '\u06F2': '2', '\u06F3': '3', '\u06F4': '4',
  '\u06F5': '5', '\u06F6': '6', '\u06F7': '7', '\u06F8': '8', '\u06F9': '9',
};

const DIGITS_REGEX = /[\u0660-\u0669\u06F0-\u06F9]/g;

/**
 * Converts any Arabic-Indic (٠-٩) and Persian (۰-۹) digits in a string
 * to Western Latin digits (0-9). Leaves all other characters (including Arabic letters)
 * untouched.
 */
export function toWesternDigits(input: string | null | undefined): string {
  if (input === null || input === undefined) return '';
  const str = String(input);
  return str.replace(DIGITS_REGEX, (ch) => DIGIT_MAP[ch] ?? ch);
}

/**
 * Normalizes user numeric input typed or pasted from Arabic or Persian keyboards.
 * - Converts Arabic-Indic and Persian digits to Western digits (0-9).
 * - Normalizes Arabic decimal comma '٫' (U+066B) to '.'.
 * - Removes Arabic thousands separator '٬' (U+066C).
 */
export function normalizeNumericInput(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  let str = toWesternDigits(value);
  // Replace Arabic decimal separator U+066B (٫) with standard '.'
  str = str.replace(/\u066B/g, '.');
  // Remove Arabic thousand separator U+066C (٬)
  str = str.replace(/\u066C/g, '');
  return str;
}

/**
 * Parses a string or number that may contain Western, Arabic-Indic, or Persian digits.
 * Returns finite number or NaN.
 */
export function parseWesternNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') return NaN;
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const normalized = normalizeNumericInput(String(value)).trim();
  const num = Number(normalized);
  return Number.isFinite(num) ? num : NaN;
}

/**
 * Ensures a BCP-47 locale tag forces the Latin numbering system ('latn').
 * e.g., 'ar-SA' -> 'ar-SA-u-nu-latn'
 *       'ar-EG-u-nu-arab' -> 'ar-EG-u-nu-latn'
 */
export function enforceLatnLocale(locale: string | undefined): string {
  if (!locale) return 'en-US-u-nu-latn';
  const trimmed = locale.trim();
  if (/-nu-[a-z0-9]+/i.test(trimmed)) {
    return trimmed.replace(/-nu-[a-z0-9]+/i, '-nu-latn');
  }
  if (trimmed.includes('-u-')) {
    return `${trimmed}-nu-latn`;
  }
  return `${trimmed}-u-nu-latn`;
}
