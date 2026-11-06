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

    const totalIn = (summary.total_in_cents || 0) / 100;
    const totalOut = (summary.total_out_cents || 0) / 100;
    const expenses = (summary.expense_cents || 0) / 100;
    const purchases = (summary.purchase_cents || 0) / 100;
    const salaries = (summary.salary_cents || 0) / 100;
    const ownerDraw = (summary.withdrawal_cents || 0) / 100;
    const netProfit = totalIn - totalOut;

    res.json({
      ...summary,
      income: totalIn,
      expenses,
      purchases,
      salaries,
      owner_draw: ownerDraw,
      net_profit: netProfit,
    });
  } catch (error: any) {
    console.error('[Finance] Error getting summary:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
  }
});

financeRoutes.get('/transactions', requirePermission('reports.view'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { start_date, end_date, type, limit = 100 } = req.query;
    let query = `
      SELECT fm.*, u.name as actor_name
      FROM finance_movements fm
      LEFT JOIN users u ON u.id = fm.created_by
      WHERE 1=1
    `;
    const params: any[] = [];
    if (start_date) {
      query += ' AND fm.business_date >= ?';
      params.push(String(start_date));
    }
    if (end_date) {
      query += ' AND fm.business_date <= ?';
      params.push(String(end_date));
    }
    if (type && type !== 'all') {
      query += ' AND fm.movement_type = ?';
      params.push(String(type));
    }
    query += ' ORDER BY fm.created_at DESC, fm.id DESC LIMIT ?';
    params.push(Number(limit) || 100);

    const rows = db.prepare(query).all(...params) as any[];
    const transactions = rows.map((r) => ({
      id: r.id,
      type: r.movement_type,
      category: r.category,
      amount: (Number(r.amount_cents) || 0) / 100,
      tax_amount: 0,
      payment_method: r.payment_method,
      reference_no: r.source_transaction_id || null,
      description: r.description || null,
      actor_name: r.actor_name || r.created_by || null,
      created_at: r.created_at,
    }));
    res.json({ transactions });
  } catch (error: any) {
    console.error('[Finance] Error listing transactions:', error);
    res.status(500).json({ error: error.message || 'Failed to list transactions' });
  }
});

financeRoutes.post('/transactions', requirePermission('cash.movements.manage'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const body = req.body || {};
    const actorUserId = (req as any).user?.userId || 'system';
    const tz = getSettingValue('store_timezone') || 'UTC';
    const defaultDate = localDateInTimezone(new Date(), tz);
    const amountNum = Number(body.amount);
    if (!amountNum || amountNum <= 0) return res.status(400).json({ error: 'Positive amount is required' });

    const activeSession = getOpenSession(db);
    const direction = body.direction || (body.type === 'income' || body.type === 'cash_in' ? 'in' : 'out');

    const movement = recordFinanceMovement(db, {
      businessDate: body.business_date || defaultDate,
      movementType: (body.type || 'expense') as FinanceMovementType,
      amountCents: Math.round(amountNum * 100),
      currency: body.currency || getSettingValue('currency') || 'EGP',
      direction,
      category: body.category || 'General',
      paymentMethod: body.payment_method || 'cash',
      description: body.description || null,
      createdBy: actorUserId,
      shiftId: activeSession ? activeSession.id : null,
      sourceTransactionId: body.reference_no || null,
    });

    res.status(201).json({ success: true, transaction: movement });
  } catch (error: any) {
    console.error('[Finance] Error creating transaction:', error);
    res.status(error.statusCode || 400).json({ error: error.message || 'Invalid transaction request' });
  }
});

financeRoutes.get('/categories', requirePermission('reports.view'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT category, COUNT(*) as count, COALESCE(SUM(amount_cents), 0) as total_cents
      FROM finance_movements
      GROUP BY category
      ORDER BY total_cents DESC
    `).all() as any[];

    const categories = rows.map((r) => ({
      category: r.category,
      count: Number(r.count),
      total: Number(r.total_cents) / 100,
    }));
    res.json({ categories });
  } catch (error: any) {
    console.error('[Finance] Error listing categories:', error);
    res.status(500).json({ error: error.message || 'Failed to list categories' });
  }
});

// ==========================================
// Delivery Channels & Aggregator Commissions
// ==========================================
financeRoutes.get('/delivery-channels', requirePermission('finance.expenses.view'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const channels = db.prepare('SELECT * FROM delivery_channels ORDER BY channel_type ASC, name ASC').all();
    res.json({ delivery_channels: channels, channels });
  } catch (error: any) {
    console.error('[Finance] Error listing delivery channels:', error);
    res.status(500).json({ error: error.message || 'Failed to list delivery channels' });
  }
});

financeRoutes.post('/delivery-channels', requirePermission('finance.expenses.manage'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { id, name, channel_type = 'aggregator', commission_pct = 0, settlement_account = 'aggregator_receivable', is_active = 1 } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Channel name is required' });
    }

    const channelId = id || String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    db.prepare(`
      INSERT INTO delivery_channels (id, name, channel_type, commission_pct, settlement_account, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        channel_type = excluded.channel_type,
        commission_pct = excluded.commission_pct,
        settlement_account = excluded.settlement_account,
        is_active = excluded.is_active
    `).run(channelId, String(name).trim(), channel_type, Number(commission_pct) || 0, settlement_account, is_active ? 1 : 0);

    const channel = db.prepare('SELECT * FROM delivery_channels WHERE id = ?').get(channelId);
    res.status(201).json({ success: true, delivery_channel: channel });
  } catch (error: any) {
    console.error('[Finance] Error saving delivery channel:', error);
    res.status(500).json({ error: error.message || 'Failed to save delivery channel' });
  }
});

financeRoutes.get('/reports/pnl', requirePermission('finance.expenses.view'), (req: Request, res: Response) => {
  return handleGetPnl(req, res);
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
    const { now, localDateInTimezone, getSettingValue } = require('../db');
    const id = randomUUID();
    const timestamp = now();
    const effectiveSessionId = session_id ? Number(session_id) : (getOpenSession(db)?.id ?? null);
    let drawerMovementId: number | null = null;

    if (payment_method === 'cash' && effectiveSessionId) {
      try {
        const isDrawerIn = movement_type === 'cash_in';
        const drawerType = isDrawerIn ? 'pay_in' : 'pay_out';
        const cents = Math.round(Number(amount) * 100);
        const reasonStr = `${category}: ${notes || movement_type}`;
        const bDate = localDateInTimezone(new Date(), getSettingValue('store_timezone') || 'UTC');

        const dRes = db.prepare(`
          INSERT INTO cash_drawer_movements (
            business_date, movement_type, amount_cents, reason, created_by, created_at, cash_session_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(bDate, drawerType, cents, reasonStr, actorId, timestamp, effectiveSessionId);
        drawerMovementId = Number(dRes.lastInsertRowid);
      } catch (dErr) {
        console.error('[Finance] Error mirroring to cash_drawer_movements:', dErr);
      }
    }

    db.prepare(`
      INSERT INTO cash_movements (
        id, session_id, movement_type, category, amount, payment_method, reference_type, reference_id, notes, created_by, created_at, cash_drawer_movement_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      effectiveSessionId ? String(effectiveSessionId) : null,
      movement_type,
      category,
      Number(amount),
      payment_method,
      reference_type || null,
      reference_id ? String(reference_id) : null,
      notes || null,
      actorId,
      timestamp,
      drawerMovementId,
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

    // If paid from shift session drawer, record a petty_expense cash movement and cash_drawer_movements
    if (paid_from_session_id) {
      let drawerMovementId: number | null = null;
      try {
        const cents = Math.round(Number(amount) * 100);
        const dRes = db.prepare(`
          INSERT INTO cash_drawer_movements (
            business_date, movement_type, amount_cents, reason, created_by, created_at, cash_session_id
          ) VALUES (?, 'pay_out', ?, ?, ?, ?, ?)
        `).run(bDate, cents, `Drawer expense: ${title}`, actorId, timestamp, Number(paid_from_session_id));
        drawerMovementId = Number(dRes.lastInsertRowid);
      } catch (dErr) {
        console.error('[Finance] Error inserting cash_drawer_movements from expense:', dErr);
      }

      const movementId = randomUUID();
      db.prepare(`
        INSERT INTO cash_movements (
          id, session_id, movement_type, category, amount, payment_method, reference_type, reference_id, notes, created_by, created_at, cash_drawer_movement_id
        ) VALUES (?, ?, 'petty_expense', ?, ?, 'cash', 'operating_expense', ?, ?, ?, ?, ?)
      `).run(
        movementId,
        String(paid_from_session_id),
        category,
        Number(amount),
        id,
        `Drawer expense: ${title}`,
        actorId,
        timestamp,
        drawerMovementId,
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
export function handleGetPnl(req: Request, res: Response): void {
  try {
    const db = getDatabase();
    const { start_date, end_date } = req.query;

    const startDate = start_date ? String(start_date) : new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const endDate = end_date ? String(end_date) : new Date().toISOString().split('T')[0];

    // 1. Gross sales, discounts, refunds
    const salesRow = db.prepare(`
      SELECT
        COALESCE(SUM(b.subtotal), 0) as gross_sales,
        COALESCE(SUM(b.discount_amount), 0) as total_discounts,
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
    let expectedMaterialsCost = 0;
    const materialsMap = new Map<string, { material_name: string; unit: string; total_quantity: number; total_cost: number; cost_source: string }>();

    const getProductBom = db.prepare('SELECT id, prep_time_minutes, direct_labor_rate_per_hour, yield_portions FROM bom_headers WHERE product_id = ?');
    const getBomComps = db.prepare('SELECT * FROM bom_components WHERE bom_id = ?');

    for (const item of items) {
      const qty = Number(item.quantity) || 1;
      const bom = getProductBom.get(item.product_id) as any;
      if (bom) {
        const comps = getBomComps.all(bom.id) as any[];
        let itemMatCost = 0;
        const portions = Math.max(0.1, Number(bom.yield_portions || 1));

        for (const comp of comps) {
          let uCost = 0;
          let matName = comp.custom_material_name || comp.component_name || 'Material';
          let matUnit = comp.custom_unit || comp.unit || 'g';

          if (comp.cost_source === 'manual' && comp.custom_unit_cost !== null && comp.custom_unit_cost !== undefined) {
            uCost = Number(comp.custom_unit_cost);
          } else if (comp.target_type === 'custom') {
            uCost = Number(comp.custom_unit_cost || 0);
          } else if (comp.target_type === 'inventory') {
            const inv = db.prepare('SELECT cost_per_unit, name, unit FROM inventory_items WHERE id = ?').get(comp.target_id) as any;
            if (inv) {
              matName = inv.name || matName;
              matUnit = inv.unit || matUnit;
              uCost = Number(inv.cost_per_unit || 0);
            }
            if (uCost === 0 && comp.custom_unit_cost) uCost = Number(comp.custom_unit_cost);
          } else if (comp.target_type === 'supply') {
            const sup = db.prepare('SELECT cost_cents, name, base_unit FROM supplies WHERE id = ?').get(comp.target_id) as any;
            if (sup) {
              matName = sup.name || matName;
              matUnit = sup.base_unit || matUnit;
              uCost = Number(sup.cost_cents || 0) / 100;
            }
            if (uCost === 0 && comp.custom_unit_cost) uCost = Number(comp.custom_unit_cost);
          } else {
            uCost = Number(comp.custom_unit_cost || 0);
          }

          const net = Number(comp.net_quantity || 0);
          const waste = Math.min(99, Math.max(0, Number(comp.waste_pct || 0)));
          const grossPerPortion = net / (1 - waste / 100);
          const compUsageQty = (grossPerPortion / portions) * qty;
          const compUsageCost = compUsageQty * uCost;

          itemMatCost += (grossPerPortion / portions) * uCost;
          expectedMaterialsCost += compUsageCost;

          const key = `${matName}__${matUnit}`;
          const existingMat = materialsMap.get(key) || {
            material_name: matName,
            unit: matUnit,
            total_quantity: 0,
            total_cost: 0,
            cost_source: comp.cost_source || comp.target_type || 'auto',
          };
          existingMat.total_quantity += compUsageQty;
          existingMat.total_cost += compUsageCost;
          materialsMap.set(key, existingMat);
        }
        const itemLaborCost = ((Number(bom.prep_time_minutes || 0) / 60) * Number(bom.direct_labor_rate_per_hour || 0)) / portions;
        directCogs += (itemMatCost + itemLaborCost) * qty;
      }
    }

    // Fallback if no BOM items configured: check inventory / supply purchases or estimate 30%
    if (directCogs === 0 && netRevenue > 0) {
      directCogs = netRevenue * 0.3;
    }
    if (expectedMaterialsCost === 0 && directCogs > 0) {
      expectedMaterialsCost = directCogs;
    }

    const grossProfit = netRevenue - directCogs;
    const grossMarginPct = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;
    const standaloneBomProfit = Math.max(0, netRevenue - expectedMaterialsCost);
    const standaloneBomMarginPct = netRevenue > 0 ? (standaloneBomProfit / netRevenue) * 100 : 0;

    const expectedMaterialsUsedSummary = Array.from(materialsMap.values())
      .sort((a, b) => b.total_cost - a.total_cost)
      .slice(0, 20);

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

    // 5. Delivery Aggregator Revenue & Platform Commissions
    const aggRow = db.prepare(`
      SELECT
        COALESCE(SUM(total), 0) as gross_aggregator_revenue,
        COALESCE(SUM(aggregator_commission_amount), 0) as aggregator_commissions
      FROM orders
      WHERE status != 'cancelled'
        AND delivery_channel_id IS NOT NULL
        AND date(created_at) >= date(?) AND date(created_at) <= date(?)
    `).get(startDate, endDate) as any;
    const grossAggregatorRevenue = Number(aggRow?.gross_aggregator_revenue || 0);
    const aggregatorCommissions = Number(aggRow?.aggregator_commissions || 0);
    const netAggregatorReceivable = Math.max(0, grossAggregatorRevenue - aggregatorCommissions);

    const aggReceivablesRow = db.prepare(`
      SELECT COALESCE(SUM(total - COALESCE(aggregator_commission_amount, 0)), 0) as unsettled_receivables
      FROM orders
      WHERE status != 'cancelled'
        AND delivery_channel_id IS NOT NULL
        AND courier_settled_at IS NULL
        AND date(created_at) >= date(?) AND date(created_at) <= date(?)
    `).get(startDate, endDate) as any;
    const aggregatorReceivablesTotal = Number(aggReceivablesRow?.unsettled_receivables || 0);

    // 5b. Waste Breakdown & Unexplained Shrinkage
    const wasteBreakdown = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN LOWER(waste_type) IN ('waste', 'spoilage', 'remake') OR LOWER(COALESCE(reason, '')) IN ('waste', 'spoilage', 'remake') THEN total_cost ELSE 0 END), 0) as authorized_waste_cost,
        COALESCE(SUM(CASE WHEN LOWER(waste_type) IN ('calibration', 'dial_in', 'dial-in') OR LOWER(COALESCE(reason, '')) IN ('calibration', 'dial_in', 'dial-in') THEN total_cost ELSE 0 END), 0) as barista_calibration_cost,
        COALESCE(SUM(CASE WHEN LOWER(waste_type) IN ('staff_meal', 'staff_drink', 'staff meal', 'staff drink') OR LOWER(COALESCE(reason, '')) IN ('staff_meal', 'staff_drink', 'staff meal', 'staff drink') THEN total_cost ELSE 0 END), 0) as staff_meals_cost
      FROM waste_logs
      WHERE date(logged_at) >= date(?) AND date(logged_at) <= date(?)
    `).get(startDate, endDate) as any;

    const authorizedWasteCost = Number(wasteBreakdown?.authorized_waste_cost || 0);
    const baristaCalibrationCost = Number(wasteBreakdown?.barista_calibration_cost || 0);
    const staffMealsCost = Number(wasteBreakdown?.staff_meals_cost || 0);

    const shrinkageRow = db.prepare(`
      SELECT COALESCE(SUM(ABS(sl.variance_value)), 0) as total_shrinkage
      FROM stocktake_lines sl
      JOIN stocktake_sessions ss ON ss.id = sl.stocktake_id
      WHERE sl.variance_value < 0
        AND date(COALESCE(ss.reconciled_at, ss.created_at)) >= date(?)
        AND date(COALESCE(ss.reconciled_at, ss.created_at)) <= date(?)
    `).get(startDate, endDate) as any;
    const unexplainedShrinkageCost = Number(shrinkageRow?.total_shrinkage || 0);

    // 6. Net Operating Profit (EBITDA) & Standalone BOM P&L
    const ebitda = grossProfit - totalOperatingExpenses - payrollExpense;
    const ebitdaMarginPct = netRevenue > 0 ? (ebitda / netRevenue) * 100 : 0;
    const fullNetProfit = netRevenue - expectedMaterialsCost - authorizedWasteCost - baristaCalibrationCost - staffMealsCost - aggregatorCommissions - totalOperatingExpenses - payrollExpense;

    const pnlData = {
      gross_sales: grossSales,
      discounts,
      refunds,
      net_revenue: netRevenue,
      direct_cogs: directCogs,
      gross_profit: grossProfit,
      gross_margin_pct: grossMarginPct,
      expected_materials_cost: expectedMaterialsCost,
      standalone_bom_profit: standaloneBomProfit,
      standalone_bom_margin_pct: standaloneBomMarginPct,
      full_net_profit: fullNetProfit,
      expected_materials_used_summary: expectedMaterialsUsedSummary,
      direct_operating_expenses: directExpenses,
      indirect_operating_expenses: indirectExpenses,
      total_operating_expenses: totalOperatingExpenses,
      expense_breakdown: expenseBreakdown,
      payroll_expense: payrollExpense,
      gross_aggregator_revenue: grossAggregatorRevenue,
      aggregator_commissions: aggregatorCommissions,
      aggregator_commissions_cost: aggregatorCommissions,
      net_aggregator_receivable: netAggregatorReceivable,
      aggregator_receivables_total: aggregatorReceivablesTotal,
      authorized_waste_cost: authorizedWasteCost,
      barista_calibration_cost: baristaCalibrationCost,
      staff_meals_cost: staffMealsCost,
      unexplained_shrinkage_cost: unexplainedShrinkageCost,
      net_operating_profit_ebitda: ebitda,
      ebitda_margin_pct: ebitdaMarginPct,
    };

    res.json({
      period: { start_date: startDate, end_date: endDate },
      ...pnlData,
      pnl: pnlData,
    });
  } catch (error: any) {
    console.error('[Finance] Error computing P&L:', error);
    res.status(500).json({ error: error.message || 'Failed to compute financial P&L' });
  }
}

financeRoutes.get('/pnl', requirePermission('finance.expenses.view'), handleGetPnl);

// ==========================================
// Multi-Branch EOD Sync & Consolidated P&L
// ==========================================
financeRoutes.get('/multibranch-eod', requirePermission('finance.expenses.view'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const logs = db.prepare(`SELECT * FROM multibranch_eod_sync_logs ORDER BY created_at DESC LIMIT ?`).all(limit) as any[];

    // Parse JSON blobs and compute multi-branch aggregates
    let totalRevenue = 0;
    let totalCogs = 0;
    let totalWaste = 0;
    let totalStaffMeals = 0;
    let totalNetProfit = 0;

    const parsedLogs = logs.map((log) => {
      let zReport: any = {};
      let pnlSummary: any = {};
      try { zReport = JSON.parse(log.z_report_json); } catch {}
      try { pnlSummary = JSON.parse(log.pnl_summary_json); } catch {}

      totalRevenue += Number(pnlSummary.net_revenue || 0);
      totalCogs += Number(pnlSummary.cogs || 0);
      totalWaste += Number(pnlSummary.authorized_waste || 0);
      totalStaffMeals += Number(pnlSummary.staff_meals || 0);
      totalNetProfit += Number(pnlSummary.net_profit || 0);

      return {
        ...log,
        z_report: zReport,
        pnl_summary: pnlSummary,
      };
    });

    res.json({
      success: true,
      count: parsedLogs.length,
      logs: parsedLogs,
      consolidated: {
        total_revenue: totalRevenue,
        total_cogs: totalCogs,
        total_waste: totalWaste,
        total_staff_meals: totalStaffMeals,
        total_net_profit: totalNetProfit,
      },
    });
  } catch (error: any) {
    console.error('[Finance] Error fetching multibranch EOD logs:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch multibranch EOD logs' });
  }
});

financeRoutes.post('/multibranch-eod/trigger', requirePermission('finance.expenses.manage'), async (req: Request, res: Response) => {
  try {
    const { generateAndSyncEodBundle } = require('../services/google-drive');
    const result = await generateAndSyncEodBundle(req.body?.closure_id);
    res.json({ success: true, bundle: result });
  } catch (error: any) {
    console.error('[Finance] Error triggering multibranch EOD bundle:', error);
    res.status(500).json({ error: error.message || 'Failed to trigger multibranch EOD bundle' });
  }
});

