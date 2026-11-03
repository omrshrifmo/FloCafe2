/**
 * FloCafe Release 4.0.6 Enterprise Operations, Costing, Stocktaking, HACCP, HRM & Finance Suite
 * Integration Test Suite
 *
 * Verifies:
 * 1. Non-destructive SQLite migration v105/v106 schema verification.
 * 2. Automated BOM gross-quantity deduction (net / (1 - waste%)) and refund restoration.
 * 3. Purchase Order GRN weighted-average unit cost recalculation and stock_logs audit.
 * 4. Physical stocktake variance calculation and inventory reconciliation.
 * 5. Automated monthly loan installment deduction and loan settlement during payroll disbursement.
 * 6. POS Cash Movement: Direct Operating Expense with shift drawer deduction.
 * 7. POS Cash Movement: Purchase Mode A (Open PO) & Mode B (Quick COD).
 * 8. Endpoints Integrity verification across all enterprise modules.
 */
const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-enterprise-test-'));
const mockSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s, 'utf8'),
  decryptString: (b: Buffer) => b.toString('utf8'),
};

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return {
      app: { isPackaged: true, getPath: () => testDir, getVersion: () => '4.0.9' },
      safeStorage: mockSafeStorage,
    };
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
  console.log('FloCafe 4.0.9 Enterprise Suite Integration Test');
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
    // ── Test 1: Non-destructive SQLite migration v108 schema verification ──────
    console.log('\n[1] Verifying Release 4.0.9 Schema Migration (v108)...');
    const userVersion = db.pragma('user_version', { simple: true });
    assertOrThrow(userVersion >= 108, `Schema user_version is ${userVersion} (expected >= 108)`);

    const tables = [
      'stock_logs', 'cash_movements', 'operating_expenses', 'suppliers',
      'purchase_orders', 'purchase_order_items', 'stocktake_sessions', 'stocktake_lines',
      'bom_headers', 'bom_components', 'haccp_ccp_logs', 'haccp_checklists', 'haccp_batches',
      'hr_employee_profiles', 'hr_attendance_summaries', 'hr_employee_loans', 'hr_payroll_runs',
      'bill_payments', 'payments',
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

    const billCols = db.prepare(`PRAGMA table_info(bills)`).all().map((c: any) => c.name);
    assertOrThrow(billCols.includes('payment_method') && billCols.includes('payment_method_id'), 'bills has payment_method and payment_method_id columns');

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

    // ── Test 6: POS Cash Movement — Direct Operating Expense ─────────────────
    console.log('\n[6] Verifying POS Cash Movement: Direct Operating Expense...');
    // Open a cash shift session
    const openShiftRes = await api(baseUrl, '/api/cash-sessions/open', {
      method: 'POST',
      headers: authHeader,
      body: {
        opening_float_cents: 20000, // 200.00
      },
    });
    assertEqualOrThrow(openShiftRes.status, 200, 'Cash session opened successfully');
    const sessionId = openShiftRes.data.id || openShiftRes.data.session?.id;

    // Record an Expense from drawer
    const expenseRes = await api(baseUrl, '/api/cash-closures/movements', {
      method: 'POST',
      headers: authHeader,
      body: {
        business_date: '2026-11-01',
        movement_type: 'expense',
        amount_cents: 2500, // 25.00
        expense_category: 'Store Supplies & Ice',
        cost_type: 'direct',
        title: '5 Bags of Ice',
        notes: 'Emergency ice purchase for rush hour',
      },
    });
    assertEqualOrThrow(expenseRes.status, 201, 'Expense movement recorded');
    const drawerMvtId = expenseRes.data.movement.id;

    // Verify cash_drawer_movements record has movement_type = 'pay_out'
    const cdm = db.prepare('SELECT * FROM cash_drawer_movements WHERE id = ?').get(drawerMvtId) as any;
    assertEqualOrThrow(cdm.movement_type, 'pay_out', 'Drawer movement saved as pay_out');
    assertEqualOrThrow(Number(cdm.amount_cents), 2500, 'Drawer movement has amount 2500 cents');

    // Verify cash_movements has linked cash_drawer_movement_id
    const cm = db.prepare('SELECT * FROM cash_movements WHERE cash_drawer_movement_id = ?').get(drawerMvtId) as any;
    assertOrThrow(Boolean(cm), 'Cash movement linked to drawer movement');
    assertEqualOrThrow(cm.movement_type, 'petty_expense', 'Cash movement type is petty_expense');

    // Verify operating_expenses record created with session link
    const oe = db.prepare('SELECT * FROM operating_expenses WHERE paid_from_session_id = ?').get(String(sessionId)) as any;
    assertOrThrow(Boolean(oe), 'Operating expense record created with paid_from_session_id');
    assertEqualOrThrow(oe.cost_type, 'direct', 'Expense cost_type is direct');
    assertEqualOrThrow(Number(oe.amount), 25.00, 'Operating expense amount is 25.00');

    // ── Test 7: POS Cash Movement — Purchase Modes A & B ─────────────────────
    console.log('\n[7] Verifying POS Cash Movement: Purchase Mode A (Open PO) & Mode B (Quick COD)...');
    // Mode A: Create a supplier and PO
    const supId = randomUUID();
    db.prepare(`
      INSERT INTO suppliers (id, name, contact_person, phone, email, is_active, created_at, updated_at)
      VALUES (?, 'Metro Dairy Supplies', 'Bob', '555-0199', 'bob@metro.test', 1, datetime('now'), datetime('now'))
    `).run(supId);

    const posPoId = randomUUID();
    db.prepare(`
      INSERT INTO purchase_orders (id, po_number, supplier_id, status, total_amount, created_by, created_at, updated_at)
      VALUES (?, 'PO-2026-TEST', ?, 'ordered', 50.00, ?, datetime('now'), datetime('now'))
    `).run(posPoId, supId, userId);

    db.prepare(`
      INSERT INTO purchase_order_items (id, purchase_order_id, target_type, target_id, item_name, unit, ordered_qty, unit_cost, line_total)
      VALUES (?, ?, 'inventory', ?, 'Fresh Whole Milk', 'L', 10, 5.00, 50.00)
    `).run(randomUUID(), posPoId, milkId);

    const milkBeforePo = db.prepare('SELECT quantity FROM inventory_items WHERE id = ?').get(milkId) as any;
    const initialMilkQty = Number(milkBeforePo.quantity);

    // Pay & receive open PO from drawer
    const poPayRes = await api(baseUrl, '/api/cash-closures/movements', {
      method: 'POST',
      headers: authHeader,
      body: {
        business_date: '2026-11-01',
        movement_type: 'purchase',
        purchase_order_id: posPoId,
        amount_cents: 5000,
        reason: 'Paid Metro Dairy on delivery',
      },
    });
    assertEqualOrThrow(poPayRes.status, 201, 'Mode A PO receipt payment processed');

    // Verify PO status is now received
    const poAfter = db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(posPoId) as any;
    assertEqualOrThrow(poAfter.status, 'received', 'PO status updated to received');

    // Verify milk stock increased by 10
    const milkAfterPo = db.prepare('SELECT quantity FROM inventory_items WHERE id = ?').get(milkId) as any;
    assertEqualOrThrow(Number(milkAfterPo.quantity), initialMilkQty + 10, 'Milk stock increased by 10');

    // Mode B: Quick Walk-in COD Purchase of Arabica Coffee Beans
    const beansBeforeCod = db.prepare('SELECT quantity, cost_per_unit FROM inventory_items WHERE id = ?').get(coffeeBeanId) as any;
    const initialBeansQty = Number(beansBeforeCod.quantity);

    const codRes = await api(baseUrl, '/api/cash-closures/movements', {
      method: 'POST',
      headers: authHeader,
      body: {
        business_date: '2026-11-01',
        movement_type: 'purchase',
        target_type: 'inventory',
        target_id: coffeeBeanId,
        quantity: 500, // 500g
        amount_cents: 10000, // 100.00 total -> 0.20/g
        reason: 'Emergency walk-in bean purchase',
      },
    });
    assertEqualOrThrow(codRes.status, 201, 'Mode B Quick COD purchase processed');

    // Verify beans stock increased by 500
    const beansAfterCod = db.prepare('SELECT quantity, cost_per_unit FROM inventory_items WHERE id = ?').get(coffeeBeanId) as any;
    assertEqualOrThrow(Number(beansAfterCod.quantity), initialBeansQty + 500, 'Beans quantity incremented by 500g');

    // Verify stock_logs contains 'Quick POS Purchase'
    const codLog = db.prepare(`SELECT * FROM stock_logs WHERE target_id = ? AND reason = 'Quick POS Purchase'`).get(coffeeBeanId) as any;
    assertOrThrow(Boolean(codLog), 'Stock log recorded Quick POS Purchase');

    // ── Test 8: Endpoints Verification (Zero 404s or 500s) ───────────────────
    console.log('\n[8] Verifying Endpoints Integrity (Finance, HACCP, Stocktake, Cash Sessions)...');
    const endpoints = [
      '/api/finance/summary',
      '/api/finance/transactions',
      '/api/finance/categories',
      '/api/finance/pnl',
      '/api/finance/reports/pnl',
      '/api/finance/cash-movements',
      '/api/finance/expenses',
      '/api/haccp/templates',
      '/api/haccp/runs',
      '/api/haccp/ccp-logs',
      '/api/haccp/checklists',
      '/api/haccp/batches',
      '/api/stocktake',
      '/api/stocktakes',
      '/api/cash-sessions/active',
      '/api/cash-closures/purchase-options',
    ];

    for (const ep of endpoints) {
      const res = await api(baseUrl, ep, {
        method: 'GET',
        headers: authHeader,
      });
      assertEqualOrThrow(res.status, 200, `Endpoint ${ep} returned 200 OK`);
    }

    // ── Test 9: Table Order Served Lifecycle & Active Status ─────────────────
    console.log('\n[9] Verifying Table Order Served Lifecycle & Active Table Status...');
    const tableId = 'tbl-test-lifecycle';
    db.prepare(`
      INSERT OR REPLACE INTO tables (id, number, capacity, status, is_active, created_at, updated_at)
      VALUES (?, 'Table Lifecycle', 4, 'available', 1, datetime('now'), datetime('now'))
    `).run(tableId);

    const tableOrderRes = await api(baseUrl, '/api/orders', {
      method: 'POST',
      headers: authHeader,
      body: {
        table_id: tableId,
        type: 'dine_in',
        customer_count: 2,
        items: [
          { product_id: 'prod-espresso', quantity: 2, unit_price: 120 },
        ],
      },
    });
    assertEqualOrThrow(tableOrderRes.status, 201, 'Table order created');
    const tableOrderId = tableOrderRes.data.order.id;

    const tableAfterOrder = db.prepare('SELECT status FROM tables WHERE id = ?').get(tableId) as any;
    assertEqualOrThrow(tableAfterOrder.status, 'occupied', 'Table status is occupied after order creation');

    const tableOrderItems = db.prepare('SELECT id FROM order_items WHERE order_id = ?').all(tableOrderId) as any[];
    assertOrThrow(tableOrderItems.length > 0, 'Order has items');

    for (const item of tableOrderItems) {
      const itemUpdateRes = await api(baseUrl, `/api/order-items/${item.id}/status`, {
        method: 'PATCH',
        headers: authHeader,
        body: { status: 'served' },
      });
      assertEqualOrThrow(itemUpdateRes.status, 200, 'Order item updated to served');
    }

    const orderAfterServed = db.prepare('SELECT status FROM orders WHERE id = ?').get(tableOrderId) as any;
    assertEqualOrThrow(orderAfterServed.status, 'served', 'Unpaid order with all items served has status=served, NOT completed');

    const tableAfterServed = db.prepare('SELECT status FROM tables WHERE id = ?').get(tableId) as any;
    assertEqualOrThrow(tableAfterServed.status, 'occupied', 'Table remains occupied when order is served but unpaid');

    const tablesListRes = await api(baseUrl, '/api/tables', {
      method: 'GET',
      headers: authHeader,
    });
    assertEqualOrThrow(tablesListRes.status, 200, 'GET /api/tables 200 OK');
    const tableData = tablesListRes.data.tables.find((t: any) => t.id === tableId);
    assertOrThrow(Boolean(tableData), 'Table found in tables list');
    assertEqualOrThrow(tableData.status, 'occupied', 'Table in list is occupied');
    assertOrThrow(Boolean(tableData.activeOrder || tableData.current_order), 'Table has activeOrder attached');

    const appendRes = await api(baseUrl, `/api/orders/${tableOrderId}/items`, {
      method: 'POST',
      headers: authHeader,
      body: {
        items: [
          { product_id: 'prod-espresso', quantity: 1, unit_price: 120 },
        ],
      },
    });
    assertEqualOrThrow(appendRes.status, 200, 'Item appended to served order');
    const orderAfterAppend = db.prepare('SELECT status FROM orders WHERE id = ?').get(tableOrderId) as any;
    assertEqualOrThrow(orderAfterAppend.status, 'pending', 'Order transitions back to pending when new item is added to served order');

    // Generate bill for table order
    const billGenRes = await api(baseUrl, '/api/bills/generate', {
      method: 'POST',
      headers: authHeader,
      body: { order_id: tableOrderId },
    });
    assertOrThrow(billGenRes.status === 200 || billGenRes.status === 201, 'Bill generated for table order');
    const bill = billGenRes.data.bill;
    assertOrThrow(Boolean(bill), 'Bill exists for table order');

    const payRes = await api(baseUrl, `/api/bills/${bill.id}/payment`, {
      method: 'POST',
      headers: authHeader,
      body: {
        amount: Number(bill.balance || bill.total),
        method: 'cash',
      },
    });
    assertEqualOrThrow(payRes.status, 200, 'Bill paid successfully');

    const orderAfterPay = db.prepare('SELECT status FROM orders WHERE id = ?').get(tableOrderId) as any;
    assertEqualOrThrow(orderAfterPay.status, 'completed', 'Order status becomes completed after bill is paid');
    const tableAfterPay = db.prepare('SELECT status FROM tables WHERE id = ?').get(tableId) as any;
    assertEqualOrThrow(tableAfterPay.status, 'available', 'Table becomes available after bill is paid');

    // ── Test 10: Shift Close with Open Tables & Shift B Carry-Over Settlement ──
    console.log('\n[10] Verifying Shift Close with Open Tables & Shift B Carry-Over...');
    const tableYId = 'tbl-test-carryover';
    db.prepare(`
      INSERT OR REPLACE INTO tables (id, number, capacity, status, is_active, created_at, updated_at)
      VALUES (?, 'Table CarryOver', 4, 'available', 1, datetime('now'), datetime('now'))
    `).run(tableYId);

    // Shift A is sessionId (already open from Test 6)
    const shiftAId = sessionId;

    const orderYRes = await api(baseUrl, '/api/orders', {
      method: 'POST',
      headers: authHeader,
      body: {
        table_id: tableYId,
        type: 'dine_in',
        customer_count: 2,
        items: [
          { product_id: 'prod-espresso', quantity: 3, unit_price: 120 },
        ],
      },
    });
    assertEqualOrThrow(orderYRes.status, 201, 'Order Y created');
    const orderYId = orderYRes.data.order.id;

    const closeShiftARes = await api(baseUrl, `/api/cash-sessions/${shiftAId}/close`, {
      method: 'POST',
      headers: authHeader,
      body: {
        counted_cash_cents: 20000,
        notes: 'Closing Shift A with open tables',
        skip_unpaid_block: true,
      },
    });
    assertEqualOrThrow(closeShiftARes.status, 200, 'Shift A closed successfully with open tables');
    assertOrThrow(Number(closeShiftARes.data.carried_over_orders_count) >= 1, 'carried_over_orders_count >= 1 reported');
    assertOrThrow(Number(closeShiftARes.data.carried_over_total) > 0, 'carried_over_total > 0 reported');

    const orderYAfterClose = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderYId) as any;
    assertOrThrow(orderYAfterClose.status !== 'completed' && orderYAfterClose.status !== 'cancelled', 'Order Y remained active');
    const tableYAfterClose = db.prepare('SELECT status FROM tables WHERE id = ?').get(tableYId) as any;
    assertEqualOrThrow(tableYAfterClose.status, 'occupied', 'Table Y remained occupied');

    const shiftBRes = await api(baseUrl, '/api/cash-sessions/open', {
      method: 'POST',
      headers: authHeader,
      body: {
        opening_float_cents: 30000,
        notes: 'Shift B for carryover test',
      },
    });
    assertEqualOrThrow(shiftBRes.status, 200, 'Shift B opened');
    const shiftBId = shiftBRes.data.id || shiftBRes.data.session?.id;

    // Generate bill for Order Y in Shift B
    const billYGenRes = await api(baseUrl, '/api/bills/generate', {
      method: 'POST',
      headers: authHeader,
      body: { order_id: orderYId },
    });
    assertOrThrow(billYGenRes.status === 200 || billYGenRes.status === 201, 'Bill generated for order Y');
    const billY = billYGenRes.data.bill;

    const payYRes = await api(baseUrl, `/api/bills/${billY.id}/payment`, {
      method: 'POST',
      headers: authHeader,
      body: {
        amount: Number(billY.balance || billY.total),
        method: 'cash',
      },
    });
    assertEqualOrThrow(payYRes.status, 200, 'Order Y paid during Shift B');

    const billRecord = db.prepare('SELECT payment_details FROM bills WHERE id = ?').get(billY.id) as any;
    const paymentsList = JSON.parse(billRecord.payment_details || '[]');
    assertEqualOrThrow(paymentsList[0]?.cash_session_id, shiftBId, 'Payment is correctly tagged with Shift B cash_session_id');

    const closeShiftBRes = await api(baseUrl, `/api/cash-sessions/${shiftBId}/close`, {
      method: 'POST',
      headers: authHeader,
      body: {
        counted_cash_cents: 30000 + Math.round(Number(billY.balance || billY.total) * 100),
        notes: 'Closing Shift B',
      },
    });
    assertEqualOrThrow(closeShiftBRes.status, 200, 'Shift B closed successfully');

    // ── Test 12 (Test A): Multi-Customer Split Order & Sequential Checkout without 409 ──
    console.log('\n[12] Verifying Multi-Customer Split Order & Sequential Checkout without 409...');
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('split_checks_enabled', 'true')").run();

    const shiftSplitRes = await api(baseUrl, '/api/cash-sessions/open', {
      method: 'POST',
      headers: authHeader,
      body: { opening_float_cents: 10000, notes: 'Shift for Split Tests' },
    });
    assertEqualOrThrow(shiftSplitRes.status, 200, 'Shift for Split Tests opened');

    const tableSplitId = 'tbl-test-split';
    db.prepare(`
      INSERT OR REPLACE INTO tables (id, number, capacity, status, is_active, created_at, updated_at)
      VALUES (?, 'Table Split', 4, 'available', 1, datetime('now'), datetime('now'))
    `).run(tableSplitId);

    const splitOrderRes = await api(baseUrl, '/api/orders', {
      method: 'POST',
      headers: authHeader,
      body: {
        table_id: tableSplitId,
        type: 'dine_in',
        customer_count: 2,
        items: [
          { product_id: 'prod-espresso', quantity: 2, unit_price: 120 },
        ],
      },
    });
    assertEqualOrThrow(splitOrderRes.status, 201, 'Split order created with 2 espressos');
    const splitOrderId = splitOrderRes.data.order.id;

    const splitBillGenRes = await api(baseUrl, '/api/bills/generate', {
      method: 'POST',
      headers: authHeader,
      body: { order_id: splitOrderId },
    });
    assertEqualOrThrow(splitBillGenRes.status, 201, 'Bill generated for split order');
    const initialBillId = splitBillGenRes.data.bill.id;

    const activeItemRows = db.prepare('SELECT id, quantity FROM order_items WHERE order_id = ?').all(splitOrderId) as any[];
    const itemToSplitId = activeItemRows[0].id;

    const splitCheckRes = await api(baseUrl, `/api/bills/${initialBillId}/split-check`, {
      method: 'POST',
      headers: authHeader,
      body: {
        checks: [
          { label: 'Guest 1', items: [{ order_item_id: itemToSplitId, quantity: 1 }] },
          { label: 'Guest 2', items: [{ order_item_id: itemToSplitId, quantity: 1 }] },
        ],
      },
    });
    assertEqualOrThrow(splitCheckRes.status, 201, 'Split checks created');
    assertEqualOrThrow(splitCheckRes.data.bills.length, 2, '2 split bills created');
    const [bill1, bill2] = splitCheckRes.data.bills;

    const pay1Res = await api(baseUrl, `/api/bills/${bill1.id}/payment`, {
      method: 'POST',
      headers: authHeader,
      body: { amount: Number(bill1.balance || bill1.total), method: 'cash' },
    });
    assertEqualOrThrow(pay1Res.status, 200, 'Guest 1 check paid with 200 OK');
    assertEqualOrThrow(pay1Res.data.bill.payment_status, 'paid', 'Guest 1 check status is paid');

    const pay2Res = await api(baseUrl, `/api/bills/${bill2.id}/payment`, {
      method: 'POST',
      headers: authHeader,
      body: { amount: Number(bill2.balance || bill2.total), method: 'cash' },
    });
    assertEqualOrThrow(pay2Res.status, 200, 'Guest 2 check paid with 200 OK without 409');
    assertEqualOrThrow(pay2Res.data.bill.payment_status, 'paid', 'Guest 2 check status is paid');

    const orderFinal = db.prepare('SELECT status FROM orders WHERE id = ?').get(splitOrderId) as any;
    assertEqualOrThrow(orderFinal.status, 'completed', 'Order status is completed after both split checks paid');
    const tableFinal = db.prepare('SELECT status FROM tables WHERE id = ?').get(tableSplitId) as any;
    assertEqualOrThrow(tableFinal.status, 'available', 'Table is available after all split checks paid');

    // ── Test 13 (Test B): Exact Payment Method Name & Custom Tax Name on Receipt ──
    console.log('\n[13] Verifying Exact Payment Method Name & Custom Tax Name on Receipt...');
    db.prepare(`
      INSERT OR REPLACE INTO payment_methods (id, name, is_active, sort_order, created_at, updated_at)
      VALUES (991, 'InstaPay App', 1, 10, datetime('now'), datetime('now'))
    `).run();

    const orderCustomRes = await api(baseUrl, '/api/orders', {
      method: 'POST',
      headers: authHeader,
      body: {
        table_id: null,
        type: 'takeaway',
        customer_count: 1,
        items: [{ product_id: 'prod-espresso', quantity: 1, unit_price: 120 }],
      },
    });
    const customOrderId = orderCustomRes.data.order.id;

    const customBillGenRes = await api(baseUrl, '/api/bills/generate', {
      method: 'POST',
      headers: authHeader,
      body: { order_id: customOrderId },
    });
    const customBillId = customBillGenRes.data.bill.id;

    const customPayRes = await api(baseUrl, `/api/bills/${customBillId}/payment`, {
      method: 'POST',
      headers: authHeader,
      body: {
        amount: Number(customBillGenRes.data.bill.total),
        method: 'instapay',
        payment_method_id: 991,
      },
    });
    assertEqualOrThrow(customPayRes.status, 200, 'Paid with InstaPay');

    const { buildBillPrintData, buildBillPrintContext } = require('../main/printers/document-classic');
    const { buildBillDocument } = require('../shared/print/document');
    const billRow = db.prepare('SELECT * FROM bills WHERE id = ?').get(customBillId) as any;
    const orderRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(billRow.order_id) as any;
    const businessRow = { name: 'FloCafe', country: 'EG', currency: 'EGP' };
    const printData = buildBillPrintData(orderRow, billRow, businessRow, false);
    assertOrThrow(Boolean(printData), 'buildBillPrintData returned printData');
    assertOrThrow(
      printData.bill.payments.some((p: any) => p.methodName === 'InstaPay App' || p.method_name === 'InstaPay App'),
      'printData carries exact payment method name InstaPay App',
    );

    const printContext = buildBillPrintContext({
      columns: 48,
      language: 'en',
      business: businessRow,
    });
    const doc = buildBillDocument(printData, printContext);
    const paymentsBlock = doc.blocks.find((b: any) => b.kind === 'payments') as any;
    assertOrThrow(Boolean(paymentsBlock), 'Document has payments block');
    assertOrThrow(
      paymentsBlock.lines.some((l: any) => l.label?.primary === 'InstaPay App' || l.label?.text === 'InstaPay App'),
      'Payments line label text matches exact payment method name',
    );

    // Verify persistence in bills row, bill_payments and payments tables
    assertEqualOrThrow(billRow.payment_method_id, 991, 'Bill row has payment_method_id 991');
    const billPaymentRow = db.prepare('SELECT * FROM bill_payments WHERE bill_id = ?').get(customBillId) as any;
    assertOrThrow(Boolean(billPaymentRow), 'bill_payments table has row for bill');
    assertEqualOrThrow(billPaymentRow.method_name, 'InstaPay App', 'bill_payments has exact method_name InstaPay App');
    const paymentRow = db.prepare('SELECT * FROM payments WHERE bill_id = ?').get(customBillId) as any;
    assertOrThrow(Boolean(paymentRow), 'payments table has row for bill');
    assertEqualOrThrow(paymentRow.method_name, 'InstaPay App', 'payments has exact method_name InstaPay App');

    // Verify Custom Tax Name from Taxes Settings
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('tax_label', 'VAT 14%')").run();
    db.prepare("UPDATE bills SET tax_amount = 16.8 WHERE id = ?").run(customBillId);
    const updatedBillRow = db.prepare('SELECT * FROM bills WHERE id = ?').get(customBillId) as any;

    const printDataWithTax = buildBillPrintData(orderRow, updatedBillRow, businessRow, false);
    const docWithTax = buildBillDocument(printDataWithTax, printContext);
    const totalsBlock = docWithTax.blocks.find((b: any) => b.kind === 'totals') as any;
    assertOrThrow(Boolean(totalsBlock), 'Document has totals block');
    assertOrThrow(Boolean(totalsBlock.tax), 'Totals block has tax line');
    assertOrThrow(
      totalsBlock.tax.label?.primary?.includes('VAT 14%') || totalsBlock.tax.label?.text?.includes('VAT 14%'),
      'Document totals block includes custom tax name VAT 14%',
    );

    // Verify thermal receipt rendering contains VAT 14% and InstaPay App
    const { formatReceipt } = require('../main/printers/thermal');
    const receiptBuffer = formatReceipt(orderRow, updatedBillRow, businessRow, 48);
    const receiptText = receiptBuffer.toString('utf8');
    assertOrThrow(receiptText.includes('VAT 14%'), 'Thermal receipt output contains custom tax label VAT 14%');
    assertOrThrow(receiptText.includes('InstaPay App'), 'Thermal receipt output contains exact method name InstaPay App');

    // Verify branded receipt request contains VAT 14% and InstaPay App
    const { buildBrandedReceiptRequest } = require('../main/printers/branded-receipt-renderer');
    const brandedReq = buildBrandedReceiptRequest({ order: orderRow, bill: updatedBillRow, business: businessRow, transport: 'epson_raster' });
    assertOrThrow(
      brandedReq.totals.some((row: any) => row.label.includes('VAT 14%')),
      'Branded receipt totals include custom tax label VAT 14%',
    );
    assertOrThrow(
      brandedReq.totals.some((row: any) => row.label.includes('InstaPay App')),
      'Branded receipt totals include exact method name InstaPay App',
    );

    // ── Test 14 (Test C): Real-Time Table Move & Item Move (including occupied table merge) ──
    console.log('\n[14] Verifying Real-Time Table Move & Occupied Table Merge...');
    const tableM1 = 'tbl-move-1';
    const tableM2 = 'tbl-move-2';
    db.prepare(`
      INSERT OR REPLACE INTO tables (id, number, capacity, status, is_active, created_at, updated_at)
      VALUES (?, 'Table M1', 4, 'available', 1, datetime('now'), datetime('now'))
    `).run(tableM1);
    db.prepare(`
      INSERT OR REPLACE INTO tables (id, number, capacity, status, is_active, created_at, updated_at)
      VALUES (?, 'Table M2', 4, 'available', 1, datetime('now'), datetime('now'))
    `).run(tableM2);

    const orderM1Res = await api(baseUrl, '/api/orders', {
      method: 'POST',
      headers: authHeader,
      body: {
        table_id: tableM1,
        type: 'dine_in',
        customer_count: 1,
        items: [{ product_id: 'prod-espresso', quantity: 1, unit_price: 120 }],
      },
    });
    const orderM1Id = orderM1Res.data.order.id;

    const orderM2Res = await api(baseUrl, '/api/orders', {
      method: 'POST',
      headers: authHeader,
      body: {
        table_id: tableM2,
        type: 'dine_in',
        customer_count: 1,
        items: [{ product_id: 'prod-espresso', quantity: 2, unit_price: 120 }],
      },
    });
    const orderM2Id = orderM2Res.data.order.id;

    const moveRes = await api(baseUrl, `/api/tables/${tableM1}/move-order`, {
      method: 'POST',
      headers: authHeader,
      body: { target_table_id: tableM2, merge: true },
    });
    assertEqualOrThrow(moveRes.status, 200, 'Table move into occupied table succeeded with 200 OK');
    assertEqualOrThrow(moveRes.data.sourceTable.status, 'available', 'Source table becomes available after merge');
    assertEqualOrThrow(moveRes.data.targetTable.status, 'occupied', 'Target table remains occupied');

    const orderM1Db = db.prepare('SELECT status, cancellation_reason FROM orders WHERE id = ?').get(orderM1Id) as any;
    assertEqualOrThrow(orderM1Db.status, 'cancelled', 'Source order cancelled on merge');
    assertOrThrow(orderM1Db.cancellation_reason?.includes('Merged into table'), 'Cancellation reason records merge');

    const orderM2Items = db.prepare("SELECT SUM(quantity) as total_qty FROM order_items WHERE order_id = ? AND status != 'cancelled'").get(orderM2Id) as any;
    assertEqualOrThrow(Number(orderM2Items.total_qty), 3, 'Target order has all 3 items (1 from M1 + 2 from M2)');

    // ── Test 15 (Test D): Occupied Table Serve Merge (No duplicate orders) ──
    console.log('\n[15] Verifying Occupied Table Serve Merge (No duplicate orders)...');
    const tableD1 = 'tbl-dup-test';
    db.prepare(`
      INSERT OR REPLACE INTO tables (id, number, capacity, status, is_active, created_at, updated_at)
      VALUES (?, 'Table DupTest', 4, 'available', 1, datetime('now'), datetime('now'))
    `).run(tableD1);

    const initialServeRes = await api(baseUrl, '/api/orders', {
      method: 'POST',
      headers: authHeader,
      body: {
        table_id: tableD1,
        type: 'dine_in',
        customer_count: 2,
        items: [{ product_id: 'prod-espresso', quantity: 1, unit_price: 120 }],
      },
    });
    assertEqualOrThrow(initialServeRes.status, 201, 'Initial dine-in order created');
    const activeOrderId = initialServeRes.data.order.id;

    const secondServeRes = await api(baseUrl, '/api/orders', {
      method: 'POST',
      headers: authHeader,
      body: {
        table_id: tableD1,
        type: 'dine_in',
        customer_count: 2,
        items: [{ product_id: 'prod-espresso', quantity: 2, unit_price: 120 }],
      },
    });
    assertEqualOrThrow(secondServeRes.status, 201, 'Second serve succeeded with 201');
    assertEqualOrThrow(secondServeRes.data.order.id, activeOrderId, 'Reused existing active order ID instead of creating duplicate');

    const countActiveOnTable = db.prepare(`SELECT count(*) as count FROM orders WHERE table_id = ? AND status != 'cancelled'`).get(tableD1) as any;
    assertEqualOrThrow(Number(countActiveOnTable.count), 1, 'Exactly 1 active order exists on table');

    const totalItemsOnOrder = db.prepare("SELECT SUM(quantity) as total_qty FROM order_items WHERE order_id = ? AND status != 'cancelled'").get(activeOrderId) as any;
    assertEqualOrThrow(Number(totalItemsOnOrder.total_qty), 3, 'Total items merged atomically to 3 (1 initial + 2 second)');

    // ── Test 16: Shift Close & EOD Z-Report Printed Drawer Difference/Variance ──
    console.log('\n[16] Verifying Shift Close & EOD Z-Report Printed Drawer Difference/Variance...');
    const { buildZReportSections } = require('../main/printers/thermal');
    const zShortagePayload = {
      z_number: 1,
      business_date: '2026-11-02',
      opening_float_cents: 100000,
      expected_cash_cents: 125000,
      counted_cash_cents: 120000,
      variance_cents: -5000,
      period_start: new Date().toISOString(),
      period_end: new Date().toISOString(),
      closed_by_name: 'Owner',
    };
    const { sections: shortageSections } = buildZReportSections(zShortagePayload, { columns: 48 });
    const shortageText = shortageSections.join('\n');
    assertOrThrow(shortageText.includes('1,250') || shortageText.includes('1250'), 'Z-report includes Expected Drawer Cash 1250');
    assertOrThrow(shortageText.includes('1,200') || shortageText.includes('1200'), 'Z-report includes Counted Drawer Cash 1200');
    assertOrThrow(shortageText.includes('-') && (shortageText.includes('50') || shortageText.includes('50.00')), 'Z-report includes negative variance (-50) for cash shortage');

    const zOveragePayload = {
      ...zShortagePayload,
      counted_cash_cents: 130000,
      variance_cents: 5000,
    };
    const { sections: overageSections } = buildZReportSections(zOveragePayload, { columns: 48 });
    const overageText = overageSections.join('\n');
    assertOrThrow(overageText.includes('+') && (overageText.includes('50') || overageText.includes('50.00')), 'Z-report includes positive variance (+50) for cash overage');

    // ── Test 11: Clear Orders with Master PIN ────────────────────────────────
    console.log('\n[11] Verifying Clear All Past Orders with Master PIN...');
    const { setMasterPin } = require('../main/services/master-pin');
    setMasterPin('1234');

    const dummyOrderRes = await api(baseUrl, '/api/orders', {
      method: 'POST',
      headers: authHeader,
      body: {
        table_id: null,
        type: 'takeaway',
        customer_count: 1,
        items: [
          { product_id: 'prod-espresso', quantity: 1, unit_price: 120 },
        ],
      },
    });
    assertEqualOrThrow(dummyOrderRes.status, 201, 'Dummy order created for clear test');

    const orderCountBefore = db.prepare('SELECT count(*) as count FROM orders').get().count;
    assertOrThrow(orderCountBefore > 0, 'Orders exist before clear');

    const clearRes = await api(baseUrl, '/api/database/clear-orders', {
      method: 'POST',
      headers: authHeader,
      body: {
        master_pin: '1234',
      },
    });
    assertEqualOrThrow(clearRes.status, 200, 'POST /api/database/clear-orders succeeded with 200 OK');
    assertEqualOrThrow(clearRes.data.success, true, 'Clear orders returned success: true');
    assertOrThrow(clearRes.data.clearedOrdersCount >= 1, 'Reported cleared orders count >= 1');

    const orderCountAfter = db.prepare('SELECT count(*) as count FROM orders').get().count;
    assertEqualOrThrow(orderCountAfter, 0, 'Orders table has 0 rows after clear-orders');

    const billsCountAfter = db.prepare('SELECT count(*) as count FROM bills').get().count;
    assertEqualOrThrow(billsCountAfter, 0, 'Bills table has 0 rows after clear-orders');

    const occupiedTablesCount = db.prepare("SELECT count(*) as count FROM tables WHERE status = 'occupied'").get().count;
    assertEqualOrThrow(occupiedTablesCount, 0, 'Zero occupied tables remaining after clear-orders');

    // ── Test 12: FloCafe 4.0.10 Offline Cryptographic Hardware-Bound Licensing ──
    console.log('\n[12] Verifying FloCafe 4.0.10 Offline Hardware-Bound Licensing & Anti-Copy Protection...');
    const { execSync } = require('child_process');
    const {
      getHardwareFingerprint,
      verifyHardwareLicense,
      activateWithKeyFile,
      TIER_DURATIONS_MS,
    } = require('../main/services/hardware-license');

    // 12.1 Verify Schema Migration 109
    const licTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_flo_hardware_license'").get();
    assertOrThrow(Boolean(licTable), "Table '_flo_hardware_license' exists in database");
    const licHistTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_flo_hardware_license_history'").get();
    assertOrThrow(Boolean(licHistTable), "Table '_flo_hardware_license_history' exists in database");

    // 12.2 Verify Git Protection Guard (No private key files tracked in git)
    const trackedKeys = execSync("git ls-files | grep -E '\\.flokey|\\.private\\.pem|owner-private-keys' || true", { encoding: 'utf8' }).trim();
    assertEqualOrThrow(trackedKeys, '', 'Zero .flokey or private key files tracked by git');

    // 12.3 Verify Tier Duration Definitions
    assertEqualOrThrow(TIER_DURATIONS_MS['forever'], null, 'forever duration is null (perpetual)');
    assertEqualOrThrow(TIER_DURATIONS_MS['24h'], 86_400_000, '24h duration is 86,400,000 ms');
    assertEqualOrThrow(TIER_DURATIONS_MS['3d'], 259_200_000, '3d duration is 259,200,000 ms');
    assertEqualOrThrow(TIER_DURATIONS_MS['1w'], 604_800_000, '1w duration is 604,800,000 ms');
    assertEqualOrThrow(TIER_DURATIONS_MS['1m'], 2_592_000_000, '1m duration is 2,592,000,000 ms');
    assertEqualOrThrow(TIER_DURATIONS_MS['3m'], 7_776_000_000, '3m duration is 7,776,000,000 ms');
    assertEqualOrThrow(TIER_DURATIONS_MS['6m'], 15_552_000_000, '6m duration is 15,552,000,000 ms');
    assertEqualOrThrow(TIER_DURATIONS_MS['1y'], 31_536_000_000, '1y duration is 31,536,000,000 ms');

    // 12.4 Verify Hardware Fingerprint Generation & Compiled Dist Self-Containment
    const hwid = getHardwareFingerprint();
    assertOrThrow(Boolean(hwid && hwid.startsWith('FLOHW-')), `Hardware Fingerprint generated: ${hwid}`);

    // Verify that compiled dist/main/services/hardware-license.js resolves self-contained without missing module errors
    const distLicensePath = path.resolve(__dirname, '../dist/main/services/hardware-license.js');
    if (fs.existsSync(distLicensePath)) {
      delete require.cache[require.resolve(distLicensePath)];
      const distLicense = require(distLicensePath);
      const distHwid = distLicense.getHardwareFingerprint();
      assertEqualOrThrow(distHwid, hwid, 'Compiled dist hardware-license.js generates identical HWID without missing modules');
    }

    // 12.5 Verify License Status Endpoint
    const licStatusRes = await api(baseUrl, '/api/license/status', { method: 'GET' });
    assertEqualOrThrow(licStatusRes.status, 200, 'GET /api/license/status returns 200 OK');
    assertEqualOrThrow(licStatusRes.data.valid, true, 'Seeded test license is valid');
    assertEqualOrThrow(licStatusRes.data.hwid, hwid, 'License status reports matching HWID');

    // 12.6 Verify Anti-Copy Protection (Hardware Mismatch Lock & HTTP 402 Gate)
    console.log('   Testing Anti-Copy Protection: Simulating application copy to another machine...');
    const { setTestMockHwid } = require('../main/services/hardware-license');

    // Simulate opening database on a different physical computer
    setTestMockHwid('FLOHW-COPIED-PIRATED-MACHINE-9999');

    const mismatchCheck = verifyHardwareLicense(db);
    assertEqualOrThrow(mismatchCheck.valid, false, 'Hardware mismatch invalidates license');
    assertEqualOrThrow(mismatchCheck.reason, 'hardware_mismatch', 'Lock reason is hardware_mismatch');

    // API route must now be blocked with HTTP 402 HARDWARE_LICENSE_LOCKED
    const blockedApiRes = await api(baseUrl, '/api/orders', {
      method: 'GET',
      headers: authHeader,
    });
    assertEqualOrThrow(blockedApiRes.status, 402, 'API access locked with HTTP 402 when hardware mismatched');
    assertEqualOrThrow(blockedApiRes.data.error, 'HARDWARE_LICENSE_LOCKED', 'Returned error is HARDWARE_LICENSE_LOCKED');

    // Restore real HWID
    setTestMockHwid(null);

    // 12.7 Verify System Clock Rollback Tamper Detection
    console.log('   Testing Clock Rollback Detection...');
    const originalRow = db.prepare('SELECT * FROM _flo_hardware_license WHERE id = 1').get();
    db.prepare('UPDATE _flo_hardware_license SET max_seen_timestamp = ? WHERE id = 1')
      .run(Date.now() + 600_000); // 10 minutes in the future

    const clockTamperCheck = verifyHardwareLicense(db);
    assertEqualOrThrow(clockTamperCheck.valid, false, 'Clock rollback invalidates license');
    assertEqualOrThrow(clockTamperCheck.reason, 'clock_tamper_detected', 'Lock reason is clock_tamper_detected');

    // Restore original row
    db.prepare('UPDATE _flo_hardware_license SET max_seen_timestamp = ? WHERE id = 1')
      .run(originalRow.max_seen_timestamp);

    // 12.8 Verify Activation with Duration Key & Single-Use Enforcement
    console.log('   Testing Activation with 24h key and Single-Use Enforcement...');
    const keyPath24h = path.resolve(__dirname, '../owner-private-keys/24h.flokey');
    const masterKeyPath = path.resolve(__dirname, '../owner-private-keys/owner-reactivate-master.flokey');

    if (fs.existsSync(keyPath24h) && fs.existsSync(masterKeyPath)) {
      const key24hContent = fs.readFileSync(keyPath24h, 'utf8');
      const masterKeyContent = fs.readFileSync(masterKeyPath, 'utf8');

      // First, simulate using an already-consumed key file (usage_count: 1) without owner override
      const consumedKeyJson = JSON.parse(key24hContent);
      consumedKeyJson.usage_count = 1;
      consumedKeyJson.bound_hwids = ['FLOHW-PRIOR-MACHINE-1111'];
      const consumedKeyContent = JSON.stringify(consumedKeyJson);

      const rejectedActivation = activateWithKeyFile(db, {
        tierKeyContent: consumedKeyContent,
      });
      assertEqualOrThrow(rejectedActivation.success, false, 'Consumed key without override is rejected');
      assertEqualOrThrow(rejectedActivation.requires_owner_override, true, 'Requires owner override flag is true');

      // Now provide owner override with wrong password -> must fail
      const wrongPasswordActivation = activateWithKeyFile(db, {
        tierKeyContent: consumedKeyContent,
        ownerMasterKeyContent: masterKeyContent,
        reactivationPassword: 'wrong-password-999',
      });
      assertEqualOrThrow(wrongPasswordActivation.success, false, 'Wrong password override is rejected');

      // Now provide owner override with correct password (Fl0220671190) + owner-reactivate-master.flokey -> must succeed!
      const successfulOverride = activateWithKeyFile(db, {
        tierKeyContent: consumedKeyContent,
        ownerMasterKeyContent: masterKeyContent,
        reactivationPassword: 'Fl0220671190',
      });
      assertEqualOrThrow(successfulOverride.success, true, 'Owner master key + password successfully activates consumed key');
      assertEqualOrThrow(successfulOverride.license?.tier, '24h', 'Activated tier is 24h');
      assertOrThrow(typeof successfulOverride.license?.expires_at === 'number', '24h license has numerical expires_at');
    }

    // 12.9 Verify Active License Replacement (Mid-Cycle Tier Switching with forceReplaceActive)
    console.log('   Testing Active License Replacement (Mid-Cycle Tier Switching)...');
    const keyPath1w = path.resolve(__dirname, '../owner-private-keys/1w.flokey');
    const keyPath3d = path.resolve(__dirname, '../owner-private-keys/3d.flokey');

    if (fs.existsSync(keyPath1w) && fs.existsSync(keyPath3d) && fs.existsSync(masterKeyPath)) {
      const key1wContent = fs.readFileSync(keyPath1w, 'utf8');
      const key3dContent = fs.readFileSync(keyPath3d, 'utf8');
      const masterKeyContent = fs.readFileSync(masterKeyPath, 'utf8');

      // First, activate an active 1-week license
      const activate1w = activateWithKeyFile(db, {
        tierKeyContent: key1wContent,
        ownerMasterKeyContent: masterKeyContent,
        reactivationPassword: 'Fl0220671190',
      });
      assertEqualOrThrow(activate1w.success, true, 'Activated 1w license');
      assertEqualOrThrow(activate1w.license?.tier, '1w', 'Active tier is 1w');

      // Attempting to replace active 1w with 3d via API POST /api/license/activate without owner credentials must fail
      const unauthReplaceRes = await api(baseUrl, '/api/license/activate', {
        method: 'POST',
        body: {
          tierKeyContent: key3dContent,
          forceReplaceActive: true,
        },
      });
      assertEqualOrThrow(unauthReplaceRes.status, 403, 'Replacing active license without owner override returns 403');
      assertEqualOrThrow(unauthReplaceRes.data.requires_owner_override, true, 'requires_owner_override is true');

      // Attempting with wrong owner password must fail
      const wrongPwReplaceRes = await api(baseUrl, '/api/license/activate', {
        method: 'POST',
        body: {
          tierKeyContent: key3dContent,
          ownerMasterKeyContent: masterKeyContent,
          reactivationPassword: 'wrong-owner-password',
          forceReplaceActive: true,
        },
      });
      assertEqualOrThrow(wrongPwReplaceRes.status, 400, 'Replacing active license with wrong password returns 400');

      // Replacing with correct password (Fl0220671190) and owner master key must succeed!
      const authReplaceRes = await api(baseUrl, '/api/license/activate', {
        method: 'POST',
        body: {
          tierKeyContent: key3dContent,
          ownerMasterKeyContent: masterKeyContent,
          reactivationPassword: 'Fl0220671190',
          forceReplaceActive: true,
        },
      });
      assertEqualOrThrow(authReplaceRes.status, 200, 'Replacing active license with owner override returns 200');
      assertEqualOrThrow(authReplaceRes.data.success, true, 'Replaced active license successfully');
      assertEqualOrThrow(authReplaceRes.data.license.tier, '3d', 'Active tier immediately updated to 3d');

      // Verify GET /api/license/status reports tier 3d
      const replacedStatusRes = await api(baseUrl, '/api/license/status', { method: 'GET' });
      assertEqualOrThrow(replacedStatusRes.data.tier, '3d', 'License status reflects switched 3d tier');
    }

    // 12.10 Verify Device Revocation & Immediate Locking (POST /api/license/revoke)
    console.log('   Testing Device Revocation and Locking (POST /api/license/revoke)...');
    if (fs.existsSync(masterKeyPath)) {
      const masterKeyContent = fs.readFileSync(masterKeyPath, 'utf8');

      // Attempting to revoke without credentials must fail
      const unauthRevokeRes = await api(baseUrl, '/api/license/revoke', {
        method: 'POST',
        body: {},
      });
      assertEqualOrThrow(unauthRevokeRes.status, 400, 'Revoke without credentials returns 400');

      // Attempting to revoke with wrong password must fail
      const wrongPwRevokeRes = await api(baseUrl, '/api/license/revoke', {
        method: 'POST',
        body: {
          ownerMasterKeyContent: masterKeyContent,
          reactivationPassword: 'invalid-password',
        },
      });
      assertEqualOrThrow(wrongPwRevokeRes.status, 400, 'Revoke with wrong password returns 400');

      // Revoking with correct owner credentials must succeed
      const validRevokeRes = await api(baseUrl, '/api/license/revoke', {
        method: 'POST',
        body: {
          ownerMasterKeyContent: masterKeyContent,
          reactivationPassword: 'Fl0220671190',
        },
      });
      assertEqualOrThrow(validRevokeRes.status, 200, 'Revoke with valid credentials returns 200');
      assertEqualOrThrow(validRevokeRes.data.success, true, 'License revoked successfully');

      // Verify license is immediately locked
      const revokedStatusRes = await api(baseUrl, '/api/license/status', { method: 'GET' });
      assertEqualOrThrow(revokedStatusRes.data.valid, false, 'License is no longer valid after revocation');
      assertEqualOrThrow(revokedStatusRes.data.reason, 'not_activated', 'Reason is not_activated');
      assertEqualOrThrow(revokedStatusRes.data.requires_owner_override, true, 'Requires owner override because machine history was preserved');

      // Verify API requests are blocked with HTTP 402
      const blockedAfterRevoke = await api(baseUrl, '/api/orders', {
        method: 'GET',
        headers: authHeader,
      });
      assertEqualOrThrow(blockedAfterRevoke.status, 402, 'API blocked with HTTP 402 after revocation');
    }

    // Restore forever developer license for subsequent operations
    const foreverKeyPath = path.resolve(__dirname, '../owner-private-keys/forever.flokey');
    if (fs.existsSync(foreverKeyPath) && fs.existsSync(masterKeyPath)) {
      const foreverContent = fs.readFileSync(foreverKeyPath, 'utf8');
      const masterContent = fs.readFileSync(masterKeyPath, 'utf8');
      const restoreForever = activateWithKeyFile(db, {
        tierKeyContent: foreverContent,
        ownerMasterKeyContent: masterContent,
        reactivationPassword: 'Fl0220671190',
      });
      assertEqualOrThrow(restoreForever.success, true, 'Restored forever license');
    }

    // ── Test 13: Sovereign Independence, OS Sentinel Daemon & MCP Server ──────
    console.log('\n--- Test 13: Sovereign Independence, OS Sentinel Daemon & MCP Server ---');

    // 13.1 Verify zero upstream flopos.com or posthog telemetry in runtime service
    console.log('   Testing sovereign telemetry sink...');
    const { TELEMETRY_URL } = require('../main/services/telemetry');
    assertOrThrow(
      TELEMETRY_URL.includes('3009') && TELEMETRY_URL.includes('/api/sentinel/telemetry-sink'),
      'Telemetry points strictly to sovereign local sink, not flopos.com'
    );
    assertOrThrow(!TELEMETRY_URL.includes('flopos.com'), 'Zero flopos.com in TELEMETRY_URL');
    assertOrThrow(!TELEMETRY_URL.includes('posthog'), 'Zero posthog in TELEMETRY_URL');

    // 13.2 Verify GET /api/sentinel/ping public beacon
    console.log('   Testing GET /api/sentinel/ping...');
    const pingRes = await api(baseUrl, '/api/sentinel/ping', { method: 'GET' });
    assertEqualOrThrow(pingRes.status, 200, 'Sentinel ping returns 200');
    assertEqualOrThrow(pingRes.data.status, 'ok', 'Ping status is ok');
    assertEqualOrThrow(pingRes.data.flocafe_running, true, 'flocafe_running is true');
    assertOrThrow(typeof pingRes.data.hwid === 'string' && pingRes.data.hwid.startsWith('FLOHW-'), 'Ping returns valid HWID');
    assertOrThrow(Array.isArray(pingRes.data.lan_ips), 'Ping returns lan_ips array');

    // 13.3 Verify Owner Cryptographic Authentication on Sentinel endpoints
    console.log('   Testing Owner Cryptographic Auth on Sentinel endpoints...');
    const unauthDiagRes = await api(baseUrl, '/api/sentinel/diagnostics', { method: 'GET' });
    assertEqualOrThrow(unauthDiagRes.status, 403, 'Diagnostics without owner credentials returns 403');
    assertEqualOrThrow(unauthDiagRes.data.error, 'FORBIDDEN_OWNER_AUTH_REQUIRED', 'Error code is FORBIDDEN_OWNER_AUTH_REQUIRED');

    const wrongPwDiagRes = await api(baseUrl, '/api/sentinel/diagnostics', {
      method: 'GET',
      headers: {
        'x-owner-password': 'wrong-password',
      },
    });
    assertEqualOrThrow(wrongPwDiagRes.status, 403, 'Diagnostics with wrong password returns 403');

    if (fs.existsSync(masterKeyPath)) {
      const masterKeyContent = fs.readFileSync(masterKeyPath, 'utf8');
      const base64MasterKey = Buffer.from(masterKeyContent, 'utf8').toString('base64');

      // Valid diagnostics with owner headers
      const validDiagRes = await api(baseUrl, '/api/sentinel/diagnostics', {
        method: 'GET',
        headers: {
          'x-owner-password': 'Fl0220671190',
          'x-owner-master-key': base64MasterKey,
        },
      });
      assertEqualOrThrow(validDiagRes.status, 200, 'Diagnostics with owner credentials returns 200');
      assertEqualOrThrow(validDiagRes.data.status, 'ok', 'Diagnostics status is ok');
      assertOrThrow(typeof validDiagRes.data.system?.cpu_cores === 'number', 'Diagnostics contains CPU cores');
      assertOrThrow(typeof validDiagRes.data.sqlite?.integrity === 'string', 'Diagnostics contains SQLite integrity');

      // Valid insights
      const validInsightsRes = await api(baseUrl, '/api/sentinel/insights', {
        method: 'GET',
        headers: {
          'x-owner-password': 'Fl0220671190',
          'x-owner-master-key': base64MasterKey,
        },
      });
      assertEqualOrThrow(validInsightsRes.status, 200, 'Insights with owner credentials returns 200');
      assertEqualOrThrow(validInsightsRes.data.status, 'ok', 'Insights status is ok');
      assertOrThrow(typeof validInsightsRes.data.today?.revenue === 'number', 'Insights contains today revenue');

      // App Control
      const appControlRes = await api(baseUrl, '/api/sentinel/app-control', {
        method: 'POST',
        headers: {
          'x-owner-password': 'Fl0220671190',
          'x-owner-master-key': base64MasterKey,
        },
        body: { action: 'run_safe_fixes' },
      });
      assertEqualOrThrow(appControlRes.status, 200, 'App control run_safe_fixes returns 200');
      assertEqualOrThrow(appControlRes.data.success, true, 'App control succeeded');

      // Remote License Update
      if (fs.existsSync(keyPath1w)) {
        const key1wContent = fs.readFileSync(keyPath1w, 'utf8');
        const remoteLicRes = await api(baseUrl, '/api/sentinel/remote-license', {
          method: 'POST',
          headers: {
            'x-owner-password': 'Fl0220671190',
            'x-owner-master-key': base64MasterKey,
          },
          body: {
            action: 'activate',
            tierKeyContent: key1wContent,
            ownerMasterKeyContent: masterKeyContent,
            reactivationPassword: 'Fl0220671190',
            autoRenewPolicy: { enabled: true, renew_tier: '1w', max_renewals: 5 },
          },
        });
        assertEqualOrThrow(remoteLicRes.status, 200, 'Remote license activation returns 200');
        assertEqualOrThrow(remoteLicRes.data.license?.tier, '1w', 'Remote license switched to 1w tier');
        assertEqualOrThrow(remoteLicRes.data.auto_renew_policy?.enabled, true, 'Auto-renew policy saved');
      }
    }

    // 13.4 Verify Model Context Protocol (MCP) Server
    console.log('   Testing scripts/flocafe-owner-mcp.cjs JSON-RPC 2.0 initialize & tools/list...');
    const mcpScriptPath = path.resolve(__dirname, '../scripts/flocafe-owner-mcp.cjs');
    assertOrThrow(fs.existsSync(mcpScriptPath), 'scripts/flocafe-owner-mcp.cjs exists');

    const initJson = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const initOutput = execSync(`echo '${initJson}' | node "${mcpScriptPath}"`, { encoding: 'utf8' });
    const parsedInit = JSON.parse(initOutput.trim());
    assertEqualOrThrow(parsedInit.result?.serverInfo?.name, 'flocafe-owner-mcp', 'MCP server name is flocafe-owner-mcp');
    assertEqualOrThrow(parsedInit.result?.serverInfo?.version, '4.1.0', 'MCP server version is 4.1.0');

    const toolsJson = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const toolsOutput = execSync(`echo '${toolsJson}' | node "${mcpScriptPath}"`, { encoding: 'utf8' });
    const parsedTools = JSON.parse(toolsOutput.trim());
    const toolNames = parsedTools.result?.tools?.map((t: any) => t.name) || [];
    assertOrThrow(toolNames.includes('flocafe_discover_nodes'), 'MCP exposes flocafe_discover_nodes');
    assertOrThrow(toolNames.includes('flocafe_node_diagnostics'), 'MCP exposes flocafe_node_diagnostics');
    assertOrThrow(toolNames.includes('flocafe_node_insights'), 'MCP exposes flocafe_node_insights');
    assertOrThrow(toolNames.includes('flocafe_node_license_update'), 'MCP exposes flocafe_node_license_update');
    assertOrThrow(toolNames.includes('flocafe_node_control'), 'MCP exposes flocafe_node_control');
    assertOrThrow(toolNames.includes('flocafe_node_sql'), 'MCP exposes flocafe_node_sql');

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
