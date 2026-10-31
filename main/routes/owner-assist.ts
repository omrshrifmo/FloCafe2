import { Router, Request, Response } from 'express';
import { getDatabase } from '../db';
import { requirePermission } from '../services/authorization';

export const ownerAssistRoutes = Router();

// GET /owner-assist/diagnostics: Menu Engineering Matrix & Operational Diagnostics
ownerAssistRoutes.get('/diagnostics', requirePermission('owner.assist.view'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();

    // 1. Menu Engineering Matrix (Stars, Plowhorses, Puzzles, Dogs)
    // Gather sales volume and margin over the last 30 days
    const productStats = db.prepare(`
      SELECT
        p.id, p.name, p.price, c.name as category_name,
        COALESCE(SUM(oi.quantity), 0) as total_units_sold,
        COALESCE(SUM(oi.total), 0) as total_revenue
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN order_items oi ON oi.product_id = p.id AND oi.status != 'refunded'
      LEFT JOIN orders o ON o.id = oi.order_id AND o.status != 'cancelled' AND o.created_at >= datetime('now', '-30 days')
      WHERE p.deleted_at IS NULL AND p.is_active = 1
      GROUP BY p.id
    `).all() as any[];

    // Retrieve BOM costs for margin computation
    const getHeader = db.prepare('SELECT id, prep_time_minutes, direct_labor_rate_per_hour, yield_portions FROM bom_headers WHERE product_id = ?');
    const getComps = db.prepare('SELECT * FROM bom_components WHERE bom_id = ?');

    let totalVolume = 0;
    let totalMargin = 0;
    let productCount = 0;

    const classifiedProducts = productStats.map((prod) => {
      const price = Number(prod.price) || 0;
      let unitCost = price * 0.3; // Default 30% food cost if no BOM

      const header = getHeader.get(prod.id) as any;
      if (header) {
        const comps = getComps.all(header.id) as any[];
        let matCost = 0;
        for (const comp of comps) {
          let uCost = 0;
          if (comp.target_type === 'inventory') {
            const inv = db.prepare('SELECT cost_per_unit FROM inventory_items WHERE id = ?').get(comp.target_id) as any;
            uCost = Number(inv?.cost_per_unit || 0);
          } else {
            const sup = db.prepare('SELECT cost_cents FROM supplies WHERE id = ?').get(comp.target_id) as any;
            uCost = Number(sup?.cost_cents || 0) / 100;
          }
          matCost += (comp.gross_quantity || comp.net_quantity) * uCost;
        }
        const laborCost = ((Number(header.prep_time_minutes || 0) / 60) * Number(header.direct_labor_rate_per_hour || 0)) / Math.max(1, Number(header.yield_portions || 1));
        unitCost = matCost + laborCost;
      }

      const contributionMargin = Math.max(0, price - unitCost);
      const unitsSold = Number(prod.total_units_sold) || 0;

      totalVolume += unitsSold;
      totalMargin += contributionMargin;
      productCount += 1;

      return {
        id: prod.id,
        name: prod.name,
        category: prod.category_name || 'General',
        price,
        unit_cost: unitCost,
        contribution_margin: contributionMargin,
        units_sold: unitsSold,
        total_revenue: Number(prod.total_revenue) || 0,
        margin_pct: price > 0 ? (contributionMargin / price) * 100 : 0,
      };
    });

    const avgVolume = productCount > 0 ? totalVolume / productCount : 1;
    const avgMargin = productCount > 0 ? totalMargin / productCount : 1;

    // Classification into BCG / Boston Matrix for Menu Engineering:
    // Star: High Volume, High Margin -> Maintain high quality, highlight on POS/menu
    // Plowhorse: High Volume, Low Margin -> Increase price modestly or reduce ingredient waste
    // Puzzle: Low Volume, High Margin -> Train staff to upsell, feature in combos
    // Dog: Low Volume, Low Margin -> Consider replacing, repricing, or re-engineering recipe
    const matrix = classifiedProducts.map((p) => {
      const isHighVolume = p.units_sold >= avgVolume;
      const isHighMargin = p.contribution_margin >= avgMargin;

      let classification: 'Star' | 'Plowhorse' | 'Puzzle' | 'Dog';
      let actionRecommendation: string;

      if (isHighVolume && isHighMargin) {
        classification = 'Star';
        actionRecommendation = 'Keep recipe consistent; feature as flagship item.';
      } else if (isHighVolume && !isHighMargin) {
        classification = 'Plowhorse';
        actionRecommendation = 'High popularity, lower margin. Increase price slightly or optimize portion size/waste.';
      } else if (!isHighVolume && isHighMargin) {
        classification = 'Puzzle';
        actionRecommendation = 'High profit, lower volume. Promote on top menu slots and train servers to upsell.';
      } else {
        classification = 'Dog';
        actionRecommendation = 'Low popularity and low margin. Re-engineer ingredients or remove from catalog.';
      }

      return {
        ...p,
        classification,
        action_recommendation: actionRecommendation,
      };
    });

    // 2. Operational Warnings & Alerts
    // - Low / Critical inventory count
    const lowInventoryCount = (db.prepare(`
      SELECT COUNT(*) as c FROM inventory_items WHERE is_active = 1 AND reorder_level > 0 AND quantity <= reorder_level
    `).get() as any)?.c || 0;

    const lowSuppliesCount = (db.prepare(`
      SELECT COUNT(*) as c FROM supplies WHERE is_active = 1 AND deleted_at IS NULL AND low_stock_threshold > 0 AND COALESCE(stock_quantity, quantity, 0) <= low_stock_threshold
    `).get() as any)?.c || 0;

    // - HACCP critical breaches in last 7 days
    const haccpBreaches = (db.prepare(`
      SELECT COUNT(*) as c FROM haccp_ccp_logs WHERE status = 'critical_breach' AND recorded_at >= datetime('now', '-7 days')
    `).get() as any)?.c || 0;

    // - Overdue/uncompleted HACCP checklists today
    const uncompletedChecklists = (db.prepare(`
      SELECT COUNT(*) as c FROM haccp_checklists WHERE business_date = date('now') AND is_completed = 0
    `).get() as any)?.c || 0;

    // - Stocktake shrinkage value from last reconciled session
    const lastStocktake = db.prepare(`
      SELECT reference_code, total_variance_value, reconciled_at FROM stocktake_sessions WHERE status = 'reconciled' ORDER BY reconciled_at DESC LIMIT 1
    `).get() as any;

    // - Labor to Revenue ratio over the last 30 days
    const last30Revenue = (db.prepare(`
      SELECT COALESCE(SUM(total), 0) as rev FROM bills WHERE payment_status IN ('paid', 'partially_refunded', 'refunded') AND created_at >= datetime('now', '-30 days')
    `).get() as any)?.rev || 0;

    const last30Labor = (db.prepare(`
      SELECT COALESCE(SUM(net_payable), 0) as labor FROM hr_payroll_runs WHERE paid_at >= datetime('now', '-30 days')
    `).get() as any)?.labor || 0;

    const laborToRevenueRatio = last30Revenue > 0 ? (last30Labor / last30Revenue) * 100 : 0;

    res.json({
      matrix,
      benchmarks: {
        avg_volume: avgVolume,
        avg_margin: avgMargin,
        total_products_analyzed: productCount,
      },
      operational_alerts: {
        low_inventory_items_count: lowInventoryCount,
        low_supplies_count: lowSuppliesCount,
        total_low_stock_alerts: lowInventoryCount + lowSuppliesCount,
        haccp_critical_breaches_last_7d: haccpBreaches,
        uncompleted_checklists_today: uncompletedChecklists,
        last_stocktake_shrinkage: lastStocktake?.total_variance_value || 0,
        last_stocktake_code: lastStocktake?.reference_code || null,
        labor_to_revenue_ratio_pct: laborToRevenueRatio,
        labor_status: laborToRevenueRatio > 35 ? 'high_alert' : (laborToRevenueRatio > 28 ? 'healthy' : 'efficient'),
      },
    });
  } catch (error: any) {
    console.error('[Owner Assist] Error fetching diagnostics:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch diagnostics' });
  }
});
