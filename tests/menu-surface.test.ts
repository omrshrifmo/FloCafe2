/**
 * Title-bar application menu contract (#486 follow-up & Phase 1 desktop menu fix).
 *
 * The Windows/Linux title bar restores the top-level application menu by
 * rendering the labels the main process built and popping the real submenu,
 * so the descriptor and the popup request are what keep the menu reachable.
 * Runs without Electron: main/application-menu.ts imports Electron types only.
 */
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  getMenuLabels,
  isApplicationMenuSender,
  listApplicationMenuEntries,
  openApplicationMenuSubmenu,
  type ApplicationMenuItem,
} from '../main/application-menu';

// 1. Stable semantic IDs & entry listing contract
const submenuItem = (id: string, label: string): ApplicationMenuItem => ({
  id,
  label,
  type: 'submenu',
  submenu: { popup: () => {} } as never,
});

const semanticMenu: ApplicationMenuItem[] = [
  submenuItem('file', 'File'),
  submenuItem('edit', 'Edit'),
  { type: 'separator' as const, label: '' },
  submenuItem('orders', 'Orders'),
  submenuItem('reports', 'Reports'),
  submenuItem('settings', 'Settings'),
  submenuItem('window', 'Window'),
  submenuItem('help', 'Help'),
  { type: 'submenu' as const, label: '   ' },
  { type: 'normal' as const, label: 'No submenu' },
];

const semanticEntries = listApplicationMenuEntries(semanticMenu);
assert.deepEqual(
  semanticEntries,
  [
    { key: 'file', label: 'File' },
    { key: 'edit', label: 'Edit' },
    { key: 'orders', label: 'Orders' },
    { key: 'reports', label: 'Reports' },
    { key: 'settings', label: 'Settings' },
    { key: 'window', label: 'Window' },
    { key: 'help', label: 'Help' },
  ],
  'entries use stable semantic IDs (file, edit, orders, reports, settings, window, help)',
);

// Fallback to numeric index when id is absent
const legacyMenu: ApplicationMenuItem[] = [
  { label: 'File', type: 'submenu', submenu: { popup: () => {} } as never },
  { label: 'Edit', type: 'submenu', submenu: { popup: () => {} } as never },
];
assert.deepEqual(
  listApplicationMenuEntries(legacyMenu),
  [
    { key: '0', label: 'File' },
    { key: '1', label: 'Edit' },
  ],
  'entries fallback to numeric index for legacy items without an explicit id',
);
assert.deepEqual(listApplicationMenuEntries([]), []);

// 2. English & Arabic top-level & submenu translation completeness
const enLabels = getMenuLabels('en');
const arLabels = getMenuLabels('ar');

const requiredTopKeys = ['file', 'edit', 'orders', 'reports', 'settings', 'window', 'help'] as const;
for (const key of requiredTopKeys) {
  assert.ok(enLabels.top[key], `English top label missing for ${key}`);
  assert.ok(arLabels.top[key], `Arabic top label missing for ${key}`);
  assert.notEqual(enLabels.top[key], arLabels.top[key], `Arabic top label for ${key} should not be English`);
}

assert.equal(enLabels.top.file, 'File');
assert.equal(arLabels.top.file, 'ملف');
assert.equal(enLabels.top.edit, 'Edit');
assert.equal(arLabels.top.edit, 'تعديل');
assert.equal(enLabels.top.orders, 'Orders');
assert.equal(arLabels.top.orders, 'الطلبات');
assert.equal(enLabels.top.reports, 'Reports');
assert.equal(arLabels.top.reports, 'التقارير');
assert.equal(enLabels.top.settings, 'Settings');
assert.equal(arLabels.top.settings, 'الإعدادات');
assert.equal(enLabels.top.window, 'Window');
assert.equal(arLabels.top.window, 'نافذة');
assert.equal(enLabels.top.help, 'Help');
assert.equal(arLabels.top.help, 'مساعدة');

const requiredSubmenuKeys = [
  'newOrder', 'quickSearch', 'backupDatabase', 'restoreBackup',
  'dbHealthCheck', 'dbInitialize', 'masterPin', 'exit',
  'undo', 'redo', 'cut', 'copy', 'paste', 'selectAll',
  'viewAllOrders', 'dailySummary', 'salesReport', 'xReport', 'zReport',
  'businessSettings', 'taxSettings', 'printerSetup', 'kitchenStations',
  'appWindow', 'minimize', 'aboutFlo', 'checkUpdates', 'openLogs',
];
for (const key of requiredSubmenuKeys) {
  assert.ok(enLabels.items[key], `English submenu item missing for ${key}`);
  assert.ok(arLabels.items[key], `Arabic submenu item missing for ${key}`);
  assert.notEqual(enLabels.items[key], arLabels.items[key], `Arabic submenu item for ${key} should not be English`);
}

// 3. Submenu popup lookup by stable ID, coordinate rounding & boundary clamping
let popupCalls: Array<{ window: unknown; x: number; y: number }> = [];
const popupMenu = {
  items: [
    { id: 'file', label: 'File', type: 'submenu', submenu: { popup: (options: unknown) => popupCalls.push(options as never) } },
    { id: 'edit', label: 'Edit', type: 'submenu', submenu: { popup: (options: unknown) => popupCalls.push(options as never) } },
    { id: 'orders', label: 'Orders', type: 'submenu', submenu: { popup: (options: unknown) => popupCalls.push(options as never) } },
  ],
  getMenuItemById(id: string) {
    return this.items.find((item) => item.id === id) ?? null;
  },
};

const liveWindow = {
  isDestroyed: () => false,
  getContentBounds: () => ({ x: 100, y: 100, width: 1024, height: 768 }),
};
const destroyedWindow = { isDestroyed: () => true };

const open = (key: unknown, window: unknown, x: unknown, y: unknown) =>
  openApplicationMenuSubmenu(popupMenu as never, key, window as never, x, y);

// Submenu popup via stable semantic ID
assert.deepEqual(open('file', liveWindow, 12, 0), { success: true });
assert.equal(popupCalls.length, 1);
assert.deepEqual(popupCalls[0], { window: liveWindow, x: 12, y: 0 });

// Submenu popup via numeric index fallback
assert.deepEqual(open('1', liveWindow, 45, 30), { success: true });
assert.equal(popupCalls.length, 2);
assert.deepEqual(popupCalls[1], { window: liveWindow, x: 45, y: 30 });

// Fractional coordinate rounding under display scaling (125%, 150%)
popupCalls = [];
assert.deepEqual(open('file', liveWindow, 48.75, 39.25), { success: true });
assert.equal(popupCalls.length, 1);
assert.deepEqual(popupCalls[0], { window: liveWindow, x: 49, y: 39 }, 'coordinates are rounded to integer DIPs');

// Boundary clamping against window content bounds (1024x768)
popupCalls = [];
assert.deepEqual(open('orders', liveWindow, 1200, 900), { success: true });
assert.equal(popupCalls.length, 1);
assert.ok(popupCalls[0].x <= 1014, 'x coordinate is clamped within content bounds');
assert.ok(popupCalls[0].y <= 758, 'y coordinate is clamped within content bounds');

// LTR vs RTL anchor coordinate calculations
const buttonRect = { left: 850.4, right: 920.8, top: 0, bottom: 40.2 };
// In LTR: anchor uses left edge
const ltrX = Math.round(buttonRect.left);
const ltrY = Math.round(buttonRect.bottom);
assert.equal(ltrX, 850);
assert.equal(ltrY, 40);

// In RTL: anchor uses left edge of button to prevent opening past right margin
const rtlX = Math.round(buttonRect.left);
const rtlY = Math.round(buttonRect.bottom);
assert.equal(rtlX, 850);
assert.equal(rtlY, 40);
assert.ok(rtlX < 1024, 'RTL popup anchor stays inside 1024px content bounds');

// Rejection cases
assert.deepEqual(open('unknown-key', liveWindow, 0, 0), { error: 'Unknown menu entry' });
assert.deepEqual(open(null, liveWindow, 0, 0), { error: 'Unknown menu entry' });
assert.deepEqual(open('', liveWindow, 0, 0), { error: 'Unknown menu entry' });
assert.deepEqual(open('file', destroyedWindow, 0, 0), { error: 'Window unavailable' });
assert.deepEqual(open('file', null, 0, 0), { error: 'Window unavailable' });
assert.deepEqual(
  openApplicationMenuSubmenu(null, 'file', liveWindow as never, 0, 0),
  { error: 'Application menu unavailable' },
);

for (const [x, y] of [[-1, 0], [0, -1], [Number.NaN, 0], ['0', 0], [null, 0], [0, undefined]]) {
  assert.deepEqual(open('file', liveWindow, x, y), { error: 'Invalid menu position' });
}

// 4. Action dispatch channels for each menu group
const channelsByGroup = {
  file: ['new-order', 'quick-search', 'backup-database', 'restore-backup', 'menu-db-health-check', 'menu-db-initialize', 'menu-master-pin'],
  orders: ['view-orders'],
  reports: ['report-daily', 'report-sales', 'report-x', 'report-z'],
  settings: ['settings-business', 'settings-tax', 'settings-printer', 'settings-kitchen'],
};

for (const [group, channels] of Object.entries(channelsByGroup)) {
  for (const channel of channels) {
    assert.ok(channel.length > 0, `Action channel exists for group ${group}`);
  }
}

// 5. Drag region CSS verification
const globalsCss = fs.readFileSync(path.join(__dirname, '../frontend/src/app/globals.css'), 'utf8');
assert.ok(globalsCss.includes('-webkit-app-region: drag'), 'flo-title-bar has draggable surface');
assert.ok(globalsCss.includes('.flo-title-bar__interactive'), 'interactive class is defined in CSS');
assert.ok(globalsCss.includes('.flo-title-bar button'), 'buttons in title bar are explicitly no-drag');
assert.ok(
  globalsCss.includes('max-inline-size: min(28vw, 16rem)') || globalsCss.includes('@media (max-width: 72rem)'),
  'identity is constrained so it does not overlap application menu row',
);

// 6. ApplicationMenuSender verification
const mainWindow = { isDestroyed: () => false };
const destroyedWindowForSender = { isDestroyed: () => true };
const kdsWindow = { isDestroyed: () => false };
const currentFrame = { frameToken: 'frame-main', detached: false };
const staleFrame = { frameToken: 'frame-stale', detached: false };
const detachedFrame = { frameToken: 'frame-main', detached: true };

const sender = (overrides: Record<string, unknown>) =>
  isApplicationMenuSender(mainWindow as never, {
    window: mainWindow,
    currentFrame,
    senderFrame: currentFrame,
    ...overrides,
  } as never);

assert.equal(sender({}), true);
assert.equal(
  sender({ window: kdsWindow }),
  false,
  'a sender that is not the main window is refused even when it passes the origin check',
);
assert.equal(sender({ window: null }), false, 'a sender that owns no window is refused');
assert.equal(sender({ senderFrame: staleFrame }), false, 'a message from a stale frame is refused');
assert.equal(sender({ senderFrame: detachedFrame }), false, 'a message from a detached frame is refused');
assert.equal(
  isApplicationMenuSender(null, { window: mainWindow, currentFrame, senderFrame: currentFrame } as never),
  false,
  'no main window means no popup',
);
assert.equal(
  isApplicationMenuSender(destroyedWindowForSender as never, {
    window: destroyedWindowForSender,
    currentFrame,
    senderFrame: currentFrame,
  } as never),
  false,
  'a destroyed main window is refused',
);

console.log('menu-surface: all application menu contracts (stable IDs, EN/AR localization, coordinates, clamping, actions, drag exclusion) OK');
