import { Router } from 'express';
import expressRateLimit from 'express-rate-limit';
import { getDatabase } from '../db';
import { requirePermission } from '../services/authorization';
import {
  generateSignedTableToken,
  verifySignedTableToken,
  submitCustomerQrOrder,
  confirmCustomerQrOrder,
  rejectCustomerQrOrder,
  createCustomerWaiterRequest,
  acknowledgeCustomerWaiterRequest,
} from '../services/customer-qr';

export const customerQrRoutes = Router();

const publicRateLimit = expressRateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// --- Public Endpoints ---

// Verify signed table token
customerQrRoutes.get('/verify-token', publicRateLimit, (req, res) => {
  const token = String(req.query.token || '');
  const result = verifySignedTableToken(token);
  if (!result.valid) {
    return res.status(403).json({ error: result.error || 'Invalid or expired QR token' });
  }

  const db = getDatabase();
  const table = db.prepare('SELECT id, number, section FROM tables WHERE id = ?').get(result.tableId);

  res.json({ valid: true, table });
});

// Customer submits QR order
customerQrRoutes.post('/submit', publicRateLimit, (req, res) => {
  try {
    const db = getDatabase();
    const { table_id, token, customer_name, customer_phone, items } = req.body;

    if (!table_id || !token || !Array.isArray(items)) {
      return res.status(400).json({ error: 'table_id, token, and items array are required' });
    }

    const order = submitCustomerQrOrder(db, {
      tableId: String(table_id),
      token: String(token),
      customerName: customer_name ? String(customer_name).trim() : undefined,
      customerPhone: customer_phone ? String(customer_phone).trim() : undefined,
      items,
    });

    res.status(201).json({
      success: true,
      order,
      message_ar: 'تم إرسال طلبك بنجاح وبانتظار تأكيد النادل عند الطاولة',
      message_en: 'Your order has been submitted and is awaiting staff confirmation at your table',
    });
  } catch (error: any) {
    console.error('[API] Error submitting customer QR order:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to submit order' });
  }
});

// Customer calls waiter or requests bill/water
customerQrRoutes.post('/call-waiter', publicRateLimit, (req, res) => {
  try {
    const db = getDatabase();
    const { table_id, token, request_type, notes } = req.body;

    const tokenVerification = verifySignedTableToken(String(token));
    if (!tokenVerification.valid || tokenVerification.tableId !== table_id) {
      return res.status(403).json({ error: 'Invalid table token' });
    }

    const request = createCustomerWaiterRequest(db, {
      tableId: String(table_id),
      requestType: request_type || 'call_waiter',
      notes: notes ? String(notes) : undefined,
    });

    res.status(201).json({
      success: true,
      request,
      message_ar: 'تم إشعار النادل بنجاح',
      message_en: 'Staff have been notified',
    });
  } catch (error: any) {
    console.error('[API] Error calling waiter:', error);
    res.status(500).json({ error: 'Failed to notify staff' });
  }
});

// --- Staff Endpoints ---

// Generate signed QR token for table
customerQrRoutes.post('/generate-token', requirePermission('tables.view'), (req, res) => {
  try {
    const { table_id, valid_hours } = req.body;
    if (!table_id) return res.status(400).json({ error: 'table_id required' });

    const result = generateSignedTableToken(String(table_id), valid_hours ? Number(valid_hours) : 24);
    res.json(result);
  } catch (error: any) {
    console.error('[API] Error generating QR token:', error);
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

// List pending customer QR orders
customerQrRoutes.get('/pending', (req, res) => {
  try {
    const db = getDatabase();
    const orders = db.prepare(`
      SELECT cqo.*, t.number as table_name, t.section as table_section
      FROM customer_qr_orders cqo

      JOIN tables t ON t.id = cqo.table_id
      WHERE cqo.status IN ('submitted_by_customer', 'awaiting_staff_confirmation')
      ORDER BY cqo.created_at ASC
    `).all();
    res.json({ orders });
  } catch (error: any) {
    console.error('[API] Error listing pending QR orders:', error);
    res.status(500).json({ error: 'Failed to list pending orders' });
  }
});

// Staff confirms order at table
customerQrRoutes.post('/orders/:id/confirm', (req, res) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const reviewerUserId = user?.id || user?.userId;
    if (!reviewerUserId) return res.status(401).json({ error: 'User identity required' });

    const result = confirmCustomerQrOrder(db, req.params.id, reviewerUserId);
    res.json(result);
  } catch (error: any) {
    console.error('[API] Error confirming customer QR order:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to confirm order' });
  }
});

// Staff rejects order
customerQrRoutes.post('/orders/:id/reject', (req, res) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const reviewerUserId = user?.id || user?.userId || 'staff';
    const { reason } = req.body;

    const result = rejectCustomerQrOrder(db, req.params.id, reviewerUserId, reason);
    res.json(result);
  } catch (error: any) {
    console.error('[API] Error rejecting customer QR order:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to reject order' });
  }
});

// List pending waiter requests
customerQrRoutes.get('/waiter-requests', (req, res) => {
  try {
    const db = getDatabase();
    const requests = db.prepare(`
      SELECT cwr.*, t.number as table_name, t.section as table_section
      FROM customer_waiter_requests cwr

      JOIN tables t ON t.id = cwr.table_id
      WHERE cwr.status = 'pending'
      ORDER BY cwr.created_at ASC
    `).all();
    res.json({ requests });
  } catch (error: any) {
    console.error('[API] Error listing waiter requests:', error);
    res.status(500).json({ error: 'Failed to list requests' });
  }
});

// Acknowledge waiter request
customerQrRoutes.post('/waiter-requests/:id/acknowledge', (req, res) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const staffUserId = user?.id || user?.userId || 'staff';

    const result = acknowledgeCustomerWaiterRequest(db, req.params.id, staffUserId);
    res.json({ success: true, request: result });
  } catch (error: any) {
    console.error('[API] Error acknowledging waiter request:', error);
    res.status(500).json({ error: 'Failed to acknowledge request' });
  }
});
