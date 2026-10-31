import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const Module = require('module');
const originalLoad = Module._load;
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-verify-admin-pin-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments as any);
};

const express = require('express');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { initDatabase, getDatabase, closeDatabase, now } = require('../main/db');
const { authRoutes } = require('../main/routes/auth');

async function main(): Promise<void> {
  console.log('Testing Admin PIN Verification for Expected Cash...');
  initDatabase();
  const db = getDatabase();

  const hashedOwnerPin = bcrypt.hashSync('8899', 8);
  const hashedManagerPin = bcrypt.hashSync('5544', 8);
  const hashedCashierPin = bcrypt.hashSync('1234', 8);

  // 1. Seed owner, manager, and cashier
  db.prepare(`
    INSERT INTO users (id, name, email, password, role, pin, pin_hash, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run('test-owner', 'Test Owner', 'owner@pin.test', 'pwd', 'owner', '8899', hashedOwnerPin, now(), now());

  db.prepare(`
    INSERT INTO users (id, name, email, password, role, pin, pin_hash, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run('test-manager', 'Test Manager', 'mgr@pin.test', 'pwd', 'manager', '5544', hashedManagerPin, now(), now());

  db.prepare(`
    INSERT INTO users (id, name, email, password, role, pin, pin_hash, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run('test-cashier', 'Test Cashier', 'cashier@pin.test', 'pwd', 'cashier', '1234', hashedCashierPin, now(), now());

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);

  // Test 1: Empty or invalid input
  const resEmpty = await request(app).post('/api/auth/verify-admin-pin').send({});
  assert.equal(resEmpty.status, 400);

  const resBlank = await request(app).post('/api/auth/verify-admin-pin').send({ pin: '   ' });
  assert.equal(resBlank.status, 400);

  // Test 2: Cashier PIN cannot unlock expected cash (only owner/manager)
  const resCashier = await request(app).post('/api/auth/verify-admin-pin').send({ pin: '1234' });
  assert.equal(resCashier.status, 401);
  assert.equal(resCashier.body.ok, false);

  // Test 3: Owner PIN unlocks expected cash successfully
  const resOwner = await request(app).post('/api/auth/verify-admin-pin').send({ pin: '8899' });
  assert.equal(resOwner.status, 200);
  assert.equal(resOwner.body.ok, true);
  assert.equal(resOwner.body.admin.role, 'owner');
  assert.equal(resOwner.body.admin.name, 'Test Owner');

  // Test 4: Manager PIN with whitespace unlocks expected cash
  const resManager = await request(app).post('/api/auth/verify-admin-pin').send({ pin: ' 5544 ' });
  assert.equal(resManager.status, 200);
  assert.equal(resManager.body.ok, true);
  assert.equal(resManager.body.admin.role, 'manager');
  assert.equal(resManager.body.admin.name, 'Test Manager');

  // Test 5: Wrong PIN is rejected
  const resWrong = await request(app).post('/api/auth/verify-admin-pin').send({ pin: '9999' });
  assert.equal(resWrong.status, 401);

  console.log('✓ All Admin PIN verification checks passed successfully.');
  closeDatabase();
  fs.rmSync(testDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
