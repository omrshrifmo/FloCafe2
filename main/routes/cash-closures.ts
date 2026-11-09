/**
 * Day-close (cierre de caja, issue #649).
 *
 * One close per store per tenant business day. POST /api/cash-closures:
 *  - Owner-only (manager/cashier/server are 403).
 *  - Validates: YYYY-MM-DD format, not in the future, integer cents >= 0.
 *  - Recomputes the day's aggregates server-side (never trusts client totals)
 *    using the verbatim financial-summary template (main/routes/reports.ts)
 *    for display totals, plus the drawer-reality rules:
 *      * `expected_cash_cents`: opening float plus active Pay In, Pay Out, and
 *        Safe Drop movements, cash sales from the raw pre-join
 *        `method = 'cash'` filter, and cash refunds by `refunds.created_at`
 *        (the day the cash left the drawer, not the day the original bill was
 *        paid).
 *      * `tax_components_json`: aggregated via `aggregateTaxComponents`
 *        against the spec's DisplayTaxComponent[] shape, so Z rows carry the
 *        same tax components the live report endpoint returns.
 *      * payment-method lines keyed by `b.paid_at` (not per-line timestamps)
 *        so an installment-paid bill lands whole on its settlement day,
 *        reconciling with gross/staff/tax; live reports keep per-line keys.
 *  - Snapshots the result with the operator's counted cash and stores one
 *    immutable row in `cash_closures`. Duplicate POST against the same
 *    `business_date` (scope='day') is rejected with 409 via SELECT-then-INSERT
 *    inside `withTxn`; the partial index `cash_closures_one_day` is the
 *    concurrency safety net.
 *
 * Sales flow is deliberately untouched: `createRefund`, `shift_id`, and
 * `refunds.shift_id` are unchanged — the drawer-reality attribution
 * (cash refunds by `refunds.created_at`) is read straight from the existing
 * `refunds` table without backfilling any column. The `scope='session'`
 * extension door is intentionally unused by this endpoint; session-style
 * closes arrive as separate rows with a different `scope` value.
 */
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import {
  dayBoundsInTimezone, getDatabase, getSettingValue, localDateInTimezone, now, withTxn,
  tenantBusinessDayStartTime,
} from '../db';
import { requirePermission, hasPermission } from '../services/authorization';
import { nextZNumber } from '../db';
import { getTenantCurrency } from '../services/refund';
import { getOpenSession, NO_CASH_SESSION_ID, requireOpenSessionForCash } from '../services/shift-session-gate';
// Type-only: erased at compile, so this adds no runtime require cycle.
import type { AuthedRequest } from './cash-sessions';
import { getCurrencyMinorUnitFactor, resolveRegionalSnapshot } from '../countries';
import { getOrdersWithItemsForBills } from './bills';
import { getHttpRequestSignal } from '../shutdown';
import {
  DisplayTaxComponent,
  aggregateTaxComponents,
} from '../services/tax-components';
import { Z_REPORT_LANGUAGE_POLICY_KEY, parseStoredLanguagePolicy } from '../lib/print-language-settings';
import { resolveReceiptLanguages, type ReceiptLanguagePolicy } from '../../shared/print';
import { logPosAnomaly } from '../services/pos-anomalies';

import { randomUUID } from 'crypto';

const router = Router();
const MAX_NOTES_LENGTH = 500;
const MAX_MOVEMENT_REASON_LENGTH = 500;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ExtendedMovementType = 'opening_float' | 'pay_in' | 'pay_out' | 'safe_drop' | 'expense' | 'purchase';
type CashDrawerMovementType = 'opening_float' | 'pay_in' | 'pay_out' | 'safe_drop';

interface CashDrawerMovementRow {
  id: number;
  business_date: string;
  movement_type: CashDrawerMovementType;
  amount_cents: number;
  reason: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
  voided_at: string | null;
  voided_by: string | null;
  voided_by_name: string | null;
  void_reason: string | null;
}

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

// Resolves through the country profile when the stored timezone is missing
// or invalid, matching resolveRegionalSnapshot's own contract, instead of
// letting dayBoundsInTimezone() silently fall back to UTC — at a
// tenant-local day boundary that includes/excludes transactions at the
// wrong instant, producing an incorrect closure total. Only throws
// RegionalNotConfiguredError when the country itself is unresolvable.
// Exported for cash-sessions.ts so both modules resolve windows identically.
export function tenantTimezone(): string {
  return resolveRegionalSnapshot({
    country: getSettingValue('country') ?? undefined,
    currency: getSettingValue('currency') ?? undefined,
    timezone: getSettingValue('timezone') ?? undefined,
  }).timezone;
}

function tenantStartTime(db?: ReturnType<typeof getDatabase>): string {
  return tenantBusinessDayStartTime(db);
}

function validateBusinessDate(raw: unknown): string {
  if (typeof raw !== 'string' || !ISO_DATE_RE.test(raw)) {
    throw httpError('business_date must use YYYY-MM-DD format', 400);
  }
  // Real-calendar-date guard: `Date.UTC(2026, 1, 30)` silently rolls over
  // into March, so a regex match is not enough. Round-trip the parsed
  // year/month/day and confirm the calendar matches the input.
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(5, 7));
  const day = Number(raw.slice(8, 10));
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() + 1 !== month ||
    roundTrip.getUTCDate() !== day
  ) {
    throw httpError('business_date is not a real calendar date', 400);
  }
  // Tenant-local business date, not the host UTC clock: a date that is
  // "today" in the store's configured timezone and cutoff must never be
  // rejected as future even when the host's UTC clock is still on yesterday.
  // ISO date arithmetic on the YYYY-MM-DD string is timezone-safe.
  const todayLocal = localDateInTimezone(new Date(), tenantTimezone(), tenantStartTime());
  if (raw > todayLocal) {
    throw httpError('business_date cannot be in the future', 400);
  }
  return raw;
}

function validateCents(raw: unknown, field: string, allowZero = true): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) {
    throw httpError(`${field} must be an integer`, 400);
  }
  if (raw < 0 || (!allowZero && raw === 0)) {
    throw httpError(`${field} must be >= ${allowZero ? 0 : 1}`, 400);
  }
  if (!Number.isSafeInteger(raw)) {
    throw httpError(`${field} is out of range`, 400);
  }
  return raw;
}

function validateMovementType(raw: unknown): ExtendedMovementType {
  if (raw !== 'opening_float' && raw !== 'pay_in' && raw !== 'pay_out' && raw !== 'safe_drop' && raw !== 'expense' && raw !== 'purchase') {
    throw httpError('movement_type is invalid', 400);
  }
  return raw as ExtendedMovementType;
}

function validateMovementReason(raw: unknown, required: boolean): string | null {
  if (raw === undefined || raw === null) {
    if (required) throw httpError('reason is required', 400);
    return null;
  }
  if (typeof raw !== 'string') throw httpError('reason must be a string', 400);
  const reason = raw.trim();
  if (required && reason.length === 0) throw httpError('reason is required', 400);
  if (reason.length > MAX_MOVEMENT_REASON_LENGTH) throw httpError('reason is too long', 400);
  return reason || null;
}

function closedDayExists(db: ReturnType<typeof getDatabase>, businessDate: string): boolean {
  return !!db.prepare(
    `SELECT id FROM cash_closures WHERE business_date = ? AND scope = 'day' LIMIT 1`,
  ).get(businessDate);
}

function listCashDrawerMovements(
  db: ReturnType<typeof getDatabase>,
  businessDate: string,
  includeVoided = true,
): CashDrawerMovementRow[] {
  return db.prepare(`
    SELECT m.*, created_user.name AS created_by_name, voided_user.name AS voided_by_name
    FROM cash_drawer_movements m
    LEFT JOIN users created_user ON created_user.id = m.created_by
    LEFT JOIN users voided_user ON voided_user.id = m.voided_by
    WHERE m.business_date = ? ${includeVoided ? '' : 'AND m.voided_at IS NULL'}
    ORDER BY m.created_at DESC, m.id DESC
  `).all(businessDate) as CashDrawerMovementRow[];
}

// Session movements prefer their recorded owner; only pre-v91 NULL-owner
// rows use the timestamp window.
export function listCashDrawerMovementsForSession(
  db: ReturnType<typeof getDatabase>,
  sessionId: number,
  start: string,
  end: string,
  includeVoided = true,
): CashDrawerMovementRow[] {
  return db.prepare(`
    SELECT m.*, created_user.name AS created_by_name, voided_user.name AS voided_by_name
    FROM cash_drawer_movements m
    LEFT JOIN users created_user ON created_user.id = m.created_by
    LEFT JOIN users voided_user ON voided_user.id = m.voided_by
    WHERE (m.cash_session_id = ? OR (m.cash_session_id IS NULL AND m.created_at >= ? AND m.created_at < ?))
      ${includeVoided ? '' : 'AND m.voided_at IS NULL'}
    ORDER BY m.created_at DESC, m.id DESC
  `).all(sessionId, start, end) as CashDrawerMovementRow[];
}

function activeOpeningFloatCents(db: ReturnType<typeof getDatabase>, businessDate: string): number | null {
  const row = db.prepare(`
    SELECT amount_cents
    FROM cash_drawer_movements
    WHERE business_date = ? AND movement_type = 'opening_float' AND voided_at IS NULL
    LIMIT 1
  `).get(businessDate) as { amount_cents: number } | undefined;
  return row ? Number(row.amount_cents) : null;
}

/**
 * Shape a stored `cash_closures` row into the snapshot the print primitive
 * consume. Single source of truth so the print body and the on-screen
 * Z share shape — the operator sees in the modal exactly what the printer
 * receives.
 * the operator's screen byte for byte:
 *  - `closed_by_name` resolves the operator's `users.name`, falling back
 *    to the raw id when the row was orphaned (staff deletion, etc.).
 *  - JSON columns (`payment_methods_json`, `staff_sales_json`,
 *    `tax_components_json`, `cash_movements_json`) are parsed into typed arrays;
 *    malformed snapshot data fails the print rather than omitting sections.
 *  - `__isReprint` is the synthetic flag the body builder uses to add
 *    the localized reprint marker; caller passes `true` for reprints.
 */
function shapeZReportSnapshot(db: ReturnType<typeof getDatabase>, row: any, isReprint: boolean): any {
  const userRow = db.prepare(`SELECT name FROM users WHERE id = ?`).get(row.closed_by) as { name: string } | undefined;
  const safeJson = (raw: string | null | undefined, field: string): any[] => {
    if (typeof raw !== 'string') throw new Error(`Stored cash closure ${field} is missing`);
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('expected an array');
      return parsed;
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'invalid JSON';
      console.error(`[CashClosures] Invalid stored ${field}:`, detail);
      throw new Error(`Stored cash closure ${field} is invalid`);
    }
  };
  return {
    ...row,
    closed_by_name: userRow?.name ?? row.closed_by,
    payment_methods: safeJson(row.payment_methods_json, 'payment_methods_json'),
    staff_sales: safeJson(row.staff_sales_json, 'staff_sales_json'),
    tax_components: safeJson(row.tax_components_json, 'tax_components_json'),
    cash_movements: safeJson(row.cash_movements_json, 'cash_movements_json'),
    __isReprint: isReprint,
  };
}

interface PaymentMethodRow {
  method: string;
  count: number;
  total: number;
}

interface StaffSalesRow {
  user_id: string;
  name: string;
  role: string;
  revenue: number;
  orderCount: number;
}

export interface DayAggregates {
  billCount: number;
  refundCount: number;
  grossCollectedCents: number;
  refundedCents: number;
  netCollectedCents: number;
  cashSalesCents: number;
  cashRefundsByCreatedAtCents: number;
  openingFloatCents: number;
  payInCents: number;
  payOutCents: number;
  safeDropCents: number;
  cashMovements: CashDrawerMovementRow[];
  paymentMethods: { method: string; count: number; total_cents: number }[];
  staffSales: { user_id: string; name: string; role: string; revenue_cents: number; orderCount: number }[];
  taxComponents: DisplayTaxComponent[];
}

/**
 * Shared by financial-summary (reports.ts, called with paidOnly/attributeRefundsToBillDate=true)
 * and cash-closure snapshots; defaults false/false/false.
 *
 * `keyByPaidAt` is true only for the day-close snapshot: a bill paid in
 * installments carries one `timestamp` per payment line, so keying lines
 * by their own timestamp would scatter one bill's cash across several
 * business days while gross/staff/tax (all keyed by `b.paid_at`) land on
 * the settlement day. Keying by `paid_at` keeps every Z section on the
 * same day so the immutable snapshot reconciles with itself. Live reports
 * keep the default: a partial payment belongs to the day it was taken.
 */
export interface PaymentMethodBreakdownOptions {
  /** Day-based calls: tenant-local business date(s). Ignored when explicitWindow is set. */
  startDate?: string;
  endDate?: string;
  paidOnly?: boolean;
  attributeRefundsToBillDate?: boolean;
  keyByPaidAt?: boolean;
  /** Raw timestamp window for session attribution (#279). */
  explicitWindow?: [string, string];
}

export function paymentMethodBreakdown(
  db: ReturnType<typeof getDatabase>,
  opts: PaymentMethodBreakdownOptions,
): PaymentMethodRow[] {
  const {
    startDate = '',
    endDate,
    paidOnly = false,
    attributeRefundsToBillDate = false,
    keyByPaidAt = false,
    explicitWindow,
  } = opts;
  if (!explicitWindow && !startDate) {
    throw new Error('paymentMethodBreakdown requires startDate or explicitWindow');
  }
  const resolvedEndDate = endDate ?? startDate;
  const startTime = tenantStartTime(db);
  const [start, end] = explicitWindow ?? [
    dayBoundsInTimezone(startDate, tenantTimezone(), startTime)[0],
    dayBoundsInTimezone(resolvedEndDate, tenantTimezone(), startTime)[1],
  ];
  const minorFactor = getCurrencyMinorUnitFactor(getTenantCurrency(db));
  return db.prepare(`
    WITH payment_lines AS (
      SELECT b.paid_at, b.created_at, je.value AS line
      FROM bills b
      JOIN json_each(CASE
        WHEN json_valid(b.payment_details) AND json_type(b.payment_details) = 'array'
          THEN b.payment_details
        WHEN json_valid(b.payment_details)
          THEN json_array(b.payment_details)
        ELSE '[]'
      END) je
      WHERE b.payment_details IS NOT NULL
        AND b.created_at < ?
        AND (b.paid_at IS NULL OR b.paid_at >= ?)
        AND (? = 0 OR b.paid_at IS NOT NULL)
        AND json_type(je.value) = 'object'
    ), normalized AS (
      SELECT
        COALESCE(NULLIF(json_extract(line, '$.method'), ''), 'unknown') AS method,
        CAST(json_extract(line, '$.payment_method_id') AS INTEGER) AS payment_method_id,
        json_extract(line, '$.amount') AS amount,
        COALESCE(
          datetime(NULLIF(CASE WHEN ? = 1 THEN NULL ELSE json_extract(line, '$.timestamp') END, '')),
          datetime(NULLIF(paid_at, '')),
          datetime(NULLIF(created_at, ''))
        ) AS payment_time
      FROM payment_lines
      UNION ALL
      SELECT r.method, NULL, -(CAST(r.amount_cents AS REAL) / ?),
        datetime(CASE WHEN ? = 1 THEN b.paid_at ELSE r.created_at END)
      FROM refunds r
      JOIN bills b ON b.id = r.bill_id
    )
    SELECT COALESCE(pm.name, normalized.method) AS method, COUNT(*) AS count,
      COALESCE(SUM(CASE WHEN typeof(amount) IN ('integer', 'real') THEN amount ELSE 0 END), 0) AS total
    FROM normalized LEFT JOIN payment_methods pm ON pm.id = normalized.payment_method_id
    WHERE payment_time >= datetime(?) AND payment_time < datetime(?)
    GROUP BY COALESCE(pm.name, normalized.method)
    ORDER BY total DESC
  `).all(end, start, paidOnly ? 1 : 0, keyByPaidAt ? 1 : 0, minorFactor, attributeRefundsToBillDate ? 1 : 0, start, end) as PaymentMethodRow[];
}

/**
 * Recompute every snapshot field for one tenant-local business_date.
 *
 * Display totals deliberately include cancelled-order bills: a paid bill's
 * cash already left the drawer and remains there until counted, regardless
 * of the order's later status. `financial-summary` does not apply a
 * cancelled-order filter either — this snapshot matches its display
 * totals by construction. The drawer-reality inputs (active movement totals,
 * the `expected_cash_cents` cash-only raw filter, and refunds-by-created_at)
 * are applied separately so the rest of the snapshot reconciles with
 * financial-summary.
 *
 * Exported so Wave 3 (the live X-report) can reuse this pipeline without
 * duplicating the template or the tax-components hydration. Returns a
 * plain `DayAggregates` shape already converted to INTEGER minor units.
 */
export function computeDayAggregates(db: ReturnType<typeof getDatabase>, businessDate: string): DayAggregates {
  const [start, end] = dayBoundsInTimezone(businessDate, tenantTimezone(), tenantStartTime(db));
  return computePeriodAggregates(db, start, end, listCashDrawerMovements(db, businessDate, false), null);
}

/**
 * Single home for the expected-cash formula shared by day close, session
 * close, and the live session snapshot (#279): opening float plus active
 * movements plus cash sales minus cash refunds (drawer reality).
 */
export function expectedCashFromAggregates(aggregates: Pick<DayAggregates,
  'openingFloatCents' | 'cashSalesCents' | 'payInCents' | 'payOutCents' | 'safeDropCents' | 'cashRefundsByCreatedAtCents'
>): number {
  return aggregates.openingFloatCents
    + aggregates.cashSalesCents
    + aggregates.payInCents
    - aggregates.payOutCents
    - aggregates.safeDropCents
    - aggregates.cashRefundsByCreatedAtCents;
}
/**
 * Drawer-reality cash inputs for one raw timestamp window: cash sales by
 * paid_at (raw pre-join method='cash' lines) and cash refunds by created_at
 * (the day the cash left the drawer). Shared by the full aggregate pipeline
 * and the lightweight live-expected path (#279).
 */
export function cashDrawerSalesAndRefunds(
  db: ReturnType<typeof getDatabase>,
  start: string,
  end: string,
  minorFactor: number,
): { salesCents: number; refundsCents: number } {
  const row = db.prepare(`
    WITH cash_sales AS (
      SELECT COALESCE(SUM(CAST(json_extract(je.value, '$.amount') AS REAL) * ?), 0) AS sales_cents
      FROM bills b
      JOIN json_each(
        CASE
          WHEN json_valid(b.payment_details) AND json_type(b.payment_details) = 'array'
            THEN b.payment_details
          WHEN json_valid(b.payment_details)
            THEN json_array(b.payment_details)
          ELSE '[]'
        END
      ) je
      WHERE b.paid_at >= ? AND b.paid_at < ?
        AND json_type(je.value) = 'object'
        AND (
          lower(COALESCE(NULLIF(json_extract(je.value, '$.method'), ''), '')) = 'cash'
          OR json_extract(je.value, '$.counts_as_cash_drawer_tender') = 1
          OR json_extract(je.value, '$.counts_as_cash_drawer_tender') = true
        )
    ), cash_refunds AS (
      SELECT COALESCE(SUM(amount_cents), 0) AS refunds_cents
      FROM refunds
      WHERE method = 'cash'
        AND created_at >= ? AND created_at < ?
    )
    SELECT
      (SELECT sales_cents FROM cash_sales) AS sales_cents,
      (SELECT refunds_cents FROM cash_refunds) AS refunds_cents
  `).get(minorFactor, start, end, start, end) as { sales_cents: number; refunds_cents: number };
  return {
    salesCents: Math.round(Number(row.sales_cents || 0)),
    refundsCents: Number(row.refunds_cents || 0),
  };
}

export interface CashMovementTotals {
  openingFloatCents: number;
  payInCents: number;
  payOutCents: number;
  safeDropCents: number;
}

/**
 * Signed movement totals. Sessions carry the float on the session row, so
 * callers pass excludeOpeningFloat=true to avoid double-counting an
 * in-window opening_float movement; day close passes false.
 */
export function sumCashMovements(
  movements: CashDrawerMovementRow[],
  excludeOpeningFloat: boolean,
): CashMovementTotals {
  return movements.reduce((totals, movement) => {
    if (movement.movement_type === 'opening_float') {
      if (!excludeOpeningFloat) totals.openingFloatCents += movement.amount_cents;
    }
    if (movement.movement_type === 'pay_in') totals.payInCents += movement.amount_cents;
    if (movement.movement_type === 'pay_out') totals.payOutCents += movement.amount_cents;
    if (movement.movement_type === 'safe_drop') totals.safeDropCents += movement.amount_cents;
    return totals;
  }, { openingFloatCents: 0, payInCents: 0, payOutCents: 0, safeDropCents: 0 });
}

/**
 * Session-scoped expected cash: float + drawer movements + cash sales − cash
 * refunds. Attribution is ownership-first: rows carrying this session's
 * cash_session_id count regardless of timestamp because they were created
 * while it was open; pre-v91 NULL-owner rows fall back to opened_at→end.
 * opening_float movements are not summed here because
 * the float lives on the session row.
 *
 * Sessions intentionally use the effective shift-gate cash classifier
 * (including a configured method named Cash); day close keeps its narrower
 * exact-'cash' settlement rule. The JSON scan is correctness-first; use an
 * event ledger if bill volume makes session polling hot.
 */
export function sessionExpectedCash(
  db: ReturnType<typeof getDatabase>,
  session: { id: number; opening_float_cents: number; opened_at?: string },
  end: string,
  movements?: CashDrawerMovementRow[],
): number {
  const start = session.opened_at ?? end;
  const minorFactor = getCurrencyMinorUnitFactor(getTenantCurrency(db));
  const movementTotals = sumCashMovements(
    movements ?? listCashDrawerMovementsForSession(db, session.id, start, end, false), true,
  );
  const eventTotals = db.prepare(`
    WITH payment_lines AS (
      SELECT
        CAST(json_extract(je.value, '$.amount') AS REAL) AS amount,
        COALESCE(NULLIF(json_extract(je.value, '$.method'), ''), '') AS method,
        CAST(json_extract(je.value, '$.payment_method_id') AS INTEGER) AS payment_method_id,
        CAST(json_extract(je.value, '$.cash_session_id') AS INTEGER) AS line_session,
        CAST(json_extract(je.value, '$.counts_as_cash_drawer_tender') AS INTEGER) AS counts_as_cash_drawer_tender,
        COALESCE(
          datetime(NULLIF(json_extract(je.value, '$.timestamp'), '')),
          datetime(NULLIF(b.paid_at, '')),
          datetime(NULLIF(b.created_at, ''))
        ) AS line_time
      FROM bills b
      JOIN json_each(
        CASE
          WHEN json_valid(b.payment_details) AND json_type(b.payment_details) = 'array'
            THEN b.payment_details
          WHEN json_valid(b.payment_details)
            THEN json_array(b.payment_details)
          ELSE '[]'
        END
      ) je
      WHERE json_type(je.value) = 'object'
    ),
    cash_sales AS (
      SELECT COALESCE(SUM(pl.amount * ?), 0) AS sales_cents
      FROM payment_lines pl
      LEFT JOIN payment_methods pm ON pm.id = pl.payment_method_id AND lower(pm.name) = 'cash'
      WHERE (
          pl.line_session = ?
          OR (pl.line_session IS NULL AND pl.line_time >= datetime(?) AND pl.line_time < datetime(?))
        )
        AND (lower(pl.method) = 'cash' OR pm.id IS NOT NULL OR pl.counts_as_cash_drawer_tender = 1)
    ),
    cash_refunds AS (
      SELECT COALESCE(SUM(amount_cents), 0) AS refunds_cents
      FROM refunds
      WHERE lower(method) = 'cash'
        AND (
          cash_session_id = ?
          OR (cash_session_id IS NULL AND created_at >= ? AND created_at < ?)
        )
    ),
    extra_cash_ins AS (
      SELECT COALESCE(SUM(amount * ?), 0) AS extra_in_cents
      FROM cash_movements
      WHERE (session_id = CAST(? AS TEXT) OR session_id = ?)
        AND movement_type IN ('cash_in')
        AND payment_method = 'cash'
        AND voided_at IS NULL
        AND (cash_drawer_movement_id IS NULL OR cash_drawer_movement_id = 0)
    ),
    extra_cash_outs AS (
      SELECT COALESCE(SUM(amount * ?), 0) AS extra_out_cents
      FROM cash_movements
      WHERE (session_id = CAST(? AS TEXT) OR session_id = ?)
        AND movement_type IN ('paid_out', 'petty_expense', 'safe_drop', 'supplier_payment', 'loan_disbursement', 'payroll_payout')
        AND payment_method = 'cash'
        AND voided_at IS NULL
        AND (cash_drawer_movement_id IS NULL OR cash_drawer_movement_id = 0)
    )
    SELECT
      (SELECT sales_cents FROM cash_sales) AS sales_cents,
      (SELECT refunds_cents FROM cash_refunds) AS refunds_cents,
      (SELECT extra_in_cents FROM extra_cash_ins) AS extra_in_cents,
      (SELECT extra_out_cents FROM extra_cash_outs) AS extra_out_cents
  `).get(minorFactor, session.id, start, end, session.id, start, end, minorFactor, session.id, String(session.id), minorFactor, session.id, String(session.id)) as {
    sales_cents: number;
    refunds_cents: number;
    extra_in_cents: number;
    extra_out_cents: number;
  };
  return Number(session.opening_float_cents || 0)
    + Math.round(Number(eventTotals.sales_cents || 0))
    + movementTotals.payInCents
    + Math.round(Number(eventTotals.extra_in_cents || 0))
    - movementTotals.payOutCents
    - movementTotals.safeDropCents
    - Math.round(Number(eventTotals.extra_out_cents || 0))
    - Number(eventTotals.refunds_cents || 0);
}

/** Sales and refunds attributed to a session for its immutable Z snapshot. */
export function sessionFinancialTotals(
  db: ReturnType<typeof getDatabase>,
  session: { id: number; opened_at: string },
  end: string,
): Pick<DayAggregates, 'billCount' | 'refundCount' | 'grossCollectedCents' | 'refundedCents' | 'netCollectedCents' | 'paymentMethods'> {
  const minorFactor = getCurrencyMinorUnitFactor(getTenantCurrency(db));
  const row = db.prepare(`
    WITH payment_lines AS (
      SELECT b.id AS bill_id,
        CAST(ROUND(CAST(json_extract(je.value, '$.amount') AS REAL) * ?) AS INTEGER) AS amount_cents,
        COALESCE(NULLIF(json_extract(je.value, '$.method'), ''), 'unknown') AS method,
        CAST(json_extract(je.value, '$.cash_session_id') AS INTEGER) AS line_session,
        COALESCE(datetime(NULLIF(json_extract(je.value, '$.timestamp'), '')),
          datetime(NULLIF(b.paid_at, '')), datetime(NULLIF(b.created_at, ''))) AS line_time
      FROM bills b
      JOIN json_each(CASE
        WHEN json_valid(b.payment_details) AND json_type(b.payment_details) = 'array' THEN b.payment_details
        WHEN json_valid(b.payment_details) THEN json_array(b.payment_details)
        ELSE '[]' END) je
      WHERE json_type(je.value) = 'object'
    ),
    owned_payments AS (
      SELECT bill_id, amount_cents, method FROM payment_lines
      WHERE line_session = ?
        OR (line_session IS NULL AND line_time >= datetime(?) AND line_time < datetime(?))
    ),
    owned_refunds AS (
      SELECT amount_cents, method FROM refunds
      WHERE cash_session_id = ?
        OR (cash_session_id IS NULL AND created_at >= ? AND created_at < ?)
    ),
    method_totals AS (
      SELECT method, COUNT(*) AS count, SUM(amount_cents) AS total_cents
      FROM (
        SELECT method, amount_cents FROM owned_payments
        UNION ALL
        SELECT method, -amount_cents FROM owned_refunds
      ) GROUP BY method
    )
    SELECT
      (SELECT COUNT(DISTINCT bill_id) FROM owned_payments) AS bill_count,
      (SELECT COUNT(*) FROM owned_refunds) AS refund_count,
      (SELECT COALESCE(SUM(amount_cents), 0) FROM owned_payments) AS gross_cents,
      (SELECT COALESCE(SUM(amount_cents), 0) FROM owned_refunds) AS refund_cents,
      (SELECT COALESCE(json_group_array(json_object(
        'method', method, 'count', count, 'total_cents', total_cents)), '[]')
        FROM method_totals) AS methods_json
  `).get(minorFactor, session.id, session.opened_at, end,
    session.id, session.opened_at, end) as {
    bill_count: number; refund_count: number; gross_cents: number;
    refund_cents: number; methods_json: string;
  };
  const grossCollectedCents = Number(row.gross_cents || 0);
  const refundedCents = Number(row.refund_cents || 0);
  return {
    billCount: Number(row.bill_count || 0),
    refundCount: Number(row.refund_count || 0),
    grossCollectedCents,
    refundedCents,
    netCollectedCents: grossCollectedCents - refundedCents,
    paymentMethods: JSON.parse(row.methods_json),
  };
}

/**
 * Window-based aggregation shared by day close and session close (#279).
 * Same queries as the day pipeline, parameterized by raw timestamp window
 * so session windows (opened_at → now, possibly crossing midnight) work
 * without touching day-close behavior.
 */
export function computePeriodAggregates(
  db: ReturnType<typeof getDatabase>,
  start: string,
  end: string,
  movements: CashDrawerMovementRow[],
  openingFloatOverride: number | null,
): DayAggregates {

  // Display gross — `SUM(paid_amount)` over the paid_at day window (NOT
  // SUM(total) over created_at). This matches financial-summary so display
  // totals reconcile with the existing report endpoint for the same day.
  const billRow = db.prepare(`
    SELECT
      COUNT(*) AS bill_count,
      COALESCE(SUM(b.paid_amount), 0) AS gross_collected
    FROM bills b
    WHERE b.paid_at >= ? AND b.paid_at < ?
  `).get(start, end) as { bill_count: number; gross_collected: number };

  // Display refunds — paid_at attribution, same as financial-summary.
  // Stored as INTEGER cents to match the `refunded_cents` column type and the
  // schema convention (`bills.paid_amount`, `refunds.amount_cents`). Display
  // / response-edge conversion happens only at the { zReport } boundary, never
  // in storage or in the storage-time net subtraction.
  const refundRow = db.prepare(`
    SELECT
      COUNT(*) AS refund_count,
      COALESCE(SUM(r.amount_cents), 0) AS refunded_cents
    FROM refunds r
    JOIN bills b ON b.id = r.bill_id
    WHERE b.paid_at >= ? AND b.paid_at < ?
  `).get(start, end) as { refund_count: number; refunded_cents: number };

  // cash sales (drawer-reality side of the split): raw pre-join `method='cash'`
  // filter, paid_at window, no `payment_methods` name join. Reads amount via
  // json_extract on the line object (the same scalar format used elsewhere).
  // Cash refunds by `created_at` (drawer reality: cash left the drawer on
  // the day the refund was issued, not the day the original bill was paid).
  // `minorFactor` is bound as a SQL parameter (matching the refund CTE
  // pattern immediately below) so non-100 currencies (KWD factor 1000,
  // JPY factor 1) round-trip exactly.
  const minorFactor = getCurrencyMinorUnitFactor(getTenantCurrency(db));
  const { salesCents, refundsCents } = cashDrawerSalesAndRefunds(db, start, end, minorFactor);

  const cashMovements = movements;
  const movementTotals = sumCashMovements(cashMovements, openingFloatOverride !== null);

  // Display payment-method totals — reuse paymentMethodBreakdown so display
  // numbers reconcile with the live financial-summary endpoint for the same day.
  // Keyed by paid_at (not per-line timestamps) so installment payments
  // land on the settlement day alongside gross/staff/tax (see B1 above).
  // Window attribution via explicitWindow; no date fields needed.
  const paymentMethodsRows = paymentMethodBreakdown(db, { paidOnly: true, attributeRefundsToBillDate: true, keyByPaidAt: true, explicitWindow: [start, end] });

  // Per-staff sales — same window as the bill count, keyed by paid_at so a
  // cross-midnight bill (created day-1, paid day-2) rolls into day-2's Z
  // (matches the gross/payment/expected windows above; cancels the prior
  // creation-time key, which produced a non-reconciling Z with respect to
  // the rest of the snapshot). Unpaid orders drop out: uncollected money
  // is not staff revenue for the day it was created.
  const staffSalesRows = db.prepare(`
    SELECT u.id AS user_id, u.name AS name, u.role AS role,
      COALESCE(SUM(b.paid_amount), 0) AS revenue,
      COUNT(b.id) AS orderCount
    FROM bills b
    JOIN orders o ON o.id = b.order_id
    JOIN users u ON u.id = o.user_id
    WHERE b.paid_at >= ? AND b.paid_at < ?
    GROUP BY u.id
    ORDER BY revenue DESC
    LIMIT 20
  `).all(start, end) as StaffSalesRow[];

  // Tax components — keyed by paid_at window to stay reconciled with the
  // rest of the Z. Bills are hydrated with their order items and then
  // aggregated via the existing `aggregateTaxComponents` pipeline, unchanged.
  // Unpaid bills drop out by the same logic as the staff query above.
  const bills = db.prepare(`
    SELECT b.*
    FROM bills b
    WHERE b.paid_at >= ? AND b.paid_at < ?
    ORDER BY b.paid_at, b.id
  `).all(start, end) as any[];
  const orders = getOrdersWithItemsForBills(db, bills);
  const taxDocuments = bills.map((bill) => ({
    tax_amount: bill.tax_amount,
    tax_snapshot: bill.tax_snapshot,
    tax_breakdown: bill.tax_breakdown,
    items: orders.get(Number(bill.id))?.items || [],
  }));
  const taxComponents = aggregateTaxComponents(taxDocuments);

  const grossCollectedCents = Math.round(Number(billRow.gross_collected || 0) * minorFactor);
  const refundedCents = Number(refundRow.refunded_cents || 0);

  return {
    billCount: Number(billRow.bill_count || 0),
    refundCount: Number(refundRow.refund_count || 0),
    grossCollectedCents,
    refundedCents,
    netCollectedCents: grossCollectedCents - refundedCents,
    cashSalesCents: salesCents,
    cashRefundsByCreatedAtCents: refundsCents,
    openingFloatCents: openingFloatOverride ?? movementTotals.openingFloatCents,
    payInCents: movementTotals.payInCents,
    payOutCents: movementTotals.payOutCents,
    safeDropCents: movementTotals.safeDropCents,
    cashMovements,
    paymentMethods: paymentMethodsRows.map((row) => ({
      method: row.method,
      count: Number(row.count || 0),
      total_cents: Math.round(Number(row.total || 0) * minorFactor),
    })),
    staffSales: staffSalesRows.map((row) => ({
      user_id: row.user_id,
      name: row.name,
      role: row.role,
      revenue_cents: Math.round(Number(row.revenue || 0) * minorFactor),
      orderCount: Number(row.orderCount || 0),
    })),
    taxComponents,
  };
}

router.get('/purchase-options', requirePermission('cash.movements.manage'), (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const openOrders = db.prepare(`
      SELECT po.id, po.po_number, po.supplier_id, s.name as supplier_name, po.total_amount, po.status
      FROM purchase_orders po
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.status IN ('ordered', 'pending')
      ORDER BY po.created_at DESC
    `).all();

    const suppliers = db.prepare(`
      SELECT id, name, category, payment_terms FROM suppliers WHERE is_active = 1 ORDER BY name ASC
    `).all();

    const inventoryItems = db.prepare(`
      SELECT id, name, sku, category, unit, quantity, cost_per_unit, 'inventory' as target_type
      FROM inventory_items WHERE is_active = 1 ORDER BY name ASC
    `).all();

    const supplyItems = db.prepare(`
      SELECT id, name, null as sku, 'supply' as category, base_unit as unit,
             stock_quantity as quantity, 0 as cost_per_unit, 'supplies' as target_type
      FROM supplies WHERE is_active = 1 AND deleted_at IS NULL ORDER BY name ASC
    `).all();

    res.json({
      purchase_orders: openOrders,
      suppliers,
      items: [...inventoryItems, ...supplyItems],
    });
  } catch (error: any) {
    console.error('[CashClosures] Purchase options error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

router.get('/movements', requirePermission('cash.movements.manage'), (req: Request, res: Response) => {
  try {
    const businessDate = validateBusinessDate(req.query.business_date);
    res.json({ businessDate, movements: listCashDrawerMovements(getDatabase(), businessDate) });
  } catch (error: any) {
    const status = error.statusCode || 500;
    if (status === 500) console.error('[CashClosures] Movement list error:', error);
    res.status(status).json({ error: status === 500 ? 'Internal server error' : error.message || 'Internal server error' });
  }
});

function mapOperatingExpenseCategory(cat?: string): string {
  const c = String(cat || '').toLowerCase().trim();
  if (c.includes('utilit')) return 'utilities';
  if (c.includes('maint') || c.includes('repair')) return 'maintenance';
  if (c.includes('packag') || c.includes('consumable')) return 'packaging_overhead';
  if (c.includes('market')) return 'marketing';
  if (c.includes('rent')) return 'rent';
  if (c.includes('license')) return 'licenses';
  if (c.includes('deprec')) return 'equipment_depreciation';
  return 'other';
}

export function handleCreateCashMovement(req: Request, res: Response): void {
  try {
    const body = req.body || {};
    const businessDate = validateBusinessDate(body.business_date);
    const movementType = validateMovementType(body.movement_type);
    const createdBy = String((req as any).user?.userId || '');
    if (!createdBy) throw httpError('Authentication required', 401);
    const db = getDatabase();
    requireOpenSessionForCash(db);
    const activeSession = getOpenSession(db);
    const sessionId = activeSession?.id ?? NO_CASH_SESSION_ID;
    const minorFactor = getCurrencyMinorUnitFactor(getTenantCurrency(db));

    if (closedDayExists(db, businessDate)) throw httpError('This day is already closed', 409);

    let id: number = 0;

    if (movementType === 'expense') {
      const amountCents = validateCents(body.amount_cents, 'amount_cents', false);
      const categoryLabel = String(body.expense_category || 'Other').trim();
      const mappedCategory = mapOperatingExpenseCategory(categoryLabel);
      const costType = (body.cost_type === 'indirect' || (!body.cost_type && (mappedCategory === 'utilities' || mappedCategory === 'maintenance' || mappedCategory === 'rent'))) ? 'indirect' : 'direct';
      const title = String(body.title || body.vendor || body.reason || 'Petty Expense').trim();
      const notes = body.notes ? String(body.notes).trim() : null;
      const amountUnits = amountCents / minorFactor;

      id = withTxn(() => {
        const timestamp = now();
        const drawerResult = db.prepare(`
          INSERT INTO cash_drawer_movements (
            business_date, movement_type, amount_cents, reason, created_by, created_at, cash_session_id
          ) VALUES (?, 'pay_out', ?, ?, ?, ?, ?)
        `).run(businessDate, amountCents, `Petty Expense: ${title}`, createdBy, timestamp, sessionId);
        const drawerId = Number(drawerResult.lastInsertRowid);

        const cmId = randomUUID();
        db.prepare(`
          INSERT INTO cash_movements (
            id, session_id, movement_type, category, amount, payment_method, reference_type, reference_id, notes, created_by, created_at, cash_drawer_movement_id
          ) VALUES (?, ?, 'petty_expense', ?, ?, 'cash', 'operating_expense', ?, ?, ?, ?, ?)
        `).run(
          cmId,
          sessionId > 0 ? String(sessionId) : null,
          categoryLabel,
          amountUnits,
          null,
          notes || body.reason || null,
          createdBy,
          timestamp,
          drawerId,
        );

        const expenseId = randomUUID();
        db.prepare(`
          INSERT INTO operating_expenses (
            id, title, category, cost_type, allocation_method, amount, billing_cycle, business_date,
            paid_from_session_id, supplier_id, notes, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'per_unit_sold', ?, 'one_time', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          expenseId,
          title,
          mappedCategory,
          costType,
          amountUnits,
          businessDate,
          sessionId > 0 ? String(sessionId) : null,
          body.supplier_id ? String(body.supplier_id) : null,
          notes || body.reason || null,
          createdBy,
          timestamp,
          timestamp,
        );

        db.prepare(`UPDATE cash_movements SET reference_id = ? WHERE id = ?`).run(expenseId, cmId);
        return drawerId;
      });
    } else if (movementType === 'purchase') {
      const timestamp = now();
      if (body.purchase_order_id) {
        // Mode A: Pay & Receive an Open Purchase Order (GRN)
        const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(body.purchase_order_id) as any;
        if (!po) throw httpError('Purchase order not found', 404);
        if (po.status === 'received') throw httpError('Purchase order already received', 400);

        const poTotal = Number(po.total_amount);
        const poAmountCents = body.amount_cents !== undefined ? validateCents(body.amount_cents, 'amount_cents', false) : Math.round(poTotal * minorFactor);

        id = withTxn(() => {
          const items = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(po.id) as any[];
          for (const item of items) {
            const rQty = item.ordered_qty;
            if (rQty <= 0) continue;
            db.prepare('UPDATE purchase_order_items SET received_qty = ? WHERE id = ?').run(rQty, item.id);

            if (item.target_type === 'inventory') {
              const inv = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(item.target_id) as any;
              if (inv) {
                const prevQty = Math.max(0, Number(inv.quantity) || 0);
                const prevCost = Math.max(0, Number(inv.cost_per_unit) || 0);
                const newTotalQty = prevQty + rQty;
                const newCost = newTotalQty > 0
                  ? (prevQty * prevCost + rQty * Number(item.unit_cost)) / newTotalQty
                  : Number(item.unit_cost);
                db.prepare(`
                  UPDATE inventory_items
                  SET quantity = ?, cost_per_unit = ?, updated_at = ?
                  WHERE id = ?
                `).run(newTotalQty, newCost, timestamp, inv.id);

                db.prepare(`
                  INSERT INTO stock_logs (
                    target_type, target_id, quantity_delta, stock_after, unit, reason, actor_user_id, reference_type, reference_id, created_at
                  ) VALUES ('inventory', ?, ?, ?, ?, 'GRN Received (Paid at POS)', ?, 'purchase_order', ?, ?)
                `).run(inv.id, rQty, newTotalQty, inv.unit || item.unit, createdBy, po.id, timestamp);
              }
            } else {
              const sup = db.prepare('SELECT * FROM supplies WHERE id = ?').get(item.target_id) as any;
              if (sup) {
                const prevQty = Math.max(0, Number(sup.stock_quantity ?? sup.quantity ?? 0));
                const prevCost = Math.max(0, Number(sup.cost_cents || 0) / 100);
                const newTotalQty = prevQty + rQty;
                const newCost = newTotalQty > 0
                  ? (prevQty * prevCost + rQty * Number(item.unit_cost)) / newTotalQty
                  : Number(item.unit_cost);
                db.prepare(`
                  UPDATE supplies
                  SET stock_quantity = ?, quantity = ?, cost_cents = ?, updated_at = ?
                  WHERE id = ?
                `).run(newTotalQty, newTotalQty, Math.round(newCost * 100), timestamp, sup.id);

                db.prepare(`
                  INSERT INTO stock_logs (
                    target_type, target_id, quantity_delta, stock_after, unit, reason, actor_user_id, reference_type, reference_id, created_at
                  ) VALUES ('supply', ?, ?, ?, ?, 'GRN Received (Paid at POS)', ?, 'purchase_order', ?, ?)
                `).run(sup.id, rQty, newTotalQty, sup.base_unit || item.unit, createdBy, po.id, timestamp);
              }
            }
          }

          db.prepare(`
            UPDATE purchase_orders
            SET status = 'received', paid_amount = total_amount, received_at = ?, received_by = ?, updated_at = ?
            WHERE id = ?
          `).run(timestamp, createdBy, timestamp, po.id);

          const drawerResult = db.prepare(`
            INSERT INTO cash_drawer_movements (
              business_date, movement_type, amount_cents, reason, created_by, created_at, cash_session_id
            ) VALUES (?, 'pay_out', ?, ?, ?, ?, ?)
          `).run(businessDate, poAmountCents, `Purchase Order: PO ${po.po_number}`, createdBy, timestamp, sessionId);
          const drawerId = Number(drawerResult.lastInsertRowid);

          const cmId = randomUUID();
          db.prepare(`
            INSERT INTO cash_movements (
              id, session_id, movement_type, category, amount, payment_method, reference_type, reference_id, notes, created_by, created_at, cash_drawer_movement_id
            ) VALUES (?, ?, 'supplier_payment', 'Purchasing', ?, 'cash', 'purchase_order', ?, ?, ?, ?, ?)
          `).run(
            cmId,
            sessionId > 0 ? String(sessionId) : null,
            poTotal,
            po.id,
            `POS payment for PO ${po.po_number}`,
            createdBy,
            timestamp,
            drawerId,
          );

          return drawerId;
        });
      } else {
        // Mode B: Quick Direct Cash Purchase (Walk-in / COD Stock Purchase)
        const amountCents = validateCents(body.amount_cents, 'amount_cents', false);
        const targetType = body.target_type === 'supply' ? 'supply' : 'inventory';
        const targetId = String(body.target_id || '').trim();
        if (!targetId) throw httpError('target_id is required for quick purchase', 400);
        const purchasedQty = Math.max(0.0001, Number(body.quantity) || 1);
        const totalCashPaid = amountCents / minorFactor;
        const unitCost = totalCashPaid / purchasedQty;

        id = withTxn(() => {
          let itemName = 'Item';
          let unit = 'unit';
          const quickPoId = randomUUID();
          const poNumber = `PO-POS-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`;

          let supplierId = body.supplier_id ? String(body.supplier_id) : null;
          if (!supplierId) {
            let defaultSupp = db.prepare("SELECT id FROM suppliers WHERE name = 'Walk-in / Cash Supplier' LIMIT 1").get() as any;
            if (!defaultSupp) {
              const dId = randomUUID();
              db.prepare(`
                INSERT INTO suppliers (id, name, payment_terms, is_active, created_at, updated_at)
                VALUES (?, 'Walk-in / Cash Supplier', 'COD', 1, ?, ?)
              `).run(dId, timestamp, timestamp);
              supplierId = dId;
            } else {
              supplierId = defaultSupp.id;
            }
          }

          if (targetType === 'inventory') {
            const inv = db.prepare('SELECT name, unit, quantity, cost_per_unit FROM inventory_items WHERE id = ?').get(targetId) as any;
            if (!inv) throw httpError('Inventory item not found', 404);
            itemName = inv.name;
            unit = inv.unit || 'unit';
            const prevQty = Math.max(0, Number(inv.quantity) || 0);
            const prevCost = Math.max(0, Number(inv.cost_per_unit) || 0);
            const newTotalQty = prevQty + purchasedQty;
            const newCost = (prevQty * prevCost + totalCashPaid) / newTotalQty;
            db.prepare(`UPDATE inventory_items SET quantity = ?, cost_per_unit = ?, updated_at = ? WHERE id = ?`)
              .run(newTotalQty, newCost, timestamp, targetId);
            db.prepare(`
              INSERT INTO stock_logs (
                target_type, target_id, quantity_delta, stock_after, unit, reason, actor_user_id, reference_type, reference_id, created_at
              ) VALUES ('inventory', ?, ?, ?, ?, 'Quick POS Purchase', ?, 'purchase_order', ?, ?)
            `).run(targetId, purchasedQty, newTotalQty, unit, createdBy, quickPoId, timestamp);
          } else {
            const sup = db.prepare('SELECT name, base_unit, quantity, stock_quantity, cost_cents FROM supplies WHERE id = ?').get(targetId) as any;
            if (!sup) throw httpError('Supply item not found', 404);
            itemName = sup.name;
            unit = sup.base_unit || 'unit';
            const prevQty = Math.max(0, Number(sup.stock_quantity ?? sup.quantity ?? 0));
            const prevCost = Math.max(0, Number(sup.cost_cents || 0) / 100);
            const newTotalQty = prevQty + purchasedQty;
            const newCost = (prevQty * prevCost + totalCashPaid) / newTotalQty;
            db.prepare(`UPDATE supplies SET stock_quantity = ?, quantity = ?, cost_cents = ?, updated_at = ? WHERE id = ?`)
              .run(newTotalQty, newTotalQty, Math.round(newCost * 100), timestamp, targetId);
            db.prepare(`
              INSERT INTO stock_logs (
                target_type, target_id, quantity_delta, stock_after, unit, reason, actor_user_id, reference_type, reference_id, created_at
              ) VALUES ('supply', ?, ?, ?, ?, 'Quick POS Purchase', ?, 'purchase_order', ?, ?)
            `).run(targetId, purchasedQty, newTotalQty, unit, createdBy, quickPoId, timestamp);
          }

          db.prepare(`
            INSERT INTO purchase_orders (
              id, po_number, supplier_id, status, subtotal, total_amount, paid_amount, received_at, received_by, notes, created_by, created_at, updated_at
            ) VALUES (?, ?, ?, 'received', ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(quickPoId, poNumber, supplierId, totalCashPaid, totalCashPaid, totalCashPaid, timestamp, createdBy, body.notes || 'Quick Direct Cash Purchase at POS', createdBy, timestamp, timestamp);

          const itemId = randomUUID();
          db.prepare(`
            INSERT INTO purchase_order_items (
              id, purchase_order_id, target_type, target_id, item_name, unit, ordered_qty, received_qty, unit_cost, line_total
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(itemId, quickPoId, targetType, targetId, itemName, unit, purchasedQty, purchasedQty, unitCost, totalCashPaid);

          const drawerResult = db.prepare(`
            INSERT INTO cash_drawer_movements (
              business_date, movement_type, amount_cents, reason, created_by, created_at, cash_session_id
            ) VALUES (?, 'pay_out', ?, ?, ?, ?, ?)
          `).run(businessDate, amountCents, `Purchase: ${itemName} (${purchasedQty} ${unit})`, createdBy, timestamp, sessionId);
          const drawerId = Number(drawerResult.lastInsertRowid);

          const cmId = randomUUID();
          db.prepare(`
            INSERT INTO cash_movements (
              id, session_id, movement_type, category, amount, payment_method, reference_type, reference_id, notes, created_by, created_at, cash_drawer_movement_id
            ) VALUES (?, ?, 'supplier_payment', 'Purchasing', ?, 'cash', 'purchase_order', ?, ?, ?, ?, ?)
          `).run(
            cmId,
            sessionId > 0 ? String(sessionId) : null,
            totalCashPaid,
            quickPoId,
            `POS quick purchase: ${itemName}`,
            createdBy,
            timestamp,
            drawerId,
          );

          return drawerId;
        });
      }
    } else {
      // Standard: opening_float, pay_in, pay_out, safe_drop
      const amountCents = validateCents(body.amount_cents, 'amount_cents', movementType === 'opening_float');
      const reason = validateMovementReason(body.reason, movementType !== 'opening_float');
      id = withTxn(() => {
        try {
          const result = db.prepare(`
            INSERT INTO cash_drawer_movements (
              business_date, movement_type, amount_cents, reason, created_by, created_at, cash_session_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(businessDate, movementType, amountCents, reason, createdBy, now(), sessionId);
          return Number(result.lastInsertRowid);
        } catch (error: any) {
          if (String(error?.message || '').includes('cash_drawer_one_opening_float')
            || (movementType === 'opening_float' && String(error?.message || '').includes('cash_drawer_movements.business_date'))) {
            throw httpError('An opening float is already recorded for this day', 409);
          }
          throw error;
        }
      });
    }

    const movement = db.prepare(`
      SELECT m.*, created_user.name AS created_by_name, voided_user.name AS voided_by_name
      FROM cash_drawer_movements m
      LEFT JOIN users created_user ON created_user.id = m.created_by
      LEFT JOIN users voided_user ON voided_user.id = m.voided_by
      WHERE m.id = ?
    `).get(id);
    res.status(201).json({ movement });
  } catch (error: any) {
    const status = error.statusCode || 500;
    if (status === 500) console.error('[CashClosures] Movement create error:', error);
    res.status(status).json({ error: status === 500 ? 'Internal server error' : error.message || 'Internal server error' });
  }
}

router.post('/movements', requirePermission('cash.movements.manage'), handleCreateCashMovement);

router.post('/movements/:id/void', requirePermission('cash.movements.void'), (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw httpError('id must be a positive integer', 400);
    const reason = validateMovementReason(req.body?.reason, true);
    const voidedBy = String((req as any).user?.userId || '');
    if (!voidedBy) throw httpError('Authentication required', 401);
    const db = getDatabase();
    withTxn(() => {
      const movement = db.prepare(`SELECT * FROM cash_drawer_movements WHERE id = ?`).get(id) as { business_date: string; voided_at: string | null } | undefined;
      if (!movement) throw httpError('Cash movement not found', 404);
      if (movement.voided_at) throw httpError('Cash movement is already voided', 409);
      if (closedDayExists(db, movement.business_date)) throw httpError('This day is already closed', 409);
      db.prepare(`
        UPDATE cash_drawer_movements
        SET voided_at = ?, voided_by = ?, void_reason = ?
        WHERE id = ? AND voided_at IS NULL
      `).run(now(), voidedBy, reason, id);
    });
    const movement = db.prepare(`
      SELECT m.*, created_user.name AS created_by_name, voided_user.name AS voided_by_name
      FROM cash_drawer_movements m
      LEFT JOIN users created_user ON created_user.id = m.created_by
      LEFT JOIN users voided_user ON voided_user.id = m.voided_by
      WHERE m.id = ?
    `).get(id);
    res.json({ movement });
  } catch (error: any) {
    const status = error.statusCode || 500;
    if (status === 500) console.error('[CashClosures] Movement void error:', error);
    res.status(status).json({ error: status === 500 ? 'Internal server error' : error.message || 'Internal server error' });
  }
});

// ── GET /api/cash-closures/history ──────────────────────────────────────────
// Returns all closures (pre_blind_cashier and full_day_close)
router.get('/history', requirePermission('cash.shifts.view'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT c.*, u.name AS closed_by_user_name, u.role AS closed_by_user_role
      FROM cash_closures c
      LEFT JOIN users u ON u.id = c.closed_by
      ORDER BY c.created_at DESC
      LIMIT 100
    `).all() as any[];

    const closures = rows.map((r) => {
      let zSnapshot = null;
      try { if (r.z_report_snapshot_json) zSnapshot = JSON.parse(r.z_report_snapshot_json); } catch {}
      let denoms = null;
      try { if (r.denominations_json) denoms = JSON.parse(r.denominations_json); } catch {}

      return {
        ...r,
        closed_by_name: r.closed_by_name || r.closed_by_user_name || 'Staff',
        closed_by_role: r.closed_by_role || r.closed_by_user_role || 'staff',
        z_report_snapshot: zSnapshot,
        denominations: denoms,
      };
    });

    res.json({ success: true, closures });
  } catch (error: any) {
    console.error('[CashClosures] Error fetching history:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch closures history' });
  }
});

// ── GET /api/cash-closures/preview ──────────────────────────────────────────
// Computes live shift/day metrics since the last full_day_close (or for today)
router.get('/preview', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const userId = String(user?.userId || user?.id || '');
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const userRow = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(userId) as any;
    const userRole = userRow?.role || user?.role || 'cashier';
    const hasDayClose = hasPermission(userId, 'cash.day-close');
    const isManagerOrOwner = userRole === 'owner' || userRole === 'admin' || userRole === 'manager' || hasDayClose;
    const mode = req.query.mode ? String(req.query.mode) : '';
    const shouldMask = !isManagerOrOwner || mode === 'pre_blind_cashier';

    const bDate = req.query.business_date ? String(req.query.business_date) : localDateInTimezone(new Date(), tenantTimezone(), tenantStartTime(db));
    const [periodStart, periodEnd] = dayBoundsInTimezone(bDate, tenantTimezone(), tenantStartTime(db));

    // Check last full day close
    const lastFullClose = db.prepare(`
      SELECT * FROM cash_closures
      WHERE (scope = 'day' OR closure_type = 'full_day_close')
      ORDER BY created_at DESC LIMIT 1
    `).get() as any;

    const effectiveStart = lastFullClose ? lastFullClose.created_at : periodStart;
    const effectiveEnd = now();

    // 1. Orders metrics in window
    const orders = db.prepare(`
      SELECT * FROM orders
      WHERE created_at >= ? AND created_at <= ?
    `).all(effectiveStart, effectiveEnd) as any[];

    let totalOrdersCount = 0;
    let dineInOrders = 0;
    let dineInSales = 0;
    let takeawayOrders = 0;
    let takeawaySales = 0;
    let deliveryOrders = 0;
    let deliverySales = 0;
    let voidedOrdersCount = 0;
    let grossSales = 0;
    let discountsTotal = 0;
    let taxTotal = 0;
    let netSales = 0;
    let aggregatorSales = 0;
    let aggregatorCommissions = 0;

    for (const o of orders) {
      if (o.status === 'cancelled' || o.status === 'voided') {
        voidedOrdersCount++;
        continue;
      }
      totalOrdersCount++;
      const tot = Number(o.total || 0);
      const sub = Number(o.subtotal || tot);
      const tax = Number(o.tax || 0);
      const disc = Math.max(0, sub - tot + tax);

      grossSales += sub;
      discountsTotal += disc;
      taxTotal += tax;
      netSales += tot;

      const orderType = String(o.order_type || o.type || 'dine_in').toLowerCase();
      if (orderType === 'dine_in' || orderType === 'table') {
        dineInOrders++;
        dineInSales += tot;
      } else if (orderType === 'takeaway' || orderType === 'pickup') {
        takeawayOrders++;
        takeawaySales += tot;
      } else if (orderType === 'delivery') {
        deliveryOrders++;
        deliverySales += tot;
      }

      if (o.delivery_channel_id || o.aggregator_commission_rate) {
        aggregatorSales += tot;
        const rate = Number(o.aggregator_commission_rate || 0);
        if (rate > 0) {
          aggregatorCommissions += (tot * rate) / 100;
        }
      }
    }

    // Carry over open tables
    const openTablesRow = db.prepare(`
      SELECT COUNT(*) as cnt FROM orders WHERE status IN ('open', 'active', 'in_progress', 'pending')
    `).get() as any;
    const carryOverTablesCount = Number(openTablesRow?.cnt || 0);

    // 2. Bills and Payment Breakdown
    const minorFactor = getCurrencyMinorUnitFactor(getTenantCurrency(db));
    const { salesCents, refundsCents } = cashDrawerSalesAndRefunds(db, effectiveStart, effectiveEnd, minorFactor);
    const cashSales = salesCents / minorFactor;
    const refundsTotal = refundsCents / minorFactor;

    // Payment method breakdown
    const billPayments = db.prepare(`
      SELECT b.payment_details, b.payment_method, b.paid_amount
      FROM bills b
      WHERE b.paid_at >= ? AND b.paid_at <= ?
    `).all(effectiveStart, effectiveEnd) as any[];

    let cardSales = 0;
    let walletSales = 0;
    let customPaymentSales = 0;

    for (const b of billPayments) {
      let details: any[] = [];
      try {
        if (b.payment_details) {
          const parsed = JSON.parse(b.payment_details);
          details = Array.isArray(parsed) ? parsed : [parsed];
        }
      } catch {}

      if (details.length > 0) {
        for (const d of details) {
          const m = String(d.method || '').toLowerCase();
          const amt = Number(d.amount || 0);
          if (m === 'card' || m === 'visa' || m === 'mastercard') cardSales += amt;
          else if (m === 'wallet' || m === 'instapay' || m === 'vodafone_cash') walletSales += amt;
          else if (m !== 'cash') customPaymentSales += amt;
        }
      } else {
        const m = String(b.payment_method || '').toLowerCase();
        const amt = Number(b.paid_amount || 0);
        if (m === 'card' || m === 'visa') cardSales += amt;
        else if (m === 'wallet' || m === 'instapay') walletSales += amt;
        else if (m !== 'cash') customPaymentSales += amt;
      }
    }

    // 3. Cash movements
    const movements = listCashDrawerMovements(db, bDate, false);
    let openingCash = 0;
    let cashInTotal = 0;
    let cashOutTotal = 0;

    for (const m of movements) {
      if (m.voided_at) continue;
      const amt = Number(m.amount_cents || 0) / 100;
      if (m.movement_type === 'opening_float') openingCash += amt;
      else if (m.movement_type === 'pay_in') cashInTotal += amt;
      else if (m.movement_type === 'pay_out' || m.movement_type === 'safe_drop') cashOutTotal += amt;
    }

    // Operating expenses in cash
    const expensesRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total_expenses
      FROM operating_expenses
      WHERE created_at >= ? AND created_at <= ?
    `).get(effectiveStart, effectiveEnd) as any;
    const expensesTotal = Number(expensesRow?.total_expenses || 0);

    // Expected cash formula
    const expectedCash = openingCash + cashSales + cashInTotal - cashOutTotal - refundsTotal;

    // 4. Expected BOM Materials Cost
    const orderItems = orders.length > 0
      ? (db.prepare(`
          SELECT oi.product_id, oi.quantity
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          WHERE o.created_at >= ? AND o.created_at <= ?
            AND o.status != 'cancelled' AND oi.status != 'refunded'
        `).all(effectiveStart, effectiveEnd) as any[])
      : [];

    const getHeader = db.prepare('SELECT id, yield_portions FROM bom_headers WHERE product_id = ?');
    const getComponents = db.prepare('SELECT * FROM bom_components WHERE bom_id = ?');

    let expectedBomCost = 0;
    for (const oi of orderItems) {
      const header = getHeader.get(oi.product_id) as any;
      if (!header) continue;
      const comps = getComponents.all(header.id) as any[];
      const portions = Math.max(0.1, Number(header.yield_portions || 1));
      const qty = Number(oi.quantity || 1);

      for (const comp of comps) {
        let unitCost = Number(comp.custom_unit_cost || 0);
        if (comp.cost_source === 'manual' && comp.custom_unit_cost !== null && comp.custom_unit_cost !== undefined) {
          unitCost = Number(comp.custom_unit_cost);
        } else if (comp.target_type === 'inventory') {
          const inv = db.prepare('SELECT cost_per_unit FROM inventory_items WHERE id = ?').get(comp.target_id) as any;
          if (inv && Number(inv.cost_per_unit) > 0) unitCost = Number(inv.cost_per_unit);
        } else if (comp.target_type === 'supply') {
          const sup = db.prepare('SELECT cost_cents FROM supplies WHERE id = ?').get(comp.target_id) as any;
          if (sup && Number(sup.cost_cents) > 0) unitCost = Number(sup.cost_cents) / 100;
        }

        const net = Number(comp.net_quantity || 0);
        const waste = Math.min(99, Math.max(0, Number(comp.waste_pct || 0)));
        const grossPerPortion = net / (1 - waste / 100);
        expectedBomCost += (grossPerPortion / portions) * qty * unitCost;
      }
    }

    // Authorized waste in period
    const wasteRow = db.prepare(`
      SELECT COALESCE(SUM(total_cost), 0) as total_waste
      FROM waste_logs
      WHERE logged_at >= ? AND logged_at <= ?
    `).get(effectiveStart, effectiveEnd) as any;
    const authorizedWasteCost = Number(wasteRow?.total_waste || 0);

    const expectedGrossProfit = netSales - expectedBomCost;
    const expectedNetProfit = netSales - expectedBomCost - authorizedWasteCost - expensesTotal - aggregatorCommissions;

    // Latest pre-blind cashier close for current shift
    const latestPreblind = db.prepare(`
      SELECT * FROM cash_closures
      WHERE closure_type = 'pre_blind_cashier'
        AND created_at >= ?
      ORDER BY created_at DESC LIMIT 1
    `).get(effectiveStart) as any;

    // Safe drops in window
    let safeDropsTotal = 0;
    try {
      const safeDropRow = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total_drops
        FROM safe_vault_ledger
        WHERE tx_type = 'mid_shift_safe_drop' AND created_at >= ? AND created_at <= ?
      `).get(effectiveStart, effectiveEnd) as any;
      safeDropsTotal = Number(safeDropRow?.total_drops || 0);
    } catch {}

    // Anomaly metrics in window
    let anomalyCount = 0;
    let anomalyRiskScore = 0;
    let postPrintDeletionsCount = 0;
    let noSaleDrawerOpensCount = 0;
    try {
      const anomRow = db.prepare(`
        SELECT
          COUNT(*) as cnt,
          COALESCE(SUM(risk_points), 0) as total_risk,
          COALESCE(SUM(CASE WHEN event_type IN ('post_print_item_removed', 'post_print_order_cancelled') THEN 1 ELSE 0 END), 0) as post_print_cnt,
          COALESCE(SUM(CASE WHEN event_type = 'no_sale_drawer_open' THEN 1 ELSE 0 END), 0) as no_sale_cnt
        FROM pos_anomaly_logs
        WHERE created_at >= ? AND created_at <= ?
      `).get(effectiveStart, effectiveEnd) as any;
      anomalyCount = Number(anomRow?.cnt || 0);
      anomalyRiskScore = Number(anomRow?.total_risk || 0);
      postPrintDeletionsCount = Number(anomRow?.post_print_cnt || 0);
      noSaleDrawerOpensCount = Number(anomRow?.no_sale_cnt || 0);
    } catch {}

    const previewData = {
      shift_opened_at: effectiveStart,
      business_date: bDate,
      opening_cash: openingCash,
      total_orders_count: totalOrdersCount,
      gross_sales: shouldMask ? null : grossSales,
      discounts_total: shouldMask ? null : discountsTotal,
      tax_total: shouldMask ? null : taxTotal,
      net_sales: shouldMask ? null : netSales,
      dine_in_orders: dineInOrders,
      dine_in_sales: shouldMask ? null : dineInSales,
      takeaway_orders: takeawayOrders,
      takeaway_sales: shouldMask ? null : takeawaySales,
      delivery_orders: deliveryOrders,
      delivery_sales: shouldMask ? null : deliverySales,
      voided_orders_count: voidedOrdersCount,
      carry_over_tables_count: carryOverTablesCount,
      cash_sales: shouldMask ? null : cashSales,
      card_sales: cardSales,
      wallet_sales: walletSales,
      custom_payment_sales: customPaymentSales,
      aggregator_sales: aggregatorSales,
      aggregator_commissions: aggregatorCommissions,
      cash_in_total: cashInTotal,
      cash_out_total: cashOutTotal,
      expenses_total: expensesTotal,
      refunds_total: refundsTotal,
      expected_cash: shouldMask ? null : expectedCash,
      variance: shouldMask ? null : 0,
      expected_bom_cost: shouldMask ? null : expectedBomCost,
      authorized_waste_cost: shouldMask ? null : authorizedWasteCost,
      expected_gross_profit: shouldMask ? null : expectedGrossProfit,
      expected_net_profit: shouldMask ? null : expectedNetProfit,
      safe_drops_total: safeDropsTotal,
      anomaly_count: anomalyCount,
      anomaly_risk_score: anomalyRiskScore,
      post_print_deletions_count: postPrintDeletionsCount,
      no_sale_drawer_opens_count: noSaleDrawerOpensCount,
      masked_for_cashier: shouldMask,
      latest_preblind_closure: latestPreblind || null,
    };

    res.json({
      success: true,
      ...previewData,
      preview: previewData,
    });
  } catch (error: any) {
    console.error('[CashClosures] Preview error:', error);
    res.status(500).json({ error: error.message || 'Failed to compute closure preview' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const db = getDatabase();
    const user = (req as any).user;
    const closedBy = String(user?.userId || user?.id || '');
    if (!closedBy) throw httpError('Authentication required', 401);

    const userRow = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(closedBy) as any;
    const closedByName = userRow?.name || user?.name || 'Staff';
    const closedByRole = userRow?.role || user?.role || 'cashier';

    const closureType: 'pre_blind_cashier' | 'full_day_close' = body.closure_type === 'pre_blind_cashier' ? 'pre_blind_cashier' : 'full_day_close';

    const businessDate = body.business_date ? validateBusinessDate(body.business_date) : localDateInTimezone(new Date(), tenantTimezone(), tenantStartTime(db));
    const [periodStart, periodEnd] = dayBoundsInTimezone(businessDate, tenantTimezone(), tenantStartTime(db));

    if (closureType !== 'pre_blind_cashier') {
      // Role or PIN verification for full_day_close
      const hasDayClose = hasPermission(closedBy, 'cash.day-close');
      const isOwnerOrManager = closedByRole === 'owner' || closedByRole === 'admin' || closedByRole === 'manager' || hasDayClose;
      if (!isOwnerOrManager) {
        const managerPin = String(body.manager_pin || '').trim();
        if (!managerPin) {
          throw httpError('Manager or Owner PIN required for Full Day Close', 403);
        }
        const adminCandidates = db.prepare(`
          SELECT id, pin, pin_hash FROM users WHERE is_active = 1 AND role IN ('owner', 'admin', 'manager')
        `).all() as any[];
        const pinValid = adminCandidates.some((c) => {
          if (c.pin_hash && bcrypt.compareSync(managerPin, c.pin_hash)) return true;
          if (c.pin && String(c.pin) === managerPin) return true;
          return false;
        });
        if (!pinValid) {
          throw httpError('Invalid Manager or Owner PIN', 403);
        }
      }
    }

    const requestedOpeningFloatCents = body.opening_float_cents !== undefined ? validateCents(body.opening_float_cents, 'opening_float_cents') : 0;
    let countedCashCents = 0;
    if (body.counted_cash_cents !== undefined) {
      countedCashCents = validateCents(body.counted_cash_cents, 'counted_cash_cents');
    } else if (body.actual_cash_cents !== undefined) {
      countedCashCents = validateCents(body.actual_cash_cents, 'actual_cash_cents');
    } else if (body.actual_cash !== undefined) {
      countedCashCents = Math.round(Number(body.actual_cash) * 100);
    }
    const declaredCardSlips = Number(body.declared_card_slips || 0);
    const declaredWalletSlips = Number(body.declared_wallet_slips || 0);
    const denominationsJson = body.denominations ? JSON.stringify(body.denominations) : null;
    const linkedPreblindId = body.linked_preblind_id ? String(body.linked_preblind_id) : null;
    const notes = typeof body.notes === 'string' ? body.notes.slice(0, MAX_NOTES_LENGTH) : null;
    const scope = body.scope === 'session' ? 'session' : 'day';

    const result = withTxn(() => {
      if (closureType === 'full_day_close' && scope === 'day') {
        const existing = db.prepare(
          `SELECT id FROM cash_closures WHERE business_date = ? AND scope = 'day' AND closure_type = 'full_day_close' LIMIT 1`
        ).get(businessDate);
        if (existing) {
          throw httpError('This day is already closed', 409);
        }
      }

      const recordedOpeningFloatCents = activeOpeningFloatCents(db, businessDate);
      if (recordedOpeningFloatCents === null && requestedOpeningFloatCents > 0) {
        db.prepare(`
          INSERT INTO cash_drawer_movements (
            business_date, movement_type, amount_cents, reason, created_by, created_at
          ) VALUES (?, 'opening_float', ?, 'Opening float', ?, ?)
        `).run(businessDate, requestedOpeningFloatCents, closedBy, now());
      }

      const aggregates = computeDayAggregates(db, businessDate);
      const expectedCashCents = expectedCashFromAggregates(aggregates);
      const varianceCents = countedCashCents - expectedCashCents;

      let zNumber = 0;
      try {
        zNumber = nextZNumber();
      } catch {
        zNumber = Math.floor(1000 + Math.random() * 9000);
      }

      const createdAt = now();

      // Compute live sales breakdown & BOM cost
      const orders = db.prepare(`
        SELECT * FROM orders WHERE created_at >= ? AND created_at <= ? AND status != 'cancelled'
      `).all(periodStart, createdAt) as any[];

      let dineInSales = 0;
      let takeawaySales = 0;
      let deliverySales = 0;
      let walletSales = 0;
      let aggregatorSales = 0;
      let expectedBomCost = 0;

      for (const o of orders) {
        const tot = Number(o.total || 0);
        const t = String(o.order_type || o.type || 'dine_in').toLowerCase();
        if (t === 'dine_in' || t === 'table') dineInSales += tot;
        else if (t === 'takeaway' || t === 'pickup') takeawaySales += tot;
        else if (t === 'delivery') deliverySales += tot;
        if (o.delivery_channel_id) aggregatorSales += tot;
      }

      const getHeader = db.prepare('SELECT id, yield_portions FROM bom_headers WHERE product_id = ?');
      const getComponents = db.prepare('SELECT * FROM bom_components WHERE bom_id = ?');
      const orderItems = orders.length > 0
        ? (db.prepare(`
            SELECT oi.product_id, oi.quantity FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            WHERE o.created_at >= ? AND o.created_at <= ? AND o.status != 'cancelled' AND oi.status != 'refunded'
          `).all(periodStart, createdAt) as any[])
        : [];

      for (const oi of orderItems) {
        const header = getHeader.get(oi.product_id) as any;
        if (!header) continue;
        const comps = getComponents.all(header.id) as any[];
        const portions = Math.max(0.1, Number(header.yield_portions || 1));
        const qty = Number(oi.quantity || 1);

        for (const comp of comps) {
          let unitCost = Number(comp.custom_unit_cost || 0);
          if (comp.cost_source === 'manual' && comp.custom_unit_cost !== null && comp.custom_unit_cost !== undefined) {
            unitCost = Number(comp.custom_unit_cost);
          } else if (comp.target_type === 'inventory') {
            const inv = db.prepare('SELECT cost_per_unit FROM inventory_items WHERE id = ?').get(comp.target_id) as any;
            if (inv && Number(inv.cost_per_unit) > 0) unitCost = Number(inv.cost_per_unit);
          } else if (comp.target_type === 'supply') {
            const sup = db.prepare('SELECT cost_cents FROM supplies WHERE id = ?').get(comp.target_id) as any;
            if (sup && Number(sup.cost_cents) > 0) unitCost = Number(sup.cost_cents) / 100;
          }

          const net = Number(comp.net_quantity || 0);
          const waste = Math.min(99, Math.max(0, Number(comp.waste_pct || 0)));
          expectedBomCost += ((net / (1 - waste / 100)) / portions) * qty * unitCost;
        }
      }

      const wasteRow = db.prepare('SELECT COALESCE(SUM(total_cost), 0) as w FROM waste_logs WHERE logged_at >= ? AND logged_at <= ?').get(periodStart, createdAt) as any;
      const authorizedWasteCost = Number(wasteRow?.w || 0);

      const expRow = db.prepare('SELECT COALESCE(SUM(amount), 0) as e FROM operating_expenses WHERE created_at >= ? AND created_at <= ?').get(periodStart, createdAt) as any;
      const expensesTotal = Number(expRow?.e || 0);

      const netSales = aggregates.netCollectedCents / 100;
      const expectedGrossProfit = netSales - expectedBomCost;
      const expectedNetProfit = netSales - expectedBomCost - authorizedWasteCost - expensesTotal;

      const fullZSnapshot = {
        z_number: zNumber,
        business_date: businessDate,
        period_start: periodStart,
        period_end: createdAt,
        closed_by_name: closedByName,
        closed_by_role: closedByRole,
        total_orders_count: orders.length,
        gross_sales: aggregates.grossCollectedCents / 100,
        refunds_total: aggregates.refundedCents / 100,
        net_sales: netSales,
        dine_in_sales: dineInSales,
        takeaway_sales: takeawaySales,
        delivery_sales: deliverySales,
        wallet_sales: walletSales,
        aggregator_sales: aggregatorSales,
        opening_cash: aggregates.openingFloatCents / 100,
        expected_cash: expectedCashCents / 100,
        counted_cash: countedCashCents / 100,
        variance: varianceCents / 100,
        expected_bom_cost: expectedBomCost,
        authorized_waste_cost: authorizedWasteCost,
        operating_expenses: expensesTotal,
        expected_gross_profit: expectedGrossProfit,
        expected_net_profit: expectedNetProfit,
        payment_methods: aggregates.paymentMethods,
        staff_sales: aggregates.staffSales,
      };

      // Safe drops & anomaly metrics
      let safeDropsTotal = 0;
      try {
        const safeDropRow = db.prepare(`
          SELECT COALESCE(SUM(amount), 0) as total_drops
          FROM safe_vault_ledger
          WHERE tx_type = 'mid_shift_safe_drop' AND created_at >= ? AND created_at <= ?
        `).get(periodStart, createdAt) as any;
        safeDropsTotal = Number(safeDropRow?.total_drops || 0);
      } catch {}

      let anomalyCount = 0;
      let anomalyRiskScore = 0;
      let postPrintDeletionsCount = 0;
      let noSaleDrawerOpensCount = 0;
      try {
        const anomRow = db.prepare(`
          SELECT
            COUNT(*) as cnt,
            COALESCE(SUM(risk_points), 0) as total_risk,
            COALESCE(SUM(CASE WHEN event_type IN ('post_print_item_removed', 'post_print_order_cancelled') THEN 1 ELSE 0 END), 0) as post_print_cnt,
            COALESCE(SUM(CASE WHEN event_type = 'no_sale_drawer_open' THEN 1 ELSE 0 END), 0) as no_sale_cnt
          FROM pos_anomaly_logs
          WHERE created_at >= ? AND created_at <= ?
        `).get(periodStart, createdAt) as any;
        anomalyCount = Number(anomRow?.cnt || 0);
        anomalyRiskScore = Number(anomRow?.total_risk || 0);
        postPrintDeletionsCount = Number(anomRow?.post_print_cnt || 0);
        noSaleDrawerOpensCount = Number(anomRow?.no_sale_cnt || 0);
      } catch {}

      const cashVariance = (countedCashCents - expectedCashCents) / 100;
      if (closureType === 'pre_blind_cashier' && cashVariance < -5) {
        logPosAnomaly(db, {
          event_type: 'pre_blind_shortage',
          severity: 'high',
          risk_points: 20,
          amount_impact: Math.abs(cashVariance),
          actor_user_id: closedBy,
          actor_user_name: closedByName,
          actor_role: closedByRole,
          reason: `Pre-blind cash shortage of ${Math.abs(cashVariance).toFixed(2)}`,
        });
        anomalyCount += 1;
        anomalyRiskScore += 20;
      }

      (fullZSnapshot as any).safe_drops_total = safeDropsTotal;
      (fullZSnapshot as any).anomaly_count = anomalyCount;
      (fullZSnapshot as any).anomaly_risk_score = anomalyRiskScore;
      (fullZSnapshot as any).post_print_deletions_count = postPrintDeletionsCount;
      (fullZSnapshot as any).no_sale_drawer_opens_count = noSaleDrawerOpensCount;

      const insertStmt = db.prepare(`
        INSERT INTO cash_closures (
          scope, business_date, period_start, period_end,
          opening_float_cents, expected_cash_cents, counted_cash_cents, variance_cents,
          gross_collected_cents, refunded_cents, net_collected_cents,
          bill_count, refund_count,
          payment_methods_json, staff_sales_json, tax_components_json,
          pay_in_cents, pay_out_cents, safe_drop_cents, cash_movements_json,
          z_number, closed_by, notes, created_at,
          closure_type, closed_by_name, closed_by_role, shift_opened_at,
          total_orders_count, dine_in_sales, takeaway_sales, delivery_sales,
          wallet_sales, aggregator_sales, cash_in_total, cash_out_total,
          expenses_total, expected_bom_cost, authorized_waste_cost,
          expected_gross_profit, expected_net_profit, declared_card_slips,
          declared_wallet_slips, denominations_json, linked_preblind_id,
          z_report_snapshot_json, safe_drops_total, anomaly_count,
          anomaly_risk_score, post_print_deletions_count, no_sale_drawer_opens_count
        ) VALUES (
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?
        )
      `);

      const insertResult = insertStmt.run(
        scope, businessDate, periodStart, createdAt,
        aggregates.openingFloatCents, expectedCashCents, countedCashCents, varianceCents,
        aggregates.grossCollectedCents, aggregates.refundedCents, aggregates.netCollectedCents,
        aggregates.billCount, aggregates.refundCount,
        JSON.stringify(aggregates.paymentMethods),
        JSON.stringify(aggregates.staffSales),
        JSON.stringify(aggregates.taxComponents),
        aggregates.payInCents, aggregates.payOutCents, aggregates.safeDropCents,
        JSON.stringify(aggregates.cashMovements),
        zNumber, closedBy, notes, createdAt,
        closureType, closedByName, closedByRole, periodStart,
        orders.length, dineInSales, takeawaySales, deliverySales,
        walletSales, aggregatorSales, aggregates.payInCents / 100, (aggregates.payOutCents + aggregates.safeDropCents) / 100,
        expensesTotal, expectedBomCost, authorizedWasteCost,
        expectedGrossProfit, expectedNetProfit, declaredCardSlips,
        declaredWalletSlips, denominationsJson, linkedPreblindId,
        JSON.stringify(fullZSnapshot), safeDropsTotal, anomalyCount,
        anomalyRiskScore, postPrintDeletionsCount, noSaleDrawerOpensCount
      );

      const closureId = Number(insertResult.lastInsertRowid);

      if (closureType === 'pre_blind_cashier') {
        // Return masked response for the cashier
        return {
          id: closureId,
          closure_type: 'pre_blind_cashier',
          business_date: businessDate,
          created_at: createdAt,
          closed_by_name: closedByName,
          declared_cash: countedCashCents / 100,
          actual_cash: countedCashCents / 100,
          declared_card_slips: declaredCardSlips,
          declared_wallet_slips: declaredWalletSlips,
          masked_for_cashier: true,
          message: 'Pre-blind shift handover recorded successfully',
        };
      }

      // Full Day Close: return complete unmasked report
      return {
        id: closureId,
        closure_type: 'full_day_close',
        masked_for_cashier: false,
        scope,
        business_date: businessDate,
        period_start: periodStart,
        period_end: createdAt,
        opening_float_cents: aggregates.openingFloatCents,
        expected_cash_cents: expectedCashCents,
        counted_cash_cents: countedCashCents,
        variance_cents: varianceCents,
        gross_collected_cents: aggregates.grossCollectedCents,
        refunded_cents: aggregates.refundedCents,
        net_collected_cents: aggregates.netCollectedCents,
        bill_count: aggregates.billCount,
        refund_count: aggregates.refundCount,
        payment_methods: aggregates.paymentMethods,
        staff_sales: aggregates.staffSales,
        tax_components: aggregates.taxComponents,
        z_number: zNumber,
        closed_by: closedBy,
        closed_by_name: closedByName,
        closed_by_role: closedByRole,
        expected_bom_cost: expectedBomCost,
        authorized_waste_cost: authorizedWasteCost,
        expected_gross_profit: expectedGrossProfit,
        expected_net_profit: expectedNetProfit,
        z_report_snapshot: fullZSnapshot,
        notes,
        created_at: createdAt,
      };
    });

    if (closureType === 'full_day_close') {
      try {
        const { generateAndSyncEodBundle } = require('../services/google-drive');
        void generateAndSyncEodBundle(result.id);
      } catch (e) {
        console.warn('[CashClosures] Auto EOD sync trigger non-fatal:', e);
      }
    }

    res.status(201).json({
      zReport: result,
      ...result,
      closure_id: result.id,
      expected_cash_cents: result.expected_cash_cents ?? null,
      variance_cents: result.variance_cents ?? null,
    });
  } catch (error: any) {
    const status = error.statusCode || 500;
    if (status === 500) console.error('[CashClosures] Internal error:', error);
    res.status(status).json({ error: status === 500 ? 'Internal server error' : error.message || 'Internal server error' });
  }
});

export { router as cashClosureRoutes };

// ── POST /:id/print — dispatch the stored Z to the default printer ──────────
// Owner/manager/cashier may print; day-close rows additionally require the
// owner role (checked after the row loads). The forced drawer pulse is appended by `printZReport` itself
// (bypassing bill-bound `shouldPulseForPayment`, spec #649). WebUSB printers
// return `{ bytes: number[] }` for the frontend to dispatch; network/usb
// printers go through the backend socket. The Z row is never mutated.
router.post('/:id/print', requirePermission('printing.execute'), async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'id must be a positive integer' });
    }
    const row = db.prepare(`SELECT * FROM cash_closures WHERE id = ?`).get(id) as any;
    if (!row) return res.status(404).json({ error: 'Cash closure not found' });
    // Session Z rows print for the shift roles; day-close Z stays owner-only.
    if (row.scope !== 'session' && (req as AuthedRequest).user?.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can print day-close reports' });
    }
    const isReprint = req.body && req.body.isReprint === true;
    // F6: resolve the operator's display name via users(id → name) so the
    // printed Z shows the operator (not the raw user id). Falls back to the
    // id string when the user row is missing (e.g. historical data after a
    // staff deletion).
    const snapshot = shapeZReportSnapshot(db, row, isReprint);
    const languageRow = db.prepare(`SELECT value FROM settings WHERE key = 'language'`).get() as { value?: string } | undefined;
    const zPolicy = parseStoredLanguagePolicy(
      Z_REPORT_LANGUAGE_POLICY_KEY,
      (db.prepare('SELECT value FROM settings WHERE key = ?').get(Z_REPORT_LANGUAGE_POLICY_KEY) as { value?: string } | undefined)?.value,
    ) as ReceiptLanguagePolicy;
    const zLanguages = resolveReceiptLanguages(zPolicy, languageRow?.value || 'en');
    snapshot.__language = zLanguages[0];
    if (zLanguages[1]) snapshot.__additionalLanguage = zLanguages[1];
    // Resolve the default receipt printer server-side so the WebUSB branch
    // is reachable end-to-end (mirrors `main/routes/printers.ts:304-339`,
    // bytes branch `:329-331`). `getPrinterConfig()` inside the helper
    // excludes webusb; selecting it here closes that gap.
    const printer = db.prepare(`SELECT * FROM printers WHERE is_default = 1`).get() as any;
    if (!printer) return res.status(409).json({ error: 'No default printer configured' });
    const { printZReport } = require('../printers/thermal');
    // Thread request cancellation through the print job. The resolved Z
    // language policy is carried only in this print snapshot.
    const result = await printZReport(snapshot, getHttpRequestSignal(req), printer);
    if (printer.connection_type === 'webusb' && result?.bytes) {
      // Return the FULL bytes including the forced drawer pulse; the renderer
      // dispatches them over WebUSB exactly as the test-page endpoint does.
      return res.json({ success: true, webusb: true, isReprint, bytes: Array.from(result.bytes), warnings: result.warnings || [] });
    }
    if (!result.ok) {
      return res.status(502).json({ error: result.detail || 'Printer did not respond or print failed', detail: result.detail, warnings: result.warnings || [] });
    }
    res.json({ success: true, isReprint, warnings: result.warnings || [] });
  } catch (error: any) {
    console.error('[CashClosures] Print error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
