'use client';

import { useState, useEffect } from 'react';
import PrinterStatus from './PrinterStatus';
import CustomerSearch from './CustomerSearch';
import { useCartStore } from '@/store/cart';
import { useAuthStore } from '@/store/auth';
import { usePosSettingsStore } from '@/store/pos-settings';
import { Banknote, LayoutGrid, Maximize2, Minimize2, LockOpen, Lock, Zap, Coffee, X } from 'lucide-react';
import type { Table } from '@/lib/types';
import { useTranslations } from 'use-intl';
import api from '@/lib/api';

interface Props {
  tables: Table[];
  onShowTablePicker: () => void;
  onShowCashMovement: () => void;
  onShowShift: () => void;
  shiftHasOpenSession: boolean;
  shiftLoading: boolean;
  shiftError: string | null;
  canUseShift: boolean;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onToggleFastTouch?: () => void;
}

export default function PosTopbar({ tables, onShowTablePicker, onShowCashMovement, onShowShift, shiftHasOpenSession, shiftLoading, shiftError, canUseShift, fullscreen, onToggleFullscreen, onToggleFastTouch }: Props) {
  const cart = useCartStore();
  const { currentTenant } = useAuthStore();
  const tablesRequired = usePosSettingsStore((s) => s.tablesRequired);
  const t = useTranslations('pos');
  const tDashboard = useTranslations('dashboard');
  const isRestaurant = (currentTenant?.business_type ?? 'restaurant') === 'restaurant';
  const showTableBtn = isRestaurant && cart.orderType === 'dine_in' && tablesRequired;

  const [showWasteModal, setShowWasteModal] = useState(false);
  const [wasteType, setWasteType] = useState('barista_calibration');
  const [wasteSourceType] = useState<'product_bom' | 'inventory'>('product_bom');
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [wasteQty, setWasteQty] = useState('1');
  const [wasteReason, setWasteReason] = useState('');
  const [wasteSubmitting, setWasteSubmitting] = useState(false);
  const [wasteSuccess, setWasteSuccess] = useState(false);

  useEffect(() => {
    if (showWasteModal && products.length === 0) {
      api.get('/products').then((res) => {
        const prods = res.data.products || res.data || [];
        setProducts(prods);
        if (prods.length > 0) setSelectedProductId(prods[0].id);
      }).catch(console.error);
    }
  }, [showWasteModal, products.length]);

  const handleLogWaste = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductId) return;
    setWasteSubmitting(true);
    try {
      await api.post('/inventory/waste-logs', {
        waste_type: wasteType,
        source_type: wasteSourceType,
        source_id: selectedProductId,
        quantity: Math.max(1, Number(wasteQty) || 1),
        reason: wasteReason || (wasteType === 'barista_calibration' ? 'Morning Grinder Dial-In' : 'Authorized Waste'),
      });
      setWasteSuccess(true);
      setTimeout(() => {
        setWasteSuccess(false);
        setShowWasteModal(false);
        setWasteReason('');
        setWasteQty('1');
      }, 1200);
    } catch (err: unknown) {
      const errorMsg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        || (err as Error)?.message
        || 'Failed to log waste';
      alert(errorMsg);
    } finally {
      setWasteSubmitting(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-3 border-b bg-card shrink-0 px-4 py-2.5 app-region-no-drag relative z-30 select-none">
        <div className="flex-1 min-w-0">
          <CustomerSearch variant="topbar" />
        </div>

        {/* Select Table — between customer search and printer */}
        {showTableBtn && (
          <button
            onClick={onShowTablePicker}
            className={`touch-target shrink-0 gap-1.5 px-3 text-sm rounded-lg border font-medium transition-colors whitespace-nowrap ${
              cart.tableId
                ? 'bg-orange-500 text-white border-orange-500 hover:bg-orange-600'
                : 'bg-amber-50 border-amber-400 text-amber-700 hover:bg-amber-100'
            }`}
          >
            <LayoutGrid size={14} />
            {cart.tableId
              ? t('tableLabel', { name: tables.find(t => t.id === cart.tableId)?.name || cart.tableId })
              : t('selectTable')}
          </button>
        )}

        <button
          type="button"
          onClick={onShowCashMovement}
          className="touch-target shrink-0 gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted active:bg-muted whitespace-nowrap"
          title={tDashboard('cashMovement')}
          aria-label={tDashboard('cashMovement')}
        >
          <Banknote size={16} />
          <span className="hidden sm:inline">{tDashboard('cashMovement')}</span>
        </button>

        {/* ☕ Quick Waste / Barista Dial-In button */}
        <button
          type="button"
          onClick={() => setShowWasteModal(true)}
          className="touch-target shrink-0 gap-1.5 rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 text-sm font-semibold text-amber-600 transition-colors hover:bg-amber-500/20 active:bg-amber-500/25 whitespace-nowrap"
          title="Log Waste / Barista Dial-In"
          aria-label="Log Waste / Barista Dial-In"
        >
          <Coffee size={16} />
          <span className="hidden sm:inline">☕ Waste / Dial-In</span>
        </button>

        {canUseShift && (
          <button
            type="button"
            onClick={onShowShift}
            disabled={shiftLoading}
            className="touch-target shrink-0 gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted active:bg-muted whitespace-nowrap disabled:opacity-50"
            title={shiftError ?? (shiftHasOpenSession ? tDashboard('closeShiftSession') : tDashboard('openShift'))}
            aria-label={shiftHasOpenSession ? tDashboard('closeShiftSession') : tDashboard('openShift')}
          >
            {shiftHasOpenSession ? <Lock size={16} /> : <LockOpen size={16} />}
            <span className="hidden sm:inline">{shiftHasOpenSession ? tDashboard('closeShiftSession') : tDashboard('openShift')}</span>
          </button>
        )}

        <div className="shrink-0">
          <PrinterStatus />
        </div>
        {onToggleFastTouch && (
          <button
            type="button"
            onClick={onToggleFastTouch}
            className="touch-target shrink-0 gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 text-sm font-semibold text-amber-600 transition-colors hover:bg-amber-500/20 active:bg-amber-500/25 whitespace-nowrap"
            title="Fast-Touch Express Mode"
            aria-label="Fast-Touch Express Mode"
          >
            <Zap size={16} />
            <span className="hidden sm:inline">Fast-Touch</span>
          </button>
        )}

        <button
          type="button"
          onClick={onToggleFullscreen}
          className="touch-target shrink-0 rounded-lg border border-border bg-card px-3 text-muted-foreground transition-colors hover:bg-muted active:bg-muted"
          title={fullscreen ? t('exitFullscreen') : t('enterFullscreen')}
          aria-label={fullscreen ? t('exitFullscreen') : t('enterFullscreen')}
        >
          {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>

      {/* ☕ Log Waste / Dial-In Modal */}
      {showWasteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl overflow-hidden p-6 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b">
              <div className="flex items-center gap-2">
                <Coffee className="text-amber-600" size={20} />
                <h3 className="font-bold text-lg text-foreground">Log Waste & Dial-In</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowWasteModal(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
              >
                <X size={18} />
              </button>
            </div>

            {wasteSuccess ? (
              <div className="py-8 text-center text-emerald-600 font-bold text-lg animate-in fade-in">
                ✓ Recorded successfully! BOM stock depleted.
              </div>
            ) : (
              <form onSubmit={handleLogWaste} className="space-y-4 pt-4">
                <div>
                  <label className="text-xs font-semibold uppercase text-muted-foreground block mb-1">Waste Type</label>
                  <select
                    value={wasteType}
                    onChange={(e) => setWasteType(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="barista_calibration">☕ Barista Dial-In / Calibration</option>
                    <option value="staff_meal_drink">🍽️ Staff Meal / Staff Drink</option>
                    <option value="spillage_remake">⚠️ Spillage / Remake</option>
                    <option value="expired_spoilage">🍂 Expired / Spoilage</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase text-muted-foreground block mb-1">Item (BOM Recipe)</label>
                  <select
                    value={selectedProductId}
                    onChange={(e) => setSelectedProductId(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-amber-500"
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold uppercase text-muted-foreground block mb-1">Quantity</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={wasteQty}
                      onChange={(e) => setWasteQty(e.target.value)}
                      className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm font-semibold"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase text-muted-foreground block mb-1">Reason / Notes</label>
                    <input
                      type="text"
                      placeholder="e.g. Grinder adjustment"
                      value={wasteReason}
                      onChange={(e) => setWasteReason(e.target.value)}
                      className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowWasteModal(false)}
                    className="flex-1 rounded-xl border border-border py-2 text-sm font-medium hover:bg-muted"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={wasteSubmitting}
                    className="flex-1 rounded-xl bg-amber-600 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    {wasteSubmitting ? 'Logging...' : 'Confirm & Deplete'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
