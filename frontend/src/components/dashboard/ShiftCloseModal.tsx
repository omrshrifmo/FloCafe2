'use client';
import { useState } from 'react';
import { Ltr } from '@/components/layout/Ltr';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Lock, Printer, AlertTriangle, KeyRound, Check } from 'lucide-react';
import type { CashSessionModel } from '@/hooks/useCashSession';
import api from '@/lib/api';
import toast from 'react-hot-toast';

/** Shift-close ("Cerrar turno") modal. Pure view over useCashSession:
 *  count form with live expected + variance preview, then the immutable
 *  result with a print button. Expected cash is hidden by default (blind drop)
 *  and only revealed by entering an Admin (Manager/Owner) PIN. */
export function ShiftCloseModal({ model }: { model: CashSessionModel }) {
  const {
    closeModalOpen, setCloseModalOpen, session, countedInput, setCountedInput,
    submitting, submitError, closedResult, setClosedResult, printing,
    variancePreviewCents, minorFactor, fmt, t, tCommon, closeShift, printClosure,
    setSubmitError,
  } = model;

  const [hasPrinted, setHasPrinted] = useState(false);
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
        toast.success(t('adminPinVerified', { name: res.data.admin?.name || 'Authorized' }));
      } else {
        setAdminPinError(res.data?.error || t('adminPinError'));
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || t('adminPinError');
      setAdminPinError(msg);
    } finally {
      setAdminPinLoading(false);
    }
  };

  const closeModal = (next: boolean) => {
    if (!next && submitting) return;
    if (!next) {
      setClosedResult(null);
      setSubmitError(null);
      setCountedInput('');
      setHasPrinted(false);
      setAdminUnlocked(false);
      setShowAdminPinPrompt(false);
      setAdminPinInput('');
      setAdminPinError(null);
    }
    setCloseModalOpen(next);
  };
  return (
    <Dialog open={closeModalOpen} onOpenChange={closeModal}>
      <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock size={18} className="text-foreground" />
            {t('closeShiftSession')}
          </DialogTitle>
          <DialogDescription>{t('zReport')}</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-4">
          {submitError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}
          {!closedResult && session && (
            <>
              {/* Expected Cash Row: Blind drop protection */}
              <div className="flex items-center justify-between text-sm p-2.5 rounded-xl bg-muted/40 border border-border">
                <span className="text-muted-foreground font-medium">{t('expectedCash')}</span>
                {adminUnlocked ? (
                  <span className="font-bold text-foreground ltr-island">
                    <Ltr>{fmt(session.expected_cash_cents / minorFactor)}</Ltr>
                  </span>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-muted-foreground tracking-widest text-xs select-none">••••••••</span>
                    <button
                      type="button"
                      onClick={() => {
                        setAdminPinError(null);
                        setAdminPinInput('');
                        setShowAdminPinPrompt(!showAdminPinPrompt);
                      }}
                      className="text-xs font-bold text-brand hover:underline inline-flex items-center gap-1 cursor-pointer bg-brand/10 hover:bg-brand/20 px-2.5 py-1 rounded-lg transition-all"
                    >
                      <KeyRound size={13} />
                      <span>{t('adminPinButton')}</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Admin PIN Unlock Form */}
              {showAdminPinPrompt && !adminUnlocked && (
                <form onSubmit={handleVerifyAdminPin} className="p-3 rounded-xl border border-brand/30 bg-brand/5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <Lock size={13} className="text-brand" />
                      <span>{t('adminPinPrompt')}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowAdminPinPrompt(false)}
                      className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      {tCommon('cancel')}
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
                      className="h-9 px-3 gap-1 bg-brand text-white font-bold"
                    >
                      {adminPinLoading ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                      <span>{t('adminPinUnlock')}</span>
                    </Button>
                  </div>
                  {adminPinError && (
                    <p className="text-xs text-rose-600 dark:text-rose-400 font-semibold">{adminPinError}</p>
                  )}
                </form>
              )}

              <div>
                <label htmlFor="shift-counted-cash" className="block text-sm text-muted-foreground mb-1">
                  {t('countedCash')}
                </label>
                <input
                  id="shift-counted-cash"
                  type="number"
                  min="0"
                  inputMode="decimal"
                  value={countedInput}
                  onChange={(e) => setCountedInput(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground font-semibold text-base"
                  placeholder="0"
                />
              </div>

              {/* Live Variance Row */}
              <div className="flex items-center justify-between text-sm p-2.5 rounded-xl bg-muted/40 border border-border">
                <span className="text-muted-foreground font-medium">{t('variance')}</span>
                {adminUnlocked ? (
                  <span className="font-bold text-foreground ltr-island">
                    <Ltr>{variancePreviewCents !== null ? fmt(variancePreviewCents / minorFactor) : '—'}</Ltr>
                  </span>
                ) : (
                  <span className="font-mono text-muted-foreground tracking-widest text-xs select-none">••••••••</span>
                )}
              </div>
            </>
          )}
          {closedResult && (
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('expectedCash')}</span>
                <span className="font-semibold text-foreground"><Ltr>{fmt(closedResult.expected_cash_cents / minorFactor)}</Ltr></span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('countedCash')}</span>
                <span className="font-semibold text-foreground"><Ltr>{fmt(closedResult.counted_cash_cents / minorFactor)}</Ltr></span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('variance')}</span>
                <span className="font-semibold text-foreground"><Ltr>{fmt(closedResult.variance_cents / minorFactor)}</Ltr></span>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          {closedResult ? (
            <>
              <Button variant="outline" onClick={() => closeModal(false)} disabled={printing}>
                {tCommon('close')}
              </Button>
              <Button
                onClick={async () => {
                  if (!closedResult) return;
                  const ok = await printClosure(closedResult.closure_id, hasPrinted);
                  if (ok) setHasPrinted(true);
                }}
                disabled={printing}
              >
                {printing ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
                {t(hasPrinted ? 'reprintZ' : 'printZReport')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => closeModal(false)} disabled={submitting}>
                {tCommon('cancel')}
              </Button>
              <Button onClick={closeShift} disabled={submitting || !session}>
                {submitting && <Loader2 size={16} className="animate-spin" />}
                {t('closeShiftSession')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
