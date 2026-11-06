'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { useFormatNumber } from '@/hooks/useFormatNumber';
import { useFormatDate } from '@/hooks/useFormatDate';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import toast from 'react-hot-toast';
import { useTranslations } from 'use-intl';
import { useAppLanguage } from '@/lib/i18n/bilingual';
import {
  ClipboardList,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Printer,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';

interface StocktakeSession {
  id: number;
  status: 'draft' | 'in_progress' | 'completed' | 'cancelled';
  scope: string;
  counter_name: string | null;
  notes: string | null;
  variance_threshold: number;
  created_at: string;
  finalized_at: string | null;
  total_variance?: number;
}

interface StocktakeItem {
  id: number;
  supply_id: string;
  supply_name: string;
  base_unit: string;
  expected_quantity: number;
  counted_quantity: number | null;
  variance_quantity: number | null;
  variance_cost?: number;
  notes?: string;
}

export function StocktakeManager() {
  const t = useTranslations('stocktake');
  const tCommon = useTranslations('common');
  const { isAr, tr, dir } = useAppLanguage();
  const fmtNum = useFormatNumber();
  const { formatDate } = useFormatDate();

  const [sessions, setSessions] = useState<StocktakeSession[]>([]);
  const [activeSession, setActiveSession] = useState<StocktakeSession | null>(null);
  const [sessionItems, setSessionItems] = useState<StocktakeItem[]>([]);
  const [search, setSearch] = useState('');
  const [barcodeScanInput, setBarcodeScanInput] = useState('');

  const handleBarcodeQuickCount = (code: string) => {
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) return;
    const match = sessionItems.find(
      (it) => it.supply_id.toLowerCase() === trimmed || it.supply_name.toLowerCase().includes(trimmed)
    );
    if (match) {
      const currentCount = match.counted_quantity ?? 0;
      handleUpdateItemCount(match.supply_id, String(currentCount + 1));
      toast.success(`${tr('Count +1: ', 'تم العد +1: ')}${match.supply_name} (${currentCount + 1})`);
      setBarcodeScanInput('');
    } else {
      toast.error(`${tr('Item not found for: ', 'لم يتم العثور على الصنف: ')}"${code}"`);
    }
  };

  // New Session Modal
  const [showNewModal, setShowNewModal] = useState(false);
  const [newScope, setNewScope] = useState('all');
  const [newCounter, setNewCounter] = useState('');
  const [newNotes, setNewNotes] = useState('');

  // Finalize Modal
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [managerPin, setManagerPin] = useState('');
  const [finalizing, setFinalizing] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      const res = await api.get('/stocktakes');
      setSessions(res.data?.sessions || []);
    } catch {
      toast.error(t('loadSessionsError'));
    }
  }, [t]);

  useEffect(() => {
    let active = true;
    api.get('/stocktakes')
      .then((res) => {
        if (!active) return;
        setSessions(res.data?.sessions || []);
      })
      .catch(() => {
        if (active) toast.error(t('loadSessionsError'));
      });
    return () => {
      active = false;
    };
  }, [t]);

  const openSession = async (session: StocktakeSession) => {
    try {
      const res = await api.get(`/stocktakes/${session.id}`);
      setActiveSession(res.data?.session || session);
      setSessionItems(res.data?.items || []);
    } catch {
      toast.error(t('loadDetailsError'));
    }
  };

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post('/stocktakes', {
        scope: newScope,
        counter_name: newCounter || null,
        notes: newNotes || null,
      });
      toast.success(t('sessionStartedSuccess'));
      setShowNewModal(false);
      setNewCounter('');
      setNewNotes('');
      void loadSessions();
      if (res.data?.id) {
        void openSession({
          id: res.data.id,
          status: 'in_progress',
          scope: newScope,
          counter_name: newCounter,
          notes: newNotes,
          variance_threshold: 50,
          created_at: new Date().toISOString(),
          finalized_at: null,
        });
      }
    } catch {
      toast.error(t('createSessionError'));
    }
  };

  const handleUpdateItemCount = (supplyId: string, countStr: string) => {
    const countedVal = countStr === '' ? null : parseFloat(countStr);
    setSessionItems((prev) =>
      prev.map((item) => {
        if (item.supply_id !== supplyId) return item;
        const variance = countedVal !== null ? countedVal - item.expected_quantity : null;
        return {
          ...item,
          counted_quantity: countedVal,
          variance_quantity: variance,
        };
      })
    );
  };

  const handleSaveDraft = async () => {
    if (!activeSession) return;
    try {
      const itemsPayload = sessionItems.map((item) => ({
        supply_id: item.supply_id,
        counted_quantity: item.counted_quantity,
        notes: item.notes,
      }));
      await api.put(`/stocktakes/${activeSession.id}/items`, { items: itemsPayload });
      toast.success(t('draftSavedSuccess'));
    } catch {
      toast.error(t('saveDraftError'));
    }
  };

  const calculateTotalDiscrepancy = () => {
    return sessionItems.reduce((acc, it) => acc + Math.abs(it.variance_quantity || 0), 0);
  };

  const handleFinalize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSession) return;
    const totalVariance = calculateTotalDiscrepancy();
    const exceedsThreshold = totalVariance > (activeSession.variance_threshold || 50);

    if (exceedsThreshold && (!managerPin || managerPin.length < 4)) {
      toast.error(t('managerPinRequired'));
      return;
    }

    try {
      setFinalizing(true);
      const itemsPayload = sessionItems.map((item) => ({
        supply_id: item.supply_id,
        counted_quantity: item.counted_quantity,
        notes: item.notes,
      }));
      await api.put(`/stocktakes/${activeSession.id}/items`, { items: itemsPayload });

      await api.post(`/stocktakes/${activeSession.id}/finalize`, {
        manager_pin: managerPin || undefined,
        auto_adjust_inventory: true,
      });

      toast.success(t('finalizedSuccess'));
      setShowFinalizeModal(false);
      setManagerPin('');
      setActiveSession(null);
      void loadSessions();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg || t('finalizeError'));
    } finally {
      setFinalizing(false);
    }
  };

  const filteredItems = sessionItems.filter((it) =>
    it.supply_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6" dir={dir}>
      {/* Session Active View */}
      {activeSession ? (
        <div className="bg-card rounded-2xl border border-border p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-4">
            <div>
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={() => setActiveSession(null)}>
                  <RotateCcw className="h-4 w-4 me-1" /> {tr('Back to Sessions', 'العودة للجلسات')}
                </Button>
                <h2 className="text-xl font-bold text-foreground">
                  {tr('Stocktake Session #', 'جلسة جرد رقم #')}{activeSession.id}
                </h2>
                <Badge variant={activeSession.status === 'completed' ? 'secondary' : 'default'} className="capitalize">
                  {activeSession.status === 'completed'
                    ? tr('Completed', 'مكتملة ومسواة')
                    : activeSession.status === 'in_progress'
                    ? tr('In Progress', 'قيد الجرد الفعلي')
                    : tr('Draft', 'مسودة')}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {tr('Auditor', 'المسؤول')}: {activeSession.counter_name || tr('Staff', 'فريق العمل')} • {tr('Date', 'التاريخ')}: {formatDate(activeSession.created_at)}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5">
                <Printer className="h-4 w-4" /> {tr('Print Variance Slip', 'طباعة إيصال الفروقات')}
              </Button>
              {activeSession.status !== 'completed' && (
                <>
                  <Button variant="secondary" size="sm" onClick={handleSaveDraft}>
                    {tr('Save Draft', 'حفظ كمسودة')}
                  </Button>
                  <Button size="sm" onClick={() => setShowFinalizeModal(true)} className="gap-1.5">
                    <CheckCircle2 className="h-4 w-4" /> {tr('Finalize & Adjust', 'اعتماد وتسوية الجرد')}
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Search & Barcode Quick Scan */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative max-w-sm flex-1 min-w-[200px]">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tr('Search items by name...', 'البحث عن صنف بالاسم...')}
                className="w-full ps-9 pe-4 py-2 bg-background border border-border rounded-lg text-sm"
              />
            </div>

            {activeSession.status !== 'completed' && (
              <div className="flex items-center gap-2 max-w-md flex-1">
                <input
                  type="text"
                  value={barcodeScanInput}
                  onChange={(e) => setBarcodeScanInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleBarcodeQuickCount(barcodeScanInput);
                    }
                  }}
                  placeholder={tr('Scan barcode / SKU to count +1...', 'امسح الباركود أو الكود لزيادة العد +1...')}
                  className="w-full px-3 py-2 bg-background border border-brand/50 rounded-lg text-sm focus:ring-2 focus:ring-brand"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => handleBarcodeQuickCount(barcodeScanInput)}
                  className="h-9 shrink-0 text-xs"
                >
                  {tr('Scan Count', 'مسح وعد')}
                </Button>
              </div>
            )}
          </div>

          {/* Counting Table */}
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground uppercase border-b border-border">
                <tr>
                  <th className="py-3 px-4 text-start font-medium">{tr('Supply / Raw Material', 'المادة الخام / الصنف')}</th>
                  <th className="py-3 px-4 text-center font-medium">{tr('Unit', 'الوحدة')}</th>
                  <th className="py-3 px-4 text-end font-medium">{tr('Expected Stock', 'الرصيد الدفتري')}</th>
                  <th className="py-3 px-4 text-center font-medium w-36">{tr('Physical Count', 'العد الفعلي')}</th>
                  <th className="py-3 px-4 text-end font-medium">{tr('Variance', 'الفارق')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredItems.map((item) => (
                  <tr key={item.supply_id} className="hover:bg-muted/30">
                    <td className="py-3 px-4 font-medium text-foreground">{item.supply_name}</td>
                    <td className="py-3 px-4 text-center text-xs text-muted-foreground">{item.base_unit}</td>
                    <td className="py-3 px-4 text-end font-mono">{fmtNum(item.expected_quantity)}</td>
                    <td className="py-3 px-4 text-center">
                      <input
                        type="number"
                        step="any"
                        disabled={activeSession.status === 'completed'}
                        value={item.counted_quantity !== null ? item.counted_quantity : ''}
                        onChange={(e) => handleUpdateItemCount(item.supply_id, e.target.value)}
                        placeholder="—"
                        className="w-28 px-3 py-1.5 bg-background border border-border rounded-lg text-sm font-bold text-center focus:ring-2 focus:ring-brand outline-hidden"
                      />
                    </td>
                    <td
                      className={`py-3 px-4 text-end font-bold font-mono ${
                        item.variance_quantity === null
                          ? 'text-muted-foreground'
                          : item.variance_quantity < 0
                          ? 'text-rose-600'
                          : item.variance_quantity > 0
                          ? 'text-emerald-600'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {item.variance_quantity !== null
                        ? `${item.variance_quantity > 0 ? '+' : ''}${fmtNum(item.variance_quantity)}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Sessions List */
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-brand" />
                {tr('Stocktaking & Physical Inventory Audits', 'إدارة جلسات الجرد والمطابقة الفعلية')}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {tr('Audit physical counts against system stock, track discrepancies, and auto-adjust balances', 'مطابقة الرصيد الفعلي مع رصيد النظام، تتبع الفروقات، والتسوية الآلية للمخزون')}
              </p>
            </div>
            <Button onClick={() => setShowNewModal(true)} className="gap-1.5">
              <Plus className="h-4 w-4" /> {tr('Start New Stocktake', 'بدء جلسة جرد جديدة')}
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground uppercase border-b border-border">
                <tr>
                  <th className="py-3 px-4 text-start font-medium">{tr('Session #', 'رقم الجلسة')}</th>
                  <th className="py-3 px-4 text-start font-medium">{tr('Audit Scope', 'نطاق الجرد')}</th>
                  <th className="py-3 px-4 text-start font-medium">{tr('Responsible Auditor', 'المسؤول عن العد')}</th>
                  <th className="py-3 px-4 text-start font-medium">{tr('Creation Date', 'تاريخ الإنشاء')}</th>
                  <th className="py-3 px-4 text-center font-medium">{tr('Status', 'الحالة')}</th>
                  <th className="py-3 px-4 text-end font-medium">{tr('Actions', 'الإجراءات')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sessions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-muted-foreground">
                      {tr('No stocktake sessions found. Start a new session to begin.', 'لا توجد جلسات جرد سابقة. ابدأ جلسة جديدة للبدء.')}
                    </td>
                  </tr>
                ) : (
                  sessions.map((sess) => (
                    <tr key={sess.id} className="hover:bg-muted/30">
                      <td className="py-3.5 px-4 font-bold text-foreground">#{sess.id}</td>
                      <td className="py-3.5 px-4 text-xs capitalize text-muted-foreground">{sess.scope}</td>
                      <td className="py-3.5 px-4 text-xs text-foreground">{sess.counter_name || tr('Staff', 'فريق العمل')}</td>
                      <td className="py-3.5 px-4 text-xs text-muted-foreground">{formatDate(sess.created_at)}</td>
                      <td className="py-3.5 px-4 text-center">
                        <Badge
                          variant={
                            sess.status === 'completed'
                              ? 'secondary'
                              : sess.status === 'in_progress'
                              ? 'default'
                              : 'outline'
                          }
                          className="capitalize"
                        >
                          {sess.status === 'completed'
                            ? tr('Completed', 'مكتملة ومسواة')
                            : sess.status === 'in_progress'
                            ? tr('In Progress', 'قيد الجرد الفعلي')
                            : tr('Draft', 'مسودة')}
                        </Badge>
                      </td>
                      <td className="py-3.5 px-4 text-end">
                        <Button size="sm" variant="ghost" onClick={() => openSession(sess)}>
                          {sess.status === 'completed' ? tr('View Audit Report', 'عرض تقرير الجرد') : tr('Continue Count', 'متابعة العد')}
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Start Session Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h3 className="text-lg font-bold text-foreground">{tr('Start New Stocktake Session', 'بدء جلسة جرد مخزني جديدة')}</h3>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSession} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">{tr('Stocktake Scope', 'نطاق الجرد')}</label>
                <select
                  value={newScope}
                  onChange={(e) => setNewScope(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                >
                  <option value="all">{tr('All Inventory Items', 'جميع أصناف المخزون')}</option>
                  <option value="bar">{tr('Bar & Beverage Materials', 'خامات ومشروبات البار')}</option>
                  <option value="kitchen">{tr('Kitchen & Food Supplies', 'خامات وأغذية المطبخ')}</option>
                  <option value="packaging">{tr('Packaging & Disposables', 'مواد التعبئة والتغليف')}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">{tr('Auditor / Staff Name', 'اسم مسؤول الجرد')}</label>
                <input
                  type="text"
                  value={newCounter}
                  onChange={(e) => setNewCounter(e.target.value)}
                  placeholder={tr('e.g. Ahmed - Head Bartender', 'مثال: أحمد - رئيس البار')}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">{tr('Audit Notes - Optional', 'ملاحظات الجرد - اختياري')}</label>
                <textarea
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder={tr('e.g. End of month inventory count', 'مثال: جرد نهاية الشهر الدوري')}
                  rows={2}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-border">
                <Button type="button" variant="outline" onClick={() => setShowNewModal(false)}>
                  {tr('Cancel', 'إلغاء')}
                </Button>
                <Button type="submit">{tr('Start Counting Session', 'بدء جلسة العد')}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Finalize Modal with Manager PIN */}
      {showFinalizeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h3 className="text-lg font-bold text-foreground">{tr('Finalize & Reconcile Stocktake', 'اعتماد وتسوية فروقات الجرد')}</h3>
              <button
                type="button"
                onClick={() => setShowFinalizeModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleFinalize} className="p-6 space-y-4">
              <div className="p-4 bg-muted/40 rounded-xl space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{tr('Total Count Discrepancy', 'إجمالي الفروقات المحسوبة')}</span>
                  <span className="font-bold text-foreground">{fmtNum(calculateTotalDiscrepancy())} {tr('Units', 'وحدة')}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {tr('Approving this stocktake will immediately update on-hand stock and log discrepancy movements in the audit ledger.', 'اعتماد هذا الجرد سيقوم فوراً بتحديث رصيد المخزون الفعلي وتسجيل حركات التسوية في سجل التدقيق.')}
                </p>
              </div>

              {calculateTotalDiscrepancy() > (activeSession?.variance_threshold || 50) && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-600">
                    <AlertTriangle className="h-4 w-4" />
                    {tr('Manager PIN Authorization Required - Variance Exceeds Threshold', 'يلزم إدخال رمز المدير للاعتماد - الفروقات تتجاوز الحد المسموح')}
                  </div>
                  <input
                    type="password"
                    maxLength={6}
                    value={managerPin}
                    onChange={(e) => setManagerPin(e.target.value)}
                    placeholder={tr('Enter 4-6 digit manager PIN', 'أدخل رمز المدير المكون من 4 إلى 6 أرقام')}
                    className="w-full text-center tracking-widest text-lg px-4 py-2.5 bg-background border border-border rounded-xl font-mono focus:outline-hidden focus:ring-2 focus:ring-brand"
                    required
                  />
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-border">
                <Button type="button" variant="outline" onClick={() => setShowFinalizeModal(false)}>
                  {tr('Cancel', 'إلغاء')}
                </Button>
                <Button type="submit" disabled={finalizing}>
                  {finalizing ? tr('Finalizing & Adjusting...', 'جاري الاعتماد والتسوية...') : tr('Confirm Inventory Adjustments', 'تأكيد التسويات المخزنية')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
