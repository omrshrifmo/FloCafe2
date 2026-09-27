'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'use-intl';
import { usePosSettingsStore } from '@/store/pos-settings';
import type { ApplicationMenuEntry } from '@/types/electron';

const subscribeToElectronCapability = () => () => {};
const getElectronCapability = () => typeof window !== 'undefined' && Boolean(window.electronAPI?.getStatus);
const getServerElectronCapability = () => false;

const MENU_LABELS: Record<string, Record<string, string>> = {
  ar: {
    file: 'ملف',
    edit: 'تعديل',
    orders: 'الطلبات',
    reports: 'التقارير',
    settings: 'الإعدادات',
    window: 'نافذة',
    help: 'مساعدة',
  },
  en: {
    file: 'File',
    edit: 'Edit',
    orders: 'Orders',
    reports: 'Reports',
    settings: 'Settings',
    window: 'Window',
    help: 'Help',
  },
};

/**
 * Restores the top-level application menu on the frameless Windows and Linux
 * title bars. Electron does not draw a menu bar for a frameless window, so
 * this renders the labels the main process built and asks it to pop the
 * matching submenu; the entries, roles, accelerators, and click handlers are
 * still the ones the native application menu uses. macOS keeps its
 * authoritative native menu bar and renders nothing.
 */
export default function ApplicationMenuRow() {
  const tCommon = useTranslations('common');
  const language = usePosSettingsStore((s) => s.language);
  const isElectron = useSyncExternalStore(
    subscribeToElectronCapability,
    getElectronCapability,
    getServerElectronCapability,
  );
  const [entries, setEntries] = useState<ApplicationMenuEntry[]>([]);

  useEffect(() => {
    if (!isElectron || window.electronAPI?.platform === 'darwin') return;
    let cancelled = false;
    void window.electronAPI
      ?.getApplicationMenu(language)
      .then((result) => {
        if (cancelled || 'error' in result) return;
        setEntries(result.entries);
      })
      // Main rejects the invoke when the renderer tears down before it
      // answers, so an uncatchable rejection would surface in the console.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isElectron, language]);

  if (entries.length === 0) return null;

  return (
    <div
      data-testid="desktop-application-menu"
      role="menubar"
      aria-label={tCommon('appTitle')}
      className="flo-title-bar__menu flo-title-bar__interactive pointer-events-auto flex items-center"
    >
      {entries.map((entry) => {
        const localizedLabel = MENU_LABELS[language]?.[entry.key] || entry.label;
        return (
          <button
            key={entry.key}
            data-testid={`desktop-menu-${entry.key}`}
            type="button"
            role="menuitem"
            className="flo-title-bar__menu-button"
            onClick={(event) => {
              // Electron anchors the popup's top-left at content-bounds-relative DIPs.
              // We round the viewport rect to integer coordinates to avoid subpixel jitter
              // under Windows display scaling (100%, 125%, 150%).
              const rect = event.currentTarget.getBoundingClientRect();
              const x = Math.round(rect.left);
              const y = Math.round(rect.bottom);
              void window.electronAPI?.openApplicationMenu(entry.key, x, y).catch(() => {});
            }}
          >
            {localizedLabel}
          </button>
        );
      })}
    </div>
  );
}
