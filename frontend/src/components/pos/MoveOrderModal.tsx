'use client';

import { useState, useEffect } from 'react';
import { X, ArrowRightLeft, AlertCircle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import type { Table, Order } from '@/lib/types';

interface Props {
  table: Table;
  order: Order;
  onClose: () => void;
  onSuccess: () => void;
}

export default function MoveOrderModal({ table, order, onClose, onSuccess }: Props) {
  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.get('/tables')
      .then((res) => {
        if (!active) return;
        const allTables = (res.data?.tables || []) as Table[];
        setTables(allTables.filter((t) => t.id !== table.id));
      })
      .catch(() => toast.error('Failed to load tables'))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [table.id]);

  const handleMove = async () => {
    if (!selectedTableId) return;
    setSubmitting(true);
    try {
      await api.post(`/tables/${table.id}/move-order`, {
        target_table_id: selectedTableId,
      });
      toast.success('Order moved successfully');
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (err as Error)?.message ||
        'Failed to move order';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const hasPartialPayment = Boolean(order.bill && order.bill.paid_amount > 0 && order.bill.payment_status === 'partial');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card w-full max-w-md rounded-2xl border border-border shadow-xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <ArrowRightLeft size={18} className="text-brand" />
            <h3 className="font-semibold text-foreground">Move Order to Another Table</h3>
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
          <div className="p-3 bg-muted/60 rounded-xl space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Current Table:</span>
              <span className="font-medium text-foreground">{table.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Order:</span>
              <span className="font-medium text-foreground">#{order.order_number}</span>
            </div>
            {hasPartialPayment && (
              <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 mt-2 pt-2 border-t border-border">
                <AlertCircle size={14} className="shrink-0" />
                <span>Partial payments are attached and will stay with the order.</span>
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Select Destination Table
            </p>
            {loading ? (
              <p className="text-center py-6 text-sm text-muted-foreground">Loading tables...</p>
            ) : tables.length === 0 ? (
              <p className="text-center py-6 text-sm text-muted-foreground">No other tables available.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {tables.map((tbl) => {
                  const isOccupied = tbl.status === 'occupied' || Boolean(tbl.activeOrder || tbl.current_order);
                  const isSelected = selectedTableId === tbl.id;

                  return (
                    <button
                      key={tbl.id}
                      type="button"
                      disabled={isOccupied}
                      onClick={() => !isOccupied && setSelectedTableId(tbl.id)}
                      className={`p-3 rounded-xl border text-start transition-all relative ${
                        isOccupied
                          ? 'border-border/40 bg-muted/30 opacity-60 cursor-not-allowed'
                          : isSelected
                            ? 'border-brand bg-brand-light ring-2 ring-brand/30'
                            : 'border-border hover:border-brand/40 bg-card active:scale-[0.98]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm text-foreground">{tbl.name}</span>
                        {isSelected && <Check size={16} className="text-brand shrink-0" />}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {isOccupied ? 'Occupied (Blocked)' : 'Available'}
                      </p>
                      {tbl.internal_label && (
                        <span className="inline-block mt-1 text-[10px] bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 px-1.5 py-0.2 rounded font-medium truncate max-w-full">
                          {tbl.internal_label}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Moving the whole order transfers all items, modifiers, discounts, and customer links to the new table atomically.
          </p>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1" disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleMove}
            disabled={!selectedTableId || submitting}
            className="flex-1"
          >
            {submitting ? 'Moving...' : 'Move Order'}
          </Button>
        </div>
      </div>
    </div>
  );
}
