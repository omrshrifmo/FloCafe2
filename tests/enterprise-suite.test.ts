/**
 * FloCafe Release 4.0.5 Enterprise Operations, Costing, Stocktaking, HACCP, HRM & Finance Suite
 * Integration Test Suite
 *
 * Verifies:
 * 1. Non-destructive SQLite migration v105 schema verification.
 * 2. Automated BOM gross-quantity deduction (net / (1 - waste%)) and refund restoration.
 * 3. Purchase Order GRN weighted-average unit cost recalculation and stock_logs audit.
 * 4. Physical stocktake variance calculation and inventory reconciliation.
 * 5. Automated monthly loan installment deduction and loan settlement during payroll disbursement.
 */
const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-enterprise-test-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => '4.0.5' } };
  }
  return originalLoad.apply(this, arguments as any);
};

const {
  initTestDb, createApp, startServer,
  seedOwnerUser, seedCategory, seedProduct,
  api, assertOrThrow, assertEqualOrThrow, resetCounters, closeDatabase,
} = require('./helpers/test-setup');
const { registerRoutes } = require('../main/routes/index');
const { randomUUID } = require('crypto');

async function main() {
  console.log('FloCafe 4.0.5 Enterprise Suite Integration Test');
  console.log('='.repeat(70));
  resetCounters();

  const db = initTestDb();
  const { authHeader, userId } = seedOwnerUser(db);
  seedCategory(db, 'cat-ent', 'Enterprise Category');
  seedProduct(db, 'prod-espresso', 'cat-ent', 'Espresso Blend', 120, { track_inventory: false, stock_quantity: 0 });

  const app = createApp({});
  registerRoutes(app);
  const { baseUrl, server } = await startServer(app);

  try {
    // ── Test 1: Non-destructive SQLite migration v105 schema verification ──────
    console.log('\n[1] Verifying Release 4.0.5 Schema Migration (v105)...');
    const userVersion = db.pragma('user_version', { simple: true });
    assertOrThrow(userVersion >= 105, `Schema user_version is ${userVersion} (expected >= 105)`);

    const tables = [
      'stock_logs', 'cash_movements', 'operating_expenses', 'suppliers',
      'purchase_orders', 'purchase_order_items', 'stocktake_sessions', 'stocktake_lines',
      'bom_headers', 'bom_components', 'haccp_ccp_logs', 'haccp_checklists', 'haccp_batches',
      'hr_employee_profiles', 'hr_attendance_summaries', 'hr_employee_loans', 'hr_payroll_runs',
    ];
    for (const tbl of tables) {
      const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(tbl);
      assertOrThrow(Boolean(exists), `Table '${tbl}' exists in SQLite database`);
    }

    // Verify extended columns
    const invCols = db.prepare(`PRAGMA table_info(inventory_items)`).all().map((c: any) => c.name);
    assertOrThrow(invCols.includes('sku') && invCols.includes('critical_level') && invCols.includes('last_counted_qty'), 'inventory_items has sku, critical_level, last_counted_qty');

    const supCols = db.prepare(`PRAGMA table_info(supplies)`).all().map((c: any) => c.name);
    assertOrThrow(supCols.includes('critical_level') && supCols.includes('last_counted_qty'), 'supplies has critical_level, last_counted_qty');

    // ── Test 2: BOM Gross-Quantity Calculation & Depletion on Orders ──────────
    console.log('\n[2] Verifying BOM Gross-Quantity Depletion & Refund Restoration...');
    const coffeeBeanId = randomUUID();
    db.prepare(`
      INSERT INTO inventory_items (id, name, sku, category, unit, quantity, cost_per_unit, reorder_level, critical_level, is_active, created_at, updated_at)
      VALUES (?, 'Arabica Coffee Beans', 'COF-001', 'ingredient', 'g', 1000, 0.15, 200, 100, 1, datetime('now'), datetime('now'))
    `).run(coffeeBeanId);

    // BOM: Net 80g with 20% waste -> Gross = 80 / (1 - 0.20) = 100g
    const bomHeaderId = randomUUID();
    db.prepare(`
      INSERT INTO bom_headers (id, product_id, yield_portions, prep_time_minutes, direct_labor_rate_per_hour, target_food_cost_pct, updated_at)
      VALUES (?, 'prod-espresso', 1, 2, 60, 30, datetime('now'))
    `).run(bomHeaderId);

    const bomCompId = randomUUID();
    db.prepare(`
      INSERT INTO bom_components (id, bom_id, target_type, target_id, component_name, unit, net_quantity, waste_pct, gross_quantity, created_at, updated_at)
      VALUES (?, ?, 'inventory', ?, 'Arabica Coffee Beans', 'g', 80, 20, 100, datetime('now'), datetime('now'))
    `).run(bomCompId, bomHeaderId, coffeeBeanId);

    // Place an order for 2 Espressos -> Should deplete 2 * 100g = 200g
    const orderRes = await api(baseUrl, '/api/orders', {
      method: 'POST',
      headers: authHeader,
      body: {
        table_id: null,
        type: 'takeaway',
        customer_count: 1,
        items: [
          { product_id: 'prod-espresso', quantity: 2, unit_price: 120 },
        ],
      },
    });
    assertEqualOrThrow(orderRes.status, 201, 'Order created successfully');
    const orderId = orderRes.data.order.id;

    // Verify depleted quantity: 1000 - 200 = 800g
    const beanRowAfterOrder = db.prepare('SELECT quantity FROM inventory_items WHERE id = ?').get(coffeeBeanId);
    assertEqualOrThrow(Number(beanRowAfterOrder.quantity), 800, 'Inventory depleted by gross quantity (2 * 100g = 200g)');

    // Verify stock_logs audit entry
    const logOrder = db.prepare(`SELECT * FROM stock_logs WHERE target_id = ? AND reason LIKE 'POS Order %'`).get(coffeeBeanId);
    assertOrThrow(Boolean(logOrder), 'stock_logs contains POS Order deduction audit entry');

    // Refund order item with waste = false -> stock should be restored to 1000g
    const orderItems = db.prepare('SELECT id FROM order_items WHERE order_id = ?').all(orderId);
    const orderItemId = orderItems[0].id;

    const refundRes = await api(baseUrl, `/api/refunds/items/${orderItemId}`, {
      method: 'POST',
      headers: authHeader,
      body: {
        reason: 'Customer changed mind',
        waste: false,
      },
    });
    assertEqualOrThrow(refundRes.status, 200, 'Order item refunded without waste');

    const beanRowAfterRefund = db.prepare('SELECT quantity FROM inventory_items WHERE id = ?').get(coffeeBeanId);
    assertEqualOrThrow(Number(beanRowAfterRefund.quantity), 1000, 'Inventory stock restored after non-waste refund');

    // ── Test 3: Purchase Order GRN & Weighted-Average Unit Cost Update ────────
    console.log('\n[3] Verifying PO GRN Weighted-Average Unit Cost Calculation...');
    const milkId = randomUUID();
    // Starting stock: 10 units @ 10.00 each
    db.prepare(`
      INSERT INTO inventory_items (id, name, sku, category, unit, quantity, cost_per_unit, reorder_level, is_active, created_at, updated_at)
      VALUES (?, 'Fresh Milk 1L', 'MLK-001', 'dairy', 'l', 10, 10.00, 5, 1, datetime('now'), datetime('now'))
    `).run(milkId);

    const supplierId = randomUUID();
    db.prepare(`
      INSERT INTO suppliers (id, name, contact_person, phone, payment_terms, lead_time_days, balance_due, is_active, created_at, updated_at)
      VALUES (?, 'Dairy Farm Ltd', 'John Dairy', '+123456789', 'Net 30', 2, 0, 1, datetime('now'), datetime('now'))
    `).run(supplierId);

    // Create PO for 10 units @ 20.00 each
    const poRes = await api(baseUrl, '/api/purchasing/purchase-orders', {
      method: 'POST',
      headers: authHeader,
      body: {
        supplier_id: supplierId,
        items: [
          {
            target_type: 'inventory',
            target_id: milkId,
            item_name: 'Fresh Milk 1L',
            unit: 'l',
            ordered_qty: 10,
            unit_cost: 20.00,
          },
        ],
      },
    });
    assertEqualOrThrow(poRes.status, 201, 'Purchase order created');
    const poId = poRes.data.purchase_order.id;

    // Receive Goods (GRN)
    // New Cost = (10 * 10.00 + 10 * 20.00) / (10 + 10) = 300 / 20 = 15.00
    const receiveRes = await api(baseUrl, `/api/purchasing/purchase-orders/${poId}/receive`, {
      method: 'POST',
      headers: authHeader,
      body: {
        pay_from_drawer: false,
      },
    });
    assertEqualOrThrow(receiveRes.status, 200, 'Purchase order GRN received');

    const milkAfterGrn = db.prepare('SELECT quantity, cost_per_unit FROM inventory_items WHERE id = ?').get(milkId);
    assertEqualOrThrow(Number(milkAfterGrn.quantity), 20, 'Milk total quantity updated to 20 units');
    assertEqualOrThrow(Number(milkAfterGrn.cost_per_unit), 15.00, 'Milk weighted-average cost correctly recalculated to 15.00');

    const grnLog = db.prepare(`SELECT * FROM stock_logs WHERE target_id = ? AND reference_type = 'purchase_order'`).get(milkId);
    assertOrThrow(Boolean(grnLog), 'stock_logs recorded GRN purchase order delivery');

    // ── Test 4: Physical Stocktake Variance & Inventory Reconciliation ────────
    console.log('\n[4] Verifying Physical Stocktake Variance & Reconciliation...');
    // Physical count: expected is 20, counted is 17 (variance = -3, variance value = -3 * 15.00 = -45.00)
    const reconcileRes = await api(baseUrl, '/api/stocktakes/reconcile', {
      method: 'POST',
      headers: authHeader,
      body: {
        lines: [
          {
            target_type: 'inventory',
            target_id: milkId,
            actual_qty: 17,
            variance_reason: 'Spillage / Shrinkage',
          },
        ],
        notes: 'End of month audit',
      },
    });
    assertEqualOrThrow(reconcileRes.status, 200, 'Stocktake reconciled successfully');
    assertEqualOrThrow(reconcileRes.data.total_variance_qty, -3, 'Total variance quantity is -3');
    assertEqualOrThrow(reconcileRes.data.total_variance_value, -45.00, 'Total variance value is -45.00');

    const milkAfterStocktake = db.prepare('SELECT quantity, last_counted_qty FROM inventory_items WHERE id = ?').get(milkId);
    assertEqualOrThrow(Number(milkAfterStocktake.quantity), 17, 'Milk inventory adjusted to physical count (17)');
    assertEqualOrThrow(Number(milkAfterStocktake.last_counted_qty), 17, 'Milk last_counted_qty updated to 17');

    const stkLog = db.prepare(`SELECT * FROM stock_logs WHERE target_id = ? AND reference_type = 'stocktake'`).get(milkId);
    assertOrThrow(Boolean(stkLog), 'stock_logs recorded stocktake reconciliation audit');

    // ── Test 5: HRM Loan Deduction & Automatic Settlement in Payroll ──────────
    console.log('\n[5] Verifying HRM Payroll Loan Installment Deduction & Auto-Settlement...');
    // Create staff member
    const staffId = randomUUID();
    db.prepare(`
      INSERT INTO users (id, name, email, password, role, is_active, created_at, updated_at)
      VALUES (?, 'Alice Barista', 'alice@flocafe.test', 'hash', 'cashier', 1, datetime('now'), datetime('now'))
    `).run(staffId);

    db.prepare(`
      INSERT INTO hr_employee_profiles (staff_id, employee_code, department, contract_type, base_monthly_salary, hourly_rate, standard_work_days, hire_date, updated_at)
      VALUES (?, 'EMP-001', 'Operations', 'full_time', 5000, 25, 26, '2026-01-01', datetime('now'))
    `).run(staffId);

    // Issue a loan of 300 with monthly installment of 200
    const loanId = randomUUID();
    db.prepare(`
      INSERT INTO hr_employee_loans (id, staff_id, loan_type, principal_amount, monthly_installment, remaining_balance, status, reason, issued_at, approved_by)
      VALUES (?, ?, 'installment_loan', 300, 200, 300, 'active', 'Equipment Advance', datetime('now'), ?)
    `).run(loanId, staffId, userId);

    // Payroll Run 1 (Month 2026-11): Installment should deduct MIN(200, 300) = 200. Remaining balance becomes 100.
    const payrollRun1Res = await api(baseUrl, '/api/hrm/payroll/run', {
      method: 'POST',
      headers: authHeader,
      body: {
        payroll_month: '2026-11',
      },
    });
    assertEqualOrThrow(payrollRun1Res.status, 200, 'Month 1 payroll run processed');

    const loanAfterRun1 = db.prepare('SELECT remaining_balance, status FROM hr_employee_loans WHERE id = ?').get(loanId);
    assertEqualOrThrow(Number(loanAfterRun1.remaining_balance), 100, 'Loan remaining balance decremented to 100');
    assertEqualOrThrow(loanAfterRun1.status, 'active', 'Loan remains active');

    const slip1: any = db.prepare('SELECT * FROM hr_payroll_runs WHERE staff_id = ? AND payroll_month = ?').get(staffId, '2026-11');
    assertEqualOrThrow(Number(slip1.loan_installment_deducted), 200, 'Month 1 deducted 200 loan installment');
    assertEqualOrThrow(Number(slip1.net_payable), 4800, 'Net payable is 5000 - 200 = 4800');

    // Payroll Run 2 (Month 2026-12): Installment should deduct MIN(200, 100) = 100. Remaining balance becomes 0, status becomes settled!
    const payrollRun2Res = await api(baseUrl, '/api/hrm/payroll/run', {
      method: 'POST',
      headers: authHeader,
      body: {
        payroll_month: '2026-12',
      },
    });
    assertEqualOrThrow(payrollRun2Res.status, 200, 'Month 2 payroll run processed');

    const loanAfterRun2: any = db.prepare('SELECT remaining_balance, status FROM hr_employee_loans WHERE id = ?').get(loanId);
    assertEqualOrThrow(Number(loanAfterRun2.remaining_balance), 0, 'Loan remaining balance reached 0');
    assertEqualOrThrow(loanAfterRun2.status, 'settled', 'Loan status automatically transitioned to settled');

    const slip2: any = db.prepare('SELECT * FROM hr_payroll_runs WHERE staff_id = ? AND payroll_month = ?').get(staffId, '2026-12');
    assertEqualOrThrow(Number(slip2.loan_installment_deducted), 100, 'Month 2 deducted remaining 100 loan balance');
    assertEqualOrThrow(Number(slip2.net_payable), 4900, 'Net payable is 5000 - 100 = 4900');

    console.log('\n' + '='.repeat(70));
    console.log('✅ ALL ENTERPRISE SUITE VERIFICATIONS PASSED CLEANLY');
  } finally {
    server.close();
    closeDatabase();
  }
}

main().catch((err) => {
  console.error('\n❌ Enterprise suite test failed:', err);
  process.exit(1);
});
