import { Router } from 'express';
import { getDatabase } from '../db';
import { requirePermission } from '../services/authorization';
import {
  listHaccpTasks,
  createHaccpTask,
  recordHaccpLog,
  verifyHaccpLog,
  getDailyHaccpReport,
} from '../services/haccp';

export const haccpRoutes = Router();

// List tasks
haccpRoutes.get('/tasks', (req, res) => {
  try {
    const db = getDatabase();
    const { category, station_id, active_only } = req.query;
    const tasks = listHaccpTasks(db, {
      category: category ? String(category) : undefined,
      stationId: station_id ? String(station_id) : undefined,
      activeOnly: active_only !== 'false',
    });
    res.json({ tasks });
  } catch (error: any) {
    console.error('[API] Error listing HACCP tasks:', error);
    res.status(500).json({ error: 'Failed to list tasks' });
  }
});

// Create task
haccpRoutes.post('/tasks', requirePermission('staff.operational.manage'), (req, res) => {
  try {
    const db = getDatabase();
    const { title, category, station_id, frequency, target_value } = req.body;
    if (!title || !category || !frequency) {
      return res.status(400).json({ error: 'title, category, and frequency are required' });
    }

    const task = createHaccpTask(db, {
      title: String(title).trim(),
      category: String(category).trim(),
      stationId: station_id ? String(station_id) : undefined,
      frequency: String(frequency).trim(),
      targetValue: target_value ? String(target_value).trim() : undefined,
    });
    res.status(201).json({ task });
  } catch (error: any) {
    console.error('[API] Error creating HACCP task:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// Record log entry (cleaning, temp check, hygiene)
haccpRoutes.post('/logs', (req, res) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const { task_id, business_date, shift_id, status, measured_value, corrective_action, notes } = req.body;

    if (!task_id || !status) {
      return res.status(400).json({ error: 'task_id and status are required' });
    }

    const log = recordHaccpLog(db, {
      taskId: String(task_id),
      businessDate: business_date ? String(business_date) : new Date().toISOString().split('T')[0],
      shiftId: shift_id ? Number(shift_id) : undefined,
      status,
      measuredValue: measured_value ? String(measured_value) : undefined,
      completedBy: user?.id || user?.userId || 'staff',
      correctiveAction: corrective_action ? String(corrective_action) : undefined,
      notes: notes ? String(notes) : undefined,
    });

    res.status(201).json({ log });
  } catch (error: any) {
    console.error('[API] Error recording HACCP log:', error);
    res.status(500).json({ error: 'Failed to record log' });
  }
});

// Verify log entry (supervisor)
haccpRoutes.post('/logs/:id/verify', requirePermission('staff.operational.manage'), (req, res) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const { corrective_action } = req.body;

    const log = verifyHaccpLog(
      db,
      String(req.params.id),
      user?.id || user?.userId || 'supervisor',
      corrective_action ? String(corrective_action) : undefined
    );


    res.json({ log });
  } catch (error: any) {
    console.error('[API] Error verifying HACCP log:', error);
    res.status(500).json({ error: 'Failed to verify log' });
  }
});

// Daily HACCP / Cleaning report
haccpRoutes.get('/report', (req, res) => {
  try {
    const db = getDatabase();
    const { date, shift_id } = req.query;
    const businessDate = date ? String(date) : new Date().toISOString().split('T')[0];
    const report = getDailyHaccpReport(db, businessDate, shift_id ? Number(shift_id) : undefined);
    res.json({ report });
  } catch (error: any) {
    console.error('[API] Error fetching HACCP report:', error);
    res.status(500).json({ error: 'Failed to fetch report' });
  }
});

// ==========================================
// Phase 3 — HACCP CCP Temperature Logs
// ==========================================
haccpRoutes.get('/ccp-logs', requirePermission('haccp.logs.view'), (req, res) => {
  try {
    const db = getDatabase();
    const { status, limit = 100 } = req.query;
    let query = 'SELECT * FROM haccp_ccp_logs WHERE 1=1';
    const params: any[] = [];
    if (status) {
      query += ' AND status = ?';
      params.push(String(status));
    }
    query += ' ORDER BY recorded_at DESC LIMIT ?';
    params.push(Number(limit) || 100);

    const logs = db.prepare(query).all(...params);
    res.json({ ccp_logs: logs });
  } catch (error: any) {
    console.error('[HACCP] Error listing CCP logs:', error);
    res.status(500).json({ error: error.message || 'Failed to list CCP logs' });
  }
});

haccpRoutes.post('/ccp-logs', requirePermission('haccp.logs.manage'), (req, res) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const actorId = user?.name || user?.userId || 'staff';
    const {
      station_name,
      ccp_category,
      target_min,
      target_max,
      recorded_value,
      unit = 'C',
      corrective_action,
    } = req.body;

    if (!station_name || !ccp_category || recorded_value === undefined) {
      return res.status(400).json({ error: 'station_name, ccp_category, and recorded_value are required' });
    }

    const val = Number(recorded_value);
    const min = target_min !== undefined && target_min !== null ? Number(target_min) : null;
    const max = target_max !== undefined && target_max !== null ? Number(target_max) : null;

    let computedStatus: 'pass' | 'warning' | 'critical_breach' = 'pass';
    if ((min !== null && val < min) || (max !== null && val > max)) {
      computedStatus = 'critical_breach';
    }

    if (computedStatus === 'critical_breach' && (!corrective_action || !String(corrective_action).trim())) {
      return res.status(400).json({ error: 'Critical breach recorded: a non-empty corrective action is required' });
    }

    const { randomUUID } = require('crypto');
    const { now } = require('../db');
    const id = randomUUID();
    const timestamp = now();

    db.prepare(`
      INSERT INTO haccp_ccp_logs (
        id, station_name, ccp_category, target_min, target_max, recorded_value, unit, status, corrective_action, recorded_by, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      String(station_name).trim(),
      String(ccp_category).trim(),
      min,
      max,
      val,
      unit,
      computedStatus,
      corrective_action ? String(corrective_action).trim() : null,
      actorId,
      timestamp,
    );

    const log = db.prepare('SELECT * FROM haccp_ccp_logs WHERE id = ?').get(id);
    res.status(201).json({ ccp_log: log });
  } catch (error: any) {
    console.error('[HACCP] Error creating CCP log:', error);
    res.status(500).json({ error: error.message || 'Failed to create CCP log' });
  }
});

// ==========================================
// Phase 3 — HACCP Checklists (Opening, Mid-Shift, Closing)
// ==========================================
haccpRoutes.get('/checklists', requirePermission('haccp.logs.view'), (req, res) => {
  try {
    const db = getDatabase();
    const { business_date, shift_type } = req.query;
    const bDate = business_date ? String(business_date) : new Date().toISOString().split('T')[0];

    let query = 'SELECT * FROM haccp_checklists WHERE business_date = ?';
    const params: any[] = [bDate];
    if (shift_type) {
      query += ' AND shift_type = ?';
      params.push(String(shift_type));
    }
    query += ' ORDER BY shift_type ASC, area ASC, id ASC';

    let checklists = db.prepare(query).all(...params) as any[];

    // If empty for this date, seed default checklists
    if (checklists.length === 0) {
      const { randomUUID } = require('crypto');
      const defaults = [
        { shift_type: 'opening', area: 'Barista Station', task_title: 'Espresso machine purge & steam wand sanitization' },
        { shift_type: 'opening', area: 'Cold Storage', task_title: 'Check fridge temp (0-4°C) & milk expiry dates' },
        { shift_type: 'opening', area: 'Kitchen Prep', task_title: 'Sanitize food contact surfaces & prep cutting boards' },
        { shift_type: 'mid_shift', area: 'Barista Station', task_title: 'Wipe hopper, brush group heads, clean drip tray' },
        { shift_type: 'mid_shift', area: 'Prep Line', task_title: 'Hand wash station towels & check sanitizer buckets' },
        { shift_type: 'closing', area: 'Kitchen & Bar', task_title: 'Deep clean steam wands, backflush espresso group heads' },
        { shift_type: 'closing', area: 'Cold Storage', task_title: 'Cover, label, and date all perishable containers' },
        { shift_type: 'closing', area: 'Waste Management', task_title: 'Empty and sanitize trash & recycling bins' },
      ];

      const insertChecklist = db.prepare(`
        INSERT INTO haccp_checklists (id, business_date, shift_type, task_title, area, is_completed)
        VALUES (?, ?, ?, ?, ?, 0)
      `);
      for (const d of defaults) {
        insertChecklist.run(randomUUID(), bDate, d.shift_type, d.task_title, d.area);
      }
      checklists = db.prepare(query).all(...params) as any[];
    }

    res.json({ checklists });
  } catch (error: any) {
    console.error('[HACCP] Error fetching checklists:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch checklists' });
  }
});

haccpRoutes.post('/checklists/:id/toggle', requirePermission('haccp.logs.manage'), (req, res) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const actorId = user?.name || user?.userId || 'staff';
    const { is_completed, notes } = req.body;
    const { now } = require('../db');
    const timestamp = now();

    db.prepare(`
      UPDATE haccp_checklists
      SET is_completed = ?, verified_by = ?, completed_at = ?, notes = COALESCE(?, notes)
      WHERE id = ?
    `).run(
      is_completed ? 1 : 0,
      is_completed ? actorId : null,
      is_completed ? timestamp : null,
      notes || null,
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM haccp_checklists WHERE id = ?').get(req.params.id);
    res.json({ success: true, checklist: updated });
  } catch (error: any) {
    console.error('[HACCP] Error toggling checklist:', error);
    res.status(500).json({ error: error.message || 'Failed to toggle checklist' });
  }
});

// ==========================================
// Phase 3 — Perishable Batch Tracking (Lot/Expiry)
// ==========================================
haccpRoutes.get('/batches', requirePermission('haccp.logs.view'), (req, res) => {
  try {
    const db = getDatabase();
    const { status } = req.query;

    // Check for soon-to-expire batches
    const nowIso = new Date().toISOString();
    const soonIso = new Date(Date.now() + 24 * 3600000).toISOString();
    db.prepare(`
      UPDATE haccp_batches
      SET status = 'expiring_soon'
      WHERE status = 'active' AND expires_at <= ? AND expires_at > ?
    `).run(soonIso, nowIso);

    let query = 'SELECT * FROM haccp_batches WHERE 1=1';
    const params: any[] = [];
    if (status) {
      query += ' AND status = ?';
      params.push(String(status));
    }
    query += ' ORDER BY expires_at ASC LIMIT 200';
    const batches = db.prepare(query).all(...params);

    res.json({ batches });
  } catch (error: any) {
    console.error('[HACCP] Error listing batches:', error);
    res.status(500).json({ error: error.message || 'Failed to list batches' });
  }
});

haccpRoutes.post('/batches', requirePermission('haccp.logs.manage'), (req, res) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const actorId = user?.name || user?.userId || 'staff';
    const { item_name, lot_number, storage_area, prepared_at, expires_at } = req.body;

    if (!item_name || !lot_number || !storage_area || !expires_at) {
      return res.status(400).json({ error: 'item_name, lot_number, storage_area, and expires_at are required' });
    }

    const { randomUUID } = require('crypto');
    const id = randomUUID();
    const prepAt = prepared_at || new Date().toISOString();

    db.prepare(`
      INSERT INTO haccp_batches (
        id, item_name, lot_number, storage_area, prepared_at, expires_at, status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(id, String(item_name).trim(), String(lot_number).trim(), String(storage_area).trim(), prepAt, String(expires_at).trim(), actorId);

    const batch = db.prepare('SELECT * FROM haccp_batches WHERE id = ?').get(id);
    res.status(201).json({ batch });
  } catch (error: any) {
    console.error('[HACCP] Error creating batch:', error);
    res.status(500).json({ error: error.message || 'Failed to create batch' });
  }
});

haccpRoutes.post('/batches/:id/discard', requirePermission('haccp.logs.manage'), (req, res) => {
  try {
    const db = getDatabase();
    db.prepare("UPDATE haccp_batches SET status = 'discarded' WHERE id = ?").run(req.params.id);
    const updated = db.prepare('SELECT * FROM haccp_batches WHERE id = ?').get(req.params.id);
    res.json({ success: true, batch: updated });
  } catch (error: any) {
    console.error('[HACCP] Error discarding batch:', error);
    res.status(500).json({ error: error.message || 'Failed to discard batch' });
  }
});

