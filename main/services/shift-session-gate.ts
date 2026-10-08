/**
 * Shift-session enforcement gate (issue #279). Leaf module: route modules
 * (bills, cash-closures, cash-sessions) import from here so no require
 * cycle exists between them.
 */
import { getDatabase, getSettingValue } from '../db';

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

export interface CashSessionRow {
  id: number;
  opened_by: string;
  opened_by_name: string;
  opened_at: string;
  opening_float_cents: number;
  status: 'open' | 'closed';
  closed_at: string | null;
  closed_by: string | null;
  closure_id: number | null;
}

// NULL is reserved for rows written before session ownership was recorded.
// New cash activity outside a shift uses 0 so it cannot enter a later shift
// through the legacy timestamp fallback.
export const NO_CASH_SESSION_ID = 0;

export function getOpenSession(db: ReturnType<typeof getDatabase>): CashSessionRow | undefined {
  return db.prepare(`SELECT * FROM cash_sessions WHERE status = 'open' LIMIT 1`).get() as CashSessionRow | undefined;
}

const BUILT_IN_PAYMENT_METHODS = new Set(['cash', 'card', 'wallet']);

/**
 * Effective-method check mirroring preparePaymentBatch (bills.ts) resolution:
 * builtins pass through, `custom` lines resolve via payment_method_id, other
 * names resolve case-insensitively. Anything unresolvable is not cash here —
 * the payment pipeline itself rejects it with 400, so the gate never masks
 * a validation error.
 */
export function isCashTender(db: ReturnType<typeof getDatabase>, payment: unknown): boolean {
  const method = (payment as { method?: unknown } | null)?.method;
  if (typeof method !== 'string') return false;
  if (BUILT_IN_PAYMENT_METHODS.has(method)) return method === 'cash';
  const row = (method === 'custom'
    ? db.prepare('SELECT name, counts_as_cash_drawer_tender FROM payment_methods WHERE id = ? AND is_active = 1')
      .get((payment as { payment_method_id?: unknown }).payment_method_id)
    : db.prepare('SELECT name, counts_as_cash_drawer_tender FROM payment_methods WHERE lower(name) = lower(?) AND is_active = 1')
      .get(method)) as { name?: string; counts_as_cash_drawer_tender?: number } | undefined;
  if (!row) return false;
  return Boolean(row.counts_as_cash_drawer_tender) || (typeof row.name === 'string' && row.name.toLowerCase() === 'cash');
}

/**
 * When the owner opted into `require_open_shift`, cash touching the drawer
 * needs an open session. Non-cash tenders are never gated. Missing setting
 * rows (pre-v90 upgrades) read as off.
 */
export function requireOpenSessionForCash(db: ReturnType<typeof getDatabase>): void {
  if (getSettingValue('require_open_shift') !== 'true') return;
  if (!getOpenSession(db)) {
    throw httpError('No open shift: open a shift before taking cash', 409);
  }
}

/**
 * Payment-line variant: gates when any line is effectively cash (see
 * isCashTender), so a custom method named "Cash" cannot bypass the gate.
 */
export function requireOpenSessionForCashTender(db: ReturnType<typeof getDatabase>, payments: unknown[]): void {
  if (getSettingValue('require_open_shift') !== 'true') return;
  if (payments.some((line) => isCashTender(db, line)) && !getOpenSession(db)) {
    throw httpError('No open shift: open a shift before taking cash', 409);
  }
}

/**
 * Order-creation variant: when require_open_shift is active, opening or adding
 * to an order requires an active open shift session.
 */
export function requireOpenSessionForOrder(db: ReturnType<typeof getDatabase>, req?: any): void {
  const isEnforced = getSettingValue('require_open_shift') === 'true' && getSettingValue('require_open_shift_for_orders') !== 'false';
  if (!isEnforced) return;
  if (!getOpenSession(db)) {
    const isAr = req?.headers?.['accept-language']?.includes('ar');
    throw Object.assign(
      new Error(isAr ? 'يجب فتح الوردية قبل إنشاء أو إضافة أي طلب.' : 'Open a shift before creating or adding an order.'),
      { statusCode: 409, code: 'NO_ACTIVE_SHIFT' }
    );
  }
}

/**
 * Identity confirmation gate: ensures the request is signed by an authenticated
 * user with a valid identifier.
 */
export function requireConfirmedIdentity(req: any): { userId: string; role: string } {
  const user = req?.user;
  if (!user || !user.userId) {
    const isAr = req?.headers?.['accept-language']?.includes('ar');
    throw Object.assign(
      new Error(isAr ? 'يرجى تأكيد هويتك أولاً.' : 'Confirm your identity first.'),
      { statusCode: 401, code: 'IDENTITY_REQUIRED' }
    );
  }
  return user;
}
