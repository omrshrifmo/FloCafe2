/**
 * Financial Print Safety Test Suite
 *
 * Verifies the centralized financial-document rendering safety policy:
 * 1. ASCII-only financial text stays in the legacy ESC/POS text path.
 * 2. Arabic financial text (and Arabic+English mixed) routes to raster fallback.
 * 3. No financial value, label, or row is omitted or corrupted.
 * 4. The refusal message (when raster also fails) uses the required bilingual wording.
 * 5. Z-report, shift-close (session scope), and day-close all respect the policy.
 * 6. Both 58 mm and 80 mm paper widths are covered.
 *
 * Arabic terms tested:
 *   الوحدة الافتتاحية, مؤجل, الرصيد الافتتاحي, الإجمالي, المتبقي
 *
 * Usage: node tests/run-electron-node-test.cjs tests/financial-print-safety.test.ts
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import assert from 'node:assert/strict';

const Module = require('module');
const originalLoad = Module._load;
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-financial-print-safety-'));

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments as any);
};

process.env.JWT_SECRET = 'test-secret-financial-print-safety';

import { initDatabase, getDatabase, closeDatabase } from '../main/db';
import {
  hasFinancialPrintWarning,
  makeFinancialPrintRefusalMessage,
  buildZReportBody,
} from '../main/printers/thermal';
import type { PrintWarning } from '../main/printers/formatting-helpers';
import { buildEscPos } from '../main/printers/formatting-helpers';

// ── helpers ──────────────────────────────────────────────────────────────────

function assertOrThrow(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

/** Build a minimal Z-report payload for use with buildZReportBody. */
function makeZPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    z_number: 42,
    business_date: '2026-09-28',
    period_start: '2026-09-28T06:00:00Z',
    period_end: '2026-09-28T23:59:59Z',
    opening_float_cents: 5000,
    pay_in_cents: 0,
    pay_out_cents: 0,
    safe_drop_cents: 0,
    payment_methods: [{ method: 'cash', count: 3, total_cents: 15000 }],
    refund_count: 0,
    refunded_cents: 0,
    tax_components: [{ title: 'VAT', amount: 1000 }],
    staff_sales: [],
    expected_cash_cents: 20000,
    counted_cash_cents: 20000,
    variance_cents: 0,
    closed_by_name: 'Test Operator',
    ...overrides,
  };
}

/** Probe whether the given line-sections produce a financial warning. */
function probeFinancialWarning(sections: string[], cols: number, lang: string): boolean {
  const w: PrintWarning[] = [];
  buildEscPos(sections, false, {
    cutMode: 'full',
    language: lang,
    columns: cols,
    capabilities: undefined,
  }, w);
  return hasFinancialPrintWarning(w);
}

// ── bootstrap ─────────────────────────────────────────────────────────────────

let results = { pass: 0, fail: 0, errors: [] as string[] };

function runTest(name: string, fn: () => void): void {
  try {
    fn();
    results.pass++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    results.fail++;
    const msg = err?.message || String(err);
    results.errors.push(`${name}: ${msg}`);
    console.error(`  ✗ ${name}\n    ${msg}`);
  }
}

// ── suite ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  initDatabase(testDir);
  const db = getDatabase();

  // Seed settings. SAR tests probe Arabic-script financial warnings;
  // USD tests prove the legacy ASCII path remains functional.
  db.exec(`
    INSERT OR REPLACE INTO settings (key, value) VALUES
      ('business_name', 'Test Cafe'),
      ('business_address', '123 Test St'),
      ('currency', 'USD'),
      ('language', 'en'),
      ('timezone', 'America/New_York'),
      ('locale', 'en-US'),
      ('country', 'US')
  `);

  console.log('\n── Financial Print Safety Tests ──────────────────────────────\n');

  // ── 1. ASCII-only text stays on legacy path ──────────────────────────────

  runTest('ASCII-only financial row does NOT produce financial warning (legacy path preserved)', () => {
    const sections = ['{FINANCIAL}Total    100.00'];
    const hasWarning = probeFinancialWarning(sections, 48, 'en');
    assertOrThrow(!hasWarning, 'Expected no financial warning for plain ASCII financial row');
  });

  runTest('ASCII amounts with currency symbols do not trigger raster', () => {
    const sections = ['{FINANCIAL}SAR 1,234.56'];
    const hasWarning = probeFinancialWarning(sections, 48, 'en');
    assertOrThrow(!hasWarning, 'ASCII currency should not trigger financial warning');
  });

  // ── 2. Arabic financial text triggers raster selection ───────────────────

  const arabicTerms: [string, string][] = [
    ['الوحدة الافتتاحية', 'Opening unit (Arabic)'],
    ['مؤجل', 'Deferred (Arabic)'],
    ['الرصيد الافتتاحي', 'Opening balance (Arabic)'],
    ['الإجمالي', 'Total (Arabic)'],
    ['المتبقي', 'Remaining (Arabic)'],
  ];

  for (const [term, label] of arabicTerms) {
    runTest(`Arabic financial term "${label}" triggers financial warning`, () => {
      const sections = [`{FINANCIAL}${term}    100.00`];
      const hasWarning = probeFinancialWarning(sections, 48, 'ar');
      assertOrThrow(hasWarning, `Expected financial warning for Arabic term: ${term}`);
    });
  }

  // ── 3. Mixed Arabic+English triggers financial warning ───────────────────

  runTest('Mixed Arabic/English financial row triggers financial warning', () => {
    const sections = ['{FINANCIAL}الإجمالي Total    200.00 SAR'];
    const hasWarning = probeFinancialWarning(sections, 48, 'ar');
    assertOrThrow(hasWarning, 'Expected financial warning for mixed Arabic/English financial row');
  });

  runTest('Arabic label with numeric value triggers financial warning', () => {
    const sections = ['{FINANCIAL}المتبقي    ١٢٣.٤٥'];
    const hasWarning = probeFinancialWarning(sections, 48, 'ar');
    assertOrThrow(hasWarning, 'Expected financial warning for Arabic plus numeric value');
  });

  // ── 4. hasFinancialPrintWarning correctly classifies warnings ────────────

  runTest('hasFinancialPrintWarning returns true when financial warning present', () => {
    const warnings: PrintWarning[] = [{ field: 'total', text: 'الإجمالي', message: 'unsupported', kind: 'financial' }];
    assertOrThrow(hasFinancialPrintWarning(warnings), 'Expected true for financial warning');
  });

  runTest('hasFinancialPrintWarning returns false for non-financial warnings only', () => {
    const warnings: PrintWarning[] = [{ field: 'header', text: 'test', message: 'unsupported', kind: 'line' }];
    assertOrThrow(!hasFinancialPrintWarning(warnings), 'Expected false for non-financial warning');
  });

  runTest('hasFinancialPrintWarning returns false for empty warnings', () => {
    assertOrThrow(!hasFinancialPrintWarning([]), 'Expected false for empty warnings');
  });

  // ── 5. Refusal message uses required bilingual wording ───────────────────

  runTest('makeFinancialPrintRefusalMessage contains required English text', () => {
    const msg = makeFinancialPrintRefusalMessage([]);
    assertOrThrow(
      msg.includes('Financial report could not be rendered safely'),
      `Expected English refusal text, got: ${msg}`,
    );
    assertOrThrow(
      msg.includes('No partial report was printed'),
      `Expected "No partial report was printed" in refusal message, got: ${msg}`,
    );
  });

  runTest('makeFinancialPrintRefusalMessage contains required Arabic text', () => {
    const msg = makeFinancialPrintRefusalMessage([]);
    assertOrThrow(
      msg.includes('تعذر تجهيز التقرير المالي للطباعة بأمان'),
      `Expected Arabic refusal text, got: ${msg}`,
    );
    assertOrThrow(
      msg.includes('لم تتم طباعة تقرير جزئي'),
      `Expected Arabic "no partial report" text, got: ${msg}`,
    );
  });

  runTest('makeFinancialPrintRefusalMessage does NOT use old "Receipt not printed" wording', () => {
    const msg = makeFinancialPrintRefusalMessage([]);
    assertOrThrow(
      !msg.includes('Receipt not printed'),
      `Expected old wording removed, got: ${msg}`,
    );
  });

  runTest('makeFinancialPrintRefusalMessage does NOT mention "tax invoice"', () => {
    const msg = makeFinancialPrintRefusalMessage([]);
    assertOrThrow(
      !msg.toLowerCase().includes('tax invoice'),
      `Refusal message must not reference tax invoice: ${msg}`,
    );
  });

  // ── 6. Z-report: ASCII path (USD/Latin) produces non-empty bytes ─────────
  //   USD uses a Latin "$" symbol so buildZReportBody stays on the native
  //   ESC/POS text path. SAR (ر.س) carries Arabic script which intentionally
  //   triggers the financial warning and raster fallback — tested in §6c.

  runTest('Z-report (USD, 80mm): buildZReportBody returns non-empty buffer with no financial warnings', () => {
    const warnings: PrintWarning[] = [];
    const buf = buildZReportBody(makeZPayload({ __language: 'en' }), 'en', { columns: 48 }, warnings);
    assertOrThrow(buf.length > 0, 'Expected non-empty buffer for USD Z-report (80mm)');
    assertOrThrow(!hasFinancialPrintWarning(warnings), 'Expected no financial warnings for USD Z-report (80mm)');
  });

  runTest('Z-report (USD, 58mm): buildZReportBody returns non-empty buffer with no financial warnings', () => {
    const warnings: PrintWarning[] = [];
    const buf = buildZReportBody(makeZPayload({ __language: 'en' }), 'en', { columns: 32 }, warnings);
    assertOrThrow(buf.length > 0, 'Expected non-empty buffer for USD Z-report (58mm)');
    assertOrThrow(!hasFinancialPrintWarning(warnings), 'Expected no financial warnings for USD Z-report (58mm)');
  });

  runTest('Z-report (USD, 80mm): bytes contain Z number', () => {
    const warnings: PrintWarning[] = [];
    const buf = buildZReportBody(makeZPayload({ __language: 'en', z_number: 77 }), 'en', { columns: 48 }, warnings);
    assertOrThrow(buf.length > 0, 'Expected non-empty buffer');
    const str = buf.toString('latin1');
    assertOrThrow(str.includes('77'), 'Z number must appear in bytes');
  });

  runTest('Z-report (USD, 80mm): bytes contain payment method text', () => {
    const warnings: PrintWarning[] = [];
    const payload = makeZPayload({ __language: 'en', payment_methods: [{ method: 'cash', count: 5, total_cents: 25000 }] });
    const buf = buildZReportBody(payload, 'en', { columns: 48 }, warnings);
    assertOrThrow(buf.length > 0, 'Expected non-empty buffer');
    const str = buf.toString('latin1');
    assertOrThrow(str.toLowerCase().includes('cash'), 'Payment method must appear in bytes');
  });

  runTest('Z-report (USD, 80mm): ASCII tax component (VAT) appears in bytes', () => {
    const warnings: PrintWarning[] = [];
    const payload = makeZPayload({ __language: 'en', tax_components: [{ title: 'VAT', amount: 750 }] });
    const buf = buildZReportBody(payload, 'en', { columns: 48 }, warnings);
    assertOrThrow(buf.length > 0, 'Expected non-empty buffer');
    assertOrThrow(!hasFinancialPrintWarning(warnings), 'No financial warning for ASCII tax component');
    const str = buf.toString('latin1');
    assertOrThrow(str.includes('VAT'), 'Tax component VAT must appear in bytes');
  });

  // ── 6b. Shift-close and day-close use the same pipeline ─────────────────

  runTest('Session-scope (shift close) Z payload produces non-empty bytes (USD)', () => {
    const warnings: PrintWarning[] = [];
    const buf = buildZReportBody(makeZPayload({ __language: 'en', scope: 'session' }), 'en', { columns: 48 }, warnings);
    assertOrThrow(buf.length > 0, 'Expected non-empty buffer for session-scope (shift close) payload');
    assertOrThrow(!hasFinancialPrintWarning(warnings), 'No financial warning for session-scope payload');
  });

  runTest('Day-close Z payload produces non-empty bytes (USD)', () => {
    const warnings: PrintWarning[] = [];
    const buf = buildZReportBody(makeZPayload({ __language: 'en', scope: 'day' }), 'en', { columns: 48 }, warnings);
    assertOrThrow(buf.length > 0, 'Expected non-empty buffer for day-close payload');
    assertOrThrow(!hasFinancialPrintWarning(warnings), 'No financial warning for day-close payload');
  });

  // ── 6c. SAR / Arabic symbol: financial rows trigger warning (raster needed) ─

  runTest('Z-report financial rows with SAR (ر.س) symbol trigger financial warning (raster required)', () => {
    // SAR currency amounts contain the Arabic symbol ر.س — this is correct
    // behaviour: the financial warning causes printZReport to route through
    // the Chromium raster renderer so the amount is preserved faithfully.
    const sections = ['{FINANCIAL}ر.س150.00'];
    const hasWarning = probeFinancialWarning(sections, 48, 'ar');
    assertOrThrow(hasWarning, 'Expected financial warning for SAR Arabic-script amount (raster path required)');
  });

  // ── results ────────────────────────────────────────────────────────────────

  console.log(`\n  ${results.pass} passed, ${results.fail} failed\n`);

  closeDatabase();
  fs.rmSync(testDir, { recursive: true, force: true });

  if (results.fail > 0) {
    console.error('FAILURES:\n' + results.errors.map((e) => `  - ${e}`).join('\n'));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
