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

// List stocktake sessions
stocktakeRoutes.get('/sessions', requirePermission('inventory.view'), (req: Request, res: Response) => {
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
});

// Get single stocktake session with lines
stocktakeRoutes.get('/sessions/:id', requirePermission('inventory.view'), (req: Request, res: Response) => {
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

    session.lines = db.prepare(`
      SELECT * FROM stocktake_lines WHERE stocktake_id = ? ORDER BY item_name ASC
    `).all(session.id);

    res.json({ session });
  } catch (error: any) {
    console.error('[Stocktake] Error fetching session:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch session' });
  }
});

// Start new stocktake session
stocktakeRoutes.post('/sessions', requirePermission('inventory.stocktake.manage'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const actorId = user?.id || user?.userId || 'system';
    const { scope = 'all', notes } = req.body;

    const id = randomUUID();
    const referenceCode = `STK-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`;
    const timestamp = now();

    db.prepare(`
      INSERT INTO stocktake_sessions (
        id, reference_code, status, scope, total_expected_value, total_actual_value, total_variance_value,
        notes, started_by, started_at, created_by, created_at
      ) VALUES (?, ?, 'in_progress', ?, 0, 0, 0, ?, ?, ?, ?, ?)
    `).run(id, referenceCode, scope, notes || null, actorId, timestamp, actorId, timestamp);

    const session = db.prepare('SELECT * FROM stocktake_sessions WHERE id = ?').get(id);
    res.status(201).json({ session });
  } catch (error: any) {
    console.error('[Stocktake] Error starting session:', error);
    res.status(500).json({ error: error.message || 'Failed to start stocktake session' });
  }
});

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
