import crypto from 'node:crypto';
import { getDatabase, getSettingValue, now, newId, withTxn } from '../db';
import { requireOpenSessionForOrder } from './shift-session-gate';

function getQrSigningKey(): string {
  const customKey = getSettingValue('qr_signing_key');
  if (customKey && customKey.length >= 16) {
    return customKey;
  }
  // Fallback to a stable store-derived seed
  const storeName = getSettingValue('store_name') || 'flocafe_default_seed';
  return crypto.createHash('sha256').update(storeName + '_qr_seed').digest('hex');
}

export function generateSignedTableToken(tableId: string, validHours = 24): { token: string; expiresAt: string } {
  const expires = new Date(Date.now() + validHours * 3600 * 1000).toISOString();
  const payload = `${tableId}|${expires}`;
  const sig = crypto.createHmac('sha256', getQrSigningKey()).update(payload).digest('hex');
  const token = Buffer.from(`${payload}|${sig}`).toString('base64url');
  return { token, expiresAt: expires };
}

export function verifySignedTableToken(token: string): { valid: boolean; tableId?: string; error?: string } {
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const parts = raw.split('|');
    if (parts.length < 3) return { valid: false, error: 'Malformed token' };

    const [tableId, expiresIso, sig] = parts;
    const payload = `${tableId}|${expiresIso}`;
    const expectedSig = crypto.createHmac('sha256', getQrSigningKey()).update(payload).digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'))) {
      return { valid: false, error: 'Invalid signature' };
    }

    if (new Date(expiresIso).getTime() < Date.now()) {
      return { valid: false, error: 'Token expired' };
    }

    // Verify table exists in db
    const db = getDatabase();
    const table = db.prepare('SELECT id FROM tables WHERE id = ?').get(tableId);
    if (!table) return { valid: false, error: 'Table not found' };

    return { valid: true, tableId };
  } catch (err: any) {
    return { valid: false, error: err.message || 'Verification failed' };
  }
}


export function submitCustomerQrOrder(
  db: ReturnType<typeof getDatabase>,
  input: {
    tableId: string;
    token: string;
    customerName?: string;
    customerPhone?: string;
    items: Array<{ productId: string; name: string; quantity: number; unitPrice: number; notes?: string }>;
  }
) {
  const tokenVerification = verifySignedTableToken(input.token);
  if (!tokenVerification.valid || tokenVerification.tableId !== input.tableId) {
    throw Object.assign(new Error(tokenVerification.error || 'Invalid or mismatched table token'), { statusCode: 403 });
  }

  if (!input.items || input.items.length === 0) {
    throw Object.assign(new Error('Cart cannot be empty'), { statusCode: 400 });
  }

  const id = newId('cqo');
  const timestamp = now();
  const expiresAt = new Date(Date.now() + 2 * 3600 * 1000).toISOString(); // 2 hours
  const totalAmount = input.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);

  db.prepare(`
    INSERT INTO customer_qr_orders (
      id, table_id, status, customer_name, customer_phone, items_json,
      total_amount, session_token, created_at, reviewed_by, order_id, expires_at
    ) VALUES (?, ?, 'submitted_by_customer', ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
  `).run(
    id,
    input.tableId,
    input.customerName || null,
    input.customerPhone || null,
    JSON.stringify(input.items),
    totalAmount,
    input.token,
    timestamp,
    expiresAt
  );

  return db.prepare('SELECT * FROM customer_qr_orders WHERE id = ?').get(id);
}

export function confirmCustomerQrOrder(
  db: ReturnType<typeof getDatabase>,
  qrOrderId: string,
  reviewerUserId: string
) {
  return withTxn(() => {
    // Open-shift check for the staff confirming the order
    requireOpenSessionForOrder(db);


    const qrOrder = db.prepare('SELECT * FROM customer_qr_orders WHERE id = ?').get(qrOrderId) as any;
    if (!qrOrder) throw Object.assign(new Error('QR order not found'), { statusCode: 404 });
    if (qrOrder.status !== 'submitted_by_customer' && qrOrder.status !== 'awaiting_staff_confirmation') {
      throw Object.assign(new Error(`Order is not pending confirmation (status: ${qrOrder.status})`), { statusCode: 400 });
    }

    const items = JSON.parse(qrOrder.items_json);
    const orderNumber = `QR-${Date.now().toString().slice(-6)}`;
    const timestamp = now();

    // Create real FloCafe order
    const orderResult = db.prepare(`
      INSERT INTO orders (order_number, table_id, user_id, type, special_instructions, status, created_at, updated_at)
      VALUES (?, ?, ?, 'dine_in', ?, 'pending', ?, ?)
    `).run(
      orderNumber,
      qrOrder.table_id,
      reviewerUserId,
      `QR Order confirmed by staff (Customer: ${qrOrder.customer_name || 'Guest'})`,
      timestamp,
      timestamp
    );

    const orderId = String(orderResult.lastInsertRowid);

    // Insert order items
    for (const item of items) {
      db.prepare(`
        INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal, total, status, special_instructions, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
      `).run(
        orderId,
        item.productId,
        item.name || 'QR Item',
        item.unitPrice,
        item.quantity,
        item.unitPrice * item.quantity,
        item.unitPrice * item.quantity,
        item.notes || null,
        timestamp,
        timestamp
      );
    }


    // Update customer QR order status
    db.prepare(`
      UPDATE customer_qr_orders
      SET status = 'accepted', reviewed_by = ?, order_id = ?
      WHERE id = ?
    `).run(reviewerUserId, orderId, qrOrderId);

    return { qrOrderId, orderId, status: 'accepted' };
  });
}

export function rejectCustomerQrOrder(
  db: ReturnType<typeof getDatabase>,
  qrOrderId: string,
  reviewerUserId: string,
  reason?: string
) {
  const qrOrder = db.prepare('SELECT * FROM customer_qr_orders WHERE id = ?').get(qrOrderId) as any;
  if (!qrOrder) throw Object.assign(new Error('QR order not found'), { statusCode: 404 });

  db.prepare(`
    UPDATE customer_qr_orders
    SET status = 'rejected', reviewed_by = ?
    WHERE id = ?
  `).run(reviewerUserId, qrOrderId);

  return { qrOrderId, status: 'rejected', reason };
}

// Customer Waiter Assistance Requests
export function createCustomerWaiterRequest(
  db: ReturnType<typeof getDatabase>,
  input: { tableId: string; requestType: string; notes?: string }
) {
  const id = newId('cwr');
  const timestamp = now();

  db.prepare(`
    INSERT INTO customer_waiter_requests (id, table_id, request_type, status, notes, created_at)
    VALUES (?, ?, ?, 'pending', ?, ?)
  `).run(id, input.tableId, input.requestType, input.notes || null, timestamp);

  return db.prepare('SELECT * FROM customer_waiter_requests WHERE id = ?').get(id);
}

export function acknowledgeCustomerWaiterRequest(
  db: ReturnType<typeof getDatabase>,
  requestId: string,
  staffUserId: string
) {
  const timestamp = now();
  db.prepare(`
    UPDATE customer_waiter_requests
    SET status = 'acknowledged', acknowledged_by = ?, resolved_at = ?
    WHERE id = ?
  `).run(staffUserId, timestamp, requestId);

  return db.prepare('SELECT * FROM customer_waiter_requests WHERE id = ?').get(requestId);
}
