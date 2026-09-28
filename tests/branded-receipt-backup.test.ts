const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-test-backup-'));
Module._load = function(request: string, parent: any, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' }};
  return originalLoad.apply(this, arguments);
};

import assert from 'node:assert/strict';
import {
  storeReceiptLogo,
  deleteReceiptLogo,
  getActiveReceiptLogo,
  rehydrateReceiptAssets,
  getBrandingMediaDir,
} from '../main/services/receipt-assets';
import { initDatabase, getDatabase, closeDatabase, createBackup, restoreBackup } from '../main/db';

function createMinimalPng(width = 16, height = 16): Buffer {
  const buf = Buffer.alloc(33);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf[24] = 8;
  buf[25] = 6;
  buf[26] = 0;
  buf[27] = 0;
  buf[28] = 0;
  buf.writeUInt32BE(0x12345678, 29);
  return buf;
}

async function runTests() {
  console.log('--- Testing Branded Receipt Backup & Restore Rehydration ---');

  initDatabase(true, true);
  const db = getDatabase();

  // 1. Store a test logo
  const pngData = createMinimalPng(24, 24);
  const stored = await storeReceiptLogo(pngData, 'test-brand.png', 'image/png');
  assert.ok(stored.id, 'Asset ID should be generated');

  const activeBefore = getActiveReceiptLogo();
  assert.ok(activeBefore, 'Active logo should exist before backup');
  assert.equal(activeBefore.id, stored.id);
  const cachePath = path.join(getBrandingMediaDir(), `${stored.id}.png`);
  assert.ok(fs.existsSync(cachePath), 'Disk cache file should exist before backup');

  // 2. Create backup
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-backup-out-'));
  const backupFile = path.join(backupDir, 'flocafe_backup.db');
  const backupResult = await createBackup(backupFile);
  assert.ok(fs.existsSync(backupResult.path), 'Backup file must exist');

  // 3. Simulate local disk wipe of media cache
  const brandingDir = getBrandingMediaDir();
  fs.rmSync(brandingDir, { recursive: true, force: true });
  assert.ok(!fs.existsSync(cachePath), 'Cache file should be removed to simulate disk loss');

  // 4. Restore backup
  const restoreResult = restoreBackup(backupResult.path, true);
  assert.equal(restoreResult.success, true, 'Restore should succeed');

  // 5. Verify rehydration
  const activeAfter = getActiveReceiptLogo();
  assert.ok(activeAfter, 'Active logo must exist after restore');
  assert.equal(activeAfter.id, stored.id, 'Asset ID must match after restore');
  assert.equal(activeAfter.sha256, stored.sha256, 'SHA256 must match after restore');
  assert.ok(fs.existsSync(cachePath), 'Disk cache file must be automatically rehydrated');
  const rehydratedBytes = fs.readFileSync(cachePath);
  assert.equal(rehydratedBytes.length, pngData.length, 'Rehydrated file size must match original data');

  // 6. Verify clean delete
  const deleted = await deleteReceiptLogo();
  assert.equal(deleted, true, 'deleteReceiptLogo should return true');
  assert.equal(getActiveReceiptLogo(), null, 'Active logo must be null after deletion');
  assert.ok(!fs.existsSync(cachePath), 'Disk cache file must be removed on delete');

  closeDatabase();
  console.log('✓ Branded receipt backup & restore rehydration passed');
}

runTests().catch((err) => {
  console.error('Backup test failed:', err);
  process.exit(1);
});
