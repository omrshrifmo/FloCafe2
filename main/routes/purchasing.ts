import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { getDatabase, now, withTxn } from '../db';
import { requirePermission } from '../services/authorization';
import { getTenantCurrency } from '../services/refund';
import { getCurrencyMinorUnitFactor } from '../countries';
import { getOpenSession } from '../services/shift-session-gate';

export const purchasingRoutes = Router();

// ==========================================
// Suppliers CRUD
// ==========================================
purchasingRoutes.get('/suppliers', requirePermission('purchasing.orders.view'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const suppliers = db.prepare('SELECT * FROM suppliers ORDER BY is_active DESC, name ASC').all();
    res.json({ suppliers });
  } catch (error: any) {
    console.error('[Purchasing] Error listing suppliers:', error);
    res.status(500).json({ error: error.message || 'Failed to list suppliers' });
  }
});

purchasingRoutes.post('/suppliers', requirePermission('purchasing.orders.manage'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { name, contact_person, phone, email, category, payment_terms, lead_time_days } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Supplier name is required' });
    }
    const id = randomUUID();
    const timestamp = now();
    db.prepare(`
      INSERT INTO suppliers (
        id, name, contact_person, phone, email, category, payment_terms, lead_time_days, balance_due, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
    `).run(
      id,
      name.trim(),
      contact_person ? String(contact_person).trim() : null,
      phone ? String(phone).trim() : null,
      email ? String(email).trim() : null,
      category ? String(category).trim() : null,
      payment_terms ? String(payment_terms).trim() : 'COD',
      Number.isInteger(Number(lead_time_days)) ? Number(lead_time_days) : 1,
      timestamp,
      timestamp,
    );

    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
    res.status(201).json({ supplier });
  } catch (error: any) {
    console.error('[Purchasing] Error creating supplier:', error);
    res.status(500).json({ error: error.message || 'Failed to create supplier' });
  }
});

purchasingRoutes.put('/suppliers/:id', requirePermission('purchasing.orders.manage'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { id } = req.params;
    const { name, contact_person, phone, email, category, payment_terms, lead_time_days, is_active } = req.body;
    const existing = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Supplier not found' });

    const timestamp = now();
    db.prepare(`
      UPDATE suppliers SET
        name = COALESCE(?, name),
        contact_person = COALESCE(?, contact_person),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        category = COALESCE(?, category),
        payment_terms = COALESCE(?, payment_terms),
        lead_time_days = COALESCE(?, lead_time_days),
        is_active = COALESCE(?, is_active),
        updated_at = ?
      WHERE id = ?
    `).run(
      name ? String(name).trim() : null,
      contact_person !== undefined ? contact_person : null,
      phone !== undefined ? phone : null,
      email !== undefined ? email : null,
      category !== undefined ? category : null,
      payment_terms !== undefined ? payment_terms : null,
      lead_time_days !== undefined ? Number(lead_time_days) : null,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      timestamp,
      id,
    );

    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
    res.json({ supplier });
  } catch (error: any) {
    console.error('[Purchasing] Error updating supplier:', error);
    res.status(500).json({ error: error.message || 'Failed to update supplier' });
  }
});

purchasingRoutes.delete('/suppliers/:id', requirePermission('purchasing.orders.manage'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { id } = req.params;
    db.prepare('UPDATE suppliers SET is_active = 0, updated_at = ? WHERE id = ?').run(now(), id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[Purchasing] Error deleting supplier:', error);
    res.status(500).json({ error: error.message || 'Failed to delete supplier' });
  }
});

// ==========================================
// Purchase Orders & GRN Receiving
// ==========================================
purchasingRoutes.get('/purchase-orders', requirePermission('purchasing.orders.view'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { supplier_id, status } = req.query;
    let query = `
      SELECT po.*, s.name as supplier_name, s.phone as supplier_phone
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      WHERE 1=1
    `;
    const params: any[] = [];
    if (supplier_id) {
      query += ' AND po.supplier_id = ?';
      params.push(supplier_id);
    }
    if (status) {
      query += ' AND po.status = ?';
      params.push(status);
    }
    query += ' ORDER BY po.created_at DESC LIMIT 200';
    const orders = db.prepare(query).all(...params) as any[];

    const getItems = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?');
    const enriched = orders.map((o) => ({
      ...o,
      items: getItems.all(o.id),
    }));

    res.json({ purchase_orders: enriched });
  } catch (error: any) {
    console.error('[Purchasing] Error listing purchase orders:', error);
    res.status(500).json({ error: error.message || 'Failed to list purchase orders' });
  }
});

purchasingRoutes.get('/purchase-orders/:id', requirePermission('purchasing.orders.view'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const po = db.prepare(`
      SELECT po.*, s.name as supplier_name, s.phone as supplier_phone, s.payment_terms
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.id = ?
    `).get(req.params.id) as any;
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });

    po.items = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(po.id);
    res.json({ purchase_order: po });
  } catch (error: any) {
    console.error('[Purchasing] Error fetching purchase order:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch purchase order' });
  }
});

purchasingRoutes.post('/purchase-orders', requirePermission('purchasing.orders.manage'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const actorId = user?.id || user?.userId || 'system';
    const { supplier_id, expected_date, notes, items, tax_amount = 0, shipping_cost = 0, status = 'ordered' } = req.body;

    if (!supplier_id) return res.status(400).json({ error: 'supplier_id is required' });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one line item is required' });
    }

    const supplier = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(supplier_id);
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });

    const result = withTxn(() => {
      const poId = randomUUID();
      const poNumber = `PO-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`;
      const timestamp = now();

      let subtotal = 0;
      const insertItem = db.prepare(`
        INSERT INTO purchase_order_items (
          id, purchase_order_id, target_type, target_id, item_name, unit, ordered_qty, received_qty, unit_cost, line_total, batch_lot_number, expiry_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
      `);

      for (const item of items) {
        const itemId = randomUUID();
        const targetType = item.target_type === 'supply' ? 'supply' : 'inventory';
        const targetId = String(item.target_id || '').trim();
        const itemName = String(item.item_name || '').trim();
        const unit = String(item.unit || 'each').trim();
        const orderedQty = Math.max(0, Number(item.ordered_qty) || 0);
        const unitCost = Math.max(0, Number(item.unit_cost) || 0);
        const lineTotal = orderedQty * unitCost;
        subtotal += lineTotal;

        insertItem.run(
          itemId, poId, targetType, targetId, itemName, unit, orderedQty, unitCost, lineTotal,
          item.batch_lot_number || null, item.expiry_date || null
        );
      }

      const totalAmount = subtotal + Number(tax_amount || 0) + Number(shipping_cost || 0);

      db.prepare(`
        INSERT INTO purchase_orders (
          id, po_number, supplier_id, status, subtotal, tax_amount, shipping_cost, total_amount, paid_amount, expected_date, notes, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
      `).run(
        poId, poNumber, supplier_id, status, subtotal, Number(tax_amount || 0), Number(shipping_cost || 0), totalAmount,
        expected_date || null, notes || null, actorId, timestamp, timestamp
      );

      return poId;
    });

    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(result) as any;
    po.items = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(result);
    res.status(201).json({ purchase_order: po });
  } catch (error: any) {
    console.error('[Purchasing] Error creating purchase order:', error);
    res.status(500).json({ error: error.message || 'Failed to create purchase order' });
  }
});

// Receive Delivery (GRN) with Weighted-Average Cost Recalculation
purchasingRoutes.post('/purchase-orders/:id/receive', requirePermission('purchasing.orders.manage'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const actorId = user?.id || user?.userId || 'system';
    const poId = req.params.id;
    const { pay_from_drawer, shift_id, received_items } = req.body;

    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(poId) as any;
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    if (po.status === 'received') return res.status(400).json({ error: 'Purchase order already received' });

    withTxn(() => {
      const timestamp = now();
      const items = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(poId) as any[];

      for (const item of items) {
        // Use custom received qty if passed, otherwise default to ordered_qty
        let rQty = item.ordered_qty;
        if (Array.isArray(received_items)) {
          const match = received_items.find((ri: any) => ri.id === item.id);
          if (match && match.received_qty !== undefined) {
            rQty = Math.max(0, Number(match.received_qty));
          }
        }
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
              ) VALUES ('inventory', ?, ?, ?, ?, ?, ?, 'purchase_order', ?, ?)
            `).run(inv.id, rQty, newTotalQty, inv.unit || item.unit, `GRN Received: PO ${po.po_number}`, actorId, po.id, timestamp);
          }
        } else {
          // target_type === 'supply'
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
              ) VALUES ('supply', ?, ?, ?, ?, ?, ?, 'purchase_order', ?, ?)
            `).run(sup.id, rQty, newTotalQty, sup.base_unit || item.unit, `GRN Received: PO ${po.po_number}`, actorId, po.id, timestamp);
          }
        }
      }

      // Mark PO received
      db.prepare(`
        UPDATE purchase_orders
        SET status = 'received', received_at = ?, received_by = ?, updated_at = ?
        WHERE id = ?
      `).run(timestamp, actorId, timestamp, poId);

      // If paid from drawer, record in cash_movements & cash_drawer_movements
      if (pay_from_drawer) {
        const drawerAmount = Number(po.total_amount);
        const minorFactor = getCurrencyMinorUnitFactor(getTenantCurrency(db));
        const amountCents = Math.round(drawerAmount * minorFactor);
        const effectiveShiftId = shift_id !== undefined && shift_id !== null ? Number(shift_id) : (getOpenSession(db)?.id ?? null);
        let drawerMovementId: number | null = null;

        try {
          const dRes = db.prepare(`
            INSERT INTO cash_drawer_movements (
              business_date, movement_type, amount_cents, reason, created_by, created_at, cash_session_id
            ) VALUES (date('now'), 'pay_out', ?, ?, ?, ?, ?)
          `).run(
            amountCents,
            `Supplier payment for PO ${po.po_number}`,
            actorId,
            timestamp,
            effectiveShiftId,
          );
          drawerMovementId = Number(dRes.lastInsertRowid);
        } catch (err) {
          console.error('[Purchasing] Error inserting cash_drawer_movements:', err);
        }

        const movementId = randomUUID();
        db.prepare(`
          INSERT INTO cash_movements (
            id, session_id, movement_type, category, amount, payment_method, reference_type, reference_id, notes, created_by, created_at, cash_drawer_movement_id
          ) VALUES (?, ?, 'supplier_payment', 'Purchasing', ?, 'cash', 'purchase_order', ?, ?, ?, ?, ?)
        `).run(
          movementId,
          effectiveShiftId ? String(effectiveShiftId) : null,
          drawerAmount,
          po.id,
          `Supplier payment for PO ${po.po_number}`,
          actorId,
          timestamp,
          drawerMovementId,
        );

        db.prepare('UPDATE purchase_orders SET paid_amount = total_amount WHERE id = ?').run(poId);
      }
    });

    const updated = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(poId) as any;
    updated.items = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(poId);
    res.json({ success: true, purchase_order: updated });
  } catch (error: any) {
    console.error('[Purchasing] Error receiving purchase order:', error);
    res.status(500).json({ error: error.message || 'Failed to receive purchase order' });
  }
});

// Auto-restock low inventory items grouped by supplier
purchasingRoutes.post('/purchase-orders/auto-restock-low', requirePermission('purchasing.orders.manage'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const user = (req as any).user;
    const actorId = user?.id || user?.userId || 'system';

    const lowInv = db.prepare(`
      SELECT * FROM inventory_items
      WHERE is_active = 1 AND reorder_level > 0 AND quantity <= reorder_level
    `).all() as any[];

    const lowSup = db.prepare(`
      SELECT * FROM supplies
      WHERE is_active = 1 AND deleted_at IS NULL AND low_stock_threshold > 0 AND COALESCE(stock_quantity, quantity, 0) <= low_stock_threshold
    `).all() as any[];

    if (lowInv.length === 0 && lowSup.length === 0) {
      return res.json({ count: 0, message: 'All items are currently at or above healthy par levels' });
    }

    // Default supplier fallback
    let defaultSupplier = db.prepare('SELECT id FROM suppliers WHERE is_active = 1 LIMIT 1').get() as any;
    if (!defaultSupplier) {
      const sId = randomUUID();
      const t = now();
      db.prepare(`
        INSERT INTO suppliers (id, name, contact_person, category, payment_terms, lead_time_days, balance_due, is_active, created_at, updated_at)
        VALUES (?, 'General Wholesale Supplier', 'Main Vendor', 'General', 'COD', 1, 0, 1, ?, ?)
      `).run(sId, t, t);
      defaultSupplier = { id: sId };
    }

    // Group items by supplier_id
    const groups = new Map<string, Array<{ target_type: 'inventory' | 'supply'; target_id: string; item_name: string; unit: string; ordered_qty: number; unit_cost: number }>>();

    for (const item of lowInv) {
      const sId = item.supplier_id || defaultSupplier.id;
      if (!groups.has(sId)) groups.set(sId, []);
      const needed = Math.max(1, (Number(item.reorder_level) * 2) - Number(item.quantity));
      groups.get(sId)!.push({
        target_type: 'inventory',
        target_id: item.id,
        item_name: item.name,
        unit: item.unit || 'each',
        ordered_qty: needed,
        unit_cost: Number(item.cost_per_unit) || 10,
      });
    }

    for (const item of lowSup) {
      const sId = item.supplier_id || defaultSupplier.id;
      if (!groups.has(sId)) groups.set(sId, []);
      const cur = Number(item.stock_quantity ?? item.quantity ?? 0);
      const needed = Math.max(1, (Number(item.low_stock_threshold) * 2) - cur);
      groups.get(sId)!.push({
        target_type: 'supply',
        target_id: item.id,
        item_name: item.name,
        unit: item.base_unit || 'each',
        ordered_qty: needed,
        unit_cost: Number(item.cost_cents || 1000) / 100,
      });
    }

    const createdPoIds: string[] = [];

    withTxn(() => {
      for (const [supplierId, lineItems] of groups.entries()) {
        const poId = randomUUID();
        const poNumber = `PO-AUTO-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`;
        const timestamp = now();
        let subtotal = 0;

        const insertItem = db.prepare(`
          INSERT INTO purchase_order_items (
            id, purchase_order_id, target_type, target_id, item_name, unit, ordered_qty, received_qty, unit_cost, line_total
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        `);

        for (const line of lineItems) {
          const itemId = randomUUID();
          const lineTotal = line.ordered_qty * line.unit_cost;
          subtotal += lineTotal;
          insertItem.run(
            itemId, poId, line.target_type, line.target_id, line.item_name, line.unit, line.ordered_qty, line.unit_cost, lineTotal
          );
        }

        db.prepare(`
          INSERT INTO purchase_orders (
            id, po_number, supplier_id, status, subtotal, tax_amount, shipping_cost, total_amount, paid_amount, notes, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, 'draft', ?, 0, 0, ?, 0, 'Auto-generated restock for low par items', ?, ?, ?)
        `).run(poId, poNumber, supplierId, subtotal, subtotal, actorId, timestamp, timestamp);

        createdPoIds.push(poId);
      }
    });

    res.json({
      success: true,
      count: createdPoIds.length,
      purchase_order_ids: createdPoIds,
      message: `Created ${createdPoIds.length} draft purchase order(s) for low stock restock`,
    });
  } catch (error: any) {
    console.error('[Purchasing] Error in auto-restock:', error);
    res.status(500).json({ error: error.message || 'Auto-restock failed' });
  }
});
