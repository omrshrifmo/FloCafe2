const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-test-assets-'));
Module._load = function(request: string, parent: any, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' }};
  return originalLoad.apply(this, arguments);
};

import assert from 'node:assert/strict';
import {
  validateImageBuffer,
  sanitizeFilename,
  storeReceiptLogo,
  deleteReceiptLogo,
  getActiveReceiptLogo,
  getActiveReceiptLogoAsset,
  rehydrateReceiptAssets,
  getBrandingMediaDir,
} from '../main/services/receipt-assets';
import { initDatabase, getDatabase, closeDatabase } from '../main/db';

// Helper to create a minimal 1x1 valid PNG buffer
function createMinimalPng(width = 1, height = 1): Buffer {
  const buf = Buffer.alloc(33);
  // PNG signature
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // IHDR chunk length 13
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf[24] = 8; // bit depth
  buf[25] = 6; // color type RGBA
  buf[26] = 0; // compression
  buf[27] = 0; // filter
  buf[28] = 0; // interlace
  // CRC dummy
  buf.writeUInt32BE(0x12345678, 29);
  return buf;
}

// Helper to create a minimal valid JPEG buffer
function createMinimalJpeg(width = 10, height = 20): Buffer {
  const buf = Buffer.alloc(30);
  // SOI
  buf[0] = 0xff;
  buf[1] = 0xd8;
  // SOF0 marker (0xFF, 0xC0)
  buf[2] = 0xff;
  buf[3] = 0xc0;
  buf.writeUInt16BE(11, 4); // length
  buf[6] = 8; // precision
  buf.writeUInt16BE(height, 7);
  buf.writeUInt16BE(width, 9);
  buf[11] = 3; // components
  // EOI
  buf[28] = 0xff;
  buf[29] = 0xd9;
  return buf;
}

async function runTests() {
  console.log('[Test] Running receipt-assets unit & integration tests...');

  // 1. Filename sanitization
  assert.equal(sanitizeFilename('logo.png'), 'logo.png');
  assert.equal(sanitizeFilename('../../../etc/passwd.png'), 'passwd.png');
  assert.equal(sanitizeFilename('my logo @ café (1).png'), 'my_logo___caf___1_.png');
  assert.equal(sanitizeFilename(''), 'logo.png');
  assert.equal(sanitizeFilename(null as any), 'logo.png');

  // 2. Image buffer validation
  const validPng = createMinimalPng(120, 80);
  const parsedPng = validateImageBuffer(validPng);
  assert.equal(parsedPng.format, 'png');
  assert.equal(parsedPng.width, 120);
  assert.equal(parsedPng.height, 80);

  const validJpeg = createMinimalJpeg(200, 150);
  const parsedJpeg = validateImageBuffer(validJpeg);
  assert.equal(parsedJpeg.format, 'jpeg');
  assert.equal(parsedJpeg.width, 200);
  assert.equal(parsedJpeg.height, 150);

  // Reject empty / non-buffer
  assert.throws(() => validateImageBuffer(Buffer.alloc(0)), /Image data is empty/);
  assert.throws(() => validateImageBuffer(Buffer.from('not an image at all')), /Invalid image format/);

  // Reject oversize dimensions (> 4096 px)
  const hugePng = createMinimalPng(5000, 100);
  assert.throws(() => validateImageBuffer(hugePng), /dimensions.*exceed maximum.*4096/);

  // 3. Database & asset lifecycle
  const testDbDir = path.join(__dirname, '../dist/test-db-assets');
  if (fs.existsSync(testDbDir)) fs.rmSync(testDbDir, { recursive: true, force: true });
  fs.mkdirSync(testDbDir, { recursive: true });

  const testDbPath = path.join(testDbDir, 'test_receipt_assets.db');
  process.env.FLO_DATABASE_PATH = testDbPath;
  initDatabase();

  const db = getDatabase();

  // Initially, no active logo
  assert.equal(getActiveReceiptLogo(), null);
  assert.equal(getActiveReceiptLogoAsset(), null);

  // Store first logo
  const logo1 = await storeReceiptLogo(createMinimalPng(100, 50), 'brand1.png');
  assert.equal(logo1.filename, 'brand1.png');
  assert.equal(logo1.width, 100);
  assert.equal(logo1.height, 50);

  // Active logo pointer should now point to logo1
  const active1 = getActiveReceiptLogo();
  assert(active1 !== null);
  assert.equal(active1.id, logo1.id);
  assert.equal(active1.filename, 'brand1.png');

  const asset1 = getActiveReceiptLogoAsset();
  assert(asset1 !== null);
  assert.equal(asset1.id, logo1.id);
  assert(Buffer.isBuffer(asset1.data));
  assert.equal(asset1.data.length, createMinimalPng(100, 50).length);

  // Verify disk cache exists
  const brandingDir = getBrandingMediaDir();
  const cachePath1 = path.join(brandingDir, `${logo1.id}.png`);
  assert(fs.existsSync(cachePath1), 'Disk cache file must exist after upload');

  // Atomic replacement: store second logo
  const logo2 = await storeReceiptLogo(createMinimalPng(200, 100), 'brand2.png');
  assert.notEqual(logo2.id, logo1.id);

  // Active pointer must point to logo2
  const active2 = getActiveReceiptLogo();
  assert(active2 !== null);
  assert.equal(active2.id, logo2.id);
  assert.equal(active2.filename, 'brand2.png');

  // Old logo1 should be pruned from database and disk cache
  const oldRow = db.prepare('SELECT id FROM receipt_assets WHERE id = ?').get(logo1.id);
  assert.equal(oldRow, undefined, 'Old unreferenced asset should be deleted from DB');
  assert.equal(fs.existsSync(cachePath1), false, 'Old unreferenced disk cache should be pruned');

  // Test rehydration: delete cache file from disk, call rehydrateReceiptAssets()
  const cachePath2 = path.join(brandingDir, `${logo2.id}.png`);
  assert(fs.existsSync(cachePath2));
  fs.unlinkSync(cachePath2);
  assert.equal(fs.existsSync(cachePath2), false);

  const rehydratedCount = rehydrateReceiptAssets();
  assert(rehydratedCount >= 1, 'Rehydration should restore missing disk cache files');
  assert(fs.existsSync(cachePath2), 'Rehydrated file must exist on disk');

  // Test API Routes via supertest
  const express = require('express');
  const request = require('supertest');
  const jwt = require('jsonwebtoken');
  const { requireAuth } = require('../main/server');
  const { getJWTSecret } = require('../main/routes/auth');
  const { receiptAssetsRouter } = require('../main/routes/receipt-assets');

  // Insert a test user with settings.view permission in users table
  db.prepare(`
    INSERT INTO users (id, name, email, role, password, is_active, created_at, updated_at)
    VALUES ('test-admin', 'Admin', 'admin@test.local', 'owner', 'hash', 1, datetime('now'), datetime('now'))
  `).run();

  const token = jwt.sign(
    { userId: 'test-admin', email: 'admin@test.local', role: 'owner' },
    getJWTSecret(),
    { expiresIn: '1h' },
  );

  const app = express();
  app.use(express.json());
  app.use(requireAuth);
  app.use('/api/settings', receiptAssetsRouter);

  // 1. Upload a logo so active logo exists
  const logoUploaded = await storeReceiptLogo(createMinimalPng(120, 60), 'active-test.png');
  assert.equal(logoUploaded.filename, 'active-test.png');
  assert(typeof logoUploaded.dataUrl === 'string' && logoUploaded.dataUrl.startsWith('data:image/png;base64,'));

  // 2. GET /api/settings/receipt-logo/image WITHOUT auth token must succeed (so <img> tags work)
  const imgRes = await request(app).get('/api/settings/receipt-logo/image');
  assert.equal(imgRes.status, 200, 'Unauthenticated <img> request to receipt-logo/image must return 200');
  assert.equal(imgRes.headers['content-type'], 'image/png');
  assert(imgRes.body.length > 0, 'Image payload must not be empty');

  // 3. GET /api/settings/receipt-preview with branded_raster mode
  const previewRasterRes = await request(app)
    .get('/api/settings/receipt-preview?render_mode=branded_raster&font_family=almarai&paper_width=80mm')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(previewRasterRes.status, 200, 'receipt-preview branded_raster must return 200');
  assert.equal(previewRasterRes.body.success, true);
  assert.equal(previewRasterRes.body.render_mode, 'branded_raster');
  assert.equal(previewRasterRes.body.width_dots, 576);
  assert(typeof previewRasterRes.body.preview_image_url === 'string' && previewRasterRes.body.preview_image_url.startsWith('data:image/png;base64,'));

  // 4. GET /api/settings/receipt-preview with legacy_text mode
  const previewLegacyRes = await request(app)
    .get('/api/settings/receipt-preview?render_mode=legacy_text&paper_width=80mm')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(previewLegacyRes.status, 200, 'receipt-preview legacy_text must return 200');
  assert.equal(previewLegacyRes.body.success, true);
  assert.equal(previewLegacyRes.body.render_mode, 'legacy_text');
  assert(typeof previewLegacyRes.body.sample_text === 'string' && previewLegacyRes.body.sample_text.includes('FloCafe'));

  // Delete active logo
  await deleteReceiptLogo();
  assert.equal(getActiveReceiptLogo(), null);
  assert.equal(getActiveReceiptLogoAsset(), null);

  closeDatabase();
  try { fs.rmSync(testDbDir, { recursive: true, force: true }); } catch { }

  console.log('[Test] receipt-assets unit & integration tests passed!');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
