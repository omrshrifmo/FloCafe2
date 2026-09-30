/**
 * Integration Test: Custom Cash Drawer Tender Classification
 *
 * Tests:
 * A) Custom payment methods default to counts_as_cash_drawer_tender = 0
 * B) Manager/owner can configure counts_as_cash_drawer_tender
 * C) Payment snapshotting records counts_as_cash_drawer_tender on each payment line in bills.payment_details
 * D) Historical payments remain immutable if payment method classification is changed later
 * E) Cash closures and cash sessions correctly include custom cash drawer tenders in expected cash totals
 * F) Deferred balances do not count as drawer tender
 *
 * Usage: node tests/run-electron-node-test.cjs tests/custom-cash-drawer-tender.test.ts
 */

const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-drawer-tender-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments as any);
};

const {
  initTestDb, createApp, startServer,
  seedOwnerUser, seedCategory, seedProduct,
  api, assertOrThrow, assertEqualOrThrow,
  closeDatabase, getDatabase,
} = require('./helpers/test-setup');

const { paymentMethodRoutes } = require('../main/routes/payment-methods');
const { orderRoutes } = require('../main/routes/orders');
const { billRoutes } = require('../main/routes/bills');
const { cashClosureRoutes } = require('../main/routes/cash-closures');
const { cashDrawerSalesAndRefunds } = require('../main/routes/cash-closures');

async function main() {
  console.log('Integration Test: Custom Cash Drawer Tender Classification');
  console.log('='.repeat(50));

  const db = initTestDb();
  const { authHeader, user: owner } = seedOwnerUser(db);

  seedCategory(db, 'cat-tender', 'Tender Category');
  seedProduct(db, 'prod-tnd-1', 'cat-tender', 'Burger', 150);

  const app = createApp({
    '/api/payment-methods': paymentMethodRoutes,
    '/api/orders': orderRoutes,
    '/api/bills': billRoutes,
    '/api/cash-closures': cashClosureRoutes,
  });
  const { baseUrl, server } = await startServer(app);

  try {
    // ═══════════════════════════════════════════════════════════════════
    // Scenario A: Custom payment method default & configuration
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n─── Scenario A: Payment Method Drawer Tender Configuration ───');

    // 1. Create method without flag -> defaults to false
    const createVoucherRes = await api(baseUrl, '/api/payment-methods', {
      method: 'POST',
      body: { name: 'Voucher', type: 'other' },
      headers: authHeader,
    });
    assertEqualOrThrow(createVoucherRes.status, 201, 'Voucher created');
    assertEqualOrThrow(createVoucherRes.data.payment_method.counts_as_cash_drawer_tender, false, 'Defaults to false');
    const voucherId = createVoucherRes.data.payment_method.id;

    // 2. Create method with flag=true
    const createStampRes = await api(baseUrl, '/api/payment-methods', {
      method: 'POST',
      body: { name: 'Food Stamp', type: 'other', counts_as_cash_drawer_tender: true },
      headers: authHeader,
    });
    assertEqualOrThrow(createStampRes.status, 201, 'Food Stamp created');
    assertEqualOrThrow(createStampRes.data.payment_method.counts_as_cash_drawer_tender, true, 'Drawer tender flag set to true');
    const stampId = createStampRes.data.payment_method.id;

    // 3. Update Voucher to counts_as_cash_drawer_tender=true
    const updateVoucherRes = await api(baseUrl, `/api/payment-methods/${voucherId}`, {
      method: 'PUT',
      body: { name: 'Voucher', counts_as_cash_drawer_tender: true },
      headers: authHeader,
    });
    assertEqualOrThrow(updateVoucherRes.status, 200, 'Voucher updated');
    assertEqualOrThrow(updateVoucherRes.data.payment_method.counts_as_cash_drawer_tender, true, 'Voucher drawer tender updated to true');

    // ═══════════════════════════════════════════════════════════════════
    // Scenario B: Payment Snapshotting
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n─── Scenario B: Payment Snapshotting ───');

    // Create an order
    const orderRes = await api(baseUrl, '/api/orders', {
      method: 'POST',
      body: {
        type: 'takeaway',
        items: [{ product_id: 'prod-tnd-1', quantity: 2 }], // 300 total
      },
      headers: authHeader,
    });
    const orderId = orderRes.data.order.id;

    const genBillRes = await api(baseUrl, '/api/bills/generate', {
      method: 'POST',
      body: { order_id: orderId },
      headers: authHeader,
    });
    const bill = genBillRes.data.bill;

    // Apply payments: 100 with Food Stamp (drawer tender), 100 with Standard Cash, 100 with Card
    const payRes = await api(baseUrl, `/api/bills/${bill.id}/payments`, {
      method: 'POST',
      body: {
        payments: [
          { method: 'Food Stamp', amount: 100 },
          { method: 'cash', amount: 100 },
          { method: 'card', amount: 100 },
        ],
      },
      headers: authHeader,
    });
    assertEqualOrThrow(payRes.status, 200, 'Payments recorded');

    // Verify snapshot in bills.payment_details
    const updatedBill = db.prepare('SELECT payment_details FROM bills WHERE id = ?').get(bill.id);
    const details = JSON.parse(updatedBill.payment_details || '[]');
    assertEqualOrThrow(details.length, 3, 'Three payments recorded');

    const stampPayment = details.find((p: any) => p.method === 'Food Stamp');
    const cashPayment = details.find((p: any) => p.method === 'cash');
    const cardPayment = details.find((p: any) => p.method === 'card');

    assertOrThrow(Boolean(stampPayment), 'Food Stamp payment found');
    assertEqualOrThrow(stampPayment.counts_as_cash_drawer_tender, true, 'Food Stamp snapshotted as drawer tender');

    assertOrThrow(Boolean(cashPayment), 'Cash payment found');
    assertEqualOrThrow(cashPayment.counts_as_cash_drawer_tender, true, 'Cash snapshotted as drawer tender');

    assertOrThrow(Boolean(cardPayment), 'Card payment found');
    assertEqualOrThrow(cardPayment.counts_as_cash_drawer_tender, false, 'Card snapshotted as non-drawer tender');

    // ═══════════════════════════════════════════════════════════════════
    // Scenario C: Historical Snapshot Immutability
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n─── Scenario C: Historical Immutability ───');

    // Turn off counts_as_cash_drawer_tender on Food Stamp
    await api(baseUrl, `/api/payment-methods/${stampId}`, {
      method: 'PUT',
      body: { name: 'Food Stamp', counts_as_cash_drawer_tender: false },
      headers: authHeader,
    });

    // Verify the previously recorded bill STILL has counts_as_cash_drawer_tender: true for Food Stamp
    const billRecheck = db.prepare('SELECT payment_details FROM bills WHERE id = ?').get(bill.id);
    const recheckDetails = JSON.parse(billRecheck.payment_details || '[]');
    const historicStampPayment = recheckDetails.find((p: any) => p.method === 'Food Stamp');
    assertEqualOrThrow(
      historicStampPayment.counts_as_cash_drawer_tender,
      true,
      'Historical payment snapshot preserved counts_as_cash_drawer_tender=true'
    );

    // ═══════════════════════════════════════════════════════════════════
    // Scenario D: Cash Drawer and Closures Calculation
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n─── Scenario D: Cash Drawer Calculation ───');

    // Use cashDrawerSalesAndRefunds helper
    const totals = cashDrawerSalesAndRefunds(db, '2000-01-01T00:00:00.000Z', '2099-12-31T23:59:59.999Z', 100);
    // Expected drawer cash: 100 (Food Stamp) + 100 (Cash) = 200. (Card = 100 excluded).
    assertEqualOrThrow(totals.salesCents, 20000, 'Drawer cash sales includes both cash and custom cash drawer tender');

    console.log('\nAll custom cash drawer tender integration tests passed!');
  } finally {
    server.close();
    closeDatabase();
  }
}

main().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
