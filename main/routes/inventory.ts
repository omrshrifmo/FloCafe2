import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { getDatabase, now, withTxn } from '../db';
import { requirePermission } from '../services/authorization';
import { InventoryMovementType, listInventoryMovements } from '../services/inventory';

const router = Router();
const MOVEMENT_TYPES: InventoryMovementType[] = ['sale', 'cancel_restore', 'adjustment'];

function queryString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) {
    throw Object.assign(new Error(`${field} must be a non-empty string of at most 128 characters`), { statusCode: 400 });
  }
  return value.trim();
}

router.get('/movements', requirePermission('inventory.view'), (req: Request, res: Response) => {
  try {
    const productId = queryString(req.query.product_id, 'product_id');
    const referenceType = queryString(req.query.reference_type, 'reference_type');
    const referenceId = queryString(req.query.reference_id, 'reference_id');
    const movementType = queryString(req.query.movement_type, 'movement_type') as InventoryMovementType | undefined;
    if (movementType && !MOVEMENT_TYPES.includes(movementType)) {
      return res.status(400).json({ error: 'movement_type is invalid' });
    }

    const rawBeforeId = req.query.before_id;
    const beforeId = rawBeforeId === undefined
      ? undefined
      : typeof rawBeforeId === 'string' && /^\d+$/.test(rawBeforeId) ? Number(rawBeforeId) : NaN;
    if (beforeId !== undefined && (!Number.isSafeInteger(beforeId) || beforeId <= 0)) {
      return res.status(400).json({ error: 'before_id must be a positive integer' });
    }

    const rawPerPage = req.query.per_page;
    const requestedPerPage = rawPerPage === undefined ? NaN : Number(rawPerPage);
    const perPage = Number.isInteger(requestedPerPage) && requestedPerPage > 0
      ? Math.min(requestedPerPage, 500)
      : 50;

    const page = listInventoryMovements(getDatabase(), {
      productId,
      movementType,
      referenceType,
      referenceId,
      beforeId,
      perPage,
    });
    res.json({
      movements: page.movements,
      ...(page.nextCursor !== null && { nextCursor: page.nextCursor }),
    });
  } catch (error: unknown) {
    const details = error as { statusCode?: unknown; message?: unknown };
    const statusCode = Number.isInteger(details.statusCode) ? details.statusCode as number : 500;
    if (statusCode >= 500) console.error('[API] Internal error:', error);
    res.status(statusCode).json({ error: statusCode >= 500 ? 'Internal server error' : details.message });
  }
});

router.get('/warnings', requirePermission('inventory.view'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const invItems = db.prepare(`
      SELECT id, name, sku, category, unit, quantity, cost_per_unit, reorder_level, critical_level, 'inventory' as target_type
      FROM inventory_items WHERE is_active = 1
    `).all() as any[];

    const supItems = db.prepare(`
      SELECT id, name, null as sku, 'supply' as category, base_unit as unit,
        COALESCE(stock_quantity, quantity, 0) as quantity,
        (COALESCE(cost_cents, 0) / 100.0) as cost_per_unit,
        COALESCE(low_stock_threshold, 0) as reorder_level,
        COALESCE(critical_level, 0) as critical_level,
        'supply' as target_type
      FROM supplies WHERE is_active = 1 AND deleted_at IS NULL
    `).all() as any[];

    const allItems = [...invItems, ...supItems];
    const warnings: any[] = [];
    for (const item of allItems) {
      const qty = Number(item.quantity) || 0;
      const reorder = Number(item.reorder_level) || 0;
      const crit = Number(item.critical_level) || (reorder * 0.5);
      if (reorder <= 0 && qty > 0) continue;

      let severity: 'out_of_stock' | 'critical' | 'low_warning' | null = null;
      if (qty <= 0) severity = 'out_of_stock';
      else if (qty <= crit) severity = 'critical';
      else if (qty <= reorder) severity = 'low_warning';

      if (severity) {
        const suggestedOrderQty = Math.max(1, (reorder > 0 ? reorder * 2 : 10) - qty);
        warnings.push({ ...item, severity, suggested_order_qty: suggestedOrderQty });
      }
    }
    res.json({ warnings, total_warnings: warnings.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch inventory warnings' });
  }
});

router.get('/items', requirePermission('inventory.view'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const inventory = db.prepare('SELECT * FROM inventory_items WHERE is_active = 1 ORDER BY name ASC').all();
    const supplies = db.prepare('SELECT * FROM supplies WHERE is_active = 1 AND deleted_at IS NULL ORDER BY name ASC').all();
    res.json({ inventory_items: inventory, supplies });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch inventory items' });
  }
});

router.get('/stock-logs', requirePermission('inventory.view'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const logs = db.prepare('SELECT * FROM stock_logs ORDER BY created_at DESC LIMIT 100').all();
    res.json({ logs });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch stock logs' });
  }
});

// GET /api/inventory/waste-logs
router.get('/waste-logs', requirePermission('inventory.view'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const logs = db.prepare('SELECT * FROM waste_logs ORDER BY logged_at DESC LIMIT ?').all(limit) as any[];
    res.json({ success: true, waste_logs: logs });
  } catch (error: any) {
    console.error('[Inventory] Error fetching waste logs:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch waste logs' });
  }
});

// POST /api/inventory/waste-logs & /api/inventory/waste
router.post(['/waste-logs', '/waste'], requirePermission('inventory.manage'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const {
      waste_type,
      source_type,
      source_id,
      quantity = 1,
      reason,
      logged_by,
      shift_session_id,
    } = req.body;

    if (!waste_type || !source_type || !source_id) {
      return res.status(400).json({ error: 'waste_type, source_type, and source_id are required' });
    }

    const user = (req as any).user;
    const actor = logged_by || user?.name || user?.username || 'Staff';
    const qty = Math.max(0.0001, Number(quantity) || 1);
    const timestamp = now();
    const wasteId = randomUUID();

    let totalCost = 0;
    let itemName = '';
    let unit = 'each';

    withTxn(() => {
      if (source_type === 'product_bom' || source_type === 'product') {
        const prod = db.prepare('SELECT id, name, price FROM products WHERE id = ?').get(source_id) as any;
        if (!prod) throw new Error('Product not found for BOM waste log');
        itemName = prod.name;

        const header = db.prepare('SELECT id, yield_portions FROM bom_headers WHERE product_id = ?').get(prod.id) as any;
        if (header) {
          const components = db.prepare(`
            SELECT * FROM bom_components
            WHERE bom_id = ? AND (variant_id IS NULL OR variant_id = '') AND (addon_id IS NULL OR addon_id = '')
          `).all(header.id) as any[];
          const portions = Math.max(0.1, Number(header.yield_portions || 1));

          for (const comp of components) {
            const net = Number(comp.net_quantity) || 0;
            const wastePct = Math.min(99, Math.max(0, Number(comp.waste_pct) || 0));
            const grossPerPortion = net / (1 - wastePct / 100);
            const deductQty = (grossPerPortion / portions) * qty;

            if (comp.target_type === 'inventory') {
              const inv = db.prepare('SELECT cost_per_unit, quantity, unit FROM inventory_items WHERE id = ?').get(comp.target_id) as any;
              const unitCost = Number(inv?.cost_per_unit || 0);
              totalCost += deductQty * unitCost;

              db.prepare('UPDATE inventory_items SET quantity = quantity - ?, updated_at = ? WHERE id = ?')
                .run(deductQty, timestamp, comp.target_id);
              const after = Number(inv?.quantity || 0) - deductQty;
              db.prepare(`
                INSERT INTO stock_logs (
                  target_type, target_id, quantity_delta, stock_after, unit,
                  reason, reference_type, reference_id, actor_user_id, created_at
                ) VALUES ('inventory', ?, ?, ?, ?, ?, 'waste_log', ?, ?, ?)
              `).run(
                comp.target_id, -deductQty, after, inv?.unit || comp.unit,
                `Waste (${waste_type}): ${prod.name}`, wasteId, actor, timestamp
              );
            } else {
              const sup = db.prepare('SELECT cost_cents, stock_quantity, base_unit FROM supplies WHERE id = ?').get(comp.target_id) as any;
              const unitCost = Number(sup?.cost_cents || 0) / 100;
              totalCost += deductQty * unitCost;

              db.prepare('UPDATE supplies SET stock_quantity = stock_quantity - ?, quantity = COALESCE(quantity, stock_quantity) - ?, updated_at = ? WHERE id = ?')
                .run(deductQty, deductQty, timestamp, comp.target_id);
              const after = Number(sup?.stock_quantity || 0) - deductQty;
              db.prepare(`
                INSERT INTO stock_logs (
                  target_type, target_id, quantity_delta, stock_after, unit,
                  reason, reference_type, reference_id, actor_user_id, created_at
                ) VALUES ('supply', ?, ?, ?, ?, ?, 'waste_log', ?, ?, ?)
              `).run(
                comp.target_id, -deductQty, after, sup?.base_unit || comp.unit,
                `Waste (${waste_type}): ${prod.name}`, wasteId, actor, timestamp
              );
            }
          }
        }
      } else if (source_type === 'inventory') {
        const inv = db.prepare('SELECT id, name, unit, cost_per_unit, quantity FROM inventory_items WHERE id = ?').get(source_id) as any;
        if (!inv) throw new Error('Inventory item not found for waste log');
        itemName = inv.name;
        unit = inv.unit || 'g';
        const unitCost = Number(inv.cost_per_unit || 0);
        totalCost = qty * unitCost;

        db.prepare('UPDATE inventory_items SET quantity = quantity - ?, updated_at = ? WHERE id = ?')
          .run(qty, timestamp, inv.id);
        const after = Number(inv.quantity || 0) - qty;
        db.prepare(`
          INSERT INTO stock_logs (
            target_type, target_id, quantity_delta, stock_after, unit,
            reason, reference_type, reference_id, actor_user_id, created_at
          ) VALUES ('inventory', ?, ?, ?, ?, ?, 'waste_log', ?, ?, ?)
        `).run(
          inv.id, -qty, after, unit,
          `Waste (${waste_type}): ${inv.name}`, wasteId, actor, timestamp
        );
      } else if (source_type === 'supply') {
        const sup = db.prepare('SELECT id, name, base_unit, cost_cents, stock_quantity FROM supplies WHERE id = ?').get(source_id) as any;
        if (!sup) throw new Error('Supply item not found for waste log');
        itemName = sup.name;
        unit = sup.base_unit || 'each';
        const unitCost = Number(sup.cost_cents || 0) / 100;
        totalCost = qty * unitCost;

        db.prepare('UPDATE supplies SET stock_quantity = stock_quantity - ?, quantity = COALESCE(quantity, stock_quantity) - ?, updated_at = ? WHERE id = ?')
          .run(qty, qty, timestamp, sup.id);
        const after = Number(sup.stock_quantity || 0) - qty;
        db.prepare(`
          INSERT INTO stock_logs (
            target_type, target_id, quantity_delta, stock_after, unit,
            reason, reference_type, reference_id, actor_user_id, created_at
          ) VALUES ('supply', ?, ?, ?, ?, ?, 'waste_log', ?, ?, ?)
        `).run(
          sup.id, -qty, after, unit,
          `Waste (${waste_type}): ${sup.name}`, wasteId, actor, timestamp
        );
      }

      // Record in waste_logs
      db.prepare(`
        INSERT INTO waste_logs (
          id, waste_type, source_type, source_id, item_name, quantity, unit,
          total_cost, shift_session_id, reason, logged_by, logged_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        wasteId, waste_type, source_type, source_id, itemName, qty, unit,
        totalCost, shift_session_id || null, reason || null, actor, timestamp
      );

      // Record in operating_expenses (category = 'Authorized Waste & Staff Meals', cost_type = 'direct')
      const expenseId = randomUUID();
      const bDate = timestamp.slice(0, 10);
      db.prepare(`
        INSERT INTO operating_expenses (
          id, title, category, cost_type, allocation_method, amount,
          billing_cycle, business_date, paid_from_session_id, notes, created_by, created_at, updated_at
        ) VALUES (?, ?, 'Authorized Waste & Staff Meals', 'direct', 'per_unit_sold', ?, 'one_time', ?, ?, ?, ?, ?, ?)
      `).run(
        expenseId, `Waste: ${itemName} (${waste_type})`, totalCost, bDate,
        shift_session_id || null, reason || `Authorized waste log ${wasteId}`, actor, timestamp, timestamp
      );
    });

    const created = db.prepare('SELECT * FROM waste_logs WHERE id = ?').get(wasteId) as any;
    res.status(201).json({ success: true, waste_log: created });
  } catch (error: any) {
    console.error('[Inventory] Error logging waste:', error);
    res.status(500).json({ error: error.message || 'Failed to log waste' });
  }
});

export const inventoryRoutes = router;
