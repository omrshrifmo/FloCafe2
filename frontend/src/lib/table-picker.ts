/**
 * Pure helper and logic functions for table sorting, filtering, grouping, and persistence.
 * Decoupled from React and stores for full testability and reuse.
 */

import type { Table } from './types';

export type StatusFilter = 'all' | 'available' | 'occupied' | 'reserved' | 'held' | 'cleaning';
export type TableSortField = 'number' | 'name' | 'status' | 'floor';
export type TableSortDirection = 'asc' | 'desc';

export const UNASSIGNED_FLOOR = '__unassigned__';
export const STORAGE_KEY = 'flocafe_table_picker_prefs';

export interface TablePickerPrefs {
  sortField: TableSortField;
  sortDirection: TableSortDirection;
  statusFilter: StatusFilter;
  floorFilter: string;
  groupByFloor: boolean;
}

export const DEFAULT_PREFS: TablePickerPrefs = {
  sortField: 'number',
  sortDirection: 'asc',
  statusFilter: 'all',
  floorFilter: 'all',
  groupByFloor: false,
};

export const STATUS_ORDER: Record<string, number> = {
  available: 0,
  occupied: 1,
  held: 2,
  reserved: 3,
  cleaning: 4,
};

/** Natural sort for table names that may contain numbers (e.g. Table 2 before Table 10). */
export function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function extractTableNumber(name: string): number {
  const match = name.match(/\d+/);
  return match ? parseInt(match[0], 10) : Number.POSITIVE_INFINITY;
}

/**
 * Filter and sort tables immutably according to active user preferences.
 */
export function filterAndSortTables(
  tables: Table[],
  prefs: TablePickerPrefs,
  getEffectiveStatus?: (table: Table) => StatusFilter
): Table[] {
  const getStatus = getEffectiveStatus ?? ((t: Table) => t.status as StatusFilter);

  // 1. Status Filter
  let res = prefs.statusFilter === 'all'
    ? [...tables]
    : tables.filter((t) => getStatus(t) === prefs.statusFilter);

  // 2. Hall/Floor Filter
  if (prefs.floorFilter !== 'all') {
    if (prefs.floorFilter === UNASSIGNED_FLOOR) {
      res = res.filter((t) => !(t.floor || t.section));
    } else {
      res = res.filter((t) => (t.floor || t.section) === prefs.floorFilter);
    }
  }

  // 3. Sorting (immutable copy)
  return res.sort((a, b) => {
    let cmp = 0;
    if (prefs.sortField === 'number') {
      const numA = extractTableNumber(a.name);
      const numB = extractTableNumber(b.name);
      if (numA !== numB) {
        cmp = numA - numB;
      } else {
        cmp = naturalSort(a.name, b.name);
      }
    } else if (prefs.sortField === 'name') {
      cmp = naturalSort(a.name, b.name);
    } else if (prefs.sortField === 'status') {
      const sa = STATUS_ORDER[getStatus(a)] ?? 99;
      const sb = STATUS_ORDER[getStatus(b)] ?? 99;
      cmp = sa !== sb ? sa - sb : naturalSort(a.name, b.name);
    } else if (prefs.sortField === 'floor') {
      const fa = a.floor || a.section || '';
      const fb = b.floor || b.section || '';
      cmp = naturalSort(fa, fb);
      if (cmp === 0) {
        cmp = naturalSort(a.name, b.name);
      }
    }
    return prefs.sortDirection === 'desc' ? -cmp : cmp;
  });
}

/**
 * Group sorted tables by floor/hall.
 */
export function groupTablesByFloor(
  tables: Table[],
  groupByFloor: boolean,
  unassignedLabel: string
): { label: string | null; items: Table[] }[] {
  if (!groupByFloor) {
    return [{ label: null, items: tables }];
  }

  const groups = new Map<string, Table[]>();
  for (const tbl of tables) {
    const key = (tbl.floor || tbl.section) || UNASSIGNED_FLOOR;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tbl);
  }

  return [...groups.entries()].map(([key, items]) => ({
    label: key === UNASSIGNED_FLOOR ? unassignedLabel : key,
    items,
  }));
}

export function loadTablePickerPrefs(): TablePickerPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    return {
      sortField: ['number', 'name', 'status', 'floor'].includes(parsed.sortField) ? parsed.sortField : 'number',
      sortDirection: parsed.sortDirection === 'desc' ? 'desc' : 'asc',
      statusFilter: ['all', 'available', 'occupied', 'reserved', 'held', 'cleaning'].includes(parsed.statusFilter) ? parsed.statusFilter : 'all',
      floorFilter: typeof parsed.floorFilter === 'string' ? parsed.floorFilter : 'all',
      groupByFloor: Boolean(parsed.groupByFloor),
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveTablePickerPrefs(prefs: TablePickerPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {}
}
