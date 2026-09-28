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
  renderBrandedReceipt,
  DEFAULT_RASTER_WIDTH_80MM,
  DEFAULT_RASTER_WIDTH_58MM,
} from '../main/printers/branded-receipt-renderer';
import { printBrandedDiagnosticDetailed } from '../main/printers/thermal';

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

  const diagReqEscStar = buildBrandedDiagnosticRequest({
    widthDots: DEFAULT_RASTER_WIDTH_80MM,
    fontFamily: 'cairo',
    transport: 'esc_star_24',
  });
  assert(diagReqEscStar.header.banner?.includes('TRANSPORT: ESC * 24-DOT COMPATIBILITY'), 'ESC * diagnostic banner must show transport');

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

  closeDatabase();
  if (fs.existsSync(testDbDir)) fs.rmSync(testDbDir, { recursive: true, force: true });
  console.log('✅ All branded raster transport tests passed successfully!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
