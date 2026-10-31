'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useFormatDate } from '@/hooks/useFormatDate';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import toast from 'react-hot-toast';
import { useTranslations } from 'use-intl';
import {
  Truck,
  Plus,
  PackageCheck,
  Building,
  CheckCircle2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';

interface Supplier {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  category: string | null;
  payment_terms: string;
  lead_time_days: number;
  balance_due: number;
  is_active: number;
}

interface PurchaseOrderItem {
  id: string;
  target_type: 'inventory' | 'supply';
  target_id: string;
  item_name: string;
  unit: string;
  ordered_qty: number;
  received_qty: number;
  unit_cost: number;
  line_total: number;
  batch_lot_number?: string;
  expiry_date?: string;
}

interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string;
  supplier_name?: string;
  status: 'draft' | 'ordered' | 'received' | 'cancelled';
  total_amount: number;
  expected_date: string | null;
  received_at: string | null;
  received_by_name?: string | null;
  created_at: string;
  items?: PurchaseOrderItem[];
}

export function PurchasingManager() {
  const t = useTranslations('purchasing');
  const tCommon = useTranslations('common');
  const fmtCurrency = useFormatCurrency();
  const { formatDate } = useFormatDate();

  const [activeSubTab, setActiveSubTab] = useState<'orders' | 'suppliers'>('orders');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // New Supplier Modal
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [supplierForm, setSupplierForm] = useState({
    name: '',
    contact_person: '',
    phone: '',
    email: '',
    category: 'Produce & Dairy',
    payment_terms: 'COD',
    lead_time_days: 1,
  });

  // New PO Modal
  const [showPoModal, setShowPoModal] = useState(false);
  const [availableItems, setAvailableItems] = useState<Array<{ target_type: 'inventory' | 'supply'; id: string; name: string; unit: string; cost: number }>>([]);
  const [poForm, setPoForm] = useState<{
    supplier_id: string;
    expected_date: string;
    notes: string;
    items: {
      target_type: 'inventory' | 'supply';
      target_id: string;
      item_name: string;
      unit: string;
      ordered_qty: number;
      unit_cost: number;
    }[];
  }>({
    supplier_id: '',
    expected_date: '',
    notes: '',
    items: [],
  });

  // Receiving GRN Modal
  const [receivingPo, setReceivingPo] = useState<PurchaseOrder | null>(null);
  const [payFromDrawer, setPayFromDrawer] = useState(false);
  const [isReceiving, setIsReceiving] = useState(false);

  const getErrorMessage = (err: unknown, fallback: string): string => {
    if (err && typeof err === 'object' && 'response' in err) {
      const res = (err as { response?: { data?: { error?: string } } }).response;
      if (res?.data?.error) return res.data.error;
    }
    if (err instanceof Error) return err.message;
    return fallback;
  };

  const loadData = useCallback(async () => {
    try {
      const [supRes, poRes, invRes] = await Promise.all([
        api.get('/purchasing/suppliers'),
        api.get('/purchasing/purchase-orders'),
        api.get('/inventory/items').catch(() => ({ data: { inventory_items: [], supplies: [] } })),
      ]);

      const loadedSuppliers = supRes.data?.suppliers || [];
      setSuppliers(loadedSuppliers);
      setPurchaseOrders(poRes.data?.purchase_orders || []);

      const invs = ((invRes.data?.inventory_items || []) as Array<{ id: string; name: string; unit: string; cost_per_unit?: number }>).map((i) => ({
        target_type: 'inventory' as const,
        id: i.id,
        name: i.name,
        unit: i.unit,
        cost: Number(i.cost_per_unit || 0),
      }));
      const sups = ((invRes.data?.supplies || []) as Array<{ id: string; name: string; base_unit: string; cost_cents?: number }>).map((s) => ({
        target_type: 'supply' as const,
        id: s.id,
        name: s.name,
        unit: s.base_unit,
        cost: Number(s.cost_cents || 0) / 100,
      }));
      setAvailableItems([...invs, ...sups]);
    } catch {
      toast.error(t('loadDataError'));
    }
  }, [t]);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.get('/purchasing/suppliers'),
      api.get('/purchasing/purchase-orders'),
      api.get('/inventory/items').catch(() => ({ data: { inventory_items: [], supplies: [] } })),
    ])
      .then(([supRes, poRes, invRes]) => {
        if (!active) return;
        const loadedSuppliers = supRes.data?.suppliers || [];
        setSuppliers(loadedSuppliers);
        setPurchaseOrders(poRes.data?.purchase_orders || []);

        const invs = ((invRes.data?.inventory_items || []) as Array<{ id: string; name: string; unit: string; cost_per_unit?: number }>).map((i) => ({
          target_type: 'inventory' as const,
          id: i.id,
          name: i.name,
          unit: i.unit,
          cost: Number(i.cost_per_unit || 0),
        }));
        const sups = ((invRes.data?.supplies || []) as Array<{ id: string; name: string; base_unit: string; cost_cents?: number }>).map((s) => ({
          target_type: 'supply' as const,
          id: s.id,
          name: s.name,
          unit: s.base_unit,
          cost: Number(s.cost_cents || 0) / 100,
        }));
        setAvailableItems([...invs, ...sups]);

        if (loadedSuppliers.length > 0) {
          setPoForm((prev) => (prev.supplier_id ? prev : { ...prev, supplier_id: loadedSuppliers[0].id }));
        }
      })
      .catch(() => {
        if (active) toast.error(t('loadDataError'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [t]);

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/purchasing/suppliers', supplierForm);
      toast.success(t('supplierCreated'));
      setShowSupplierModal(false);
      setSupplierForm({
        name: '',
        contact_person: '',
        phone: '',
        email: '',
        category: 'Produce & Dairy',
        payment_terms: 'COD',
        lead_time_days: 1,
      });
      loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, t('loadDataError')));
    }
  };

  const handleAddItemToPo = () => {
    if (availableItems.length === 0) return;
    const first = availableItems[0];
    setPoForm({
      ...poForm,
      items: [
        ...poForm.items,
        {
          target_type: first.target_type,
          target_id: first.id,
          item_name: first.name,
          unit: first.unit,
          ordered_qty: 1,
          unit_cost: first.cost,
        },
      ],
    });
  };

  const handleCreatePo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (poForm.items.length === 0) {
      toast.error(t('addItemRequired'));
      return;
    }
    try {
      await api.post('/purchasing/purchase-orders', poForm);
      toast.success(t('poCreated'));
      setShowPoModal(false);
      setPoForm({
        supplier_id: suppliers[0]?.id || '',
        expected_date: '',
        notes: '',
        items: [],
      });
      loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, t('loadDataError')));
    }
  };

  const handleReceiveDelivery = async () => {
    if (!receivingPo) return;
    try {
      setIsReceiving(true);
      let activeShiftId: number | null = null;
      if (payFromDrawer) {
        try {
          const sessionRes = await api.get('/cash-sessions/active');
          activeShiftId = sessionRes.data?.id ?? null;
        } catch {
          // Fallback to backend auto-detection if no open shift
        }
      }
      const res = await api.post(`/purchasing/purchase-orders/${receivingPo.id}/receive`, {
        pay_from_drawer: payFromDrawer,
        shift_id: activeShiftId,
      });
      toast.success(res.data?.message || t('goodsReceivedSuccess'));
      setReceivingPo(null);
      setPayFromDrawer(false);
      loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, t('loadDataError')));
    } finally {
      setIsReceiving(false);
    }
  };

  const handleAutoRestock = async () => {
    try {
      const res = await api.post('/purchasing/purchase-orders/auto-restock-low', {});
      toast.success(res.data?.message || t('autoRestockSuccess'));
      loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, t('autoRestockError')));
    }
  };

  const filteredOrders = purchaseOrders.filter(
    (po) =>
      po.po_number.toLowerCase().includes(search.toLowerCase()) ||
      (po.supplier_name && po.supplier_name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-4">
      {/* Sub Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <Button
            variant={activeSubTab === 'orders' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveSubTab('orders')}
            className="text-xs"
          >
            <Truck className="size-3.5 me-1.5" />
            {t('tabOrders', { count: purchaseOrders.length })}
          </Button>
          <Button
            variant={activeSubTab === 'suppliers' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveSubTab('suppliers')}
            className="text-xs"
          >
            <Building className="size-3.5 me-1.5" />
            {t('tabSuppliers', { count: suppliers.length })}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {activeSubTab === 'orders' && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleAutoRestock}
                className="text-xs flex items-center gap-1.5"
              >
                <RefreshCw className="size-3.5" />
                {t('autoRestockLow')}
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => setShowPoModal(true)}
                className="text-xs flex items-center gap-1.5"
              >
                <Plus className="size-3.5" />
                {t('newPurchaseOrder')}
              </Button>
            </>
          )}
          {activeSubTab === 'suppliers' && (
            <Button
              variant="default"
              size="sm"
              onClick={() => setShowSupplierModal(true)}
              className="text-xs flex items-center gap-1.5"
            >
              <Plus className="size-3.5" />
              {t('addSupplier')}
            </Button>
          )}
        </div>
      </div>

      {/* Orders Tab */}
      {activeSubTab === 'orders' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-xs">
          <div className="p-3 border-b border-border bg-muted/40">
            <div className="relative max-w-sm">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type="text"
                placeholder={t('searchOrdersPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full ps-9 pe-3 py-1.5 text-xs bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted text-muted-foreground font-semibold">
                <tr>
                  <th className="p-3 text-start">{t('colPoNumber')}</th>
                  <th className="p-3 text-start">{t('colSupplier')}</th>
                  <th className="p-3 text-start">{t('colStatus')}</th>
                  <th className="p-3 text-end">{t('colTotalAmount')}</th>
                  <th className="p-3 text-start">{t('colDateCreated')}</th>
                  <th className="p-3 text-start">{t('colExpectedDate')}</th>
                  <th className="p-3 text-end">{t('colAction')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredOrders.map((po) => (
                  <tr key={po.id} className="hover:bg-muted/20">
                    <td className="p-3 font-mono font-bold text-foreground">{po.po_number}</td>
                    <td className="p-3 font-medium text-foreground">{po.supplier_name || 'Direct Vendor'}</td>
                    <td className="p-3">
                      <Badge
                        variant={
                          po.status === 'received'
                            ? 'secondary'
                            : po.status === 'cancelled'
                            ? 'destructive'
                            : 'outline'
                        }
                        className="text-[10px] uppercase font-bold"
                      >
                        {po.status}
                      </Badge>
                    </td>
                    <td className="p-3 text-end font-bold text-foreground">
                      {fmtCurrency(po.total_amount)}
                    </td>
                    <td className="p-3 text-muted-foreground">{formatDate(po.created_at)}</td>
                    <td className="p-3 text-muted-foreground">
                      {po.expected_date ? formatDate(po.expected_date) : '—'}
                    </td>
                    <td className="p-3 text-end">
                      {po.status !== 'received' && po.status !== 'cancelled' ? (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => setReceivingPo(po)}
                          className="text-[11px] h-7 bg-brand hover:bg-brand/90"
                        >
                          <PackageCheck className="size-3.5 me-1" />
                          {t('receiveGrn')}
                        </Button>
                      ) : (
                        <span className="text-[11px] text-muted-foreground flex items-center justify-end gap-1">
                          <CheckCircle2 className="size-3.5 text-green-500" />
                          {t('received')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredOrders.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      {t('noOrdersFound')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Suppliers Tab */}
      {activeSubTab === 'suppliers' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted text-muted-foreground font-semibold">
                <tr>
                  <th className="p-3 text-start">{t('colSupplierName')}</th>
                  <th className="p-3 text-start">{t('colContactPerson')}</th>
                  <th className="p-3 text-start">{t('colPhone')}</th>
                  <th className="p-3 text-start">{t('colCategory')}</th>
                  <th className="p-3 text-start">{t('colTerms')}</th>
                  <th className="p-3 text-end">{t('colLeadTime')}</th>
                  <th className="p-3 text-end">{t('colBalanceDue')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {suppliers.map((sup) => (
                  <tr key={sup.id} className="hover:bg-muted/20">
                    <td className="p-3 font-bold text-foreground">{sup.name}</td>
                    <td className="p-3 text-muted-foreground">{sup.contact_person || '—'}</td>
                    <td className="p-3 text-muted-foreground">{sup.phone || '—'}</td>
                    <td className="p-3 text-muted-foreground">{sup.category || 'General'}</td>
                    <td className="p-3 text-muted-foreground">{sup.payment_terms}</td>
                    <td className="p-3 text-end font-mono">{t('leadTimeDays', { days: sup.lead_time_days })}</td>
                    <td className="p-3 text-end font-bold text-foreground">
                      {fmtCurrency(sup.balance_due)}
                    </td>
                  </tr>
                ))}
                {suppliers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      {t('noSuppliersFound')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Receive GRN Modal */}
      {receivingPo && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl p-5 w-full max-w-md shadow-lg space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <PackageCheck className="size-5 text-brand" />
                <h3 className="text-sm font-bold text-foreground">
                  {t('receiveGrnTitle', { poNumber: receivingPo.po_number })}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setReceivingPo(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-muted-foreground">
                {t('receiveGrnNotice')}
              </p>
              <div className="p-3 bg-muted/40 rounded-lg space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('lblSupplier')}</span>
                  <span className="font-semibold text-foreground">{receivingPo.supplier_name || 'Vendor'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('lblOrderTotal')}</span>
                  <span className="font-bold text-foreground">{fmtCurrency(receivingPo.total_amount)}</span>
                </div>
              </div>

              <label className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={payFromDrawer}
                  onChange={(e) => setPayFromDrawer(e.target.checked)}
                  className="rounded accent-brand size-4"
                />
                <div>
                  <p className="font-semibold text-foreground">{t('payFromDrawer')}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {t('payFromDrawerDesc')}
                  </p>
                </div>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <Button variant="outline" size="sm" onClick={() => setReceivingPo(null)}>
                {t('btnCancel')}
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleReceiveDelivery}
                disabled={isReceiving}
                className="bg-brand hover:bg-brand/90"
              >
                {isReceiving ? t('processing') : t('btnConfirmDelivery')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* New PO Modal */}
      {showPoModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl p-5 w-full max-w-xl shadow-lg space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-bold text-foreground">{t('modalCreatePo')}</h3>
              <button
                type="button"
                onClick={() => setShowPoModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleCreatePo} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-medium text-foreground">{t('colSupplier')}</label>
                  <select
                    value={poForm.supplier_id}
                    onChange={(e) => setPoForm({ ...poForm, supplier_id: e.target.value })}
                    className="w-full mt-1 p-2 bg-background border border-border rounded text-xs"
                    required
                  >
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-medium text-foreground">{t('formExpectedDate')}</label>
                  <input
                    type="date"
                    value={poForm.expected_date}
                    onChange={(e) => setPoForm({ ...poForm, expected_date: e.target.value })}
                    className="w-full mt-1 p-2 bg-background border border-border rounded text-xs"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-foreground">{t('formOrderItems')}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddItemToPo}
                    className="text-xs h-7"
                  >
                    <Plus className="size-3 me-1" /> {t('btnAddItem')}
                  </Button>
                </div>

                <div className="space-y-2">
                  {poForm.items.map((it, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-2 bg-muted/30 rounded border border-border">
                      <select
                        value={it.target_id}
                        onChange={(e) => {
                          const target = availableItems.find((a) => a.id === e.target.value);
                          if (target) {
                            const next = [...poForm.items];
                            next[idx] = {
                              ...next[idx],
                              target_id: target.id,
                              target_type: target.target_type,
                              item_name: target.name,
                              unit: target.unit,
                              unit_cost: target.cost,
                            };
                            setPoForm({ ...poForm, items: next });
                          }
                        }}
                        className="flex-1 p-1 bg-background border border-border rounded text-xs"
                      >
                        {availableItems.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} ({a.unit})
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        step="any"
                        min="0.1"
                        placeholder={t('qtyPlaceholder')}
                        value={it.ordered_qty}
                        onChange={(e) => {
                          const next = [...poForm.items];
                          next[idx].ordered_qty = parseFloat(e.target.value) || 1;
                          setPoForm({ ...poForm, items: next });
                        }}
                        className="w-16 p-1 bg-background border border-border rounded text-xs text-end"
                      />
                      <input
                        type="number"
                        step="any"
                        min="0"
                        placeholder={t('costPlaceholder')}
                        value={it.unit_cost}
                        onChange={(e) => {
                          const next = [...poForm.items];
                          next[idx].unit_cost = parseFloat(e.target.value) || 0;
                          setPoForm({ ...poForm, items: next });
                        }}
                        className="w-20 p-1 bg-background border border-border rounded text-xs text-end"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setPoForm({ ...poForm, items: poForm.items.filter((_, i) => i !== idx) });
                        }}
                        className="p-1 text-muted-foreground hover:text-destructive"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                  {poForm.items.length === 0 && (
                    <p className="text-center text-muted-foreground py-4">{t('emptyPoItems')}</p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowPoModal(false)}>
                  {t('btnCancel')}
                </Button>
                <Button type="submit" variant="default" size="sm">
                  {t('btnSavePo')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Supplier Modal */}
      {showSupplierModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl p-5 w-full max-w-sm shadow-lg space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-bold text-foreground">{t('modalAddSupplier')}</h3>
              <button
                type="button"
                onClick={() => setShowSupplierModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSupplier} className="space-y-3 text-xs">
              <div>
                <label className="font-medium text-foreground">{t('formSupplierName')}</label>
                <input
                  type="text"
                  required
                  value={supplierForm.name}
                  onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
                  className="w-full mt-1 p-2 bg-background border border-border rounded"
                />
              </div>
              <div>
                <label className="font-medium text-foreground">{t('formContactPerson')}</label>
                <input
                  type="text"
                  value={supplierForm.contact_person}
                  onChange={(e) => setSupplierForm({ ...supplierForm, contact_person: e.target.value })}
                  className="w-full mt-1 p-2 bg-background border border-border rounded"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-medium text-foreground">{t('formPhone')}</label>
                  <input
                    type="text"
                    value={supplierForm.phone}
                    onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })}
                    className="w-full mt-1 p-2 bg-background border border-border rounded"
                  />
                </div>
                <div>
                  <label className="font-medium text-foreground">{t('formTerms')}</label>
                  <input
                    type="text"
                    value={supplierForm.payment_terms}
                    onChange={(e) => setSupplierForm({ ...supplierForm, payment_terms: e.target.value })}
                    className="w-full mt-1 p-2 bg-background border border-border rounded"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowSupplierModal(false)}>
                  {t('btnCancel')}
                </Button>
                <Button type="submit" variant="default" size="sm">
                  {t('btnSaveSupplier')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
