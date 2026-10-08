import { Router } from 'express';
import { getDatabase } from '../db';
import { requirePermission } from '../services/authorization';
import { DeliveryService, DeliveryProvider, DeliveryStatus } from '../services/delivery-adapter';

export const deliveryRoutes = Router();

// Connectors health & config
deliveryRoutes.get('/connectors', requirePermission('settings.view'), (req, res) => {
  try {
    const connectors = DeliveryService.getAllConnectors();
    res.json({ connectors });
  } catch (error: any) {
    console.error('[API] Error listing delivery connectors:', error);
    res.status(500).json({ error: 'Failed to list connectors' });
  }
});

// List delivery orders
deliveryRoutes.get('/orders', requirePermission('orders.read'), (req, res) => {
  try {
    const db = getDatabase();
    const { status, provider } = req.query;
    const where: string[] = [];
    const params: any[] = [];

    if (status) {
      where.push('status = ?');
      params.push(String(status));
    }
    if (provider) {
      where.push('provider = ?');
      params.push(String(provider));
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const orders = db.prepare(`
      SELECT * FROM delivery_orders
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT 100
    `).all(...params);

    res.json({ orders });
  } catch (error: any) {
    console.error('[API] Error listing delivery orders:', error);
    res.status(500).json({ error: 'Failed to list delivery orders' });
  }
});

// Staff accepts delivery order
deliveryRoutes.post('/orders/:id/accept', requirePermission('orders.create'), (req, res) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const actorUserId = user?.id || user?.userId;
    if (!actorUserId) return res.status(401).json({ error: 'User identity required' });

    const result = DeliveryService.acceptDeliveryOrder(db, String(req.params.id), actorUserId);
    res.json(result);
  } catch (error: any) {
    console.error('[API] Error accepting delivery order:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to accept delivery order' });
  }
});

// Update delivery order status
deliveryRoutes.post('/orders/:id/status', requirePermission('orders.status.update'), (req, res) => {
  try {
    const db = getDatabase();
    const { status, notes } = req.body;
    if (!status) return res.status(400).json({ error: 'status is required' });

    const updated = DeliveryService.updateStatus(db, String(req.params.id), status as DeliveryStatus, notes);
    res.json({ order: updated });

  } catch (error: any) {
    console.error('[API] Error updating delivery order status:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to update status' });
  }
});

// Webhook for provider order ingestion
deliveryRoutes.post('/webhook/:provider', (req, res) => {
  try {
    const db = getDatabase();
    const provider = req.params.provider as DeliveryProvider;
    const signature = req.headers['x-signature'] as string || req.headers['x-webhook-signature'] as string;
    const rawPayload = req.body;

    // Validate signature
    const isValid = DeliveryService.verifyWebhookSignature(provider, JSON.stringify(rawPayload), signature);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const providerOrderId = rawPayload.order_id || rawPayload.id || `ext_${Date.now()}`;
    const customerInfo = rawPayload.customer || { name: 'Customer', phone: '0000000000' };
    const deliveryAddress = rawPayload.delivery_address || rawPayload.address;
    const items = rawPayload.items || [];

    const result = DeliveryService.ingestOrder(db, {
      provider,
      providerOrderId: String(providerOrderId),
      customerInfo,
      deliveryAddress,
      items,
      rawPayload,
      signature,
    });

    res.status(result.isDuplicate ? 200 : 201).json({
      success: true,
      duplicate: result.isDuplicate,
      order_id: result.order.id,
    });
  } catch (error: any) {
    console.error('[API] Webhook ingestion error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});
