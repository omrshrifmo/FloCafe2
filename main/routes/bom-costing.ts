import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { getDatabase, now, withTxn } from '../db';
import { requirePermission } from '../services/authorization';

export const bomCostingRoutes = Router();

// GET /bom-costing/products: Lists products with their full BOM costing breakdown
bomCostingRoutes.get('/products', requirePermission('bom.costing.manage'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();

    // 1. Calculate allocated indirect overhead
    // Monthly operating expenses with cost_type = 'indirect'
    const indirectExpRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total_indirect
      FROM operating_expenses
      WHERE cost_type = 'indirect'
    `).get() as { total_indirect: number };
    const totalIndirectMonthly = Number(indirectExpRow?.total_indirect || 0);

    // Estimate monthly units sold from last 30 days completed order items, default to 1000 units minimum
    const unitsRow = db.prepare(`
      SELECT COALESCE(SUM(oi.quantity), 0) as units_sold
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.status != 'cancelled'
        AND oi.status != 'refunded'
        AND o.created_at >= datetime('now', '-30 days')
    `).get() as { units_sold: number };
    const estimatedMonthlyUnits = Math.max(100, Number(unitsRow?.units_sold || 0));
    const baseOverheadPerUnit = totalIndirectMonthly / estimatedMonthlyUnits;

    const products = db.prepare(`
      SELECT p.id, p.name, p.price, p.sku, c.name as category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.deleted_at IS NULL AND p.is_active = 1
      ORDER BY p.name ASC
    `).all() as any[];

    const getHeader = db.prepare('SELECT * FROM bom_headers WHERE product_id = ?');
    const getComponents = db.prepare('SELECT * FROM bom_components WHERE bom_id = ?');

    const result = products.map((prod) => {
      const header = getHeader.get(prod.id) as any || {
        id: null,
        yield_portions: 1,
        prep_time_minutes: 2,
        direct_labor_rate_per_hour: 60,
        target_food_cost_pct: 30,
        indirect_overhead_override: null,
        notes: null,
      };

      const components = header.id ? (getComponents.all(header.id) as any[]) : [];

      let directMaterialCost = 0;
      const enrichedComponents = components.map((comp) => {
        let liveUnitCost = Number(comp.custom_unit_cost || 0);

        if (comp.cost_source === 'manual' && comp.custom_unit_cost !== null && comp.custom_unit_cost !== undefined) {
          liveUnitCost = Number(comp.custom_unit_cost);
        } else if (comp.target_type === 'inventory') {
          const inv = db.prepare('SELECT cost_per_unit FROM inventory_items WHERE id = ?').get(comp.target_id) as any;
          const invCost = Number(inv?.cost_per_unit || 0);
          liveUnitCost = invCost > 0 ? invCost : Number(comp.custom_unit_cost || 0);
        } else if (comp.target_type === 'supply') {
          const sup = db.prepare('SELECT cost_cents FROM supplies WHERE id = ?').get(comp.target_id) as any;
          const supCost = Number(sup?.cost_cents || 0) / 100;
          liveUnitCost = supCost > 0 ? supCost : Number(comp.custom_unit_cost || 0);
        }

        const grossQty = comp.net_quantity / (1 - (comp.waste_pct || 0) / 100);
        const lineCost = grossQty * liveUnitCost;
        directMaterialCost += lineCost;

        return {
          ...comp,
          target_type: (comp.custom_material_name || comp.cost_source === 'manual' || String(comp.target_id).startsWith('custom-')) ? 'custom' : comp.target_type,
          component_name: comp.custom_material_name || comp.component_name,
          unit: comp.custom_unit || comp.unit,
          live_unit_cost: liveUnitCost,
          gross_quantity: grossQty,
          line_cost: lineCost,
        };
      });

      // Direct Prep Labor Cost: (prep_time_minutes / 60) * direct_labor_rate_per_hour
      const directPrepLaborCost = (Number(header.prep_time_minutes || 0) / 60) * Number(header.direct_labor_rate_per_hour || 0);
      const yieldPortions = Math.max(0.1, Number(header.yield_portions || 1));
      const totalDirectCost = (directMaterialCost + directPrepLaborCost) / yieldPortions;

      // Allocated Indirect Overhead Cost
      const allocatedIndirectOverhead = header.indirect_overhead_override !== null && header.indirect_overhead_override !== undefined
        ? Number(header.indirect_overhead_override)
        : baseOverheadPerUnit;

      const fullyLoadedUnitCost = totalDirectCost + allocatedIndirectOverhead;
      const sellingPrice = Number(prod.price) || 0;
      const directFoodCostPct = sellingPrice > 0 ? (totalDirectCost / sellingPrice) * 100 : 0;
      const netContributionMargin = sellingPrice - fullyLoadedUnitCost;
      const netContributionMarginPct = sellingPrice > 0 ? (netContributionMargin / sellingPrice) * 100 : 0;
      const exceedsTarget = directFoodCostPct > Number(header.target_food_cost_pct || 30);

      return {
        product: prod,
        bom_header: header,
        components: enrichedComponents,
        costing: {
          direct_material_cost: directMaterialCost,
          direct_prep_labor_cost: directPrepLaborCost,
          total_direct_cost: totalDirectCost,
          allocated_indirect_overhead: allocatedIndirectOverhead,
          fully_loaded_unit_cost: fullyLoadedUnitCost,
          selling_price: sellingPrice,
          direct_food_cost_pct: directFoodCostPct,
          target_food_cost_pct: Number(header.target_food_cost_pct || 30),
          net_contribution_margin: netContributionMargin,
          net_contribution_margin_pct: netContributionMarginPct,
          exceeds_target: exceedsTarget,
        },
      };
    });

    res.json({ products: result, base_indirect_overhead_per_unit: baseOverheadPerUnit });
  } catch (error: any) {
    console.error('[BOM Costing] Error fetching products costing:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch BOM costing' });
  }
});

// GET /bom-costing/product/:id
bomCostingRoutes.get('/product/:id', requirePermission('bom.costing.manage'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const productId = req.params.id;
    const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as any;
    if (!prod) return res.status(404).json({ error: 'Product not found' });

    const header = db.prepare('SELECT * FROM bom_headers WHERE product_id = ?').get(productId) as any || null;
    const rawComponents = header ? db.prepare('SELECT * FROM bom_components WHERE bom_id = ?').all(header.id) as any[] : [];
    const components = rawComponents.map((c) => ({
      ...c,
      target_type: (c.custom_material_name || c.cost_source === 'manual' || String(c.target_id).startsWith('custom-')) ? 'custom' : c.target_type,
    }));

    res.json({ product: prod, bom_header: header, components });
  } catch (error: any) {
    console.error('[BOM Costing] Error fetching product BOM:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch BOM' });
  }
});

// PUT /bom-costing/product/:id: Save or update full BOM
bomCostingRoutes.put('/product/:id', requirePermission('bom.costing.manage'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const productId = req.params.id;
    const {
      yield_portions = 1,
      prep_time_minutes = 2,
      direct_labor_rate_per_hour = 60,
      target_food_cost_pct = 30,
      indirect_overhead_override = null,
      notes = null,
      components = [],
    } = req.body;

    const prod = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
    if (!prod) return res.status(404).json({ error: 'Product not found' });

    withTxn(() => {
      const timestamp = now();
      let header = db.prepare('SELECT id FROM bom_headers WHERE product_id = ?').get(productId) as any;
      let bomId = header?.id;

      if (!bomId) {
        bomId = randomUUID();
        db.prepare(`
          INSERT INTO bom_headers (
            id, product_id, yield_portions, prep_time_minutes, direct_labor_rate_per_hour, target_food_cost_pct, indirect_overhead_override, notes, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          bomId, productId, Number(yield_portions) || 1, Number(prep_time_minutes) || 0,
          Number(direct_labor_rate_per_hour) || 0, Number(target_food_cost_pct) || 30,
          indirect_overhead_override !== null && indirect_overhead_override !== '' ? Number(indirect_overhead_override) : null,
          notes || null, timestamp
        );
      } else {
        db.prepare(`
          UPDATE bom_headers SET
            yield_portions = ?,
            prep_time_minutes = ?,
            direct_labor_rate_per_hour = ?,
            target_food_cost_pct = ?,
            indirect_overhead_override = ?,
            notes = ?,
            updated_at = ?
          WHERE id = ?
        `).run(
          Number(yield_portions) || 1, Number(prep_time_minutes) || 0,
          Number(direct_labor_rate_per_hour) || 0, Number(target_food_cost_pct) || 30,
          indirect_overhead_override !== null && indirect_overhead_override !== '' ? Number(indirect_overhead_override) : null,
          notes || null, timestamp, bomId
        );
      }

      // Replace components
      db.prepare('DELETE FROM bom_components WHERE bom_id = ?').run(bomId);

      const insertComp = db.prepare(`
        INSERT INTO bom_components (
          id, bom_id, target_type, target_id, component_name, unit, net_quantity, waste_pct, gross_quantity,
          variant_id, addon_id, portion_multiplier, replaces_target_id,
          custom_material_name, custom_unit, custom_unit_cost, cost_source,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const comp of components) {
        const compId = randomUUID();
        const targetType = comp.target_type === 'custom' ? 'custom' : (comp.target_type === 'supply' ? 'supply' : 'inventory');
        const customMatName = comp.custom_material_name || (targetType === 'custom' ? comp.component_name : null);
        const compName = String(customMatName || comp.component_name || 'Material').trim();
        const targetId = String(comp.target_id || (targetType === 'custom' ? `custom-${compId}` : '')).trim();
        const customUnit = comp.custom_unit || comp.unit || 'g';
        const unit = String(comp.unit || customUnit || 'g').trim();
        const netQty = Math.max(0.0001, Number(comp.net_quantity) || 1);
        const wastePct = Math.min(99.9, Math.max(0, Number(comp.waste_pct) || 0));
        const grossQty = netQty / (1 - wastePct / 100);
        const variantId = comp.variant_id ? String(comp.variant_id).trim() : null;
        const addonId = comp.addon_id ? String(comp.addon_id).trim() : null;
        const portionMultiplier = comp.portion_multiplier ? Math.max(0.01, Number(comp.portion_multiplier)) : 1;
        const replacesTargetId = comp.replaces_target_id ? String(comp.replaces_target_id).trim() : null;
        const customUnitCost = Number(comp.custom_unit_cost !== undefined ? comp.custom_unit_cost : (comp.unit_cost || 0));
        const costSource = comp.cost_source || (targetType === 'custom' ? 'manual' : 'auto');

        try {
          insertComp.run(
            compId, bomId, targetType, targetId, compName, unit, netQty, wastePct, grossQty,
            variantId, addonId, portionMultiplier, replacesTargetId,
            customMatName, customUnit, customUnitCost, costSource,
            timestamp, timestamp
          );
        } catch (insertErr: any) {
          if (insertErr?.code === 'SQLITE_CONSTRAINT_CHECK' && targetType === 'custom') {
            // Fallback for existing SQLite databases with legacy CHECK(target_type IN ('inventory', 'supply'))
            insertComp.run(
              compId, bomId, 'supply', targetId, compName, unit, netQty, wastePct, grossQty,
              variantId, addonId, portionMultiplier, replacesTargetId,
              customMatName, customUnit, customUnitCost, costSource,
              timestamp, timestamp
            );
          } else {
            throw insertErr;
          }
        }
      }
    });

    const updatedHeader = db.prepare('SELECT * FROM bom_headers WHERE product_id = ?').get(productId) as any;
    const rawComps = db.prepare('SELECT * FROM bom_components WHERE bom_id = ?').all(updatedHeader.id) as any[];
    updatedHeader.components = rawComps.map((c) => ({
      ...c,
      target_type: (c.custom_material_name || c.cost_source === 'manual' || String(c.target_id).startsWith('custom-')) ? 'custom' : c.target_type,
    }));
    res.json({ success: true, bom: updatedHeader });
  } catch (error: any) {
    console.error('[BOM Costing] Error saving BOM:', error);
    res.status(500).json({ error: error.message || 'Failed to save BOM' });
  }
});

// GET /api/bom-costing/prep-recipes
bomCostingRoutes.get('/prep-recipes', requirePermission('bom.costing.manage'), (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const recipes = db.prepare('SELECT * FROM prep_recipes ORDER BY name ASC').all() as any[];
    const getComponents = db.prepare('SELECT * FROM prep_recipe_components WHERE prep_recipe_id = ?');
    const getLogs = db.prepare('SELECT * FROM prep_production_logs WHERE prep_recipe_id = ? ORDER BY produced_at DESC LIMIT 10');

    const result = recipes.map((r) => ({
      ...r,
      components: getComponents.all(r.id),
      recent_logs: getLogs.all(r.id),
    }));

    res.json({ success: true, prep_recipes: result });
  } catch (error: any) {
    console.error('[Prep Recipes] Error fetching prep recipes:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch prep recipes' });
  }
});

// POST /api/bom-costing/prep-recipes
bomCostingRoutes.post('/prep-recipes', requirePermission('bom.costing.manage'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const {
      name,
      output_target_type = 'inventory',
      output_target_id,
      yield_quantity = 1,
      yield_unit = 'kg',
      prep_time_minutes = 15,
      labor_rate_per_hour = 60,
      shelf_life_hours = 48,
      storage_area = 'Walk-In Chiller',
      notes = null,
      components = [],
    } = req.body;

    if (!name || !output_target_id) {
      return res.status(400).json({ error: 'Recipe name and output target item are required' });
    }

    const recipeId = randomUUID();
    const timestamp = now();

    withTxn(() => {
      db.prepare(`
        INSERT INTO prep_recipes (
          id, name, output_target_type, output_target_id, yield_quantity, yield_unit,
          prep_time_minutes, labor_rate_per_hour, shelf_life_hours, storage_area, notes,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        recipeId, name.trim(), output_target_type, output_target_id,
        Number(yield_quantity) || 1, yield_unit.trim(),
        Number(prep_time_minutes) || 15, Number(labor_rate_per_hour) || 60,
        Number(shelf_life_hours) || 48, storage_area.trim(), notes,
        timestamp, timestamp
      );

      const insertComp = db.prepare(`
        INSERT INTO prep_recipe_components (
          id, prep_recipe_id, target_type, target_id, component_name, unit, net_quantity, waste_pct, gross_quantity
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const comp of components) {
        const compId = randomUUID();
        const netQty = Math.max(0.0001, Number(comp.net_quantity) || 1);
        const wastePct = Math.min(99.9, Math.max(0, Number(comp.waste_pct) || 0));
        const grossQty = netQty / (1 - wastePct / 100);

        insertComp.run(
          compId, recipeId, comp.target_type || 'inventory', String(comp.target_id || '').trim(),
          String(comp.component_name || '').trim(), String(comp.unit || 'g').trim(),
          netQty, wastePct, grossQty
        );
      }
    });

    const created = db.prepare('SELECT * FROM prep_recipes WHERE id = ?').get(recipeId) as any;
    created.components = db.prepare('SELECT * FROM prep_recipe_components WHERE prep_recipe_id = ?').all(recipeId);
    res.status(201).json({ success: true, prep_recipe: created });
  } catch (error: any) {
    console.error('[Prep Recipes] Error creating prep recipe:', error);
    res.status(500).json({ error: error.message || 'Failed to create prep recipe' });
  }
});

// POST /api/bom-costing/prep-recipes/:id/produce
bomCostingRoutes.post('/prep-recipes/:id/produce', requirePermission('bom.costing.manage'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const recipeId = req.params.id;
    const { batches_multiplier = 1, produced_by } = req.body;
    const multiplier = Math.max(0.01, Number(batches_multiplier) || 1);
    const user = (req as any).user;
    const actor = produced_by || user?.name || user?.username || 'Chef';

    const recipe = db.prepare('SELECT * FROM prep_recipes WHERE id = ?').get(recipeId) as any;
    if (!recipe) return res.status(404).json({ error: 'Prep recipe not found' });

    const components = db.prepare('SELECT * FROM prep_recipe_components WHERE prep_recipe_id = ?').all(recipeId) as any[];
    if (components.length === 0) return res.status(400).json({ error: 'Prep recipe has no components' });

    let resultLog: any = null;

    withTxn(() => {
      const timestamp = now();
      const lotNumber = `LOT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
      let totalRawIngredientsCost = 0;

      // 1. Deduct each raw component & log to stock_logs
      for (const comp of components) {
        const deductQty = comp.gross_quantity * multiplier;
        let unitCost = 0;

        if (comp.target_type === 'custom') {
          unitCost = Number(comp.custom_unit_cost || 0);
        } else if (comp.target_type === 'inventory') {
          const inv = db.prepare('SELECT cost_per_unit, quantity, unit FROM inventory_items WHERE id = ?').get(comp.target_id) as any;
          if (inv) {
            unitCost = Number(inv?.cost_per_unit || 0);
            db.prepare('UPDATE inventory_items SET quantity = quantity - ?, updated_at = ? WHERE id = ?')
              .run(deductQty, timestamp, comp.target_id);

            const afterQty = Number(inv?.quantity || 0) - deductQty;
            db.prepare(`
              INSERT INTO stock_logs (
                target_type, target_id, quantity_delta, stock_after, unit,
                reason, reference_type, reference_id, actor_user_id, created_at
              ) VALUES ('inventory', ?, ?, ?, ?, ?, 'prep_batch', ?, ?, ?)
            `).run(
              comp.target_id, -deductQty, afterQty, inv?.unit || comp.unit,
              `Prep Batch: ${lotNumber} (${recipe.name})`, recipeId, actor, timestamp
            );
          } else {
            unitCost = Number(comp.custom_unit_cost || 0);
          }
        } else {
          const sup = db.prepare('SELECT cost_cents, stock_quantity, base_unit FROM supplies WHERE id = ?').get(comp.target_id) as any;
          if (sup) {
            unitCost = Number(sup?.cost_cents || 0) / 100;
            db.prepare(`
              UPDATE supplies
              SET stock_quantity = stock_quantity - ?, quantity = COALESCE(quantity, stock_quantity) - ?, updated_at = ?
              WHERE id = ?
            `).run(deductQty, deductQty, timestamp, comp.target_id);

            const afterQty = Number(sup?.stock_quantity || 0) - deductQty;
            db.prepare(`
              INSERT INTO stock_logs (
                target_type, target_id, quantity_delta, stock_after, unit,
                reason, reference_type, reference_id, actor_user_id, created_at
              ) VALUES ('supply', ?, ?, ?, ?, ?, 'prep_batch', ?, ?, ?)
            `).run(
              comp.target_id, -deductQty, afterQty, sup?.base_unit || comp.unit,
              `Prep Batch: ${lotNumber} (${recipe.name})`, recipeId, actor, timestamp
            );
          } else {
            unitCost = Number(comp.custom_unit_cost || 0);
          }
        }

        totalRawIngredientsCost += deductQty * unitCost;
      }

      // 2. Compute Labor and Total Batch Cost
      const laborCost = (Number(recipe.prep_time_minutes || 0) / 60) * Number(recipe.labor_rate_per_hour || 0) * multiplier;
      const totalBatchCost = totalRawIngredientsCost + laborCost;
      const producedQuantity = Number(recipe.yield_quantity || 1) * multiplier;
      const unitCost = producedQuantity > 0 ? totalBatchCost / producedQuantity : totalBatchCost;

      // 3. Increment output prepared SKU in inventory_items or supplies with weighted-average cost
      const outputInv = db.prepare('SELECT id, quantity, cost_per_unit, unit FROM inventory_items WHERE id = ?').get(recipe.output_target_id) as any;
      if (outputInv) {
        const prevQty = Math.max(0, Number(outputInv.quantity) || 0);
        const prevCost = Math.max(0, Number(outputInv.cost_per_unit) || 0);
        const newTotalQty = prevQty + producedQuantity;
        const newWeightedCost = newTotalQty > 0
          ? (prevQty * prevCost + producedQuantity * unitCost) / newTotalQty
          : unitCost;

        db.prepare('UPDATE inventory_items SET quantity = ?, cost_per_unit = ?, updated_at = ? WHERE id = ?')
          .run(newTotalQty, newWeightedCost, timestamp, recipe.output_target_id);

        db.prepare(`
          INSERT INTO stock_logs (
            target_type, target_id, quantity_delta, stock_after, unit,
            reason, reference_type, reference_id, actor_user_id, created_at
          ) VALUES ('inventory', ?, ?, ?, ?, ?, 'prep_batch_produced', ?, ?, ?)
        `).run(
          recipe.output_target_id, producedQuantity, newTotalQty, outputInv.unit || recipe.yield_unit,
          `Batch Produced: ${lotNumber} (${recipe.name})`, recipeId, actor, timestamp
        );
      } else {
        // Check if output is in supplies
        const outputSup = db.prepare('SELECT id, stock_quantity, cost_cents, base_unit FROM supplies WHERE id = ?').get(recipe.output_target_id) as any;
        if (outputSup) {
          const prevQty = Math.max(0, Number(outputSup.stock_quantity) || 0);
          const prevCost = Math.max(0, Number(outputSup.cost_cents || 0)) / 100;
          const newTotalQty = prevQty + producedQuantity;
          const newWeightedCost = newTotalQty > 0
            ? (prevQty * prevCost + producedQuantity * unitCost) / newTotalQty
            : unitCost;

          db.prepare('UPDATE supplies SET stock_quantity = ?, cost_cents = ?, updated_at = ? WHERE id = ?')
            .run(newTotalQty, Math.round(newWeightedCost * 100), timestamp, recipe.output_target_id);

          db.prepare(`
            INSERT INTO stock_logs (
              target_type, target_id, quantity_delta, stock_after, unit,
              reason, reference_type, reference_id, actor_user_id, created_at
            ) VALUES ('supply', ?, ?, ?, ?, ?, 'prep_batch_produced', ?, ?, ?)
          `).run(
            recipe.output_target_id, producedQuantity, newTotalQty, outputSup.base_unit || recipe.yield_unit,
            `Batch Produced: ${lotNumber} (${recipe.name})`, recipeId, actor, timestamp
          );
        } else {
          // In standalone mode: auto-create the prepared supply item
          const supId = recipe.output_target_id || randomUUID();
          db.prepare(`
            INSERT OR REPLACE INTO supplies (
              id, name, base_unit, stock_quantity, cost_cents, is_active, updated_at
            ) VALUES (?, ?, ?, ?, ?, 1, ?)
          `).run(
            supId, recipe.name, recipe.yield_unit || 'kg',
            producedQuantity, Math.round(unitCost * 100), timestamp
          );

          db.prepare(`
            INSERT INTO stock_logs (
              target_type, target_id, quantity_delta, stock_after, unit,
              reason, reference_type, reference_id, actor_user_id, created_at
            ) VALUES ('supply', ?, ?, ?, ?, ?, 'prep_batch_produced', ?, ?, ?)
          `).run(
            supId, producedQuantity, producedQuantity, recipe.yield_unit || 'kg',
            `Batch Produced: ${lotNumber} (${recipe.name})`, recipeId, actor, timestamp
          );
        }
      }

      // 4. Automatically insert active perishable lot into haccp_batches
      const haccpId = randomUUID();
      const shelfLifeMs = Number(recipe.shelf_life_hours || 48) * 3600 * 1000;
      const expiresAtIso = new Date(Date.now() + shelfLifeMs).toISOString();

      db.prepare(`
        INSERT INTO haccp_batches (
          id, item_name, lot_number, storage_area, prepared_at, expires_at, status, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
      `).run(
        haccpId, recipe.name, lotNumber, recipe.storage_area || 'Walk-In Chiller',
        timestamp, expiresAtIso, actor
      );

      // 5. Insert into prep_production_logs
      const logId = randomUUID();
      db.prepare(`
        INSERT INTO prep_production_logs (
          id, prep_recipe_id, batch_lot_number, batches_multiplier, produced_quantity,
          total_batch_cost, unit_cost, haccp_batch_id, produced_by, produced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        logId, recipeId, lotNumber, multiplier, producedQuantity,
        totalBatchCost, unitCost, haccpId, actor, timestamp
      );

      resultLog = {
        id: logId,
        prep_recipe_id: recipeId,
        recipe_name: recipe.name,
        batch_lot_number: lotNumber,
        batches_multiplier: multiplier,
        produced_quantity: producedQuantity,
        total_batch_cost: totalBatchCost,
        unit_cost: unitCost,
        haccp_batch_id: haccpId,
        expires_at: expiresAtIso,
        produced_by: actor,
        produced_at: timestamp,
      };
    });

    res.status(201).json({ success: true, production_log: resultLog });
  } catch (error: any) {
    console.error('[Prep Production] Error producing batch:', error);
    res.status(500).json({ error: error.message || 'Failed to produce prep batch' });
  }
});

// GET /api/bom/expected-usage-and-profit & /api/bom-costing/expected-usage-and-profit
bomCostingRoutes.get('/expected-usage-and-profit', requirePermission('bom.costing.manage'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { from, to, closure_id } = req.query as { from?: string; to?: string; closure_id?: string };

    let orderQuery = `
      SELECT o.id, o.order_number, o.created_at, o.total, o.subtotal, o.status
      FROM orders o
      WHERE o.status != 'cancelled'
    `;
    const params: any[] = [];

    if (closure_id) {
      const closure = db.prepare('SELECT period_start, period_end, business_date FROM cash_closures WHERE id = ?').get(closure_id) as any;
      if (closure) {
        orderQuery += ` AND o.created_at >= ? AND o.created_at < ?`;
        params.push(closure.period_start, closure.period_end);
      }
    } else {
      if (from) {
        orderQuery += ` AND o.created_at >= ?`;
        params.push(`${from} 00:00:00`);
      }
      if (to) {
        orderQuery += ` AND o.created_at <= ?`;
        params.push(`${to} 23:59:59`);
      }
      if (!from && !to) {
        // Default: today
        const today = new Date().toISOString().slice(0, 10);
        orderQuery += ` AND o.created_at >= ?`;
        params.push(`${today} 00:00:00`);
      }
    }

    const matchedOrders = db.prepare(orderQuery).all(...params) as any[];
    const orderIds = matchedOrders.map((o) => o.id);

    let orderItems: any[] = [];
    if (orderIds.length > 0) {
      const placeholders = orderIds.map(() => '?').join(',');
      orderItems = db.prepare(`
        SELECT oi.*, p.name as product_name, p.price as menu_price, c.name as category_name
        FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE oi.order_id IN (${placeholders})
          AND oi.status != 'refunded'
      `).all(...orderIds) as any[];
    }

    // Cache BOM headers and components
    const getHeader = db.prepare('SELECT * FROM bom_headers WHERE product_id = ?');
    const getComponents = db.prepare('SELECT * FROM bom_components WHERE bom_id = ?');

    let totalItemsSold = 0;
    let expectedRevenue = 0;
    let expectedMaterialsCost = 0;

    const soldMap = new Map<string, any>();
    const materialsMap = new Map<string, any>();

    for (const item of orderItems) {
      const qty = Number(item.quantity) || 1;
      const unitPrice = Number(item.unit_price !== undefined ? item.unit_price : item.price) || 0;
      const rev = Number(item.total !== undefined ? item.total : (qty * unitPrice));

      totalItemsSold += qty;
      expectedRevenue += rev;

      const prodId = item.product_id;
      const header = getHeader.get(prodId) as any;
      let unitBomCost = 0;
      const itemMaterials: any[] = [];

      if (header) {
        const comps = getComponents.all(header.id) as any[];
        const portions = Math.max(0.1, Number(header.yield_portions || 1));

        for (const comp of comps) {
          let unitCost = Number(comp.custom_unit_cost || 0);
          let currentStock = 0;
          let sourceName = comp.custom_material_name || comp.component_name;
          let sourceUnit = comp.custom_unit || comp.unit || 'g';

          if (comp.cost_source === 'manual' && comp.custom_unit_cost !== null && comp.custom_unit_cost !== undefined) {
            unitCost = Number(comp.custom_unit_cost);
          } else if (comp.target_type === 'inventory') {
            const inv = db.prepare('SELECT name, unit, cost_per_unit, quantity FROM inventory_items WHERE id = ?').get(comp.target_id) as any;
            if (inv) {
              sourceName = inv.name || sourceName;
              sourceUnit = inv.unit || sourceUnit;
              currentStock = Number(inv.quantity || 0);
              if (Number(inv.cost_per_unit) > 0) unitCost = Number(inv.cost_per_unit);
            }
          } else if (comp.target_type === 'supply') {
            const sup = db.prepare('SELECT name, base_unit, cost_cents, stock_quantity FROM supplies WHERE id = ?').get(comp.target_id) as any;
            if (sup) {
              sourceName = sup.name || sourceName;
              sourceUnit = sup.base_unit || sourceUnit;
              currentStock = Number(sup.stock_quantity || 0);
              if (Number(sup.cost_cents) > 0) unitCost = Number(sup.cost_cents) / 100;
            }
          }

          const net = Number(comp.net_quantity) || 0;
          const waste = Math.min(99, Math.max(0, Number(comp.waste_pct) || 0));
          const grossPerPortion = net / (1 - waste / 100);
          const compUsageQty = (grossPerPortion / portions) * qty;
          const compUsageCost = compUsageQty * unitCost;

          unitBomCost += (grossPerPortion / portions) * unitCost;

          itemMaterials.push({
            material_id: comp.target_id || comp.id,
            material_name: sourceName,
            unit: sourceUnit,
            qty_used: compUsageQty,
            unit_cost: unitCost,
            total_cost: compUsageCost,
          });

          // Aggregate into materialsMap
          const matKey = `${comp.target_type}-${comp.target_id || comp.custom_material_name || comp.component_name}`;
          const existingMat = materialsMap.get(matKey) || {
            material_id: comp.target_id || comp.id,
            material_name: sourceName,
            unit: sourceUnit,
            source_type: comp.target_type === 'custom' ? 'standalone_bom' : 'inventory_supply',
            qty_used_by_sales: 0,
            qty_used_by_waste: 0,
            qty_used_by_prep_batches: 0,
            total_expected_qty_used: 0,
            total_expected_quantity: 0,
            unit_cost: unitCost,
            total_expected_cost: 0,
            current_stock: currentStock,
          };

          existingMat.qty_used_by_sales += compUsageQty;
          existingMat.total_expected_qty_used += compUsageQty;
          existingMat.total_expected_quantity += compUsageQty;
          existingMat.total_expected_cost += compUsageCost;
          materialsMap.set(matKey, existingMat);
        }
      }

      const totalItemExpectedCost = unitBomCost * qty;
      expectedMaterialsCost += totalItemExpectedCost;

      const existingProd = soldMap.get(prodId) || {
        product_id: prodId,
        product_name: item.product_name,
        category_name: item.category_name || 'General',
        qty_sold: 0,
        unit_price: unitPrice,
        total_revenue: 0,
        unit_bom_cost: unitBomCost,
        total_expected_cost: 0,
        expected_profit: 0,
        expected_margin_pct: 0,
        has_bom: !!header,
        materials_used: [],
      };

      existingProd.qty_sold += qty;
      existingProd.total_revenue += rev;
      existingProd.total_expected_cost += totalItemExpectedCost;
      existingProd.expected_profit = existingProd.total_revenue - existingProd.total_expected_cost;
      existingProd.expected_margin_pct = existingProd.total_revenue > 0
        ? (existingProd.expected_profit / existingProd.total_revenue) * 100
        : 0;

      // Merge materials into item breakdown
      for (const m of itemMaterials) {
        const found = existingProd.materials_used.find((x: any) => x.material_name === m.material_name);
        if (found) {
          found.qty_used += m.qty_used;
          found.total_cost += m.total_cost;
        } else {
          existingProd.materials_used.push({ ...m });
        }
      }

      soldMap.set(prodId, existingProd);
    }

    // Authorized Waste in the period
    let wasteQuery = `SELECT COALESCE(SUM(total_cost), 0) as total_waste FROM waste_logs WHERE 1=1`;
    const wasteParams: any[] = [];
    if (from) {
      wasteQuery += ` AND logged_at >= ?`;
      wasteParams.push(`${from} 00:00:00`);
    }
    if (to) {
      wasteQuery += ` AND logged_at <= ?`;
      wasteParams.push(`${to} 23:59:59`);
    }
    const wasteRow = db.prepare(wasteQuery).get(...wasteParams) as any;
    const authorizedWasteCost = Number(wasteRow?.total_waste || 0);

    // Operating expenses in the period
    let expenseQuery = `SELECT COALESCE(SUM(amount), 0) as total_expenses FROM operating_expenses WHERE 1=1`;
    const expenseParams: any[] = [];
    if (from) {
      expenseQuery += ` AND business_date >= ?`;
      expenseParams.push(from);
    }
    if (to) {
      expenseQuery += ` AND business_date <= ?`;
      expenseParams.push(to);
    }
    const expenseRow = db.prepare(expenseQuery).get(...expenseParams) as any;
    const operatingExpensesTotal = Number(expenseRow?.total_expenses || 0);

    const expectedProfitWithoutExpenses = expectedRevenue - expectedMaterialsCost;
    const expectedMarginPctWithoutExpenses = expectedRevenue > 0
      ? (expectedProfitWithoutExpenses / expectedRevenue) * 100
      : 0;
    const expectedNetProfitWithExpenses = expectedRevenue - expectedMaterialsCost - authorizedWasteCost - operatingExpensesTotal;

    res.json({
      success: true,
      summary: {
        total_items_sold: totalItemsSold,
        expected_revenue: expectedRevenue,
        expected_materials_cost: expectedMaterialsCost,
        expected_profit_without_expenses: expectedProfitWithoutExpenses,
        expected_margin_pct_without_expenses: expectedMarginPctWithoutExpenses,
        authorized_waste_cost: authorizedWasteCost,
        operating_expenses_total: operatingExpensesTotal,
        expected_net_profit_with_expenses: expectedNetProfitWithExpenses,
      },
      sold_items_breakdown: Array.from(soldMap.values()),
      expected_materials_breakdown: Array.from(materialsMap.values()),
    });
  } catch (error: any) {
    console.error('[BOM Expected Usage] Error computing usage & profit:', error);
    res.status(500).json({ error: error.message || 'Failed to compute expected usage & profit' });
  }
});
