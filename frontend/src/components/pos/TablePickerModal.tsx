'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import type { Table } from '@/lib/types';
import { useHeldOrdersStore } from '@/store/held-orders';
import { useTranslations, type AppConfig } from 'use-intl';
import { TableTurnoverBadge } from '@/components/tables/TableTurnoverBadge';

interface Props {
  tables: Table[];
  selectedTableId: string | null;
  onSelectAvailable: (tableId: string, customer?: { id: string; name: string; phone: string } | null) => void;
  onSelectOccupied: (table: Table) => void;
  onSelectHeld: (tableId: string) => void;
  onPlaceOrder: () => void;
  onHoldTable: (tableId: string) => void;
  onClose: () => void;
}

type PosKey = keyof AppConfig['Messages']['pos'];

const statusStyles: Record<string, { border: string; badge: string; badgeKey: PosKey | null }> = {
  available: { border: 'border-border hover:border-brand/40', badge: '', badgeKey: null },
  occupied: { border: 'border-orange-300 dark:border-orange-800/40 bg-orange-50 dark:bg-orange-950/40', badge: 'bg-orange-500', badgeKey: 'tableOccupied' },
  reserved: { border: 'border-yellow-300 dark:border-yellow-800/40 bg-yellow-50 dark:bg-yellow-950/40', badge: 'bg-yellow-500', badgeKey: 'tableReserved' },
  cleaning: { border: 'border-gray-300 dark:border-border bg-muted', badge: 'bg-gray-500', badgeKey: 'tableCleaning' },
  held: { border: 'border-blue-400 dark:border-blue-800/40 bg-blue-50 dark:bg-blue-950/40', badge: 'bg-blue-500', badgeKey: 'tableHeld' },
};

type StatusFilter = 'all' | 'available' | 'occupied' | 'reserved' | 'held' | 'cleaning';
type SortMode = 'name' | 'status';

/** Natural sort for table names that may contain numbers (e.g. T1, T2, T10). */
function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

const STATUS_ORDER: Record<string, number> = {
  occupied: 0, held: 1, reserved: 2, available: 3, cleaning: 4,
};

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'available', label: 'Available' },
  { key: 'occupied', label: 'Occupied' },
  { key: 'reserved', label: 'Reserved' },
  { key: 'held', label: 'Held' },
  { key: 'cleaning', label: 'Cleaning' },
];

export default function TablePickerModal({
  tables, selectedTableId, onSelectAvailable, onSelectOccupied, onSelectHeld, onPlaceOrder, onHoldTable, onClose,
}: Props) {
  const heldOrders = useHeldOrdersStore();
  const t = useTranslations('pos');

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('name');

  const handleClick = (table: Table) => {
    if (heldOrders.hasHeldOrder(table.id)) {
      onSelectHeld(table.id);
      return;
    }
    if (table.status === 'occupied') {
      onSelectOccupied(table);
      return;
    }
    if (table.status === 'available' || table.status === 'reserved') {
      const customer = table.status === 'reserved' && table.reservation_customer_id
        ? { id: table.reservation_customer_id, name: table.reservation_customer_name ?? '', phone: table.reservation_customer_phone ?? '' }
        : null;
      onSelectAvailable(table.id, customer);
      return;
    }
  };

  const effectiveStatus = (table: Table): StatusFilter =>
    heldOrders.hasHeldOrder(table.id) ? 'held' : (table.status as StatusFilter);

  // 1. Filter by status.
  const filtered = statusFilter === 'all'
    ? tables
    : tables.filter((tbl) => effectiveStatus(tbl) === statusFilter);

  // 2. Sort.
  const sorted = [...filtered].sort((a, b) => {
    if (sortMode === 'status') {
      const sa = STATUS_ORDER[effectiveStatus(a)] ?? 99;
      const sb = STATUS_ORDER[effectiveStatus(b)] ?? 99;
      if (sa !== sb) return sa - sb;
    }
    return naturalSort(a.name, b.name);
  });

  // 3. Group by floor/section when any table has a floor label.
  const hasFloors = tables.some((tbl) => tbl.floor || tbl.section);
  const NO_FLOOR_KEY = '\x00';
  const groupedTables: { label: string | null; items: Table[] }[] = hasFloors
    ? (() => {
        const groups = new Map<string, Table[]>();
        for (const tbl of sorted) {
          const key = tbl.floor || tbl.section || NO_FLOOR_KEY;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(tbl);
        }
        return [...groups.entries()].map(([key, items]) => ({
          label: key === NO_FLOOR_KEY ? null : key,
          items,
        }));
      })()
    : [{ label: null, items: sorted }];

  const isEmpty = groupedTables.every((g) => g.items.length === 0);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-2xl p-6 w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center mb-3 flex-shrink-0">
          <h2 className="text-lg font-bold">{t('selectTable')}</h2>
          <div className="flex items-center gap-2">
            <button
              id="table-picker-sort-toggle"
              onClick={() => setSortMode((m) => m === 'name' ? 'status' : 'name')}
              className="text-xs px-2.5 py-1 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors"
              title={sortMode === 'name' ? 'Sort by status' : 'Sort by name'}
            >
              {sortMode === 'name' ? 'A→Z' : 'Status'}
            </button>
            <button
              onClick={onClose}
              className="touch-target rounded-full text-gray-400 hover:text-muted-foreground active:bg-muted"
              aria-label={t('close')}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Status filter pills */}
        <div className="flex gap-1.5 overflow-x-auto pb-2 flex-shrink-0 -mx-1 px-1">
          {STATUS_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              id={`table-filter-${key}`}
              onClick={() => setStatusFilter(key)}
              className={`flex-shrink-0 text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
                statusFilter === key
                  ? 'bg-brand text-white border-brand'
                  : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Table grid — scrollable body */}
        <div className="overflow-y-auto flex-1 mt-2">
          {isEmpty ? (
            <p className="text-center text-muted-foreground py-8">{t('noTablesFound')}</p>
          ) : (
            groupedTables.map((group, gi) => (
              <div key={gi} className="mb-4 last:mb-0">
                {group.label && (
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-0.5">
                    {group.label}
                  </p>
                )}
                <div className="grid grid-cols-3 gap-3">
                  {group.items.map((table) => {
                    const isHeld = heldOrders.hasHeldOrder(table.id);
                    const isSelected = selectedTableId === table.id;
                    const style = statusStyles[table.status] || statusStyles.available;
                    const isDisabled = table.status === 'cleaning';

                    return (
                      <button
                        key={table.id}
                        id={`table-card-${table.id}`}
                        onClick={() => !isDisabled && handleClick(table)}
                        disabled={isDisabled}
                        className={`min-h-28 p-4 rounded-xl border-2 text-center transition-colors relative ${
                          isSelected
                            ? 'border-brand bg-brand-light'
                            : isHeld
                              ? 'border-blue-400 bg-blue-50'
                              : style.border
                        } ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        {isHeld && (
                          <span className="absolute -top-2 -end-2 bg-blue-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                            {t('tableHeld')}
                          </span>
                        )}
                        {!isHeld && style.badgeKey && (
                          <span className={`absolute -top-2 -end-2 ${style.badge} text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold`}>
                            {t(style.badgeKey)}
                          </span>
                        )}
                        <p className="font-bold text-foreground">{table.name}</p>
                        <p className="text-xs text-muted-foreground">{t('tableSeats', { count: table.capacity })}</p>
                        {table.status === 'occupied' && (table.current_order || table.activeOrder) && (
                          <p className="text-xs text-orange-600 font-medium mt-1">
                            #{(table.current_order || table.activeOrder)?.order_number}
                          </p>
                        )}
                        {table.status === 'occupied' && table.seated_at && (
                          <div className="mt-1"><TableTurnoverBadge seatedAt={table.seated_at} /></div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Place / hold actions */}
        {selectedTableId && (
          <div className="flex gap-3 mt-4 pt-4 border-t border-border flex-shrink-0">
            <button
              onClick={() => onHoldTable(selectedTableId)}
              className="touch-target flex-1 px-4 rounded-xl border-2 border-border text-foreground font-medium hover:bg-muted active:bg-muted transition-colors"
            >
              {t('holdTable')}
            </button>
            <button
              onClick={() => {
                onPlaceOrder();
                onClose();
              }}
              className="touch-target flex-1 px-4 rounded-xl bg-brand text-white font-medium hover:bg-brand/90 active:bg-brand/90 transition-colors"
            >
              {t('placeOrderButton')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
