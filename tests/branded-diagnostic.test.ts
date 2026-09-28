const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-test-diagnostic-'));
Module._load = function(request: string, parent: any, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' }};
  return originalLoad.apply(this, arguments);
};

import assert from 'node:assert/strict';
import { initDatabase, getDatabase, closeDatabase, getSettingValue, now } from '../main/db';
import {
  buildBrandedDiagnosticRequest,
  renderBrandedReceipt,
  computeCapabilityDerivedLogoDimensions,
  computeBrandedGeometry,
  DEFAULT_RASTER_WIDTH_80MM,
  DEFAULT_RASTER_WIDTH_58MM,
  MIN_READABLE_LOGO_DIMENSION_DOTS,
} from '../main/printers/branded-receipt-renderer';
import { printBrandedDiagnosticDetailed, printReceiptDetailed, printKOTDetailed } from '../main/printers/thermal';

async function runTests() {
  console.log('[Test] Running branded-diagnostic test suite...');

  const testDbDir = path.join(__dirname, '../dist/test-db-diag');
  if (fs.existsSync(testDbDir)) fs.rmSync(testDbDir, { recursive: true, force: true });
  fs.mkdirSync(testDbDir, { recursive: true });

  const testDbPath = path.join(testDbDir, 'test_diag.db');
  process.env.FLO_DATABASE_PATH = testDbPath;
  initDatabase();

  const db = getDatabase();

  // 1. Diagnostic document construction
  const diagReq80 = buildBrandedDiagnosticRequest({
    widthDots: DEFAULT_RASTER_WIDTH_80MM,
    fontFamily: 'cairo',
    printer: { name: 'Xprinter XP-K200L', paper_width: '80mm' },
  });

  assert.equal(diagReq80.kind, 'branded-receipt');
  assert.equal(diagReq80.widthDots, 576);
  assert.equal(diagReq80.fontFamily, 'cairo');
  assert(diagReq80.header.banner?.includes('FLOCAFE PRINTER DIAGNOSTIC — NOT A SALES RECEIPT'), 'Must include English diagnostic banner');
  assert(diagReq80.header.banner?.includes('اختبار طابعة FloCafe — ليست فاتورة بيع'), 'Must include Arabic diagnostic banner');
  assert(diagReq80.footer.footerNote?.includes('NOT A SALES RECEIPT'), 'Footer must state not a sales receipt');
  assert(diagReq80.meta.orderNumber === 'DIAG-RASTER-PROBE', 'Meta order number must clearly indicate diagnostic probe');
  assert(diagReq80.items.length >= 5, 'Must have at least 5 sample items to exercise table formatting');

  // Verify representative RTL table: item names include Arabic, English, and mixed BiDi
  const hasArabicItem = diagReq80.items.some(i => /[\u0600-\u06FF]/.test(i.name));
  const hasEnglishItem = diagReq80.items.some(i => /[a-zA-Z]/.test(i.name));
  assert(hasArabicItem && hasEnglishItem, 'Items table must include both Arabic and English text');

  // 2. Branded raster rendering & multi-band verification
  const renderResult = await renderBrandedReceipt(diagReq80);
  assert.equal(renderResult.ok, true, 'Diagnostic request should render successfully');
  if (renderResult.ok) {
    assert(renderResult.dimensions.bandCount >= 3, `Expected at least 3 raster bands for multi-band exercise, got ${renderResult.dimensions.bandCount}`);
    assert(renderResult.dimensions.heightDots >= 600, 'Expected height to exceed 600 dots');
    assert(renderResult.previewDataUrl?.startsWith('data:image/png;base64,'), 'Preview must be valid PNG data URL');

    // Verify raster bytes contain ESC/POS GS v 0 raster header (1D 76 30 00)
    const bytes = renderResult.rasterBytes;
    assert(bytes.length > 500, 'Raster bytes must be non-empty');
    let foundGsV0 = false;
    for (let i = 0; i < bytes.length - 4; i++) {
      if (bytes[i] === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30 && bytes[i + 3] === 0x00) {
        foundGsV0 = true;
        break;
      }
    }
    assert(foundGsV0, 'Rendered payload must contain standard ESC/POS GS v 0 raster commands');

    // Verify non-financial invariant: Drawer pulse command (1B 70 ...) MUST NOT be present in diagnostic raster
    let hasPulse = false;
    for (let i = 0; i < bytes.length - 2; i++) {
      if (bytes[i] === 0x1b && bytes[i + 1] === 0x70) {
        hasPulse = true;
        break;
      }
    }
    assert.equal(hasPulse, false, 'Diagnostic raster must NEVER contain cash drawer pulse command (1B 70)');
  }

  // 3. Non-financial database isolation guarantee
  // Diagnostic printing must NEVER create or alter orders, bills, payments, inventory, or cash sessions
  const getCounts = () => ({
    orders: db.prepare('SELECT COUNT(*) as c FROM orders').get().c,
    bills: db.prepare('SELECT COUNT(*) as c FROM bills').get().c,
    orderItems: db.prepare('SELECT COUNT(*) as c FROM order_items').get().c,
    inventoryMovements: db.prepare('SELECT COUNT(*) as c FROM inventory_movements').get().c,
    cashSessions: db.prepare('SELECT COUNT(*) as c FROM cash_sessions').get().c,
    auditLogs: db.prepare('SELECT COUNT(*) as c FROM order_audit_log').get().c,
  });

  const countsBefore = getCounts();

  // Create a dummy network printer in DB for dispatch testing
  db.prepare(`
    INSERT INTO printers (id, name, connection_type, ip_address, port, paper_width, is_default, cash_drawer_pulse_enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('test-printer-diag', 'Diagnostic Test Printer', 'network', '127.0.0.1', 9999, '80mm', 1, 1, now(), now());

  // Call printBrandedDiagnosticDetailed
  const diagPrintResult = await printBrandedDiagnosticDetailed('test-printer-diag');
  // Network connection to 127.0.0.1:9999 will fail gracefully with transport error,
  // returning status print_may_be_incomplete or failed without throwing.
  assert(diagPrintResult !== null);
  assert(diagPrintResult.correlationId !== undefined);

  // Assert counts after print are 100% identical
  const countsAfter = getCounts();
  assert.deepEqual(countsBefore, countsAfter, 'Diagnostic print MUST NOT mutate orders, bills, payments, inventory, or cash sessions');

  // 4. No diagnostic print possible through kitchen-ticket path
  // printKOT requires an actual order with items; passing an invalid or non-existent order fails safely
  const kotResult = await printKOTDetailed({ id: 'non-existent' }, [], 'Kitchen');
  assert.equal(kotResult.ok, false, 'KOT print without valid items must fail');

  // 5. Default legacy receipt behavior remains unchanged
  const defaultRenderMode = getSettingValue('receipt_render_mode');
  assert.equal(defaultRenderMode, 'legacy_text', 'Default receipt_render_mode MUST be legacy_text');

  // 6. Capability-derived logo formula verification
  const geom80 = computeBrandedGeometry({ widthDots: 576, paddingDots: 16 });
  const geom58 = computeBrandedGeometry({ widthDots: 384, paddingDots: 8 });

  // Oversized 800x600 logo:
  const oversizedLogo = { width: 800, height: 600 };
  const dims80 = computeCapabilityDerivedLogoDimensions(oversizedLogo, geom80);
  assert.equal(dims80.maxAllowedWidth, 403, '80mm maxAllowedWidth must be min(544, 403) = 403');
  assert.equal(dims80.maxAllowedHeight, 218, '80mm maxAllowedHeight must be 544 * 0.40 = 218');
  assert(dims80.width <= dims80.maxAllowedWidth, 'Scaled width must not exceed maxAllowedWidth');
  assert(dims80.height <= dims80.maxAllowedHeight, 'Scaled height must not exceed maxAllowedHeight');

  const dims58 = computeCapabilityDerivedLogoDimensions(oversizedLogo, geom58);
  assert.equal(dims58.maxAllowedWidth, 269, '58mm maxAllowedWidth must be min(368, 269) = 269');
  assert.equal(dims58.maxAllowedHeight, 147, '58mm maxAllowedHeight must be 368 * 0.40 = 147');
  assert(dims58.width <= dims58.maxAllowedWidth, '58mm scaled width must not exceed 58mm maxAllowedWidth');
  assert(dims58.height <= dims58.maxAllowedHeight, '58mm scaled height must not exceed 58mm maxAllowedHeight');
  assert(dims58.width < dims80.width, '58mm logo width must be strictly narrower than 80mm');

  // Small logo (e.g. 50x30) preserves dimensions
  const smallLogo = { width: 50, height: 30 };
  const smallDims = computeCapabilityDerivedLogoDimensions(smallLogo, geom80);
  assert.equal(smallDims.width, 50);
  assert.equal(smallDims.height, 30);
  assert.equal(smallDims.scale, 1);

  // Tiny logo (e.g. 5x5) is kept above MIN_READABLE_LOGO_DIMENSION_DOTS floor
  const tinyLogo = { width: 5, height: 5 };
  const tinyDims = computeCapabilityDerivedLogoDimensions(tinyLogo, geom80);
  assert.equal(tinyDims.width, MIN_READABLE_LOGO_DIMENSION_DOTS);
  assert.equal(tinyDims.height, MIN_READABLE_LOGO_DIMENSION_DOTS);

  closeDatabase();
  console.log('[Test] branded-diagnostic test suite passed!');
}

runTests().catch((err) => {
  console.error('[Test] branded-diagnostic test suite FAILED:', err);
  process.exit(1);
});
