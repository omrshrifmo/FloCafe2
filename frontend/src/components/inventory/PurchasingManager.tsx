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
  const [paymentMode, setPaymentMode] = useState<'full' | 'partial' | 'credit'>('full');
  const [receivePaidAmount, setReceivePaidAmount] = useState<number>(0);

  // Supplier Pay Modal
  const [payingSupplier, setPayingSupplier] = useState<Supplier | null>(null);
  const [supplierPayAmount, setSupplierPayAmount] = useState<number>(0);
  const [supplierPayMethod, setSupplierPayMethod] = useState<'cash' | 'bank_transfer' | 'cheque'>('cash');
  const [supplierPayFromDrawer, setSupplierPayFromDrawer] = useState(false);
  const [supplierPayNotes, setSupplierPayNotes] = useState('');
  const [isSubmittingPay, setIsSubmittingPay] = useState(false);

  // Supplier Credit Note Modal
  const [creditingSupplier, setCreditingSupplier] = useState<Supplier | null>(null);
  const [creditNoteAmount, setCreditNoteAmount] = useState<number>(0);
  const [creditNoteReason, setCreditNoteReason] = useState('Damaged goods / Return');
  const [creditNoteRef, setCreditNoteRef] = useState('');
  const [isSubmittingCredit, setIsSubmittingCredit] = useState(false);

  // PO Barcode Scan Input
  const [barcodeInput, setBarcodeInput] = useState('');

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
      if (payFromDrawer && paymentMode !== 'credit') {
        try {
          const sessionRes = await api.get('/cash-sessions/active');
          activeShiftId = sessionRes.data?.id ?? null;
        } catch {
          // Fallback to backend auto-detection if no open shift
        }
      }
      const actualPaid = paymentMode === 'credit' ? 0 : paymentMode === 'partial' ? receivePaidAmount : receivingPo.total_amount;
      const res = await api.post(`/purchasing/purchase-orders/${receivingPo.id}/receive`, {
        payment_mode: paymentMode,
        paid_amount: actualPaid,
        pay_from_drawer: payFromDrawer && paymentMode !== 'credit',
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

  const handlePaySupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingSupplier || supplierPayAmount <= 0) return;
    try {
      setIsSubmittingPay(true);
      let activeShiftId: number | null = null;
      if (supplierPayFromDrawer) {
        try {
          const sessionRes = await api.get('/cash-sessions/active');
          activeShiftId = sessionRes.data?.id ?? null;
        } catch {}
      }
      await api.post(`/purchasing/suppliers/${payingSupplier.id}/pay`, {
        amount: supplierPayAmount,
        payment_method: supplierPayMethod,
        notes: supplierPayNotes || undefined,
        pay_from_drawer: supplierPayFromDrawer,
        shift_id: activeShiftId,
      });
      toast.success('Supplier payment recorded successfully');
      setPayingSupplier(null);
      setSupplierPayAmount(0);
      setSupplierPayNotes('');
      setSupplierPayFromDrawer(false);
      loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to record supplier payment'));
    } finally {
      setIsSubmittingPay(false);
    }
  };

  const handleCreateCreditNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creditingSupplier || creditNoteAmount <= 0) return;
    try {
      setIsSubmittingCredit(true);
      await api.post(`/purchasing/suppliers/${creditingSupplier.id}/credit-note`, {
        amount: creditNoteAmount,
        reason: creditNoteReason,
        reference: creditNoteRef || undefined,
      });
      toast.success('Credit note applied to supplier balance');
      setCreditingSupplier(null);
      setCreditNoteAmount(0);
      setCreditNoteReason('Damaged goods / Return');
      setCreditNoteRef('');
      loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to apply credit note'));
    } finally {
      setIsSubmittingCredit(false);
    }
  };

  const handleBarcodeQuickScan = (code: string) => {
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) return;
    const match = availableItems.find(
      (it) => it.id.toLowerCase() === trimmed || it.name.toLowerCase().includes(trimmed)
    );
    if (match) {
      const existingIdx = poForm.items.findIndex((it) => it.target_id === match.id);
      if (existingIdx >= 0) {
        const next = [...poForm.items];
        next[existingIdx].ordered_qty += 1;
        setPoForm({ ...poForm, items: next });
      } else {
        setPoForm({
          ...poForm,
          items: [
            ...poForm.items,
            {
              target_type: match.target_type,
              target_id: match.id,
              item_name: match.name,
              unit: match.unit,
              ordered_qty: 1,
              unit_cost: match.cost,
            },
          ],
        });
      }
      toast.success(`Scanned: ${match.name}`);
      setBarcodeInput('');
    } else {
      toast.error(`No item found matching "${code}"`);
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
                          onClick={() => {
                            setReceivingPo(po);
                            setPaymentMode('full');
                            setReceivePaidAmount(po.total_amount);
                            setPayFromDrawer(false);
                          }}
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
                  <th className="p-3 text-end">{t('colAction')}</th>
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
                    <td className="p-3 text-end">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setPayingSupplier(sup);
                            setSupplierPayAmount(sup.balance_due > 0 ? sup.balance_due : 0);
                            setSupplierPayFromDrawer(false);
                            setSupplierPayNotes('');
                          }}
                          className="text-[11px] h-7"
                        >
                          Pay
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setCreditingSupplier(sup);
                            setCreditNoteAmount(0);
                            setCreditNoteReason('Damaged goods / Return');
                            setCreditNoteRef('');
                          }}
                          className="text-[11px] h-7 text-muted-foreground hover:text-foreground"
                        >
                          Credit Note
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {suppliers.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">
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

              <div>
                <label className="font-semibold text-foreground block mb-1.5">Settlement &amp; Payment Mode</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => { setPaymentMode('full'); setReceivePaidAmount(receivingPo.total_amount); }}
                    className={`p-2 rounded-lg border text-center font-bold text-xs transition-colors ${paymentMode === 'full' ? 'border-brand bg-brand/10 text-brand' : 'border-border text-foreground hover:bg-muted'}`}
                  >
                    Full Payment
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPaymentMode('partial'); setReceivePaidAmount(Math.round(receivingPo.total_amount / 2)); }}
                    className={`p-2 rounded-lg border text-center font-bold text-xs transition-colors ${paymentMode === 'partial' ? 'border-brand bg-brand/10 text-brand' : 'border-border text-foreground hover:bg-muted'}`}
                  >
                    Partial Payment
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPaymentMode('credit'); setReceivePaidAmount(0); }}
                    className={`p-2 rounded-lg border text-center font-bold text-xs transition-colors ${paymentMode === 'credit' ? 'border-brand bg-brand/10 text-brand' : 'border-border text-foreground hover:bg-muted'}`}
                  >
                    On Credit (AP)
                  </button>
                </div>
              </div>

              {paymentMode === 'partial' && (
                <div>
                  <label className="font-medium text-foreground">Paid Amount Now</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    max={receivingPo.total_amount}
                    value={receivePaidAmount}
                    onChange={(e) => setReceivePaidAmount(parseFloat(e.target.value) || 0)}
                    className="w-full mt-1 p-2 bg-background border border-border rounded text-xs"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Balance due of {fmtCurrency(Math.max(0, receivingPo.total_amount - receivePaidAmount))} will be added to {receivingPo.supplier_name || 'supplier'} balance.
                  </p>
                </div>
              )}

              {paymentMode === 'credit' && (
                <div className="p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[11px] text-blue-800 dark:text-blue-300">
                  Full total of {fmtCurrency(receivingPo.total_amount)} will be added to {receivingPo.supplier_name || 'supplier'} payable balance.
                </div>
              )}

              {paymentMode !== 'credit' && (
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
              )}
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

              <div className="flex items-center gap-2 p-2 bg-muted/40 rounded-lg border border-border">
                <input
                  type="text"
                  placeholder="Scan barcode / SKU or type item name to add..."
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleBarcodeQuickScan(barcodeInput);
                    }
                  }}
                  className="flex-1 p-1.5 bg-background border border-border rounded text-xs"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => handleBarcodeQuickScan(barcodeInput)}
                  className="text-xs h-7"
                >
                  Quick Add
                </Button>
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

      {/* Pay Supplier Modal */}
      {payingSupplier && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl p-5 w-full max-w-sm shadow-lg space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-bold text-foreground">Pay Supplier: {payingSupplier.name}</h3>
              <button
                type="button"
                onClick={() => setPayingSupplier(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handlePaySupplier} className="space-y-3 text-xs">
              <div className="p-3 bg-muted/40 rounded-lg flex justify-between items-center">
                <span className="text-muted-foreground">Current Balance Due:</span>
                <span className="font-bold text-foreground">{fmtCurrency(payingSupplier.balance_due)}</span>
              </div>

              <div>
                <label className="font-medium text-foreground">Payment Amount</label>
                <input
                  type="number"
                  step="any"
                  min="0.01"
                  required
                  value={supplierPayAmount}
                  onChange={(e) => setSupplierPayAmount(parseFloat(e.target.value) || 0)}
                  className="w-full mt-1 p-2 bg-background border border-border rounded"
                />
              </div>

              <div>
                <label className="font-medium text-foreground">Payment Method</label>
                <select
                  value={supplierPayMethod}
                  onChange={(e) => setSupplierPayMethod(e.target.value as 'cash' | 'bank_transfer' | 'cheque')}
                  className="w-full mt-1 p-2 bg-background border border-border rounded text-xs"
                >
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>

              <div>
                <label className="font-medium text-foreground">Reference / Notes</label>
                <input
                  type="text"
                  placeholder="Receipt #, Cheque #, etc."
                  value={supplierPayNotes}
                  onChange={(e) => setSupplierPayNotes(e.target.value)}
                  className="w-full mt-1 p-2 bg-background border border-border rounded"
                />
              </div>

              {supplierPayMethod === 'cash' && (
                <label className="flex items-center gap-2 p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={supplierPayFromDrawer}
                    onChange={(e) => setSupplierPayFromDrawer(e.target.checked)}
                    className="rounded accent-brand size-4"
                  />
                  <div>
                    <p className="font-semibold text-foreground">Pay From Cash Drawer</p>
                    <p className="text-[10px] text-muted-foreground">Record payout in active cash drawer session</p>
                  </div>
                </label>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <Button type="button" variant="outline" size="sm" onClick={() => setPayingSupplier(null)}>
                  {t('btnCancel')}
                </Button>
                <Button type="submit" variant="default" size="sm" disabled={isSubmittingPay}>
                  {isSubmittingPay ? t('processing') : 'Confirm Payment'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Credit Note Modal */}
      {creditingSupplier && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl p-5 w-full max-w-sm shadow-lg space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-bold text-foreground">Credit Note / Return: {creditingSupplier.name}</h3>
              <button
                type="button"
                onClick={() => setCreditingSupplier(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCreditNote} className="space-y-3 text-xs">
              <div className="p-3 bg-muted/40 rounded-lg flex justify-between items-center">
                <span className="text-muted-foreground">Current Balance Due:</span>
                <span className="font-bold text-foreground">{fmtCurrency(creditingSupplier.balance_due)}</span>
              </div>

              <div>
                <label className="font-medium text-foreground">Credit Amount</label>
                <input
                  type="number"
                  step="any"
                  min="0.01"
                  required
                  value={creditNoteAmount}
                  onChange={(e) => setCreditNoteAmount(parseFloat(e.target.value) || 0)}
                  className="w-full mt-1 p-2 bg-background border border-border rounded"
                />
              </div>

              <div>
                <label className="font-medium text-foreground">Reason for Credit / Return</label>
                <input
                  type="text"
                  required
                  value={creditNoteReason}
                  onChange={(e) => setCreditNoteReason(e.target.value)}
                  className="w-full mt-1 p-2 bg-background border border-border rounded"
                />
              </div>

              <div>
                <label className="font-medium text-foreground">Reference / RMA # (optional)</label>
                <input
                  type="text"
                  value={creditNoteRef}
                  onChange={(e) => setCreditNoteRef(e.target.value)}
                  className="w-full mt-1 p-2 bg-background border border-border rounded"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <Button type="button" variant="outline" size="sm" onClick={() => setCreditingSupplier(null)}>
                  {t('btnCancel')}
                </Button>
                <Button type="submit" variant="default" size="sm" disabled={isSubmittingCredit}>
                  {isSubmittingCredit ? t('processing') : 'Apply Credit Note'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
