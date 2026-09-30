/**
 * Integration Test: Deferred Checkout and Internal Naming
 *
 * Tests:
 * A) Finish Later (keep table vs release table)
 * B) Pay Later guards (requires customer, reason, manager auth)
 * C) Pay Later success (sets bills.payment_status='deferred', orders.status='completed', table available, audit logged)
 * D) Single Source of Truth: financial status is only on bills, service status on orders
 * E) Settlement of deferred bill later
 * F) Internal labels on tables and orders
 *
 * Usage: node tests/run-electron-node-test.cjs tests/deferred-checkout-and-naming.test.ts
 */

const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-deferred-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments as any);
};

const {
  initTestDb, createApp, startServer,
  seedOwnerUser, seedManagerUser, seedCustomer, seedCategory, seedProduct, seedTable,
  api, assertOrThrow, assertEqualOrThrow,
  closeDatabase, getDatabase, now,
} = require('./helpers/test-setup');

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

function seedServerUser(db: any) {
  const { getJWTSecret } = require('../main/routes/auth');
  const userId = 'server-test-001';
  const passwordHash = bcrypt.hashSync('testpass123', 10);
  db.prepare(
    `INSERT OR IGNORE INTO users (id, name, email, password, role, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, 'Test Server', 'server@test.local', passwordHash, 'server', 1, now(), now());

  const token = jwt.sign(
    { userId, email: 'server@test.local', role: 'server' },
    getJWTSecret(),
    { expiresIn: '1h' }
  );

  return { userId, token, authHeader: { Authorization: `Bearer ${token}` } };
}

const { tableRoutes } = require('../main/routes/tables');
const { orderRoutes } = require('../main/routes/orders');
const { billRoutes } = require('../main/routes/bills');

async function main() {
  console.log('Integration Test: Deferred Checkout and Internal Naming');
  console.log('='.repeat(50));

  const db = initTestDb();
  const { authHeader: ownerHeader, userId: ownerId } = seedOwnerUser(db);
  const manager = seedManagerUser(db);
  const { authHeader: serverHeader, userId: serverId } = seedServerUser(db);
  const customerId = 'cust-def-1';
  seedCustomer(db, customerId, 'Alice VIP', '1234567890');

  seedCategory(db, 'cat-def', 'Deferred Category');
  seedProduct(db, 'prod-d1', 'cat-def', 'Steak', 500);

  seedTable(db, 'tbl-def-1', 1, 4);
  seedTable(db, 'tbl-def-2', 2, 4);
  seedTable(db, 'tbl-def-3', 3, 4);

  const app = createApp({
    '/api/tables': tableRoutes,
    '/api/orders': orderRoutes,
    '/api/bills': billRoutes,
  });
  const { baseUrl, server } = await startServer(app);

  try {
    // ═══════════════════════════════════════════════════════════════════
    // Scenario A: Finish Later (keep table vs release table)
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n─── Scenario A: Finish Later ───');

    // 1. Keep Table
    const order1Res = await api(baseUrl, '/api/orders', {
      method: 'POST',
      body: {
        type: 'dine_in',
        table_id: 'tbl-def-1',
        items: [{ product_id: 'prod-d1', quantity: 1 }],
      },
      headers: serverHeader,
    });
    const order1Id = order1Res.data.order.id;

    const finishKeepRes = await api(baseUrl, `/api/orders/${order1Id}/finish-later`, {
      method: 'POST',
      body: { keep_table: true },
      headers: serverHeader,
    });
    assertEqualOrThrow(finishKeepRes.status, 200, 'Finish later with keep_table=true succeeds');
    assertEqualOrThrow(finishKeepRes.data.order.table_id, 'tbl-def-1', 'Order remains on table');
    const tbl1State = db.prepare('SELECT status FROM tables WHERE id = ?').get('tbl-def-1');
    assertEqualOrThrow(tbl1State.status, 'occupied', 'Table remains occupied');

    // 2. Release Table
    const finishReleaseRes = await api(baseUrl, `/api/orders/${order1Id}/finish-later`, {
      method: 'POST',
      body: { keep_table: false },
      headers: serverHeader,
    });
    assertEqualOrThrow(finishReleaseRes.status, 200, 'Finish later with keep_table=false succeeds');
    assertEqualOrThrow(finishReleaseRes.data.order.table_id, null, 'Order table_id set to null');
    const tbl1Released = db.prepare('SELECT status FROM tables WHERE id = ?').get('tbl-def-1');
    assertEqualOrThrow(tbl1Released.status, 'available', 'Table released to available');

    // ═══════════════════════════════════════════════════════════════════
    // Scenario B: Pay Later / Deferred Guards
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n─── Scenario B: Pay Later Guards ───');

    const order2Res = await api(baseUrl, '/api/orders', {
      method: 'POST',
      body: {
        type: 'dine_in',
        table_id: 'tbl-def-2',
        items: [{ product_id: 'prod-d1', quantity: 1 }],
      },
      headers: serverHeader,
    });
    const order2Id = order2Res.data.order.id;

    // Guard 1: Missing customer
    const noCustRes = await api(baseUrl, `/api/orders/${order2Id}/defer-payment`, {
      method: 'POST',
      body: { reason: 'Corporate billing account' },
      headers: ownerHeader,
    });
    assertEqualOrThrow(noCustRes.status, 400, 'Deferred checkout rejected without linked customer');

    // Link customer to order
    db.prepare('UPDATE orders SET customer_id = ? WHERE id = ?').run(customerId, order2Id);

    // Guard 2: Missing reason
    const noReasonRes = await api(baseUrl, `/api/orders/${order2Id}/defer-payment`, {
      method: 'POST',
      body: { reason: '' },
      headers: ownerHeader,
    });
    assertEqualOrThrow(noReasonRes.status, 400, 'Deferred checkout rejected without reason');

    // Guard 3: Non-manager without manager PIN
    const serverUnauthRes = await api(baseUrl, `/api/orders/${order2Id}/defer-payment`, {
      method: 'POST',
      body: { reason: 'Company invoice' },
      headers: serverHeader,
    });
    assertEqualOrThrow(serverUnauthRes.status, 403, 'Server role without manager approval rejected (403)');

    // ═══════════════════════════════════════════════════════════════════
    // Scenario C: Pay Later / Deferred Checkout Success
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n─── Scenario C: Pay Later Success ───');

    const deferSuccessRes = await api(baseUrl, `/api/orders/${order2Id}/defer-payment`, {
      method: 'POST',
      body: {
        reason: 'Authorized invoice',
        manager_pin: '1234', // owner's pin
      },
      headers: serverHeader,
    });
    assertEqualOrThrow(deferSuccessRes.status, 200, 'Deferred payment succeeded with manager PIN');

    // Check bill state
    const bill2 = db.prepare('SELECT * FROM bills WHERE order_id = ?').get(order2Id);
    assertOrThrow(Boolean(bill2), 'Bill exists for order');
    assertEqualOrThrow(bill2.payment_status, 'deferred', 'bills.payment_status is deferred');
    assertEqualOrThrow(bill2.deferred_reason, 'Authorized invoice', 'deferred_reason is stored');
    assertEqualOrThrow(bill2.deferred_authorized_by, manager.userId, 'deferred_authorized_by recorded');
    assertOrThrow(Boolean(bill2.deferred_at), 'deferred_at timestamp set');

    // Check order status & table release
    const order2Row = db.prepare('SELECT * FROM orders WHERE id = ?').get(order2Id);
    assertEqualOrThrow(order2Row.status, 'completed', 'Order status is completed');
    const tbl2State = db.prepare('SELECT status FROM tables WHERE id = ?').get('tbl-def-2');
    assertEqualOrThrow(tbl2State.status, 'available', 'Table is marked available');

    // Check no payment records in payment_details
    const payDetails = JSON.parse(bill2.payment_details || '[]');
    assertEqualOrThrow(payDetails.length, 0, 'No payment recorded in payment_details');
    assertEqualOrThrow(bill2.paid_amount, 0, 'paid_amount is 0');

    // ═══════════════════════════════════════════════════════════════════
    // Scenario D: Single Source of Truth
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n─── Scenario D: Single Source of Truth ───');
    // Ensure orders table does NOT have a column named payment_status
    const orderColumns = db.prepare('PRAGMA table_info(orders)').all();
    const hasOrderPaymentStatus = orderColumns.some((col: any) => col.name === 'payment_status');
    assertEqualOrThrow(hasOrderPaymentStatus, false, 'orders table has no payment_status column');

    // ═══════════════════════════════════════════════════════════════════
    // Scenario E: Settle Deferred Bill Later
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n─── Scenario E: Settle Deferred Bill ───');

    const settleRes = await api(baseUrl, `/api/bills/${bill2.id}/payments`, {
      method: 'POST',
      body: {
        payments: [{ method: 'card', amount: bill2.total }],
      },
      headers: ownerHeader,
    });
    assertEqualOrThrow(settleRes.status, 200, 'Settling deferred bill accepted');
    assertEqualOrThrow(settleRes.data.bill.payment_status, 'paid', 'Bill status transitioned to paid');
    assertEqualOrThrow(settleRes.data.bill.paid_amount, bill2.total, 'Paid amount matches total');

    // ═══════════════════════════════════════════════════════════════════
    // Scenario F: Internal Labels
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n─── Scenario F: Internal Labels ───');

    // Update table internal label
    const tblLabelRes = await api(baseUrl, '/api/tables/tbl-def-3/internal-label', {
      method: 'PATCH',
      body: { internal_label: 'Window Seat Booth' },
      headers: ownerHeader,
    });
    assertEqualOrThrow(tblLabelRes.status, 200, 'Table internal label updated');
    assertEqualOrThrow(tblLabelRes.data.table.internal_label, 'Window Seat Booth', 'Label returned in response');

    const tblRow = db.prepare('SELECT internal_label FROM tables WHERE id = ?').get('tbl-def-3');
    assertEqualOrThrow(tblRow.internal_label, 'Window Seat Booth', 'Table internal label persisted in db');

    // Create order with internal label and test PATCH internal label
    const order3Res = await api(baseUrl, '/api/orders', {
      method: 'POST',
      body: {
        type: 'takeaway',
        internal_label: 'Call when outside',
        items: [{ product_id: 'prod-d1', quantity: 1 }],
      },
      headers: ownerHeader,
    });
    const order3Id = order3Res.data.order.id;
    assertEqualOrThrow(order3Res.data.order.internal_label, 'Call when outside', 'Order created with internal label');

    // Update order internal label
    const orderLabelRes = await api(baseUrl, `/api/orders/${order3Id}/internal-label`, {
      method: 'PATCH',
      body: { internal_label: 'VIP Ambassador Order' },
      headers: ownerHeader,
    });
    assertEqualOrThrow(orderLabelRes.status, 200, 'Order internal label updated via PATCH');
    assertEqualOrThrow(orderLabelRes.data.order.internal_label, 'VIP Ambassador Order', 'Updated label returned');

    // Filter orders by internal label
    const searchRes = await api(baseUrl, '/api/orders?internal_label=VIP Ambassador', {
      headers: ownerHeader,
    });
    assertEqualOrThrow(searchRes.status, 200, 'Search by internal label succeeded');
    const matched = searchRes.data.orders.find((o: any) => o.id === order3Id);
    assertOrThrow(Boolean(matched), 'Order found by internal label query');

    console.log('\nAll deferred checkout & internal naming integration tests passed!');
  } finally {
    server.close();
    closeDatabase();
  }
}

main().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
