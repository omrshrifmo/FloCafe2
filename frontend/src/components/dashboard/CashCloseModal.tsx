'use client';
import { useState } from 'react';
import { Ltr } from '@/components/layout/Ltr';
import { CashCloseTicketPreview, type CashCloseTicketPreviewProps } from '@/components/dashboard/CashCloseTicketPreview';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Lock, Loader2, Printer, AlertTriangle, X, Check, ArrowLeft, ArrowRight, KeyRound, Eye, EyeOff } from 'lucide-react';
import type { CashCloseModel } from '@/hooks/useCashClose';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { useAppLanguage } from '@/lib/i18n/bilingual';
import { printCenteredZReportSlip } from '@/lib/printer/printCenteredZReportSlip';

/** Day-close wizard modal (steps 1 Revisar / 2 Contar / 3 Cerrar).
 *  Supports switching between pre_blind_cashier and full_day_close,
 *  uses printCenteredZReportSlip, and renders 100% in Arabic when isAr is true. */
export function CashCloseModal({ model }: { model: CashCloseModel }) {
  const { isAr, tr, dir } = useAppLanguage();
  const {
    closeOpen, setCloseOpen, closeAnotherDay, businessDate, setBusinessDate,
    xReport, xLoading, xError, closeStep, setCloseStep,
    openingFloatInput, setOpeningFloatInput, countedInput, setCountedInput,
    submittingClose, submitError, alreadyClosedOverride, setAlreadyClosedOverride,
    amountsValid, expectedCashTotalCents, varianceCents, closedZ, printingZ,
    hasPrintedFresh, setHasPrintedFresh, hydratedZ, minorFactor, fmt, unitAdapter,
    t, tCommon, shiftDate, todayLocal, submitClose, printZ
  } = model;

  const [closureType, setClosureType] = useState<'pre_blind_cashier' | 'full_day_close'>('pre_blind_cashier');
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [showAdminPinPrompt, setShowAdminPinPrompt] = useState(false);
  const [adminPinInput, setAdminPinInput] = useState('');
  const [adminPinLoading, setAdminPinLoading] = useState(false);
  const [adminPinError, setAdminPinError] = useState<string | null>(null);

  const handleVerifyAdminPin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!adminPinInput.trim()) return;
    setAdminPinLoading(true);
    setAdminPinError(null);
    try {
      const res = await api.post('/auth/verify-admin-pin', { pin: adminPinInput.trim() });
      if (res.data?.ok) {
        setAdminUnlocked(true);
        setShowAdminPinPrompt(false);
        setAdminPinInput('');
        toast.success(tr(`Admin PIN verified: ${res.data.admin?.name || 'Authorized'}`, `تم التحقق بنجاح: ${res.data.admin?.name || 'مفوض'}`));
      } else {
        setAdminPinError(res.data?.error || tr('Invalid Manager or Owner PIN', 'رمز PIN غير صحيح للمالك أو المدير'));
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || tr('Invalid Manager or Owner PIN', 'رمز PIN غير صحيح للمالك أو المدير');
      setAdminPinError(msg);
    } finally {
      setAdminPinLoading(false);
    }
  };

  const handleCenteredPrint = () => {
    if (!closedZ) return;
    printCenteredZReportSlip(
      {
        ...closedZ,
        closure_type: closureType,
        storeName: 'FloCafe',
        cashierName: closedZ.closed_by_name || 'Staff',
        declared_cash: closedZ.counted_cash_cents ? closedZ.counted_cash_cents / minorFactor : 0,
        actual_cash: closedZ.counted_cash_cents ? closedZ.counted_cash_cents / minorFactor : 0,
      },
      isAr ? 'ar' : 'en',
      closureType
    );
    setHasPrintedFresh(true);
  };

  return (
    <>
      <Dialog open={closeOpen} onOpenChange={(next) => {
        if (!next && submittingClose) return;
        setCloseOpen(next);
      }}>
        <DialogContent
          className="sm:max-w-lg max-h-[90vh] flex flex-col"
          onInteractOutside={(e) => e.preventDefault()}
          dir={dir}
        >
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="flex items-center gap-2">
                <Lock size={18} className="text-foreground" />
                {closureType === 'pre_blind_cashier'
                  ? tr('Cashier Pre-Blind Shift Handover', 'إغلاق وتسليم وردية كاشير مبدئي أعمى')
                  : tr('Full Day / Shift Z-Report Close', 'إغلاق اليوم والوردية الشامل Z-Report')}
                {xReport && (
                  <span className="ms-2 text-sm font-normal text-muted-foreground"><Ltr>{xReport.businessDate}</Ltr></span>
                )}
              </DialogTitle>

              {/* Mode Toggle */}
              {closeStep < 3 && (
                <div className="flex items-center bg-muted/60 p-0.5 rounded-lg border border-border text-xs">
                  <button
                    type="button"
                    onClick={() => setClosureType('pre_blind_cashier')}
                    className={`px-2 py-1 rounded font-bold transition-all cursor-pointer ${
                      closureType === 'pre_blind_cashier'
                        ? 'bg-brand text-white shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tr('Pre-Blind', 'مبدئي أعمى')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setClosureType('full_day_close')}
                    className={`px-2 py-1 rounded font-bold transition-all cursor-pointer ${
                      closureType === 'full_day_close'
                        ? 'bg-purple-600 text-white shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tr('Full Z-Report', 'إغلاق شامل Z')}
                  </button>
                </div>
              )}
            </div>

            <DialogDescription>
              {closureType === 'pre_blind_cashier'
                ? tr('Blind physical cashier drawer count without revealing system expected cash', 'جرد وعد نقدية الدرج الفعلي بدون إظهار النقدية المتوقعة للكاشير')
                : tr('Complete manager/owner day closure with Z-Report snapshot & EOD sync', 'إغلاق شامل لليوم بواسطة المدير أو المالك مع لقطة Z-Report ومزامنة نهاية اليوم')}
            </DialogDescription>
          </DialogHeader>

          {/* 3-Step Flow */}
          <ol className="flex items-center gap-2 px-1 pb-1 select-none" aria-label="Day close steps">
            {([1, 2, 3] as const).map((step, i) => {
              const completed = closeStep > step;
              const active = closeStep === step;
              const label = step === 1
                ? tr('Review', 'مراجعة')
                : step === 2
                  ? tr('Count', 'عد النقدية')
                  : tr('Close & Print', 'إغلاق وطباعة');
              return (
                <li key={step} className="flex items-center gap-2 flex-1 last:flex-none">
                  <span
                    className={`flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-semibold border ${active ? 'bg-brand text-brand-foreground border-brand' : completed ? 'bg-brand/15 text-brand border-brand/30' : 'bg-muted text-muted-foreground border-border'}`}
                    aria-current={active ? 'step' : undefined}
                  >
                    {completed ? <Check size={12} /> : step}
                  </span>
                  <span className={`text-xs ${active ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>{label}</span>
                  {i < 2 && <span aria-hidden="true" className={`flex-1 h-px ${completed ? 'bg-brand/40' : 'bg-border'}`} />}
                </li>
              );
            })}
          </ol>

          <div className="flex-1 overflow-y-auto space-y-4">
            {/* Step 1: Review */}
            {closeStep === 1 && (
              <div className="space-y-3">
                {xLoading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                    <Loader2 size={16} className="animate-spin" />
                    <span>{tr('Loading shift data...', 'جاري تحميل بيانات الوردية...')}</span>
                  </div>
                )}
                {xError && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    <span>{xError}</span>
                  </div>
                )}
                <div>
                  <label htmlFor="business-date" className="block text-sm text-muted-foreground mb-1">
                    {tr('Business Date', 'تاريخ يوم العمل')}
                  </label>
                  <input
                    id="business-date"
                    type="date"
                    value={businessDate}
                    min={shiftDate(todayLocal, -365)}
                    max={todayLocal}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return;
                      if (next > todayLocal) return;
                      setBusinessDate(next);
                    }}
                    className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground outline-none focus:ring-2 focus:ring-brand/30"
                  />
                  {xReport?.periodStart && xReport?.periodEnd && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {tr(`Period: ${xReport.periodStart} to ${xReport.periodEnd}`, `الفترة: ${xReport.periodStart} إلى ${xReport.periodEnd}`)}
                    </p>
                  )}
                </div>
                {xReport && (
                  <>
                    {(xReport.alreadyClosed || alreadyClosedOverride) && (
                      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                        <span>{tr('This day has already been closed', 'تم إغلاق هذا اليوم مسبقاً')}</span>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg border border-border p-3 bg-muted/40">
                        <p className="text-xs text-muted-foreground">{tr('Gross Sales', 'إجمالي المبيعات')}</p>
                        {closureType === 'pre_blind_cashier' && !adminUnlocked ? (
                          <p className="text-lg font-mono tracking-widest text-muted-foreground select-none">••••••••</p>
                        ) : (
                          <p className="text-lg font-semibold text-foreground ltr-island"><Ltr>{fmt(xReport.grossCollected)}</Ltr></p>
                        )}
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {tr(`${xReport.billCount} bills`, `${xReport.billCount} فاتورة`)}
                        </p>
                      </div>

                      <div className="rounded-lg border border-border p-3 bg-muted/40">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted-foreground">{tr('Expected Cash', 'النقدية المتوقعة بالدرج')}</p>
                          {!adminUnlocked && (
                            <button
                              type="button"
                              onClick={() => {
                                setAdminPinError(null);
                                setAdminPinInput('');
                                setShowAdminPinPrompt(!showAdminPinPrompt);
                              }}
                              className="text-[11px] font-bold text-brand hover:underline inline-flex items-center gap-1 cursor-pointer bg-brand/10 hover:bg-brand/20 px-2 py-0.5 rounded-md"
                            >
                              <KeyRound size={12} />
                              <span>{tr('Manager PIN', 'رمز المدير')}</span>
                            </button>
                          )}
                        </div>
                        {adminUnlocked || closureType === 'full_day_close' ? (
                          <p className="text-lg font-semibold text-foreground ltr-island"><Ltr>{fmt((xReport.expectedCashCents + (xReport.openingFloatCents ?? 0)) / minorFactor)}</Ltr></p>
                        ) : (
                          <p className="text-lg font-mono tracking-widest text-muted-foreground select-none">••••••••</p>
                        )}
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {tr(`Refunds: ${xReport.refundCount}`, `المرتجعات: ${xReport.refundCount}`)}
                          {' · '}<Ltr>{fmt(xReport.refunded)}</Ltr>
                        </p>
                      </div>
                    </div>

                    {showAdminPinPrompt && !adminUnlocked && (
                      <form onSubmit={handleVerifyAdminPin} className="p-3 rounded-xl border border-brand/30 bg-brand/5 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                            <Lock size={13} className="text-brand" />
                            <span>{tr('Enter Owner/Manager PIN to Reveal Expected Cash', 'أدخل رمز المالك/المدير لإظهار النقدية المتوقعة')}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => setShowAdminPinPrompt(false)}
                            className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                          >
                            {tr('Cancel', 'إلغاء')}
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="password"
                            inputMode="numeric"
                            autoFocus
                            placeholder="PIN"
                            value={adminPinInput}
                            onChange={(e) => setAdminPinInput(e.target.value)}
                            className="flex-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-mono tracking-widest text-foreground outline-none focus:ring-2 focus:ring-brand/30"
                          />
                          <Button
                            type="submit"
                            size="sm"
                            disabled={adminPinLoading || !adminPinInput.trim()}
                            className="h-8 px-3 gap-1 bg-brand text-white font-bold"
                          >
                            {adminPinLoading ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                            <span>{tr('Unlock', 'فتح')}</span>
                          </Button>
                        </div>
                        {adminPinError && (
                          <p className="text-xs text-rose-600 dark:text-rose-400 font-semibold">{adminPinError}</p>
                        )}
                      </form>
                    )}

                    <div className="rounded-lg border border-border bg-muted/40 p-3">
                      <p className="text-xs font-medium text-muted-foreground mb-2">{tr('Cash Movements', 'حركات النقدية بالدرج')}</p>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <p className="text-muted-foreground">{tr('Pay In', 'توريد نقدية')}</p>
                          <p className="font-medium text-foreground ltr-island"><Ltr>{fmt(xReport.payInCents / minorFactor)}</Ltr></p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{tr('Pay Out', 'سحب نقدية')}</p>
                          <p className="font-medium text-foreground ltr-island"><Ltr>{fmt(xReport.payOutCents / minorFactor)}</Ltr></p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{tr('Safe Drop', 'ترحيل للخزينة')}</p>
                          <p className="font-medium text-foreground ltr-island"><Ltr>{fmt(xReport.safeDropCents / minorFactor)}</Ltr></p>
                        </div>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">{tr('Payments Breakdown', 'طرق الدفع والتحصيلات')}</p>
                      {xReport.paymentMethods.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{tr('No payments recorded', 'لا توجد مدفوعات مسجلة')}</p>
                      ) : (
                        <ul className="divide-y divide-border rounded-lg border border-border">
                          {xReport.paymentMethods.map((pm) => (
                            <li key={pm.method} className="flex items-center justify-between px-3 py-2 text-sm">
                              <span className="text-foreground">{pm.method}</span>
                              <span className="text-muted-foreground">
                                <Ltr>{fmt(pm.total)}</Ltr>
                                <span className="ms-2 text-[11px]">x{pm.count}</span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Step 2: Count */}
            {closeStep === 2 && xReport && (
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2">
                  <span className="text-xs text-muted-foreground">{tr('Business Date', 'تاريخ يوم العمل')}</span>
                  <span className="text-sm font-medium text-foreground ltr-island"><Ltr>{xReport.businessDate}</Ltr></span>
                </div>
                <div>
                  <label htmlFor="opening-float" className="block text-sm text-muted-foreground mb-1">
                    {tr('Opening Float', 'الرصيد الافتتاحي للدرج')}
                  </label>
                  <input
                    id="opening-float"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={unitAdapter.step}
                    value={openingFloatInput}
                    onChange={(e) => setOpeningFloatInput(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground outline-none focus:ring-2 focus:ring-brand/30"
                  />
                  {xReport.priorBusinessDate === null && (
                    <p className="text-xs text-amber-700 mt-1">{tr('No prior closing float found; enter starting cash', 'لا يوجد رصيد إغلاق سابق؛ أدخل نقدية البداية')}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="counted-cash" className="block text-sm text-muted-foreground mb-1 font-bold text-foreground">
                    {tr('Actual Physical Cash Counted in Drawer', 'النقدية الفعلية المجرودة بالدرج')}
                  </label>
                  <input
                    id="counted-cash"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    autoFocus
                    step={unitAdapter.step}
                    value={countedInput}
                    onChange={(e) => setCountedInput(e.target.value)}
                    className="w-full px-3 py-2 text-base font-bold border-2 border-brand/50 rounded-lg bg-background text-foreground outline-none focus:ring-2 focus:ring-brand/30"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border p-3 bg-muted/40">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">{tr('Expected Cash', 'النقدية المتوقعة بالدرج')}</p>
                      {!adminUnlocked && closureType === 'pre_blind_cashier' && (
                        <button
                          type="button"
                          onClick={() => {
                            setAdminPinError(null);
                            setAdminPinInput('');
                            setShowAdminPinPrompt(!showAdminPinPrompt);
                          }}
                          className="text-[11px] font-bold text-brand hover:underline inline-flex items-center gap-1 cursor-pointer bg-brand/10 hover:bg-brand/20 px-2 py-0.5 rounded-md"
                        >
                          <KeyRound size={12} />
                          <span>{tr('Manager PIN', 'رمز المدير')}</span>
                        </button>
                      )}
                    </div>
                    <p className="text-xl font-bold text-foreground ltr-island">
                      {adminUnlocked || closureType === 'full_day_close' ? (amountsValid ? fmt(expectedCashTotalCents / minorFactor) : '—') : '••••••••'}
                    </p>
                  </div>

                  <div className={`rounded-lg border p-3 ${adminUnlocked || closureType === 'full_day_close' ? (varianceCents === 0 ? 'border-border bg-muted/40' : varianceCents < 0 ? 'border-red-300 dark:border-red-800/40 bg-red-50 dark:bg-red-950/40' : 'border-amber-300 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/40') : 'border-border bg-muted/40'}`}>
                    <p className="text-xs text-muted-foreground">{tr('Variance', 'فارق الدرج (عجز / زيادة)')}</p>
                    <p className={`text-xl font-bold ltr-island ${!adminUnlocked && closureType === 'pre_blind_cashier' ? 'text-muted-foreground font-mono tracking-widest select-none' : varianceCents === 0 ? 'text-foreground' : varianceCents < 0 ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`}>
                      {adminUnlocked || closureType === 'full_day_close' ? (amountsValid ? fmt(varianceCents / minorFactor) : '—') : '••••••••'}
                    </p>
                  </div>
                </div>

                {submitError && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-300 dark:border-red-800/40 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    <span>{submitError}</span>
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Closed Z Summary */}
            {closeStep === 3 && closedZ && (
              <div className="space-y-3">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={closeAnotherDay}
                    className="text-xs font-medium text-brand hover:underline focus:outline-none focus:ring-2 focus:ring-brand/30 rounded px-1 py-0.5"
                    disabled={submittingClose || printingZ}
                  >
                    {tr('Close another day', 'إغلاق يوم آخر')}
                  </button>
                </div>
                {closedZ.period_start && closedZ.period_end && (
                  <p className="text-xs text-muted-foreground">
                    {tr(`Period: ${closedZ.period_start} to ${closedZ.period_end}`, `الفترة: ${closedZ.period_start} إلى ${closedZ.period_end}`)}
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground">{tr('Opening Float', 'الرصيد الافتتاحي')}</p>
                    <p className="text-base font-semibold text-foreground"><Ltr>{fmt(closedZ.opening_float_cents / minorFactor)}</Ltr></p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground">{tr('Counted Cash', 'النقدية الفعلية المعدودة')}</p>
                    <p className="text-base font-semibold text-foreground"><Ltr>{fmt(closedZ.counted_cash_cents / minorFactor)}</Ltr></p>
                  </div>
                </div>

                <div className="rounded-lg border border-border p-3 bg-muted/40">
                  <p className="text-sm font-medium text-foreground">
                    {tr(`${closedZ.bill_count} bills settled`, `تم تسوية ${closedZ.bill_count} فاتورة`)}
                  </p>
                </div>

                {closedZ.notes && (
                  <div className="rounded-lg border border-border p-3 bg-muted/40">
                    <p className="text-xs text-muted-foreground">{tr('Closure Notes', 'ملاحظات الإغلاق')}</p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{closedZ.notes}</p>
                  </div>
                )}

                {/* Centered Slip Preview Card */}
                <div className="border border-border rounded-xl p-4 bg-card text-center space-y-2">
                  <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    {tr('Thermal Centered Slip Preview', 'معاينة الإيصال الحراري المركز')}
                  </div>
                  <div className="text-lg font-black text-foreground">
                    {closureType === 'pre_blind_cashier'
                      ? tr('Pre-Blind Cashier Handover Slip', 'إيصال إغلاق وتسليم وردية كاشير مبدئي أعمى')
                      : tr('Full Day / Shift Z-Report', 'تقرير إغلاق اليوم والوردية الشامل Z-Report')}
                  </div>
                  <Button
                    onClick={handleCenteredPrint}
                    className="w-full gap-2 bg-brand text-white font-black h-11"
                  >
                    <Printer size={16} />
                    <span>{tr('Print Center-Aligned Thermal Slip (ESC/POS)', 'طباعة الإيصال الحراري المركز (ESC/POS)')}</span>
                  </Button>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            {closeStep === 3 ? (
              <>
                <Button variant="outline" onClick={() => setCloseOpen(false)}>
                  {tr('Close Window', 'إغلاق النافذة')}
                </Button>
                <Button onClick={handleCenteredPrint} disabled={printingZ || !closedZ}>
                  <Printer size={14} />
                  <span>{tr('Print Slip', 'طباعة الإيصال')}</span>
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setCloseOpen(false)} disabled={submittingClose}>
                  <X size={14} />
                  <span>{tr('Cancel', 'إلغاء')}</span>
                </Button>
                <div className="flex items-center gap-2 ms-auto">
                  {closeStep > 1 && (
                    <Button variant="ghost" onClick={() => {
                      setAlreadyClosedOverride(false);
                      setCloseStep((s) => (s > 1 ? ((s - 1) as 1 | 2) : s));
                    }} disabled={submittingClose}>
                      <ArrowLeft size={14} className="rtl-flip" />
                      <span>{tr('Back', 'رجوع')}</span>
                    </Button>
                  )}
                  {closeStep === 1 && (
                    <Button
                      onClick={() => {
                        if (!xReport || xReport.alreadyClosed || alreadyClosedOverride) return;
                        setCloseStep(2);
                      }}
                      disabled={xLoading || xError !== null || !xReport || xReport.alreadyClosed || alreadyClosedOverride}
                    >
                      <span>{tr('Continue', 'متابعة')}</span>
                      <ArrowRight size={14} className="rtl-flip" />
                    </Button>
                  )}
                  {closeStep === 2 && (
                    <Button
                      onClick={submitClose}
                      disabled={submittingClose || !xReport || !amountsValid || xReport.alreadyClosed || alreadyClosedOverride}
                    >
                      {submittingClose ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
                      <span>
                        {closureType === 'pre_blind_cashier'
                          ? tr('Submit Pre-Blind Count', 'تسجيل الجرد المبدئي للكاشير')
                          : tr('Execute Full Day Close', 'تنفيذ إغلاق اليوم الشامل')}
                      </span>
                    </Button>
                  )}
                </div>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
