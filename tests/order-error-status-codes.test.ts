/**
 * Regression Test: Order Error HTTP Status Codes (3.11.11)
 *
 * Verifies that order creation and add-items requests return 400 (not 500)
 * when the request is invalid (unknown product ID).
 *
 * Bugs caught: order POST returned HTTP 500 for unknown product_id instead of 400.
 *
 * Usage: node tests/run-electron-node-test.cjs tests/order-error-status-codes.test.ts
 */

// ── Electron Mock (must be before any app imports) ───────────────────────────
const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-order-errcodes-'));
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments);
};

const {
  initTestDb, createApp, startServer,
  seedOwnerUser, seedCategory, seedProduct,
  api, assertEqualOrThrow, assertOrThrow,
  getResults, closeDatabase,
} = require('./helpers/test-setup');

const { orderRoutes } = require('../main/routes/orders');

async function main() {
  console.log('Regression Test: Order Error HTTP Status Codes');
  console.log('='.repeat(50));

  const db = initTestDb();
  const { authHeader } = seedOwnerUser(db);
  seedCategory(db, 'cat-errcodes', 'Test Menu');
  seedProduct(db, 'prod-real', 'cat-errcodes', 'Espresso', 250);

  const app = createApp({ '/api/orders': orderRoutes });
  const { baseUrl, server } = await startServer(app);

  try {
    // ── Scenario A: Unknown product_id returns 400, not 500 ──────────────────
    console.log('\n─── Scenario A: Unknown product_id → 400 ───');
    const r1 = await api(baseUrl, '/api/orders', {
      method: 'POST',
      body: { type: 'takeaway', items: [{ product_id: 'non-existent-product-id', quantity: 1 }] },
      headers: authHeader,
    });

    assertEqualOrThrow(r1.status, 400, 'unknown product → 400 not 500');
    assertOrThrow(typeof r1.data.error === 'string', 'error message is a string');
    assertOrThrow(!r1.data.error.toLowerCase().includes('internal'), 'error is not generic "Internal server error"');

    // ── Scenario B: Valid product returns 201 (baseline not broken) ──────────
    console.log('\n─── Scenario B: Valid order still succeeds ───');
    const r2 = await api(baseUrl, '/api/orders', {
      method: 'POST',
      body: { type: 'takeaway', items: [{ product_id: 'prod-real', quantity: 1 }] },
      headers: authHeader,
    });

    assertEqualOrThrow(r2.status, 201, 'valid order → 201');
    assertOrThrow(r2.data.order?.id !== undefined, 'order has id');

    const orderId = r2.data.order.id;

    // ── Scenario C: Add unknown product to existing order → 400 not 500 ──────
    console.log('\n─── Scenario C: Add unknown product to existing order → 400 ───');
    const r3 = await api(baseUrl, `/api/orders/${orderId}/items`, {
      method: 'POST',
      body: { items: [{ product_id: 'non-existent-product-id-2', quantity: 1 }] },
      headers: authHeader,
    });

    assertEqualOrThrow(r3.status, 400, 'unknown product in add-items → 400 not 500');
    assertOrThrow(typeof r3.data.error === 'string', 'add-items error message is a string');

    // ── Scenario D: Empty items array returns 400 ────────────────────────────
    console.log('\n─── Scenario D: Empty items → 400 ───');
    const r4 = await api(baseUrl, '/api/orders', {
      method: 'POST',
      body: { type: 'takeaway', items: [] },
      headers: authHeader,
    });

    assertEqualOrThrow(r4.status, 400, 'empty items → 400');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    closeDatabase();
  }

  const { passed, failed, total } = getResults();
  console.log(`\n${'='.repeat(50)}`);
  console.log(`${passed}/${total} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
