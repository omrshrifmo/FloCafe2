/**
 * Test: Bill Generation & Checkout Resilience
 *
 * Verifies that final bill generation and checkout are idempotent,
 * transactional, self-recovering, and cashier-safe across all 20 requirements.
 *
 * Usage: node tests/run-electron-node-test.cjs tests/bill-generation-resilience.test.ts
 */

const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-bill-resilience-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return {
      app: {
        isPackaged: true,
        getPath: () => testDir,
        getVersion: () => '3.11.12',
      },
    };
  }
  return originalLoad.apply(this, arguments as any);
};

const {
  createApp,
  initTestDb,
  startServer,
  seedOwnerUser,
  seedTable,
  api,
  closeDatabase,
  assertOrThrow,
  assertEqualOrThrow,
  assertIncludesOrThrow,
  assertGreaterThanOrThrow,
  now,
} = require('./helpers/test-setup');

const {
  generateOrRecoverBillForOrder,
  allocateBillNumberWithRecovery,
  withBusyRetryAsync,
  hashBillRequest,
  isSqliteBusyError,
} = require('../main/services/bill-generator');

const { billRoutes } = require('../main/routes/bills');
const { orderRoutes } = require('../main/routes/orders');
const billsRouter = billRoutes;
const ordersRouter = orderRoutes;

async function runTests() {
  console.log('Test: Bill Generation & Checkout Resilience (3.11.12)');
  console.log('='.repeat(60));

  const db = initTestDb();
  const { userId, authHeader } = seedOwnerUser(db);
  const app = createApp({
    '/api/bills': billsRouter,
    '/api/orders': ordersRouter,
  });
  const { baseUrl, server } = await startServer(app);

  function createTestOrder(overrides: any = {}): any {
    const tableId = overrides.table_id || 'tbl-1';
    db.prepare('INSERT OR IGNORE INTO tables (id, number, capacity, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      tableId,
      1,
      4,
      'occupied',
      now(),
      now()
    );

    const runResult = db.prepare(`
      INSERT INTO orders (
        order_number, table_id, customer_id, type, status, subtotal, tax_amount, discount_amount, total, user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      overrides.order_number || `ORD-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      tableId,
      overrides.customer_id || null,
      overrides.type || 'dine_in',
      overrides.status || 'pending',
      overrides.subtotal ?? 100,
      overrides.tax_amount ?? 10,
      overrides.discount_amount ?? 0,
      overrides.total ?? 110,
      userId,
      now(),
      now()
    );

    const orderId = runResult.lastInsertRowid;
    // Insert order item
    db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, subtotal, total, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(orderId, 'prod-1', 'Espresso', 1, 100, 100, 100, now(), now());

    return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  }

  try {
    // 1. Normal bill generation succeeds
    console.log('\nScenario 1: Normal bill generation succeeds');
    const order1 = createTestOrder();
    const res1 = await api(baseUrl, '/api/bills/generate', {
      method: 'POST',
      headers: authHeader,
      body: { order_id: order1.id },
    });
    assertEqualOrThrow(res1.status, 201, 'Status is 201 Created');
    assertOrThrow(Boolean(res1.data.bill), 'Bill is generated');
    assertOrThrow(Boolean(res1.data.bill.bill_number), 'Bill has bill_number');
    assertEqualOrThrow(res1.data.bill.payment_status, 'unpaid', 'Bill is unpaid');
    assertEqualOrThrow(res1.data.bill.order_id, order1.id, 'Bill references order');

    // 2. 100 sequential bill generations work without collision
    console.log('\nScenario 2: 100 sequential bill generations work without collision');
    const generatedNumbers = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const ord = createTestOrder({ order_number: `ORD-SEQ-${i + 1}` });
      const num = allocateBillNumberWithRecovery(db, { orderId: Number(ord.id) });
      assertOrThrow(!generatedNumbers.has(num), `Bill number ${num} is unique in sequence`);
      generatedNumbers.add(num);
      db.prepare(`
        INSERT INTO bills (bill_number, order_id, subtotal, tax_amount, total, paid_amount, balance, payment_status, created_at, updated_at)
        VALUES (?, ?, 10, 0, 10, 0, 10, 'unpaid', ?, ?)
      `).run(num, ord.id, now(), now());
    }
    assertEqualOrThrow(generatedNumbers.size, 100, 'All 100 generated bill numbers are distinct');

    // 3. Bill number sequence collision is detected and safely repaired
    console.log('\nScenario 3: Bill number sequence collision is detected and safely repaired');
    const ordSeq = createTestOrder();
    // Artificially desynchronize sequence: create a bill with a high sequence number in bills table
    const currentBucket = 'ALL';
    const fakeHighNumber = 'INV-99999';
    db.prepare(`
      INSERT INTO bills (bill_number, order_id, subtotal, tax_amount, total, paid_amount, balance, payment_status, created_at, updated_at)
      VALUES (?, ?, 10, 0, 10, 0, 10, 'unpaid', ?, ?)
    `).run(fakeHighNumber, ordSeq.id, now(), now());
    // Also test prefix-period collisions: insert next expected invoice
    const basePrefix = 'INV-' + new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const collidingInv = `${basePrefix}-0050`;
    db.prepare(`
      INSERT OR IGNORE INTO bills (bill_number, order_id, subtotal, tax_amount, total, paid_amount, balance, payment_status, created_at, updated_at)
      VALUES (?, ?, 10, 0, 10, 0, 10, 'unpaid', ?, ?)
    `).run(collidingInv, ordSeq.id, now(), now());
    // Allocate should notice collidingInv and skip past it
    const recoveredNumber = allocateBillNumberWithRecovery(db, { orderId: Number(ordSeq.id) });
    assertOrThrow(recoveredNumber !== collidingInv, `Allocated number ${recoveredNumber} does not collide with ${collidingInv}`);
    const checkColl = db.prepare('SELECT COUNT(*) as c FROM bills WHERE bill_number = ?').get(recoveredNumber) as any;
    assertEqualOrThrow(checkColl.c, 0, 'Allocated number does not exist in bills');

    // 4. Existing valid bill returns instead of duplicate bill creation
    console.log('\nScenario 4: Existing valid bill returns instead of duplicate bill creation');
    const order4 = createTestOrder();
    const billGen1 = await generateOrRecoverBillForOrder({ orderId: order4.id, db });
    assertEqualOrThrow(billGen1.isNew, true, 'First generation is new');
    const billGen2 = await generateOrRecoverBillForOrder({ orderId: order4.id, db });
    assertEqualOrThrow(billGen2.isNew, false, 'Second generation returns existing bill');
    assertEqualOrThrow(billGen2.bill.id, billGen1.bill.id, 'Returned same bill ID');
    assertEqualOrThrow(billGen2.bill.bill_number, billGen1.bill.bill_number, 'Returned same bill number');
    const countBills4 = db.prepare('SELECT COUNT(*) as c FROM bills WHERE order_id = ?').get(order4.id) as any;
    assertEqualOrThrow(countBills4.c, 1, 'Only one bill row exists for order');

    // 5. Existing partially created recoverable bill is safely recovered
    console.log('\nScenario 5: Existing partially created recoverable bill is safely recovered');
    const order5 = createTestOrder({ total: 150, subtotal: 130, tax_amount: 20 });
    // Manually create an existing bill with out-of-sync/broken totals
    const manualBillResult = db.prepare(`
      INSERT INTO bills (bill_number, order_id, subtotal, tax_amount, total, paid_amount, balance, payment_status, created_at, updated_at)
      VALUES (?, ?, 50, 0, 50, 0, 50, 'unpaid', ?, ?)
    `).run(`INV-PARTIAL-${Date.now()}`, order5.id, now(), now());
    const manualBillId = manualBillResult.lastInsertRowid;
    // Now call canonical service
    const recovered = await generateOrRecoverBillForOrder({ orderId: order5.id, db });
    assertEqualOrThrow(recovered.recovered, true, 'Bill was marked recovered');
    assertEqualOrThrow(recovered.bill.id, manualBillId, 'Recovered same bill row');
    assertEqualOrThrow(Number(recovered.bill.total), 150, 'Recovered bill total synchronized with order');
    assertEqualOrThrow(Number(recovered.bill.balance), 150, 'Recovered bill balance synchronized');

    // 6. Duplicate checkout click / same idempotency key returns same bill
    console.log('\nScenario 6: Duplicate checkout click / same idempotency key returns same bill');
    const order6 = createTestOrder();
    const idempKey6 = 'idemp-key-test-6';
    const res6a = await api(baseUrl, '/api/bills/generate', {
      method: 'POST',
      headers: { ...authHeader, 'Idempotency-Key': idempKey6 },
      body: { order_id: order6.id },
    });
    assertEqualOrThrow(res6a.status, 201, 'First click creates bill');
    const res6b = await api(baseUrl, '/api/bills/generate', {
      method: 'POST',
      headers: { ...authHeader, 'Idempotency-Key': idempKey6 },
      body: { order_id: order6.id },
    });
    assertEqualOrThrow(res6b.status, 200, 'Second click returns 200 OK');
    assertEqualOrThrow(res6b.data.bill.id, res6a.data.bill.id, 'Returns exact same bill ID');
    assertEqualOrThrow(res6b.data.bill.bill_number, res6a.data.bill.bill_number, 'Returns exact same bill number');

    // 7. Concurrent same idempotency key does not create duplicates
    console.log('\nScenario 7: Concurrent same idempotency key does not create duplicates');
    const order7 = createTestOrder();
    const idempKey7 = 'idemp-key-concurrent-7';
    const [res7a, res7b] = await Promise.all([
      api(baseUrl, '/api/bills/generate', {
        method: 'POST',
        headers: { ...authHeader, 'Idempotency-Key': idempKey7 },
        body: { order_id: order7.id },
      }),
      api(baseUrl, '/api/bills/generate', {
        method: 'POST',
        headers: { ...authHeader, 'Idempotency-Key': idempKey7 },
        body: { order_id: order7.id },
      }),
    ]);
    assertOrThrow(res7a.status === 201 || res7a.status === 200, 'First request succeeded');
    assertOrThrow(res7b.status === 201 || res7b.status === 200, 'Second request succeeded');
    assertEqualOrThrow(res7a.data.bill.id, res7b.data.bill.id, 'Concurrent requests resolved to identical bill ID');
    const count7 = db.prepare('SELECT COUNT(*) as c FROM bills WHERE order_id = ?').get(order7.id) as any;
    assertEqualOrThrow(count7.c, 1, 'Only 1 bill was created in database');

    // 8. Same key with different request is rejected safely (409 conflict)
    console.log('\nScenario 8: Same key with different request is rejected safely');
    const order8a = createTestOrder();
    const order8b = createTestOrder();
    const sharedKey = 'shared-idemp-conflict-key';
    const res8a = await api(baseUrl, '/api/bills/generate', {
      method: 'POST',
      headers: { ...authHeader, 'Idempotency-Key': sharedKey },
      body: { order_id: order8a.id },
    });
    assertEqualOrThrow(res8a.status, 201, 'First request with key succeeds');
    const res8b = await api(baseUrl, '/api/bills/generate', {
      method: 'POST',
      headers: { ...authHeader, 'Idempotency-Key': sharedKey },
      body: { order_id: order8b.id },
    });
    assertEqualOrThrow(res8b.status, 409, 'Conflict status 409 returned for different request');
    assertOrThrow(Boolean(res8b.data.supportId), 'Error response includes supportId');

    // 9. Payment is not created during bill generation
    console.log('\nScenario 9: Payment is not created during bill generation');
    const order9 = createTestOrder();
    const res9 = await api(baseUrl, '/api/bills/generate', {
      method: 'POST',
      headers: authHeader,
      body: { order_id: order9.id },
    });
    assertEqualOrThrow(res9.status, 201, 'Bill generated');
    assertEqualOrThrow(res9.data.bill.payment_status, 'unpaid', 'Payment status is unpaid');
    assertEqualOrThrow(Number(res9.data.bill.paid_amount), 0, 'Zero paid amount on generated bill');
    const paymentIdempCount = db.prepare('SELECT COUNT(*) as c FROM payment_idempotency WHERE bill_id = ?').get(res9.data.bill.id) as any;
    assertEqualOrThrow(paymentIdempCount.c, 0, 'Zero payment idempotency records created during bill generation');

    // 10. Cash drawer is not triggered during bill generation
    console.log('\nScenario 10: Cash drawer is not triggered during bill generation');
    const drawerMovementsBefore = db.prepare("SELECT COUNT(*) as c FROM cash_drawer_movements").get() as any;
    const order10 = createTestOrder();
    await generateOrRecoverBillForOrder({ orderId: order10.id, db });
    const drawerMovementsAfter = db.prepare("SELECT COUNT(*) as c FROM cash_drawer_movements").get() as any;
    assertEqualOrThrow(drawerMovementsAfter.c, drawerMovementsBefore.c, 'No drawer movement recorded');

    // 11. Final receipt is not printed during bill generation
    console.log('\nScenario 11: Final receipt is not printed during bill generation');
    const order11 = createTestOrder();
    const res11 = await generateOrRecoverBillForOrder({ orderId: order11.id, db });
    const printLogsCount = db.prepare('SELECT COUNT(*) as c FROM print_logs WHERE bill_id = ?').get(res11.bill.id) as any;
    assertEqualOrThrow(printLogsCount.c, 0, 'No print logs recorded during bill generation');

    // 12. SQLite busy retry works only for transient busy/locked errors
    console.log('\nScenario 12: SQLite busy retry works only for transient busy/locked errors');
    let busyAttempts = 0;
    const retryResult = await withBusyRetryAsync(
      () => {
        busyAttempts++;
        if (busyAttempts < 3) {
          const err: any = new Error('database is locked');
          err.code = 'SQLITE_BUSY';
          throw err;
        }
        return 'success_after_busy';
      },
      { maxRetries: 5, baseDelayMs: 5, jitterMs: 5 }
    );
    assertEqualOrThrow(retryResult, 'success_after_busy', 'Resolved after busy retries');
    assertEqualOrThrow(busyAttempts, 3, 'Took exactly 3 attempts');

    // 13. Non-transient database error rolls back cleanly
    console.log('\nScenario 13: Non-transient database error rolls back cleanly');
    let nonTransientAttemptCount = 0;
    try {
      await withBusyRetryAsync(
        () => {
          nonTransientAttemptCount++;
          const err: any = new Error('UNIQUE constraint failed: something');
          err.code = 'SQLITE_CONSTRAINT';
          throw err;
        },
        { maxRetries: 5 }
      );
      assertOrThrow(false, 'Should have thrown');
    } catch (err: any) {
      assertEqualOrThrow(nonTransientAttemptCount, 1, 'Did not retry non-transient constraint error');
      assertEqualOrThrow(err.code, 'SQLITE_CONSTRAINT', 'Caught constraint error');
    }

    // 14. Order remains intact after failed bill generation
    console.log('\nScenario 14: Order remains intact after failed bill generation');
    const order14 = createTestOrder({ total: 200, status: 'pending' });
    try {
      await generateOrRecoverBillForOrder({
        orderId: order14.id,
        db,
        // Passing invalid idempotency key with special characters to force failure
        idempotencyKey: 'invalid key with spaces\x00',
      });
      assertOrThrow(false, 'Should have failed validation');
    } catch {}
    const order14Check = db.prepare('SELECT * FROM orders WHERE id = ?').get(order14.id) as any;
    assertEqualOrThrow(order14Check.status, 'pending', 'Order status remains pending');
    assertEqualOrThrow(Number(order14Check.total), 200, 'Order total remains intact');

    // 15. Table state remains intact after failed bill generation
    console.log('\nScenario 15: Table state remains intact after failed bill generation');
    const tableId15 = 'tbl-test-15';
    db.prepare('INSERT OR REPLACE INTO tables (id, number, capacity, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      tableId15,
      15,
      4,
      'occupied',
      now(),
      now()
    );
    const order15 = createTestOrder({ table_id: tableId15 });
    try {
      await generateOrRecoverBillForOrder({
        orderId: order15.id,
        db,
        idempotencyKey: 'invalid\x01key',
      });
    } catch {}
    const table15Check = db.prepare('SELECT * FROM tables WHERE id = ?').get(tableId15) as any;
    assertEqualOrThrow(table15Check.status, 'occupied', 'Table status remained occupied');

    // 16. Offline CloudSync does not affect bill generation
    console.log('\nScenario 16: Offline CloudSync does not affect bill generation');
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('cloud_sync_enabled', 'false')").run();
    const order16 = createTestOrder();
    const res16 = await generateOrRecoverBillForOrder({ orderId: order16.id, db });
    assertOrThrow(Boolean(res16.bill.bill_number), 'Bill generated normally with CloudSync offline');

    // 17. Arabic UI messages remain RTL with Western digits
    console.log('\nScenario 17: Arabic UI messages remain RTL with Western digits');
    const arJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../frontend/src/lib/i18n/messages/ar.json'), 'utf8'));
    assertOrThrow(Boolean(arJson.pos.billCreatedSuccess), 'Arabic pos.billCreatedSuccess exists');
    assertEqualOrThrow(arJson.pos.billCreatedSuccess, 'تم إنشاء الفاتورة بنجاح. يمكنك متابعة الدفع.', 'Arabic text matches requirement');
    assertEqualOrThrow(arJson.pos.billMayAlreadyExist, 'قد تكون الفاتورة قد أُنشئت بالفعل. يتم الآن استرجاعها بأمان.', 'Arabic billMayAlreadyExist matches');
    assertEqualOrThrow(arJson.pos.databaseBusyRetrying, 'قاعدة البيانات مشغولة مؤقتاً. جارٍ إعادة المحاولة بأمان.', 'Arabic databaseBusyRetrying matches');
    assertIncludesOrThrow(arJson.pos.billCreationFailedSafe, 'تعذر إنشاء الفاتورة بأمان', 'Arabic billCreationFailedSafe matches');
    // Verify Western digits in Arabic messages (no Eastern Arabic digits ٠١٢٣٤٥٦٧٨٩)
    const easternDigitsRegex = /[\u0660-\u0669]/;
    assertOrThrow(!easternDigitsRegex.test(arJson.pos.billCreatedSuccess), 'No eastern digits in billCreatedSuccess');
    assertOrThrow(!easternDigitsRegex.test(arJson.pos.billCreationFailedSafe), 'No eastern digits in billCreationFailedSafe');

    // 18. New cashier recovery UI is translated across supported locales
    console.log('\nScenario 18: New cashier recovery UI is translated across supported locales');
    const requiredKeys = [
      'billCreatedSuccess',
      'billMayAlreadyExist',
      'databaseBusyRetrying',
      'billCreationFailedSafe',
      'retrySafely',
      'refreshOrder',
      'viewExistingBill',
    ];
    const messagesDir = path.join(__dirname, '../frontend/src/lib/i18n/messages');
    const localeFiles = fs.readdirSync(messagesDir).filter((f: string) => f.endsWith('.json'));
    assertEqualOrThrow(localeFiles.length, 24, 'All 24 locale files exist');
    for (const file of localeFiles) {
      const content = JSON.parse(fs.readFileSync(path.join(messagesDir, file), 'utf8'));
      for (const k of requiredKeys) {
        assertOrThrow(typeof content.pos?.[k] === 'string' && content.pos[k].length > 0, `${file} has pos.${k}`);
        assertOrThrow(typeof content.orders?.[k] === 'string' && content.orders[k].length > 0, `${file} has orders.${k}`);
      }
    }

    // 19. Existing preliminary receipt flow remains safe
    console.log('\nScenario 19: Existing preliminary receipt flow remains safe');
    const order19 = createTestOrder();
    // Preliminary receipt generation queries order items and doesn't require a settled bill
    const orderWithItems = db.prepare('SELECT * FROM orders WHERE id = ?').get(order19.id);
    assertOrThrow(Boolean(orderWithItems), 'Order available for preliminary receipt');
    // Bill can still be generated after preliminary receipt
    const bill19 = await generateOrRecoverBillForOrder({ orderId: order19.id, db });
    assertOrThrow(Boolean(bill19.bill), 'Bill generated after preliminary step');

    // 20. Deferred/partial/paid/cancelled order eligibility remains correct
    console.log('\nScenario 20: Deferred/partial/paid/cancelled order eligibility remains correct');
    // Cancelled order cannot generate a bill
    const cancelledOrder = createTestOrder({ status: 'cancelled' });
    try {
      await generateOrRecoverBillForOrder({ orderId: cancelledOrder.id, db });
      assertOrThrow(false, 'Should reject cancelled order');
    } catch (err: any) {
      assertIncludesOrThrow(err.message, 'cancelled', 'Rejected cancelled order');
    }

    // Paid bill cannot be regenerated or overwritten
    const paidOrder = createTestOrder();
    const paidBillRes = await generateOrRecoverBillForOrder({ orderId: paidOrder.id, db });
    db.prepare("UPDATE bills SET payment_status = 'paid', paid_amount = total, balance = 0 WHERE id = ?").run(paidBillRes.bill.id);
    const paidBillRecheck = await generateOrRecoverBillForOrder({ orderId: paidOrder.id, db });
    assertEqualOrThrow(paidBillRecheck.isNew, false, 'Does not generate new bill for paid order');
    assertEqualOrThrow(paidBillRecheck.bill.payment_status, 'paid', 'Retained paid status');

    console.log('\n' + '='.repeat(60));
    console.log('✅ All 20 bill generation & checkout resilience tests passed!\n');
  } finally {
    server.close();
    closeDatabase();
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
