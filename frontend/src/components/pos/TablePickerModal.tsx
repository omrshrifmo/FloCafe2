'use client';

import { useState, useEffect } from 'react';
import { X, ArrowUp, ArrowDown, Layers } from 'lucide-react';
import type { Table } from '@/lib/types';
import { useHeldOrdersStore } from '@/store/held-orders';
import { useTranslations, type AppConfig } from 'use-intl';
import { TableTurnoverBadge } from '@/components/tables/TableTurnoverBadge';
import {
  naturalSort,
  UNASSIGNED_FLOOR,
  filterAndSortTables,
  groupTablesByFloor,
  loadTablePickerPrefs,
  saveTablePickerPrefs,
  type StatusFilter,
  type TableSortField,
  type TablePickerPrefs,
} from '@/lib/table-picker';

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

export const STATUS_FILTERS: { key: StatusFilter; labelKey: PosKey }[] = [
  { key: 'all', labelKey: 'tableFilterAll' },
  { key: 'available', labelKey: 'tableFilterAvailable' },
  { key: 'occupied', labelKey: 'tableFilterOccupied' },
  { key: 'reserved', labelKey: 'tableFilterReserved' },
  { key: 'held', labelKey: 'tableFilterHeld' },
  { key: 'cleaning', labelKey: 'tableFilterCleaning' },
];

export const SORT_FIELDS: { key: TableSortField; labelKey: PosKey }[] = [
  { key: 'number', labelKey: 'tableSortByNumber' },
  { key: 'name', labelKey: 'tableSortByName' },
  { key: 'status', labelKey: 'tableSortByStatus' },
  { key: 'floor', labelKey: 'tableSortByFloor' },
];

export default function TablePickerModal({
  tables,
  selectedTableId,
  onSelectAvailable,
  onSelectOccupied,
  onSelectHeld,
  onPlaceOrder,
  onHoldTable,
  onClose,
}: Props) {
  const heldOrders = useHeldOrdersStore();
  const t = useTranslations('pos');

  const [prefs, setPrefs] = useState<TablePickerPrefs>(loadTablePickerPrefs);

  useEffect(() => {
    saveTablePickerPrefs(prefs);
  }, [prefs]);

  const { sortField, sortDirection, statusFilter, floorFilter, groupByFloor } = prefs;

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

  // Distinct halls/floors from tables list
  const distinctFloors = Array.from(
    new Set(
      tables
        .map((tbl) => tbl.floor || tbl.section)
        .filter((f): f is string => Boolean(f && f.trim()))
    )
  ).sort(naturalSort);
  const hasUnassigned = tables.some((tbl) => !(tbl.floor || tbl.section));

  const sorted = filterAndSortTables(tables, prefs, effectiveStatus);
  const groupedTables = groupTablesByFloor(sorted, groupByFloor, t('tableFloorUnassigned'));
  const isEmpty = groupedTables.every((g) => g.items.length === 0);

  const toggleSortField = (field: TableSortField) => {
    if (sortField === field) {
      setPrefs((prev) => ({
        ...prev,
        sortDirection: prev.sortDirection === 'asc' ? 'desc' : 'asc',
      }));
    } else {
      setPrefs((prev) => ({
        ...prev,
        sortField: field,
        sortDirection: 'asc',
      }));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" dir="auto">
      <div className="bg-card rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex justify-between items-center mb-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold">{t('selectTable')}</h2>
            <button
              id="table-group-by-floor-toggle"
              type="button"
              onClick={() => setPrefs((prev) => ({ ...prev, groupByFloor: !prev.groupByFloor }))}
              className={`text-xs px-2.5 py-1 rounded-lg border flex items-center gap-1 transition-colors ${
                groupByFloor
                  ? 'bg-brand text-white border-brand'
                  : 'border-border text-muted-foreground hover:bg-muted'
              }`}
              title={t('tableGroupByFloor')}
              aria-pressed={groupByFloor}
            >
              <Layers size={14} />
              <span>{t('tableGroupByFloor')}</span>
            </button>
          </div>
          <button
            onClick={onClose}
            className="touch-target rounded-full text-gray-400 hover:text-muted-foreground active:bg-muted"
            aria-label={t('close')}
          >
            <X size={20} />
          </button>
        </div>

        {/* Sort Controls */}
        <div className="flex flex-wrap items-center gap-1.5 pb-2 mb-1 border-b border-border flex-shrink-0 text-xs">
          <span className="text-muted-foreground font-medium me-1">{t('tableSortByStatus')}:</span>
          {SORT_FIELDS.map(({ key, labelKey }) => {
            const isActive = sortField === key;
            return (
              <button
                key={key}
                id={`table-sort-${key}`}
                type="button"
                onClick={() => toggleSortField(key)}
                className={`px-2.5 py-1 rounded-lg border font-medium flex items-center gap-1 transition-colors ${
                  isActive
                    ? 'bg-brand/10 border-brand text-brand dark:bg-brand/20'
                    : 'border-border text-muted-foreground hover:bg-muted'
                }`}
                aria-pressed={isActive}
              >
                <span>{t(labelKey)}</span>
                {isActive && (
                  sortDirection === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                )}
              </button>
            );
          })}
        </div>

        {/* Hall / Floor Filter (visible when distinct floors exist or unassigned tables) */}
        {(distinctFloors.length > 0 || hasUnassigned) && (
          <div className="flex gap-1.5 overflow-x-auto pb-2 flex-shrink-0 -mx-1 px-1">
            <button
              id="table-floor-all"
              type="button"
              onClick={() => setPrefs((prev) => ({ ...prev, floorFilter: 'all' }))}
              className={`flex-shrink-0 text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
                floorFilter === 'all'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {t('tableFilterAllFloors')}
            </button>
            {distinctFloors.map((floor) => (
              <button
                key={floor}
                id={`table-floor-${floor}`}
                type="button"
                onClick={() => setPrefs((prev) => ({ ...prev, floorFilter: floor }))}
                className={`flex-shrink-0 text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
                  floorFilter === floor
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                {floor}
              </button>
            ))}
            {hasUnassigned && (
              <button
                id="table-floor-unassigned"
                type="button"
                onClick={() => setPrefs((prev) => ({ ...prev, floorFilter: UNASSIGNED_FLOOR }))}
                className={`flex-shrink-0 text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
                  floorFilter === UNASSIGNED_FLOOR
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                {t('tableFloorUnassigned')}
              </button>
            )}
          </div>
        )}

        {/* Status filter pills */}
        <div className="flex gap-1.5 overflow-x-auto pb-2 flex-shrink-0 -mx-1 px-1">
          {STATUS_FILTERS.map(({ key, labelKey }) => (
            <button
              key={key}
              id={`table-filter-${key}`}
              type="button"
              onClick={() => setPrefs((prev) => ({ ...prev, statusFilter: key }))}
              className={`flex-shrink-0 text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
                statusFilter === key
                  ? 'bg-brand text-white border-brand'
                  : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {t(labelKey)}
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
                              ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/40'
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
                        {table.internal_label && (
                          <span className="inline-block mt-0.5 text-[10px] bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded font-medium truncate max-w-full">
                            {table.internal_label}
                          </span>
                        )}
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
