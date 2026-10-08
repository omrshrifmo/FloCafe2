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
