'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import toast from 'react-hot-toast';
import {
  Sparkles,
  TrendingUp,
  AlertTriangle,
  ShieldAlert,
  Star,
  Compass,
  HelpCircle,
  Sliders,
  DollarSign,
  Activity,
  Layers,
  BookOpen,
} from 'lucide-react';

interface MatrixItem {
  id: string;
  name: string;
  category: string;
  price: number;
  unit_cost: number;
  contribution_margin: number;
  units_sold: number;
  total_revenue: number;
  margin_pct: number;
  classification: 'Star' | 'Plowhorse' | 'Puzzle' | 'Dog';
  action_recommendation: string;
}

interface OperationalAlerts {
  low_inventory_count: number;
  recipes_exceeding_food_cost_target: number;
  haccp_critical_breaches_last_7d: number;
  open_cash_sessions_count: number;
  labor_to_revenue_ratio_pct: number;
  labor_ratio_status: 'healthy' | 'high_attention_needed';
}

export default function OwnerAssistPage() {
  const { currentTenant } = useAuthStore();
  const fmtCurrency = useFormatCurrency();

  const [matrix, setMatrix] = useState<MatrixItem[]>([]);
  const [averages, setAverages] = useState<{ volume: number; margin: number }>({ volume: 0, margin: 0 });
  const [alerts, setAlerts] = useState<OperationalAlerts | null>(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'Star' | 'Plowhorse' | 'Puzzle' | 'Dog'>('all');
  const [loading, setLoading] = useState(true);

  // What-If Simulator state
  const [priceChangePct, setPriceChangePct] = useState<number>(0);
  const [volumeGrowthPct, setVolumeGrowthPct] = useState<number>(0);
  const [costInflationPct, setCostInflationPct] = useState<number>(0);

  const loadData = useCallback(async () => {
    try {
      const res = await api.get('/owner-assist/diagnostics');
      setMatrix(res.data?.menu_engineering_matrix || []);
      setAverages(res.data?.averages || { volume: 0, margin: 0 });
      setAlerts(res.data?.operational_alerts || null);
    } catch {
      toast.error('Failed to load Owner Assist diagnostics');
    }
  }, []);

  useEffect(() => {
    let active = true;
    api.get('/owner-assist/diagnostics')
      .then((res) => {
        if (!active) return;
        setMatrix(res.data?.menu_engineering_matrix || []);
        setAverages(res.data?.averages || { volume: 0, margin: 0 });
        setAlerts(res.data?.operational_alerts || null);
      })
      .catch(() => {
        if (active) toast.error('Failed to load Owner Assist diagnostics');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const starsCount = matrix.filter((m) => m.classification === 'Star').length;
  const plowhorsesCount = matrix.filter((m) => m.classification === 'Plowhorse').length;
  const puzzlesCount = matrix.filter((m) => m.classification === 'Puzzle').length;
  const dogsCount = matrix.filter((m) => m.classification === 'Dog').length;

  const filteredMatrix = matrix.filter((m) => {
    if (activeFilter === 'all') return true;
    return m.classification === activeFilter;
  });

  // Simulator computations based on current matrix baseline
  const baselineRevenue = matrix.reduce((acc, m) => acc + m.total_revenue, 0);
  const baselineCogs = matrix.reduce((acc, m) => acc + (m.units_sold * m.unit_cost), 0);
  const baselineGrossProfit = baselineRevenue - baselineCogs;

  const simVolumeMultiplier = 1 + volumeGrowthPct / 100;
  const simPriceMultiplier = 1 + priceChangePct / 100;
  const simCostMultiplier = 1 + costInflationPct / 100;

  const simRevenue = baselineRevenue * simPriceMultiplier * simVolumeMultiplier;
  const simCogs = baselineCogs * simCostMultiplier * simVolumeMultiplier;
  const simGrossProfit = simRevenue - simCogs;
  const profitDelta = simGrossProfit - baselineGrossProfit;

  return (
    <div className="flex h-full flex-col p-4 md:p-6 space-y-6 overflow-y-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Sparkles className="size-6 text-brand" />
            Owner & Manager Assist AI Diagnostics
          </h1>
          <p className="text-sm text-muted-foreground">
            Menu Engineering Matrix, 30-day product margins, operational alerts, and interactive profit forecasting.
          </p>
        </div>
      </div>

      {/* Operational Diagnostic Alerts */}
      {alerts && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 bg-card border border-border rounded-xl shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Low Par Inventory</span>
              <AlertTriangle className={`size-4 ${alerts.low_inventory_count > 0 ? 'text-amber-500' : 'text-muted-foreground'}`} />
            </div>
            <p className="text-2xl font-bold text-foreground mt-2">{alerts.low_inventory_count}</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Items at or below reorder threshold
            </p>
          </div>

          <div className="p-4 bg-card border border-border rounded-xl shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Food Cost Overrun</span>
              <Layers className={`size-4 ${alerts.recipes_exceeding_food_cost_target > 0 ? 'text-red-500' : 'text-green-500'}`} />
            </div>
            <p className="text-2xl font-bold text-foreground mt-2">{alerts.recipes_exceeding_food_cost_target}</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Recipes exceeding target food cost %
            </p>
          </div>

          <div className="p-4 bg-card border border-border rounded-xl shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">HACCP Breaches</span>
              <ShieldAlert className={`size-4 ${alerts.haccp_critical_breaches_last_7d > 0 ? 'text-red-500' : 'text-green-500'}`} />
            </div>
            <p className="text-2xl font-bold text-foreground mt-2">{alerts.haccp_critical_breaches_last_7d}</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Critical food safety CCP breaches (7d)
            </p>
          </div>

          <div className="p-4 bg-card border border-border rounded-xl shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Labor / Revenue Ratio</span>
              <Activity className="size-4 text-brand" />
            </div>
            <p className="text-2xl font-bold text-foreground mt-2">
              {alerts.labor_to_revenue_ratio_pct.toFixed(1)}%
            </p>
            <Badge
              variant={alerts.labor_ratio_status === 'healthy' ? 'secondary' : 'destructive'}
              className="mt-1 text-[10px] px-1.5 py-0"
            >
              {alerts.labor_ratio_status === 'healthy' ? 'Healthy Labor Ratio' : 'Attention Needed'}
            </Badge>
          </div>
        </div>
      )}

      {/* Menu Engineering Matrix (BCG Boston Matrix) */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <TrendingUp className="size-5 text-brand" />
              Menu Engineering Matrix (Last 30 Days)
            </h2>
            <p className="text-xs text-muted-foreground">
              Classifies items by Volume (Avg: {averages.volume.toFixed(0)} units) and Contribution Margin (Avg: {fmtCurrency(averages.margin)}).
            </p>
          </div>

          {/* Matrix Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant={activeFilter === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveFilter('all')}
              className="text-xs h-7"
            >
              All ({matrix.length})
            </Button>
            <Button
              variant={activeFilter === 'Star' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveFilter('Star')}
              className="text-xs h-7 border-green-500/40 text-green-700 dark:text-green-400"
            >
              ⭐ Stars ({starsCount})
            </Button>
            <Button
              variant={activeFilter === 'Plowhorse' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveFilter('Plowhorse')}
              className="text-xs h-7 border-blue-500/40 text-blue-700 dark:text-blue-400"
            >
              🐎 Plowhorses ({plowhorsesCount})
            </Button>
            <Button
              variant={activeFilter === 'Puzzle' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveFilter('Puzzle')}
              className="text-xs h-7 border-amber-500/40 text-amber-700 dark:text-amber-400"
            >
              🧩 Puzzles ({puzzlesCount})
            </Button>
            <Button
              variant={activeFilter === 'Dog' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveFilter('Dog')}
              className="text-xs h-7 border-red-500/40 text-red-700 dark:text-red-400"
            >
              🐕 Dogs ({dogsCount})
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto border border-border rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-muted text-muted-foreground font-semibold">
              <tr>
                <th className="p-2.5 text-start">Product Name</th>
                <th className="p-2.5 text-start">Category</th>
                <th className="p-2.5 text-end">Selling Price</th>
                <th className="p-2.5 text-end">Unit Cost</th>
                <th className="p-2.5 text-end">Margin</th>
                <th className="p-2.5 text-end">Units Sold</th>
                <th className="p-2.5 text-end">Revenue</th>
                <th className="p-2.5 text-center">Quadrant</th>
                <th className="p-2.5 text-start">Actionable Recommendation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredMatrix.map((item) => (
                <tr key={item.id} className="hover:bg-muted/20">
                  <td className="p-2.5 font-medium text-foreground">{item.name}</td>
                  <td className="p-2.5 text-muted-foreground">{item.category}</td>
                  <td className="p-2.5 text-end font-semibold text-foreground">{fmtCurrency(item.price)}</td>
                  <td className="p-2.5 text-end text-muted-foreground">{fmtCurrency(item.unit_cost)}</td>
                  <td className="p-2.5 text-end font-medium text-foreground">
                    {fmtCurrency(item.contribution_margin)} ({item.margin_pct.toFixed(0)}%)
                  </td>
                  <td className="p-2.5 text-end font-mono font-medium">{item.units_sold}</td>
                  <td className="p-2.5 text-end font-semibold text-foreground">{fmtCurrency(item.total_revenue)}</td>
                  <td className="p-2.5 text-center">
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-bold px-2 py-0.5 ${
                        item.classification === 'Star'
                          ? 'border-green-500 text-green-600 bg-green-500/10'
                          : item.classification === 'Plowhorse'
                          ? 'border-blue-500 text-blue-600 bg-blue-500/10'
                          : item.classification === 'Puzzle'
                          ? 'border-amber-500 text-amber-600 bg-amber-500/10'
                          : 'border-red-500 text-red-600 bg-red-500/10'
                      }`}
                    >
                      {item.classification}
                    </Badge>
                  </td>
                  <td className="p-2.5 text-muted-foreground">{item.action_recommendation}</td>
                </tr>
              ))}
              {filteredMatrix.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-muted-foreground">
                    No products in this category.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Interactive "What-If" Profit Simulator */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-xs space-y-4">
        <div>
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Sliders className="size-5 text-brand" />
            Interactive &quot;What-If&quot; Menu Price & Inflation Simulator
          </h2>
          <p className="text-xs text-muted-foreground">
            Forecast the net profit impact of menu price adjustments, sales volume swings, and supplier ingredient cost inflation.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-4 bg-muted/30 rounded-lg border border-border/70">
          <div>
            <label className="text-xs font-semibold text-foreground flex items-center justify-between">
              <span>Menu Price Adjustment:</span>
              <span className="font-bold text-brand">{priceChangePct > 0 ? `+${priceChangePct}` : priceChangePct}%</span>
            </label>
            <input
              type="range"
              min="-30"
              max="50"
              step="1"
              value={priceChangePct}
              onChange={(e) => setPriceChangePct(parseInt(e.target.value) || 0)}
              className="w-full mt-2 accent-brand"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-foreground flex items-center justify-between">
              <span>Sales Volume Growth:</span>
              <span className="font-bold text-brand">{volumeGrowthPct > 0 ? `+${volumeGrowthPct}` : volumeGrowthPct}%</span>
            </label>
            <input
              type="range"
              min="-50"
              max="100"
              step="1"
              value={volumeGrowthPct}
              onChange={(e) => setVolumeGrowthPct(parseInt(e.target.value) || 0)}
              className="w-full mt-2 accent-brand"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-foreground flex items-center justify-between">
              <span>Ingredient Cost Inflation:</span>
              <span className="font-bold text-brand">{costInflationPct > 0 ? `+${costInflationPct}` : costInflationPct}%</span>
            </label>
            <input
              type="range"
              min="-20"
              max="50"
              step="1"
              value={costInflationPct}
              onChange={(e) => setCostInflationPct(parseInt(e.target.value) || 0)}
              className="w-full mt-2 accent-brand"
            />
          </div>
        </div>

        {/* Projected Results */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-3 bg-card border border-border rounded-lg">
            <span className="text-[11px] text-muted-foreground">Projected Revenue</span>
            <p className="text-base font-bold text-foreground mt-0.5">{fmtCurrency(simRevenue)}</p>
            <span className="text-[10px] text-muted-foreground">Baseline: {fmtCurrency(baselineRevenue)}</span>
          </div>

          <div className="p-3 bg-card border border-border rounded-lg">
            <span className="text-[11px] text-muted-foreground">Projected COGS</span>
            <p className="text-base font-bold text-foreground mt-0.5">{fmtCurrency(simCogs)}</p>
            <span className="text-[10px] text-muted-foreground">Baseline: {fmtCurrency(baselineCogs)}</span>
          </div>

          <div className="p-3 bg-card border border-border rounded-lg">
            <span className="text-[11px] text-muted-foreground">Projected Gross Profit</span>
            <p className="text-base font-bold text-foreground mt-0.5">{fmtCurrency(simGrossProfit)}</p>
            <span className="text-[10px] text-muted-foreground">Baseline: {fmtCurrency(baselineGrossProfit)}</span>
          </div>

          <div className={`p-3 rounded-lg border ${profitDelta >= 0 ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
            <span className="text-[11px] font-medium text-foreground">Estimated Profit Delta</span>
            <p className={`text-base font-bold mt-0.5 ${profitDelta >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {profitDelta >= 0 ? `+${fmtCurrency(profitDelta)}` : fmtCurrency(profitDelta)}
            </p>
            <span className="text-[10px] text-muted-foreground">
              {baselineGrossProfit > 0 ? `${((profitDelta / baselineGrossProfit) * 100).toFixed(1)}% change` : 'N/A'}
            </span>
          </div>
        </div>
      </div>

      {/* Built-in Operational SOP Guide */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-xs space-y-3">
        <h2 className="text-base font-bold text-foreground flex items-center gap-2">
          <BookOpen className="size-5 text-brand" />
          Standard Operating Procedures (SOP) & Management Guide
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-muted-foreground">
          <div className="p-3 bg-muted/20 border border-border rounded-lg space-y-1.5">
            <h4 className="font-semibold text-foreground">1. Morning Shift Opening</h4>
            <p>• Verify cash drawer opening float (counted and confirmed in FloCafe).</p>
            <p>• Complete Opening HACCP Sanitation Checklist before serving.</p>
            <p>• Log refrigerator/freezer CCP temperatures (ensure &lt; 4°C).</p>
          </div>
          <div className="p-3 bg-muted/20 border border-border rounded-lg space-y-1.5">
            <h4 className="font-semibold text-foreground">2. Receiving Deliveries (GRN)</h4>
            <p>• Check package seals, temperature, and expiry dates upon delivery.</p>
            <p>• Receive PO inside FloCafe to update weighted-average unit costs.</p>
            <p>• If paying cash on delivery, mark &quot;Pay From Cash Drawer&quot;.</p>
          </div>
          <div className="p-3 bg-muted/20 border border-border rounded-lg space-y-1.5">
            <h4 className="font-semibold text-foreground">3. Closing & Physical Reconciliation</h4>
            <p>• Perform blind cash drawer count; verify discrepancies with admin PIN.</p>
            <p>• Complete physical stocktake count lines to detect variance shrinkage.</p>
            <p>• Review daily P&L statement to track COGS and direct operating costs.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
