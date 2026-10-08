import crypto from 'node:crypto';
import { getDatabase, getSettingValue, now, newId, withTxn } from '../db';
import { requireOpenSessionForOrder } from './shift-session-gate';

export type DeliveryProvider = 'bosta' | 'marsool' | 'talabat' | 'elmenus' | 'uber_eats' | 'direct_online';

export type DeliveryStatus =
  | 'received'
  | 'awaiting_confirmation'
  | 'accepted'
  | 'rejected'
  | 'preparing'
  | 'ready'
  | 'assigned'
  | 'picked_up'
  | 'delivered'
  | 'cancelled'
  | 'failed'
  | 'refund_required';

export interface IngestDeliveryOrderInput {
  provider: DeliveryProvider;
  providerOrderId: string;
  customerInfo: {
    name: string;
    phone: string;
    email?: string;
  };
  deliveryAddress?: {
    street?: string;
    building?: string;
    floor?: string;
    notes?: string;
    coordinates?: { lat: number; lng: number };
  };
  items: Array<{
    externalProductId?: string;
    productId?: string;
    name: string;
    quantity: number;
    unitPrice: number;
    notes?: string;
  }>;
  rawPayload: any;
  signature?: string;
}

export class DeliveryService {
  /**
   * Check connector configuration and health
   */
  static getConnectorStatus(provider: DeliveryProvider) {
    const enabled = getSettingValue(`delivery_${provider}_enabled`) === '1';
    const hasApiKey = Boolean(getSettingValue(`delivery_${provider}_api_key`));
    const isSandbox = getSettingValue(`delivery_${provider}_sandbox`) !== '0';

    return {
      provider,
      enabled,
      configured: hasApiKey,
      sandbox: isSandbox,
      status: !enabled ? 'disabled' : !hasApiKey ? 'unconfigured' : 'ready',
    };
  }

  static getAllConnectors() {
    const providers: DeliveryProvider[] = ['bosta', 'marsool', 'talabat', 'elmenus', 'uber_eats', 'direct_online'];
    return providers.map((p) => this.getConnectorStatus(p));
  }

  /**
   * Verify provider webhook signature
   */
  static verifyWebhookSignature(provider: DeliveryProvider, payload: string, signature?: string): boolean {
    const webhookSecret = getSettingValue(`delivery_${provider}_webhook_secret`);
    if (!webhookSecret) {
      // If no webhook secret is set in local café, require manual staff confirmation
      return true;
    }
    if (!signature) return false;

    const expected = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  }

  /**
   * Idempotent ingestion of delivery orders
   */
  static ingestOrder(db: ReturnType<typeof getDatabase>, input: IngestDeliveryOrderInput) {
    // 1. Idempotency check: see if (provider, provider_order_id) already ingested
    const existing = db.prepare(`
      SELECT * FROM delivery_orders
      WHERE provider = ? AND provider_order_id = ?
    `).get(input.provider, input.providerOrderId) as any;

    if (existing) {
      return {
        isDuplicate: true,
        order: existing,
      };
    }

    const id = newId('del');
    const timestamp = now();

    db.prepare(`
      INSERT INTO delivery_orders (
        id, provider, provider_order_id, status, customer_info_json,
        delivery_address_json, raw_payload_json, internal_order_id, created_at, updated_at
      ) VALUES (?, ?, ?, 'received', ?, ?, ?, NULL, ?, ?)
    `).run(
      id,
      input.provider,
      input.providerOrderId,
      JSON.stringify(input.customerInfo),
      input.deliveryAddress ? JSON.stringify(input.deliveryAddress) : null,
      JSON.stringify(input.rawPayload),
      timestamp,
      timestamp
    );

    const record = db.prepare('SELECT * FROM delivery_orders WHERE id = ?').get(id);
    return {
      isDuplicate: false,
      order: record,
    };
  }

  /**
   * Staff accepts delivery order and converts to active FloCafe takeaway/delivery order
   */
  static acceptDeliveryOrder(
    db: ReturnType<typeof getDatabase>,
    deliveryOrderId: string,
    actorUserId: string
  ) {
    return withTxn(() => {
      requireOpenSessionForOrder(db);


      const delOrder = db.prepare('SELECT * FROM delivery_orders WHERE id = ?').get(deliveryOrderId) as any;
      if (!delOrder) throw Object.assign(new Error('Delivery order not found'), { statusCode: 404 });
      if (delOrder.status !== 'received' && delOrder.status !== 'awaiting_confirmation') {
        throw Object.assign(new Error(`Cannot accept order with status ${delOrder.status}`), { statusCode: 400 });
      }

      const raw = JSON.parse(delOrder.rawPayload_json || delOrder.raw_payload_json);
      const customer = JSON.parse(delOrder.customer_info_json);
      const items = raw.items || [];

      const orderNumber = `DEL-${Date.now().toString().slice(-6)}`;
      const timestamp = now();

      const orderResult = db.prepare(`
        INSERT INTO orders (order_number, user_id, type, special_instructions, status, created_at, updated_at)
        VALUES (?, ?, 'takeaway', ?, 'pending', ?, ?)
      `).run(
        orderNumber,
        actorUserId,
        `Delivery (${delOrder.provider.toUpperCase()} #${delOrder.provider_order_id}) - Customer: ${customer.name || ''}`,
        timestamp,
        timestamp
      );

      const internalOrderId = String(orderResult.lastInsertRowid);

      for (const item of items) {
        db.prepare(`
          INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal, total, status, special_instructions, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        `).run(
          internalOrderId,
          item.productId || item.externalProductId || 'custom_delivery_item',
          item.name || 'Delivery Item',
          item.unitPrice || 0,
          item.quantity || 1,
          (item.unitPrice || 0) * (item.quantity || 1),
          (item.unitPrice || 0) * (item.quantity || 1),
          item.notes || null,
          timestamp,
          timestamp
        );
      }


      db.prepare(`
        UPDATE delivery_orders
        SET status = 'accepted', internal_order_id = ?, updated_at = ?
        WHERE id = ?
      `).run(internalOrderId, timestamp, deliveryOrderId);

      return {
        deliveryOrderId,
        internalOrderId,
        status: 'accepted',
      };
    });
  }

  /**
   * Update delivery order status
   */
  static updateStatus(
    db: ReturnType<typeof getDatabase>,
    deliveryOrderId: string,
    newStatus: DeliveryStatus,
    notes?: string
  ) {
    const timestamp = now();
    db.prepare(`
      UPDATE delivery_orders
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(newStatus, timestamp, deliveryOrderId);

    return db.prepare('SELECT * FROM delivery_orders WHERE id = ?').get(deliveryOrderId);
  }
}
