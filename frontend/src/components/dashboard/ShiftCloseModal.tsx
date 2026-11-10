'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Lock, Printer, AlertTriangle, KeyRound, Check, Truck, ArrowRight, ArrowLeft, Calculator, Eye } from 'lucide-react';
import type { CashSessionModel } from '@/hooks/useCashSession';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { useAppLanguage } from '@/lib/i18n/bilingual';
import { printCenteredZReportSlip } from '@/lib/printer/printCenteredZReportSlip';

const DENOMINATIONS = [200, 100, 50, 20, 10, 5, 1];

interface ShiftPreviewData {
  expected_cash?: number;
  expected_bom_cost?: number;
  total_orders_count?: number;
  gross_sales?: number;
  net_sales?: number;
  latest_preblind_closure?: {
    id?: string | number;
    closed_by_name?: string;
    counted_cash_cents?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface ShiftCloseModalProps {
  model: CashSessionModel;
  mode?: 'pre_blind_cashier' | 'full_day_close';
  onModeChange?: (mode: 'pre_blind_cashier' | 'full_day_close') => void;
}

export function ShiftCloseModal({ model, mode = 'pre_blind_cashier', onModeChange }: ShiftCloseModalProps) {
  const { isAr, tr } = useAppLanguage();
  const {
    closeModalOpen, setCloseModalOpen, session, countedInput, setCountedInput,
    submitting, submitError, closedResult, setClosedResult,
    fmt, closeShift, setSubmitError,
  } = model;

  const [internalMode, setInternalMode] = useState<'pre_blind_cashier' | 'full_day_close' | null>(null);
  const activeMode = internalMode ?? mode;
  const setActiveMode = (m: 'pre_blind_cashier' | 'full_day_close') => {
    setInternalMode(m);
    onModeChange?.(m);
  };
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);

  // Denominations breakdown
  const [denoms, setDenoms] = useState<Record<number, number>>({ 200: 0, 100: 0, 50: 0, 20: 0, 10: 0, 5: 0, 1: 0 });
  const [coinsInput, setCoinsInput] = useState<string>('');
  const [declaredCardSlips, setDeclaredCardSlips] = useState<string>('');
  const [declaredWalletSlips, setDeclaredWalletSlips] = useState<string>('');
  const [closeNotes, setCloseNotes] = useState<string>('');
  const [, setHasPrinted] = useState(false);

  // Manager PIN for Full Day Close
  const [managerPin, setManagerPin] = useState('');
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [, setPinPromptOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  // Driver COD settlement state
  const [driverSettlements, setDriverSettlements] = useState<Array<{ id: string | number; order_number?: string; courier_name?: string; total?: number }>>([]);
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [settlingDrivers, setSettlingDrivers] = useState(false);

  // Live Shift Preview
  const [previewData, setPreviewData] = useState<ShiftPreviewData | null>(null);

  // Compute total from denominations
  useEffect(() => {
    let sum = 0;
    for (const [denom, count] of Object.entries(denoms)) {
      sum += Number(denom) * (Number(count) || 0);
    }
    const coins = parseFloat(coinsInput) || 0;
    sum += coins;
    if (sum > 0) {
      setCountedInput(sum.toFixed(2));
    }
  }, [denoms, coinsInput, setCountedInput]);

  const loadDriverOrders = async () => {
    try {
      setLoadingDrivers(true);
      const res = await api.get('/orders/driver-settlements');
      setDriverSettlements(res.data?.unsettled_orders || []);
    } catch {
      setDriverSettlements([]);
    } finally {
      setLoadingDrivers(false);
    }
  };

  useEffect(() => {
    if (!closeModalOpen) return;
    let active = true;
    api.get('/cash-closures/preview')
      .then((res) => {
        if (!active) return;
        setPreviewData((res.data?.preview || null) as Record<string, unknown> | null);
      })
      .catch(() => {
        if (!active) return;
        setPreviewData(null);
      });
    if (wizardStep === 2) {
      api.get('/orders/driver-settlements')
        .then((res) => {
          if (!active) return;
          setDriverSettlements(res.data?.unsettled_orders || []);
        })
        .catch(() => {
          if (!active) return;
          setDriverSettlements([]);
        });
    }
    return () => {
      active = false;
    };
  }, [closeModalOpen, wizardStep]);

  const handleSettleAllDrivers = async () => {
    try {
      setSettlingDrivers(true);
      const res = await api.post('/orders/driver-settlements/settle', {
        shift_id: session?.id,
      });
      toast.success(res.data?.message || tr('Driver COD cash successfully settled into drawer!', 'تم توريد نقدية مناديب التوصيل إلى الدرج بنجاح!'));
      void loadDriverOrders();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg || tr('Failed to settle driver COD', 'فشل في تسوية نقدية المناديب'));
    } finally {
      setSettlingDrivers(false);
    }
  };

  const handleVerifyManagerPin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!managerPin.trim()) return;
    setPinError(null);
    try {
      const res = await api.post('/auth/verify-admin-pin', { pin: managerPin.trim() });
      if (res.data?.ok) {
        setAdminUnlocked(true);
        setPinPromptOpen(false);
        toast.success(tr(`Authorized by ${res.data.admin?.name || 'Manager'}`, `تم التحقق بواسطة ${res.data.admin?.name || 'المدير'}`));
      } else {
        setPinError(res.data?.error || tr('Invalid Manager PIN', 'رمز PIN غير صحيح'));
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setPinError(msg || tr('Invalid Manager PIN', 'رمز PIN غير صحيح'));
    }
  };

  const handleSubmitClosure = async () => {
    setSubmitError(null);
    try {
      const payload: Record<string, unknown> = {
        closure_type: activeMode,
        opening_float_cents: session?.opening_float_cents || 0,
        counted_cash_cents: Math.round(parseFloat(countedInput || '0') * 100),
        declared_card_slips: parseFloat(declaredCardSlips) || 0,
        declared_wallet_slips: parseFloat(declaredWalletSlips) || 0,
        denominations: denoms,
        notes: closeNotes,
        manager_pin: managerPin.trim() || undefined,
        linked_preblind_id: (previewData?.latest_preblind_closure as { id?: string | number })?.id,
      };

      const res = await api.post('/cash-closures', payload);
      const zRep = res.data?.zReport;
      setClosedResult(zRep);
      toast.success(
        activeMode === 'pre_blind_cashier'
          ? tr('Pre-blind cashier handover recorded!', 'تم تسجيل تسليم وردية الكاشير المبدئي بنجاح!')
          : tr('Full Day Close (Z-Report) finalized!', 'تم إغلاق اليوم والوردية الشامل (Z-Report) بنجاح!')
      );

      // Auto print centered slip
      printCenteredZReportSlip(zRep, isAr ? 'ar' : 'en', activeMode);
      setHasPrinted(true);

      // Close underlying cash session if active
      if (session?.id) {
        try {
          await closeShift();
        } catch {}
      }
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : (err instanceof Error ? err.message : null);
      setSubmitError(msg || tr('Failed to record closure', 'فشل في تسجيل الإغلاق'));
    }
  };

  const closeModal = (next: boolean) => {
    if (!next && submitting) return;
    if (!next) {
      setWizardStep(1);
      setClosedResult(null);
      setSubmitError(null);
      setCountedInput('');
      setCoinsInput('');
      setDeclaredCardSlips('');
      setDeclaredWalletSlips('');
      setCloseNotes('');
      setHasPrinted(false);
      setAdminUnlocked(false);
      setManagerPin('');
      setPinPromptOpen(false);
      setPinError(null);
    }
    setCloseModalOpen(next);
  };

  return (
    <Dialog open={closeModalOpen} onOpenChange={closeModal}>
      <DialogContent className="sm:max-w-xl max-h-[92vh] flex flex-col" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Lock size={18} className="text-brand" />
              {activeMode === 'pre_blind_cashier'
                ? tr('Pre-Blind Cashier Handover', 'إغلاق وردية مبدئي أعمى للكاشير')
                : tr('Full Day Close (Owner/Manager Z-Report)', 'إغلاق اليوم الشامل للمالك والمدير (Z-Report)')}
            </DialogTitle>

            {/* Mode Switcher */}
            {!closedResult && (
              <div className="flex items-center gap-1 bg-muted p-1 rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setActiveMode('pre_blind_cashier');
                    onModeChange?.('pre_blind_cashier');
                  }}
                  className={`px-2 py-1 rounded font-semibold transition-colors ${
                    activeMode === 'pre_blind_cashier' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tr('Cashier Pre-Blind', 'كاشير مبدئي')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveMode('full_day_close');
                    onModeChange?.('full_day_close');
                  }}
                  className={`px-2 py-1 rounded font-semibold transition-colors ${
                    activeMode === 'full_day_close' ? 'bg-brand text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tr('Full Z-Report', 'إغلاق شامل Z')}
                </button>
              </div>
            )}
          </div>

          <DialogDescription className="text-xs pt-1">
            {activeMode === 'pre_blind_cashier'
              ? tr('100% blind physical count. Variance & expected totals remain masked for the cashier.', 'عد أعمى 100% للنقدية والفيزا. تظل النقدية المتوقعة وفارق العجز/الزيادة محجوبة عن الكاشير.')
              : tr('Comprehensive end-of-day reconciliation with BOM costs, expected profit, and driver COD.', 'تقرير إغلاق اليوم والوردية الشامل للمالك متضمناً تكلفة خامات BOM والأرباح وتسوية المناديب.')}
          </DialogDescription>

          {/* Stepper Breadcrumb */}
          {!closedResult && (
            <div className="flex items-center justify-between pt-2 pb-1 border-b border-border text-xs font-semibold">
              <span className={`flex items-center gap-1 ${wizardStep === 1 ? 'text-brand font-bold' : 'text-muted-foreground'}`}>
                <span className="size-5 rounded-full bg-muted flex items-center justify-center text-[10px]">1</span>
                <span>{tr('Count & Slips', 'عد النقدية والإيصالات')}</span>
              </span>
              <span className="text-muted-foreground">→</span>
              <span className={`flex items-center gap-1 ${wizardStep === 2 ? 'text-brand font-bold' : 'text-muted-foreground'}`}>
                <span className="size-5 rounded-full bg-muted flex items-center justify-center text-[10px]">2</span>
                <span>{tr('Driver COD', 'تسوية المناديب')}</span>
              </span>
              <span className="text-muted-foreground">→</span>
              <span className={`flex items-center gap-1 ${wizardStep === 3 ? 'text-brand font-bold' : 'text-muted-foreground'}`}>
                <span className="size-5 rounded-full bg-muted flex items-center justify-center text-[10px]">3</span>
                <span>{tr('Review & Print', 'المراجعة والطباعة')}</span>
              </span>
            </div>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          {submitError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Step 1: Denominations & Physical Count */}
          {!closedResult && wizardStep === 1 && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-card p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold flex items-center gap-1.5">
                    <Calculator size={16} className="text-brand" />
                    {tr('Cash Denomination Counter', 'مفقط الفئات النقدية')}
                  </span>
                  <span className="text-xs text-muted-foreground font-mono">
                    {tr('Total', 'الإجمالي')}: <strong>{countedInput || '0.00'}</strong>
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {DENOMINATIONS.map((d) => (
                    <div key={d} className="flex flex-col gap-1 p-2 rounded-lg bg-muted/40 border border-border/60">
                      <span className="text-xs font-bold text-muted-foreground">{d}</span>
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={denoms[d] || ''}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 0;
                          setDenoms((prev) => ({ ...prev, [d]: Math.max(0, val) }));
                        }}
                        className="w-full text-center text-sm font-bold rounded border border-border bg-card py-1 focus:outline-none focus:ring-1 focus:ring-brand"
                      />
                      <span className="text-[10px] text-muted-foreground text-center">
                        = {(d * (denoms[d] || 0)).toFixed(0)}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-border">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block mb-1">
                      {tr('Coins / Loose Change', 'العملات المعدنية والفكّة')}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={coinsInput}
                      onChange={(e) => setCoinsInput(e.target.value)}
                      className="w-full text-sm font-semibold rounded-lg border border-border bg-card px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block mb-1">
                      {tr('Declared Card / Visa Slips', 'إيصالات الفيزا المعلنة')}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={declaredCardSlips}
                      onChange={(e) => setDeclaredCardSlips(e.target.value)}
                      className="w-full text-sm font-semibold rounded-lg border border-border bg-card px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block mb-1">
                      {tr('Declared Wallet / InstaPay', 'إيصالات المحافظ وإنستاباي')}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={declaredWalletSlips}
                      onChange={(e) => setDeclaredWalletSlips(e.target.value)}
                      className="w-full text-sm font-semibold rounded-lg border border-border bg-card px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand"
                    />
                  </div>
                </div>

                <div className="pt-2">
                  <label className="text-xs font-semibold text-muted-foreground block mb-1">
                    {tr('Total Physical Cash Count', 'إجمالي النقدية الفعلية المعدودة')}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={countedInput}
                    onChange={(e) => setCountedInput(e.target.value)}
                    className="w-full text-base font-bold rounded-lg border border-brand bg-card px-3 py-2 text-brand focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1">
                  {tr('Shift Handover Notes', 'ملاحظات تسليم الوردية')}
                </label>
                <textarea
                  rows={2}
                  value={closeNotes}
                  onChange={(e) => setCloseNotes(e.target.value)}
                  placeholder={tr('Optional notes about cash, shifts, or discrepancies...', 'ملاحظات اختيارية حول الوردية أو العهدة...')}
                  className="w-full text-xs rounded-lg border border-border bg-card p-2 focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </div>
            </div>
          )}

          {/* Step 2: Driver COD Settlement */}
          {!closedResult && wizardStep === 2 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold flex items-center gap-1.5">
                  <Truck size={16} className="text-brand" />
                  {tr('In-House Driver COD Orders', 'طلبات التوصيل للمناديب مع التحصيل (COD)')}
                </span>
                {driverSettlements.length > 0 && (
                  <Button
                    size="sm"
                    onClick={handleSettleAllDrivers}
                    disabled={settlingDrivers}
                    className="bg-brand text-white font-bold text-xs"
                  >
                    {settlingDrivers ? <Loader2 size={12} className="animate-spin me-1" /> : null}
                    {tr('Settle All into Drawer', 'توريد كل النقدية للدرج')}
                  </Button>
                )}
              </div>

              {loadingDrivers ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  <Loader2 size={16} className="animate-spin mx-auto mb-2" />
                  {tr('Checking unsettled driver deliveries...', 'جار التحقق من تحصيلات المناديب...')}
                </div>
              ) : driverSettlements.length === 0 ? (
                <div className="p-4 text-center rounded-xl border border-dashed border-border bg-muted/20 text-xs text-muted-foreground">
                  <Check size={18} className="mx-auto text-green-600 mb-1" />
                  {tr('All driver COD orders are settled!', 'جميع طلبات المناديب مسواة بالكامل!')}
                </div>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {driverSettlements.map((ord) => (
                    <div key={ord.id} className="flex items-center justify-between p-2 rounded-lg bg-card border border-border text-xs">
                      <div>
                        <span className="font-bold">#{ord.order_number || ord.id}</span>
                        <span className="text-muted-foreground ms-2">({ord.courier_name || tr('Courier', 'المندوب')})</span>
                      </div>
                      <span className="font-bold text-brand">{fmt(ord.total || 0)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Review & PIN gate for Full Day Close */}
          {!closedResult && wizardStep === 3 && (
            <div className="space-y-3">
              {activeMode === 'full_day_close' && !adminUnlocked && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700">
                    <KeyRound size={14} />
                    {tr('Manager/Owner PIN Required for Full Day Close', 'مطلوب رمز PIN للمدير أو المالك لإتمام الإغلاق الشامل')}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      placeholder="PIN"
                      value={managerPin}
                      onChange={(e) => setManagerPin(e.target.value)}
                      className="flex-1 text-sm font-bold rounded-lg border border-border bg-card px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand"
                    />
                    <Button size="sm" onClick={handleVerifyManagerPin} className="bg-brand text-white font-bold">
                      {tr('Unlock', 'تحقق')}
                    </Button>
                  </div>
                  {pinError && <p className="text-[11px] text-red-600">{pinError}</p>}
                </div>
              )}

              {/* Summary Cards */}
              {activeMode === 'full_day_close' && previewData ? (
                <div className="space-y-3">
                  {/* 4 Metric Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="p-2.5 rounded-xl border border-border bg-card space-y-1">
                      <span className="text-muted-foreground block">{tr('Expected Cash', 'النقدية المتوقعة')}</span>
                      <div className="text-sm font-bold text-foreground">{fmt(previewData.expected_cash || 0)}</div>
                    </div>

                    <div className="p-2.5 rounded-xl border border-border bg-card space-y-1">
                      <span className="text-muted-foreground block">{tr('Counted Cash', 'النقدية المعدودة')}</span>
                      <div className="text-sm font-bold text-foreground">{fmt(parseFloat(countedInput || '0'))}</div>
                    </div>

                    {(() => {
                      const countedVal = parseFloat(countedInput || '0');
                      const expectedVal = Number(previewData.expected_cash || 0);
                      const diffVal = Number((countedVal - expectedVal).toFixed(2));
                      const deficitVal = diffVal < -0.009 ? Math.abs(diffVal) : 0;
                      const surplusVal = diffVal > 0.009 ? diffVal : 0;
                      return (
                        <>
                          <div className={`p-2.5 rounded-xl border space-y-1 ${deficitVal > 0 ? 'border-red-500/40 bg-red-500/10' : 'border-border bg-card'}`}>
                            <span className={`block font-semibold ${deficitVal > 0 ? 'text-red-700' : 'text-muted-foreground'}`}>
                              {tr('Deficit', 'عجز نقدية')}
                            </span>
                            <div className={`text-sm font-bold ${deficitVal > 0 ? 'text-red-600' : 'text-foreground'}`}>
                              {fmt(deficitVal)}
                            </div>
                          </div>

                          <div className={`p-2.5 rounded-xl border space-y-1 ${surplusVal > 0 ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-border bg-card'}`}>
                            <span className={`block font-semibold ${surplusVal > 0 ? 'text-emerald-700' : 'text-muted-foreground'}`}>
                              {tr('Surplus', 'فائض نقدية')}
                            </span>
                            <div className={`text-sm font-bold ${surplusVal > 0 ? 'text-emerald-600' : 'text-foreground'}`}>
                              {fmt(surplusVal)}
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2 rounded-lg border border-border bg-card">
                      <span className="text-muted-foreground block">{tr('Declared Card/Wallet', 'الفيزا والمحافظ')}</span>
                      <span className="font-bold">{fmt((parseFloat(declaredCardSlips) || 0) + (parseFloat(declaredWalletSlips) || 0))}</span>
                    </div>
                    <div className="p-2 rounded-lg border border-border bg-card">
                      <span className="text-muted-foreground block">{tr('Expected BOM Cost', 'تكلفة خامات BOM')}</span>
                      <span className="font-bold text-amber-600">{fmt(previewData.expected_bom_cost || 0)}</span>
                    </div>
                  </div>

                  {/* Sold items breakdown compact preview */}
                  {Array.isArray((previewData as any).sold_items_breakdown) && (previewData as any).sold_items_breakdown.length > 0 && (
                    <div className="rounded-xl border border-border bg-muted/20 p-2.5 space-y-2 text-xs">
                      <div className="flex items-center justify-between font-bold border-b pb-1">
                        <span>{tr('Sold Items Breakdown', 'تفاصيل الأصناف المباعة')}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {tr('Total Qty', 'إجمالي الكمية')}: {(previewData as any).total_sold_items_qty || 0}
                        </span>
                      </div>
                      <div className="max-h-28 overflow-y-auto space-y-1">
                        {((previewData as any).sold_items_breakdown as any[]).slice(0, 8).map((item, idx) => (
                          <div key={idx} className="flex items-center justify-between py-0.5 text-[11px]">
                            <span className="truncate max-w-[180px]">
                              {item.product_name} {item.variant_name ? `(${item.variant_name})` : ''}
                            </span>
                            <span className="font-mono text-muted-foreground">
                              {item.bulk_qty}x @ {fmt(item.unit_price_excl_tax)} = <strong>{fmt(item.total_excl_tax)}</strong>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl border border-border bg-card space-y-1">
                    <span className="text-muted-foreground">{tr('Counted Cash', 'النقدية المعدودة')}</span>
                    <div className="text-base font-bold text-foreground">{fmt(parseFloat(countedInput || '0'))}</div>
                  </div>

                  <div className="p-2.5 rounded-xl border border-border bg-card space-y-1">
                    <span className="text-muted-foreground">{tr('Declared Card/Wallet', 'الفيزا والمحافظ')}</span>
                    <div className="text-base font-bold text-foreground">
                      {fmt((parseFloat(declaredCardSlips) || 0) + (parseFloat(declaredWalletSlips) || 0))}
                    </div>
                  </div>
                </div>
              )}

              {activeMode === 'full_day_close' && previewData?.latest_preblind_closure && (
                <div className="p-2.5 rounded-xl border border-blue-500/30 bg-blue-500/10 text-xs text-blue-900 space-y-1">
                  <div className="font-bold flex items-center gap-1">
                    <Eye size={14} />
                    {tr('Linked Pre-Blind Cashier Count Found', 'تم ربط عد الكاشير المبدئي')}
                  </div>
                  <div>
                    {tr('Counted by', 'تم العد بواسطة')}: <strong>{previewData.latest_preblind_closure.closed_by_name || 'Cashier'}</strong>
                    {' — '}
                    {tr('Physical', 'الفعلي')}: <strong>{fmt((previewData.latest_preblind_closure.counted_cash_cents || 0) / 100)}</strong>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Result view */}
          {closedResult && (
            <div className="p-4 text-center rounded-xl border border-border bg-card space-y-3">
              <div className="size-10 rounded-full bg-green-500/20 text-green-600 flex items-center justify-center mx-auto">
                <Check size={20} />
              </div>
              {closedResult.closure_type === 'full_day_close' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-start">
                  <div className="p-2 rounded-lg border border-border bg-muted/40">
                    <span className="text-muted-foreground block">{tr('Expected Cash', 'النقدية المتوقعة')}</span>
                    <span className="font-bold">{fmt(Number(closedResult.expected_cash_cents || 0) / 100)}</span>
                  </div>
                  <div className="p-2 rounded-lg border border-border bg-muted/40">
                    <span className="text-muted-foreground block">{tr('Counted Cash', 'النقدية المعدودة')}</span>
                    <span className="font-bold">{fmt(Number(closedResult.counted_cash_cents || 0) / 100)}</span>
                  </div>
                  <div className={`p-2 rounded-lg border ${Number(closedResult.deficit_amount || 0) > 0 ? 'border-red-500/40 bg-red-500/10' : 'border-border bg-muted/40'}`}>
                    <span className={`block font-semibold ${Number(closedResult.deficit_amount || 0) > 0 ? 'text-red-700' : 'text-muted-foreground'}`}>{tr('Deficit', 'عجز نقدية')}</span>
                    <span className={`font-bold ${Number(closedResult.deficit_amount || 0) > 0 ? 'text-red-600' : ''}`}>{fmt(Number(closedResult.deficit_amount || 0))}</span>
                  </div>
                  <div className={`p-2 rounded-lg border ${Number(closedResult.surplus_amount || 0) > 0 ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-border bg-muted/40'}`}>
                    <span className={`block font-semibold ${Number(closedResult.surplus_amount || 0) > 0 ? 'text-emerald-700' : 'text-muted-foreground'}`}>{tr('Surplus', 'فائض نقدية')}</span>
                    <span className={`font-bold ${Number(closedResult.surplus_amount || 0) > 0 ? 'text-emerald-600' : ''}`}>{fmt(Number(closedResult.surplus_amount || 0))}</span>
                  </div>
                </div>
              )}

              <div className="pt-2 flex justify-center gap-2">
                <Button
                  onClick={() => printCenteredZReportSlip(closedResult, isAr ? 'ar' : 'en', closedResult.closure_type)}
                  className="bg-brand text-white font-bold"
                >
                  <Printer size={16} className="me-1.5" />
                  {tr('Print Centered Slip', 'طباعة الإيصال الموسط')}
                </Button>
                <Button variant="outline" onClick={() => closeModal(false)}>
                  {tr('Done', 'تم')}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer controls */}
        {!closedResult && (
          <DialogFooter className="flex items-center justify-between border-t border-border pt-3">
            {wizardStep === 1 && (
              <>
                <Button variant="outline" onClick={() => closeModal(false)}>
                  {tr('Cancel', 'إلغاء')}
                </Button>
                <Button
                  onClick={() => setWizardStep(2)}
                  disabled={!countedInput.trim()}
                  className="bg-brand text-white font-bold"
                >
                  <span>{tr('Next: Driver COD', 'التالي: تسوية المناديب')}</span>
                  <ArrowRight size={14} className="ms-1" />
                </Button>
              </>
            )}

            {wizardStep === 2 && (
              <>
                <Button variant="outline" onClick={() => setWizardStep(1)}>
                  <ArrowLeft size={14} className="me-1" />
                  <span>{tr('Back', 'رجوع')}</span>
                </Button>
                <Button
                  onClick={() => setWizardStep(3)}
                  className="bg-brand text-white font-bold"
                >
                  <span>{tr('Next: Review & Close', 'التالي: المراجعة والإغلاق')}</span>
                  <ArrowRight size={14} className="ms-1" />
                </Button>
              </>
            )}

            {wizardStep === 3 && (
              <>
                <Button variant="outline" onClick={() => setWizardStep(2)} disabled={submitting}>
                  <ArrowLeft size={14} className="me-1" />
                  <span>{tr('Back', 'رجوع')}</span>
                </Button>
                <Button
                  onClick={handleSubmitClosure}
                  disabled={submitting || (activeMode === 'full_day_close' && !adminUnlocked && !managerPin.trim())}
                  className="bg-brand hover:bg-brand/90 text-white font-bold"
                >
                  {submitting && <Loader2 size={16} className="animate-spin me-1.5" />}
                  <span>
                    {activeMode === 'pre_blind_cashier'
                      ? tr('Submit Pre-Blind Handover', 'تأكيد تسليم الوردية المبدئي')
                      : tr('Confirm Full Day Close (Z-Report)', 'تأكيد إغلاق اليوم الشامل (Z-Report)')}
                  </span>
                </Button>
              </>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
