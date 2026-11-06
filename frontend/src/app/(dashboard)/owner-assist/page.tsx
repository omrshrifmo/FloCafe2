'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import toast from 'react-hot-toast';
import { useTranslations } from 'use-intl';
import { useAppLanguage } from '@/lib/i18n/bilingual';
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
  const t = useTranslations('ownerAssist');
  const tCommon = useTranslations('common');
  const { isAr, tr, dir } = useAppLanguage();
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
      toast.error(t('loadError'));
    }
  }, [t]);

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
        if (active) toast.error(t('loadError'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [t]);

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
    <div className="flex h-full flex-col p-4 md:p-6 space-y-6 overflow-y-auto" dir={dir}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Sparkles className="size-6 text-brand" />
            {tr('Owner Decision & Diagnostic Copilot', 'مساعد المالك الذكي والتشخيص الإداري')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {tr('Menu engineering BCG matrix, cost leak alerts, and what-if financial projections', 'مصفوفة تحليل الأصناف والربحية، تنبيهات تسرب التكاليف، ومحاكي الأرباح والقرارات الاستراتيجية')}
          </p>
        </div>
      </div>

      {/* Operational Diagnostic Alerts */}
      {alerts && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 bg-card border border-border rounded-xl shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{t('kpiLowInventory')}</span>
              <AlertTriangle className={`size-4 ${alerts.low_inventory_count > 0 ? 'text-amber-500' : 'text-muted-foreground'}`} />
            </div>
            <p className="text-2xl font-bold text-foreground mt-2">{alerts.low_inventory_count}</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {t('kpiLowInventory')}
            </p>
          </div>

          <div className="p-4 bg-card border border-border rounded-xl shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{t('kpiRecipesExceeding')}</span>
              <Layers className={`size-4 ${alerts.recipes_exceeding_food_cost_target > 0 ? 'text-red-500' : 'text-green-500'}`} />
            </div>
            <p className="text-2xl font-bold text-foreground mt-2">{alerts.recipes_exceeding_food_cost_target}</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {t('kpiRecipesExceeding')}
            </p>
          </div>

          <div className="p-4 bg-card border border-border rounded-xl shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{t('kpiHaccpBreaches')}</span>
              <ShieldAlert className={`size-4 ${alerts.haccp_critical_breaches_last_7d > 0 ? 'text-red-500' : 'text-green-500'}`} />
            </div>
            <p className="text-2xl font-bold text-foreground mt-2">{alerts.haccp_critical_breaches_last_7d}</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {t('kpiHaccpBreaches')}
            </p>
          </div>

          <div className="p-4 bg-card border border-border rounded-xl shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{t('kpiLaborRatio')}</span>
              <Activity className="size-4 text-brand" />
            </div>
            <p className="text-2xl font-bold text-foreground mt-2">
              {alerts.labor_to_revenue_ratio_pct.toFixed(1)}%
            </p>
            <Badge
              variant={alerts.labor_ratio_status === 'healthy' ? 'secondary' : 'destructive'}
              className="mt-1 text-[10px] px-1.5 py-0"
            >
              {alerts.labor_ratio_status === 'healthy' ? t('healthyBadge') : t('attentionBadge')}
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
              {t('matrixTitle')}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t('matrixSubtitle')}
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
              {t('filterAll', { count: matrix.length })}
            </Button>
            <Button
              variant={activeFilter === 'Star' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveFilter('Star')}
              className="text-xs h-7 border-green-500/40 text-green-700 dark:text-green-400"
            >
              ⭐ {t('filterStars', { count: starsCount })}
            </Button>
            <Button
              variant={activeFilter === 'Plowhorse' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveFilter('Plowhorse')}
              className="text-xs h-7 border-blue-500/40 text-blue-700 dark:text-blue-400"
            >
              🐎 {t('filterPlowhorses', { count: plowhorsesCount })}
            </Button>
            <Button
              variant={activeFilter === 'Puzzle' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveFilter('Puzzle')}
              className="text-xs h-7 border-amber-500/40 text-amber-700 dark:text-amber-400"
            >
              🧩 {t('filterPuzzles', { count: puzzlesCount })}
            </Button>
            <Button
              variant={activeFilter === 'Dog' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveFilter('Dog')}
              className="text-xs h-7 border-red-500/40 text-red-700 dark:text-red-400"
            >
              🐕 {t('filterDogs', { count: dogsCount })}
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto border border-border rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-muted text-muted-foreground font-semibold">
              <tr>
                <th className="p-2.5 text-start">{t('colProduct')}</th>
                <th className="p-2.5 text-start">{t('colProduct')}</th>
                <th className="p-2.5 text-end">{t('colPriceCost')}</th>
                <th className="p-2.5 text-end">{t('colPriceCost')}</th>
                <th className="p-2.5 text-end">{t('colMargin')}</th>
                <th className="p-2.5 text-end">{t('colUnitsSold')}</th>
                <th className="p-2.5 text-end">{t('colRevenue')}</th>
                <th className="p-2.5 text-center">{t('colClassification')}</th>
                <th className="p-2.5 text-start">{t('colRecommendation')}</th>
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
                    {tCommon('no')}
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
            {t('simTitle')}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t('simSubtitle')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-4 bg-muted/30 rounded-lg border border-border/70">
          <div>
            <label className="text-xs font-semibold text-foreground flex items-center justify-between">
              <span>{t('lblPriceChange')}</span>
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
              <span>{t('lblVolumeGrowth')}</span>
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
              <span>{t('lblCostInflation')}</span>
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
            <span className="text-[11px] text-muted-foreground">{t('simProjectedRevenue')}</span>
            <p className="text-base font-bold text-foreground mt-0.5">{fmtCurrency(simRevenue)}</p>
            <span className="text-[10px] text-muted-foreground">{t('simBaselineRevenue')} {fmtCurrency(baselineRevenue)}</span>
          </div>

          <div className="p-3 bg-card border border-border rounded-lg">
            <span className="text-[11px] text-muted-foreground">{t('simBaselineRevenue')}</span>
            <p className="text-base font-bold text-foreground mt-0.5">{fmtCurrency(simCogs)}</p>
            <span className="text-[10px] text-muted-foreground">{t('simBaselineRevenue')} {fmtCurrency(baselineCogs)}</span>
          </div>

          <div className="p-3 bg-card border border-border rounded-lg">
            <span className="text-[11px] text-muted-foreground">{t('simProjectedProfit')}</span>
            <p className="text-base font-bold text-foreground mt-0.5">{fmtCurrency(simGrossProfit)}</p>
            <span className="text-[10px] text-muted-foreground">{t('simBaselineRevenue')} {fmtCurrency(baselineGrossProfit)}</span>
          </div>

          <div className={`p-3 rounded-lg border ${profitDelta >= 0 ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
            <span className="text-[11px] font-medium text-foreground">{t('simProjectedDelta')}</span>
            <p className={`text-base font-bold mt-0.5 ${profitDelta >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {profitDelta >= 0 ? `+${fmtCurrency(profitDelta)}` : fmtCurrency(profitDelta)}
            </p>
            <span className="text-[10px] text-muted-foreground">
              {baselineGrossProfit > 0 ? `${((profitDelta / baselineGrossProfit) * 100).toFixed(1)}%` : 'N/A'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
