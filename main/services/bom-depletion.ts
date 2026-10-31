interface DepletionParams {
  productId: string;
  quantity: number;
  orderId: string | number;
  orderNumber?: string | null;
  actorUserId?: string | null;
  createdAt?: string;
}

interface RestoreParams extends DepletionParams {
  waste?: boolean;
}

export function depleteBomForOrderItem(db: any, params: DepletionParams): boolean {
  try {
    const { productId, quantity, orderId, orderNumber, actorUserId = 'system', createdAt = new Date().toISOString() } = params;
    const header = db.prepare('SELECT id, yield_portions FROM bom_headers WHERE product_id = ?').get(productId) as any;
    if (!header) return false;

    const components = db.prepare('SELECT * FROM bom_components WHERE bom_id = ?').all(header.id) as any[];
    if (!components || components.length === 0) return false;

    const portions = Math.max(0.1, Number(header.yield_portions || 1));
    const reason = `POS Order #${orderNumber || String(orderId).slice(0, 8)}`;

    for (const comp of components) {
      const net = Number(comp.net_quantity) || 0;
      const waste = Math.min(99, Math.max(0, Number(comp.waste_pct) || 0));
      const grossPerPortion = net / (1 - waste / 100);
      const totalDeplete = (grossPerPortion / portions) * quantity;

      if (comp.target_type === 'inventory') {
        db.prepare('UPDATE inventory_items SET quantity = quantity - ?, updated_at = ? WHERE id = ?')
          .run(totalDeplete, createdAt, comp.target_id);

        const after = db.prepare('SELECT quantity, unit FROM inventory_items WHERE id = ?').get(comp.target_id) as any;
        db.prepare(`
          INSERT INTO stock_logs (
            target_type, target_id, quantity_delta, stock_after, unit,
            reason, reference_type, reference_id, actor_user_id, created_at
          ) VALUES ('inventory', ?, ?, ?, ?, ?, 'order', ?, ?, ?)
        `).run(
          comp.target_id, -totalDeplete, Number(after?.quantity || 0), after?.unit || comp.unit || 'g',
          reason, String(orderId), actorUserId, createdAt
        );
      } else {
        db.prepare(`
          UPDATE supplies
          SET stock_quantity = stock_quantity - ?,
              quantity = COALESCE(quantity, stock_quantity) - ?,
              updated_at = ?
          WHERE id = ?
        `).run(totalDeplete, totalDeplete, createdAt, comp.target_id);

        const after = db.prepare('SELECT stock_quantity, base_unit FROM supplies WHERE id = ?').get(comp.target_id) as any;
        db.prepare(`
          INSERT INTO stock_logs (
            target_type, target_id, quantity_delta, stock_after, unit,
            reason, reference_type, reference_id, actor_user_id, created_at
          ) VALUES ('supply', ?, ?, ?, ?, ?, 'order', ?, ?, ?)
        `).run(
          comp.target_id, -totalDeplete, Number(after?.stock_quantity || 0), after?.base_unit || comp.unit || 'each',
          reason, String(orderId), actorUserId, createdAt
        );
      }
    }

    return true;
  } catch (error) {
    console.error('[BOM Depletion] Error depleting BOM for order item:', error);
    return false;
  }
}

export function restoreBomForOrderItem(db: any, params: RestoreParams): boolean {
  try {
    const { productId, quantity, orderId, orderNumber, actorUserId = 'system', createdAt = new Date().toISOString(), waste = false } = params;
    if (waste) return false;

    const header = db.prepare('SELECT id, yield_portions FROM bom_headers WHERE product_id = ?').get(productId) as any;
    if (!header) return false;

    const components = db.prepare('SELECT * FROM bom_components WHERE bom_id = ?').all(header.id) as any[];
    if (!components || components.length === 0) return false;

    const portions = Math.max(0.1, Number(header.yield_portions || 1));
    const reason = `Refund restore for POS Order #${orderNumber || String(orderId).slice(0, 8)}`;

    for (const comp of components) {
      const net = Number(comp.net_quantity) || 0;
      const wastePct = Math.min(99, Math.max(0, Number(comp.waste_pct) || 0));
      const grossPerPortion = net / (1 - wastePct / 100);
      const totalRestore = (grossPerPortion / portions) * quantity;

      if (comp.target_type === 'inventory') {
        db.prepare('UPDATE inventory_items SET quantity = quantity + ?, updated_at = ? WHERE id = ?')
          .run(totalRestore, createdAt, comp.target_id);

        const after = db.prepare('SELECT quantity, unit FROM inventory_items WHERE id = ?').get(comp.target_id) as any;
        db.prepare(`
          INSERT INTO stock_logs (
            target_type, target_id, quantity_delta, stock_after, unit,
            reason, reference_type, reference_id, actor_user_id, created_at
          ) VALUES ('inventory', ?, ?, ?, ?, ?, 'refund', ?, ?, ?)
        `).run(
          comp.target_id, totalRestore, Number(after?.quantity || 0), after?.unit || comp.unit || 'g',
          reason, String(orderId), actorUserId, createdAt
        );
      } else {
        db.prepare(`
          UPDATE supplies
          SET stock_quantity = stock_quantity + ?,
              quantity = COALESCE(quantity, stock_quantity) + ?,
              updated_at = ?
          WHERE id = ?
        `).run(totalRestore, totalRestore, createdAt, comp.target_id);

        const after = db.prepare('SELECT stock_quantity, base_unit FROM supplies WHERE id = ?').get(comp.target_id) as any;
        db.prepare(`
          INSERT INTO stock_logs (
            target_type, target_id, quantity_delta, stock_after, unit,
            reason, reference_type, reference_id, actor_user_id, created_at
          ) VALUES ('supply', ?, ?, ?, ?, ?, 'refund', ?, ?, ?)
        `).run(
          comp.target_id, totalRestore, Number(after?.stock_quantity || 0), after?.base_unit || comp.unit || 'each',
          reason, String(orderId), actorUserId, createdAt
        );
      }
    }

    return true;
  } catch (error) {
    console.error('[BOM Restore] Error restoring BOM for order item:', error);
    return false;
  }
}
