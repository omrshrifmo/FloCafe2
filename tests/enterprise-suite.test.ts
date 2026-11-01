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
      app: { isPackaged: true, getPath: () => testDir, getVersion: () => '4.0.7' },
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
  console.log('FloCafe 4.0.7 Enterprise Suite Integration Test');
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
    // ── Test 1: Non-destructive SQLite migration v107 schema verification ──────
    console.log('\n[1] Verifying Release 4.0.7 Schema Migration (v107)...');
    const userVersion = db.pragma('user_version', { simple: true });
    assertOrThrow(userVersion >= 107, `Schema user_version is ${userVersion} (expected >= 107)`);

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
