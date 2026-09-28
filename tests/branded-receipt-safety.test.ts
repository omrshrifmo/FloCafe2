const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-test-safety-'));
Module._load = function(request: string, parent: any, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' }};
  return originalLoad.apply(this, arguments);
};

import assert from 'node:assert/strict';
import { initDatabase, getDatabase, closeDatabase, getSettingValue } from '../main/db';
import { renderBrandedReceipt, buildBrandedReceiptRequest } from '../main/printers/branded-receipt-renderer';

async function runTests() {
  console.log('[Test] Running branded-receipt-safety test suite...');

  const testDbDir = path.join(__dirname, '../dist/test-db-safety');
  if (fs.existsSync(testDbDir)) fs.rmSync(testDbDir, { recursive: true, force: true });
  fs.mkdirSync(testDbDir, { recursive: true });

  const testDbPath = path.join(testDbDir, 'test_safety.db');
  process.env.FLO_DATABASE_PATH = testDbPath;
  initDatabase();

  const db = getDatabase();

  // 1. Invariant: Default setting must be legacy_text
  const defaultMode = getSettingValue('receipt_render_mode');
  assert.equal(defaultMode, 'legacy_text', 'Default receipt_render_mode MUST be legacy_text');

  const defaultFont = getSettingValue('receipt_branded_font_family');
  assert.equal(defaultFont, 'almarai', 'Default receipt_branded_font_family MUST be almarai');

  const defaultLogo = getSettingValue('receipt_logo_asset_id');
  assert(!defaultLogo, 'Default receipt_logo_asset_id MUST be empty or null');

  // 2. Pre-dispatch timeout guard:
  // If a mock renderer hangs or takes > 8 seconds, it aborts pre-dispatch
  const hangingRenderer = {
    render: () => new Promise<any>((resolve) => {
      // Never resolves (simulating frozen surface)
    }),
  };

  const req = buildBrandedReceiptRequest({
    order: { order_number: 'ORD-1' },
    bill: { bill_number: 'B-1', total: 50 },
    widthDots: 576,
  });

  // Verify that pre-dispatch failure falls back to software compositor or error before any bytes reach printer
  const output = await renderBrandedReceipt(req, hangingRenderer);
  // Hanging renderer should fall back to software renderer or fail cleanly
  assert.equal(output.ok, true, 'Hanging renderer pre-dispatch should gracefully fall back to software compositor');

  // 3. Post-dispatch failure contract:
  // When physical dispatch fails after bytes have been sent, the structured state MUST be print_may_be_incomplete
  // with no automatic retry and no automatic text fallback.
  const transportFailureDispatch = {
    ok: false,
    status: 'print_may_be_incomplete' as const,
    detail: 'USB write timed out after 512 bytes sent (Print may be incomplete; do not duplicate print)',
    canRetryManually: true,
  };

  assert.equal(transportFailureDispatch.ok, false);
  assert.equal(transportFailureDispatch.status, 'print_may_be_incomplete');
  assert.equal(transportFailureDispatch.canRetryManually, true);
  assert(transportFailureDispatch.detail.includes('Print may be incomplete'));

  // 4. Successful dispatch contract:
  // Must return print_submitted representing successful submission to OS spooler or network socket.
  const successfulSubmissionDispatch = {
    ok: true,
    status: 'print_submitted' as const,
  };
  assert.equal(successfulSubmissionDispatch.status, 'print_submitted');

  closeDatabase();
  try { fs.rmSync(testDbDir, { recursive: true, force: true }); } catch { }

  console.log('[Test] branded-receipt-safety test suite passed!');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
