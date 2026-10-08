import { getDatabase, now, withTxn, newId } from '../db';
import { requirePermission } from './authorization';

export type FinanceMovementType =
  | 'opening_float'
  | 'sale_cash'
  | 'card_payment'
  | 'digital_payment'
  | 'expense'
  | 'purchase'
  | 'employee_salary'
  | 'employee_advance'
  | 'employee_loan'
  | 'loan_repayment'
  | 'profit_withdrawal'
  | 'cash_in'
  | 'cash_out'
  | 'refund'
  | 'supplier_payment'
  | 'petty_cash'
  | 'correction'
  | 'reversal'
  | 'other';

export interface RecordFinanceMovementInput {
  businessDate: string;
  movementType: FinanceMovementType;
  amountCents: number;
  currency?: string;
  direction?: 'in' | 'out';
  category: string;
  paymentMethod?: string;
  description?: string;
  createdBy: string;
  shiftId?: number | null;
  branchId?: string | null;
  sourceTransactionType?: string | null;
  sourceTransactionId?: string | null;
  relatedEmployeeId?: string | null;
  relatedSupplierId?: string | null;
  approvalStatus?: 'approved' | 'pending' | 'rejected';
  approvedBy?: string | null;
  attachmentRef?: string | null;
}

export function defaultDirectionForType(movementType: FinanceMovementType): 'in' | 'out' {
  switch (movementType) {
    case 'sale_cash':
    case 'card_payment':
    case 'digital_payment':
    case 'cash_in':
    case 'opening_float':
    case 'loan_repayment':
      return 'in';
    case 'expense':
    case 'purchase':
    case 'employee_salary':
    case 'employee_advance':
    case 'employee_loan':
    case 'profit_withdrawal':
    case 'cash_out':
    case 'refund':
    case 'supplier_payment':
    case 'petty_cash':
      return 'out';
    default:
      return 'out';
  }
}

export function recordFinanceMovement(db: ReturnType<typeof getDatabase>, input: RecordFinanceMovementInput) {
  if (!input.amountCents || input.amountCents <= 0) {
    throw Object.assign(new Error('amount_cents must be a positive integer'), { statusCode: 400 });
  }
  if (!input.category || !input.category.trim()) {
    throw Object.assign(new Error('category is required'), { statusCode: 400 });
  }

  const id = newId('fin');
  const timestamp = now();
  const direction = input.direction || defaultDirectionForType(input.movementType);
  const currency = input.currency || 'EGP';
  const paymentMethod = input.paymentMethod || 'cash';
  const approvalStatus = input.approvalStatus || 'approved';

  db.prepare(`
    INSERT INTO finance_movements (
      id, business_date, movement_type, amount_cents, currency, direction,
      category, payment_method, description, created_by, shift_id, branch_id,
      source_transaction_type, source_transaction_id, related_employee_id, related_supplier_id,
      approval_status, approved_by, attachment_ref, is_reversal, reversal_of_id,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, 0, NULL,
      ?, ?
    )
  `).run(
    id, input.businessDate, input.movementType, input.amountCents, currency, direction,
    input.category.trim(), paymentMethod, input.description || null, input.createdBy,
    input.shiftId || null, input.branchId || null, input.sourceTransactionType || null,
    input.sourceTransactionId || null, input.relatedEmployeeId || null, input.relatedSupplierId || null,
    approvalStatus, input.approvedBy || null, input.attachmentRef || null, timestamp, timestamp
  );

  return db.prepare('SELECT * FROM finance_movements WHERE id = ?').get(id);
}

export function reverseFinanceMovement(db: ReturnType<typeof getDatabase>, movementId: string, actorUserId: string, reason: string) {
  return withTxn(() => {
    const original = db.prepare('SELECT * FROM finance_movements WHERE id = ?').get(movementId) as any;
    if (!original) {
      throw Object.assign(new Error('Finance movement not found'), { statusCode: 404 });
    }
    if (original.is_reversal) {
      throw Object.assign(new Error('Cannot reverse an existing reversal'), { statusCode: 400 });
    }

    const existingReversal = db.prepare('SELECT id FROM finance_movements WHERE reversal_of_id = ?').get(movementId);
    if (existingReversal) {
      throw Object.assign(new Error('This movement has already been reversed'), { statusCode: 409 });
    }

    const reversalId = newId('rev');
    const timestamp = now();
    const invertedDirection = original.direction === 'in' ? 'out' : 'in';

    db.prepare(`
      INSERT INTO finance_movements (
        id, business_date, movement_type, amount_cents, currency, direction,
        category, payment_method, description, created_by, shift_id, branch_id,
        source_transaction_type, source_transaction_id, related_employee_id, related_supplier_id,
        approval_status, approved_by, attachment_ref, is_reversal, reversal_of_id,
        created_at, updated_at
      ) VALUES (
        ?, ?, 'reversal', ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        'finance_movement', ?, ?, ?,
        'approved', ?, ?, 1, ?,
        ?, ?
      )
    `).run(
      reversalId, original.business_date, original.amount_cents, original.currency, invertedDirection,
      `Reversal: ${original.category}`, original.payment_method, reason || `Reversal of ${movementId}`,
      actorUserId, original.shift_id, original.branch_id, original.id, original.related_employee_id,
      original.related_supplier_id, actorUserId, original.attachment_ref, original.id,
      timestamp, timestamp
    );

    return db.prepare('SELECT * FROM finance_movements WHERE id = ?').get(reversalId);
  });
}

export function listFinanceMovements(
  db: ReturnType<typeof getDatabase>,
  filters: {
    businessDate?: string;
    startDate?: string;
    endDate?: string;
    movementType?: string;
    direction?: string;
    category?: string;
    shiftId?: number;
    paymentMethod?: string;
    limit?: number;
    offset?: number;
  } = {}
) {
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.businessDate) {
    conditions.push('business_date = ?');
    params.push(filters.businessDate);
  }
  if (filters.startDate) {
    conditions.push('created_at >= ?');
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    conditions.push('created_at <= ?');
    params.push(filters.endDate);
  }
  if (filters.movementType) {
    conditions.push('movement_type = ?');
    params.push(filters.movementType);
  }
  if (filters.direction) {
    conditions.push('direction = ?');
    params.push(filters.direction);
  }
  if (filters.category) {
    conditions.push('category = ?');
    params.push(filters.category);
  }
  if (filters.shiftId !== undefined) {
    conditions.push('shift_id = ?');
    params.push(filters.shiftId);
  }
  if (filters.paymentMethod) {
    conditions.push('payment_method = ?');
    params.push(filters.paymentMethod);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit ? Math.min(filters.limit, 200) : 50;
  const offset = filters.offset || 0;

  const rows = db.prepare(`
    SELECT * FROM finance_movements
    ${whereClause}
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const countRow = db.prepare(`
    SELECT COUNT(*) as total FROM finance_movements ${whereClause}
  `).get(...params) as { total: number };

  return { movements: rows, total: countRow.total, limit, offset };
}

export function getFinanceSummary(
  db: ReturnType<typeof getDatabase>,
  options: { businessDate?: string; startDate?: string; endDate?: string } = {}
) {
  const conditions: string[] = [];
  const params: any[] = [];

  if (options.businessDate) {
    conditions.push('business_date = ?');
    params.push(options.businessDate);
  }
  if (options.startDate) {
    conditions.push('created_at >= ?');
    params.push(options.startDate);
  }
  if (options.endDate) {
    conditions.push('created_at <= ?');
    params.push(options.endDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN direction = 'in' THEN amount_cents ELSE 0 END), 0) as total_in_cents,
      COALESCE(SUM(CASE WHEN direction = 'out' THEN amount_cents ELSE 0 END), 0) as total_out_cents,
      COALESCE(SUM(CASE WHEN movement_type = 'expense' THEN amount_cents ELSE 0 END), 0) as expense_cents,
      COALESCE(SUM(CASE WHEN movement_type = 'purchase' THEN amount_cents ELSE 0 END), 0) as purchase_cents,
      COALESCE(SUM(CASE WHEN movement_type = 'employee_salary' THEN amount_cents ELSE 0 END), 0) as salary_cents,
      COALESCE(SUM(CASE WHEN movement_type = 'employee_advance' THEN amount_cents ELSE 0 END), 0) as advance_cents,
      COALESCE(SUM(CASE WHEN movement_type = 'profit_withdrawal' THEN amount_cents ELSE 0 END), 0) as withdrawal_cents
    FROM finance_movements
    ${whereClause}
  `).get(...params) as any;

  return {
    ...totals,
    net_flow_cents: (totals.total_in_cents || 0) - (totals.total_out_cents || 0),
  };
}
