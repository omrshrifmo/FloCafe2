export interface DepletionParams {
  productId: string;
  quantity: number;
  orderId: string | number;
  orderNumber?: string | null;
  actorUserId?: string | null;
  createdAt?: string;
  variantId?: string | null;
  addonIds?: (string | number)[] | null;
  orderItemId?: string | number | null;
}

export interface RestoreParams extends DepletionParams {
  waste?: boolean;
}

export function resolveEffectiveBomComponents(db: any, headerId: string, params: DepletionParams) {
  let activeAddonIds: string[] = (params.addonIds || []).map(String);
  if (params.orderItemId && activeAddonIds.length === 0) {
    try {
      const rows = db.prepare('SELECT addon_id FROM order_item_addons WHERE order_item_id = ?').all(params.orderItemId) as any[];
      activeAddonIds = rows.map((r) => String(r.addon_id));
    } catch {}
  }

  // 1. Base components
  const baseComponents = db.prepare(`
    SELECT * FROM bom_components
    WHERE bom_id = ?
      AND (variant_id IS NULL OR variant_id = '')
      AND (addon_id IS NULL OR addon_id = '')
  `).all(headerId) as any[];

  // 2. Matched variant components
  let variantComponents: any[] = [];
  let portionMultiplier = 1;
  if (params.variantId) {
    variantComponents = db.prepare(`
      SELECT * FROM bom_components
      WHERE bom_id = ? AND variant_id = ?
    `).all(headerId, params.variantId) as any[];

    for (const vc of variantComponents) {
      if (vc.portion_multiplier && Number(vc.portion_multiplier) > 0) {
        portionMultiplier = Number(vc.portion_multiplier);
      }
    }
  }

  // 3. Matched addon components
  let addonComponents: any[] = [];
  if (activeAddonIds.length > 0) {
    const placeholders = activeAddonIds.map(() => '?').join(',');
    addonComponents = db.prepare(`
      SELECT * FROM bom_components
      WHERE bom_id = ? AND addon_id IN (${placeholders})
    `).all(headerId, ...activeAddonIds) as any[];
  }

  // 4. Exclude base components if any matched variant or addon line has replaces_target_id set
  const replacedTargetIds = new Set<string>();
  for (const c of [...variantComponents, ...addonComponents]) {
    if (c.replaces_target_id) {
      replacedTargetIds.add(String(c.replaces_target_id));
    }
  }

  const effectiveComponents: any[] = [];
  for (const base of baseComponents) {
    if (replacedTargetIds.has(String(base.target_id))) {
      continue;
    }
    effectiveComponents.push({
      ...base,
      effective_portion_multiplier: portionMultiplier,
    });
  }

  for (const vc of variantComponents) {
    effectiveComponents.push({
      ...vc,
      effective_portion_multiplier: 1,
    });
  }
  for (const ac of addonComponents) {
    effectiveComponents.push({
      ...ac,
      effective_portion_multiplier: 1,
    });
  }

  return effectiveComponents;
}

export function depleteBomForOrderItem(db: any, params: DepletionParams): boolean {
  try {
    const { productId, quantity, orderId, orderNumber, actorUserId = 'system', createdAt = new Date().toISOString() } = params;
    const header = db.prepare('SELECT id, yield_portions FROM bom_headers WHERE product_id = ?').get(productId) as any;
    if (!header) return false;

    const components = resolveEffectiveBomComponents(db, header.id, params);
    if (!components || components.length === 0) return false;

    const portions = Math.max(0.1, Number(header.yield_portions || 1));
    const reason = `POS Order #${orderNumber || String(orderId).slice(0, 8)}`;

    for (const comp of components) {
      const net = Number(comp.net_quantity) || 0;
      const waste = Math.min(99, Math.max(0, Number(comp.waste_pct) || 0));
      const mult = Number(comp.effective_portion_multiplier || 1);
      const grossPerPortion = (net / (1 - waste / 100)) * mult;
      const totalDeplete = (grossPerPortion / portions) * quantity;

      if (comp.target_type === 'custom') {
        // Standalone Custom Material (No inventory/supply tracking required)
        continue;
      }

      if (comp.target_type === 'inventory') {
        const item = db.prepare('SELECT id, quantity, unit FROM inventory_items WHERE id = ?').get(comp.target_id) as any;
        if (item) {
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
        }
      } else {
        const sup = db.prepare('SELECT id, stock_quantity, base_unit FROM supplies WHERE id = ?').get(comp.target_id) as any;
        if (sup) {
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

    const components = resolveEffectiveBomComponents(db, header.id, params);
    if (!components || components.length === 0) return false;

    const portions = Math.max(0.1, Number(header.yield_portions || 1));
    const reason = `Refund restore for POS Order #${orderNumber || String(orderId).slice(0, 8)}`;

    for (const comp of components) {
      const net = Number(comp.net_quantity) || 0;
      const wastePct = Math.min(99, Math.max(0, Number(comp.waste_pct) || 0));
      const mult = Number(comp.effective_portion_multiplier || 1);
      const grossPerPortion = (net / (1 - wastePct / 100)) * mult;
      const totalRestore = (grossPerPortion / portions) * quantity;

      if (comp.target_type === 'custom') {
        continue;
      }

      if (comp.target_type === 'inventory') {
        const item = db.prepare('SELECT id, quantity, unit FROM inventory_items WHERE id = ?').get(comp.target_id) as any;
        if (item) {
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
        }
      } else {
        const sup = db.prepare('SELECT id, stock_quantity, base_unit FROM supplies WHERE id = ?').get(comp.target_id) as any;
        if (sup) {
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
    }

    return true;
  } catch (error) {
    console.error('[BOM Restore] Error restoring BOM for order item:', error);
    return false;
  }
}
