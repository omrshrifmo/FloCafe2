'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import toast from 'react-hot-toast';
import {
  Layers,
  Search,
  Plus,
  Trash2,
  Save,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Clock,
  Scale,
  Sparkles,
} from 'lucide-react';

interface BomComponent {
  id?: string;
  target_type: 'inventory' | 'supply';
  target_id: string;
  component_name: string;
  unit: string;
  net_quantity: number;
  waste_pct: number;
  gross_quantity?: number;
  live_unit_cost?: number;
  line_cost?: number;
}

interface BomHeader {
  id?: string;
  product_id?: string;
  yield_portions: number;
  prep_time_minutes: number;
  direct_labor_rate_per_hour: number;
  target_food_cost_pct: number;
  indirect_overhead_override: number | null;
  notes: string | null;
}

interface ProductCosting {
  direct_material_cost: number;
  direct_prep_labor_cost: number;
  total_direct_cost: number;
  allocated_indirect_overhead: number;
  fully_loaded_unit_cost: number;
  selling_price: number;
  direct_food_cost_pct: number;
  target_food_cost_pct: number;
  net_contribution_margin: number;
  net_contribution_margin_pct: number;
  exceeds_target: boolean;
}

interface ProductBom {
  product: {
    id: string;
    name: string;
    price: number;
    sku?: string;
    category_name?: string;
  };
  bom_header: BomHeader;
  components: BomComponent[];
  costing: ProductCosting;
}

export default function BomPage() {
  const { currentTenant } = useAuthStore();
  const fmtCurrency = useFormatCurrency();

  const [products, setProducts] = useState<ProductBom[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductBom | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Available inventory & supplies for adding lines
  const [inventoryItems, setInventoryItems] = useState<Array<{ id: string; name: string; unit: string; cost_per_unit?: number }>>([]);
  const [supplyItems, setSupplyItems] = useState<Array<{ id: string; name: string; base_unit: string; cost_cents?: number }>>([]);

  // Editing form
  const [headerForm, setHeaderForm] = useState<BomHeader>({
    yield_portions: 1,
    prep_time_minutes: 2,
    direct_labor_rate_per_hour: 60,
    target_food_cost_pct: 30,
    indirect_overhead_override: null,
    notes: '',
  });
  const [componentsList, setComponentsList] = useState<BomComponent[]>([]);

  const selectProduct = useCallback((item: ProductBom) => {
    setSelectedProduct(item);
    setHeaderForm({
      yield_portions: item.bom_header.yield_portions || 1,
      prep_time_minutes: item.bom_header.prep_time_minutes || 2,
      direct_labor_rate_per_hour: item.bom_header.direct_labor_rate_per_hour || 60,
      target_food_cost_pct: item.bom_header.target_food_cost_pct || 30,
      indirect_overhead_override: item.bom_header.indirect_overhead_override ?? null,
      notes: item.bom_header.notes || '',
    });
    setComponentsList(item.components || []);
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [bomRes, invRes] = await Promise.all([
        api.get('/bom-costing/products'),
        api.get('/inventory/items').catch(() => ({ data: { inventory_items: [], supplies: [] } })),
      ]);

      const prods: ProductBom[] = bomRes.data?.products || [];
      setProducts(prods);
      setInventoryItems(invRes.data?.inventory_items || []);
      setSupplyItems(invRes.data?.supplies || []);

      if (prods.length > 0) {
        selectProduct(prods[0]);
      }
    } catch {
      toast.error('Failed to load BOM & Costing data');
    }
  }, [selectProduct]);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.get('/bom-costing/products'),
      api.get('/inventory/items').catch(() => ({ data: { inventory_items: [], supplies: [] } })),
    ])
      .then(([bomRes, invRes]) => {
        if (!active) return;
        const prods: ProductBom[] = bomRes.data?.products || [];
        setProducts(prods);
        setInventoryItems(invRes.data?.inventory_items || []);
        setSupplyItems(invRes.data?.supplies || []);

        if (prods.length > 0) {
          selectProduct(prods[0]);
        }
      })
      .catch(() => {
        if (active) toast.error('Failed to load BOM & Costing data');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectProduct]);

  const addComponentLine = () => {
    if (inventoryItems.length > 0) {
      const first = inventoryItems[0];
      setComponentsList([
        ...componentsList,
        {
          target_type: 'inventory',
          target_id: first.id,
          component_name: first.name,
          unit: first.unit || 'g',
          net_quantity: 1,
          waste_pct: 0,
          live_unit_cost: Number(first.cost_per_unit || 0),
        },
      ]);
    } else if (supplyItems.length > 0) {
      const first = supplyItems[0];
      setComponentsList([
        ...componentsList,
        {
          target_type: 'supply',
          target_id: first.id,
          component_name: first.name,
          unit: first.base_unit || 'each',
          net_quantity: 1,
          waste_pct: 0,
          live_unit_cost: Number(first.cost_cents || 0) / 100,
        },
      ]);
    }
  };

  const updateComponent = (index: number, patch: Partial<BomComponent>) => {
    const next = [...componentsList];
    next[index] = { ...next[index], ...patch };

    // Auto update name/unit/cost if target_id changed
    if (patch.target_id) {
      if (next[index].target_type === 'inventory') {
        const item = inventoryItems.find((i) => i.id === patch.target_id);
        if (item) {
          next[index].component_name = item.name;
          next[index].unit = item.unit;
          next[index].live_unit_cost = Number(item.cost_per_unit || 0);
        }
      } else {
        const item = supplyItems.find((s) => s.id === patch.target_id);
        if (item) {
          next[index].component_name = item.name;
          next[index].unit = item.base_unit;
          next[index].live_unit_cost = Number(item.cost_cents || 0) / 100;
        }
      }
    }

    setComponentsList(next);
  };

  const removeComponent = (index: number) => {
    setComponentsList(componentsList.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!selectedProduct) return;
    setSaving(true);
    try {
      await api.put(`/bom-costing/product/${selectedProduct.product.id}`, {
        header: headerForm,
        components: componentsList,
      });
      toast.success('BOM costing saved successfully!');
      loadData();
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : null;
      toast.error(msg || 'Failed to save BOM costing');
    } finally {
      setSaving(false);
    }
  };

  // Live calculations for the edit screen
  const yieldPortions = Math.max(0.1, Number(headerForm.yield_portions) || 1);
  const enrichedLines = useMemo(() => {
    return componentsList.map((c) => {
      const net = Number(c.net_quantity) || 0;
      const waste = Math.min(99, Math.max(0, Number(c.waste_pct) || 0));
      const gross = net / (1 - waste / 100);
      const unitCost = Number(c.live_unit_cost) || 0;
      const lineCost = gross * unitCost;
      return { ...c, gross, lineCost, unitCost };
    });
  }, [componentsList]);

  const liveMaterialCost = useMemo(() => {
    return enrichedLines.reduce((acc, line) => acc + line.lineCost, 0);
  }, [enrichedLines]);

  const livePrepLaborCost = (Number(headerForm.prep_time_minutes || 0) / 60) * Number(headerForm.direct_labor_rate_per_hour || 0);
  const liveDirectCostPerPortion = (liveMaterialCost + livePrepLaborCost) / yieldPortions;
  const liveOverhead = headerForm.indirect_overhead_override !== null && headerForm.indirect_overhead_override !== undefined
    ? Number(headerForm.indirect_overhead_override)
    : Number(selectedProduct?.costing.allocated_indirect_overhead || 0);
  const liveFullyLoadedCost = liveDirectCostPerPortion + liveOverhead;
  const price = Number(selectedProduct?.product.price || 0);
  const liveFoodCostPct = price > 0 ? (liveDirectCostPerPortion / price) * 100 : 0;
  const liveContributionMargin = price - liveFullyLoadedCost;
  const liveExceedsTarget = liveFoodCostPct > Number(headerForm.target_food_cost_pct || 30);

  const filteredProducts = products.filter((p) =>
    p.product.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.product.category_name && p.product.category_name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="flex h-full flex-col p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Layers className="size-6 text-brand" />
            Recipe BOM & Direct/Indirect Costing
          </h1>
          <p className="text-sm text-muted-foreground">
            Multi-line Bill of Materials, waste factor scaling, prep labor rates, and overhead allocation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={handleSave}
            disabled={saving || !selectedProduct}
            className="flex items-center gap-1.5"
          >
            <Save className="size-4" />
            {saving ? 'Saving...' : 'Save Recipe BOM'}
          </Button>
        </div>
      </div>

      {/* Master - Detail Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0">
        {/* Left Column: Product Selection List */}
        <div className="lg:col-span-4 flex flex-col bg-card border border-border rounded-xl overflow-hidden shadow-xs">
          <div className="p-3 border-b border-border bg-muted/40">
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search menu products..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full ps-9 pe-3 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-border">
            {filteredProducts.map((item) => {
              const isSelected = selectedProduct?.product.id === item.product.id;
              const costing = item.costing;
              return (
                <button
                  key={item.product.id}
                  type="button"
                  onClick={() => selectProduct(item)}
                  className={`w-full text-start p-3.5 transition-colors flex items-start justify-between gap-2 ${
                    isSelected ? 'bg-accent/60 border-s-4 border-brand' : 'hover:bg-muted/30'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-foreground truncate">{item.product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.product.category_name || 'General'} • Price: {fmtCurrency(item.product.price)}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Direct: {fmtCurrency(costing.total_direct_cost)} • Loaded: {fmtCurrency(costing.fully_loaded_unit_cost)}
                    </p>
                  </div>
                  <div className="shrink-0 text-end">
                    <Badge
                      variant={costing.exceeds_target ? 'destructive' : 'secondary'}
                      className="text-[10px] font-bold px-1.5 py-0.5"
                    >
                      {costing.direct_food_cost_pct.toFixed(1)}% FC
                    </Badge>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Margin: {fmtCurrency(costing.net_contribution_margin)}
                    </p>
                  </div>
                </button>
              );
            })}
            {filteredProducts.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No products found
              </div>
            )}
          </div>
        </div>

        {/* Right Column: BOM Detail & Costing Calculator */}
        <div className="lg:col-span-8 flex flex-col space-y-4 overflow-y-auto">
          {selectedProduct ? (
            <>
              {/* Product Header & Live KPI Cards */}
              <div className="bg-card border border-border rounded-xl p-4 shadow-xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                  <div>
                    <h2 className="text-lg font-bold text-foreground">{selectedProduct.product.name}</h2>
                    <p className="text-xs text-muted-foreground">
                      Menu Price: <span className="font-semibold text-foreground">{fmtCurrency(selectedProduct.product.price)}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={liveExceedsTarget ? 'destructive' : 'outline'}
                      className="text-xs font-semibold px-2 py-0.5 flex items-center gap-1"
                    >
                      {liveExceedsTarget ? (
                        <>
                          <AlertTriangle className="size-3 text-destructive" />
                          Exceeds Target Food Cost ({liveFoodCostPct.toFixed(1)}% &gt; {headerForm.target_food_cost_pct}%)
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="size-3 text-green-500" />
                          Food Cost In Target ({liveFoodCostPct.toFixed(1)}% ≤ {headerForm.target_food_cost_pct}%)
                        </>
                      )}
                    </Badge>
                  </div>
                </div>

                {/* 4 Live Cost Metrics */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-3 bg-muted/40 rounded-lg border border-border/60">
                    <span className="text-[11px] font-medium text-muted-foreground">Direct Material</span>
                    <p className="text-sm font-bold text-foreground mt-0.5">{fmtCurrency(liveMaterialCost)}</p>
                    <span className="text-[10px] text-muted-foreground">Raw ingredients & pack</span>
                  </div>
                  <div className="p-3 bg-muted/40 rounded-lg border border-border/60">
                    <span className="text-[11px] font-medium text-muted-foreground">Prep Labor Cost</span>
                    <p className="text-sm font-bold text-foreground mt-0.5">{fmtCurrency(livePrepLaborCost)}</p>
                    <span className="text-[10px] text-muted-foreground">{headerForm.prep_time_minutes} min @ {fmtCurrency(headerForm.direct_labor_rate_per_hour)}/hr</span>
                  </div>
                  <div className="p-3 bg-muted/40 rounded-lg border border-border/60">
                    <span className="text-[11px] font-medium text-muted-foreground">Allocated Overhead</span>
                    <p className="text-sm font-bold text-foreground mt-0.5">{fmtCurrency(liveOverhead)}</p>
                    <span className="text-[10px] text-muted-foreground">Rent, utilities, depreciation</span>
                  </div>
                  <div className="p-3 bg-brand/10 rounded-lg border border-brand/30">
                    <span className="text-[11px] font-medium text-brand">Fully Loaded Cost</span>
                    <p className="text-sm font-bold text-brand mt-0.5">{fmtCurrency(liveFullyLoadedCost)}</p>
                    <span className="text-[10px] text-brand/80">Margin: {fmtCurrency(liveContributionMargin)}</span>
                  </div>
                </div>
              </div>

              {/* Header Parameter Controls */}
              <div className="bg-card border border-border rounded-xl p-4 shadow-xs space-y-3">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  BOM Production & Labor Parameters
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs font-medium text-foreground">Yield (Portions)</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={headerForm.yield_portions}
                      onChange={(e) => setHeaderForm({ ...headerForm, yield_portions: parseFloat(e.target.value) || 1 })}
                      className="mt-1 w-full p-2 text-xs bg-background border border-border rounded-md"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-foreground">Prep Minutes</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={headerForm.prep_time_minutes}
                      onChange={(e) => setHeaderForm({ ...headerForm, prep_time_minutes: parseFloat(e.target.value) || 0 })}
                      className="mt-1 w-full p-2 text-xs bg-background border border-border rounded-md"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-foreground">Labor Rate / Hr</label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={headerForm.direct_labor_rate_per_hour}
                      onChange={(e) => setHeaderForm({ ...headerForm, direct_labor_rate_per_hour: parseFloat(e.target.value) || 0 })}
                      className="mt-1 w-full p-2 text-xs bg-background border border-border rounded-md"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-foreground">Target Food Cost %</label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      max="100"
                      value={headerForm.target_food_cost_pct}
                      onChange={(e) => setHeaderForm({ ...headerForm, target_food_cost_pct: parseFloat(e.target.value) || 30 })}
                      className="mt-1 w-full p-2 text-xs bg-background border border-border rounded-md"
                    />
                  </div>
                </div>
              </div>

              {/* Multi-Line Component Table */}
              <div className="bg-card border border-border rounded-xl p-4 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Bill of Materials (BOM) Lines</h3>
                    <p className="text-xs text-muted-foreground">
                      Gross depletion is automatically scaled by waste %: <span className="font-mono">Gross = Net / (1 - Waste%)</span>
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addComponentLine}
                    className="flex items-center gap-1 text-xs"
                  >
                    <Plus className="size-3.5" />
                    Add Ingredient Line
                  </Button>
                </div>

                <div className="overflow-x-auto border border-border rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-muted text-muted-foreground font-semibold">
                      <tr>
                        <th className="p-2.5 text-start">Component</th>
                        <th className="p-2.5 text-start">Target Type</th>
                        <th className="p-2.5 text-end">Net Qty</th>
                        <th className="p-2.5 text-start">Unit</th>
                        <th className="p-2.5 text-end">Waste %</th>
                        <th className="p-2.5 text-end">Gross Depletion</th>
                        <th className="p-2.5 text-end">Live Cost</th>
                        <th className="p-2.5 text-end">Line Total</th>
                        <th className="p-2.5 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {enrichedLines.map((line, idx) => (
                        <tr key={idx} className="hover:bg-muted/20">
                          <td className="p-2.5">
                            <select
                              value={line.target_id}
                              onChange={(e) => updateComponent(idx, { target_id: e.target.value })}
                              className="w-full p-1.5 bg-background border border-border rounded text-xs"
                            >
                              <optgroup label="Raw Inventory">
                                {inventoryItems.map((inv) => (
                                  <option key={inv.id} value={inv.id}>
                                    {inv.name} ({inv.unit})
                                  </option>
                                ))}
                              </optgroup>
                              <optgroup label="Packaging & Supplies">
                                {supplyItems.map((sup) => (
                                  <option key={sup.id} value={sup.id}>
                                    {sup.name} ({sup.base_unit})
                                  </option>
                                ))}
                              </optgroup>
                            </select>
                          </td>
                          <td className="p-2.5">
                            <span className="capitalize text-muted-foreground">
                              {line.target_type}
                            </span>
                          </td>
                          <td className="p-2.5 text-end">
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={line.net_quantity}
                              onChange={(e) => updateComponent(idx, { net_quantity: parseFloat(e.target.value) || 0 })}
                              className="w-20 p-1 bg-background border border-border rounded text-end text-xs"
                            />
                          </td>
                          <td className="p-2.5 text-muted-foreground">{line.unit}</td>
                          <td className="p-2.5 text-end">
                            <input
                              type="number"
                              step="1"
                              min="0"
                              max="99"
                              value={line.waste_pct}
                              onChange={(e) => updateComponent(idx, { waste_pct: parseFloat(e.target.value) || 0 })}
                              className="w-16 p-1 bg-background border border-border rounded text-end text-xs"
                            />
                          </td>
                          <td className="p-2.5 text-end font-mono font-medium text-foreground">
                            {line.gross.toFixed(2)}
                          </td>
                          <td className="p-2.5 text-end text-muted-foreground">
                            {fmtCurrency(line.unitCost)}
                          </td>
                          <td className="p-2.5 text-end font-semibold text-foreground">
                            {fmtCurrency(line.lineCost)}
                          </td>
                          <td className="p-2.5 text-center">
                            <button
                              type="button"
                              onClick={() => removeComponent(idx)}
                              className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                              title="Remove component"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {enrichedLines.length === 0 && (
                        <tr>
                          <td colSpan={9} className="p-6 text-center text-muted-foreground">
                            No BOM component lines added yet. Click &quot;Add Ingredient Line&quot; to configure recipe materials.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-12 text-center bg-card border border-border rounded-xl">
              <p className="text-sm text-muted-foreground">Select a product from the list to view and edit its BOM</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
