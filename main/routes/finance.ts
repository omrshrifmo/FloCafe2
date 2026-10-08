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
