import type { BrowserWindow, Menu, MenuItem, WebFrameMain } from 'electron';
import { isCurrentRendererFrame } from './window-readiness';

/** A top-level application-menu entry the Windows/Linux title bar renders. */
export interface ApplicationMenuEntry {
  /** Stable semantic identifier for the menu (e.g. 'file', 'edit'); echoed back to open its submenu. */
  key: string;
  label: string;
}

/** The slice of a top-level `MenuItem` a title-bar entry needs. */
export type ApplicationMenuItem = Pick<MenuItem, 'label' | 'type'> &
  Partial<Pick<MenuItem, 'submenu' | 'id'>>;

/**
 * Top-level and submenu translations for English and Arabic.
 * Using stable semantic IDs guarantees consistent action dispatch and submenus in both locales.
 */
export function getMenuLabels(locale?: string): {
  top: Record<'file' | 'edit' | 'orders' | 'reports' | 'settings' | 'window' | 'help', string>;
  items: Record<string, string>;
} {
  const isAr = String(locale || '').toLowerCase().startsWith('ar');
  if (isAr) {
    return {
      top: {
        file: 'ملف',
        edit: 'تعديل',
        orders: 'الطلبات',
        reports: 'التقارير',
        settings: 'الإعدادات',
        window: 'نافذة',
        help: 'مساعدة',
      },
      items: {
        newOrder: 'طلب جديد',
        quickSearch: 'بحث سريع',
        backupDatabase: 'نسخ احتياطي لقاعدة البيانات',
        restoreBackup: 'استعادة النسخة الاحتياطية',
        dbHealthCheck: 'فحص صحة قاعدة البيانات',
        dbInitialize: 'تهيئة قاعدة البيانات',
        masterPin: 'رمز PIN الرئيسي…',
        exit: 'خروج',
        undo: 'تراجع',
        redo: 'إعادة',
        cut: 'قص',
        copy: 'نسخ',
        paste: 'لصق',
        selectAll: 'تحديد الكل',
        viewAllOrders: 'عرض جميع الطلبات',
        dailySummary: 'الملخص اليومي',
        salesReport: 'تقرير المبيعات',
        xReport: 'تقرير X',
        zReport: 'تقرير Z',
        businessSettings: 'إعدادات النشاط',
        taxSettings: 'إعدادات الضرائب',
        printerSetup: 'إعداد الطابعة',
        kitchenStations: 'محطات المطبخ',
        appWindow: 'فلو كافيه',
        minimize: 'تصغير',
        aboutFlo: 'حول البرنامج',
        checkUpdates: 'التحقق من وجود تحديثات',
        openLogs: 'فتح مجلد السجلات',
      },
    };
  }

  return {
    top: {
      file: 'File',
      edit: 'Edit',
      orders: 'Orders',
      reports: 'Reports',
      settings: 'Settings',
      window: 'Window',
      help: 'Help',
    },
    items: {
      newOrder: 'New Order',
      quickSearch: 'Quick Search',
      backupDatabase: 'Backup Database',
      restoreBackup: 'Restore Backup',
      dbHealthCheck: 'Database Health Check',
      dbInitialize: 'Initialize Database',
      masterPin: 'Master PIN…',
      exit: 'Exit',
      undo: 'Undo',
      redo: 'Redo',
      cut: 'Cut',
      copy: 'Copy',
      paste: 'Paste',
      selectAll: 'Select All',
      viewAllOrders: 'View All Orders',
      dailySummary: 'Daily Summary',
      salesReport: 'Sales Report',
      xReport: 'X Report',
      zReport: 'Z Report',
      businessSettings: 'Business Settings',
      taxSettings: 'Tax Settings',
      printerSetup: 'Printer Setup',
      kitchenStations: 'Kitchen Stations',
      appWindow: 'Flo Cafe',
      minimize: 'Minimize',
      aboutFlo: 'About Flo',
      checkUpdates: 'Check for Updates',
      openLogs: 'Open Logs Folder',
    },
  };
}

/**
 * Describes the top-level menu entries a frameless Windows/Linux title bar can
 * render. Electron never draws a menu bar for a frameless window, so the
 * renderer draws these labels and asks main to pop the real submenu; roles,
 * accelerators, and click handlers stay the ones `createMenu()` already built.
 */
export function listApplicationMenuEntries(
  items: readonly ApplicationMenuItem[],
): ApplicationMenuEntry[] {
  const entries: ApplicationMenuEntry[] = [];
  items.forEach((item, index) => {
    if (item.type === 'separator' || !item.submenu) return;
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    if (!label) return;
    const key = item.id && item.id.trim() ? item.id.trim() : String(index);
    entries.push({ key, label });
  });
  return entries;
}

/**
 * The identity of the window and frame an application-menu request came from,
 * already resolved by the main process.
 */
export interface ApplicationMenuSender {
  /** Window the request came from, or null when it belongs to none. */
  window: BrowserWindow | null;
  /** The sending webContents' current main frame. */
  currentFrame: WebFrameMain | null;
  /** The frame the invoking message was actually delivered to. */
  senderFrame: WebFrameMain | null | undefined;
}

/**
 * The submenu popup is a privileged native surface on the main window, so only
 * that window's own current renderer frame may request one. The localhost
 * origin check alone is not enough: other windows this process serves, such as
 * the KDS window, pass it while belonging to a different window.
 */
export function isApplicationMenuSender(
  mainWindow: BrowserWindow | null,
  sender: ApplicationMenuSender,
): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (sender.window !== mainWindow) return false;
  return isCurrentRendererFrame(sender.senderFrame, sender.currentFrame);
}

/**
 * Menu popup coordinates are relative to the window's content bounds, and
 * Electron reads a negative pair as "open at the cursor", so only the finite
 * non-negative coordinates the renderer measures from a button rect are valid.
 */
function isPopupCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Pops the submenu behind a title-bar entry label. */
export function openApplicationMenuSubmenu(
  menu: Menu | null,
  key: unknown,
  window: BrowserWindow | null,
  x: unknown,
  y: unknown,
): { success: true } | { error: string } {
  if (!menu) return { error: 'Application menu unavailable' };
  if (!window || window.isDestroyed()) return { error: 'Window unavailable' };
  if (typeof key !== 'string' || !key.trim()) return { error: 'Unknown menu entry' };

  // Look up by stable semantic ID first, then fallback to numeric index for backwards compatibility
  const item = (typeof menu.getMenuItemById === 'function' ? menu.getMenuItemById(key) : null) ??
    (/^[0-9]+$/.test(key) ? menu.items[Number(key)] : null) ??
    menu.items.find((candidate) => candidate.id === key);

  if (!item) return { error: 'Unknown menu entry' };
  if (!item.submenu) return { error: 'Menu entry has no submenu' };
  if (!isPopupCoordinate(x) || !isPopupCoordinate(y)) return { error: 'Invalid menu position' };

  // Electron's window popup coordinates are relative to the window's content bounds in DIPs.
  // Integer rounding prevents subpixel jitter under Windows DPI scaling (125%, 150%).
  // Clamping prevents native submenus from opening outside the active window area.
  let clampedX = Math.round(x);
  let clampedY = Math.round(y);
  try {
    const bounds = window.getContentBounds();
    clampedX = Math.max(0, Math.min(clampedX, Math.max(0, bounds.width - 10)));
    clampedY = Math.max(0, Math.min(clampedY, Math.max(0, bounds.height - 10)));
  } catch {
    // If getContentBounds is unavailable, keep the rounded coordinates.
  }

  item.submenu.popup({ window, x: clampedX, y: clampedY });
  return { success: true };
}
