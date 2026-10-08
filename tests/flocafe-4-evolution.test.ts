import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import assert from 'node:assert/strict';

const Module = require('module');
const originalLoad = Module._load;
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-4-test-'));

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return {
      app: {
        isPackaged: true,
        getPath: () => testDir,
        getVersion: () => '4.0.0',
      },
    };
  }
  return originalLoad.apply(this, arguments as any);
};

process.env.JWT_SECRET = 'test-secret-4-evolution';

import { initDatabase, getDatabase, closeDatabase, now, setSettingValue, getSettingValue } from '../main/db';
import { recordFinanceMovement, reverseFinanceMovement, getFinanceSummary } from '../main/services/finance';
import {
  createStocktakeSession,
  addStocktakeCount,
  completeStocktakeSession,
  getVarianceReport,
} from '../main/services/inventory-extended';
import {
  createEmployee,
  createAdvanceOrLoan,
  clockIn,
  clockOut,
  createPayrollRun,
  approvePayrollRun,
} from '../main/services/hr';
import {
  createHaccpTask,
  recordHaccpLog,
  verifyHaccpLog,
  getDailyHaccpReport,
} from '../main/services/haccp';
import {
  generateSignedTableToken,
  verifySignedTableToken,
  submitCustomerQrOrder,
  confirmCustomerQrOrder,
  createCustomerWaiterRequest,
} from '../main/services/customer-qr';
import { DeliveryService } from '../main/services/delivery-adapter';
import { TunnelService } from '../main/services/tunnel';
import { requireOpenSessionForOrder } from '../main/services/shift-session-gate';
import { roundQuantity } from '../main/services/recipes';

async function runTests() {
  console.log('--- Starting FloCafe 4.0.0 Evolution Test Suite ---');
  initDatabase(false, false);
  const db = getDatabase();

  // Seed test user, category, and product for FK references
  db.prepare(`
    INSERT INTO users (id, name, email, password, role, is_active, created_at, updated_at)
    VALUES ('user_admin', 'Admin User', 'admin@flocafe.test', 'hash', 'owner', 1, ?, ?)
  `).run(now(), now());



  db.prepare(`
    INSERT INTO categories (id, name, sort_order, is_active, created_at, updated_at)
    VALUES ('cat_coffee', 'Coffee', 1, 1, ?, ?)
  `).run(now(), now());

  db.prepare(`
    INSERT INTO products (id, category_id, name, price, is_active, created_at, updated_at)
    VALUES ('prod_coffee', 'cat_coffee', 'Latte', 50.0, 1, ?, ?)
  `).run(now(), now());


  // Test 1: Finance movements & Reversals (additive, no CHECK constraint failures)
  console.log('Testing Finance Movements...');
  const expMovement = recordFinanceMovement(db, {
    businessDate: '2026-10-08',
    movementType: 'expense',
    amountCents: 5000,
    direction: 'out',
    category: 'utilities',
    description: 'Electric bill',
    createdBy: 'admin',
    paymentMethod: 'cash',
  }) as any;
  assert.equal(expMovement.amount_cents, 5000);
  assert.equal(expMovement.movement_type, 'expense');

  const revMovement = reverseFinanceMovement(db, expMovement.id, 'admin', 'Mistake in amount') as any;
  assert.equal(revMovement.is_reversal, 1);
  assert.equal(revMovement.reversal_of_id, expMovement.id);
  assert.equal(revMovement.amount_cents, 5000);

  const summary = getFinanceSummary(db, { businessDate: '2026-10-08' });
  assert.ok(summary);

  // Test 2: Stocktake and Physical Count Variance
  console.log('Testing Stocktake and Inventory Variance...');
  // Seed a supply item
  db.prepare(`
    INSERT INTO supplies (id, name, base_unit, stock_quantity, cost_cents, is_active, created_at, updated_at)
    VALUES ('sup_test_coffee', 'Coffee Beans', 'kg', 10.0, 5000, 1, ?, ?)
  `).run(now(), now());

  const session = createStocktakeSession(db, {
    isBlind: true,
    createdBy: 'manager',
    notes: 'Weekly count',
  }) as any;
  assert.equal(session.is_blind, 1);
  assert.equal(session.status, 'in_progress');

  const countedItem = addStocktakeCount(db, {
    sessionId: session.id,
    supplyId: 'sup_test_coffee',
    countedQuantity: 8.5,
  }) as any;
  assert.equal(countedItem.expected_quantity, 10.0);
  assert.equal(countedItem.counted_quantity, 8.5);
  assert.equal(countedItem.variance_quantity, -1.5);

  const completedSession = completeStocktakeSession(db, session.id, 'user_admin') as any;
  assert.equal(completedSession.status, 'completed');


  // Verify supply stock was updated to counted 8.5
  const updatedSupply = db.prepare('SELECT stock_quantity FROM supplies WHERE id = ?').get('sup_test_coffee') as any;
  assert.equal(updatedSupply.stock_quantity, 8.5);

  const varianceReport = getVarianceReport(db);
  assert.ok(Array.isArray(varianceReport));
  const coffeeVariance = varianceReport.find((v) => v.supply_id === 'sup_test_coffee');
  assert.ok(coffeeVariance);
  assert.equal(coffeeVariance.variance_quantity, -1.5);

  // Test 3: Recipe snapshots and partial prorate
  console.log('Testing Partial Item Transfer Prorate Calculation...');
  const origSnapshot = {
    components: [
      { supply_id: 'sup_test_coffee', quantity: 2.0 },
      { supply_id: 'sup_test_milk', quantity: 1.0 },
    ],
  };
  const qOrig = 4;
  const qMoved = 1;
  const ratio = qMoved / qOrig; // 0.25
  const movedComponents = origSnapshot.components.map((c) => ({
    ...c,
    quantity: roundQuantity(c.quantity * ratio),
  }));
  const remainingComponents = origSnapshot.components.map((c) => ({
    ...c,
    quantity: roundQuantity(c.quantity * (1 - ratio)),
  }));

  assert.equal(movedComponents[0].quantity, 0.5);
  assert.equal(remainingComponents[0].quantity, 1.5);
  assert.equal(movedComponents[0].quantity + remainingComponents[0].quantity, 2.0);

  // Test 4: HR and Payroll
  console.log('Testing HR and Payroll Runs...');
  const emp = createEmployee(db, {
    name: 'Ahmed Barista',
    role: 'staff',
    baseSalaryCents: 600000, // 6000 EGP
  }) as any;
  assert.equal(emp.name, 'Ahmed Barista');

  const advance = createAdvanceOrLoan(db, {
    employeeId: emp.id,
    type: 'advance',
    amountCents: 100000, // 1000 EGP
    installmentCents: 100000,
    approvedBy: 'owner',
    disburseNow: true,
  }) as any;
  assert.equal(advance.amount_cents, 100000);

  const att = clockIn(db, emp.id) as any;
  assert.equal(att.employee_id, emp.id);
  assert.equal(att.status, 'present');

  const clockedOut = clockOut(db, emp.id) as any;
  assert.ok(clockedOut.clock_out);

  const payrollRun = createPayrollRun(db, {
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    createdBy: 'owner',
  }) as any;
  assert.equal(payrollRun.status, 'draft');
  assert.ok(payrollRun.total_gross_cents >= 600000);

  const approvedRun = approvePayrollRun(db, payrollRun.id, 'owner', true) as any;
  assert.equal(approvedRun.status, 'approved');

  // Verify advance remaining was deducted
  const updatedAdvance = db.prepare('SELECT remaining_cents, status FROM employee_advances_loans WHERE id = ?').get(advance.id) as any;
  assert.equal(updatedAdvance.remaining_cents, 0);
  assert.equal(updatedAdvance.status, 'paid');

  // Test 5: HACCP & Food Safety Operations
  console.log('Testing HACCP / Cleaning Operations...');
  const task = createHaccpTask(db, {
    title: 'Espresso Machine Backflush',
    category: 'cleaning',
    frequency: 'daily',
  }) as any;
  assert.equal(task.title, 'Espresso Machine Backflush');

  const log = recordHaccpLog(db, {
    taskId: task.id,
    businessDate: '2026-10-08',
    status: 'passed',
    completedBy: emp.id,
  }) as any;
  assert.equal(log.status, 'passed');

  const verified = verifyHaccpLog(db, log.id, 'owner') as any;
  assert.equal(verified.verified_by, 'owner');

  const haccpReport = getDailyHaccpReport(db, '2026-10-08');
  assert.equal(haccpReport.compliancePercent, 100);

  // Test 6: Signed Customer QR Table Ordering
  console.log('Testing Customer QR Token Signing and Ordering...');
  db.prepare(`
    INSERT INTO tables (id, number, section, status, created_at, updated_at)
    VALUES ('tbl_test_4', 'Table 4', 'Main', 'available', ?, ?)
  `).run(now(), now());


  const tokenRes = generateSignedTableToken('tbl_test_4', 24);
  assert.ok(tokenRes.token);

  const verifyRes = verifySignedTableToken(tokenRes.token);
  assert.equal(verifyRes.valid, true);
  assert.equal(verifyRes.tableId, 'tbl_test_4');

  const qrOrder = submitCustomerQrOrder(db, {
    tableId: 'tbl_test_4',
    token: tokenRes.token,
    customerName: 'Samir',
    items: [{ productId: 'prod_coffee', name: 'Latte', quantity: 2, unitPrice: 50 }],
  }) as any;
  assert.equal(qrOrder.status, 'submitted_by_customer');
  assert.equal(qrOrder.total_amount, 100);

  // Test 7: Shift Gate Validation
  console.log('Testing Open-Shift Gate...');
  setSettingValue('require_open_shift', 'true');
  setSettingValue('require_open_shift_for_orders', 'true');
  // No open session in cash_sessions, so requireOpenSessionForOrder must throw
  let threwShiftError = false;
  try {
    requireOpenSessionForOrder(db);
  } catch (err: any) {
    threwShiftError = true;
    assert.equal(err.code, 'NO_ACTIVE_SHIFT');
  }
  assert.equal(threwShiftError, true, 'Shift gate must reject order when no shift is open');

  // Open shift session to test pass
  db.prepare(`
    INSERT INTO cash_sessions (opened_by, opened_by_name, opened_at, opening_float_cents, status)
    VALUES ('user_admin', 'Admin', ?, 10000, 'open')
  `).run(now());

  // Should not throw now
  requireOpenSessionForOrder(db);

  // Staff confirms customer QR order at table
  const confirmed = confirmCustomerQrOrder(db, qrOrder.id, 'user_admin');
  assert.equal(confirmed.status, 'accepted');
  assert.ok(confirmed.orderId);


  // Test 8: Delivery Adapter & Idempotent Ingestion
  console.log('Testing Delivery Adapter Idempotency...');
  const delIngest1 = DeliveryService.ingestOrder(db, {
    provider: 'talabat',
    providerOrderId: 'talabat_order_123',
    customerInfo: { name: 'Mona', phone: '01012345678' },
    items: [{ productId: 'prod_coffee', name: 'Latte', quantity: 1, unitPrice: 50 }],
    rawPayload: { items: [{ productId: 'prod_coffee', quantity: 1, unitPrice: 50 }] },
  });
  assert.equal(delIngest1.isDuplicate, false);

  // Repeat same order -> must report duplicate and NOT insert again
  const delIngest2 = DeliveryService.ingestOrder(db, {
    provider: 'talabat',
    providerOrderId: 'talabat_order_123',
    customerInfo: { name: 'Mona', phone: '01012345678' },
    items: [{ productId: 'prod_coffee', name: 'Latte', quantity: 1, unitPrice: 50 }],
    rawPayload: {},
  });
  assert.equal(delIngest2.isDuplicate, true);
  assert.equal(delIngest2.order.id, delIngest1.order.id);

  // Test 9: Tunnel Safe Defaults & Emergency Kill Switch
  console.log('Testing Tunnl.gg Safe Configuration & Kill Switch...');
  const tunnelInitial = TunnelService.getStatus();
  assert.equal(tunnelInitial.enabled, false, 'Tunnel must be disabled by default');

  const killed = TunnelService.emergencyKill();
  assert.equal(killed.status, 'killed');
  assert.equal(killed.killSwitchActive, true);

  TunnelService.resetKillSwitch();
  assert.equal(TunnelService.getStatus().killSwitchActive, false);

  closeDatabase();
  console.log('✓ All FloCafe 4.0.0 Evolution Tests Passed Cleanly!');
}

runTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
