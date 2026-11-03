'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '@/lib/api';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import toast from 'react-hot-toast';
import { useTranslations } from 'use-intl';
import {
  Layers,
  Search,
  Plus,
  Trash2,
  Save,
  AlertTriangle,
  CheckCircle2,
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
  variant_id?: string | null;
  addon_id?: string | null;
  portion_multiplier?: number;
  replaces_target_id?: string | null;
}

interface PrepRecipeComponent {
  id?: string;
  target_type: 'inventory' | 'supply';
  target_id: string;
  component_name: string;
  unit: string;
  net_quantity: number;
  waste_pct: number;
  gross_quantity?: number;
}

interface PrepRecipe {
  id: string;
  name: string;
  output_target_type: string;
  output_target_id: string;
  yield_quantity: number;
  yield_unit: string;
  prep_time_minutes: number;
  labor_rate_per_hour: number;
  shelf_life_hours: number;
  storage_area: string;
  notes?: string;
  components: PrepRecipeComponent[];
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
  const t = useTranslations('bomCosting');
  const tCommon = useTranslations('common');
  const fmtCurrency = useFormatCurrency();

  const [activeTab, setActiveTab] = useState<'bom' | 'prep'>('bom');
  const [products, setProducts] = useState<ProductBom[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductBom | null>(null);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  // Available inventory & supplies for adding lines
  const [inventoryItems, setInventoryItems] = useState<Array<{ id: string; name: string; unit: string; cost_per_unit?: number }>>([]);
  const [supplyItems, setSupplyItems] = useState<Array<{ id: string; name: string; base_unit: string; cost_cents?: number }>>([]);

  // Prep Recipes state
  const [prepRecipes, setPrepRecipes] = useState<PrepRecipe[]>([]);
  const [loadingPrep, setLoadingPrep] = useState(false);
  const [showProduceModal, setShowProduceModal] = useState<PrepRecipe | null>(null);
  const [produceMultiplier, setProduceMultiplier] = useState(1);
  const [producing, setProducing] = useState(false);
  const [showNewPrepModal, setShowNewPrepModal] = useState(false);
  const [newPrepForm, setNewPrepForm] = useState({
    name: '',
    output_target_id: '',
    yield_quantity: 1000,
    yield_unit: 'ml',
    prep_time_minutes: 20,
    labor_rate_per_hour: 60,
    shelf_life_hours: 48,
    storage_area: 'Walk-In Chiller',
    notes: '',
    components: [] as PrepRecipeComponent[],
  });

  const loadPrepRecipes = useCallback(async () => {
    setLoadingPrep(true);
    try {
      const res = await api.get('/bom-costing/prep-recipes');
      setPrepRecipes(res.data?.prep_recipes || []);
    } catch {
      toast.error('Failed to load prep recipes');
    } finally {
      setLoadingPrep(false);
    }
  }, []);

  const handleProduceBatch = async () => {
    if (!showProduceModal) return;
    setProducing(true);
    try {
      const res = await api.post(`/bom-costing/prep-recipes/${showProduceModal.id}/produce`, {
        batches_multiplier: produceMultiplier,
        produced_by: 'manager',
      });
      toast.success(`Produced ${res.data.produced_quantity} ${showProduceModal.yield_unit}! Unit Cost: ${fmtCurrency(res.data.unit_cost)}`);
      setShowProduceModal(null);
      setProduceMultiplier(1);
      loadPrepRecipes();
    } catch (err: unknown) {
      const errorMsg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(errorMsg || 'Failed to produce prep batch');
    } finally {
      setProducing(false);
    }
  };

  const handleCreatePrepRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPrepForm.name || !newPrepForm.output_target_id) {
      toast.error('Name and Output Prepared SKU are required');
      return;
    }
    try {
      await api.post('/bom-costing/prep-recipes', newPrepForm);
      toast.success('Prep batch recipe created!');
      setShowNewPrepModal(false);
      loadPrepRecipes();
    } catch (err: unknown) {
      const errorMsg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(errorMsg || 'Failed to create prep recipe');
    }
  };

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
      toast.error(t('loadError'));
    }
  }, [selectProduct, t]);

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
        if (active) toast.error(t('loadError'));
      });

    return () => {
      active = false;
    };
  }, [selectProduct, t]);

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
      toast.success(t('saveSuccess'));
      loadData();
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : null;
      toast.error(msg || t('saveError'));
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
            {t('title')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border p-1 bg-muted/40">
            <button
              type="button"
              onClick={() => setActiveTab('bom')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                activeTab === 'bom' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Product BOM Recipes
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('prep');
                if (prepRecipes.length === 0) loadPrepRecipes();
              }}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                activeTab === 'prep' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Prep Batches & Sub-Recipes
            </button>
          </div>
          {activeTab === 'bom' ? (
            <Button
              variant="default"
              size="sm"
              onClick={handleSave}
              disabled={saving || !selectedProduct}
              className="flex items-center gap-1.5"
            >
              <Save className="size-4" />
              {saving ? t('saving') : t('btnSaveRecipe')}
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={() => setShowNewPrepModal(true)}
              className="flex items-center gap-1.5 bg-brand text-white"
            >
              <Plus className="size-4" />
              New Prep Recipe
            </Button>
          )}
        </div>
      </div>

      {activeTab === 'prep' ? (
        /* Prep Batches & Sub-Recipes Tab */
        <div className="space-y-4 flex-1 min-h-0 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {prepRecipes.map((prep) => (
              <div key={prep.id} className="bg-card border border-border rounded-xl p-4 shadow-xs flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold text-base text-foreground">{prep.name}</h3>
                    <Badge variant="outline" className="text-[11px] font-semibold text-brand">
                      {prep.yield_quantity} {prep.yield_unit}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Storage: <span className="font-medium text-foreground">{prep.storage_area}</span> • Shelf Life: <span className="font-medium text-foreground">{prep.shelf_life_hours}h</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Prep Time: {prep.prep_time_minutes} min • Labor Rate: {fmtCurrency(prep.labor_rate_per_hour)}/hr
                  </p>

                  <div className="mt-3 border-t border-border/60 pt-2">
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase">Raw Ingredients ({prep.components?.length || 0}):</span>
                    <ul className="text-xs space-y-1 mt-1 text-muted-foreground max-h-24 overflow-y-auto">
                      {(prep.components || []).map((c, i) => (
                        <li key={i} className="flex justify-between">
                          <span>{c.component_name}</span>
                          <span className="font-mono">{c.gross_quantity || c.net_quantity} {c.unit}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="pt-2 border-t border-border flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Produces into Inventory SKU</span>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => {
                      setShowProduceModal(prep);
                      setProduceMultiplier(1);
                    }}
                    className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                  >
                    Produce Batch
                  </Button>
                </div>
              </div>
            ))}
            {prepRecipes.length === 0 && !loadingPrep && (
              <div className="col-span-full py-12 text-center text-muted-foreground bg-card border border-border rounded-xl">
                No prep recipes configured yet. Click &quot;New Prep Recipe&quot; above to create one.
              </div>
            )}
          </div>

          {/* Produce Batch Modal */}
          {showProduceModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
              <div className="w-full max-w-md rounded-2xl bg-card border border-border p-6 shadow-2xl animate-in fade-in zoom-in-95 space-y-4">
                <h3 className="font-bold text-lg text-foreground">Produce Batch: {showProduceModal.name}</h3>
                <p className="text-xs text-muted-foreground">
                  Will deduct raw ingredients from stock, increment prepared SKU in inventory, and auto-register an active perishable lot in HACCP batches.
                </p>

                <div>
                  <label className="text-xs font-semibold uppercase text-muted-foreground block mb-1">
                    Batch Multiplier (Base Yield: {showProduceModal.yield_quantity} {showProduceModal.yield_unit})
                  </label>
                  <div className="flex gap-2">
                    {[1, 2, 3, 5].map((mult) => (
                      <button
                        key={mult}
                        type="button"
                        onClick={() => setProduceMultiplier(mult)}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-lg border ${
                          produceMultiplier === mult ? 'bg-brand text-white border-brand' : 'border-border bg-background'
                        }`}
                      >
                        {mult}x ({showProduceModal.yield_quantity * mult} {showProduceModal.yield_unit})
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowProduceModal(null)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={producing}
                    onClick={handleProduceBatch}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {producing ? 'Producing...' : 'Confirm Production'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* New Prep Recipe Modal */}
          {showNewPrepModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
              <div className="w-full max-w-lg rounded-2xl bg-card border border-border p-6 shadow-2xl animate-in fade-in zoom-in-95 space-y-4 max-h-[90vh] overflow-y-auto">
                <h3 className="font-bold text-lg text-foreground">Create Prep Recipe (Sub-Recipe)</h3>
                <form onSubmit={handleCreatePrepRecipe} className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold uppercase text-muted-foreground block mb-1">Recipe Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Cold Brew Concentrate"
                      value={newPrepForm.name}
                      onChange={(e) => setNewPrepForm({ ...newPrepForm, name: e.target.value })}
                      className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold uppercase text-muted-foreground block mb-1">Target Prepared SKU in Inventory</label>
                    <select
                      value={newPrepForm.output_target_id}
                      onChange={(e) => setNewPrepForm({ ...newPrepForm, output_target_id: e.target.value })}
                      className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                      required
                    >
                      <option value="">Select prepared SKU...</option>
                      {inventoryItems.map((inv) => (
                        <option key={inv.id} value={inv.id}>{inv.name} ({inv.unit})</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold uppercase text-muted-foreground block mb-1">Yield Quantity</label>
                      <input
                        type="number"
                        min="1"
                        value={newPrepForm.yield_quantity}
                        onChange={(e) => setNewPrepForm({ ...newPrepForm, yield_quantity: Number(e.target.value) || 1 })}
                        className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase text-muted-foreground block mb-1">Yield Unit</label>
                      <input
                        type="text"
                        value={newPrepForm.yield_unit}
                        onChange={(e) => setNewPrepForm({ ...newPrepForm, yield_unit: e.target.value })}
                        className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold uppercase text-muted-foreground block mb-1">Shelf Life (Hours)</label>
                      <input
                        type="number"
                        min="1"
                        value={newPrepForm.shelf_life_hours}
                        onChange={(e) => setNewPrepForm({ ...newPrepForm, shelf_life_hours: Number(e.target.value) || 24 })}
                        className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase text-muted-foreground block mb-1">Storage Area</label>
                      <input
                        type="text"
                        value={newPrepForm.storage_area}
                        onChange={(e) => setNewPrepForm({ ...newPrepForm, storage_area: e.target.value })}
                        className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                        required
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button type="button" variant="outline" onClick={() => setShowNewPrepModal(false)} className="flex-1">
                      Cancel
                    </Button>
                    <Button type="submit" className="flex-1 bg-brand text-white">
                      Save Prep Recipe
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Master - Detail Layout for BOM */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0">
          {/* Left Column: Product Selection List */}
          <div className="lg:col-span-4 flex flex-col bg-card border border-border rounded-xl overflow-hidden shadow-xs">
            <div className="p-3 border-b border-border bg-muted/40">
              <div className="relative">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder={t('searchPlaceholder')}
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
                        {item.product.category_name || 'General'} • {t('kpiSellingPrice')}: {fmtCurrency(item.product.price)}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {t('badgeDirect')}: {fmtCurrency(costing.total_direct_cost)} • {t('kpiFullyLoadedCost')}: {fmtCurrency(costing.fully_loaded_unit_cost)}
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
                        {t('kpiContributionMargin')}: {fmtCurrency(costing.net_contribution_margin)}
                      </p>
                    </div>
                  </button>
                );
              })}
              {filteredProducts.length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  {t('noComponents')}
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
                        {t('kpiSellingPrice')}: <span className="font-semibold text-foreground">{fmtCurrency(selectedProduct.product.price)}</span>
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
                            {t('targetExceeded', { target: headerForm.target_food_cost_pct })} ({liveFoodCostPct.toFixed(1)}%)
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="size-3 text-green-500" />
                            {t('targetHealthy', { target: headerForm.target_food_cost_pct })} ({liveFoodCostPct.toFixed(1)}%)
                          </>
                        )}
                      </Badge>
                    </div>
                  </div>

                  {/* 4 Live Cost Metrics */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-3 bg-muted/40 rounded-lg border border-border/60">
                      <span className="text-[11px] font-medium text-muted-foreground">{t('kpiDirectMaterial')}</span>
                      <p className="text-sm font-bold text-foreground mt-0.5">{fmtCurrency(liveMaterialCost)}</p>
                    </div>
                    <div className="p-3 bg-muted/40 rounded-lg border border-border/60">
                      <span className="text-[11px] font-medium text-muted-foreground">{t('kpiDirectLabor')}</span>
                      <p className="text-sm font-bold text-foreground mt-0.5">{fmtCurrency(livePrepLaborCost)}</p>
                    </div>
                    <div className="p-3 bg-muted/40 rounded-lg border border-border/60">
                      <span className="text-[11px] font-medium text-muted-foreground">{t('kpiAllocatedOverhead')}</span>
                      <p className="text-sm font-bold text-foreground mt-0.5">{fmtCurrency(liveOverhead)}</p>
                    </div>
                    <div className="p-3 bg-brand/10 rounded-lg border border-brand/30">
                      <span className="text-[11px] font-medium text-brand">{t('kpiFullyLoadedCost')}</span>
                      <p className="text-sm font-bold text-brand mt-0.5">{fmtCurrency(liveFullyLoadedCost)}</p>
                    </div>
                  </div>
                </div>

                {/* Header Parameter Controls */}
                <div className="bg-card border border-border rounded-xl p-4 shadow-xs space-y-3">
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    {t('tabCostingSettings')}
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="text-xs font-medium text-foreground">{t('lblYieldPortions')}</label>
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
                      <label className="text-xs font-medium text-foreground">{t('lblPrepTime')}</label>
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
                      <label className="text-xs font-medium text-foreground">{t('lblLaborRate')}</label>
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
                      <label className="text-xs font-medium text-foreground">{t('lblTargetFoodCost')}</label>
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
                      <h3 className="text-sm font-bold text-foreground">{t('tabIngredients', { count: enrichedLines.length })}</h3>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={addComponentLine}
                      className="flex items-center gap-1 text-xs"
                    >
                      <Plus className="size-3.5" />
                      {t('btnAddLine')}
                    </Button>
                  </div>

                  <div className="overflow-x-auto border border-border rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="bg-muted text-muted-foreground font-semibold">
                        <tr>
                          <th className="p-2.5 text-start">{t('colComponent')}</th>
                          <th className="p-2.5 text-start">{t('colType')}</th>
                          <th className="p-2.5 text-end">{t('colNetQty')}</th>
                          <th className="p-2.5 text-start">Unit</th>
                          <th className="p-2.5 text-end">{t('colWaste')}</th>
                          <th className="p-2.5 text-start">Modifier / Addon</th>
                          <th className="p-2.5 text-start">Replaces</th>
                          <th className="p-2.5 text-end">{t('colUnitCost')}</th>
                          <th className="p-2.5 text-end">{t('colLineCost')}</th>
                          <th className="p-2.5 text-center">{tCommon('delete')}</th>
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
                                className="w-16 p-1 bg-background border border-border rounded text-end text-xs"
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
                                className="w-12 p-1 bg-background border border-border rounded text-end text-xs"
                              />
                            </td>
                            <td className="p-2.5">
                              <input
                                type="text"
                                placeholder="Addon link"
                                value={line.addon_id || ''}
                                onChange={(e) => updateComponent(idx, { addon_id: e.target.value || null })}
                                className="w-24 p-1 bg-background border border-border rounded text-xs"
                              />
                            </td>
                            <td className="p-2.5">
                              <select
                                value={line.replaces_target_id || ''}
                                onChange={(e) => updateComponent(idx, { replaces_target_id: e.target.value || null })}
                                className="w-28 p-1 bg-background border border-border rounded text-xs"
                              >
                                <option value="">None (Standard)</option>
                                {inventoryItems.map((inv) => (
                                  <option key={inv.id} value={inv.id}>Replaces: {inv.name}</option>
                                ))}
                              </select>
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
                            <td colSpan={10} className="p-6 text-center text-muted-foreground">
                              {t('noComponents')}
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
                <p className="text-sm text-muted-foreground">{t('noComponents')}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
