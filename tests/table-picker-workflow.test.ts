/**
 * Unit & Behavioral Test: TablePickerModal Sorting, Filtering, Grouping & Persistence
 *
 * Verifies:
 * 1. Natural sorting: Table 2 before Table 10
 * 2. Sort fields: number, name, status, floor
 * 3. Sort directions: ascending, descending
 * 4. Filters: status filter (all, available, occupied, reserved, held, cleaning)
 * 5. Floor filters: all, specific floor, unassigned tables
 * 6. Grouping: grouped by floor/hall with headers and unassigned handling
 * 7. Persistence: loads and saves preferences in localStorage safely
 * 8. Immutability: input tables array and table objects are NEVER mutated
 * 9. Localization: labels exist in both English (en.json) and Arabic (ar.json)
 *
 * Usage: npx ts-node --transpile-only -P tests/tsconfig.json tests/table-picker-workflow.test.ts
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Table } from '../frontend/src/lib/types';
import {
  naturalSort,
  extractTableNumber,
  filterAndSortTables,
  groupTablesByFloor,
  UNASSIGNED_FLOOR,
  DEFAULT_PREFS,
  loadTablePickerPrefs,
  saveTablePickerPrefs,
  type TablePickerPrefs,
} from '../frontend/src/lib/table-picker';

console.log('── TablePickerModal Workflow Tests ──────────────────────────\n');

// ── Test Mock Data ──────────────────────────────────────────────────────────
const mockTables: Table[] = [
  { id: 't-10', name: 'Table 10', capacity: 4, status: 'available', kitchen_station_id: null, floor: 'Main Hall', section: null, position_x: null, position_y: null, is_active: true },
  { id: 't-2', name: 'Table 2', capacity: 2, status: 'occupied', kitchen_station_id: null, floor: 'Main Hall', section: null, position_x: null, position_y: null, is_active: true },
  { id: 't-1', name: 'Table 1', capacity: 4, status: 'reserved', kitchen_station_id: null, floor: 'Terrace', section: null, position_x: null, position_y: null, is_active: true },
  { id: 't-20', name: 'Table 20', capacity: 6, status: 'cleaning', kitchen_station_id: null, floor: null, section: null, position_x: null, position_y: null, is_active: true },
  { id: 't-3', name: 'Table 3', capacity: 2, status: 'held', kitchen_station_id: null, floor: 'Terrace', section: null, position_x: null, position_y: null, is_active: true },
  { id: 't-alpha', name: 'VIP Lounge', capacity: 8, status: 'available', kitchen_station_id: null, floor: null, section: null, position_x: null, position_y: null, is_active: true },
];

// Snapshot of mockTables to verify immutability
const originalSnapshot = JSON.stringify(mockTables);

// ── 1. Natural Sort & Number Extraction ─────────────────────────────────────
assert.equal(naturalSort('Table 2', 'Table 10') < 0, true, 'naturalSort: Table 2 comes before Table 10');
assert.equal(naturalSort('Table 10', 'Table 2') > 0, true, 'naturalSort: Table 10 comes after Table 2');
assert.equal(extractTableNumber('Table 2'), 2);
assert.equal(extractTableNumber('Table 10'), 10);
assert.equal(extractTableNumber('VIP Lounge'), Number.POSITIVE_INFINITY);
console.log('  ✓ Natural sorting sorts Table 2 before Table 10');

// ── 2. Sort by Number (Ascending and Descending) ────────────────────────────
const sortedByNumberAsc = filterAndSortTables(mockTables, {
  ...DEFAULT_PREFS,
  sortField: 'number',
  sortDirection: 'asc',
});
assert.equal(sortedByNumberAsc[0].name, 'Table 1');
assert.equal(sortedByNumberAsc[1].name, 'Table 2');
assert.equal(sortedByNumberAsc[2].name, 'Table 3');
assert.equal(sortedByNumberAsc[3].name, 'Table 10');
assert.equal(sortedByNumberAsc[4].name, 'Table 20');
assert.equal(sortedByNumberAsc[5].name, 'VIP Lounge'); // Non-numeric at end
console.log('  ✓ Sort by number ascending correctly orders 1, 2, 3, 10, 20, non-numeric');

const sortedByNumberDesc = filterAndSortTables(mockTables, {
  ...DEFAULT_PREFS,
  sortField: 'number',
  sortDirection: 'desc',
});
assert.equal(sortedByNumberDesc[0].name, 'VIP Lounge');
assert.equal(sortedByNumberDesc[1].name, 'Table 20');
assert.equal(sortedByNumberDesc[2].name, 'Table 10');
console.log('  ✓ Sort by number descending inverts order accurately');

// ── 3. Sort by Name ────────────────────────────────────────────────────────
const sortedByName = filterAndSortTables(mockTables, {
  ...DEFAULT_PREFS,
  sortField: 'name',
  sortDirection: 'asc',
});
assert.equal(sortedByName[0].name, 'Table 1');
assert.equal(sortedByName[1].name, 'Table 2');
assert.equal(sortedByName[5].name, 'VIP Lounge');
console.log('  ✓ Sort by name uses natural sort collation');

// ── 4. Sort by Status ──────────────────────────────────────────────────────
const sortedByStatus = filterAndSortTables(mockTables, {
  ...DEFAULT_PREFS,
  sortField: 'status',
  sortDirection: 'asc',
});
const statuses = sortedByStatus.map((t) => t.status);
assert.equal(statuses[0], 'available');
assert.equal(statuses[statuses.length - 1], 'cleaning');
console.log('  ✓ Sort by status respects status order: available -> occupied -> held -> reserved -> cleaning');

// ── 5. Status Filtering ────────────────────────────────────────────────────
const occupiedOnly = filterAndSortTables(mockTables, {
  ...DEFAULT_PREFS,
  statusFilter: 'occupied',
});
assert.equal(occupiedOnly.length, 1);
assert.equal(occupiedOnly[0].id, 't-2');

const availableOnly = filterAndSortTables(mockTables, {
  ...DEFAULT_PREFS,
  statusFilter: 'available',
});
assert.equal(availableOnly.length, 2);
console.log('  ✓ Status filter correctly isolates tables by status');

// ── 6. Hall/Floor Filtering ────────────────────────────────────────────────
const mainHallOnly = filterAndSortTables(mockTables, {
  ...DEFAULT_PREFS,
  floorFilter: 'Main Hall',
});
assert.equal(mainHallOnly.length, 2);
assert.equal(mainHallOnly.every((t) => t.floor === 'Main Hall'), true);

const unassignedOnly = filterAndSortTables(mockTables, {
  ...DEFAULT_PREFS,
  floorFilter: UNASSIGNED_FLOOR,
});
assert.equal(unassignedOnly.length, 2);
assert.equal(unassignedOnly.every((t) => !t.floor), true);
console.log('  ✓ Hall/floor filter supports specific hall and unassigned tables');

// ── 7. Grouping by Hall/Floor ──────────────────────────────────────────────
const distinctFloors = Array.from(
  new Set(
    mockTables
      .map((tbl) => tbl.floor || tbl.section)
      .filter((f): f is string => Boolean(f && f.trim()))
  )
).sort(naturalSort);
assert.deepEqual(distinctFloors, ['Main Hall', 'Terrace']);

const groups = groupTablesByFloor(sortedByNumberAsc, true, 'Unassigned');
assert.equal(groups.some((g) => g.label === 'Main Hall'), true);
assert.equal(groups.some((g) => g.label === 'Terrace'), true);
assert.equal(groups.some((g) => g.label === 'Unassigned'), true);
console.log('  ✓ Grouping groups tables with correct floor labels and handles unassigned');

// ── 8. Immutability Safety ─────────────────────────────────────────────────
assert.equal(JSON.stringify(mockTables), originalSnapshot, 'Original tables array must not be mutated');
console.log('  ✓ Safety guaranteed: sorting, filtering, and grouping did not mutate tables array');

// ── 9. LocalStorage Persistence ────────────────────────────────────────────
const mockStorage: Record<string, string> = {};
(global as any).window = {};
(global as any).localStorage = {
  getItem: (k: string) => mockStorage[k] || null,
  setItem: (k: string, v: string) => { mockStorage[k] = v; },
};

const initialPrefs = loadTablePickerPrefs();
assert.deepEqual(initialPrefs, DEFAULT_PREFS);

const customPrefs: TablePickerPrefs = {
  sortField: 'floor',
  sortDirection: 'desc',
  statusFilter: 'available',
  floorFilter: 'Terrace',
  groupByFloor: true,
};
saveTablePickerPrefs(customPrefs);
const reloadedPrefs = loadTablePickerPrefs();
assert.deepEqual(reloadedPrefs, customPrefs);
console.log('  ✓ Preference persistence in localStorage functions correctly');

// ── 10. Translation Catalogs Verification ──────────────────────────────────
const enJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../frontend/src/lib/i18n/messages/en.json'), 'utf8'));
const arJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../frontend/src/lib/i18n/messages/ar.json'), 'utf8'));

// Verify required labels in English
assert.equal(enJson.pos.tableFilterAll, 'All');
assert.equal(enJson.pos.tableFilterAvailable, 'Available');
assert.equal(enJson.pos.tableSortByNumber, 'Number');
assert.equal(enJson.pos.tableSortByName, 'Name');
assert.equal(enJson.pos.tableSortByStatus, 'Status');
assert.equal(enJson.pos.tableSortByFloor, 'Hall / Floor');
assert.equal(enJson.pos.tableFloorUnassigned, 'Unassigned');
assert.equal(enJson.pos.tableGroupByFloor, 'Group by Hall');

// Verify required labels in Arabic
assert.equal(arJson.pos.tableFilterAll, 'الكل');
assert.equal(arJson.pos.tableFilterAvailable, 'متاحة');
assert.equal(arJson.pos.tableSortByNumber, 'الرقم');
assert.equal(arJson.pos.tableSortByName, 'الاسم');
assert.equal(arJson.pos.tableSortByStatus, 'الحالة');
assert.equal(arJson.pos.tableSortByFloor, 'القاعة / الطابق');
assert.equal(arJson.pos.tableFloorUnassigned, 'غير محددة');
assert.equal(arJson.pos.tableGroupByFloor, 'تجميع حسب القاعة');
console.log('  ✓ English and Arabic translations contain all required exact strings');

console.log('\n  10 passed, 0 failed\n');
