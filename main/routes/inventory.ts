import { Router, Request, Response } from 'express';
import { getDatabase } from '../db';
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

export const inventoryRoutes = router;
