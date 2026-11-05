import { randomUUID } from 'crypto';
import { getDatabase, getSettingValue, upsertSettings, now } from '../db';
import * as whatsapp from './whatsapp';
import { parsePhoneE164 } from '../lib/phone';

export interface WinBackCandidate {
  id: string;
  name: string | null;
  phone: string;
  phone_digits: string | null;
  last_order_at: string;
  days_inactive: number;
}

export interface WinBackVoucher {
  id: string;
  customer_id: string;
  customer_phone: string;
  customer_name: string | null;
  voucher_code: string;
  discount_pct: number;
  status: 'sent' | 'redeemed' | 'expired';
  inactive_days: number;
  whatsapp_sent: number;
  sent_at: string;
  expires_at: string;
  redeemed_at: string | null;
  redeemed_order_id: string | null;
}

/**
 * Automatically sends an itemized WhatsApp receipt on order checkout.
 * Guaranteed not to throw or block the checkout transaction.
 */
export async function sendAutoCheckoutReceipt(orderId: string | number): Promise<boolean> {
  try {
    const isAutoReceiptEnabled = getSettingValue('whatsapp_auto_receipt_enabled') === 'true';
    if (!isAutoReceiptEnabled) return false;

    const db = getDatabase();
    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
    if (!order) return false;

    let customerPhone = order.customer_phone;
    let customerName = order.customer_name;
    let customerId = order.customer_id;

    if (order.customer_id) {
      const cust = db.prepare(`SELECT id, name, phone FROM customers WHERE id = ?`).get(order.customer_id) as any;
      if (cust) {
        if (!customerPhone) customerPhone = cust.phone;
        if (!customerName) customerName = cust.name;
      }
    }

    if (!customerPhone) return false;

    const tenantCountry = getSettingValue('country') || '';
    const parsedPhone = parsePhoneE164(customerPhone, tenantCountry);
    if (!parsedPhone) return false;

    const items = db.prepare(`
      SELECT oi.*, p.name as product_name
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ? AND oi.status != 'refunded'
    `).all(order.id) as any[];

    const storeName = getSettingValue('store_name') || 'FloCafe';
    const currency = getSettingValue('currency') || 'EGP';

    // Format item lines
    const itemLines = items.map((it) => {
      const lineTotal = (Number(it.unit_price || it.price || 0) * Number(it.quantity || 1)).toFixed(2);
      return `  • ${it.quantity}x ${it.product_name || it.name || 'Item'} — ${lineTotal} ${currency}`;
    }).join('\n');

    // Customer loyalty stamps count
    let stampProgress = '';
    if (customerId) {
      try {
        const stampRow = db.prepare(`SELECT stamps_count FROM customers WHERE id = ?`).get(customerId) as any;
        if (stampRow?.stamps_count !== undefined) {
          stampProgress = `\n☕ Loyalty Stamp Card: ${stampRow.stamps_count}/10 Stamps`;
        }
      } catch {}
    }

    const receiptBody = [
      `🧾 *${storeName}* — Official Receipt`,
      `Order: #${order.order_number}`,
      `Date: ${order.created_at || new Date().toISOString()}`,
      `Customer: ${customerName || 'Valued Guest'}`,
      `---------------------------------`,
      itemLines,
      `---------------------------------`,
      `Subtotal: ${(Number(order.subtotal || order.total || 0)).toFixed(2)} ${currency}`,
      order.tax_total ? `Tax: ${Number(order.tax_total).toFixed(2)} ${currency}` : null,
      order.discount_total ? `Discount: -${Number(order.discount_total).toFixed(2)} ${currency}` : null,
      `*Total Paid:* ${Number(order.total).toFixed(2)} ${currency}`,
      `Payment Method: ${order.payment_method || 'Cash'}${stampProgress}`,
      `\nThank you for choosing ${storeName}! See you again soon!`,
    ].filter(Boolean).join('\n');

    // Check WhatsApp connection status
    const status = whatsapp.getStatus();
    if (status.state !== 'connected') {
      console.info('[WhatsApp-WinBack] WhatsApp not connected, auto-receipt skipped for order:', order.order_number);
      return false;
    }

    void whatsapp.sendMessage({
      phoneE164: parsedPhone.e164,
      body: receiptBody,
      billId: null,
      customerId: customerId ? Number(customerId) || null : null,
      kind: 'bill_receipt',
      userId: null,
    }).catch((err) => {
      console.warn('[WhatsApp-WinBack] Failed to dispatch async auto-receipt:', err?.message);
    });

    return true;
  } catch (err: any) {
    console.error('[WhatsApp-WinBack] Error in sendAutoCheckoutReceipt:', err?.message);
    return false;
  }
}

/**
 * Finds inactive customers eligible for the 14-day win-back campaign.
 */
export function findWinBackCandidates(inactiveDays?: number): WinBackCandidate[] {
  const db = getDatabase();
  const days = inactiveDays !== undefined ? inactiveDays : Number(getSettingValue('whatsapp_winback_inactive_days') || 14);

  const candidates = db.prepare(`
    SELECT
      c.id,
      c.name,
      c.phone,
      c.phone_digits,
      MAX(o.created_at) as last_order_at,
      CAST((julianday('now') - julianday(MAX(o.created_at))) AS INTEGER) as days_inactive
    FROM customers c
    JOIN orders o ON o.customer_id = c.id
    WHERE c.is_active = 1
      AND c.phone IS NOT NULL AND c.phone != ''
      AND o.status NOT IN ('cancelled', 'voided')
    GROUP BY c.id
    HAVING days_inactive >= ?
      AND c.id NOT IN (
        SELECT customer_id FROM customer_winback_vouchers
        WHERE datetime(sent_at) > datetime('now', '-30 days')
      )
    ORDER BY days_inactive DESC
    LIMIT 200
  `).all(days) as WinBackCandidate[];

  return candidates;
}

/**
 * Runs the 14-Day Win-Back voucher retention engine.
 */
export async function runWinBackCampaign(options?: {
  inactiveDays?: number;
  discountPct?: number;
}): Promise<{
  candidates_count: number;
  vouchers_created: number;
  whatsapp_dispatched: number;
  vouchers: WinBackVoucher[];
}> {
  const db = getDatabase();
  const inactiveDays = options?.inactiveDays !== undefined
    ? options.inactiveDays
    : Number(getSettingValue('whatsapp_winback_inactive_days') || 14);

  const discountPct = options?.discountPct !== undefined
    ? options.discountPct
    : Number(getSettingValue('whatsapp_winback_discount_pct') || 15);

  const template = getSettingValue('whatsapp_winback_template') ||
    'Hi {name}! We miss seeing you at {store}. Enjoy {discount}% OFF your next coffee or meal with code {code} (valid for 7 days)!';

  const storeName = getSettingValue('store_name') || 'FloCafe';
  const tenantCountry = getSettingValue('country') || '';
  const candidates = findWinBackCandidates(inactiveDays);

  const createdVouchers: WinBackVoucher[] = [];
  let dispatchedCount = 0;
  const isConnected = whatsapp.getStatus().state === 'connected';

  for (const cand of candidates) {
    const voucherId = randomUUID();
    const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const voucherCode = `MISSYOU${Math.round(discountPct)}-${randomSuffix}`;

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const sentAt = now();

    const voucherRecord: WinBackVoucher = {
      id: voucherId,
      customer_id: cand.id,
      customer_phone: cand.phone,
      customer_name: cand.name,
      voucher_code: voucherCode,
      discount_pct: discountPct,
      status: 'sent',
      inactive_days: cand.days_inactive,
      whatsapp_sent: 0,
      sent_at: sentAt,
      expires_at: expiresAt,
      redeemed_at: null,
      redeemed_order_id: null,
    };

    // Personalized message
    const message = template
      .replace('{name}', cand.name || 'Friend')
      .replace('{store}', storeName)
      .replace('{discount}', String(discountPct))
      .replace('{code}', voucherCode);

    const parsedPhone = parsePhoneE164(cand.phone, tenantCountry);
    let sentFlag = 0;

    if (isConnected && parsedPhone) {
      try {
        void whatsapp.sendMessage({
          phoneE164: parsedPhone.e164,
          body: message,
          billId: null,
          customerId: Number(cand.id) || null,
          kind: 'auto_followup',
          userId: null,
        }).catch(() => {});
        sentFlag = 1;
        dispatchedCount++;
      } catch (err) {
        console.warn('[WhatsApp-WinBack] Error dispatching message to:', cand.phone, err);
      }
    }

    voucherRecord.whatsapp_sent = sentFlag;

    db.prepare(`
      INSERT INTO customer_winback_vouchers (
        id, customer_id, customer_phone, customer_name, voucher_code,
        discount_pct, status, inactive_days, whatsapp_sent, sent_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      voucherId,
      cand.id,
      cand.phone,
      cand.name || null,
      voucherCode,
      discountPct,
      'sent',
      cand.days_inactive,
      sentFlag,
      sentAt,
      expiresAt
    );

    createdVouchers.push(voucherRecord);
  }

  return {
    candidates_count: candidates.length,
    vouchers_created: createdVouchers.length,
    whatsapp_dispatched: dispatchedCount,
    vouchers: createdVouchers,
  };
}

/**
 * Validates and redeems a win-back voucher code for a POS checkout.
 */
export function redeemWinBackVoucher(voucherCode: string, orderId?: string): {
  valid: boolean;
  discount_pct?: number;
  voucher?: any;
  error?: string;
} {
  const db = getDatabase();
  const code = voucherCode.trim().toUpperCase();

  const voucher = db.prepare(`
    SELECT * FROM customer_winback_vouchers WHERE voucher_code = ?
  `).get(code) as any;

  if (!voucher) {
    return { valid: false, error: 'Voucher code not found' };
  }

  if (voucher.status === 'redeemed') {
    return { valid: false, error: 'Voucher has already been redeemed' };
  }

  const isExpired = new Date(voucher.expires_at).getTime() < Date.now();
  if (isExpired) {
    db.prepare(`UPDATE customer_winback_vouchers SET status = 'expired' WHERE id = ?`).run(voucher.id);
    return { valid: false, error: 'Voucher has expired' };
  }

  const redeemedAt = now();
  db.prepare(`
    UPDATE customer_winback_vouchers
    SET status = 'redeemed', redeemed_at = ?, redeemed_order_id = ?
    WHERE id = ?
  `).run(redeemedAt, orderId || null, voucher.id);

  return {
    valid: true,
    discount_pct: Number(voucher.discount_pct),
    voucher: { ...voucher, status: 'redeemed', redeemed_at: redeemedAt, redeemed_order_id: orderId || null },
  };
}

// Background Cron Job (every 6 hours)
let winbackCronTimer: NodeJS.Timeout | null = null;

export function initWinBackBackgroundJob(): void {
  if (winbackCronTimer) return;

  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  winbackCronTimer = setInterval(() => {
    try {
      const enabled = getSettingValue('whatsapp_winback_enabled') === 'true';
      if (enabled) {
        void runWinBackCampaign().catch((err) => {
          console.warn('[WhatsApp-WinBack] Background cron failed:', err?.message);
        });
      }
    } catch {}
  }, SIX_HOURS_MS);

  // Allow process exit cleanly without holding event loop
  if (winbackCronTimer.unref) winbackCronTimer.unref();
}
