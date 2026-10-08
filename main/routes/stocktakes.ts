import { Router } from 'express';
import { getDatabase } from '../db';
import { requirePermission } from '../services/authorization';
import {
  createStocktakeSession,
  addStocktakeCount,
  completeStocktakeSession,
  cancelStocktakeSession,
  getVarianceReport,
} from '../services/inventory-extended';

export const stocktakeRoutes = Router();

// List stocktake sessions
stocktakeRoutes.get('/sessions', requirePermission('inventory.view'), (req, res) => {
  try {
    const db = getDatabase();
    const sessions = db.prepare(`
      SELECT s.*, u.name as created_by_name, a.name as approved_by_name,
        (SELECT COUNT(*) FROM stocktake_items WHERE session_id = s.id) as item_count
      FROM stocktake_sessions s
      LEFT JOIN users u ON u.id = s.created_by
      LEFT JOIN users a ON a.id = s.approved_by
      ORDER BY s.created_at DESC
      LIMIT 100
    `).all();
    res.json({ sessions });
  } catch (error: any) {
    console.error('[API] Error listing stocktakes:', error);
    res.status(500).json({ error: 'Failed to list stocktakes' });
  }
});

// Get stocktake session details
stocktakeRoutes.get('/sessions/:id', requirePermission('inventory.view'), (req, res) => {
  try {
    const db = getDatabase();
    const session = db.prepare(`
      SELECT s.*, u.name as created_by_name, a.name as approved_by_name
      FROM stocktake_sessions s
      LEFT JOIN users u ON u.id = s.created_by
      LEFT JOIN users a ON a.id = s.approved_by
      WHERE s.id = ?
    `).get(req.params.id) as any;

    if (!session) {
      return res.status(404).json({ error: 'Stocktake session not found' });
    }

    const items = db.prepare(`
      SELECT si.*, s.name as supply_name, s.sku, s.base_unit
      FROM stocktake_items si
      JOIN supplies s ON s.id = si.supply_id
      WHERE si.session_id = ?
      ORDER BY s.name COLLATE NOCASE
    `).all(req.params.id);

    // If blind count and not completed, hide expected_quantity and variance
    const safeItems = items.map((item: any) => {
      if (session.is_blind && session.status !== 'completed') {
        const { expected_quantity, variance_quantity, ...rest } = item;
        return rest;
      }
      return item;
    });

    res.json({ session, items: safeItems });
  } catch (error: any) {
    console.error('[API] Error fetching stocktake session:', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

// Create new stocktake session
stocktakeRoutes.post('/sessions', requirePermission('inventory.manage'), (req, res) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const { is_blind, notes } = req.body;

    const session = createStocktakeSession(db, {
      isBlind: Boolean(is_blind),
      notes: notes ? String(notes).trim() : undefined,
      createdBy: user?.id || user?.userId || 'system',
    });

    res.status(201).json({ session });
  } catch (error: any) {
    console.error('[API] Error creating stocktake session:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to create session' });
  }
});

// Record item count in session
stocktakeRoutes.post('/sessions/:id/items', requirePermission('inventory.manage'), (req, res) => {
  try {
    const db = getDatabase();
    const { supply_id, counted_quantity, unit, notes } = req.body;

    if (!supply_id || counted_quantity === undefined) {
      return res.status(400).json({ error: 'supply_id and counted_quantity required' });
    }

    const item = addStocktakeCount(db, {
      sessionId: String(req.params.id),
      supplyId: String(supply_id),
      countedQuantity: Number(counted_quantity),
      unit: unit ? String(unit) : undefined,
      notes: notes ? String(notes).trim() : undefined,
    });

    res.json({ item });
  } catch (error: any) {
    console.error('[API] Error adding stocktake count:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to record count' });
  }
});

// Complete stocktake session
stocktakeRoutes.post('/sessions/:id/complete', requirePermission('inventory.manage'), (req, res) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const session = completeStocktakeSession(db, String(req.params.id), user?.id || user?.userId || 'system');
    res.json({ session });
  } catch (error: any) {
    console.error('[API] Error completing stocktake session:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to complete session' });
  }
});

// Cancel stocktake session
stocktakeRoutes.post('/sessions/:id/cancel', requirePermission('inventory.manage'), (req, res) => {
  try {
    const db = getDatabase();
    const result = cancelStocktakeSession(db, String(req.params.id));
    res.json(result);

  } catch (error: any) {
    console.error('[API] Error cancelling stocktake session:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to cancel session' });
  }
});

// Get variance report
stocktakeRoutes.get('/variance', requirePermission('inventory.view'), (req, res) => {
  try {
    const db = getDatabase();
    const { start_date, end_date } = req.query;
    const report = getVarianceReport(db, {
      startDate: start_date ? String(start_date) : undefined,
      endDate: end_date ? String(end_date) : undefined,
    });
    res.json({ report });
  } catch (error: any) {
    console.error('[API] Error generating variance report:', error);
    res.status(500).json({ error: 'Failed to generate variance report' });
  }
});
