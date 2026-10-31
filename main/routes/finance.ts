import { Router, Request, Response } from 'express';
import { getDatabase, localDateInTimezone, getSettingValue } from '../db';
import { requirePermission } from '../services/authorization';
import {
  listFinanceMovements,
  recordFinanceMovement,
  reverseFinanceMovement,
  getFinanceSummary,
  type FinanceMovementType,
} from '../services/finance';
import { getOpenSession } from '../services/shift-session-gate';

export const financeRoutes = Router();

financeRoutes.get('/movements', requirePermission('reports.view'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const {
      business_date,
      start_date,
      end_date,
      movement_type,
      direction,
      category,
      shift_id,
      payment_method,
      limit,
      offset,
    } = req.query;

    const result = listFinanceMovements(db, {
      businessDate: business_date ? String(business_date) : undefined,
      startDate: start_date ? String(start_date) : undefined,
      endDate: end_date ? String(end_date) : undefined,
      movementType: movement_type ? String(movement_type) : undefined,
      direction: direction ? (String(direction) as 'in' | 'out') : undefined,
      category: category ? String(category) : undefined,
      shiftId: shift_id ? Number(shift_id) : undefined,
      paymentMethod: payment_method ? String(payment_method) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });

    res.json(result);
  } catch (error: any) {
    console.error('[Finance] Error listing movements:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
  }
});

financeRoutes.post('/movements', requirePermission('cash.movements.manage'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const body = req.body || {};
    const actorUserId = (req as any).user?.userId || 'system';

    const tz = getSettingValue('store_timezone') || 'UTC';
    const defaultDate = localDateInTimezone(new Date(), tz);
    const activeSession = getOpenSession(db);

    const movement = recordFinanceMovement(db, {
      businessDate: body.business_date || defaultDate,
      movementType: body.movement_type as FinanceMovementType,
      amountCents: Number(body.amount_cents),
      currency: body.currency || getSettingValue('currency') || 'EGP',
      direction: body.direction,
      category: body.category,
      paymentMethod: body.payment_method || 'cash',
      description: body.description,
      createdBy: actorUserId,
      shiftId: body.shift_id !== undefined ? (body.shift_id === null ? null : Number(body.shift_id)) : (activeSession ? activeSession.id : null),
      branchId: body.branch_id || null,
      sourceTransactionType: body.source_transaction_type,
      sourceTransactionId: body.source_transaction_id,
      relatedEmployeeId: body.related_employee_id,
      relatedSupplierId: body.related_supplier_id,
      approvalStatus: body.approval_status || 'approved',
      approvedBy: body.approval_status === 'approved' ? actorUserId : null,
      attachmentRef: body.attachment_ref,
    });

    res.status(201).json({ success: true, movement });
  } catch (error: any) {
    console.error('[Finance] Error creating movement:', error);
    res.status(error.statusCode || 400).json({ error: error.message || 'Invalid movement request' });
  }
});

financeRoutes.post('/movements/:id/reverse', requirePermission('cash.movements.manage'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const actorUserId = (req as any).user?.userId || 'system';
    const reason = req.body?.reason || '';

    const reversal = reverseFinanceMovement(db, String(req.params.id), actorUserId, reason);
    res.json({ success: true, reversal });
  } catch (error: any) {
    console.error('[Finance] Error reversing movement:', error);
    res.status(error.statusCode || 400).json({ error: error.message || 'Reversal failed' });
  }
});


financeRoutes.get('/summary', requirePermission('reports.view'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { business_date, start_date, end_date } = req.query;

    const summary = getFinanceSummary(db, {
      businessDate: business_date ? String(business_date) : undefined,
      startDate: start_date ? String(start_date) : undefined,
      endDate: end_date ? String(end_date) : undefined,
    });

    res.json(summary);
  } catch (error: any) {
    console.error('[Finance] Error getting summary:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
  }
});

// ==========================================
// Phase 3 — Cash Movements
// ==========================================
financeRoutes.get('/cash-movements', requirePermission('finance.expenses.view'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { session_id, movement_type } = req.query;
    let query = 'SELECT cm.*, u.name as created_by_name FROM cash_movements cm LEFT JOIN users u ON u.id = cm.created_by WHERE 1=1';
    const params: any[] = [];
    if (session_id) {
      query += ' AND cm.session_id = ?';
      params.push(String(session_id));
    }
    if (movement_type) {
      query += ' AND cm.movement_type = ?';
      params.push(String(movement_type));
    }
    query += ' ORDER BY cm.created_at DESC LIMIT 200';
    const movements = db.prepare(query).all(...params);
    res.json({ cash_movements: movements });
  } catch (error: any) {
    console.error('[Finance] Error listing cash movements:', error);
    res.status(500).json({ error: error.message || 'Failed to list cash movements' });
  }
});

financeRoutes.post('/cash-movements', requirePermission('finance.expenses.manage'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const actorId = user?.id || user?.userId || 'system';
    const {
      session_id,
      movement_type,
      category,
      amount,
      payment_method = 'cash',
      reference_type,
      reference_id,
      notes,
    } = req.body;

    if (!movement_type || !category || amount === undefined || Number(amount) <= 0) {
      return res.status(400).json({ error: 'movement_type, category, and positive amount are required' });
    }

    const { randomUUID } = require('crypto');
    const { now } = require('../db');
    const id = randomUUID();
    const timestamp = now();

    db.prepare(`
      INSERT INTO cash_movements (
        id, session_id, movement_type, category, amount, payment_method, reference_type, reference_id, notes, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      session_id ? String(session_id) : null,
      movement_type,
      category,
      Number(amount),
      payment_method,
      reference_type || null,
      reference_id ? String(reference_id) : null,
      notes || null,
      actorId,
      timestamp,
    );

    const movement = db.prepare('SELECT * FROM cash_movements WHERE id = ?').get(id);
    res.status(201).json({ cash_movement: movement });
  } catch (error: any) {
    console.error('[Finance] Error creating cash movement:', error);
    res.status(500).json({ error: error.message || 'Failed to create cash movement' });
  }
});

financeRoutes.post('/cash-movements/:id/void', requirePermission('cash.movements.void'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const actorId = user?.id || user?.userId || 'system';
    const { void_reason } = req.body;
    const { now } = require('../db');

    db.prepare(`
      UPDATE cash_movements
      SET voided_at = ?, voided_by = ?, void_reason = ?
      WHERE id = ? AND voided_at IS NULL
    `).run(now(), actorId, void_reason || 'Voided by manager', req.params.id);

    const updated = db.prepare('SELECT * FROM cash_movements WHERE id = ?').get(req.params.id);
    res.json({ success: true, cash_movement: updated });
  } catch (error: any) {
    console.error('[Finance] Error voiding cash movement:', error);
    res.status(500).json({ error: error.message || 'Failed to void cash movement' });
  }
});

// ==========================================
// Phase 3 — Operating Expenses
// ==========================================
financeRoutes.get('/expenses', requirePermission('finance.expenses.view'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { category, cost_type, start_date, end_date } = req.query;
    let query = 'SELECT oe.*, u.name as created_by_name FROM operating_expenses oe LEFT JOIN users u ON u.id = oe.created_by WHERE 1=1';
    const params: any[] = [];
    if (category) {
      query += ' AND oe.category = ?';
      params.push(String(category));
    }
    if (cost_type) {
      query += ' AND oe.cost_type = ?';
      params.push(String(cost_type));
    }
    if (start_date) {
      query += ' AND oe.business_date >= ?';
      params.push(String(start_date));
    }
    if (end_date) {
      query += ' AND oe.business_date <= ?';
      params.push(String(end_date));
    }
    query += ' ORDER BY oe.business_date DESC, oe.created_at DESC LIMIT 200';
    const expenses = db.prepare(query).all(...params);
    res.json({ expenses });
  } catch (error: any) {
    console.error('[Finance] Error listing operating expenses:', error);
    res.status(500).json({ error: error.message || 'Failed to list expenses' });
  }
});

financeRoutes.post('/expenses', requirePermission('finance.expenses.manage'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const actorId = user?.id || user?.userId || 'system';
    const {
      title,
      category,
      cost_type = 'indirect',
      allocation_method = 'per_unit_sold',
      amount,
      billing_cycle = 'monthly',
      business_date,
      paid_from_session_id,
      supplier_id,
      notes,
    } = req.body;

    if (!title || !category || amount === undefined || Number(amount) <= 0) {
      return res.status(400).json({ error: 'title, category, and positive amount are required' });
    }

    const { randomUUID } = require('crypto');
    const { now } = require('../db');
    const id = randomUUID();
    const timestamp = now();
    const bDate = business_date || new Date().toISOString().split('T')[0];

    db.prepare(`
      INSERT INTO operating_expenses (
        id, title, category, cost_type, allocation_method, amount, billing_cycle, business_date,
        paid_from_session_id, supplier_id, notes, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      String(title).trim(),
      category,
      cost_type,
      allocation_method,
      Number(amount),
      billing_cycle,
      bDate,
      paid_from_session_id ? String(paid_from_session_id) : null,
      supplier_id || null,
      notes || null,
      actorId,
      timestamp,
      timestamp,
    );

    // If paid from shift session drawer, record a petty_expense cash movement
    if (paid_from_session_id) {
      const movementId = randomUUID();
      db.prepare(`
        INSERT INTO cash_movements (
          id, session_id, movement_type, category, amount, payment_method, reference_type, reference_id, notes, created_by, created_at
        ) VALUES (?, ?, 'petty_expense', ?, ?, 'cash', 'operating_expense', ?, ?, ?, ?)
      `).run(
        movementId,
        String(paid_from_session_id),
        category,
        Number(amount),
        id,
        `Drawer expense: ${title}`,
        actorId,
        timestamp,
      );
    }

    const expense = db.prepare('SELECT * FROM operating_expenses WHERE id = ?').get(id);
    res.status(201).json({ expense });
  } catch (error: any) {
    console.error('[Finance] Error creating expense:', error);
    res.status(500).json({ error: error.message || 'Failed to create expense' });
  }
});

financeRoutes.delete('/expenses/:id', requirePermission('finance.expenses.manage'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    db.prepare('DELETE FROM operating_expenses WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[Finance] Error deleting expense:', error);
    res.status(500).json({ error: error.message || 'Failed to delete expense' });
  }
});

// ==========================================
// Phase 3 — Financial Income Statement (P&L)
// Gross Sales -> Discounts/Refunds -> Net Revenue -> Direct BOM COGS -> Gross Profit -> Expenses -> Payroll -> EBITDA
// ==========================================
financeRoutes.get('/pnl', requirePermission('finance.expenses.view'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { start_date, end_date } = req.query;

    const startDate = start_date ? String(start_date) : new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const endDate = end_date ? String(end_date) : new Date().toISOString().split('T')[0];

    // 1. Gross sales, discounts, refunds
    const salesRow = db.prepare(`
      SELECT
        COALESCE(SUM(b.subtotal), 0) as gross_sales,
        COALESCE(SUM(b.discount_total), 0) as total_discounts,
        COALESCE(SUM(b.total), 0) as net_collected,
        COUNT(b.id) as total_bills
      FROM bills b
      JOIN orders o ON o.id = b.order_id
      WHERE o.status != 'cancelled'
        AND b.payment_status IN ('paid', 'partially_refunded', 'refunded')
        AND date(b.created_at) >= date(?) AND date(b.created_at) <= date(?)
    `).get(startDate, endDate) as any;

    const refundsRow = db.prepare(`
      SELECT COALESCE(SUM(amount_cents), 0) as total_refund_cents
      FROM refunds
      WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)
    `).get(startDate, endDate) as any;

    const grossSales = Number(salesRow?.gross_sales || 0);
    const discounts = Number(salesRow?.total_discounts || 0);
    const refunds = Number(refundsRow?.total_refund_cents || 0) / 100;
    const netRevenue = Math.max(0, grossSales - discounts - refunds);

    // 2. Automated Direct BOM COGS (Material + Direct Prep Labor)
    const items = db.prepare(`
      SELECT oi.product_id, oi.quantity, oi.recipe_snapshot
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.status != 'cancelled'
        AND oi.status != 'refunded'
        AND date(oi.created_at) >= date(?) AND date(oi.created_at) <= date(?)
    `).all(startDate, endDate) as any[];

    let directCogs = 0;
    const getProductBom = db.prepare('SELECT id, prep_time_minutes, direct_labor_rate_per_hour, yield_portions FROM bom_headers WHERE product_id = ?');
    const getBomComps = db.prepare('SELECT * FROM bom_components WHERE bom_id = ?');

    for (const item of items) {
      const qty = Number(item.quantity) || 1;
      const bom = getProductBom.get(item.product_id) as any;
      if (bom) {
        const comps = getBomComps.all(bom.id) as any[];
        let itemMatCost = 0;
        for (const comp of comps) {
          let uCost = 0;
          if (comp.target_type === 'inventory') {
            const inv = db.prepare('SELECT cost_per_unit FROM inventory_items WHERE id = ?').get(comp.target_id) as any;
            uCost = Number(inv?.cost_per_unit || 0);
          } else {
            const sup = db.prepare('SELECT cost_cents FROM supplies WHERE id = ?').get(comp.target_id) as any;
            uCost = Number(sup?.cost_cents || 0) / 100;
          }
          itemMatCost += (comp.gross_quantity || comp.net_quantity) * uCost;
        }
        const itemLaborCost = ((Number(bom.prep_time_minutes || 0) / 60) * Number(bom.direct_labor_rate_per_hour || 0)) / Math.max(1, Number(bom.yield_portions || 1));
        directCogs += (itemMatCost + itemLaborCost) * qty;
      } else {
        // Fallback to supplies recipe or 25% default
        directCogs += 0;
      }
    }

    // Fallback if no BOM items configured: check inventory / supply purchases or estimate 30%
    if (directCogs === 0 && netRevenue > 0) {
      directCogs = netRevenue * 0.3;
    }

    const grossProfit = netRevenue - directCogs;
    const grossMarginPct = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;

    // 3. Operating Expenses (Direct & Indirect)
    const expensesRows = db.prepare(`
      SELECT category, cost_type, COALESCE(SUM(amount), 0) as total
      FROM operating_expenses
      WHERE business_date >= date(?) AND business_date <= date(?)
      GROUP BY category, cost_type
    `).all(startDate, endDate) as any[];

    let directExpenses = 0;
    let indirectExpenses = 0;
    const expenseBreakdown: Record<string, number> = {};

    for (const exp of expensesRows) {
      const amt = Number(exp.total) || 0;
      if (exp.cost_type === 'direct') {
        directExpenses += amt;
      } else {
        indirectExpenses += amt;
      }
      expenseBreakdown[exp.category] = (expenseBreakdown[exp.category] || 0) + amt;
    }
    const totalOperatingExpenses = directExpenses + indirectExpenses;

    // 4. HRM Payroll Expense
    const payrollRow = db.prepare(`
      SELECT COALESCE(SUM(net_payable), 0) as total_payroll
      FROM hr_payroll_runs
      WHERE payroll_month >= substr(?, 1, 7) AND payroll_month <= substr(?, 1, 7)
    `).get(startDate, endDate) as any;
    const payrollExpense = Number(payrollRow?.total_payroll || 0);

    // 5. Net Operating Profit (EBITDA)
    const ebitda = grossProfit - totalOperatingExpenses - payrollExpense;
    const ebitdaMarginPct = netRevenue > 0 ? (ebitda / netRevenue) * 100 : 0;

    res.json({
      period: { start_date: startDate, end_date: endDate },
      pnl: {
        gross_sales: grossSales,
        discounts,
        refunds,
        net_revenue: netRevenue,
        direct_cogs: directCogs,
        gross_profit: grossProfit,
        gross_margin_pct: grossMarginPct,
        direct_operating_expenses: directExpenses,
        indirect_operating_expenses: indirectExpenses,
        total_operating_expenses: totalOperatingExpenses,
        expense_breakdown: expenseBreakdown,
        payroll_expense: payrollExpense,
        net_operating_profit_ebitda: ebitda,
        ebitda_margin_pct: ebitdaMarginPct,
      },
    });
  } catch (error: any) {
    console.error('[Finance] Error computing P&L:', error);
    res.status(500).json({ error: error.message || 'Failed to compute financial P&L' });
  }
});

