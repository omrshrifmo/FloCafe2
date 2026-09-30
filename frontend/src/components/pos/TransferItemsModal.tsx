'use client';

import { useState, useEffect } from 'react';
import { X, Split, Plus, Minus, AlertCircle, ShoppingBag, Utensils } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import type { Order, OrderItem, Table } from '@/lib/types';

interface Props {
  order: Order;
  currentTable?: Table;
  onClose: () => void;
  onSuccess: () => void;
}

export default function TransferItemsModal({ order, currentTable, onClose, onSuccess }: Props) {
  const fmt = useFormatCurrency();
  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Selected item quantities: Record<itemId, number>
  const [selectedQuantities, setSelectedQuantities] = useState<Record<number, number>>({});
  const [destMode, setDestMode] = useState<'table' | 'takeaway'>('table');
  const [targetTableId, setTargetTableId] = useState<string>('');
  const [targetInternalLabel, setTargetInternalLabel] = useState<string>('');

  const activeItems = (order.items || []).filter(
    (item) => !['cancelled', 'voided'].includes(item.status)
  );

  const hasConfirmedPayment = Boolean(
    order.bill &&
    (Number(order.bill.paid_amount || 0) > 0 ||
      ['paid', 'partial', 'refunded', 'partially_refunded'].includes(order.bill.payment_status))
  );

  useEffect(() => {
    let active = true;
    api.get('/tables')
      .then((res) => {
        if (!active) return;
        const all = (res.data?.tables || []) as Table[];
        const filtered = all.filter((t) => t.id !== currentTable?.id);
        setTables(filtered);
        if (filtered.length > 0) {
          setTargetTableId(filtered[0].id);
        }
      })
      .catch(() => toast.error('Failed to load tables'))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentTable?.id]);

  const toggleItem = (item: OrderItem) => {
    setSelectedQuantities((prev) => {
      const copy = { ...prev };
      if (copy[item.id]) {
        delete copy[item.id];
      } else {
        copy[item.id] = item.quantity;
      }
      return copy;
    });
  };

  const setItemQuantity = (itemId: number, maxQty: number, nextQty: number) => {
    if (nextQty <= 0) {
      setSelectedQuantities((prev) => {
        const copy = { ...prev };
        delete copy[itemId];
        return copy;
      });
      return;
    }
    const clamped = Math.min(nextQty, maxQty);
    setSelectedQuantities((prev) => ({ ...prev, [itemId]: clamped }));
  };

  const selectedCount = Object.keys(selectedQuantities).length;

  const handleTransfer = async () => {
    if (hasConfirmedPayment) {
      toast.error('Cannot split items after confirmed payments have been recorded.');
      return;
    }
    if (selectedCount === 0) {
      toast.error('Select at least one item to transfer');
      return;
    }

    const payloadItems = Object.entries(selectedQuantities).map(([idStr, qty]) => ({
      order_item_id: Number(idStr),
      quantity: qty,
    }));

    setSubmitting(true);
    try {
      await api.post(`/orders/${order.id}/transfer-items`, {
        items: payloadItems,
        target_table_id: destMode === 'table' ? targetTableId || undefined : undefined,
        target_type: destMode === 'takeaway' ? 'takeaway' : undefined,
        target_internal_label: targetInternalLabel.trim() || undefined,
      });
      toast.success('Items transferred successfully');
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (err as Error)?.message ||
        'Failed to transfer items';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card w-full max-w-lg rounded-2xl border border-border shadow-xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Split size={18} className="text-brand" />
            <h3 className="font-semibold text-foreground">Transfer / Split Items</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-muted-foreground hover:text-foreground active:bg-muted"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 flex-1 overflow-y-auto space-y-4">
          {hasConfirmedPayment && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 rounded-xl flex gap-2 text-sm text-red-700 dark:text-red-300">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Item Transfer Blocked</p>
                <p className="text-xs mt-0.5">
                  This bill already has recorded or confirmed payments. The bill must be settled or refunded before items can be transferred.
                </p>
              </div>
            </div>
          )}

          {/* Item Selector */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Select Items to Move
            </p>
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {activeItems.map((item) => {
                const isSelected = Boolean(selectedQuantities[item.id]);
                const qtyToMove = selectedQuantities[item.id] || item.quantity;

                return (
                  <div
                    key={item.id}
                    className={`p-3 rounded-xl border transition-colors flex items-center justify-between gap-3 ${
                      isSelected
                        ? 'border-brand bg-brand-light'
                        : 'border-border bg-card'
                    }`}
                  >
                    <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
                      <input
                        type="checkbox"
                        disabled={hasConfirmedPayment}
                        checked={isSelected}
                        onChange={() => toggleItem(item)}
                        className="rounded border-border text-brand focus:ring-brand"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {item.product_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Available: {item.quantity} · {fmt(Number(item.unit_price))} each
                        </p>
                      </div>
                    </label>

                    {isSelected && (
                      <div className="flex items-center gap-1.5 shrink-0 bg-card border border-border rounded-lg p-0.5">
                        <button
                          type="button"
                          onClick={() => setItemQuantity(item.id, item.quantity, qtyToMove - 1)}
                          className="p-1 hover:bg-muted rounded text-muted-foreground"
                          disabled={qtyToMove <= 1}
                        >
                          <Minus size={14} />
                        </button>
                        <span className="w-6 text-center text-xs font-bold text-foreground">
                          {qtyToMove}
                        </span>
                        <button
                          type="button"
                          onClick={() => setItemQuantity(item.id, item.quantity, qtyToMove + 1)}
                          className="p-1 hover:bg-muted rounded text-muted-foreground"
                          disabled={qtyToMove >= item.quantity}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Destination */}
          <div className="space-y-3 pt-2 border-t border-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Destination
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDestMode('table')}
                className={`p-3 rounded-xl border text-center text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                  destMode === 'table'
                    ? 'border-brand bg-brand-light text-brand'
                    : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                <Utensils size={15} /> Table Order
              </button>
              <button
                type="button"
                onClick={() => setDestMode('takeaway')}
                className={`p-3 rounded-xl border text-center text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                  destMode === 'takeaway'
                    ? 'border-brand bg-brand-light text-brand'
                    : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                <ShoppingBag size={15} /> New Takeaway
              </button>
            </div>

            {destMode === 'table' && (
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Select Target Table</label>
                <select
                  disabled={loading}
                  value={targetTableId}
                  onChange={(e) => setTargetTableId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border bg-card rounded-lg focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-50"
                >
                  {loading ? (
                    <option value="">Loading tables...</option>
                  ) : tables.length === 0 ? (
                    <option value="">No other tables available</option>
                  ) : (
                    tables.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.status === 'occupied' ? 'Occupied - Merge into Table Order' : 'Available - New Order'})
                      </option>
                    ))
                  )}
                </select>
              </div>
            )}

            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Internal Label / Reference (optional)
              </label>
              <input
                type="text"
                value={targetInternalLabel}
                onChange={(e) => setTargetInternalLabel(e.target.value.slice(0, 50))}
                placeholder="e.g. VIP party, Split check 2"
                className="w-full px-3 py-2 text-sm border border-border bg-card rounded-lg focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1" disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleTransfer}
            disabled={hasConfirmedPayment || selectedCount === 0 || submitting || (destMode === 'table' && !targetTableId)}
            className="flex-1"
          >
            {submitting ? 'Transferring...' : `Transfer ${selectedCount} Item(s)`}
          </Button>
        </div>
      </div>
    </div>
  );
}
