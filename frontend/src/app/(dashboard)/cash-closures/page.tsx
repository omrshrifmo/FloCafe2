'use client';

import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Printer, Eye, Lock, RefreshCw, Calendar, Layers } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAppLanguage } from '@/lib/i18n/bilingual';
import { printCenteredZReportSlip } from '@/lib/printer/printCenteredZReportSlip';
import { ShiftCloseModal } from '@/components/dashboard/ShiftCloseModal';
import { useCashSession } from '@/hooks/useCashSession';

interface CashClosureHistoryItem {
  id: number | string;
  closure_type?: string;
  scope?: string;
  business_date?: string;
  created_at?: string;
  closed_at?: string;
  closed_by_name?: string;
  closed_by_role?: string;
  counted_cash_cents?: number;
  declared_cash?: number;
  actual_cash_cents?: number;
  expected_cash_cents?: number;
  variance?: number;
  variance_cents?: number;
  total_sales_cents?: number;
  gross_collected_cents?: number;
  net_collected_cents?: number;
  dine_in_sales?: number;
  takeaway_sales?: number;
  delivery_sales?: number;
  wallet_sales?: number;
  total_orders_count?: number;
  expected_bom_cost?: number;
  expected_gross_profit?: number;
  expected_net_profit?: number;
  declared_card_slips?: number;
  declared_wallet_slips?: number;
  linked_preblind_id?: string | number;
  z_number?: string | number;
  notes?: string;
  [key: string]: unknown;
}

export default function CashClosuresPage() {
  const { isAr, tr } = useAppLanguage();
  const fmt = useFormatCurrency();
  const shift = useCashSession();

  const [closures, setClosures] = useState<CashClosureHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'all' | 'pre_blind' | 'full_day'>('all');
  const [selectedClosure, setSelectedClosure] = useState<CashClosureHistoryItem | null>(null);
  const [closeModalMode, setCloseModalMode] = useState<'pre_blind_cashier' | 'full_day_close'>('pre_blind_cashier');

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const res = await api.get('/cash-closures/history');
      setClosures(res.data?.closures || []);
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : null;
      toast.error(msg || tr('Failed to load closures history', 'فشل في تحميل سجل الورديات'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    api.get('/cash-closures/history')
      .then((res) => {
        if (!active) return;
        setClosures(res.data?.closures || []);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        const msg = err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : null;
        toast.error(msg || tr('Failed to load closures history', 'فشل في تحميل سجل الورديات'));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tr]);

  const filteredClosures = closures.filter((c) => {
    if (activeTab === 'pre_blind') return c.closure_type === 'pre_blind_cashier';
    if (activeTab === 'full_day') return c.closure_type === 'full_day_close' || c.scope === 'day';
    return true;
  });

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header and Action Buttons */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Lock className="text-brand" size={24} />
            {tr('Shifts & Day Closures History', 'سجل الورديات وإغلاقات اليوم والتقارير')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {tr('Manage Pre-Blind Cashier Handovers and Full Owner/Manager Z-Reports.', 'إدارة تسليمات ورديات الكاشير المبدئية وتقارير إغلاق اليوم والوردية الشاملة Z-Report.')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchHistory}
            disabled={loading}
            className="gap-1.5"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {tr('Refresh', 'تحديث')}
          </Button>

          {/* Pre-Blind Cashier Button */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setCloseModalMode('pre_blind_cashier');
              shift.setCloseModalOpen(true);
            }}
            className="border-amber-600/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 font-bold gap-1.5"
          >
            <Lock size={14} />
            {tr('Pre-Blind Cashier Close', 'إغلاق وردية مبدئي أعمى للكاشير')}
          </Button>

          {/* Full Day Close Button */}
          <Button
            size="sm"
            onClick={() => {
              setCloseModalMode('full_day_close');
              shift.setCloseModalOpen(true);
            }}
            className="bg-brand text-white hover:bg-brand/90 font-bold gap-1.5"
          >
            <Layers size={14} />
            {tr('Full Day / Shift Close (Z-Report)', 'إغلاق اليوم الشامل للمالك والمدير - Z-Report')}
          </Button>
        </div>
      </div>

      {/* Tabs Filter */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'all' | 'pre_blind' | 'full_day')}>
        <TabsList className="bg-muted">
          <TabsTrigger value="all">{tr('All Closures', 'جميع الإغلاقات')}</TabsTrigger>
          <TabsTrigger value="pre_blind">{tr('Pre-Blind Cashier Handovers', 'تسليمات الكاشير المبدئية')}</TabsTrigger>
          <TabsTrigger value="full_day">{tr('Full Day Close (Z-Reports)', 'تقارير إغلاق اليوم الشامل Z')}</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="pt-4">
          {loading ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-brand" />
              {tr('Loading closures history...', 'جار تحميل سجل الورديات...')}
            </div>
          ) : filteredClosures.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Calendar size={32} className="mx-auto mb-2 opacity-50" />
                <p>{tr('No closures found for this category.', 'لا توجد سجلات إغلاق في هذا القسم.')}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {filteredClosures.map((c) => {
                const isPreBlind = c.closure_type === 'pre_blind_cashier';
                const variance = typeof c.variance === 'number'
                  ? c.variance
                  : (typeof c.variance_cents === 'number' ? c.variance_cents / 100 : 0);
                const counted = typeof c.counted_cash_cents === 'number'
                  ? c.counted_cash_cents / 100
                  : (typeof c.declared_cash === 'number' ? c.declared_cash : 0);
                const expected = typeof c.expected_cash_cents === 'number'
                  ? c.expected_cash_cents / 100
                  : 0;

                return (
                  <Card key={c.id} className="overflow-hidden hover:border-brand/40 transition-colors">
                    <CardContent className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant={isPreBlind ? 'outline' : 'default'} className={isPreBlind ? 'border-amber-500 text-amber-700 bg-amber-50' : 'bg-brand text-white'}>
                            {isPreBlind ? tr('Cashier Pre-Blind Handover', 'تسليم وردية مبدئي') : `Z-Report #${c.z_number || c.id}`}
                          </Badge>
                          <span className="text-xs font-mono text-muted-foreground">
                            {c.business_date} • {c.created_at ? new Date(c.created_at).toLocaleTimeString() : ''}
                          </span>
                        </div>

                        <div className="text-xs text-muted-foreground">
                          {tr('Closed By', 'تم الإغلاق بواسطة')}: <strong>{c.closed_by_name || 'Staff'}</strong> ({c.closed_by_role || 'staff'})
                          {c.linked_preblind_id && (
                            <span className="ms-2 text-blue-600 font-semibold">
                              • {tr('Linked Pre-Blind #', 'مرتبط بتسليم #')}{String(c.linked_preblind_id)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Financial Metrics */}
                      <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
                        <div>
                          <span className="text-muted-foreground block">{tr('Physical Cash', 'النقدية الفعلية')}</span>
                          <span className="text-sm font-bold text-foreground">{fmt(counted)}</span>
                        </div>

                        {!isPreBlind && (
                          <>
                            <div>
                              <span className="text-muted-foreground block">{tr('Expected Cash', 'المتوقع بالدرج')}</span>
                              <span className="text-sm font-bold text-foreground">{fmt(expected)}</span>
                            </div>

                            {(() => {
                              const diff = counted - expected;
                              const def = (c as any).deficit_amount !== undefined ? Number((c as any).deficit_amount) : (diff < -0.009 ? Math.abs(diff) : 0);
                              const sur = (c as any).surplus_amount !== undefined ? Number((c as any).surplus_amount) : (diff > 0.009 ? diff : 0);
                              return (
                                <>
                                  <div>
                                    <span className="text-muted-foreground block">{tr('Deficit', 'عجز')}</span>
                                    <span className={`text-sm font-bold ${def > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                                      {def > 0 ? `-${fmt(def)}` : '0.00'}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground block">{tr('Surplus', 'فائض')}</span>
                                    <span className={`text-sm font-bold ${sur > 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                                      {sur > 0 ? `+${fmt(sur)}` : '0.00'}
                                    </span>
                                  </div>
                                </>
                              );
                            })()}

                            {Number(c.expected_bom_cost || 0) > 0 && (
                              <div className="hidden lg:block">
                                <span className="text-muted-foreground block">{tr('BOM Cost', 'تكلفة الخامات')}</span>
                                <span className="text-sm font-bold text-amber-600">{fmt(c.expected_bom_cost || 0)}</span>
                              </div>
                            )}

                            {Number(c.expected_gross_profit || 0) > 0 && (
                              <div className="hidden lg:block">
                                <span className="text-muted-foreground block">{tr('Expected Profit', 'الربح المتوقع')}</span>
                                <span className="text-sm font-bold text-green-600">{fmt(c.expected_gross_profit || 0)}</span>
                              </div>
                            )}
                          </>
                        )}
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedClosure(c)}
                          className="gap-1 text-xs"
                        >
                          <Eye size={13} />
                          {tr('View Details', 'عرض التفاصيل')}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => printCenteredZReportSlip(c, isAr ? 'ar' : 'en', c.closure_type || 'full_day_close')}
                          className="bg-brand text-white font-bold gap-1 text-xs"
                        >
                          <Printer size={13} />
                          {tr('Print Slip', 'طباعة الإيصال')}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Closure Slip Detail Modal */}
      {selectedClosure && (
        <Dialog open={!!selectedClosure} onOpenChange={() => setSelectedClosure(null)}>
          <DialogContent className="sm:max-w-xl max-h-[88vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base font-bold">
                <Printer size={18} className="text-brand" />
                {selectedClosure.closure_type === 'pre_blind_cashier'
                  ? tr('Pre-Blind Cashier Handover Slip', 'إيصال تسليم الوردية المبدئي')
                  : `Z-Report #${selectedClosure.z_number || selectedClosure.id}`}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {selectedClosure.business_date} • {selectedClosure.created_at ? new Date(selectedClosure.created_at).toLocaleString() : ''}
              </DialogDescription>
            </DialogHeader>

            <Tabs defaultValue="overview" className="w-full">
              <TabsList className="grid grid-cols-3 mb-3 text-xs">
                <TabsTrigger value="overview">{tr('Overview', 'نظرة عامة')}</TabsTrigger>
                <TabsTrigger value="sold_items">{tr('Sold Items', 'الأصناف المباعة')}</TabsTrigger>
                <TabsTrigger value="breakdowns">{tr('Payments & Cash', 'المدفوعات والدرج')}</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-3">
                {/* 4 Cards: Expected, Counted, Deficit, Surplus */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl border border-border bg-card">
                    <span className="text-muted-foreground block">{tr('Expected Cash', 'النقدية المتوقعة')}</span>
                    <span className="text-sm font-bold">{fmt((selectedClosure.expected_cash_cents || 0) / 100)}</span>
                  </div>
                  <div className="p-2.5 rounded-xl border border-border bg-card">
                    <span className="text-muted-foreground block">{tr('Counted Cash', 'النقدية المعدودة')}</span>
                    <span className="text-sm font-bold">{fmt((selectedClosure.counted_cash_cents || 0) / 100)}</span>
                  </div>
                  {(() => {
                    const diff = ((selectedClosure.counted_cash_cents || 0) - (selectedClosure.expected_cash_cents || 0)) / 100;
                    const defVal = (selectedClosure as any).deficit_amount !== undefined ? Number((selectedClosure as any).deficit_amount) : (diff < -0.009 ? Math.abs(diff) : 0);
                    const surVal = (selectedClosure as any).surplus_amount !== undefined ? Number((selectedClosure as any).surplus_amount) : (diff > 0.009 ? diff : 0);
                    return (
                      <>
                        <div className={`p-2.5 rounded-xl border ${defVal > 0 ? 'border-red-500/40 bg-red-500/10' : 'border-border bg-card'}`}>
                          <span className={`block font-semibold ${defVal > 0 ? 'text-red-700' : 'text-muted-foreground'}`}>{tr('Deficit', 'عجز')}</span>
                          <span className={`text-sm font-bold ${defVal > 0 ? 'text-red-600' : ''}`}>{fmt(defVal)}</span>
                        </div>
                        <div className={`p-2.5 rounded-xl border ${surVal > 0 ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-border bg-card'}`}>
                          <span className={`block font-semibold ${surVal > 0 ? 'text-emerald-700' : 'text-muted-foreground'}`}>{tr('Surplus', 'فائض')}</span>
                          <span className={`text-sm font-bold ${surVal > 0 ? 'text-emerald-600' : ''}`}>{fmt(surVal)}</span>
                        </div>
                      </>
                    );
                  })()}
                </div>

                <div className="p-3 rounded-xl border border-border bg-card space-y-2 text-xs">
                  <div className="flex justify-between border-b pb-1.5">
                    <span>{tr('Operator', 'الموظف المسئول')}</span>
                    <strong>{selectedClosure.closed_by_name} ({selectedClosure.closed_by_role})</strong>
                  </div>
                  {selectedClosure.closure_type !== 'pre_blind_cashier' && (
                    <>
                      <div className="flex justify-between border-b pb-1.5">
                        <span>{tr('BOM Materials Cost', 'تكلفة خامات BOM')}</span>
                        <strong className="text-amber-600">{fmt(selectedClosure.expected_bom_cost || 0)}</strong>
                      </div>
                      <div className="flex justify-between border-b pb-1.5">
                        <span>{tr('Expected Gross Profit', 'مجمل الربح المتوقع')}</span>
                        <strong className="text-green-600">{fmt(selectedClosure.expected_gross_profit || 0)}</strong>
                      </div>
                      <div className="flex justify-between pb-1">
                        <span>{tr('Expected Net Profit', 'صافي الربح المتوقع')}</span>
                        <strong className="text-emerald-600 font-bold">{fmt(selectedClosure.expected_net_profit || 0)}</strong>
                      </div>
                    </>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="sold_items" className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="p-2 rounded-lg border border-border bg-muted/40">
                    <span className="text-muted-foreground block">{tr('Total Items Sold', 'إجمالي القطع المباعة')}</span>
                    <span className="font-bold font-mono">{(selectedClosure as any).total_sold_items_qty || (selectedClosure as any).sold_items_count || 0}</span>
                  </div>
                  <div className="p-2 rounded-lg border border-border bg-muted/40">
                    <span className="text-muted-foreground block">{tr('Sales Excl. Tax', 'المبيعات بدون ضريبة')}</span>
                    <span className="font-bold font-mono">{fmt((selectedClosure as any).total_sales_excl_tax || 0)}</span>
                  </div>
                  <div className="p-2 rounded-lg border border-border bg-muted/40">
                    <span className="text-muted-foreground block">{tr('Taxed Items Qty', 'كمية الأصناف الخاضعة للضريبة')}</span>
                    <span className="font-bold font-mono">{(selectedClosure as any).total_tax_quantity || 0}</span>
                  </div>
                  <div className="p-2 rounded-lg border border-border bg-muted/40">
                    <span className="text-muted-foreground block">{tr('Total Tax Collected', 'إجمالي الضريبة المحصلة')}</span>
                    <span className="font-bold font-mono">{fmt((selectedClosure as any).total_tax_amount || 0)}</span>
                  </div>
                </div>

                {Array.isArray((selectedClosure as any).sold_items_breakdown) && (selectedClosure as any).sold_items_breakdown.length > 0 ? (
                  <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="max-h-56 overflow-y-auto divide-y divide-border text-xs">
                      {((selectedClosure as any).sold_items_breakdown as any[]).map((item, idx) => (
                        <div key={idx} className="p-2 flex items-center justify-between">
                          <div>
                            <span className="font-bold">{item.product_name}</span>
                            {item.variant_name && <span className="text-muted-foreground ms-1">({item.variant_name})</span>}
                            <div className="text-[11px] text-muted-foreground">
                              {tr('Unit Pre-tax', 'سعر الوحدة بدون ضريبة')}: {fmt(item.unit_price_excl_tax)}
                            </div>
                          </div>
                          <div className="text-end font-mono">
                            <span className="px-1.5 py-0.5 rounded bg-muted text-[11px] font-bold me-2">x{item.bulk_qty}</span>
                            <span className="font-bold">{fmt(item.total_excl_tax)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    {tr('No sold items records captured for this closure.', 'لا توجد أصناف مباعة مسجلة لهذه الوردية.')}
                  </p>
                )}
              </TabsContent>

              <TabsContent value="breakdowns" className="space-y-3">
                {Array.isArray((selectedClosure as any).payment_methods_detailed) && (selectedClosure as any).payment_methods_detailed.length > 0 && (
                  <div className="space-y-1.5 text-xs">
                    <span className="font-bold text-muted-foreground block">{tr('Payment Methods', 'طرق الدفع')}</span>
                    <div className="grid grid-cols-2 gap-2">
                      {((selectedClosure as any).payment_methods_detailed as any[]).map((pm, idx) => (
                        <div key={idx} className="p-2 rounded-lg border border-border bg-card flex justify-between items-center">
                          <span>{isAr ? pm.label_ar : pm.label_en} ({pm.transactions_count})</span>
                          <strong className="font-mono">{fmt(pm.total_amount)}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {Array.isArray((selectedClosure as any).cash_movements_detailed) && (selectedClosure as any).cash_movements_detailed.length > 0 && (
                  <div className="space-y-1.5 text-xs pt-2 border-t">
                    <span className="font-bold text-muted-foreground block">{tr('Cash Movements & Expenses', 'حركات الدرج والمصروفات')}</span>
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {((selectedClosure as any).cash_movements_detailed as any[]).map((mov, idx) => (
                        <div key={idx} className="p-2 rounded-lg border border-border bg-card flex justify-between items-center">
                          <div>
                            <span className="font-bold">{isAr ? mov.label_ar : mov.label_en}</span>
                            {mov.reason && <span className="text-muted-foreground ms-1 text-[11px]">({mov.reason})</span>}
                          </div>
                          <span className={`font-mono font-bold ${mov.direction === 'in' ? 'text-green-600' : 'text-amber-600'}`}>
                            {mov.direction === 'in' ? '+' : '-'}{fmt(mov.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>
            </Tabs>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button
                onClick={() => printCenteredZReportSlip(selectedClosure, isAr ? 'ar' : 'en', selectedClosure.closure_type || 'full_day_close')}
                className="bg-brand text-white font-bold"
              >
                <Printer size={16} className="me-1.5" />
                {tr('Print Centered Slip', 'طباعة الإيصال الموسط')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Reusable Shift Close Wizard Modal */}
      <ShiftCloseModal model={shift} mode={closeModalMode} onModeChange={setCloseModalMode} />
    </div>
  );
}
