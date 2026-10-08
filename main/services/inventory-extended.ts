import { getDatabase, now, withTxn, newId } from '../db';
import { roundQuantity, convertQuantity, assertSupplyUnit } from './units';
import { applySupplyStockChange, getSupply } from './supplies';

export interface CreateStocktakeInput {
  isBlind?: boolean;
  notes?: string;
  createdBy: string;
}

export interface RecordStocktakeCountInput {
  sessionId: string;
  supplyId: string;
  countedQuantity: number;
  unit?: string;
  notes?: string;
}

export function createStocktakeSession(db: ReturnType<typeof getDatabase>, input: CreateStocktakeInput) {
  const id = newId('stk');
  const timestamp = now();
  const isBlind = input.isBlind ? 1 : 0;

  db.prepare(`
    INSERT INTO stocktake_sessions (id, status, is_blind, notes, created_by, approved_by, created_at, completed_at)
    VALUES (?, 'in_progress', ?, ?, ?, NULL, ?, NULL)
  `).run(id, isBlind, input.notes || null, input.createdBy, timestamp);

  return db.prepare('SELECT * FROM stocktake_sessions WHERE id = ?').get(id);
}

export function addStocktakeCount(db: ReturnType<typeof getDatabase>, input: RecordStocktakeCountInput) {
  const session = db.prepare('SELECT * FROM stocktake_sessions WHERE id = ?').get(input.sessionId) as any;
  if (!session || session.status !== 'in_progress') {
    throw Object.assign(new Error('Stocktake session is not active'), { statusCode: 400 });
  }

  const supply = getSupply(db, input.supplyId);
  const unit = input.unit ? assertSupplyUnit(input.unit, 'unit') : supply.base_unit;
  const countedInBase = convertQuantity(input.countedQuantity, unit, supply.base_unit);
  const expectedQuantity = Number(supply.stock_quantity);
  const variance = roundQuantity(countedInBase - expectedQuantity);
  const costCents = (supply as any).cost_cents ? Number((supply as any).cost_cents) : null;

  const id = newId('sti');
  const timestamp = now();

  // Upsert or insert item
  const existing = db.prepare('SELECT id FROM stocktake_items WHERE session_id = ? AND supply_id = ?').get(input.sessionId, input.supplyId) as any;
  if (existing) {
    db.prepare(`
      UPDATE stocktake_items
      SET counted_quantity = ?, variance_quantity = ?, unit = ?, cost_cents = ?, notes = ?
      WHERE id = ?
    `).run(countedInBase, variance, supply.base_unit, costCents, input.notes || null, existing.id);
    return db.prepare('SELECT * FROM stocktake_items WHERE id = ?').get(existing.id);
  }

  db.prepare(`
    INSERT INTO stocktake_items (id, session_id, supply_id, expected_quantity, counted_quantity, variance_quantity, unit, cost_cents, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.sessionId, input.supplyId, expectedQuantity, countedInBase, variance, supply.base_unit, costCents, input.notes || null, timestamp);

  return db.prepare('SELECT * FROM stocktake_items WHERE id = ?').get(id);
}

export function completeStocktakeSession(db: ReturnType<typeof getDatabase>, sessionId: string, actorUserId: string) {
  return withTxn(() => {
    const session = db.prepare('SELECT * FROM stocktake_sessions WHERE id = ?').get(sessionId) as any;
    if (!session || session.status !== 'in_progress') {
      throw Object.assign(new Error('Session is not in progress'), { statusCode: 400 });
    }

    const items = db.prepare(`
      SELECT si.*, s.name as supply_name, s.base_unit
      FROM stocktake_items si
      JOIN supplies s ON s.id = si.supply_id
      WHERE si.session_id = ?
    `).all(sessionId) as any[];

    const timestamp = now();

    // Adjust supply stock to match counted quantities
    for (const item of items) {
      if (item.counted_quantity !== null && item.variance_quantity !== 0) {
        applySupplyStockChange(db, {
          supplyId: item.supply_id,
          quantityDelta: item.variance_quantity,
          movementType: 'count',
          unit: item.base_unit,
          reason: `Stocktake session ${sessionId}`,
          actorUserId,
          referenceType: 'stocktake_session',
          referenceId: sessionId,
          createdAt: timestamp,
        });
      }
    }

    db.prepare(`
      UPDATE stocktake_sessions
      SET status = 'completed', approved_by = ?, completed_at = ?
      WHERE id = ?
    `).run(actorUserId, timestamp, sessionId);

    return db.prepare('SELECT * FROM stocktake_sessions WHERE id = ?').get(sessionId);
  });
}

export function cancelStocktakeSession(db: ReturnType<typeof getDatabase>, sessionId: string) {
  const session = db.prepare('SELECT * FROM stocktake_sessions WHERE id = ?').get(sessionId) as any;
  if (!session || session.status !== 'in_progress') {
    throw Object.assign(new Error('Session is not in progress'), { statusCode: 400 });
  }

  db.prepare(`UPDATE stocktake_sessions SET status = 'cancelled' WHERE id = ?`).run(sessionId);
  return { success: true, sessionId };
}

export function getVarianceReport(
  db: ReturnType<typeof getDatabase>,
  options: { startDate?: string; endDate?: string } = {}
) {
  const params: any[] = [];
  let dateClause = '';
  if (options.startDate && options.endDate) {
    dateClause = 'WHERE sm.created_at >= ? AND sm.created_at <= ?';
    params.push(options.startDate, options.endDate);
  }

  // Aggregate movements by supply: opening, received, depleted, waste, restores
  const rows = db.prepare(`
    SELECT
      s.id as supply_id,
      s.name as supply_name,
      s.base_unit,
      s.stock_quantity as current_stock,
      s.cost_cents,
      COALESCE(SUM(CASE WHEN sm.movement_type = 'receive' THEN sm.quantity_delta ELSE 0 END), 0) as total_received,
      COALESCE(SUM(CASE WHEN sm.movement_type = 'recipe_depletion' THEN ABS(sm.quantity_delta) ELSE 0 END), 0) as total_recipe_depletion,
      COALESCE(SUM(CASE WHEN sm.movement_type = 'recipe_restore' THEN sm.quantity_delta ELSE 0 END), 0) as total_recipe_restored,
      COALESCE(SUM(CASE WHEN sm.movement_type = 'waste' THEN ABS(sm.quantity_delta) ELSE 0 END), 0) as total_waste,
      COALESCE(SUM(CASE WHEN sm.movement_type = 'adjustment' THEN sm.quantity_delta ELSE 0 END), 0) as total_adjusted,
      COALESCE(SUM(CASE WHEN sm.movement_type = 'count' THEN sm.quantity_delta ELSE 0 END), 0) as total_count_variance
    FROM supplies s
    LEFT JOIN supply_movements sm ON sm.supply_id = s.id ${dateClause}
    WHERE s.deleted_at IS NULL
    GROUP BY s.id
    ORDER BY s.name COLLATE NOCASE
  `).all(...params) as any[];

  return rows.map((r) => {
    const theoreticalRemaining = roundQuantity(
      (r.total_received || 0) - (r.total_recipe_depletion || 0) + (r.total_recipe_restored || 0) - (r.total_waste || 0) + (r.total_adjusted || 0)
    );
    const varianceQuantity = r.total_count_variance;
    const varianceCostCents = r.cost_cents ? roundQuantity(varianceQuantity * r.cost_cents) : null;
    const wasteCostCents = r.cost_cents ? roundQuantity(r.total_waste * r.cost_cents) : null;

    return {
      supply_id: r.supply_id,
      supply_name: r.supply_name,
      base_unit: r.base_unit,
      current_stock: r.current_stock,
      cost_cents: r.cost_cents,
      total_received: r.total_received,
      total_recipe_depletion: r.total_recipe_depletion,
      total_recipe_restored: r.total_recipe_restored,
      total_waste: r.total_waste,
      waste_cost_cents: wasteCostCents,
      theoretical_remaining: theoreticalRemaining,
      variance_quantity: varianceQuantity,
      variance_cost_cents: varianceCostCents,
    };
  });
}
