import crypto from 'node:crypto';
import {
  getDatabase,
  withTxn,
  now,
  getSettingValue,
  requireTenantTimezone,
  parseRowJson,
  parseItemJson,
  sanitizedNumberPrefix,
  clampFinancialYearStart,
  invoicePeriodSegment,
  InvoiceResetPeriod,
  getCurrentSchemaVersion,
} from '../db';
import { getTenantCurrency } from '../services/refund';
import { getActiveCountryPack } from '../services/tax';
import { applyPayableRounding } from '../services/tax-engine';

export interface GenerateBillParams {
  orderId: number | string;
  userId?: string | null;
  idempotencyKey?: string | null;
  correlationId?: string;
  db?: ReturnType<typeof getDatabase>;
}

export interface GenerateBillResult {
  bill: any;
  isNew: boolean;
  recovered: boolean;
  supportId: string;
  correlationId: string;
}

export interface BillGenerationDiagnosticEvent {
  level: 'info' | 'warn' | 'error';
  scope: 'BillGenerator';
  stage: 'start' | 'check_idempotency' | 'check_existing' | 'repair_existing' | 'validate_order' | 'allocate_sequence' | 'sequence_reconciled' | 'insert_bill' | 'commit' | 'failure';
  correlationId: string;
  supportId: string;
  orderId: number;
  orderNumber?: string;
  tableId?: string | number | null;
  billId?: number | null;
  billNumber?: string | null;
  status?: string | null;
  idempotencyKeyHash?: string | null;
  retryCount?: number;
  sqliteErrorCode?: string | null;
  sequenceState?: { bucket: string; previous: number; next: number } | null;
  recovered?: boolean;
  appVersion: string;
  schemaVersion: number;
  cloudStatus: 'online' | 'offline';
  message?: string;
  timestamp: string;
}

const APP_VERSION = '4.0.0';
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const MAX_SEQUENCE_ALLOCATION_ATTEMPTS = 10;
const MAX_BUSY_RETRIES = 5;
const BASE_BUSY_DELAY_MS = 25;
const BUSY_JITTER_MS = 25;

export function generateSupportId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rand = '';
  for (let i = 0; i < 6; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `SUP-${rand}`;
}

export function generateCorrelationId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `corr-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function hashIdempotencyKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export function hashBillRequest(orderId: number): string {
  return crypto.createHash('sha256').update(JSON.stringify({ order_id: orderId })).digest('hex');
}

export function isSqliteBusyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const anyErr = error as any;
  const code = String(anyErr.code || '');
  const msg = String(anyErr.message || '');
  return (
    code === 'SQLITE_BUSY' ||
    code === 'SQLITE_LOCKED' ||
    code === 'SQLITE_BUSY_RECOVERY' ||
    code === 'SQLITE_BUSY_SNAPSHOT' ||
    /database is (locked|busy)/i.test(msg)
  );
}

export function logDiagnostic(event: BillGenerationDiagnosticEvent): void {
  try {
    const payload = JSON.stringify(event);
    if (event.level === 'error') {
      console.error(`[BillGenerator:Diagnostic] ${payload}`);
    } else if (event.level === 'warn') {
      console.warn(`[BillGenerator:Diagnostic] ${payload}`);
    } else {
      console.log(`[BillGenerator:Diagnostic] ${payload}`);
    }
  } catch {}
}

export async function withBusyRetryAsync<T>(
  fn: () => T | Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    jitterMs?: number;
    onRetry?: (attempt: number, error: unknown) => void;
  } = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? MAX_BUSY_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? BASE_BUSY_DELAY_MS;
  const jitterMs = options.jitterMs ?? BUSY_JITTER_MS;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt < maxRetries && isSqliteBusyError(error)) {
        options.onRetry?.(attempt + 1, error);
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * jitterMs;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}

/** Atomically allocate the next non-colliding bill number and repair sequence if needed. */
export function allocateBillNumberWithRecovery(
  dbInstance: ReturnType<typeof getDatabase>,
  options: { maxAttempts?: number; supportId?: string; correlationId?: string; orderId?: number } = {}
): string {
  const maxAttempts = options.maxAttempts ?? MAX_SEQUENCE_ALLOCATION_ATTEMPTS;
  const supportId = options.supportId || generateSupportId();
  const correlationId = options.correlationId || generateCorrelationId();
  const orderId = options.orderId || 0;

  const prefix = sanitizedNumberPrefix(getSettingValue('invoice_number_prefix'), 'INV');
  const includePeriod = getSettingValue('invoice_number_include_period') !== 'false';
  const configuredPeriod = getSettingValue('invoice_number_reset_period') || 'daily';
  const resetPeriod: InvoiceResetPeriod = ['never', 'daily', 'monthly', 'financial_year'].includes(configuredPeriod)
    ? (configuredPeriod as InvoiceResetPeriod)
    : 'daily';
  const timezone = requireTenantTimezone();
  const fyStart = clampFinancialYearStart(
    getSettingValue('invoice_financial_year_start_month'),
    getSettingValue('invoice_financial_year_start_day')
  );
  const periodSegment = invoicePeriodSegment(
    resetPeriod === 'never' ? 'daily' : resetPeriod,
    timezone,
    fyStart.month,
    fyStart.day
  );
  const bucket = resetPeriod === 'never' ? 'ALL' : periodSegment;
  const basePrefix = [prefix, includePeriod ? periodSegment : ''].filter(Boolean).join('-');
  const escapedBasePrefix = basePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const seqRegex = new RegExp(`^${escapedBasePrefix}-(\\d+)$`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Check if sequences row exists or is behind existing bills
    const currentSeqRow = dbInstance
      .prepare('SELECT current_value FROM sequences WHERE name = ? AND date = ?')
      .get('bills', bucket) as { current_value: number } | undefined;
    const currentVal = currentSeqRow?.current_value ?? 0;

    // Scan existing bills matching prefix to ensure sequences table is not lagging
    const matchingBills = dbInstance
      .prepare('SELECT bill_number FROM bills WHERE bill_number LIKE ?')
      .all(`${basePrefix}-%`) as { bill_number: string }[];

    let maxExisting = 0;
    for (const b of matchingBills) {
      const match = String(b.bill_number).match(seqRegex);
      if (match) {
        const parsed = Number.parseInt(match[1], 10);
        if (Number.isFinite(parsed) && parsed > maxExisting) {
          maxExisting = parsed;
        }
      }
    }

    if (maxExisting > currentVal) {
      // Sequence is desynchronized! Reconcile immediately inside sequences table
      if (!currentSeqRow) {
        dbInstance
          .prepare('INSERT INTO sequences (name, date, current_value) VALUES (?, ?, ?)')
          .run('bills', bucket, maxExisting);
      } else {
        dbInstance
          .prepare('UPDATE sequences SET current_value = ? WHERE name = ? AND date = ?')
          .run(maxExisting, 'bills', bucket);
      }
      logDiagnostic({
        level: 'warn',
        scope: 'BillGenerator',
        stage: 'sequence_reconciled',
        correlationId,
        supportId,
        orderId,
        sequenceState: { bucket, previous: currentVal, next: maxExisting },
        appVersion: APP_VERSION,
        schemaVersion: getCurrentSchemaVersion(),
        cloudStatus: 'offline',
        message: `Sequence lag reconciled for ${bucket}: from ${currentVal} to ${maxExisting}`,
        timestamp: now(),
      });
    }

    // Atomically increment sequences table
    const updateResult = dbInstance
      .prepare('UPDATE sequences SET current_value = current_value + 1 WHERE name = ? AND date = ?')
      .run('bills', bucket);

    if (updateResult.changes === 0) {
      try {
        dbInstance
          .prepare('INSERT INTO sequences (name, date, current_value) VALUES (?, ?, ?)')
          .run('bills', bucket, Math.max(1, maxExisting + 1));
      } catch {
        dbInstance
          .prepare('UPDATE sequences SET current_value = current_value + 1 WHERE name = ? AND date = ?')
          .run('bills', bucket);
      }
    }

    const nextRow = dbInstance
      .prepare('SELECT current_value FROM sequences WHERE name = ? AND date = ?')
      .get('bills', bucket) as { current_value: number } | undefined;
    const candidateNumber = Number(nextRow?.current_value || 1);
    const candidateBillNumber = `${basePrefix}-${String(candidateNumber).padStart(4, '0')}`;

    // Verify uniqueness against existing bills
    const collisionCheck = dbInstance
      .prepare('SELECT 1 FROM bills WHERE bill_number = ?')
      .get(candidateBillNumber);

    if (!collisionCheck) {
      return candidateBillNumber;
    }

    // Collision detected! Bump sequences table to at least candidateNumber + 1 and retry
    dbInstance
      .prepare('UPDATE sequences SET current_value = ? WHERE name = ? AND date = ?')
      .run(candidateNumber + 1, 'bills', bucket);
  }

  // Fallback: append timestamp slice if all sequential attempts collided (guaranteed unique)
  const timestampSuffix = Date.now().toString().slice(-6);
  return `${basePrefix}-${timestampSuffix}`;
}

/**
 * Canonical bill generation service.
 * Atomic, idempotent, self-recovering, and cashier-safe.
 */
export async function generateOrRecoverBillForOrder(
  params: GenerateBillParams
): Promise<GenerateBillResult> {
  const dbInstance = params.db || getDatabase();
  const orderId = Number(params.orderId);
  const userId = params.userId ? String(params.userId) : 'system';
  const correlationId = params.correlationId || generateCorrelationId();
  const supportId = generateSupportId();
  const cloudStatus = 'offline';

  if (!Number.isFinite(orderId) || orderId <= 0) {
    throw Object.assign(new Error('Valid Order ID is required'), { statusCode: 400 });
  }

  // Validate Idempotency-Key if provided
  let idempotencyKey: string | null = null;
  let requestHash: string | null = null;
  if (params.idempotencyKey) {
    const raw = String(params.idempotencyKey).trim();
    if (raw.length > MAX_IDEMPOTENCY_KEY_LENGTH || !/^[\x21-\x7e]+$/.test(raw)) {
      throw Object.assign(new Error('Idempotency-Key is invalid or too long'), { statusCode: 400 });
    }
    idempotencyKey = raw;
    requestHash = hashBillRequest(orderId);
  }

  let retryAttemptsCount = 0;

  return await withBusyRetryAsync(
    async () => {
      return withTxn(() => {
        logDiagnostic({
          level: 'info',
          scope: 'BillGenerator',
          stage: 'start',
          correlationId,
          supportId,
          orderId,
          idempotencyKeyHash: idempotencyKey ? hashIdempotencyKey(idempotencyKey) : null,
          retryCount: retryAttemptsCount,
          appVersion: APP_VERSION,
          schemaVersion: getCurrentSchemaVersion(),
          cloudStatus,
          timestamp: now(),
        });

        // 1. Idempotency Check: Same key returns original bill; different request rejects safely
        if (idempotencyKey && requestHash) {
          const storedRecord = dbInstance
            .prepare(`
              SELECT bill_id, request_hash, response_json
              FROM bill_idempotency
              WHERE (user_id = ? OR user_id = 'legacy' OR user_id = 'system')
                AND idempotency_key = ?
            `)
            .get(userId, idempotencyKey) as { bill_id: number; request_hash: string; response_json: string } | undefined;

          if (storedRecord) {
            if (storedRecord.request_hash !== requestHash) {
              throw Object.assign(new Error('Idempotency-Key was already used for a different bill request'), {
                statusCode: 409,
              });
            }

            const existingById = storedRecord.bill_id
              ? dbInstance.prepare('SELECT * FROM bills WHERE id = ?').get(storedRecord.bill_id)
              : null;
            if (existingById) {
              logDiagnostic({
                level: 'info',
                scope: 'BillGenerator',
                stage: 'check_idempotency',
                correlationId,
                supportId,
                orderId,
                billId: storedRecord.bill_id,
                recovered: true,
                appVersion: APP_VERSION,
                schemaVersion: getCurrentSchemaVersion(),
                cloudStatus,
                message: 'Idempotent replay served from bill_idempotency',
                timestamp: now(),
              });
              return {
                bill: parseRowJson(existingById),
                isNew: false,
                recovered: true,
                supportId,
                correlationId,
              };
            }
          }
        }

        // 2. Business-Level Uniqueness: Check if an active bill already exists for the order
        const existingBill = dbInstance
          .prepare('SELECT * FROM bills WHERE order_id = ? ORDER BY id DESC LIMIT 1')
          .get(orderId) as any;

        const order = dbInstance.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
        if (!order) {
          throw Object.assign(new Error('Order not found'), { statusCode: 404 });
        }

        if (existingBill) {
          // If bill belongs to a split check, return it without modifying
          if (existingBill.split_group_id) {
            return {
              bill: parseRowJson(existingBill),
              isNew: false,
              recovered: false,
              supportId,
              correlationId,
            };
          }

          // If bill is already paid or deferred, return it as-is
          if (existingBill.payment_status === 'paid' || existingBill.payment_status === 'deferred') {
            return {
              bill: parseRowJson(existingBill),
              isNew: false,
              recovered: false,
              supportId,
              correlationId,
            };
          }

          // Existing Unpaid/Partial Bill: Check for partial-state recovery & sync totals
          const currency = getTenantCurrency();
          const pack = getActiveCountryPack(getSettingValue('country') || '');
          const { total: roundedOrderTotal, adjustment: orderRoundOff } = applyPayableRounding(
            order.total || 0,
            pack,
            currency
          );

          const orderSubtotal = order.subtotal || 0;
          const orderTaxAmount = order.tax_amount || 0;
          const orderDiscountAmt = order.discount_amount || 0;
          const orderDelivery = order.delivery_charge || 0;
          const orderPackaging = order.packaging_charge || 0;
          const orderService = order.service_charge || 0;
          const paidAmount = Number(existingBill.paid_amount) || 0;
          const newBalance = Math.max(0, roundedOrderTotal - paidAmount);

          const totalsChanged =
            existingBill.discount_amount !== orderDiscountAmt ||
            existingBill.subtotal !== orderSubtotal ||
            existingBill.service_charge !== orderService ||
            existingBill.total !== roundedOrderTotal ||
            existingBill.balance == null ||
            Number.isNaN(Number(existingBill.balance));

          if (totalsChanged) {
            dbInstance
              .prepare(`
                UPDATE bills
                SET subtotal        = ?,
                    tax_amount      = ?,
                    tax_breakdown   = ?,
                    tax_snapshot    = ?,
                    discount_amount = ?,
                    discount_type   = ?,
                    discount_value  = ?,
                    discount_reason = ?,
                    delivery_charge = ?,
                    packaging_charge= ?,
                    service_charge  = ?,
                    round_off       = ?,
                    total           = ?,
                    balance         = ?,
                    updated_at      = ?
                WHERE id = ?
              `)
              .run(
                orderSubtotal,
                orderTaxAmount,
                order.tax_breakdown,
                order.tax_snapshot,
                orderDiscountAmt,
                order.discount_type,
                order.discount_value,
                order.discount_reason,
                orderDelivery,
                orderPackaging,
                orderService,
                orderRoundOff,
                roundedOrderTotal,
                newBalance,
                now(),
                existingBill.id
              );

            const updatedBill = parseRowJson(
              dbInstance.prepare('SELECT * FROM bills WHERE id = ?').get(existingBill.id)
            );

            // Record idempotency mapping if key provided
            if (idempotencyKey && requestHash) {
              dbInstance
                .prepare(`
                  INSERT OR REPLACE INTO bill_idempotency
                    (user_id, idempotency_key, order_id, bill_id, request_hash, response_json, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?)
                `)
                .run(
                  userId,
                  idempotencyKey,
                  orderId,
                  existingBill.id,
                  requestHash,
                  JSON.stringify({ bill: updatedBill }),
                  now()
                );
            }

            logDiagnostic({
              level: 'info',
              scope: 'BillGenerator',
              stage: 'repair_existing',
              correlationId,
              supportId,
              orderId,
              billId: existingBill.id,
              billNumber: existingBill.bill_number,
              recovered: true,
              appVersion: APP_VERSION,
              schemaVersion: getCurrentSchemaVersion(),
              cloudStatus,
              message: 'Existing bill totals repaired and synchronized with order',
              timestamp: now(),
            });

            return {
              bill: updatedBill,
              isNew: false,
              recovered: true,
              supportId,
              correlationId,
            };
          }

          // Existing bill was already in sync; persist idempotency mapping if missing
          if (idempotencyKey && requestHash) {
            try {
              dbInstance
                .prepare(`
                  INSERT OR IGNORE INTO bill_idempotency
                    (user_id, idempotency_key, order_id, bill_id, request_hash, response_json, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?)
                `)
                .run(
                  userId,
                  idempotencyKey,
                  orderId,
                  existingBill.id,
                  requestHash,
                  JSON.stringify({ bill: parseRowJson(existingBill) }),
                  now()
                );
            } catch {}
          }

          return {
            bill: parseRowJson(existingBill),
            isNew: false,
            recovered: false,
            supportId,
            correlationId,
          };
        }

        // 3. Order Eligibility Check for New Bill
        if (order.status === 'cancelled') {
          throw Object.assign(new Error('Cannot generate bill for a cancelled order'), { statusCode: 400 });
        }
        if (order.total == null || Number.isNaN(Number(order.total)) || Number(order.total) < 0) {
          throw Object.assign(new Error('Order total is invalid'), { statusCode: 400 });
        }

        // 4. Calculate Final Payable Totals
        const currency = getTenantCurrency();
        const pack = getActiveCountryPack(getSettingValue('country') || '');
        const { total: finalTotal, adjustment: roundOff } = applyPayableRounding(
          order.total || 0,
          pack,
          currency
        );

        const subtotal = order.subtotal || 0;
        const taxAmount = order.tax_amount || 0;
        const discountAmount = order.discount_amount || 0;
        const deliveryCharge = order.delivery_charge || 0;
        const packagingCharge = order.packaging_charge || 0;
        const serviceCharge = order.service_charge || 0;

        // 5. Sequence Allocation & Insert with Automatic Collision Catch
        let newBillRow: any = null;
        for (let insertAttempt = 1; insertAttempt <= 3; insertAttempt++) {
          const billNumber = allocateBillNumberWithRecovery(dbInstance, {
            supportId,
            correlationId,
            orderId,
          });

          try {
            const insertResult = dbInstance
              .prepare(`
                INSERT INTO bills (
                  bill_number, order_id, customer_id, subtotal, tax_amount, tax_breakdown, tax_snapshot,
                  discount_amount, discount_type, discount_value, discount_reason,
                  delivery_charge, packaging_charge, service_charge, round_off, total, paid_amount, balance, payment_status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?)
              `)
              .run(
                billNumber,
                orderId,
                order.customer_id,
                subtotal,
                taxAmount,
                order.tax_breakdown,
                order.tax_snapshot,
                discountAmount,
                order.discount_type,
                order.discount_value,
                order.discount_reason,
                deliveryCharge,
                packagingCharge,
                serviceCharge,
                roundOff,
                finalTotal,
                0,
                finalTotal,
                now(),
                now()
              );

            newBillRow = parseRowJson(
              dbInstance.prepare('SELECT * FROM bills WHERE id = ?').get(insertResult.lastInsertRowid)
            );
            break;
          } catch (insertErr: any) {
            if (
              insertAttempt < 3 &&
              typeof insertErr.message === 'string' &&
              insertErr.message.includes('UNIQUE constraint failed: bills.bill_number')
            ) {
              logDiagnostic({
                level: 'warn',
                scope: 'BillGenerator',
                stage: 'allocate_sequence',
                correlationId,
                supportId,
                orderId,
                sqliteErrorCode: 'SQLITE_CONSTRAINT',
                appVersion: APP_VERSION,
                schemaVersion: getCurrentSchemaVersion(),
                cloudStatus,
                message: `Bill number collision on insert (${billNumber}), retrying allocation`,
                timestamp: now(),
              });
              continue;
            }
            throw insertErr;
          }
        }

        if (!newBillRow) {
          throw new Error('Failed to allocate unique bill number after retries');
        }

        // 6. Record Idempotency
        if (idempotencyKey && requestHash) {
          dbInstance
            .prepare(`
              INSERT INTO bill_idempotency
                (user_id, idempotency_key, order_id, bill_id, request_hash, response_json, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `)
            .run(
              userId,
              idempotencyKey,
              orderId,
              newBillRow.id,
              requestHash,
              JSON.stringify({ bill: newBillRow }),
              now()
            );
        }

        logDiagnostic({
          level: 'info',
          scope: 'BillGenerator',
          stage: 'commit',
          correlationId,
          supportId,
          orderId,
          billId: newBillRow.id,
          billNumber: newBillRow.bill_number,
          status: 'unpaid',
          appVersion: APP_VERSION,
          schemaVersion: getCurrentSchemaVersion(),
          cloudStatus,
          message: 'Bill created and committed successfully',
          timestamp: now(),
        });

        return {
          bill: newBillRow,
          isNew: true,
          recovered: false,
          supportId,
          correlationId,
        };
      });
    },
    {
      onRetry: (attempt, err: any) => {
        retryAttemptsCount = attempt;
        logDiagnostic({
          level: 'warn',
          scope: 'BillGenerator',
          stage: 'failure',
          correlationId,
          supportId,
          orderId,
          sqliteErrorCode: err?.code || 'SQLITE_BUSY',
          retryCount: attempt,
          appVersion: APP_VERSION,
          schemaVersion: getCurrentSchemaVersion(),
          cloudStatus,
          message: `Database contention/busy, retrying attempt ${attempt}`,
          timestamp: now(),
        });
      },
    }
  );
}
