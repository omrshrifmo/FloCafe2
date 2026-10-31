'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useFormatDate } from '@/hooks/useFormatDate';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import toast from 'react-hot-toast';
import { useTranslations } from 'use-intl';
import {
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  Download,
  Calendar,
  Filter,
  Receipt,
  Building,
  CreditCard,
  Search,
  X,
  FileSpreadsheet,
} from 'lucide-react';

interface FinanceSummary {
  income: number;
  expenses: number;
  purchases: number;
  salaries: number;
  owner_draw: number;
  net_profit: number;
}

interface FinanceTransaction {
  id: number;
  type: string;
  category: string;
  amount: number;
  tax_amount: number;
  payment_method: string;
  reference_no: string | null;
  description: string | null;
  actor_name: string | null;
  created_at: string;
}

export default function FinancePage() {
  const t = useTranslations('finance');
  const tCommon = useTranslations('common');
  const { currentTenant } = useAuthStore();
  const fmtCurrency = useFormatCurrency();
  const { formatDate } = useFormatDate();

  const [summary, setSummary] = useState<FinanceSummary>({
    income: 0,
    expenses: 0,
    purchases: 0,
    salaries: 0,
    owner_draw: 0,
    net_profit: 0,
  });
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [categories, setCategories] = useState<{ category: string; total: number; count: number }[]>([]);
  
  // Filters
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // New Transaction Modal
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    type: 'expense',
    category: 'Operations',
    amount: '',
    tax_amount: '0',
    payment_method: 'cash',
    reference_no: '',
    description: '',
  });

  const loadData = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      if (typeFilter !== 'all') params.type = typeFilter;

      const [summaryRes, txRes, catRes] = await Promise.all([
        api.get('/finance/summary', { params }),
        api.get('/finance/transactions', { params: { ...params, limit: '100' } }),
        api.get('/finance/categories', { params }),
      ]);

      setSummary(summaryRes.data || {
        income: 0,
        expenses: 0,
        purchases: 0,
        salaries: 0,
        owner_draw: 0,
        net_profit: 0,
      });
      setTransactions(txRes.data?.transactions || []);
      setCategories(catRes.data?.categories || []);
    } catch {
      toast.error(t('loadError'));
    }
  }, [startDate, endDate, typeFilter, t]);

  useEffect(() => {
    let active = true;
    const params: Record<string, string> = {};
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    if (typeFilter !== 'all') params.type = typeFilter;

    Promise.all([
      api.get('/finance/summary', { params }),
      api.get('/finance/transactions', { params: { ...params, limit: '100' } }),
      api.get('/finance/categories', { params }),
    ])
      .then(([summaryRes, txRes, catRes]) => {
        if (!active) return;
        setSummary(summaryRes.data || {
          income: 0,
          expenses: 0,
          purchases: 0,
          salaries: 0,
          owner_draw: 0,
          net_profit: 0,
        });
        setTransactions(txRes.data?.transactions || []);
        setCategories(catRes.data?.categories || []);
      })
      .catch(() => {
        if (active) toast.error(t('loadError'));
      });
    return () => {
      active = false;
    };
  }, [startDate, endDate, typeFilter, t]);

  const handleCreateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.amount || Number(formData.amount) <= 0) {
      toast.error(t('formAmount'));
      return;
    }

    try {
      setSubmitting(true);
      await api.post('/finance/transactions', {
        type: formData.type,
        category: formData.category,
        amount: Number(formData.amount),
        tax_amount: Number(formData.tax_amount || 0),
        payment_method: formData.payment_method,
        reference_no: formData.reference_no || null,
        description: formData.description || null,
      });
      toast.success(t('recordSuccess'));
      setShowModal(false);
      setFormData({
        type: 'expense',
        category: 'Operations',
        amount: '',
        tax_amount: '0',
        payment_method: 'cash',
        reference_no: '',
        description: '',
      });
      void loadData();
    } catch {
      toast.error(t('recordError'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleExportCsv = async () => {
    try {
      const res = await api.get('/finance/export', {
        params: { start_date: startDate || undefined, end_date: endDate || undefined },
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `financial_ledger_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success(t('recordSuccess'));
    } catch {
      toast.error(t('recordError'));
    }
  };

  const filteredTransactions = transactions.filter((tx) => {
    if (!search) return true;
    const query = search.toLowerCase();
    return (
      tx.category.toLowerCase().includes(query) ||
      (tx.description && tx.description.toLowerCase().includes(query)) ||
      (tx.reference_no && tx.reference_no.toLowerCase().includes(query)) ||
      (tx.actor_name && tx.actor_name.toLowerCase().includes(query))
    );
  });

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Wallet className="h-7 w-7 text-brand" />
            {t('title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCsv} className="gap-1.5">
            <Download className="h-4 w-4" />
            CSV
          </Button>
          <Button onClick={() => setShowModal(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            {t('btnNewTransaction')}
          </Button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card p-5 rounded-2xl border border-border shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('kpiTotalIncome')}</span>
            <div className="p-2 bg-emerald-500/10 text-emerald-600 rounded-xl">
              <ArrowUpRight className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 text-2xl font-bold text-foreground">
            {fmtCurrency(summary.income)}
          </div>
          <span className="text-xs text-muted-foreground mt-1 inline-block">{t('tabIncome')}</span>
        </div>

        <div className="bg-card p-5 rounded-2xl border border-border shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('kpiOperatingExpenses')}</span>
            <div className="p-2 bg-rose-500/10 text-rose-600 rounded-xl">
              <ArrowDownRight className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 text-2xl font-bold text-foreground">
            {fmtCurrency(summary.expenses)}
          </div>
          <span className="text-xs text-muted-foreground mt-1 inline-block">{t('tabExpense')}</span>
        </div>

        <div className="bg-card p-5 rounded-2xl border border-border shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('kpiPurchases')}</span>
            <div className="p-2 bg-amber-500/10 text-amber-600 rounded-xl">
              <Receipt className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 text-2xl font-bold text-foreground">
            {fmtCurrency(summary.purchases)}
          </div>
          <span className="text-xs text-muted-foreground mt-1 inline-block">{t('tabPurchases')}</span>
        </div>

        <div className="bg-card p-5 rounded-2xl border border-border shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('kpiNetProfit')}</span>
            <div className={`p-2 rounded-xl ${summary.net_profit >= 0 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'}`}>
              <Building className="h-5 w-5" />
            </div>
          </div>
          <div className={`mt-3 text-2xl font-bold ${summary.net_profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {fmtCurrency(summary.net_profit)}
          </div>
          <span className="text-xs text-muted-foreground mt-1 inline-block">{t('kpiNetProfit')}</span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-card p-4 rounded-xl border border-border">
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="w-full ps-9 pe-4 py-2 bg-background border border-border rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-brand"
            />
          </div>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-brand"
          >
            <option value="all">{t('tabAll')}</option>
            <option value="expense">{t('tabExpense')}</option>
            <option value="purchase">{t('tabPurchases')}</option>
            <option value="salary">{t('tabSalaries')}</option>
            <option value="owner_draw">{t('tabOwnerDraw')}</option>
            <option value="income">{t('tabIncome')}</option>
          </select>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>{t('colDate')}</span>
          </div>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-2.5 py-1.5 bg-background border border-border rounded-lg text-xs"
          />
          <span className="text-xs text-muted-foreground">-</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-2.5 py-1.5 bg-background border border-border rounded-lg text-xs"
          />
        </div>
      </div>

      {/* Categories Breakdown & Transactions Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Categories Breakdown */}
        <div className="bg-card p-5 rounded-2xl border border-border space-y-4">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Filter className="h-4 w-4 text-brand" />
            {t('formCategory')}
          </h2>

          <div className="space-y-3">
            {categories.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">{t('noTransactions')}</p>
            ) : (
              categories.map((cat, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-muted/50 border border-border/50">
                  <div>
                    <span className="text-sm font-medium text-foreground block">{cat.category}</span>
                    <span className="text-xs text-muted-foreground">{cat.count}</span>
                  </div>
                  <div className="text-end">
                    <span className="text-sm font-semibold text-foreground">{fmtCurrency(cat.total)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Transactions Table */}
        <div className="lg:col-span-2 bg-card rounded-2xl border border-border overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">{t('title')}</h2>
            <span className="text-xs text-muted-foreground">{filteredTransactions.length}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground uppercase border-b border-border">
                <tr>
                  <th className="py-3 px-4 text-start font-medium">{t('colDate')}</th>
                  <th className="py-3 px-4 text-start font-medium">{t('colType')}</th>
                  <th className="py-3 px-4 text-start font-medium">{t('colCategory')} / {t('colDescription')}</th>
                  <th className="py-3 px-4 text-start font-medium">{t('colMethod')}</th>
                  <th className="py-3 px-4 text-end font-medium">{t('colAmount')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-muted-foreground">
                      {t('noTransactions')}
                    </td>
                  </tr>
                ) : (
                  filteredTransactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3.5 px-4 text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(tx.created_at)}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <Badge
                          variant="secondary"
                          className={
                            tx.type === 'income'
                              ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                              : tx.type === 'purchase'
                              ? 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                              : 'bg-rose-500/10 text-rose-600 border-rose-500/20'
                          }
                        >
                          {tx.type}
                        </Badge>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-foreground">{tx.category}</div>
                        {tx.description && <div className="text-xs text-muted-foreground truncate max-w-xs">{tx.description}</div>}
                        {tx.reference_no && <div className="text-xs text-muted-foreground font-mono">Ref: {tx.reference_no}</div>}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-muted-foreground capitalize">
                        {tx.payment_method}
                      </td>
                      <td className={`py-3.5 px-4 text-end font-semibold whitespace-nowrap ${
                        tx.type === 'income' ? 'text-emerald-600' : 'text-foreground'
                      }`}>
                        {tx.type === 'income' ? '+' : '-'}{fmtCurrency(tx.amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* New Transaction Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h3 className="text-lg font-bold text-foreground">{t('modalRecordTitle')}</h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateTransaction} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">{t('formType')}</label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                  >
                    <option value="expense">{t('tabExpense')}</option>
                    <option value="purchase">{t('tabPurchases')}</option>
                    <option value="salary">{t('tabSalaries')}</option>
                    <option value="owner_draw">{t('tabOwnerDraw')}</option>
                    <option value="income">{t('tabIncome')}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">{t('formCategory')}</label>
                  <input
                    type="text"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    placeholder="Operations"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">{t('formAmount')}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    placeholder="0.00"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">{tCommon('tax')}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.tax_amount}
                    onChange={(e) => setFormData({ ...formData, tax_amount: e.target.value })}
                    placeholder="0.00"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">{t('formPaymentMethod')}</label>
                  <select
                    value={formData.payment_method}
                    onChange={(e) => setFormData({ ...formData, payment_method: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                  >
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="check">Check</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">{t('formReferenceNo')}</label>
                  <input
                    type="text"
                    value={formData.reference_no}
                    onChange={(e) => setFormData({ ...formData, reference_no: e.target.value })}
                    placeholder="INV-2026-001"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">{t('formDescription')}</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder={t('formDescription')}
                  rows={2}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-border">
                <Button type="button" variant="outline" onClick={() => setShowModal(false)}>
                  {t('btnCancel')}
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? t('saving') : t('btnSaveTransaction')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
