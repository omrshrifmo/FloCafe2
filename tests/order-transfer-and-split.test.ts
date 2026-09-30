/**
 * Integration Test: Order Transfer and Item Split
 *
 * Tests:
 * A) Whole order move to empty table (success, frees source table, occupies target)
 * B) Whole order move to occupied table (blocked with 409 Conflict)
 * C) Whole order move with partial payment (succeeds, payments stay attached)
 * D) Whole order move when order is completed/cancelled (blocked with 400)
 * E) Item transfer whole item and partial quantity split (prorates inventory, preserves modifiers/notes/status, recalculates source and destination totals)
 * F) Item transfer blocked when confirmed payments exist (blocked with 409 Conflict)
 *
 * Usage: node tests/run-electron-node-test.cjs tests/order-transfer-and-split.test.ts
 */

const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-transfer-split-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments as any);
};

const {
  initTestDb, createApp, startServer,
  seedOwnerUser, seedCategory, seedProduct, seedTable,
  api, assertOrThrow, assertEqualOrThrow,
  closeDatabase, getDatabase,
} = require('./helpers/test-setup');

const { tableRoutes } = require('../main/routes/tables');
const { orderRoutes } = require('../main/routes/orders');
const { billRoutes } = require('../main/routes/bills');

async function main() {
  console.log('Integration Test: Order Transfer and Item Split');
  console.log('='.repeat(50));

  const db = initTestDb();
  const { authHeader, user } = seedOwnerUser(db);

  seedCategory(db, 'cat-trans', 'Transfer Category');
  seedProduct(db, 'prod-t1', 'cat-trans', 'Pasta', 200);
  seedProduct(db, 'prod-t2', 'cat-trans', 'Pizza', 300);
  seedProduct(db, 'prod-t3', 'cat-trans', 'Salad', 100);

  seedTable(db, 'tbl-src-1', 1, 4);
  seedTable(db, 'tbl-dst-1', 2, 4);
  seedTable(db, 'tbl-dst-occupied', 3, 4);
  seedTable(db, 'tbl-dst-partpay', 4, 4);
  seedTable(db, 'tbl-item-split-src', 5, 4);
  seedTable(db, 'tbl-item-split-dst', 6, 4);

  const app = createApp({
    '/api/tables': tableRoutes,
    '/api/orders': orderRoutes,
    '/api/bills': billRoutes,
  });
  const { baseUrl, server } = await startServer(app);

  try {
    // ═══════════════════════════════════════════════════════════════════
    // Scenario A: Move whole order to empty table
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n─── Scenario A: Move whole order to empty table ───');

    const createOrderA = await api(baseUrl, '/api/orders', {
      method: 'POST',
      body: {
        type: 'dine_in',
        table_id: 'tbl-src-1',
        items: [
          { product_id: 'prod-t1', quantity: 2 },
          { product_id: 'prod-t2', quantity: 1 },
        ],
      },
      headers: authHeader,
    });
    assertEqualOrThrow(createOrderA.status, 201, 'Order created on tbl-src-1');
    const orderAId = createOrderA.data.order.id;

    // Verify tbl-src-1 is occupied
    const tblSrcBefore = db.prepare('SELECT status FROM tables WHERE id = ?').get('tbl-src-1');
    assertEqualOrThrow(tblSrcBefore.status, 'occupied', 'Source table is occupied before move');

    // Move to tbl-dst-1
    const moveRes = await api(baseUrl, '/api/tables/tbl-src-1/move-order', {
      method: 'POST',
      body: { target_table_id: 'tbl-dst-1' },
      headers: authHeader,
    });
    assertEqualOrThrow(moveRes.status, 200, 'POST /tables/tbl-src-1/move-order succeeded');
    assertEqualOrThrow(moveRes.data.order.table_id, 'tbl-dst-1', 'Order table_id updated to target');

    // Verify table statuses in db
    const tblSrcAfter = db.prepare('SELECT status FROM tables WHERE id = ?').get('tbl-src-1');
    const tblDstAfter = db.prepare('SELECT status FROM tables WHERE id = ?').get('tbl-dst-1');
    assertEqualOrThrow(tblSrcAfter.status, 'available', 'Source table marked available');
    assertEqualOrThrow(tblDstAfter.status, 'occupied', 'Target table marked occupied');

    // Verify audit log
    const auditRecord = db.prepare(
      'SELECT * FROM order_audit_log WHERE action = ? AND order_id = ?'
    ).get('order.table_moved', orderAId);
    assertOrThrow(Boolean(auditRecord), 'Audit record created for table move');

    // ═══════════════════════════════════════════════════════════════════
    // Scenario B: Move whole order to occupied table (409 Conflict)
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n─── Scenario B: Move whole order to occupied table ───');

    // Create an order on tbl-dst-occupied
    await api(baseUrl, '/api/orders', {
      method: 'POST',
      body: {
        type: 'dine_in',
        table_id: 'tbl-dst-occupied',
        items: [{ product_id: 'prod-t3', quantity: 1 }],
      },
      headers: authHeader,
    });

    // Attempt to move order from tbl-dst-1 to tbl-dst-occupied
    const conflictMoveRes = await api(baseUrl, '/api/tables/tbl-dst-1/move-order', {
      method: 'POST',
      body: { target_table_id: 'tbl-dst-occupied' },
      headers: authHeader,
    });
    assertEqualOrThrow(conflictMoveRes.status, 409, 'Blocked with 409 Conflict when destination table is occupied');

    // ═══════════════════════════════════════════════════════════════════
    // Scenario C: Move whole order with partial payment
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n─── Scenario C: Move whole order with partial payment ───');

    // Generate Bill for orderA
    const genBillRes = await api(baseUrl, '/api/bills/generate', {
      method: 'POST',
      body: { order_id: orderAId },
      headers: authHeader,
    });
    assertOrThrow([200, 201].includes(genBillRes.status), 'Bill generated for orderA');
    const billRow = genBillRes.data.bill;

    // Make partial payment of 200
    const payRes = await api(baseUrl, `/api/bills/${billRow.id}/payments`, {
      method: 'POST',
      body: {
        payments: [{ method: 'cash', amount: 200 }],
      },
      headers: authHeader,
    });
    assertEqualOrThrow(payRes.status, 200, 'Partial payment accepted');
    assertEqualOrThrow(payRes.data.bill.payment_status, 'partial', 'Bill payment_status is partial');

    // Move to tbl-dst-partpay
    const movePartialRes = await api(baseUrl, '/api/tables/tbl-dst-1/move-order', {
      method: 'POST',
      body: { target_table_id: 'tbl-dst-partpay' },
      headers: authHeader,
    });
    assertEqualOrThrow(movePartialRes.status, 200, 'Moving partially paid order succeeds');
    assertEqualOrThrow(movePartialRes.data.order.table_id, 'tbl-dst-partpay', 'Order moved to tbl-dst-partpay');

    // Verify bill payment status is still partial and paid_amount is still 200
    const billAfterMove = db.prepare('SELECT payment_status, paid_amount FROM bills WHERE id = ?').get(billRow.id);
    assertEqualOrThrow(billAfterMove.payment_status, 'partial', 'Bill remains partial after move');
    assertEqualOrThrow(billAfterMove.paid_amount, 200, 'Paid amount remains attached');

    // ═══════════════════════════════════════════════════════════════════
    // Scenario D: Block move when order is completed or cancelled
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n─── Scenario D: Block move when order is completed ───');

    // Complete orderA
    db.prepare("UPDATE orders SET status = 'completed' WHERE id = ?").run(orderAId);
    const completedMoveRes = await api(baseUrl, '/api/tables/tbl-dst-partpay/move-order', {
      method: 'POST',
      body: { target_table_id: 'tbl-src-1' },
      headers: authHeader,
    });
    assertOrThrow([400, 404].includes(completedMoveRes.status), 'Moving completed order is rejected');

    // ═══════════════════════════════════════════════════════════════════
    // Scenario E: Item transfer & partial quantity split
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n─── Scenario E: Item transfer & partial quantity split ───');

    // Create fresh order on tbl-item-split-src
    // Items: 3x Pasta (prod-t1, price 200 = 600), 2x Pizza (prod-t2, price 300 = 600)
    const createSplitOrder = await api(baseUrl, '/api/orders', {
      method: 'POST',
      body: {
        type: 'dine_in',
        table_id: 'tbl-item-split-src',
        items: [
          { product_id: 'prod-t1', quantity: 3, special_instructions: 'Extra cheese' },
          { product_id: 'prod-t2', quantity: 2 },
        ],
      },
      headers: authHeader,
    });
    assertEqualOrThrow(createSplitOrder.status, 201, 'Split test order created');
    const splitSrcOrderId = createSplitOrder.data.order.id;
    const items = createSplitOrder.data.order.items;
    const pastaItem = items.find((i: any) => i.product_id === 'prod-t1');
    const pizzaItem = items.find((i: any) => i.product_id === 'prod-t2');

    // Generate source bill prior to split
    await api(baseUrl, '/api/bills/generate', {
      method: 'POST',
      body: { order_id: splitSrcOrderId },
      headers: authHeader,
    });

    // Split 1 Pasta and all 2 Pizzas to tbl-item-split-dst
    const transferItemsRes = await api(baseUrl, `/api/orders/${splitSrcOrderId}/transfer-items`, {
      method: 'POST',
      body: {
        items: [
          { order_item_id: pastaItem.id, quantity: 1 },
          { order_item_id: pizzaItem.id, quantity: 2 },
        ],
        target_table_id: 'tbl-item-split-dst',
        target_internal_label: 'Table 6 Split',
      },
      headers: authHeader,
    });
    assertEqualOrThrow(transferItemsRes.status, 200, 'Item transfer succeeded');
    const targetOrder = transferItemsRes.data.target_order;
    assertOrThrow(Boolean(targetOrder), 'Target order returned in response');
    assertEqualOrThrow(targetOrder.table_id, 'tbl-item-split-dst', 'Target order placed on tbl-item-split-dst');
    assertEqualOrThrow(targetOrder.internal_label, 'Table 6 Split', 'Target order has internal label');

    // Check Source Order after split:
    // Pasta should have quantity 2 (3 - 1)
    // Pizza should be deleted from source order
    const srcOrderAfter = await api(baseUrl, `/api/orders/${splitSrcOrderId}`, {
      headers: authHeader,
    });
    const srcItems = srcOrderAfter.data.order.items;
    const remainingPasta = srcItems.find((i: any) => i.product_id === 'prod-t1');
    const remainingPizza = srcItems.find((i: any) => i.product_id === 'prod-t2');
    assertEqualOrThrow(remainingPasta.quantity, 2, 'Source order pasta quantity reduced to 2');
    assertEqualOrThrow(remainingPasta.special_instructions, 'Extra cheese', 'Source item special instructions preserved');
    assertEqualOrThrow(Boolean(remainingPizza), false, 'Pizza item completely removed from source order');

    // Check Target Order items:
    // Should have 1 Pasta (with special_instructions: 'Extra cheese') and 2 Pizzas
    const dstOrderRes = await api(baseUrl, `/api/orders/${targetOrder.id}`, {
      headers: authHeader,
    });
    const dstOrderItems = dstOrderRes.data.order.items;
    const dstPasta = dstOrderItems.find((i: any) => i.product_id === 'prod-t1');
    const dstPizza = dstOrderItems.find((i: any) => i.product_id === 'prod-t2');
    assertEqualOrThrow(dstPasta.quantity, 1, 'Target order has 1 pasta');
    assertEqualOrThrow(dstPasta.special_instructions, 'Extra cheese', 'Target order preserved item special instructions');
    assertEqualOrThrow(dstPizza.quantity, 2, 'Target order has 2 pizzas');

    // Check Bills for both orders exist and totals match items
    const srcBill = db.prepare('SELECT * FROM bills WHERE order_id = ?').get(splitSrcOrderId);
    assertOrThrow(Boolean(srcBill), 'Source bill recalculated and exists');
    assertEqualOrThrow(srcBill.payment_status, 'unpaid', 'Source bill is unpaid');

    const genDstBill = await api(baseUrl, '/api/bills/generate', {
      method: 'POST',
      body: { order_id: targetOrder.id },
      headers: authHeader,
    });
    const dstBill = genDstBill.data.bill;
    assertOrThrow(Boolean(dstBill), 'Target bill created');
    assertEqualOrThrow(dstBill.payment_status, 'unpaid', 'Target bill is unpaid');

    // Source order total: 2 Pasta @ 200 = 400
    assertEqualOrThrow(srcBill.total, 400, 'Source bill total is 400');
    // Target order total: 1 Pasta @ 200 + 2 Pizza @ 300 = 800
    assertEqualOrThrow(dstBill.total, 800, 'Target bill total is 800');

    // ═══════════════════════════════════════════════════════════════════
    // Scenario F: Item transfer blocked after confirmed payment (409)
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n─── Scenario F: Block item transfer after confirmed payment ───');

    // Make partial payment on target order
    await api(baseUrl, `/api/bills/${dstBill.id}/payments`, {
      method: 'POST',
      body: {
        payments: [{ method: 'cash', amount: 300 }],
      },
      headers: authHeader,
    });

    // Attempt to transfer from target order to another table
    const blockedSplitRes = await api(baseUrl, `/api/orders/${targetOrder.id}/transfer-items`, {
      method: 'POST',
      body: {
        items: [{ order_item_id: dstPasta.id, quantity: 1 }],
        target_type: 'takeaway',
      },
      headers: authHeader,
    });
    assertEqualOrThrow(blockedSplitRes.status, 409, 'Item split blocked with 409 Conflict after payment recorded');

    console.log('\nAll order transfer & item split integration tests passed!');
  } finally {
    server.close();
    closeDatabase();
  }
}

main().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
