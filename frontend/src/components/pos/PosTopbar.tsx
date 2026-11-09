'use client';

import { useState, useEffect } from 'react';
import PrinterStatus from './PrinterStatus';
import CustomerSearch from './CustomerSearch';
import { useCartStore } from '@/store/cart';
import { useAuthStore } from '@/store/auth';
import { usePosSettingsStore } from '@/store/pos-settings';
import { Banknote, LayoutGrid, Maximize2, Minimize2, LockOpen, Lock, Zap, Coffee, X, ShieldAlert, ArrowDownCircle } from 'lucide-react';
import type { Table } from '@/lib/types';
import { useTranslations } from 'use-intl';
import api from '@/lib/api';
import { useAppLanguage } from '@/lib/i18n/bilingual';

interface Props {
  tables: Table[];
  onShowTablePicker: () => void;
  onShowCashMovement: () => void;
  onShowShift: () => void;
  onShowFullDayClose?: () => void;
  shiftHasOpenSession: boolean;
  shiftLoading: boolean;
  shiftError: string | null;
  canUseShift: boolean;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onToggleFastTouch?: () => void;
}

export default function PosTopbar({ tables, onShowTablePicker, onShowCashMovement, onShowShift, onShowFullDayClose, shiftHasOpenSession, shiftLoading, shiftError, canUseShift, fullscreen, onToggleFullscreen, onToggleFastTouch }: Props) {
  const cart = useCartStore();
  const { currentTenant } = useAuthStore();
  const tablesRequired = usePosSettingsStore((s) => s.tablesRequired);
  const t = useTranslations('pos');
  const tDashboard = useTranslations('dashboard');
  const { tr, isAr } = useAppLanguage();
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

  // Safe Drop & No-Sale Drawer Modal State
  const [showSafeModal, setShowSafeModal] = useState(false);
  const [safeTab, setSafeTab] = useState<'drop' | 'no_sale'>('drop');
  const [dropAmount, setDropAmount] = useState('');
  const [dropReason, setDropReason] = useState('mid_shift_excess');
  const [dropNotes, setDropNotes] = useState('');
  const [noSaleReason, setNoSaleReason] = useState('');
  const [safeSubmitting, setSafeSubmitting] = useState(false);
  const [safeSuccessMsg, setSafeSuccessMsg] = useState<string | null>(null);

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
        reason: wasteReason || (wasteType === 'barista_calibration' ? tr('Morning Grinder Dial-In', 'معايرة مطحنة الصباح') : tr('Authorized Waste', 'هدر مصرح به')),
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
        || tr('Failed to log waste', 'فشل في تسجيل الهدر');
      alert(errorMsg);
    } finally {
      setWasteSubmitting(false);
    }
  };

  const handleSafeAction = async (e: React.FormEvent) => {
    e.preventDefault();
    setSafeSubmitting(true);
    try {
      if (safeTab === 'drop') {
        const amt = parseFloat(dropAmount);
        if (isNaN(amt) || amt <= 0) {
          alert(tr('Please enter a valid amount', 'يرجى إدخال مبلغ صحيح'));
          setSafeSubmitting(false);
          return;
        }
        await api.post('/finance/safe-vault/drop', {
          amount: amt,
          reason: dropReason,
          notes: dropNotes || undefined,
        });
        setSafeSuccessMsg(tr('Safe Drop recorded! Funds transferred to vault.', 'تم تسجيل التوريد ونقل المبلغ إلى الخزنة بنجاح!'));
      } else {
        await api.post('/finance/anti-theft/no-sale-drawer', {
          reason: noSaleReason || tr('Change / Inspection', 'فك فكة / فحص الدرج'),
        });
        setSafeSuccessMsg(tr('Drawer opened and logged in anti-theft audit.', 'تم فتح الدرج وتوثيق العملية في سجل التدقيق والنزاهة!'));
      }
      setTimeout(() => {
        setSafeSuccessMsg(null);
        setShowSafeModal(false);
        setDropAmount('');
        setDropNotes('');
        setNoSaleReason('');
      }, 1200);
    } catch (err: unknown) {
      const errorMsg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        || (err as Error)?.message
        || tr('Action failed', 'فشلت العملية');
      alert(errorMsg);
    } finally {
      setSafeSubmitting(false);
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

        {/* 🗄️ 1-Tap Safe Drop / Drawer */}
        <button
          type="button"
          onClick={() => setShowSafeModal(true)}
          className="touch-target shrink-0 gap-1.5 rounded-lg border border-emerald-600/40 bg-emerald-500/10 px-3 text-sm font-bold text-emerald-600 transition-colors hover:bg-emerald-500/20 active:bg-emerald-500/25 whitespace-nowrap"
          title={tr('Safe Drop / Open Drawer', 'توريد للخزنة / فتح الدرج')}
          aria-label={tr('Safe Drop / Open Drawer', 'توريد للخزنة / فتح الدرج')}
        >
          <ArrowDownCircle size={16} />
          <span className="hidden sm:inline">{tr('🗄️ Safe Drop', '🗄️ توريد للخزنة')}</span>
        </button>

        {/* ☕ Quick Waste / Barista Dial-In button */}
        <button
          type="button"
          onClick={() => setShowWasteModal(true)}
          className="touch-target shrink-0 gap-1.5 rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 text-sm font-semibold text-amber-600 transition-colors hover:bg-amber-500/20 active:bg-amber-500/25 whitespace-nowrap"
          title={tr('Log Waste / Barista Dial-In', 'تسجيل هدر / معايرة باريستا')}
          aria-label={tr('Log Waste / Barista Dial-In', 'تسجيل هدر / معايرة باريستا')}
        >
          <Coffee size={16} />
          <span className="hidden sm:inline">{tr('☕ Waste / Dial-In', '☕ هدر / معايرة')}</span>
        </button>

        {canUseShift && (
          <div className="flex items-center gap-1">
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

            {onShowFullDayClose && (
              <button
                type="button"
                onClick={onShowFullDayClose}
                className="touch-target shrink-0 gap-1 rounded-lg border border-brand/40 bg-brand/10 px-2.5 text-xs font-bold text-brand transition-colors hover:bg-brand/20 active:bg-brand/25 whitespace-nowrap"
                title={tr('Full Day Close Z-Report', 'إغلاق اليوم الشامل (Z-Report)')}
                aria-label={tr('Full Day Close Z-Report', 'إغلاق اليوم الشامل (Z-Report)')}
              >
                <span>{tr('Z-Report', 'تقرير Z')}</span>
              </button>
            )}
          </div>
        )}

        <div className="shrink-0">
          <PrinterStatus />
        </div>
        {onToggleFastTouch && (
          <button
            type="button"
            onClick={onToggleFastTouch}
            className="touch-target shrink-0 gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 text-sm font-semibold text-amber-600 transition-colors hover:bg-amber-500/20 active:bg-amber-500/25 whitespace-nowrap"
            title={tr('Fast-Touch Express Mode', 'وضع اللمس السريع المطور')}
            aria-label={tr('Fast-Touch Express Mode', 'وضع اللمس السريع المطور')}
          >
            <Zap size={16} />
            <span className="hidden sm:inline">{tr('Fast-Touch', 'اللمس السريع')}</span>
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

      {/* 🗄️ Safe Drop & No-Sale Drawer Modal */}
      {showSafeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl overflow-hidden p-6 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b">
              <div className="flex items-center gap-2">
                <ArrowDownCircle className="text-emerald-600" size={20} />
                <h3 className="font-bold text-lg text-foreground">{tr('Safe Drop & Drawer Operations', 'عمليات الخزنة ودرج النقدية')}</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSafeModal(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
              >
                <X size={18} />
              </button>
            </div>

            {safeSuccessMsg ? (
              <div className="py-8 text-center text-emerald-600 font-bold text-lg animate-in fade-in">
                ✓ {safeSuccessMsg}
              </div>
            ) : (
              <form onSubmit={handleSafeAction} className="space-y-4 pt-4">
                <div className="flex rounded-xl bg-muted p-1">
                  <button
                    type="button"
                    onClick={() => setSafeTab('drop')}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      safeTab === 'drop' ? 'bg-card text-emerald-600 shadow-sm' : 'text-muted-foreground'
                    }`}
                  >
                    {tr('Mid-Shift Safe Drop', 'توريد للخزنة (Safe Drop)')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSafeTab('no_sale')}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      safeTab === 'no_sale' ? 'bg-card text-amber-600 shadow-sm' : 'text-muted-foreground'
                    }`}
                  >
                    {tr('Open Drawer (No Sale)', 'فتح الدرج بدون بيع')}
                  </button>
                </div>

                {safeTab === 'drop' ? (
                  <>
                    <div>
                      <label className="text-xs font-semibold uppercase text-muted-foreground block mb-1">
                        {tr('Transfer Amount to Safe Vault', 'المبلغ المحول إلى الخزنة')}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={dropAmount}
                        onChange={(e) => setDropAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full rounded-xl border border-input bg-background px-3 py-2 text-base font-bold focus:ring-2 focus:ring-emerald-500"
                        required
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase text-muted-foreground block mb-1">
                        {tr('Reason', 'السبب')}
                      </label>
                      <select
                        value={dropReason}
                        onChange={(e) => setDropReason(e.target.value)}
                        className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="mid_shift_excess">{tr('Mid-Shift Cash Skim (Excess Cash)', 'تخفيف نقدية الدرج الزائدة')}</option>
                        <option value="high_cash_security">{tr('High Cash Security Vaulting', 'إيداع أمني لمبالغ كبيرة')}</option>
                        <option value="shift_change_handover">{tr('Shift Change Partial Drop', 'توريد جزئي قبل تبديل الوردية')}</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase text-muted-foreground block mb-1">
                        {tr('Notes / Envelope #', 'ملاحظات / رقم المظروف')}
                      </label>
                      <input
                        type="text"
                        placeholder={tr('e.g. Envelope #42 / Manager count', 'مثال: مظروف رقم 42 / عد المدير')}
                        value={dropNotes}
                        onChange={(e) => setDropNotes(e.target.value)}
                        className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-700 dark:text-amber-300">
                      <ShieldAlert className="inline me-1" size={14} />
                      {tr(
                        'Audit Warning: No-sale drawer opens are recorded in cashier anti-theft logs and flagged on Z-Report.',
                        'تنبيه تدقيق: فتح الدرج بدون بيع يتم تسجيله في سجل نزاهة الكاشير ويظهر في تقرير Z.'
                      )}
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase text-muted-foreground block mb-1">
                        {tr('Reason for Opening Drawer', 'سبب فتح الدرج')}
                      </label>
                      <input
                        type="text"
                        placeholder={tr('e.g. Making change / Routine check', 'مثال: فك فكة للعميل / جرد دوري')}
                        value={noSaleReason}
                        onChange={(e) => setNoSaleReason(e.target.value)}
                        className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500"
                        required
                        autoFocus
                      />
                    </div>
                  </>
                )}

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowSafeModal(false)}
                    className="flex-1 rounded-xl border border-border py-2 text-sm font-medium hover:bg-muted"
                  >
                    {tr('Cancel', 'إلغاء')}
                  </button>
                  <button
                    type="submit"
                    disabled={safeSubmitting}
                    className={`flex-1 rounded-xl py-2 text-sm font-bold text-white disabled:opacity-50 ${
                      safeTab === 'drop' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'
                    }`}
                  >
                    {safeSubmitting
                      ? tr('Processing...', 'جاري المعالجة...')
                      : safeTab === 'drop'
                        ? tr('Confirm Safe Drop', 'تأكيد التوريد للخزنة')
                        : tr('Open Drawer & Log', 'فتح الدرج وتوثيق')}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ☕ Log Waste / Dial-In Modal */}
      {showWasteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl overflow-hidden p-6 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b">
              <div className="flex items-center gap-2">
                <Coffee className="text-amber-600" size={20} />
                <h3 className="font-bold text-lg text-foreground">{tr('Log Waste & Dial-In', 'تسجيل هدر ومعايرة باريستا')}</h3>
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
                ✓ {tr('Recorded successfully! BOM stock depleted.', 'تم التسجيل بنجاح وخصم خامات الوصفة!')}
              </div>
            ) : (
              <form onSubmit={handleLogWaste} className="space-y-4 pt-4">
                <div>
                  <label className="text-xs font-semibold uppercase text-muted-foreground block mb-1">
                    {tr('Waste Type', 'نوع الهدر')}
                  </label>
                  <select
                    value={wasteType}
                    onChange={(e) => setWasteType(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="barista_calibration">{tr('☕ Barista Dial-In / Calibration', '☕ معايرة باريستا ومطحنة')}</option>
                    <option value="staff_meal_drink">{tr('🍽️ Staff Meal / Staff Drink', '🍽️ وجبة / مشروب موظف')}</option>
                    <option value="spillage_remake">{tr('⚠️ Spillage / Remake', '⚠️ انسكاب / إعادة تحضير')}</option>
                    <option value="expired_spoilage">{tr('🍂 Expired / Spoilage', '🍂 تالف / منتهي الصلاحية')}</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase text-muted-foreground block mb-1">
                    {tr('Item (BOM Recipe)', 'الصنف (وصفة BOM)')}
                  </label>
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
                    <label className="text-xs font-semibold uppercase text-muted-foreground block mb-1">
                      {tr('Quantity', 'الكمية')}
                    </label>
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
                    <label className="text-xs font-semibold uppercase text-muted-foreground block mb-1">
                      {tr('Reason / Notes', 'السبب / ملاحظات')}
                    </label>
                    <input
                      type="text"
                      placeholder={tr('e.g. Grinder adjustment', 'مثال: ضبط نعومة الطحن')}
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
                    {tr('Cancel', 'إلغاء')}
                  </button>
                  <button
                    type="submit"
                    disabled={wasteSubmitting}
                    className="flex-1 rounded-xl bg-amber-600 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    {wasteSubmitting ? tr('Logging...', 'جاري التسجيل...') : tr('Confirm & Deplete', 'تأكيد وخصم الخامات')}
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
