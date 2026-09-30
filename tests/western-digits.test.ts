const Module = require('module');
const originalLoad = (Module as any)._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-western-digits-'));
(Module as any)._load = function (request: string, parent: any, isMain: boolean) {
  if (request === 'electron') {
    return {
      app: {
        isPackaged: true,
        getPath: () => testDir,
        getVersion: () => '3.11.10',
      },
    };
  }
  if (request === '@countries') {
    return require('../main/countries');
  }
  return originalLoad.apply(this, arguments);
};

import { strict as assert } from 'node:assert';
import {
  toWesternDigits,
  normalizeNumericInput,
  parseWesternNumber,
  enforceLatnLocale,
} from '../shared/digits';
import {
  formatCurrency,
  formatNumber,
  formatDateForTenant,
  canonicalizeLocalizedAmount,
} from '../main/countries';
import { sanitizeAmountKeystrokes } from '../frontend/src/lib/currency-input';
import {
  buildBrandedReceiptRequest,
  buildBrandedKotRequest,
  renderBrandedReceiptSoftware,
  DEFAULT_RASTER_WIDTH_80MM,
} from '../main/printers/branded-receipt-renderer';

async function runTests() {
  console.log('--- Running Western Digits Enforcement Tests ---');

  // 1. Centralized normalizer unit tests
  // 1A: Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩)
  assert.equal(toWesternDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789');
  assert.equal(toWesternDigits('المجموع: ١٥٠٫٧٥ ريال'), 'المجموع: 150٫75 ريال');

  // 1B: Persian / Urdu digits (۰۱۲۳۴۵۶۷۸۹)
  assert.equal(toWesternDigits('۰۱۲۳۴۵۶۷۸۹'), '0123456789');
  assert.equal(toWesternDigits('مبلغ: ۱۲۵۰ تومان'), 'مبلغ: 1250 تومان');

  // 1C: Mixed BiDi text with punctuation
  assert.equal(toWesternDigits('طاولة رقم ٤ - فاتورة #١٠٢'), 'طاولة رقم 4 - فاتورة #102');
  assert.equal(toWesternDigits(null as any), '');
  assert.equal(toWesternDigits(undefined as any), '');
  assert.equal(toWesternDigits('Already Western 12345'), 'Already Western 12345');

  // 1D: normalizeNumericInput
  assert.equal(normalizeNumericInput('١٢٫٥٠'), '12.50');
  assert.equal(normalizeNumericInput('  -١٥٠.٧٥  '), '  -150.75  ');
  assert.equal(normalizeNumericInput('۰۱۲۳'), '0123');

  // 1E: parseWesternNumber
  assert.equal(parseWesternNumber('١٢٫٥٠'), 12.5);
  assert.equal(parseWesternNumber('۱۰۰۰'), 1000);
  assert.ok(Number.isNaN(parseWesternNumber('invalid')));

  // 1F: enforceLatnLocale
  assert.equal(enforceLatnLocale('ar-SA'), 'ar-SA-u-nu-latn');
  assert.equal(enforceLatnLocale('ar-EG'), 'ar-EG-u-nu-latn');
  assert.equal(enforceLatnLocale('ar-SA-u-nu-latn'), 'ar-SA-u-nu-latn');
  assert.equal(enforceLatnLocale('en-US'), 'en-US-u-nu-latn');
  assert.equal(enforceLatnLocale('fr-FR'), 'fr-FR-u-nu-latn');

  // 2. Formatting in main/countries.ts
  // 2A: Currency formatting under Arabic locale must use 0-9
  const sarFormatted = formatCurrency(150.75, 'SAR', 'ar-SA');
  assert.ok(!/[٠-٩۰-۹]/.test(sarFormatted), `SAR currency must not contain Arabic/Persian digits: ${sarFormatted}`);
  assert.ok(sarFormatted.includes('150.75') || sarFormatted.includes('150٫75'), `SAR must contain 150.75: ${sarFormatted}`);

  const kwdFormatted = formatCurrency(1.25, 'KWD', 'ar-KW');
  assert.ok(!/[٠-٩۰-۹]/.test(kwdFormatted), `KWD currency must not contain Arabic/Persian digits: ${kwdFormatted}`);
  assert.ok(kwdFormatted.includes('1.250') || kwdFormatted.includes('1٫250'), `KWD must contain 1.250: ${kwdFormatted}`);

  // 2B: Number formatting under Arabic locale
  const numFormatted = formatNumber(12345.67, 'ar-SA');
  assert.ok(!/[٠-٩۰-۹]/.test(numFormatted), `Number must not contain Arabic/Persian digits: ${numFormatted}`);

  // 2C: Date formatting under Arabic locale
  const dateFormatted = formatDateForTenant(new Date('2026-09-30T10:00:00Z'), 'ar-SA');
  assert.ok(!/[٠-٩۰-۹]/.test(dateFormatted), `Date must not contain Arabic/Persian digits: ${dateFormatted}`);
  assert.ok(dateFormatted.includes('2026'), `Date must contain Western year 2026: ${dateFormatted}`);

  // 2D: Canonicalize localized amount from Arabic digits
  const parsedAmt = canonicalizeLocalizedAmount('١٥٠٫٧٥', 'SAR');
  assert.equal(parsedAmt, '150.75', 'canonicalizeLocalizedAmount must parse Eastern Arabic amounts');

  // 3. Frontend Keystroke Sanitizer
  const saudiFormat = { locale: 'ar-SA', decimalSeparator: '.', groupSeparator: ',', currencyFractionDigits: 2 };
  assert.equal(sanitizeAmountKeystrokes('١٢', saudiFormat), '12');
  assert.equal(sanitizeAmountKeystrokes('١٢.٥', saudiFormat), '12.5');
  assert.equal(sanitizeAmountKeystrokes('٥٠٠', saudiFormat), '500');
  assert.equal(sanitizeAmountKeystrokes('۱۲۵', saudiFormat), '125');

  // 4. Branded Receipt & KOT requests
  const arabicOrder = {
    id: 99,
    order_number: 'ط-١٢٣',
    created_at: '٢٠٢٦-٠٩-٣٠ ١٠:١٥:٠٠',
    total: 45.00,
    items: [
      {
        product_name: 'قهوة عربي',
        quantity: 1,
        unit_price: 15.00,
        total: 15.00,
      },
      {
        product_name: 'تمر خلاص فاخر',
        quantity: 2,
        unit_price: 15.00,
        total: 30.00,
      },
    ],
  };

  const arabicBill = {
    id: 199,
    bill_number: 'فاتورة-٩٩',
    subtotal: 45.00,
    total: 45.00,
    paid_amount: 45.00,
    balance: 0.00,
  };

  const arabicBusiness = {
    name: 'مقهى النخيل',
    phone: '٠٥٠١٢٣٤٥٦٧',
    taxRegistrationNumber: '٣١٠١٢٣٤٥٦٧٠٠٠٠٣',
    currency_symbol: 'ر.س',
    language: 'ar',
  };

  const receiptReq = buildBrandedReceiptRequest({
    order: arabicOrder,
    bill: arabicBill,
    business: arabicBusiness,
    widthDots: DEFAULT_RASTER_WIDTH_80MM,
  });

  // Verify all request fields have Western digits
  assert.equal(receiptReq.meta.orderNumber, 'ط-123');
  assert.equal(receiptReq.meta.invoiceNumber, 'فاتورة-99');
  assert.equal(receiptReq.header.phone, '0501234567');
  assert.equal(receiptReq.header.taxId, '310123456700003');
  assert.ok(receiptReq.meta.timestamp?.includes('2026-09-30 10:15:00'));

  // Ensure items have Western quantities and prices
  assert.equal(receiptReq.items[0].price, 15.00);
  assert.equal(receiptReq.items[1].price, 30.00);
  assert.equal(receiptReq.items[1].unitPrice, 15.00);

  // Render receipt to verify canvas engine converts any residual non-Western digits
  const renderOutput = renderBrandedReceiptSoftware(receiptReq);
  assert.equal(renderOutput.ok, true, 'Receipt with Arabic input must render successfully');

  // Verify KOT with Arabic input
  const kotReq = buildBrandedKotRequest({
    order: arabicOrder,
    items: arabicOrder.items,
    stationName: 'قسم المشروبات',
    business: arabicBusiness,
    style: {
      target: 'kot',
      renderMode: 'branded_raster',
      operational: { showPrices: true, showTotals: true, headerCompact: false, prominentNotes: false },
      typography: { fontFamily: 'almarai', storeNameSize: 'medium', headerMetaSize: 'small', itemNamesSize: 'medium', itemModifiersSize: 'small', itemNotesSize: 'small', totalsSize: 'medium', footerSize: 'small' },
      frame: { borderStyle: 'solid', borderThickness: 1, borderRadius: 0, borderPadding: 4, dividerStyle: 'dashed' },
      logo: { showLogo: false, maxWidthPercent: 50, spacingBottomDots: 8, alignment: 'center' },
      direction: 'rtl',
      contrast: { densityPreset: 'dark', threshold: 140, inkGain: 0, ditheringMode: 'threshold' },
    },
  });

  assert.equal(kotReq.meta.orderNumber, 'ط-123');
  assert.ok(kotReq.meta.timestamp?.includes('2026-09-30 10:15:00'));
  assert.ok(!/[٠-٩۰-۹]/.test(kotReq.totals[0].value), 'KOT totals must not contain Eastern digits');

  console.log('✓ All Western Digits Enforcement tests passed successfully!');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
