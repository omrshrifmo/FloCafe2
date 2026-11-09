'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useFormatDate } from '@/hooks/useFormatDate';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import toast from 'react-hot-toast';
import { useTranslations } from 'use-intl';
import { useAppLanguage } from '@/lib/i18n/bilingual';
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
  Search,
  X,
  TrendingUp,
  Trash2,
  DollarSign,
  Truck,
  CheckCircle2,
  Layers,
  Package,
  ShieldAlert,
  ArrowDownCircle,
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

interface PnlData {
  gross_sales: number;
  discounts: number;
  refunds: number;
  net_revenue: number;
  direct_cogs: number;
  expected_materials_cost?: number;
  standalone_bom_profit?: number;
  standalone_bom_margin_pct?: number;
  full_net_profit?: number;
  expected_materials_used_summary?: Array<{
    material_name: string;
    unit: string;
    total_quantity: number;
    total_cost: number;
    cost_source: string;
  }>;
  authorized_waste_cost?: number;
  barista_calibration_cost?: number;
  staff_meals_cost?: number;
  unexplained_shrinkage_cost?: number;
  gross_profit: number;
  gross_margin_pct: number;
  direct_operating_expenses: number;
  indirect_operating_expenses: number;
  total_operating_expenses: number;
  expense_breakdown: Record<string, number>;
  payroll_expense: number;
  gross_aggregator_revenue?: number;
  aggregator_commissions?: number;
  aggregator_commissions_cost?: number;
  net_aggregator_receivable?: number;
  aggregator_receivables_total?: number;
  net_operating_profit_ebitda: number;
  ebitda_margin_pct: number;
}

interface CashMovement {
  id: string;
  session_id: string | null;
  movement_type: string;
  amount: number;
  payment_method: string;
  reference_id: string | null;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
}

interface OperatingExpense {
  id: string;
  business_date: string;
  category: string;
  cost_type: 'direct' | 'indirect';
  title: string;
  amount: number;
  payment_method: string;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
}

export default function FinancePage() {
  const t = useTranslations('finance');
  const tCommon = useTranslations('common');
  const { isAr, tr, dir } = useAppLanguage();
  const fmtCurrency = useFormatCurrency();
  const { formatDate } = useFormatDate();

  // Navigation tab
  const [activeTab, setActiveTab] = useState<'overview' | 'pnl' | 'movements' | 'expenses' | 'courier' | 'multibranch' | 'safe_vault' | 'anti_theft'>('overview');
  const [pnlMode, setPnlMode] = useState<'full_erp' | 'standalone_bom'>('full_erp');

  // Safe Vault State
  const [safeVaultData, setSafeVaultData] = useState<{
    current_balance: number;
    drops_today: number;
    payouts_today: number;
    ledger: Array<{
      id: string | number;
      entry_type: string;
      category: string;
      amount: number;
      running_balance: number;
      reference_no: string | null;
      notes: string | null;
      actor_name: string | null;
      created_at: string;
    }>;
  }>({ current_balance: 0, drops_today: 0, payouts_today: 0, ledger: [] });
  const [loadingSafeVault, setLoadingSafeVault] = useState(false);
  const [showSafeTxModal, setShowSafeTxModal] = useState(false);
  const [safeTxForm, setSafeTxForm] = useState({
    type: 'deposit' as 'deposit' | 'withdrawal' | 'bank_transfer' | 'supplier_payout',
    amount: '',
    category: 'General',
    reference_no: '',
    notes: '',
  });

  // Anti-Theft Summary State
  const [antiTheftData, setAntiTheftData] = useState<{
    total_anomalies: number;
    overall_risk_score: number;
    post_print_deletions: number;
    no_sale_drawer_opens: number;
    excessive_discounts: number;
    pre_blind_shortages: number;
    downward_overrides: number;
    cashier_rankings: Array<{
      cashier_id: string;
      cashier_name: string;
      risk_score: number;
      anomaly_count: number;
    }>;
    recent_anomalies: Array<{
      id: string | number;
      event_type: string;
      severity: string;
      risk_points: number;
      cashier_name: string | null;
      order_number: string | null;
      details: string | null;
      created_at: string;
    }>;
  }>({
    total_anomalies: 0,
    overall_risk_score: 0,
    post_print_deletions: 0,
    no_sale_drawer_opens: 0,
    excessive_discounts: 0,
    pre_blind_shortages: 0,
    downward_overrides: 0,
    cashier_rankings: [],
    recent_anomalies: [],
  });
  const [loadingAntiTheft, setLoadingAntiTheft] = useState(false);

  const loadSafeVault = useCallback(async () => {
    setLoadingSafeVault(true);
    try {
      const res = await api.get('/finance/safe-vault');
      setSafeVaultData(res.data);
    } catch (err) {
      console.error('Failed to load safe vault', err);
    } finally {
      setLoadingSafeVault(false);
    }
  }, []);

  const loadAntiTheft = useCallback(async () => {
    setLoadingAntiTheft(true);
    try {
      const res = await api.get('/finance/anti-theft/summary');
      setAntiTheftData(res.data);
    } catch (err) {
      console.error('Failed to load anti theft summary', err);
    } finally {
      setLoadingAntiTheft(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'safe_vault') void loadSafeVault();
    if (activeTab === 'anti_theft') void loadAntiTheft();
  }, [activeTab, loadSafeVault, loadAntiTheft]);

  interface MultiBranchEodLog {
    id: string;
    closure_id: string;
    branch_name: string;
    branch_code: string;
    business_date: string;
    z_report_number: string;
    gross_sales: number;
    net_sales: number;
    cash_collected: number;
    card_collected: number;
    cash_variance: number;
    gdrive_status: string;
    synced_at: string;
    z_report_json?: unknown;
    pnl_summary_json?: unknown;
  }
  interface MultiBranchSummary {
    branches_count?: number;
    total_syncs?: number;
    total_revenue?: number;
    total_direct_cogs?: number;
    total_waste?: number;
    total_net_profit?: number;
  }
  const [multibranchLogs, setMultibranchLogs] = useState<MultiBranchEodLog[]>([]);
  const [multibranchSummary, setMultibranchSummary] = useState<MultiBranchSummary | null>(null);
  const [loadingMultibranch, setLoadingMultibranch] = useState(false);
  const [syncingEod, setSyncingEod] = useState(false);

  const loadMultibranchEod = useCallback(async () => {
    try {
      setLoadingMultibranch(true);
      const res = await api.get('/finance/multibranch-eod');
      setMultibranchLogs(res.data?.logs || []);
      setMultibranchSummary(res.data?.summary || null);
    } catch {
      toast.error('Failed to load multi-branch EOD sync logs');
    } finally {
      setLoadingMultibranch(false);
    }
  }, []);

  const handleTriggerEodSync = async () => {
    try {
      setSyncingEod(true);
      const res = await api.post('/finance/multibranch-eod/trigger');
      toast.success(res.data?.message || 'EOD sync bundle created and queued for cloud upload!');
      void loadMultibranchEod();
    } catch (err: unknown) {
      const errorMsg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to trigger EOD sync';
      toast.error(errorMsg);
    } finally {
      setSyncingEod(false);
    }
  };

  interface CourierUnsettledOrder {
    id: string;
    order_number: string;
    total: number;
    created_at: string;
    courier_staff_id: string | null;
    courier_name: string | null;
    delivery_channel_name: string | null;
  }
  const [unsettledOrders, setUnsettledOrders] = useState<CourierUnsettledOrder[]>([]);
  const [loadingCourier, setLoadingCourier] = useState(false);
  const [settlingCourier, setSettlingCourier] = useState(false);

  const loadUnsettledOrders = useCallback(async () => {
    try {
      setLoadingCourier(true);
      const res = await api.get('/orders/courier-unsettled');
      setUnsettledOrders(res.data?.unsettled_orders || []);
    } catch {
      toast.error('Failed to load unsettled courier orders');
    } finally {
      setLoadingCourier(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'courier') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadUnsettledOrders();
    }
    if (activeTab === 'multibranch') {
      void loadMultibranchEod();
    }
  }, [activeTab, loadUnsettledOrders, loadMultibranchEod]);

  const handleSettleCourier = async (courierStaffId?: string | null, orderIds?: string[]) => {
    try {
      setSettlingCourier(true);
      let activeShiftId: number | null = null;
      try {
        const sessionRes = await api.get('/cash-sessions/active');
        activeShiftId = sessionRes.data?.id ?? null;
      } catch {}

      const res = await api.post('/orders/courier-settle', {
        courier_staff_id: courierStaffId || undefined,
        order_ids: orderIds,
        shift_id: activeShiftId,
      });
      toast.success(res.data?.message || 'Driver cash successfully settled into drawer!');
      void loadUnsettledOrders();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg || 'Failed to settle courier cash');
    } finally {
      setSettlingCourier(false);
    }
  };

  // Overview / Transactions state
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
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Transaction Modal
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

  // P&L State
  const [pnlData, setPnlData] = useState<PnlData | null>(null);
  const [loadingPnl, setLoadingPnl] = useState(false);
  const [pnlStartDate, setPnlStartDate] = useState('');
  const [pnlEndDate, setPnlEndDate] = useState('');

  // Cash Movements State
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);
  const [loadingMovements, setLoadingMovements] = useState(false);
  const [showMovementModal, setShowMovementModal] = useState(false);
  const [movementForm, setMovementForm] = useState({
    movement_type: 'petty_expense',
    amount: '',
    payment_method: 'cash',
    notes: '',
  });

  // Operating Expenses State
  const [expenses, setExpenses] = useState<OperatingExpense[]>([]);
  const [loadingExpenses, setLoadingExpenses] = useState(false);
  const [expenseFilterCategory, setExpenseFilterCategory] = useState('all');
  const [expenseFilterCostType, setExpenseFilterCostType] = useState('all');
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    category: 'Store Supplies & Ice',
    cost_type: 'direct' as 'direct' | 'indirect',
    title: '',
    amount: '',
    payment_method: 'cash',
    notes: '',
  });

  // Load Overview Data
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, [loadData]);

  // Load P&L
  const loadPnl = useCallback(async () => {
    setLoadingPnl(true);
    try {
      const params: Record<string, string> = {};
      if (pnlStartDate) params.start_date = pnlStartDate;
      if (pnlEndDate) params.end_date = pnlEndDate;
      const res = await api.get('/finance/pnl', { params });
      setPnlData(res.data?.pnl || null);
    } catch {
      toast.error('Failed to load Income Statement');
    } finally {
      setLoadingPnl(false);
    }
  }, [pnlStartDate, pnlEndDate]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeTab === 'pnl') void loadPnl();
  }, [activeTab, loadPnl]);

  // Load Cash Movements
  const loadCashMovements = useCallback(async () => {
    setLoadingMovements(true);
    try {
      const res = await api.get('/finance/cash-movements');
      setCashMovements(res.data?.cash_movements || []);
    } catch {
      toast.error('Failed to load cash movements');
    } finally {
      setLoadingMovements(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeTab === 'movements') void loadCashMovements();
  }, [activeTab, loadCashMovements]);

  // Load Operating Expenses
  const loadOperatingExpenses = useCallback(async () => {
    setLoadingExpenses(true);
    try {
      const params: Record<string, string> = {};
      if (expenseFilterCategory !== 'all') params.category = expenseFilterCategory;
      if (expenseFilterCostType !== 'all') params.cost_type = expenseFilterCostType;
      const res = await api.get('/finance/expenses', { params });
      setExpenses(res.data?.expenses || []);
    } catch {
      toast.error('Failed to load operating expenses');
    } finally {
      setLoadingExpenses(false);
    }
  }, [expenseFilterCategory, expenseFilterCostType]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeTab === 'expenses') void loadOperatingExpenses();
  }, [activeTab, loadOperatingExpenses]);

  // Handlers
  const handleCreateSafeTx = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(safeTxForm.amount);
    if (isNaN(amt) || amt <= 0) {
      toast.error(tr('Please enter a valid amount', 'يرجى إدخال مبلغ صحيح'));
      return;
    }
    try {
      await api.post('/finance/safe-vault/transaction', safeTxForm);
      toast.success(tr('Vault transaction recorded', 'تم تسجيل حركة الخزنة بنجاح'));
      setShowSafeTxModal(false);
      setSafeTxForm({ type: 'deposit', amount: '', category: 'General', reference_no: '', notes: '' });
      loadSafeVault();
    } catch {
      toast.error(tr('Failed to record vault transaction', 'فشل في تسجيل حركة الخزنة'));
    }
  };

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

  const handleCreateCashMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(movementForm.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }
    try {
      setSubmitting(true);
      await api.post('/finance/cash-movements', {
        movement_type: movementForm.movement_type,
        amount: amt,
        payment_method: movementForm.payment_method,
        notes: movementForm.notes || null,
      });
      toast.success('Cash movement recorded successfully');
      setShowMovementModal(false);
      setMovementForm({
        movement_type: 'petty_expense',
        amount: '',
        payment_method: 'cash',
        notes: '',
      });
      void loadCashMovements();
    } catch (err: unknown) {
      const errResp = err as { response?: { data?: { error?: string } } };
      toast.error(errResp.response?.data?.error || 'Failed to record movement');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(expenseForm.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }
    if (!expenseForm.title.trim()) {
      toast.error('Expense title or vendor name is required');
      return;
    }
    try {
      setSubmitting(true);
      await api.post('/finance/expenses', {
        category: expenseForm.category,
        cost_type: expenseForm.cost_type,
        title: expenseForm.title.trim(),
        amount: amt,
        payment_method: expenseForm.payment_method,
        notes: expenseForm.notes.trim() || null,
      });
      toast.success('Operating expense added');
      setShowExpenseModal(false);
      setExpenseForm({
        category: 'Store Supplies & Ice',
        cost_type: 'direct',
        title: '',
        amount: '',
        payment_method: 'cash',
        notes: '',
      });
      void loadOperatingExpenses();
    } catch (err: unknown) {
      const errResp = err as { response?: { data?: { error?: string } } };
      toast.error(errResp.response?.data?.error || 'Failed to add operating expense');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteExpense = async (id: string) => {
    if (!confirm('Are you sure you want to delete this expense?')) return;
    try {
      await api.delete(`/finance/expenses/${id}`);
      toast.success('Expense deleted');
      void loadOperatingExpenses();
    } catch (err: unknown) {
      const errResp = err as { response?: { data?: { error?: string } } };
      toast.error(errResp.response?.data?.error || 'Failed to delete expense');
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
          {activeTab === 'overview' && (
            <>
              <Button variant="outline" size="sm" onClick={handleExportCsv} className="gap-1.5">
                <Download className="h-4 w-4" />
                CSV
              </Button>
              <Button onClick={() => setShowModal(true)} className="gap-1.5">
                <Plus className="h-4 w-4" />
                {t('btnNewTransaction')}
              </Button>
            </>
          )}
          {activeTab === 'movements' && (
            <Button onClick={() => setShowMovementModal(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />
              Record Cash Movement
            </Button>
          )}
          {activeTab === 'expenses' && (
            <Button onClick={() => setShowExpenseModal(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />
              Add Operating Expense
            </Button>
          )}
        </div>
      </div>

      {/* Tabs Bar */}
      <div className="flex items-center gap-2 border-b border-border pb-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
            activeTab === 'overview'
              ? 'bg-brand text-brand-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          {tr('Overview & Ledger', 'نظرة عامة وسجل العمليات')}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('pnl')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'pnl'
              ? 'bg-brand text-brand-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          <TrendingUp className="h-4 w-4" />
          {tr('Live Income Statement (P&L)', 'قائمة الدخل والأرباح (P&L)')}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('movements')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'movements'
              ? 'bg-brand text-brand-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          <DollarSign className="h-4 w-4" />
          {tr('Cash Movements Ledger', 'سجل حركات نقدية الدرج')}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('expenses')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'expenses'
              ? 'bg-brand text-brand-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          <Receipt className="h-4 w-4" />
          {tr('Operating Expenses Manager', 'إدارة المصروفات التشغيلية')}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('courier')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'courier'
              ? 'bg-brand text-brand-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          <Truck className="h-4 w-4" />
          {tr('Courier COD Settlement', 'تسوية تحصيلات الدليفري')}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('multibranch')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'multibranch'
              ? 'bg-brand text-brand-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          <Building className="h-4 w-4" />
          {tr('Multi-Branch EOD Sync', 'مزامنة الفروع ونهاية اليوم')}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('safe_vault')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'safe_vault'
              ? 'bg-brand text-brand-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          <ArrowDownCircle className="h-4 w-4" />
          {tr('Main Safe Vault', 'الخزنة الرئيسية والتوريدات')}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('anti_theft')}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'anti_theft'
              ? 'bg-brand text-brand-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          <ShieldAlert className="h-4 w-4" />
          {tr('Anti-Theft Scorecard', 'مؤشر نزاهة الكاشير والتلاعب')}
        </button>
      </div>

      {/* TAB 1: OVERVIEW & LEDGER */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
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
        </div>
      )}

      {/* TAB 2: LIVE INCOME STATEMENT (P&L) */}
      {activeTab === 'pnl' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-card p-4 rounded-xl border border-border">
            <div>
              <h2 className="text-lg font-bold text-foreground">
                {tr('Income Statement (Profit & Loss)', 'قائمة الدخل والأرباح (P&L)')}
              </h2>
              <p className="text-xs text-muted-foreground">
                {tr('Direct COGS from recipe BOMs, operating expenses, and staff payroll', 'تكلفة خامات الوصفات، المصروفات التشغيلية، ومسير الرواتب')}
              </p>
            </div>

            {/* Mode Switcher Toggle */}
            <div className="flex items-center gap-1.5 p-1 bg-muted/60 rounded-xl border border-border">
              <button
                type="button"
                onClick={() => setPnlMode('full_erp')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  pnlMode === 'full_erp'
                    ? 'bg-brand text-white shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tr('Full ERP P&L (With Inventory, Waste & Expenses)', 'قائمة الدخل الشاملة (مع المخزون والهدر والمصروفات)')}
              </button>
              <button
                type="button"
                onClick={() => setPnlMode('standalone_bom')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  pnlMode === 'standalone_bom'
                    ? 'bg-brand text-white shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tr('Standalone BOM Expected Profit', 'الربح المتوقع للمبيعات والخامات بدون مخزون')}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="date"
                value={pnlStartDate}
                onChange={(e) => setPnlStartDate(e.target.value)}
                className="px-2.5 py-1.5 bg-background border border-border rounded-lg text-xs"
              />
              <span className="text-xs text-muted-foreground">-</span>
              <input
                type="date"
                value={pnlEndDate}
                onChange={(e) => setPnlEndDate(e.target.value)}
                className="px-2.5 py-1.5 bg-background border border-border rounded-lg text-xs"
              />
              <Button size="sm" onClick={() => void loadPnl()} disabled={loadingPnl}>
                {tr('Recalculate', 'إعادة احتساب')}
              </Button>
            </div>
          </div>

          {loadingPnl ? (
            <div className="py-16 text-center text-muted-foreground">{tr('Calculating live Income Statement...', 'جاري احتساب قائمة الدخل المباشرة...')}</div>
          ) : !pnlData ? (
            <div className="py-16 text-center text-muted-foreground">{tr('No P&L data available for selected period.', 'لا توجد بيانات متاحة للفترة المحددة.')}</div>
          ) : pnlMode === 'standalone_bom' ? (
            /* Standalone BOM View */
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 rounded-2xl bg-card border border-border space-y-1">
                  <span className="text-xs font-medium text-muted-foreground block">{tr('Net Sales Revenue', 'صافي إيرادات المبيعات')}</span>
                  <div className="text-2xl font-black text-foreground">{fmtCurrency(pnlData.net_revenue)}</div>
                  <span className="text-xs text-emerald-600 block">{tr('From paid customer orders', 'من طلبات العملاء المسددة')}</span>
                </div>
                <div className="p-4 rounded-2xl bg-card border border-border space-y-1">
                  <span className="text-xs font-medium text-muted-foreground block">{tr('Expected BOM Materials Cost', 'تكلفة الخامات المتوقعة (BOM)')}</span>
                  <div className="text-2xl font-black text-amber-600">{fmtCurrency(pnlData.expected_materials_cost ?? pnlData.direct_cogs)}</div>
                  <span className="text-xs text-muted-foreground block">{tr('Works with or without inventory', 'يعمل بوجود مخزون أو بدونه')}</span>
                </div>
                <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 space-y-1">
                  <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 block">{tr('Standalone BOM Expected Profit', 'الربح المتوقع للمبيعات والخامات')}</span>
                  <div className="text-2xl font-black text-emerald-600">
                    {fmtCurrency(pnlData.standalone_bom_profit ?? (pnlData.net_revenue - (pnlData.expected_materials_cost ?? pnlData.direct_cogs)))}
                  </div>
                  <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 block">
                    {tr('Margin: ', 'هامش الربح: ')}{(pnlData.standalone_bom_margin_pct ?? 0).toFixed(1)}%
                  </span>
                </div>
              </div>

              {/* Top Materials Used Summary Table */}
              <div className="bg-card rounded-2xl border border-border overflow-hidden">
                <div className="p-4 border-b border-border flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-foreground">
                      {tr('Top Expected Materials Used by Sold Items', 'أعلى الخامات والمواد المستهلكة بالطلبات المباعة')}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {tr('Calculated directly from product BOM recipes', 'محسوبة مباشرة من وصفات ومعايير الـ BOM')}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {(pnlData.expected_materials_used_summary || []).length} {tr('materials', 'مادة خام')}
                  </Badge>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground uppercase border-b border-border">
                      <tr>
                        <th className="py-3 px-4 text-start font-medium">{tr('Material Name', 'اسم الخامة')}</th>
                        <th className="py-3 px-4 text-center font-medium">{tr('Expected Quantity Used', 'الكمية المستهلكة المتوقعة')}</th>
                        <th className="py-3 px-4 text-center font-medium">{tr('Cost Source', 'مصدر التكلفة')}</th>
                        <th className="py-3 px-4 text-end font-medium">{tr('Total Expected Cost', 'إجمالي التكلفة المتوقعة')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(!pnlData.expected_materials_used_summary || pnlData.expected_materials_used_summary.length === 0) ? (
                        <tr>
                          <td colSpan={4} className="py-12 text-center text-muted-foreground">
                            {tr('No materials recorded for sold items in this period.', 'لا توجد خامات مسجلة للطلبات المباعة في هذه الفترة.')}
                          </td>
                        </tr>
                      ) : (
                        pnlData.expected_materials_used_summary.map((mat, idx) => (
                          <tr key={idx} className="hover:bg-muted/30 transition-colors">
                            <td className="py-3.5 px-4 font-medium text-foreground">{mat.material_name}</td>
                            <td className="py-3.5 px-4 text-center font-mono">
                              {mat.total_quantity.toFixed(2)} {mat.unit}
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <Badge variant="secondary" className="text-xs capitalize">
                                {mat.cost_source === 'manual' || mat.cost_source === 'custom' ? tr('Custom Inline', 'مخصص يدوي') : mat.cost_source}
                              </Badge>
                            </td>
                            <td className="py-3.5 px-4 text-end font-bold text-amber-600 font-mono">
                              {fmtCurrency(mat.total_cost)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            /* Full ERP P&L View */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column: Revenue & Gross Margin */}
              <div className="bg-card p-5 rounded-2xl border border-border space-y-4">
                <h3 className="text-base font-semibold text-foreground border-b border-border pb-2">
                  {tr('Trading Performance', 'أداء المبيعات والتداول')}
                </h3>
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{tr('Gross Sales', 'إجمالي المبيعات')}</span>
                    <span className="font-medium text-foreground">{fmtCurrency(pnlData.gross_sales)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{tr('Discounts Given', 'الخصومات الممنوحة')}</span>
                    <span className="text-rose-600">-{fmtCurrency(pnlData.discounts)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{tr('Customer Refunds', 'المرتجعات')}</span>
                    <span className="text-rose-600">-{fmtCurrency(pnlData.refunds)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-semibold pt-2 border-t border-border">
                    <span>{tr('Net Sales Revenue', 'صافي إيرادات المبيعات')}</span>
                    <span className="text-emerald-600">{fmtCurrency(pnlData.net_revenue)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{tr('Direct Recipe COGS (BOM Standard)', 'تكلفة خامات الوصفات المباشرة (BOM)')}</span>
                    <span className="text-amber-600">-{fmtCurrency(pnlData.direct_cogs)}</span>
                  </div>
                  {Number(pnlData.authorized_waste_cost || 0) > 0 && (
                    <div className="flex justify-between text-xs ps-3">
                      <span className="text-muted-foreground">↳ {tr('Spoilage / Expired Waste', 'الهدر المعتمد / التالف')}</span>
                      <span className="text-amber-600">-{fmtCurrency(pnlData.authorized_waste_cost || 0)}</span>
                    </div>
                  )}
                  {Number(pnlData.barista_calibration_cost || 0) > 0 && (
                    <div className="flex justify-between text-xs ps-3">
                      <span className="text-muted-foreground">↳ {tr('Morning Espresso Dial-In / Calibration', 'معايرة المطحنة الصباحية')}</span>
                      <span className="text-amber-600">-{fmtCurrency(pnlData.barista_calibration_cost || 0)}</span>
                    </div>
                  )}
                  {Number(pnlData.staff_meals_cost || 0) > 0 && (
                    <div className="flex justify-between text-xs ps-3">
                      <span className="text-muted-foreground">↳ {tr('Staff Shift Meals', 'وجبات ومشروبات الموظفين')}</span>
                      <span className="text-amber-600">-{fmtCurrency(pnlData.staff_meals_cost || 0)}</span>
                    </div>
                  )}
                  {Number(pnlData.unexplained_shrinkage_cost || 0) > 0 && (
                    <div className="flex justify-between text-xs ps-3">
                      <span className="text-rose-500 font-medium">↳ {tr('Unexplained Stocktake Shrinkage', 'عجز الجرد الفعلي للمخزون')}</span>
                      <span className="text-rose-600">-{fmtCurrency(pnlData.unexplained_shrinkage_cost || 0)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-base font-bold pt-2 border-t border-border">
                    <span>{tr('Gross Profit', 'مجمل الربح')}</span>
                    <span className={pnlData.gross_profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                      {fmtCurrency(pnlData.gross_profit)} ({pnlData.gross_margin_pct.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              </div>

              {/* Right Column: Operating Expenses & EBITDA */}
              <div className="bg-card p-5 rounded-2xl border border-border space-y-4">
                <h3 className="text-base font-semibold text-foreground border-b border-border pb-2">
                  {tr('Operating Expenses & Profitability', 'المصروفات التشغيلية وصافي الربح')}
                </h3>
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{tr('Direct Operating Expenses', 'مصروفات تشغيلية مباشرة')}</span>
                    <span className="text-foreground">{fmtCurrency(pnlData.direct_operating_expenses)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{tr('Indirect Overhead Expenses', 'مصروفات غير مباشرة وعامة')}</span>
                    <span className="text-foreground">{fmtCurrency(pnlData.indirect_operating_expenses)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{tr('HRM Staff Payroll', 'مسير رواتب الموظفين')}</span>
                    <span className="text-foreground">{fmtCurrency(pnlData.payroll_expense)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-semibold pt-2 border-t border-border">
                    <span>{tr('Total Operating Costs', 'إجمالي التكاليف التشغيلية')}</span>
                    <span className="text-rose-600">
                      -{fmtCurrency(pnlData.total_operating_expenses + pnlData.payroll_expense)}
                    </span>
                  </div>
                  <div className="flex justify-between text-lg font-extrabold pt-3 border-t border-border">
                    <span>{tr('Net Operating Profit (EBITDA)', 'صافي الربح التشغيلي (EBITDA)')}</span>
                    <span className={pnlData.net_operating_profit_ebitda >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                      {fmtCurrency(pnlData.net_operating_profit_ebitda)} ({pnlData.ebitda_margin_pct.toFixed(1)}%)
                    </span>
                  </div>
                </div>

                {/* Expense Categories Breakdown */}
                {Object.keys(pnlData.expense_breakdown || {}).length > 0 && (
                  <div className="pt-3 border-t border-border">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                      {tr('Expense Category Breakdown', 'تفصيل فئات المصروفات')}
                    </h4>
                    <div className="space-y-1.5">
                      {Object.entries(pnlData.expense_breakdown).map(([cat, amt]) => (
                        <div key={cat} className="flex justify-between text-xs">
                          <span className="text-muted-foreground capitalize">{cat.replace(/_/g, ' ')}</span>
                          <span className="font-medium text-foreground">{fmtCurrency(amt)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Aggregator & Delivery Platform Performance */}
              <div className="md:col-span-2 bg-card p-5 rounded-2xl border border-border space-y-4">
                <h3 className="text-base font-semibold text-foreground border-b border-border pb-2 flex items-center justify-between">
                  <span>{tr('Delivery Aggregators & Channels', 'تطبيقات التوصيل والمنصات الخارجية')}</span>
                  <span className="text-xs text-muted-foreground font-normal">Talabat, Elmenus, Hungerstation, Jahez, etc.</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="p-3 bg-muted/40 rounded-xl border border-border">
                    <span className="text-xs text-muted-foreground block">{tr('Gross Aggregator Sales', 'مبيعات تطبيقات التوصيل')}</span>
                    <span className="text-base font-bold text-foreground">{fmtCurrency(pnlData.gross_aggregator_revenue || 0)}</span>
                  </div>
                  <div className="p-3 bg-rose-500/10 rounded-xl border border-rose-500/20">
                    <span className="text-xs text-rose-700 dark:text-rose-300 block">{tr('Platform Commissions', 'عمولات المنصات والتطبيقات')}</span>
                    <span className="text-base font-bold text-rose-600 dark:text-rose-400">-{fmtCurrency(pnlData.aggregator_commissions || 0)}</span>
                  </div>
                  <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                    <span className="text-xs text-emerald-700 dark:text-emerald-300 block">{tr('Net Platform Receivable', 'صافي مستحقات التطبيقات')}</span>
                    <span className="text-base font-bold text-emerald-600 dark:text-emerald-400">{fmtCurrency(pnlData.net_aggregator_receivable || 0)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: CASH MOVEMENTS LEDGER */}
      {activeTab === 'movements' && (
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground">Cash Drawer Movements Ledger</h2>
              <p className="text-xs text-muted-foreground">All cash injections, petty expenses, owner withdrawals, and POS drawer settlements</p>
            </div>
            <span className="text-xs text-muted-foreground">{cashMovements.length} movements</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground uppercase border-b border-border">
                <tr>
                  <th className="py-3 px-4 text-start font-medium">Date & Time</th>
                  <th className="py-3 px-4 text-start font-medium">Movement Type</th>
                  <th className="py-3 px-4 text-start font-medium">Notes & Reference</th>
                  <th className="py-3 px-4 text-start font-medium">Staff</th>
                  <th className="py-3 px-4 text-end font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loadingMovements ? (
                  <tr><td colSpan={5} className="py-12 text-center text-muted-foreground">Loading movements...</td></tr>
                ) : cashMovements.length === 0 ? (
                  <tr><td colSpan={5} className="py-12 text-center text-muted-foreground">No cash movements recorded.</td></tr>
                ) : (
                  cashMovements.map((m) => (
                    <tr key={m.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3.5 px-4 text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(m.created_at)}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <Badge variant="outline" className="capitalize">
                          {m.movement_type.replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className="py-3.5 px-4 text-xs">
                        <div className="text-foreground">{m.notes || '—'}</div>
                        {m.reference_id && <div className="text-muted-foreground font-mono">Ref: {m.reference_id}</div>}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-muted-foreground">
                        {m.created_by_name || 'System'}
                      </td>
                      <td className="py-3.5 px-4 text-end font-semibold whitespace-nowrap">
                        {fmtCurrency(m.amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: OPERATING EXPENSES MANAGER */}
      {activeTab === 'expenses' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 bg-card p-4 rounded-xl border border-border">
            <div className="flex items-center gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Category</label>
                <select
                  value={expenseFilterCategory}
                  onChange={(e) => setExpenseFilterCategory(e.target.value)}
                  className="px-3 py-1.5 bg-background border border-border rounded-lg text-xs"
                >
                  <option value="all">{tr('All Categories', 'جميع الفئات')}</option>
                  <option value="Store Supplies & Ice">{tr('Store Supplies & Ice', 'خامات ومستلزمات وثلوج')}</option>
                  <option value="Utilities">{tr('Utilities (Electricity, Water, Gas)', 'كهرباء ومرافق')}</option>
                  <option value="Maintenance">{tr('Maintenance & Repairs', 'صيانة وإصلاحات')}</option>
                  <option value="Packaging">{tr('Packaging & Disposables', 'تعبئة وتغليف واستهلاكات')}</option>
                  <option value="Transport">{tr('Transport & Fuel', 'نقل ومواصلات')}</option>
                  <option value="Marketing">{tr('Marketing & Ads', 'تسويق وإعلانات')}</option>
                  <option value="Rent">{tr('Rent', 'إيجار')}</option>
                  <option value="Other">{tr('Other Operating Expenses', 'أخرى')}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-muted-foreground mb-1">{tr('Cost Type', 'نوع التكلفة')}</label>
                <select
                  value={expenseFilterCostType}
                  onChange={(e) => setExpenseFilterCostType(e.target.value)}
                  className="px-3 py-1.5 bg-background border border-border rounded-lg text-xs"
                >
                  <option value="all">{tr('All Cost Types', 'كافة الأنواع')}</option>
                  <option value="direct">{tr('Direct (Cost of Operations)', 'مباشر (تكلفة تشغيل)')}</option>
                  <option value="indirect">{tr('Indirect (Overhead)', 'غير مباشر (مصاريف عامة)')}</option>
                </select>
              </div>
            </div>

            <Button size="sm" onClick={() => void loadOperatingExpenses()}>
              {tr('Refresh', 'تحديث')}
            </Button>
          </div>

          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">{tr('Operating Expenses', 'المصروفات التشغيلية')}</h2>
              <span className="text-xs text-muted-foreground">{expenses.length} {tr('records', 'سجل')}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground uppercase border-b border-border">
                  <tr>
                    <th className="py-3 px-4 text-start font-medium">{tr('Business Date', 'تاريخ اليوم')}</th>
                    <th className="py-3 px-4 text-start font-medium">{tr('Title / Vendor', 'البيان / المورد')}</th>
                    <th className="py-3 px-4 text-start font-medium">{tr('Category', 'الفئة')}</th>
                    <th className="py-3 px-4 text-start font-medium">{tr('Cost Type', 'النوع')}</th>
                    <th className="py-3 px-4 text-start font-medium">{tr('Payment', 'طريقة الدفع')}</th>
                    <th className="py-3 px-4 text-end font-medium">{tr('Amount', 'المبلغ')}</th>
                    <th className="py-3 px-4 text-center font-medium">{tr('Action', 'إجراء')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loadingExpenses ? (
                    <tr><td colSpan={7} className="py-12 text-center text-muted-foreground">Loading expenses...</td></tr>
                  ) : expenses.length === 0 ? (
                    <tr><td colSpan={7} className="py-12 text-center text-muted-foreground">No operating expenses found.</td></tr>
                  ) : (
                    expenses.map((exp) => (
                      <tr key={exp.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3.5 px-4 text-xs text-muted-foreground whitespace-nowrap">
                          {exp.business_date}
                        </td>
                        <td className="py-3.5 px-4 font-medium text-foreground">
                          {exp.title}
                          {exp.notes && <div className="text-xs text-muted-foreground">{exp.notes}</div>}
                        </td>
                        <td className="py-3.5 px-4 text-xs whitespace-nowrap">
                          {exp.category}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <Badge variant={exp.cost_type === 'direct' ? 'default' : 'secondary'} className="capitalize text-xs">
                            {exp.cost_type}
                          </Badge>
                        </td>
                        <td className="py-3.5 px-4 text-xs text-muted-foreground capitalize">
                          {exp.payment_method}
                        </td>
                        <td className="py-3.5 px-4 text-end font-semibold text-rose-600 whitespace-nowrap">
                          -{fmtCurrency(exp.amount)}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleDeleteExpense(exp.id)}
                            className="text-rose-600 hover:text-rose-700 hover:bg-rose-500/10 p-1.5 h-auto"
                          >
                            <Trash2 size={14} />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: COURIER COD SETTLEMENT */}
      {activeTab === 'courier' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-card p-4 rounded-xl border border-border">
            <div>
              <h2 className="text-lg font-bold text-foreground">In-House Courier COD Cash Settlement</h2>
              <p className="text-xs text-muted-foreground">Reconcile cash-on-delivery payments from drivers directly into active POS cash drawer</p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void loadUnsettledOrders()} disabled={loadingCourier}>
                Refresh
              </Button>
              {unsettledOrders.length > 0 && (
                <Button
                  size="sm"
                  onClick={() => void handleSettleCourier(undefined, unsettledOrders.map((o) => o.id))}
                  disabled={settlingCourier}
                  className="bg-brand hover:bg-brand/90"
                >
                  <CheckCircle2 className="h-4 w-4 me-1.5" />
                  Settle All ({fmtCurrency(unsettledOrders.reduce((s, o) => s + (Number(o.total) || 0), 0))})
                </Button>
              )}
            </div>
          </div>

          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted text-muted-foreground font-semibold">
                  <tr>
                    <th className="p-3 text-start">Order #</th>
                    <th className="p-3 text-start">Courier / Driver</th>
                    <th className="p-3 text-start">Delivery Channel</th>
                    <th className="p-3 text-start">Order Date</th>
                    <th className="p-3 text-end">COD Amount</th>
                    <th className="p-3 text-end">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {unsettledOrders.map((ord) => (
                    <tr key={ord.id} className="hover:bg-muted/20">
                      <td className="p-3 font-mono font-bold text-foreground">#{ord.order_number}</td>
                      <td className="p-3 font-semibold text-foreground">{ord.courier_name || 'Driver (Unassigned)'}</td>
                      <td className="p-3 text-muted-foreground">{ord.delivery_channel_name || 'In-House'}</td>
                      <td className="p-3 text-muted-foreground">{formatDate(ord.created_at)}</td>
                      <td className="p-3 text-end font-mono font-bold text-foreground">{fmtCurrency(ord.total)}</td>
                      <td className="p-3 text-end">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void handleSettleCourier(undefined, [ord.id])}
                          disabled={settlingCourier}
                          className="h-7 text-[11px]"
                        >
                          Settle to Drawer
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {unsettledOrders.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-muted-foreground">
                        {loadingCourier ? 'Loading courier orders...' : 'All courier deliveries are fully settled!'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: MULTI-BRANCH EOD Z-REPORTS & CONSOLIDATION */}
      {activeTab === 'multibranch' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-card p-4 rounded-xl border border-border">
            <div>
              <h2 className="text-lg font-bold text-foreground">Multi-Branch EOD Z-Reports &amp; Cloud Sync</h2>
              <p className="text-xs text-muted-foreground">Consolidated cross-branch P&amp;L metrics, shift closures, and encrypted Google Drive sync bundles</p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void loadMultibranchEod()} disabled={loadingMultibranch}>
                Refresh
              </Button>
              <Button
                size="sm"
                onClick={() => void handleTriggerEodSync()}
                disabled={syncingEod}
                className="bg-brand hover:bg-brand/90"
              >
                <Download className="h-4 w-4 me-1.5" />
                {syncingEod ? 'Syncing...' : 'Sync Local EOD Bundle Now'}
              </Button>
            </div>
          </div>

          {/* Consolidated KPI Cards */}
          {multibranchSummary && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-card p-4 rounded-xl border border-border">
                <span className="text-xs text-muted-foreground block font-medium">Synced Branches</span>
                <span className="text-2xl font-bold text-foreground font-mono mt-1 block">
                  {multibranchSummary.branches_count || 1}
                </span>
                <span className="text-[11px] text-muted-foreground mt-1 block">
                  {multibranchSummary.total_syncs || multibranchLogs.length} closure bundles recorded
                </span>
              </div>
              <div className="bg-card p-4 rounded-xl border border-border">
                <span className="text-xs text-muted-foreground block font-medium">Consolidated Net Sales</span>
                <span className="text-2xl font-bold text-emerald-600 font-mono mt-1 block">
                  {fmtCurrency(multibranchSummary.total_revenue || 0)}
                </span>
                <span className="text-[11px] text-muted-foreground mt-1 block">Across all branch shifts</span>
              </div>
              <div className="bg-card p-4 rounded-xl border border-border">
                <span className="text-xs text-muted-foreground block font-medium">Total COGS &amp; Waste</span>
                <span className="text-2xl font-bold text-amber-600 font-mono mt-1 block">
                  {fmtCurrency((multibranchSummary.total_direct_cogs || 0) + (multibranchSummary.total_waste || 0))}
                </span>
                <span className="text-[11px] text-muted-foreground mt-1 block">
                  Waste: {fmtCurrency(multibranchSummary.total_waste || 0)}
                </span>
              </div>
              <div className="bg-card p-4 rounded-xl border border-border">
                <span className="text-xs text-muted-foreground block font-medium">Consolidated Net Profit</span>
                <span className={`text-2xl font-bold font-mono mt-1 block ${
                  (multibranchSummary.total_net_profit || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'
                }`}>
                  {fmtCurrency(multibranchSummary.total_net_profit || 0)}
                </span>
                <span className="text-[11px] text-muted-foreground mt-1 block">Post COGS &amp; expenses</span>
              </div>
            </div>
          )}

          {/* Sync Logs Table */}
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Branch End-of-Day (EOD) Z-Reports</h3>
                <p className="text-xs text-muted-foreground">Detailed logs of branch shift closures and GDrive sync status</p>
              </div>
              <span className="text-xs text-muted-foreground font-mono">{multibranchLogs.length} sync bundles</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted text-muted-foreground font-semibold">
                  <tr>
                    <th className="p-3 text-start">Branch</th>
                    <th className="p-3 text-start">Business Date</th>
                    <th className="p-3 text-start">Z-Report #</th>
                    <th className="p-3 text-end">Gross Sales</th>
                    <th className="p-3 text-end">Net Sales</th>
                    <th className="p-3 text-end">Cash In Drawer</th>
                    <th className="p-3 text-end">Cash Variance</th>
                    <th className="p-3 text-center">GDrive Sync</th>
                    <th className="p-3 text-end">Synced At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {multibranchLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-muted/20">
                      <td className="p-3 font-semibold text-foreground">
                        {log.branch_name || 'Main Branch'}
                        {log.branch_code && (
                          <span className="text-[10px] text-muted-foreground ms-1 font-mono">({log.branch_code})</span>
                        )}
                      </td>
                      <td className="p-3 font-mono text-muted-foreground">{log.business_date}</td>
                      <td className="p-3 font-mono font-bold text-foreground">
                        {log.z_report_number || `#${log.closure_id.slice(0, 8)}`}
                      </td>
                      <td className="p-3 text-end font-mono text-foreground">{fmtCurrency(log.gross_sales)}</td>
                      <td className="p-3 text-end font-mono font-bold text-foreground">{fmtCurrency(log.net_sales)}</td>
                      <td className="p-3 text-end font-mono text-foreground">{fmtCurrency(log.cash_collected)}</td>
                      <td className="p-3 text-end font-mono">
                        <span className={Number(log.cash_variance || 0) === 0 ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                          {Number(log.cash_variance || 0) > 0 ? `+${fmtCurrency(log.cash_variance)}` : fmtCurrency(log.cash_variance)}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <Badge
                          variant="secondary"
                          className={
                            log.gdrive_status === 'synced'
                              ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                              : 'bg-amber-500/10 text-amber-600 border-amber-500/30'
                          }
                        >
                          {log.gdrive_status === 'synced' ? '✓ Synced' : log.gdrive_status}
                        </Badge>
                      </td>
                      <td className="p-3 text-end text-muted-foreground font-mono">
                        {log.synced_at ? formatDate(log.synced_at) : 'Local only'}
                      </td>
                    </tr>
                  ))}
                  {multibranchLogs.length === 0 && (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-muted-foreground">
                        {loadingMultibranch
                          ? 'Loading multi-branch EOD sync logs...'
                          : 'No EOD sync logs recorded yet. Complete a shift closure or click "Sync Local EOD Bundle Now".'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 7: MAIN STORE SAFE VAULT & MID-SHIFT DROPS */}
      {activeTab === 'safe_vault' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-card p-4 rounded-xl border border-border">
            <div>
              <h2 className="text-lg font-bold text-foreground">
                {tr('Main Store Safe Vault & Mid-Shift Drops', 'الخزنة الرئيسية للمحل وتوريدات الورديات')}
              </h2>
              <p className="text-xs text-muted-foreground">
                {tr(
                  'Independent secure vault ledger tracking mid-shift cashier skim drops, bank transfers, and cash settlements',
                  'سجل مستقل للخزنة الرئيسية لتتبع توريدات الدرج النقدية والتحويلات البنكية والمصروفات'
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => setShowSafeTxModal(true)} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
                <Plus className="h-4 w-4" />
                {tr('Record Vault Transaction', 'تسجيل حركة بالخزنة')}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-card p-5 rounded-2xl border border-emerald-500/30 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">
                  {tr('Current Main Safe Balance', 'رصيد الخزنة الرئيسية الفعلي')}
                </span>
                <ArrowDownCircle className="h-5 w-5 text-emerald-500" />
              </div>
              <div className="text-2xl font-black text-foreground mt-2">
                {fmtCurrency(safeVaultData.current_balance)}
              </div>
            </div>

            <div className="bg-card p-5 rounded-2xl border border-blue-500/30 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider">
                  {tr('Drops Received Today', 'توريدات مستلمة اليوم')}
                </span>
                <ArrowUpRight className="h-5 w-5 text-blue-500" />
              </div>
              <div className="text-2xl font-black text-foreground mt-2">
                +{fmtCurrency(safeVaultData.drops_today)}
              </div>
            </div>

            <div className="bg-card p-5 rounded-2xl border border-amber-500/30 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-600 uppercase tracking-wider">
                  {tr('Vault Payouts Today', 'مسحوبات الخزنة اليوم')}
                </span>
                <ArrowDownRight className="h-5 w-5 text-amber-500" />
              </div>
              <div className="text-2xl font-black text-foreground mt-2">
                -{fmtCurrency(safeVaultData.payouts_today)}
              </div>
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h3 className="font-bold text-sm text-foreground">
                {tr('Vault Ledger & Audit Trail', 'سجل حركات الخزنة الرئيسية')}
              </h3>
              <Button variant="outline" size="sm" onClick={loadSafeVault} disabled={loadingSafeVault}>
                {loadingSafeVault ? tr('Refreshing...', 'جاري التحديث...') : tr('Refresh', 'تحديث')}
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/50 border-b border-border text-muted-foreground uppercase text-[10px]">
                  <tr>
                    <th className="p-3">{tr('Date / Time', 'التاريخ والوقت')}</th>
                    <th className="p-3">{tr('Entry Type', 'نوع الحركة')}</th>
                    <th className="p-3">{tr('Category', 'التصنيف')}</th>
                    <th className="p-3">{tr('Amount', 'المبلغ')}</th>
                    <th className="p-3">{tr('Safe Balance', 'رصيد الخزنة')}</th>
                    <th className="p-3">{tr('Reference / Slip', 'المرجع / رقم المظروف')}</th>
                    <th className="p-3">{tr('Actor', 'المسؤول')}</th>
                    <th className="p-3">{tr('Notes', 'ملاحظات')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {safeVaultData.ledger.map((item) => {
                    const isCredit = ['drop', 'deposit', 'transfer_in'].includes(item.entry_type);
                    return (
                      <tr key={item.id} className="hover:bg-muted/30">
                        <td className="p-3 font-mono">{formatDate(item.created_at)}</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            isCredit ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'
                          }`}>
                            {item.entry_type.toUpperCase()}
                          </span>
                        </td>
                        <td className="p-3">{item.category}</td>
                        <td className={`p-3 font-bold font-mono ${isCredit ? 'text-emerald-600' : 'text-red-600'}`}>
                          {isCredit ? '+' : '-'}{fmtCurrency(Math.abs(item.amount))}
                        </td>
                        <td className="p-3 font-mono font-bold">{fmtCurrency(item.running_balance)}</td>
                        <td className="p-3 font-mono text-muted-foreground">{item.reference_no || '-'}</td>
                        <td className="p-3 text-muted-foreground">{item.actor_name || '-'}</td>
                        <td className="p-3 text-muted-foreground">{item.notes || '-'}</td>
                      </tr>
                    );
                  })}
                  {safeVaultData.ledger.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-muted-foreground">
                        {loadingSafeVault
                          ? tr('Loading safe vault ledger...', 'جاري تحميل سجل الخزنة...')
                          : tr('No vault transactions recorded yet. Drops from the POS will appear here.', 'لا توجد حركات بالخزنة بعد. توريدات نقاط البيع ستظهر هنا مباشرة.')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 8: CASHIER ANTI-THEFT & INTEGRITY AUDIT SCORECARD */}
      {activeTab === 'anti_theft' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-card p-4 rounded-xl border border-border">
            <div>
              <h2 className="text-lg font-bold text-foreground">
                {tr('Cashier Anti-Theft & Integrity Audit Scorecard', 'مؤشر نزاهة الكاشير وكاشف التلاعب والأنماط المشبوهة')}
              </h2>
              <p className="text-xs text-muted-foreground">
                {tr(
                  'Automated anomaly detector monitoring post-print deletions, unauthorized drawer opens, and suspicious discounts',
                  'نظام ذكي يرصد حذف الأصناف بعد تسليم الفاتورة المبدئية، فتح الدرج بدون بيع، والتلاعب بالأسعار والخصومات'
                )}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={loadAntiTheft} disabled={loadingAntiTheft}>
              {loadingAntiTheft ? tr('Refreshing...', 'جاري التحديث...') : tr('Refresh Scorecard', 'تحديث المؤشر')}
            </Button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-card p-4 rounded-xl border border-red-500/30 shadow-xs">
              <span className="text-[11px] font-semibold text-red-600 block uppercase">
                {tr('Overall Risk Score', 'مؤشر الخطورة الإجمالي')}
              </span>
              <div className="text-2xl font-black text-red-600 mt-1">
                {antiTheftData.overall_risk_score}
              </div>
            </div>
            <div className="bg-card p-4 rounded-xl border border-border shadow-xs">
              <span className="text-[11px] font-semibold text-muted-foreground block uppercase">
                {tr('Total Anomalies', 'إجمالي الأنماط المشبوهة')}
              </span>
              <div className="text-2xl font-black text-foreground mt-1">
                {antiTheftData.total_anomalies}
              </div>
            </div>
            <div className="bg-card p-4 rounded-xl border border-amber-500/30 shadow-xs">
              <span className="text-[11px] font-semibold text-amber-600 block uppercase">
                {tr('Post-Print Deletions', 'حذف بعد المبدئية')}
              </span>
              <div className="text-2xl font-black text-amber-600 mt-1">
                {antiTheftData.post_print_deletions}
              </div>
            </div>
            <div className="bg-card p-4 rounded-xl border border-border shadow-xs">
              <span className="text-[11px] font-semibold text-muted-foreground block uppercase">
                {tr('No-Sale Drawer Opens', 'فتح الدرج بدون بيع')}
              </span>
              <div className="text-2xl font-black text-foreground mt-1">
                {antiTheftData.no_sale_drawer_opens}
              </div>
            </div>
            <div className="bg-card p-4 rounded-xl border border-border shadow-xs">
              <span className="text-[11px] font-semibold text-muted-foreground block uppercase">
                {tr('Excessive Discounts', 'خصومات مرتفعة >= 20%')}
              </span>
              <div className="text-2xl font-black text-foreground mt-1">
                {antiTheftData.excessive_discounts}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Cashier Ranking Table */}
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="p-4 border-b border-border">
                <h3 className="font-bold text-sm text-foreground">
                  {tr('Cashier Risk Rankings', 'تصنيف الكاشير حسب مؤشر الخطورة')}
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/50 border-b border-border text-muted-foreground uppercase text-[10px]">
                    <tr>
                      <th className="p-3">{tr('Cashier', 'الكاشير')}</th>
                      <th className="p-3">{tr('Anomalies', 'الأنماط')}</th>
                      <th className="p-3">{tr('Risk Score', 'نقاط الخطورة')}</th>
                      <th className="p-3">{tr('Status', 'الحالة')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {antiTheftData.cashier_rankings.map((c) => {
                      const isHigh = c.risk_score >= 50;
                      const isMed = c.risk_score >= 20 && c.risk_score < 50;
                      return (
                        <tr key={c.cashier_id} className="hover:bg-muted/30">
                          <td className="p-3 font-semibold">{c.cashier_name}</td>
                          <td className="p-3 font-mono">{c.anomaly_count}</td>
                          <td className="p-3 font-mono font-bold">{c.risk_score}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              isHigh ? 'bg-red-500/10 text-red-600' : isMed ? 'bg-amber-500/10 text-amber-600' : 'bg-emerald-500/10 text-emerald-600'
                            }`}>
                              {isHigh ? tr('High Risk', 'خطر مرتفع') : isMed ? tr('Moderate', 'متوسط') : tr('Clean', 'سليم')}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {antiTheftData.cashier_rankings.length === 0 && (
                      <tr>
                        <td colSpan={4} className="p-6 text-center text-muted-foreground">
                          {tr('No cashier anomalies recorded.', 'لا توجد أنماط خطورة مسجلة لأي كاشير.')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Recent Anomaly Logs */}
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="p-4 border-b border-border">
                <h3 className="font-bold text-sm text-foreground">
                  {tr('Recent Suspicious Events', 'أحدث الأنماط المشبوهة المرصودة')}
                </h3>
              </div>
              <div className="max-h-96 overflow-y-auto divide-y divide-border">
                {antiTheftData.recent_anomalies.map((a) => (
                  <div key={a.id} className="p-3 text-xs space-y-1 hover:bg-muted/30">
                    <div className="flex items-center justify-between">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        a.severity === 'critical' ? 'bg-red-500/10 text-red-600' : 'bg-amber-500/10 text-amber-600'
                      }`}>
                        {a.severity.toUpperCase()} (+{a.risk_points} pts)
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {formatDate(a.created_at)}
                      </span>
                    </div>
                    <div className="font-semibold text-foreground">
                      {a.event_type} {a.order_number ? `• Order #${a.order_number}` : ''}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {tr('Cashier', 'الكاشير')}: <strong>{a.cashier_name || 'Staff'}</strong>
                      {a.details ? ` | ${a.details}` : ''}
                    </div>
                  </div>
                ))}
                {antiTheftData.recent_anomalies.length === 0 && (
                  <div className="p-8 text-center text-muted-foreground text-xs">
                    {tr('Zero suspicious anomalies detected. Clean operational record!', 'لم يتم رصد أي تلاعب أو عمليات مشبوهة. سجل العمليات نظيف تماماً!')}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: New Transaction (General Ledger) */}
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

      {/* MODAL 2: Record Cash Movement */}
      {showMovementModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h3 className="text-lg font-bold text-foreground">Record Cash Movement</h3>
              <button
                type="button"
                onClick={() => setShowMovementModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCashMovement} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Movement Type</label>
                <select
                  value={movementForm.movement_type}
                  onChange={(e) => setMovementForm({ ...movementForm, movement_type: e.target.value })}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                >
                  <option value="petty_expense">Petty Expense (Out)</option>
                  <option value="capital_injection">Capital Injection (In)</option>
                  <option value="owner_draw">Owner Withdrawal (Out)</option>
                  <option value="bank_deposit">Bank Deposit (Out)</option>
                  <option value="bank_withdrawal">Bank Withdrawal (In)</option>
                  <option value="supplier_payment">Supplier Payment (Out)</option>
                  <option value="other">Other Movement</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={movementForm.amount}
                  onChange={(e) => setMovementForm({ ...movementForm, amount: e.target.value })}
                  placeholder="0.00"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Payment Method</label>
                <select
                  value={movementForm.payment_method}
                  onChange={(e) => setMovementForm({ ...movementForm, payment_method: e.target.value })}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                >
                  <option value="cash">Cash (Active Drawer)</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="card">Card / POS Terminal</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Notes / Description</label>
                <textarea
                  value={movementForm.notes}
                  onChange={(e) => setMovementForm({ ...movementForm, notes: e.target.value })}
                  placeholder="Reason for cash movement"
                  rows={2}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-border">
                <Button type="button" variant="outline" onClick={() => setShowMovementModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Saving...' : 'Record Movement'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Add Operating Expense */}
      {showExpenseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h3 className="text-lg font-bold text-foreground">Add Operating Expense</h3>
              <button
                type="button"
                onClick={() => setShowExpenseModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateExpense} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">{tr('Category', 'فئة المصروف')}</label>
                  <select
                    value={expenseForm.category}
                    onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                  >
                    <option value="Store Supplies & Ice">{tr('Store Supplies & Ice', 'خامات ومستلزمات وثلوج')}</option>
                    <option value="Utilities">{tr('Utilities', 'كهرباء ومرافق')}</option>
                    <option value="Maintenance">{tr('Maintenance', 'صيانة وإصلاحات')}</option>
                    <option value="Packaging">{tr('Packaging', 'تعبئة وتغليف واستهلاكات')}</option>
                    <option value="Transport">{tr('Transport', 'نقل ومواصلات')}</option>
                    <option value="Marketing">{tr('Marketing', 'تسويق وإعلانات')}</option>
                    <option value="Rent">{tr('Rent', 'إيجار')}</option>
                    <option value="Licenses">{tr('Licenses & Permits', 'تراخيص ورسوم حكومية')}</option>
                    <option value="Other">{tr('Other Operating Expense', 'مصروفات تشغيلية أخرى')}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">{tr('Cost Type', 'نوع التكلفة')}</label>
                  <select
                    value={expenseForm.cost_type}
                    onChange={(e) => setExpenseForm({ ...expenseForm, cost_type: e.target.value as 'direct' | 'indirect' })}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                  >
                    <option value="direct">{tr('Direct (Cost of Operations)', 'مباشر (تكلفة تشغيل)')}</option>
                    <option value="indirect">{tr('Indirect (Overhead)', 'غير مباشر (مصاريف عامة)')}</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">{tr('Title / Vendor *', 'البيان / المورد *')}</label>
                  <input
                    type="text"
                    value={expenseForm.title}
                    onChange={(e) => setExpenseForm({ ...expenseForm, title: e.target.value })}
                    placeholder={tr('e.g. Electricity bill / Plumbing', 'مثال: فاتورة كهرباء / صيانة سباكة')}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">{tr('Amount *', 'المبلغ *')}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={expenseForm.amount}
                    onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
                    placeholder="0.00"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">{tr('Payment Method', 'طريقة الدفع')}</label>
                <select
                  value={expenseForm.payment_method}
                  onChange={(e) => setExpenseForm({ ...expenseForm, payment_method: e.target.value })}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                >
                  <option value="cash">{tr('Cash (Auto-deduct from open shift drawer)', 'نقدية (خصم تلقائي من درج الوردية المفتوحة)')}</option>
                  <option value="bank_transfer">{tr('Bank Transfer', 'تحويل بنكي')}</option>
                  <option value="card">{tr('Card / Company Credit', 'بطاقة / فيزا')}</option>
                  <option value="petty_cash">{tr('Separate Petty Cash Vault', 'عهدة نقدية منفصلة')}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">{tr('Notes / Receipt Number', 'ملاحظات / رقم الإيصال')}</label>
                <textarea
                  value={expenseForm.notes}
                  onChange={(e) => setExpenseForm({ ...expenseForm, notes: e.target.value })}
                  placeholder="Receipt #, invoice ref, or memo"
                  rows={2}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-border">
                <Button type="button" variant="outline" onClick={() => setShowExpenseModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Adding...' : 'Add Expense'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Safe Vault Transaction */}
      {showSafeTxModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h3 className="text-lg font-bold text-foreground">
                {tr('Record Main Vault Transaction', 'تسجيل حركة بالخزنة الرئيسية')}
              </h3>
              <button
                type="button"
                onClick={() => setShowSafeTxModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSafeTx} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">
                  {tr('Transaction Type', 'نوع الحركة')}
                </label>
                <select
                  value={safeTxForm.type}
                  onChange={(e) => setSafeTxForm({ ...safeTxForm, type: e.target.value as any })}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-semibold"
                >
                  <option value="deposit">{tr('Deposit into Vault (إيداع بالخزنة)', 'إيداع بالخزنة')}</option>
                  <option value="withdrawal">{tr('Withdrawal from Vault (سحب من الخزنة)', 'سحب من الخزنة')}</option>
                  <option value="bank_transfer">{tr('Transfer to Bank Account (توريد بنكي)', 'توريد بنكي')}</option>
                  <option value="supplier_payout">{tr('Supplier / AP Cash Payout (سداد موردين)', 'سداد موردين كاش')}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">
                  {tr('Amount', 'المبلغ')}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={safeTxForm.amount}
                  onChange={(e) => setSafeTxForm({ ...safeTxForm, amount: e.target.value })}
                  placeholder="0.00"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-base font-bold"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">
                  {tr('Category / Reason', 'التصنيف / السبب')}
                </label>
                <input
                  type="text"
                  value={safeTxForm.category}
                  onChange={(e) => setSafeTxForm({ ...safeTxForm, category: e.target.value })}
                  placeholder={tr('e.g. Bank Deposit, Supplier Payment', 'مثال: إيداع بنكي، سداد مورد')}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">
                  {tr('Reference / Receipt #', 'المرجع / رقم الإيصال')}
                </label>
                <input
                  type="text"
                  value={safeTxForm.reference_no}
                  onChange={(e) => setSafeTxForm({ ...safeTxForm, reference_no: e.target.value })}
                  placeholder={tr('Bank slip #, supplier voucher #', 'رقم إشعار الإيداع، سند الصرف')}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase">
                  {tr('Notes', 'ملاحظات')}
                </label>
                <textarea
                  value={safeTxForm.notes}
                  onChange={(e) => setSafeTxForm({ ...safeTxForm, notes: e.target.value })}
                  placeholder={tr('Optional details', 'تفاصيل إضافية')}
                  rows={2}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-border">
                <Button type="button" variant="outline" onClick={() => setShowSafeTxModal(false)}>
                  {tr('Cancel', 'إلغاء')}
                </Button>
                <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
                  {tr('Save Transaction', 'حفظ الحركة')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
