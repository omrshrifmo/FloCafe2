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
        let liveUnitCost = 0;
        if (comp.target_type === 'inventory') {
          const inv = db.prepare('SELECT cost_per_unit FROM inventory_items WHERE id = ?').get(comp.target_id) as any;
          liveUnitCost = Number(inv?.cost_per_unit || 0);
        } else {
          const sup = db.prepare('SELECT cost_cents FROM supplies WHERE id = ?').get(comp.target_id) as any;
          liveUnitCost = Number(sup?.cost_cents || 0) / 100;
        }

        const grossQty = comp.net_quantity / (1 - (comp.waste_pct || 0) / 100);
        const lineCost = grossQty * liveUnitCost;
        directMaterialCost += lineCost;

        return {
          ...comp,
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
    const components = header ? db.prepare('SELECT * FROM bom_components WHERE bom_id = ?').all(header.id) : [];

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
          id, bom_id, target_type, target_id, component_name, unit, net_quantity, waste_pct, gross_quantity, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const comp of components) {
        const compId = randomUUID();
        const targetType = comp.target_type === 'supply' ? 'supply' : 'inventory';
        const targetId = String(comp.target_id || '').trim();
        const compName = String(comp.component_name || '').trim();
        const unit = String(comp.unit || 'each').trim();
        const netQty = Math.max(0.0001, Number(comp.net_quantity) || 1);
        const wastePct = Math.min(99.9, Math.max(0, Number(comp.waste_pct) || 0));
        const grossQty = netQty / (1 - wastePct / 100);

        insertComp.run(
          compId, bomId, targetType, targetId, compName, unit, netQty, wastePct, grossQty, timestamp, timestamp
        );
      }
    });

    const updatedHeader = db.prepare('SELECT * FROM bom_headers WHERE product_id = ?').get(productId) as any;
    updatedHeader.components = db.prepare('SELECT * FROM bom_components WHERE bom_id = ?').all(updatedHeader.id);
    res.json({ success: true, bom: updatedHeader });
  } catch (error: any) {
    console.error('[BOM Costing] Error saving BOM:', error);
    res.status(500).json({ error: error.message || 'Failed to save BOM' });
  }
});
