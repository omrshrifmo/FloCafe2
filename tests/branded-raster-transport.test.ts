const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-test-raster-transport-'));
Module._load = function(request: string, parent: any, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' }};
  return originalLoad.apply(this, arguments);
};

import assert from 'node:assert/strict';
import { initDatabase, getDatabase, closeDatabase, now } from '../main/db';
import {
  encodeEscStar24Band,
  encodeWholeReceiptRaster,
  resolveRasterTransport,
  type RasterBand,
  type RasterSemanticUnit,
  type MonochromeBitmap,
  type RasterImageTransport,
} from '../shared/print/raster';
import { type ThermalPrinterCapabilities } from '../main/printers/capabilities';
import {
  buildBrandedDiagnosticRequest,
  buildBrandedReceiptRequest,
  buildBrandedKotRequest,
  buildBrandedReportRequest,
  renderBrandedReceipt,
  DEFAULT_RASTER_WIDTH_80MM,
  DEFAULT_RASTER_WIDTH_58MM,
} from '../main/printers/branded-receipt-renderer';
import { printBrandedDiagnosticDetailed, printZReport } from '../main/printers/thermal';
import { buildEscPos } from '../main/printers/formatting-helpers';

/**
 * Strict parser that traverses a raw ESC/POS byte payload, completely skipping:
 * - ESC * image slices (0x1B 0x2A <m> <nL> <nH> [slice data] \n)
 * - GS v 0 raster blocks (0x1D 0x76 0x30 <m> <xL> <xH> <yL> <yH> [bitmap data])
 * - Standard ESC/POS printer control commands (ESC @, ESC 3, ESC 2, ESC a, ESC d, ESC t, ESC !, ESC E, ESC p, GS V)
 * Any remaining non-image bytes outside image slices represent leaked raw text.
 */
export function extractNonImageText(payload: Buffer): string {
  let text = '';
  let i = 0;
  while (i < payload.length) {
    // ESC * <m> <nL> <nH>
    if (payload[i] === 0x1b && payload[i + 1] === 0x2a) {
      const m = payload[i + 2];
      const nL = payload[i + 3];
      const nH = payload[i + 4];
      const cols = nL + (nH << 8);
      const bytesPerCol = (m === 32 || m === 33) ? 3 : 1;
      const dataLen = cols * bytesPerCol;
      i += 5 + dataLen;
      continue;
    }
    // GS v 0 <m> <xL> <xH> <yL> <yH>
    if (payload[i] === 0x1d && payload[i + 1] === 0x76 && payload[i + 2] === 0x30) {
      const xL = payload[i + 4];
      const xH = payload[i + 5];
      const yL = payload[i + 6];
      const yH = payload[i + 7];
      const widthBytes = xL + (xH << 8);
      const heightDots = yL + (yH << 8);
      const dataLen = widthBytes * heightDots;
      i += 8 + dataLen;
      continue;
    }
    // ESC control sequences
    if (payload[i] === 0x1b) {
      const cmd = payload[i + 1];
      if (cmd === 0x40) { i += 2; continue; } // ESC @ (init)
      if (cmd === 0x32) { i += 2; continue; } // ESC 2 (reset spacing)
      if (cmd === 0x33 || cmd === 0x61 || cmd === 0x64 || cmd === 0x74 || cmd === 0x21 || cmd === 0x45) {
        i += 3; continue;
      }
      if (cmd === 0x70) { i += 5; continue; } // ESC p m t1 t2 (drawer pulse)
      i += 2; continue;
    }
    // GS control sequences
    if (payload[i] === 0x1d) {
      const cmd = payload[i + 1];
      if (cmd === 0x56) {
        const mode = payload[i + 2];
        i += (mode === 0x41 || mode === 0x42) ? 4 : 3;
        continue;
      }
      i += 2; continue;
    }
    // Line feeds, carriage returns, nulls, spaces
    if (payload[i] === 0x0a || payload[i] === 0x0d || payload[i] === 0x00 || payload[i] === 0x20) {
      i++;
      continue;
    }
    // Any remaining bytes represent non-image text!
    text += String.fromCharCode(payload[i]);
    i++;
  }
  return text.trim();
}

async function runTests() {
  console.log('[Test] Running branded raster transport test suite...');

  const testDbDir = path.join(__dirname, '../dist/test-db-raster-transport');
  if (fs.existsSync(testDbDir)) fs.rmSync(testDbDir, { recursive: true, force: true });
  fs.mkdirSync(testDbDir, { recursive: true });

  const testDbPath = path.join(testDbDir, 'test_transport.db');
  process.env.FLO_DATABASE_PATH = testDbPath;
  initDatabase();
  const db = getDatabase();

  // =========================================================================
  // TEST 1: GS v 0 encoder remains byte-compatible with existing behavior
  // =========================================================================
  console.log('Test 1: GS v 0 encoder byte parity & stability...');
  const band16: RasterBand = {
    widthDots: 16,
    heightDots: 24,
    pixels: new Uint8Array(16 * 24),
  };
  for (let i = 0; i < band16.pixels.length; i++) {
    band16.pixels[i] = (i % 2 === 0) ? 1 : 0;
  }
  const unit16: RasterSemanticUnit = {
    unitId: 'test-16',
    financial: false,
    complete: true,
    bands: [band16],
  };
  const caps16: ThermalPrinterCapabilities = {
    encoding: { codePages: ['ascii'], preferredCodePage: 'ascii' },
    shaping: { arabic: true },
    representability: { scripts: ['ascii'] },
    transliteration: { enabled: false },
    warnings: { unsupportedText: 'skip', financialText: 'refuse', orderTypeFallback: 'ascii' },
    raster: {
      enabled: true,
      widthDots: 16,
      maxBandHeight: 200,
      modes: ['whole-receipt'],
    },
  };

  const gsv0Bytes = encodeWholeReceiptRaster(unit16, caps16, 'full', 'gs_v_0');
  assert(gsv0Bytes.length > 0, 'GS v 0 bytes must be non-empty');
  
  // Verify GS v 0 header: 0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH
  let gsv0HeaderIdx = -1;
  for (let i = 0; i < gsv0Bytes.length - 8; i++) {
    if (gsv0Bytes[i] === 0x1d && gsv0Bytes[i + 1] === 0x76 && gsv0Bytes[i + 2] === 0x30 && gsv0Bytes[i + 3] === 0x00) {
      gsv0HeaderIdx = i;
      break;
    }
  }
  assert(gsv0HeaderIdx !== -1, 'Must contain GS v 0 header [1D 76 30 00]');
  assert.equal(gsv0Bytes[gsv0HeaderIdx + 4], 2, 'xL must equal 2 (16 dots / 8)');
  assert.equal(gsv0Bytes[gsv0HeaderIdx + 5], 0, 'xH must equal 0');
  assert.equal(gsv0Bytes[gsv0HeaderIdx + 6], 24, 'yL must equal 24');
  assert.equal(gsv0Bytes[gsv0HeaderIdx + 7], 0, 'yH must equal 0');

  // =========================================================================
  // TEST 2: ESC * 24-dot encoder
  // =========================================================================
  console.log('Test 2: ESC * 24-dot compatibility encoder verification...');
  // Receives the same bitmap, preserves width (16 dots -> nL=16, nH=0)
  const escStarBytes = encodeWholeReceiptRaster(unit16, caps16, 'full', 'esc_star_24');
  assert(escStarBytes.length > 0, 'ESC * bytes must be non-empty');

  // Direct test of encodeEscStar24Band
  const bandEncoded = encodeEscStar24Band(band16);
  assert(bandEncoded.length > 0, 'Band encoding must succeed');

  // Must contain ESC a 0 (0x1B, 0x61, 0x00) - left align
  let foundAlign = false;
  for (let i = 0; i < escStarBytes.length - 3; i++) {
    if (escStarBytes[i] === 0x1b && escStarBytes[i + 1] === 0x61 && escStarBytes[i + 2] === 0x00) {
      foundAlign = true;
      break;
    }
  }
  assert(foundAlign, 'ESC * transport must set left alignment (ESC a 0)');

  // Must contain ESC * 33 (0x1B, 0x2A, 33)
  let escStarHeaderIdx = -1;
  for (let i = 0; i < escStarBytes.length - 5; i++) {
    if (escStarBytes[i] === 0x1b && escStarBytes[i + 1] === 0x2a && escStarBytes[i + 2] === 33) {
      escStarHeaderIdx = i;
      break;
    }
  }
  assert(escStarHeaderIdx !== -1, 'Must contain ESC * 33 (24-dot double density) header');
  assert.equal(escStarBytes[escStarHeaderIdx + 3], 16, 'nL must equal 16');
  assert.equal(escStarBytes[escStarHeaderIdx + 4], 0, 'nH must equal 0');

  // Must emit line feed (0x0A) after slice
  let foundLf = false;
  for (let i = escStarHeaderIdx + 5; i < escStarBytes.length; i++) {
    if (escStarBytes[i] === 0x0a) {
      foundLf = true;
      break;
    }
  }
  assert(foundLf, 'ESC * transport must emit LF (0x0A) after each slice');

  // Test 80mm width (576 dots) and 58mm width (384 dots)
  for (const widthDots of [DEFAULT_RASTER_WIDTH_80MM, DEFAULT_RASTER_WIDTH_58MM]) {
    const testBand: RasterBand = {
      widthDots,
      heightDots: 48, // 2 slices of 24 dots
      pixels: new Uint8Array(widthDots * 48),
    };
    const testUnit: RasterSemanticUnit = {
      unitId: `test-${widthDots}`,
      financial: false,
      complete: true,
      bands: [testBand],
    };
    const testCaps: ThermalPrinterCapabilities = {
      ...caps16,
      raster: { enabled: true, widthDots, maxBandHeight: 200, modes: ['whole-receipt'] },
    };
    const encoded = encodeWholeReceiptRaster(testUnit, testCaps, 'full', 'esc_star_24');
    assert(encoded.length > widthDots * 2 * 3, `Payload size must accommodate 2 slices for ${widthDots} dots`);
    
    // Check headers for width
    const nL = widthDots & 0xff;
    const nH = (widthDots >> 8) & 0xff;
    let headersFound = 0;
    for (let i = 0; i < encoded.length - 5; i++) {
      if (encoded[i] === 0x1b && encoded[i + 1] === 0x2a && encoded[i + 2] === 33 && encoded[i + 3] === nL && encoded[i + 4] === nH) {
        headersFound++;
      }
    }
    assert.equal(headersFound, 2, `Expected 2 slice headers for ${widthDots} dots`);
  }

  // Test partial height (e.g. 29 dots -> 1 slice of 24 dots + 1 slice of 5 dots)
  const partialBand: RasterBand = {
    widthDots: 384,
    heightDots: 29,
    pixels: new Uint8Array(384 * 29),
  };
  const partialUnit: RasterSemanticUnit = {
    unitId: 'test-partial',
    financial: false,
    complete: true,
    bands: [partialBand],
  };
  const partialCaps: ThermalPrinterCapabilities = {
    ...caps16,
    raster: { enabled: true, widthDots: 384, maxBandHeight: 200, modes: ['whole-receipt'] },
  };
  const partialEncoded = encodeWholeReceiptRaster(partialUnit, partialCaps, 'full', 'esc_star_24');
  // Must contain ESC 3 5 (0x1B, 0x33, 0x05) for the 5-dot slice
  let foundPartialSpacing = false;
  for (let i = 0; i < partialEncoded.length - 3; i++) {
    if (partialEncoded[i] === 0x1b && partialEncoded[i + 1] === 0x33 && partialEncoded[i + 2] === 5) {
      foundPartialSpacing = true;
      break;
    }
  }
  assert(foundPartialSpacing, 'Must set dynamic line spacing (ESC 3 5) for trailing 5-dot slice');

  // Must reset line spacing with ESC 2 (0x1B, 0x32) at the end
  let foundReset = false;
  for (let i = 0; i < partialEncoded.length - 2; i++) {
    if (partialEncoded[i] === 0x1b && partialEncoded[i + 1] === 0x32) {
      foundReset = true;
      break;
    }
  }
  assert(foundReset, 'Must reset line spacing with ESC 2');

  // =========================================================================
  // TEST 3: Settings persistence & transport resolution
  // =========================================================================
  console.log('Test 3: Settings resolution & database column defaults...');
  assert.equal(resolveRasterTransport('gs_v_0'), 'gs_v_0');
  assert.equal(resolveRasterTransport('esc_star_24'), 'esc_star_24');
  assert.equal(resolveRasterTransport('auto', 'esc_star_24'), 'esc_star_24');
  assert.equal(resolveRasterTransport('auto', 'gs_v_0'), 'gs_v_0');
  assert.equal(resolveRasterTransport(undefined), 'gs_v_0');

  // Check database table columns
  const tableInfo = db.prepare(`PRAGMA table_info(printers)`).all() as any[];
  const transportCol = tableInfo.find(c => c.name === 'branded_raster_transport');
  assert(transportCol, 'printers table must contain branded_raster_transport column');
  assert.equal(transportCol.dflt_value, "'gs_v_0'", 'Default value must be gs_v_0');

  // Insert printer with esc_star_24
  db.prepare(`
    INSERT INTO printers (id, name, connection_type, ip_address, port, paper_width, is_default, cash_drawer_pulse_enabled, branded_raster_transport, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('p1', 'XP-K200L Compatibility', 'network', '192.168.1.50', 9100, 'cols-48', 1, 0, 'esc_star_24', now(), now());

  const p1 = db.prepare('SELECT * FROM printers WHERE id = ?').get('p1') as any;
  assert.equal(p1.branded_raster_transport, 'esc_star_24', 'Printer transport setting must persist');

  // =========================================================================
  // TEST 4: Diagnostic rendering uses transport and sets visible top label
  // =========================================================================
  console.log('Test 4: Diagnostic requests and non-financial isolation...');
  const diagReqGsV0 = buildBrandedDiagnosticRequest({
    widthDots: DEFAULT_RASTER_WIDTH_80MM,
    fontFamily: 'cairo',
    transport: 'gs_v_0',
  });
  assert(diagReqGsV0.header.banner?.includes('TRANSPORT: GS v 0 RASTER'), 'GS v 0 diagnostic banner must show transport');
  assert(diagReqGsV0.header.banner?.includes('v3.11.8'), 'Diagnostic must include version 3.11.8');
  assert(diagReqGsV0.items.some(it => it.name.includes('◆ MID MARKER')), 'Diagnostic must include MID marker');
  assert(diagReqGsV0.footer.footerNote?.includes('▼ BOTTOM MARKER'), 'Diagnostic must include BOTTOM marker');

  const diagReqEscStar = buildBrandedDiagnosticRequest({
    widthDots: DEFAULT_RASTER_WIDTH_80MM,
    fontFamily: 'cairo',
    transport: 'esc_star_24',
  });
  assert(diagReqEscStar.header.banner?.includes('TRANSPORT: ESC * 24-DOT COMPATIBILITY'), 'ESC * diagnostic banner must show transport');
  assert(diagReqEscStar.header.banner?.includes('▲ TOP MARKER'), 'ESC * diagnostic must include TOP marker');
  assert(diagReqEscStar.header.banner?.includes('v3.11.8'), 'ESC * diagnostic must include version 3.11.8');

  // Render both diagnostic documents
  const renderGsV0 = await renderBrandedReceipt(diagReqGsV0);
  assert(renderGsV0.ok, 'GS v 0 diagnostic must render ok');
  if (renderGsV0.ok) {
    let hasGsV0Header = false;
    for (let i = 0; i < renderGsV0.rasterBytes.length - 4; i++) {
      if (renderGsV0.rasterBytes[i] === 0x1d && renderGsV0.rasterBytes[i + 1] === 0x76 && renderGsV0.rasterBytes[i + 2] === 0x30 && renderGsV0.rasterBytes[i + 3] === 0x00) {
        hasGsV0Header = true;
        break;
      }
    }
    assert(hasGsV0Header, 'GS v 0 diagnostic bytes must contain GS v 0 command');
  }

  const renderEscStar = await renderBrandedReceipt(diagReqEscStar);
  assert(renderEscStar.ok, 'ESC * diagnostic must render ok');
  if (renderEscStar.ok) {
    let hasEscStarHeader = false;
    for (let i = 0; i < renderEscStar.rasterBytes.length - 3; i++) {
      if (renderEscStar.rasterBytes[i] === 0x1b && renderEscStar.rasterBytes[i + 1] === 0x2a && renderEscStar.rasterBytes[i + 2] === 33) {
        hasEscStarHeader = true;
        break;
      }
    }
    assert(hasEscStarHeader, 'ESC * diagnostic bytes must contain ESC * command');
  }

  // Non-financial database assertion
  const orderCountBefore = (db.prepare('SELECT COUNT(*) as c FROM orders').get() as any).c;
  const billCountBefore = (db.prepare('SELECT COUNT(*) as c FROM bills').get() as any).c;

  // Execute diagnostic detailed (mock printer network will fail to connect, but DB state is untouched)
  await printBrandedDiagnosticDetailed('p1', 'cairo', undefined, 'esc_star_24');

  const orderCountAfter = (db.prepare('SELECT COUNT(*) as c FROM orders').get() as any).c;
  const billCountAfter = (db.prepare('SELECT COUNT(*) as c FROM bills').get() as any).c;
  assert.equal(orderCountBefore, orderCountAfter, 'Diagnostic must never create an order');
  assert.equal(billCountBefore, billCountAfter, 'Diagnostic must never create a bill');

  // =========================================================================
  // TEST 5: Full branded customer receipt rasterization (zero leaked plain text)
  // =========================================================================
  console.log('Test 5: Full branded customer receipt raw payload inspection...');
  const orderReceipt = {
    id: 101,
    order_number: 'ORD-901',
    created_at: '2026-09-29 11:30:00',
    table: { name: 'Table 7' },
    customer: { name: 'Ahmad الراشد', phone: '+966501234567' },
    items: [
      { product_name: 'شاي أخضر بالنعناع Green Tea', quantity: 2, price: 15, total_price: 30, addons: [{ name: 'سكر زيادة Extra sugar', price: 0 }], notes: 'بدون ماء ساخن إضافي' },
      { product_name: 'كابتشينو كلاسيك Cappuccino', quantity: 1, price: 22, total_price: 22 },
    ],
  };
  const billReceipt = {
    bill_number: 'INV-2026-901',
    created_at: '2026-09-29 11:30:00',
    subtotal: 52,
    tax: 7.8,
    tax_rate: 15,
    total: 59.8,
    payment_method: 'card',
    paid_amount: 59.8,
    items: orderReceipt.items,
  };
  const businessReceipt = {
    name: 'مقهى فلو كافيه FloCafe Coffee',
    address: 'King Fahd Road طريق الملك فهد',
    phone: '+966500000000',
    taxRegistrationNumber: '300012345678903',
    currency_symbol: 'SAR',
    footer_note: 'شكراً لزيارتكم نسعد بخدمتكم',
  };

  // Test with ESC * 24-dot compatibility
  const reqEscStarReceipt = buildBrandedReceiptRequest({
    order: orderReceipt,
    bill: billReceipt,
    business: businessReceipt,
    widthDots: DEFAULT_RASTER_WIDTH_80MM,
    transport: 'esc_star_24',
  });
  const renderEscStarReceipt = await renderBrandedReceipt(reqEscStarReceipt, 'esc_star_24');
  assert(renderEscStarReceipt.ok, 'Branded receipt with ESC * must render successfully');
  assert(renderEscStarReceipt.rasterBytes.length > 5000, 'Raster payload must contain complete receipt bitmap');

  // Must contain ESC * slice command
  let hasEscStarReceiptHeader = false;
  for (let i = 0; i < renderEscStarReceipt.rasterBytes.length - 3; i++) {
    if (renderEscStarReceipt.rasterBytes[i] === 0x1b && renderEscStarReceipt.rasterBytes[i + 1] === 0x2a && renderEscStarReceipt.rasterBytes[i + 2] === 33) {
      hasEscStarReceiptHeader = true;
      break;
    }
  }
  assert(hasEscStarReceiptHeader, 'Receipt payload must contain ESC * 33 slice command');

  // Strict non-image text check: NO raw customer text leaked into ESC/POS stream
  const nonImageTextReceiptEsc = extractNonImageText(renderEscStarReceipt.rasterBytes);
  assert.equal(nonImageTextReceiptEsc, '', 'Customer receipt raw non-image text must be completely empty');

  // Test with GS v 0
  const reqGsReceipt = buildBrandedReceiptRequest({
    order: orderReceipt,
    bill: billReceipt,
    business: businessReceipt,
    widthDots: DEFAULT_RASTER_WIDTH_80MM,
    transport: 'gs_v_0',
  });
  const renderGsReceipt = await renderBrandedReceipt(reqGsReceipt, 'gs_v_0');
  assert(renderGsReceipt.ok, 'Branded receipt with GS v 0 must render successfully');
  const nonImageTextReceiptGs = extractNonImageText(renderGsReceipt.rasterBytes);
  assert.equal(nonImageTextReceiptGs, '', 'GS v 0 customer receipt non-image text must be completely empty');

  // =========================================================================
  // TEST 6: Full branded KOT ticket rasterization (zero leaked plain text)
  // =========================================================================
  console.log('Test 6: Full branded KOT raw payload inspection...');
  const kotReq = buildBrandedKotRequest({
    order: orderReceipt,
    items: orderReceipt.items,
    stationName: 'مطبخ المشروبات Drinks Kitchen',
    business: businessReceipt,
    widthDots: DEFAULT_RASTER_WIDTH_80MM,
    transport: 'esc_star_24',
  });
  const renderKot = await renderBrandedReceipt(kotReq, 'esc_star_24');
  assert(renderKot.ok, 'Branded KOT must render successfully');
  assert(renderKot.rasterBytes.length > 3000, 'KOT raster payload must contain ticket bitmap');
  const nonImageTextKot = extractNonImageText(renderKot.rasterBytes);
  assert.equal(nonImageTextKot, '', 'KOT raw non-image text must be completely empty');

  // =========================================================================
  // TEST 7: Preliminary receipt (pre-bill banner and footer inside bitmap)
  // =========================================================================
  console.log('Test 7: Preliminary receipt raw payload inspection...');
  const prelimReq = buildBrandedReceiptRequest({
    order: orderReceipt,
    bill: billReceipt,
    business: businessReceipt,
    documentVariant: 'preliminary',
    widthDots: DEFAULT_RASTER_WIDTH_80MM,
    transport: 'esc_star_24',
  });
  assert(prelimReq.header.banner?.includes('PRELIMINARY'), 'Preliminary banner must be set in header');
  const renderPrelim = await renderBrandedReceipt(prelimReq, 'esc_star_24');
  assert(renderPrelim.ok, 'Preliminary receipt must render successfully');
  const nonImageTextPrelim = extractNonImageText(renderPrelim.rasterBytes);
  assert.equal(nonImageTextPrelim, '', 'Preliminary receipt raw non-image text must be completely empty');

  // =========================================================================
  // TEST 8: Financial Z-report rasterization (zero leaked plain text)
  // =========================================================================
  console.log('Test 8: Financial Z-report raw payload inspection...');
  const reportReq = buildBrandedReportRequest({
    title: 'Z REPORT / تقرير الإغلاق المالي',
    sections: [
      '{CENTER}{BOLD}FloCafe Financial Close',
      '{CENTER}Date: 2026-09-29',
      'Total Sales / إجمالي المبيعات        1500.00 SAR',
      'Tax Amount / قيمة الضريبة            225.00 SAR',
      'Net Sales / صافي المبيعات           1275.00 SAR',
      'Cash Counted / النقد الفعلي          1000.00 SAR',
      'Card Payments / شبكة مدى             500.00 SAR',
    ],
    widthDots: DEFAULT_RASTER_WIDTH_80MM,
    transport: 'esc_star_24',
    business: businessReceipt,
  });
  const renderReport = await renderBrandedReceipt(reportReq, 'esc_star_24');
  assert(renderReport.ok, 'Financial report must render successfully');
  assert(renderReport.rasterBytes.length > 3000, 'Financial report raster payload must contain bitmap');
  const nonImageTextReport = extractNonImageText(renderReport.rasterBytes);
  assert.equal(nonImageTextReport, '', 'Financial report raw non-image text must be completely empty');

  // Test printZReport routing in branded_raster mode with WebUSB printer config
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('country', 'SA')").run();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('currency', 'SAR')").run();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('timezone', 'Asia/Riyadh')").run();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('store_name', 'FloCafe')").run();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('print_style_preferences', ?)").run(JSON.stringify({
    receipt: { renderMode: 'branded_raster', typography: { fontFamily: 'almarai' }, frame: { borderStyle: 'none' }, logo: { showLogo: false } },
    kotStyleMode: 'inherit',
  }));
  const zData = {
    id: 1,
    z_number: 1,
    business_date: '2026-09-29',
    period_start: '2026-09-29 08:00:00',
    period_end: '2026-09-29 23:00:00',
    created_at: '2026-09-29 23:00:00',
    gross_sales: 1500,
    net_sales: 1275,
    tax_total: 225,
    payments: [{ payment_method: 'cash', amount: 1000 }, { payment_method: 'card', amount: 500 }],
  };
  const zPrinter = { id: 'p_test_z', connection_type: 'webusb', paper_width: '80mm', branded_raster_transport: 'esc_star_24' };
  const zResult = await printZReport(zData, undefined, zPrinter);
  assert(zResult.ok, 'printZReport in branded_raster mode must succeed');
  assert(zResult.bytes && zResult.bytes.length > 0, 'printZReport must return raster payload');
  const zNonImageText = extractNonImageText(zResult.bytes);
  assert.equal(zNonImageText, '', 'printZReport in branded_raster mode must emit zero unrendered text');

  // =========================================================================
  // TEST 9: Preview & Printer Raster Parity (exact same dimensions and bitmap)
  // =========================================================================
  console.log('Test 9: Preview and raster parity verification...');
  assert(renderEscStarReceipt.previewDataUrl, 'Render result must provide previewDataUrl');
  assert(renderEscStarReceipt.previewDataUrl.startsWith('data:image/png;base64,'), 'previewDataUrl must be a base64 PNG data URL');
  assert.equal(renderEscStarReceipt.dimensions.widthDots, DEFAULT_RASTER_WIDTH_80MM, 'Dimensions widthDots must match request');
  assert(renderEscStarReceipt.dimensions.heightDots > 0, 'Dimensions heightDots must be non-zero');
  assert(renderEscStarReceipt.document, 'Render result must contain RenderedThermalDocument');
  assert.equal(renderEscStarReceipt.document.widthDots, renderEscStarReceipt.dimensions.widthDots);
  assert.equal(renderEscStarReceipt.document.heightDots, renderEscStarReceipt.dimensions.heightDots);
  assert.equal(renderEscStarReceipt.document.rendererVersion, '3.11.8');
  assert.equal(renderEscStarReceipt.pixelHash, renderEscStarReceipt.document.pixelHash);
  assert.equal(renderEscStarReceipt.document.monochromePixels.length, renderEscStarReceipt.dimensions.widthDots * renderEscStarReceipt.dimensions.heightDots);

  // =========================================================================
  // TEST 10: Legacy text mode preserved and unaffected
  // =========================================================================
  console.log('Test 10: Legacy ESC/POS text mode unaffected...');
  const legacyLines = [
    'FloCafe Legacy Receipt',
    'Espresso  15.00 SAR',
    'Total:    15.00 SAR',
  ];
  const legacyEscPos = buildEscPos(legacyLines, false, { cutMode: 'full', language: 'en', columns: 42 });
  assert(legacyEscPos.length > 0, 'Legacy buildEscPos must produce bytes');
  const legacyNonImageText = extractNonImageText(legacyEscPos);
  assert(legacyNonImageText.includes('Espresso'), 'Legacy buildEscPos must emit plain text readable by extractNonImageText');
  assert(legacyNonImageText.includes('Total'), 'Legacy buildEscPos must emit Total readable by extractNonImageText');

  closeDatabase();
  if (fs.existsSync(testDbDir)) fs.rmSync(testDbDir, { recursive: true, force: true });
  console.log('✅ All branded raster transport tests passed successfully!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
