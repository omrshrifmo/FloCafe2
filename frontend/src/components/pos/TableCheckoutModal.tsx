'use client';

import { useState, useEffect, useRef } from 'react';
import { X, ShoppingCart, Users, Printer, ArrowRightLeft, Split, Clock, Tag, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePrinterStore } from '@/hooks/usePrinter';
import TaxBreakdown from '@/components/pos/TaxBreakdown';
import api from '@/lib/api';
import { useTranslations } from 'use-intl';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import toast from 'react-hot-toast';
import type { Table, Order, Bill, OrderItem } from '@/lib/types';
import { SplitCheckModal } from '@/components/pos/SplitCheckModal';
import MoveOrderModal from '@/components/pos/MoveOrderModal';
import TransferItemsModal from '@/components/pos/TransferItemsModal';
import DeferredCheckoutModal from '@/components/pos/DeferredCheckoutModal';
import InternalLabelModal from '@/components/pos/InternalLabelModal';

interface Props {
  table: Table;
  currency: string;
  cartItemCount: number;
  onClose: () => void;
  onAddItems: (table: Table, order: Order) => void;
  onPayment: (bill: Bill) => void;
  onAddCartToOrder?: (table: Table, order: Order) => void;
}

interface CheckoutRecoveryState {
  supportId: string;
  transient: boolean;
  existingBill: Bill | null;
  errorMessage?: string;
}

export default function TableCheckoutModal({
  table,

  cartItemCount,
  onClose,
  onAddItems,
  onPayment,
  onAddCartToOrder
}: Props) {
  const t = useTranslations('pos');
  const fmt = useFormatCurrency();
  const formatItemTotal = (value: unknown, fallback: unknown) => {
    const total = Number(value);
    if (Number.isFinite(total)) return fmt(total);
    const subtotal = Number(fallback);
    return fmt(Number.isFinite(subtotal) ? subtotal : 0);
  };
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [addingItems, setAddingItems] = useState(false);
  const [splitChecksEnabled, setSplitChecksEnabled] = useState(false);
  const [splitBill, setSplitBill] = useState<Bill | null>(null);
  const [printingPreliminary, setPrintingPreliminary] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showDeferredModal, setShowDeferredModal] = useState(false);
  const [showLabelModal, setShowLabelModal] = useState(false);
  const [recoveryState, setRecoveryState] = useState<CheckoutRecoveryState | null>(null);
  const checkoutIdempotencyKeyRef = useRef<string | null>(null);
  const printPreliminaryReceipt = usePrinterStore((s) => s.printPreliminaryReceipt);
  const tOrders = useTranslations('orders');
  const tPrint = useTranslations('print');

  const reloadOrder = async () => {
    try {
      const { data } = await api.get(`/tables/${table.id}`);
      const tbl = data.table;
      const activeOrder = tbl.activeOrder || tbl.current_order;
      if (activeOrder) {
        const orderRes = await api.get(`/orders/${activeOrder.id}`);
        setOrder(orderRes.data.order);
      } else {
        onClose();
      }
    } catch {
      onClose();
    }
  };

  const handlePrintPreliminary = async () => {
    if (printingPreliminary || !order) return;
    setPrintingPreliminary(true);
    try {
      const warnings = await printPreliminaryReceipt({
        orderId: order.id,
        billId: order.bill?.id,
      });
      if (warnings.length > 0) {
        toast(warnings[0].message || tPrint('preliminaryTitle'), { icon: '⚠️' });
      } else {
        toast.success(tPrint('preliminaryTitle'));
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to print preliminary receipt');
    } finally {
      setPrintingPreliminary(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const fetchOrder = async () => {
      try {
        const { data } = await api.get(`/tables/${table.id}`, { signal: controller.signal });
        const tbl = data.table;
        const activeOrder = tbl.activeOrder || tbl.current_order;
        if (activeOrder) {
          const orderRes = await api.get(`/orders/${activeOrder.id}`, { signal: controller.signal });
          setOrder(orderRes.data.order);
        }
      } catch {
        if (controller.signal.aborted) return;
        toast.error(t('loadOrderFailed'));
      } finally {
        setLoading(false);
      }
    };
    fetchOrder();
    return () => controller.abort();
  }, [table.id, t]);

  useEffect(() => {
    api.get('/settings/split_checks_enabled').then((res) => setSplitChecksEnabled(res.data?.setting?.value === 'true')).catch(() => setSplitChecksEnabled(false));
  }, []);

  const handleCheckout = async () => {
    if (!order) return;
    setGenerating(true);
    setRecoveryState(null);

    if (order.bill) {
      setGenerating(false);
      onPayment({ ...order.bill, order });
      return;
    }

    if (!checkoutIdempotencyKeyRef.current) {
      checkoutIdempotencyKeyRef.current = typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `chk-${order.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    try {
      const { data } = await api.post(
        '/bills/generate',
        { order_id: order.id },
        { headers: { 'Idempotency-Key': checkoutIdempotencyKeyRef.current } }
      );
      checkoutIdempotencyKeyRef.current = null;
      setRecoveryState(null);

      if (data.recovered) {
        toast(t('billMayAlreadyExist'), { icon: 'ℹ️' });
      } else {
        toast.success(t('billCreatedSuccess'));
      }
      onPayment(data.bill);
    } catch (err: unknown) {
      const resData = (err as { response?: { data?: { supportId?: string; transient?: boolean; existingBill?: Bill; error?: string } } })?.response?.data;
      const supportId = resData?.supportId || `SUP-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const isTransient = Boolean(resData?.transient);
      const existingBill = resData?.existingBill || null;

      if (isTransient) {
        toast(t('databaseBusyRetrying'), { icon: '⏳' });
      }

      setRecoveryState({
        supportId,
        transient: isTransient,
        existingBill,
        errorMessage: resData?.error,
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleSplitCheck = async () => {
    if (!order) return;
    setGenerating(true);
    setRecoveryState(null);

    if (!checkoutIdempotencyKeyRef.current) {
      checkoutIdempotencyKeyRef.current = typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `split-${order.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    try {
      const bill = order.bill
        ? { ...order.bill, order }
        : (
            await api.post(
              '/bills/generate',
              { order_id: order.id },
              { headers: { 'Idempotency-Key': checkoutIdempotencyKeyRef.current } }
            )
          ).data.bill;
      checkoutIdempotencyKeyRef.current = null;
      setSplitBill(bill);
    } catch (err: unknown) {
      const resData = (err as { response?: { data?: { supportId?: string; transient?: boolean; existingBill?: Bill; error?: string } } })?.response?.data;
      const supportId = resData?.supportId || `SUP-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const isTransient = Boolean(resData?.transient);
      const existingBill = resData?.existingBill || null;

      if (isTransient) {
        toast(t('databaseBusyRetrying'), { icon: '⏳' });
      }

      setRecoveryState({
        supportId,
        transient: isTransient,
        existingBill,
        errorMessage: resData?.error,
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleAddCartToOrder = async () => {
    if (!order || !onAddCartToOrder) return;
    setAddingItems(true);
    try {
      await onAddCartToOrder(table, order);
    } catch {
      toast.error(t('addItemsFailed'));
    } finally {
      setAddingItems(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-card rounded-2xl p-8">
          <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-card rounded-2xl p-6 w-full max-w-md">
          <p className="text-muted-foreground text-center py-4">{t('noActiveOrder')}</p>
          <Button onClick={onClose} variant="outline" className="w-full">{t('close')}</Button>
        </div>
      </div>
    );
  }

  // Filter active items (not cancelled)
  const activeItems = (order.items || []).filter((item: OrderItem) => item.status !== 'cancelled');
  const splitBills = (order.bills || []).filter((bill) => Boolean(bill.split_group_id));

  return (
    <>
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col">
        <div className="flex justify-between items-center p-5 border-b border-border">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-foreground">{table.name}</h2>
              {table.internal_label && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 font-medium">
                  {table.internal_label}
                </span>
              )}
              <button
                type="button"
                onClick={() => setShowLabelModal(true)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                title={t('editInternalLabel')}
              >
                <Tag size={15} />
              </button>
              <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                order.bill?.payment_status === 'paid' 
                  ? 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800/40'
                  : 'bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800/40'
              }`}>
                {order.bill?.payment_status === 'paid' ? t('paid') : t('unpaid')}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{t('orderNumber', { number: order.order_number })}</p>
          </div>
          <button onClick={onClose} className="touch-target rounded-full text-muted-foreground hover:text-foreground active:bg-muted" aria-label={t('close')}>
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {/* Existing order items - shown as disabled/reference */}
          <div className="mb-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{t('previousItems')}</p>
            <div className="space-y-1">
              {activeItems.map((item) => (
                <div key={item.id} className="flex justify-between items-start py-1.5 px-2 bg-muted rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground font-medium">
                      {item.quantity}x {item.product_name}
                    </p>
                    {item.special_instructions && (
                      <p className="text-xs text-muted-foreground italic">{item.special_instructions}</p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground ms-2 font-medium">
                    {formatItemTotal(item.total, item.subtotal)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-5 border-t border-border space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t('subtotal')}</span>
            <span>{fmt(Number(order.subtotal))}</span>
          </div>
          <TaxBreakdown
            taxAmount={Number(order.tax_amount)}
            taxBreakdown={order.tax_breakdown}
            theme="light"
          />
          <div className="flex justify-between text-lg font-bold">
            <span>{t('total')}</span>
            <span className="text-brand">{fmt(Number(order.total))}</span>
          </div>
          {order.bill && order.bill.payment_status !== 'paid' && Number(order.bill.balance) > 0 && (
            <div className="flex justify-between text-sm font-medium">
              <span className="text-orange-600">{t('balanceDue')}</span>
              <span className="text-orange-600">{fmt(Number(order.bill.balance))}</span>
            </div>
          )}

          {order && order.status !== 'completed' && (!order.bill || order.bill.payment_status !== 'paid') && (
            <Button
              variant="outline"
              onClick={handlePrintPreliminary}
              disabled={printingPreliminary || generating}
              className="w-full"
            >
              <Printer size={15} className="me-2" />
              {printingPreliminary ? tOrders('printing') : t('printBill')}
            </Button>
          )}

          {order && order.status !== 'completed' && (
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowMoveModal(true)}
                className="text-xs"
              >
                <ArrowRightLeft size={13} className="me-1" /> {t('moveTable')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowTransferModal(true)}
                className="text-xs"
              >
                <Split size={13} className="me-1" /> {t('splitMoveItems')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDeferredModal(true)}
                className="text-xs"
              >
                <Clock size={13} className="me-1" /> {t('finishLater')}
              </Button>
            </div>
          )}

          {recoveryState ? (
            <div className="p-4 rounded-xl border border-destructive/40 bg-destructive/10 text-foreground space-y-3 my-2" role="alert">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-destructive" />
                <div className="text-sm space-y-1">
                  <p className="font-semibold text-destructive">
                    {t('billCreationFailedSafe', { supportId: recoveryState.supportId })}
                  </p>
                  {recoveryState.transient && (
                    <p className="text-xs text-muted-foreground">
                      {t('databaseBusyRetrying')}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => handleCheckout()}
                  disabled={generating}
                >
                  {generating ? t('generating') : t('retrySafely')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await reloadOrder();
                    setRecoveryState(null);
                  }}
                  disabled={generating}
                >
                  {t('refreshOrder')}
                </Button>
                {recoveryState.existingBill && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const bill = recoveryState.existingBill!;
                      setRecoveryState(null);
                      onPayment(bill);
                    }}
                  >
                    {t('viewExistingBill')}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setRecoveryState(null);
                    checkoutIdempotencyKeyRef.current = null;
                  }}
                >
                  {t('close')}
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Show different buttons based on cart state */}
              {splitBills.length === 0 && splitChecksEnabled && order.type === 'dine_in' && order.bill?.payment_status !== 'paid' && <Button variant="outline" onClick={handleSplitCheck} disabled={generating} className="w-full"><Users size={15} className="me-2" />{t('splitCheck')}</Button>}
              {cartItemCount > 0 ? (
                // Cart has items - show "Add items to order" option
                <div className="space-y-2">
                  <Button
                    onClick={handleAddCartToOrder}
                    disabled={addingItems}
                    className="w-full"
                    size="lg"
                  >
                    <ShoppingCart size={16} className="me-2" />
                    {addingItems ? t('adding') : t('addToOrder', { count: cartItemCount })}
                  </Button>
                  <Button onClick={handleCheckout} variant="outline" className="w-full" disabled={generating}>
                    {generating ? t('generating') : t('checkoutInstead')}
                  </Button>
                </div>
              ) : splitBills.length === 0 ? (
                // Cart empty - show both options
                <div className="grid grid-cols-2 gap-3">
                  <Button variant="outline" onClick={() => onAddItems(table, order)}>
                    {t('addItems')}
                  </Button>
                  <Button onClick={handleCheckout} disabled={generating}>
                    {generating ? t('generating') : t('checkout')}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
    {splitBill && <SplitCheckModal bill={splitBill} order={order} onClose={() => setSplitBill(null)} onSplit={(bills) => { setOrder({ ...order, bill: bills[0], bills }); setSplitBill(null); }} />}
    {showMoveModal && order && (
      <MoveOrderModal
        table={table}
        order={order}
        onClose={() => setShowMoveModal(false)}
        onSuccess={() => {
          setShowMoveModal(false);
          onClose();
        }}
      />
    )}
    {showTransferModal && order && (
      <TransferItemsModal
        order={order}
        currentTable={table}
        onClose={() => setShowTransferModal(false)}
        onSuccess={() => {
          setShowTransferModal(false);
          void reloadOrder();
        }}
      />
    )}
    {showDeferredModal && order && (
      <DeferredCheckoutModal
        order={order}
        onClose={() => setShowDeferredModal(false)}
        onSuccess={() => {
          setShowDeferredModal(false);
          onClose();
        }}
      />
    )}
    {showLabelModal && (
      <InternalLabelModal
        title={`Table ${table.name} Internal Label`}
        currentLabel={table.internal_label}
        onSave={async (lbl) => {
          await api.patch(`/tables/${table.id}/internal-label`, { internal_label: lbl });
          void reloadOrder();
        }}
        onClose={() => setShowLabelModal(false)}
      />
    )}
    </>
  );
}
