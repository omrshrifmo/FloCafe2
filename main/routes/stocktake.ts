import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { getDatabase, now, withTxn } from '../db';
import { requirePermission } from '../services/authorization';

export const stocktakeRoutes = Router();

// GET /inventory/warnings: Classified as 'out_of_stock' (<= 0), 'critical' (<= critical_level or <= reorder_level * 0.5), or 'low_warning' (<= reorder_level)
stocktakeRoutes.get('/warnings', requirePermission('inventory.view'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();

    const invItems = db.prepare(`
      SELECT
        id, name, sku, category, unit, quantity, cost_per_unit, reorder_level, critical_level,
        'inventory' as target_type
      FROM inventory_items
      WHERE is_active = 1
    `).all() as any[];

    const supItems = db.prepare(`
      SELECT
        id, name, null as sku, 'supply' as category, base_unit as unit,
        COALESCE(stock_quantity, quantity, 0) as quantity,
        (COALESCE(cost_cents, 0) / 100.0) as cost_per_unit,
        COALESCE(low_stock_threshold, 0) as reorder_level,
        COALESCE(critical_level, 0) as critical_level,
        'supply' as target_type
      FROM supplies
      WHERE is_active = 1 AND deleted_at IS NULL
    `).all() as any[];

    const allItems = [...invItems, ...supItems];
    const warnings: any[] = [];

    for (const item of allItems) {
      const qty = Number(item.quantity) || 0;
      const reorder = Number(item.reorder_level) || 0;
      const crit = Number(item.critical_level) || (reorder * 0.5);

      if (reorder <= 0 && qty > 0) continue;

      let severity: 'out_of_stock' | 'critical' | 'low_warning' | null = null;
      if (qty <= 0) {
        severity = 'out_of_stock';
      } else if (qty <= crit) {
        severity = 'critical';
      } else if (qty <= reorder) {
        severity = 'low_warning';
      }

      if (severity) {
        const suggestedOrderQty = Math.max(1, (reorder > 0 ? reorder * 2 : 10) - qty);
        warnings.push({
          ...item,
          severity,
          suggested_order_qty: suggestedOrderQty,
        });
      }
    }

    res.json({ warnings, total_warnings: warnings.length });
  } catch (error: any) {
    console.error('[Stocktake] Error fetching warnings:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch inventory warnings' });
  }
});

function populateStocktakeLines(db: ReturnType<typeof getDatabase>, sessionId: string, timestamp: string) {
  const invItems = db.prepare(`SELECT id, name, unit, quantity, cost_per_unit FROM inventory_items WHERE is_active = 1`).all() as any[];
  const supItems = db.prepare(`SELECT id, name, base_unit as unit, COALESCE(stock_quantity, quantity, 0) as quantity, (COALESCE(cost_cents, 0)/100.0) as cost_per_unit FROM supplies WHERE is_active = 1 AND deleted_at IS NULL`).all() as any[];

  const insertLine = db.prepare(`
    INSERT INTO stocktake_lines (
      id, stocktake_id, target_type, target_id, item_name, unit, expected_qty, actual_qty, variance_qty, unit_cost, variance_value, variance_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 'match')
  `);

  let totalExpected = 0;

  for (const inv of invItems) {
    const lineId = randomUUID();
    const eq = Number(inv.quantity) || 0;
    const uc = Number(inv.cost_per_unit) || 0;
    totalExpected += eq * uc;
    insertLine.run(lineId, sessionId, 'inventory', inv.id, inv.name, inv.unit || 'unit', eq, eq, uc);
  }
  for (const sup of supItems) {
    const lineId = randomUUID();
    const eq = Number(sup.quantity) || 0;
    const uc = Number(sup.cost_per_unit) || 0;
    totalExpected += eq * uc;
    insertLine.run(lineId, sessionId, 'supply', sup.id, sup.name, sup.unit || 'unit', eq, eq, uc);
  }

  db.prepare(`
    UPDATE stocktake_sessions
    SET total_expected_value = ?, total_actual_value = ?, total_variance_value = 0
    WHERE id = ?
  `).run(totalExpected, totalExpected, sessionId);

  return totalExpected;
}

function shapeStocktakeSession(db: ReturnType<typeof getDatabase>, session: any) {
  const lines = db.prepare(`SELECT * FROM stocktake_lines WHERE stocktake_id = ? ORDER BY item_name ASC`).all(session.id) as any[];
  const items = lines.map((l) => ({
    id: l.id,
    target_type: l.target_type,
    target_id: l.target_id,
    supply_id: l.target_id,
    item_name: l.item_name,
    supply_name: l.item_name,
    unit: l.unit,
    base_unit: l.unit,
    expected_qty: l.expected_qty,
    expected_quantity: l.expected_qty,
    actual_qty: l.actual_qty,
    counted_quantity: l.actual_qty,
    variance_qty: l.variance_qty,
    variance_quantity: l.variance_qty,
    unit_cost: l.unit_cost,
    variance_value: l.variance_value,
    variance_cost: l.variance_value,
    variance_reason: l.variance_reason,
    notes: l.variance_reason,
  }));
  return {
    ...session,
    lines,
    items,
  };
}

// List stocktake sessions (supports GET / and GET /sessions)
const listSessionsHandler = (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const sessions = db.prepare(`
      SELECT s.*, u.name as started_by_name, r.name as reconciled_by_name,
        (SELECT COUNT(*) FROM stocktake_lines WHERE stocktake_id = s.id) as line_count
      FROM stocktake_sessions s
      LEFT JOIN users u ON u.id = s.started_by
      LEFT JOIN users r ON r.id = s.reconciled_by
      ORDER BY s.started_at DESC, s.created_at DESC
      LIMIT 100
    `).all();
    res.json({ sessions });
  } catch (error: any) {
    console.error('[Stocktake] Error listing sessions:', error);
    res.status(500).json({ error: error.message || 'Failed to list stocktake sessions' });
  }
};

stocktakeRoutes.get('/', requirePermission('inventory.view'), listSessionsHandler);
stocktakeRoutes.get('/sessions', requirePermission('inventory.view'), listSessionsHandler);

// Get single stocktake session (supports GET /:id and GET /sessions/:id)
const getSingleSessionHandler = (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const session = db.prepare(`
      SELECT s.*, u.name as started_by_name, r.name as reconciled_by_name
      FROM stocktake_sessions s
      LEFT JOIN users u ON u.id = s.started_by
      LEFT JOIN users r ON r.id = s.reconciled_by
      WHERE s.id = ?
    `).get(req.params.id) as any;
    if (!session) return res.status(404).json({ error: 'Stocktake session not found' });

    const shaped = shapeStocktakeSession(db, session);
    res.json({ session: shaped, items: shaped.items });
  } catch (error: any) {
    console.error('[Stocktake] Error fetching session:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch session' });
  }
};

stocktakeRoutes.get('/:id', requirePermission('inventory.view'), getSingleSessionHandler);
stocktakeRoutes.get('/sessions/:id', requirePermission('inventory.view'), getSingleSessionHandler);

// Start new stocktake session (supports POST / and POST /sessions)
const createSessionHandler = (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const actorId = user?.id || user?.userId || 'system';
    const { scope = 'all', notes, counter_name } = req.body || {};

    const id = randomUUID();
    const referenceCode = `STK-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`;
    const timestamp = now();

    withTxn(() => {
      db.prepare(`
        INSERT INTO stocktake_sessions (
          id, reference_code, status, scope, total_expected_value, total_actual_value, total_variance_value,
          notes, started_by, started_at, created_by, created_at
        ) VALUES (?, ?, 'in_progress', ?, 0, 0, 0, ?, ?, ?, ?, ?)
      `).run(id, referenceCode, scope, notes || counter_name || null, actorId, timestamp, actorId, timestamp);

      populateStocktakeLines(db, id, timestamp);
    });

    const session = db.prepare('SELECT * FROM stocktake_sessions WHERE id = ?').get(id) as any;
    const shaped = shapeStocktakeSession(db, session);
    res.status(201).json({ id, session: shaped, items: shaped.items });
  } catch (error: any) {
    console.error('[Stocktake] Error starting session:', error);
    res.status(500).json({ error: error.message || 'Failed to start stocktake session' });
  }
};

stocktakeRoutes.post('/', requirePermission('inventory.stocktake.manage'), createSessionHandler);
stocktakeRoutes.post('/sessions', requirePermission('inventory.stocktake.manage'), createSessionHandler);

// Update session items (supports PUT /:id/items and PUT /sessions/:id/items)
const updateItemsHandler = (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const sessionId = req.params.id;
    const { items, lines } = req.body || {};
    const inputItems = Array.isArray(items) ? items : (Array.isArray(lines) ? lines : []);

    withTxn(() => {
      let totalActual = 0;
      let totalExpected = 0;
      let totalVariance = 0;

      for (const item of inputItems) {
        const targetId = item.supply_id || item.target_id;
        const line = db.prepare(`SELECT * FROM stocktake_lines WHERE stocktake_id = ? AND (target_id = ? OR id = ?)`).get(sessionId, targetId, item.id) as any;
        if (!line) continue;

        const counted = item.counted_quantity !== undefined && item.counted_quantity !== null
          ? Number(item.counted_quantity)
          : (item.actual_qty !== undefined ? Number(item.actual_qty) : line.expected_qty);
        const reason = item.variance_reason || item.notes || (counted === line.expected_qty ? 'match' : 'counting_correction');
        const vQty = counted - line.expected_qty;
        const vVal = vQty * line.unit_cost;

        db.prepare(`
          UPDATE stocktake_lines
          SET actual_qty = ?, variance_qty = ?, variance_value = ?, variance_reason = ?
          WHERE id = ?
        `).run(counted, vQty, vVal, reason, line.id);

        totalExpected += line.expected_qty * line.unit_cost;
        totalActual += counted * line.unit_cost;
        totalVariance += vVal;
      }

      db.prepare(`
        UPDATE stocktake_sessions
        SET total_expected_value = ?, total_actual_value = ?, total_variance_value = ?
        WHERE id = ?
      `).run(totalExpected, totalActual, totalVariance, sessionId);
    });

    const session = db.prepare('SELECT * FROM stocktake_sessions WHERE id = ?').get(sessionId) as any;
    const shaped = shapeStocktakeSession(db, session);
    res.json({ success: true, session: shaped, items: shaped.items });
  } catch (error: any) {
    console.error('[Stocktake] Error updating items:', error);
    res.status(500).json({ error: error.message || 'Failed to update items' });
  }
};

stocktakeRoutes.put('/:id/items', requirePermission('inventory.stocktake.manage'), updateItemsHandler);
stocktakeRoutes.put('/sessions/:id/items', requirePermission('inventory.stocktake.manage'), updateItemsHandler);

// Finalize / Reconcile session (supports POST /:id/finalize and POST /sessions/:id/reconcile)
const finalizeSessionHandler = (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const sessionId = req.params.id;
    const user = (req as any).user;
    const actorId = user?.id || user?.userId || 'system';
    const timestamp = now();

    const session = db.prepare('SELECT * FROM stocktake_sessions WHERE id = ?').get(sessionId) as any;
    if (!session) return res.status(404).json({ error: 'Stocktake session not found' });

    withTxn(() => {
      const lines = db.prepare('SELECT * FROM stocktake_lines WHERE stocktake_id = ?').all(sessionId) as any[];

      for (const line of lines) {
        if (line.target_type === 'inventory') {
          db.prepare(`
            UPDATE inventory_items
            SET quantity = ?, last_counted_qty = ?, last_counted_at = ?, updated_at = ?
            WHERE id = ?
          `).run(line.actual_qty, line.actual_qty, timestamp, timestamp, line.target_id);
        } else {
          db.prepare(`
            UPDATE supplies
            SET stock_quantity = ?, quantity = ?, last_counted_qty = ?, last_counted_at = ?, updated_at = ?
            WHERE id = ?
          `).run(line.actual_qty, line.actual_qty, line.actual_qty, timestamp, timestamp, line.target_id);
        }

        if (Math.abs(line.variance_qty) > 0.0001) {
          db.prepare(`
            INSERT INTO stock_logs (
              target_type, target_id, quantity_delta, stock_after, unit, reason, actor_user_id, reference_type, reference_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'stocktake', ?, ?)
          `).run(
            line.target_type, line.target_id, line.variance_qty, line.actual_qty, line.unit,
            `Stocktake count reconciliation: ${line.variance_reason || 'Count adjustment'} (${line.variance_qty > 0 ? '+' : ''}${line.variance_qty} ${line.unit})`,
            actorId, sessionId, timestamp
          );
        }
      }

      db.prepare(`
        UPDATE stocktake_sessions
        SET status = 'completed', reconciled_by = ?, reconciled_at = ?
        WHERE id = ?
      `).run(actorId, timestamp, sessionId);
    });

    const updated = db.prepare('SELECT * FROM stocktake_sessions WHERE id = ?').get(sessionId) as any;
    res.json({ success: true, session: shapeStocktakeSession(db, updated) });
  } catch (error: any) {
    console.error('[Stocktake] Error finalizing session:', error);
    res.status(500).json({ error: error.message || 'Failed to finalize session' });
  }
};

stocktakeRoutes.post('/:id/finalize', requirePermission('inventory.stocktake.manage'), finalizeSessionHandler);
stocktakeRoutes.post('/sessions/:id/reconcile', requirePermission('inventory.stocktake.manage'), finalizeSessionHandler);

// POST /stocktakes/reconcile: Accepts physical count lines, calculates variances, updates quantities, records stock_logs
stocktakeRoutes.post('/reconcile', requirePermission('inventory.stocktake.manage'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const actorId = user?.id || user?.userId || 'system';
    const { stocktake_id, lines, notes } = req.body;

    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'lines array is required' });
    }

    const sessionId = stocktake_id || randomUUID();
    const timestamp = now();

    const summary = withTxn(() => {
      let totalExpectedVal = 0;
      let totalActualVal = 0;
      let totalVarianceVal = 0;
      let totalVarianceQty = 0;

      // Ensure session exists
      const existingSession = db.prepare('SELECT id FROM stocktake_sessions WHERE id = ?').get(sessionId);
      if (!existingSession) {
        const ref = `STK-REC-${Date.now().toString().slice(-6)}`;
        db.prepare(`
          INSERT INTO stocktake_sessions (
            id, reference_code, status, scope, total_expected_value, total_actual_value, total_variance_value,
            notes, started_by, started_at, reconciled_by, reconciled_at, created_by, created_at
          ) VALUES (?, ?, 'completed', 'all', 0, 0, 0, ?, ?, ?, ?, ?, ?, ?)
        `).run(sessionId, ref, notes || null, actorId, timestamp, actorId, timestamp, actorId, timestamp);
      }

      const insertLine = db.prepare(`
        INSERT INTO stocktake_lines (
          id, stocktake_id, target_type, target_id, item_name, unit, expected_qty, actual_qty, variance_qty, unit_cost, variance_value, variance_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const line of lines) {
        const targetType = line.target_type === 'supply' ? 'supply' : 'inventory';
        const targetId = String(line.target_id || '').trim();
        const actualQty = Number(line.actual_qty) || 0;
        const varianceReason = line.variance_reason ? String(line.variance_reason).trim() : 'Stock count adjustment';

        let itemName = line.item_name || 'Item';
        let unit = line.unit || 'each';
        let expectedQty = 0;
        let unitCost = 0;

        if (targetType === 'inventory') {
          const inv = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(targetId) as any;
          if (inv) {
            itemName = inv.name;
            unit = inv.unit || 'each';
            expectedQty = Number(inv.quantity) || 0;
            unitCost = Number(inv.cost_per_unit) || 0;

            // Update physical count
            db.prepare(`
              UPDATE inventory_items
              SET quantity = ?, last_counted_qty = ?, last_counted_at = ?, updated_at = ?
              WHERE id = ?
            `).run(actualQty, actualQty, timestamp, timestamp, inv.id);
          }
        } else {
          // targetType === 'supply'
          const sup = db.prepare('SELECT * FROM supplies WHERE id = ?').get(targetId) as any;
          if (sup) {
            itemName = sup.name;
            unit = sup.base_unit || 'each';
            expectedQty = Number(sup.stock_quantity ?? sup.quantity ?? 0);
            unitCost = Number(sup.cost_cents || 0) / 100;

            // Update physical count
            db.prepare(`
              UPDATE supplies
              SET stock_quantity = ?, quantity = ?, last_counted_qty = ?, last_counted_at = ?, updated_at = ?
              WHERE id = ?
            `).run(actualQty, actualQty, actualQty, timestamp, timestamp, sup.id);
          }
        }

        const varianceQty = actualQty - expectedQty;
        const varianceValue = varianceQty * unitCost;

        totalExpectedVal += expectedQty * unitCost;
        totalActualVal += actualQty * unitCost;
        totalVarianceVal += varianceValue;
        totalVarianceQty += varianceQty;

        const lineId = randomUUID();
        insertLine.run(
          lineId, sessionId, targetType, targetId, itemName, unit, expectedQty, actualQty, varianceQty, unitCost, varianceValue, varianceReason
        );

        // Record stock_logs if non-zero variance
        if (Math.abs(varianceQty) > 0.0001) {
          db.prepare(`
            INSERT INTO stock_logs (
              target_type, target_id, quantity_delta, stock_after, unit, reason, actor_user_id, reference_type, reference_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'stocktake', ?, ?)
          `).run(
            targetType, targetId, varianceQty, actualQty, unit,
            `Stocktake count reconciliation: ${varianceReason} (${varianceQty > 0 ? '+' : ''}${varianceQty} ${unit})`,
            actorId, sessionId, timestamp
          );
        }
      }

      // Update session totals
      db.prepare(`
        UPDATE stocktake_sessions
        SET status = 'completed',
            total_expected_value = ?,
            total_actual_value = ?,
            total_variance_value = ?,
            reconciled_by = ?,
            reconciled_at = ?,
            notes = COALESCE(?, notes)
        WHERE id = ?
      `).run(totalExpectedVal, totalActualVal, totalVarianceVal, actorId, timestamp, notes || null, sessionId);

      return {
        session_id: sessionId,
        total_expected_value: totalExpectedVal,
        total_actual_value: totalActualVal,
        total_variance_value: totalVarianceVal,
        total_variance_qty: totalVarianceQty,
        reconciled_at: timestamp,
      };
    });

    res.json({ success: true, ...summary });
  } catch (error: any) {
    console.error('[Stocktake] Error reconciling stocktake:', error);
    res.status(500).json({ error: error.message || 'Failed to reconcile stocktake' });
  }
});
