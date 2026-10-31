'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth';
import api from '@/lib/api';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Banknote, BarChart3, CalendarDays, ChefHat, ChevronDown, ClipboardList, Clock, Download, FileSpreadsheet, FileText, Hourglass, LayoutGrid, Lock, Minus, ReceiptText, RotateCcw, Tags, Timer, TrendingUp, Trophy, Wallet, Search, Package, type LucideIcon } from 'lucide-react';
import { useTranslations, useLocale, type AppConfig } from 'use-intl';
import { Ltr } from '@/components/layout/Ltr';
import { CashCloseModal } from '@/components/dashboard/CashCloseModal';
import { useCashClose } from '@/hooks/useCashClose';
import toast from 'react-hot-toast';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useFormatDate } from '@/hooks/useFormatDate';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PAYMENT_METHODS } from '@/lib/payment-methods';
import { ORDER_STATUS_LABEL_KEYS } from '@/lib/i18n-enums';
import { splitHoursMinutes } from '@/lib/table-timing';
import { tenantCan } from '@/lib/permissions';
import { businessDateForInstant } from '@shared/business-date';


interface PaymentMethodBreakdown {
  method: string | null;
  count: number;
  total: number;
}

interface DailyStats {
  sales: number;
  runningOrders: number;
  pendingOrders: number;
  tablesOccupied: number;
  avgTableTurnMinutes?: number | null;
  paymentMethods: PaymentMethodBreakdown[];
}

interface DaySummary {
  date: string;
  orders: { count: number; total: number };
  bills: { count: number; total: number; collected: number };
  customers: { new: number };
  paymentMethods: PaymentMethodBreakdown[];
}

interface RefundActivity {
  id: number;
  amount: number;
  method: string;
  reason: string | null;
  created_at: string;
  bill_number: string;
  paid_at: string;
  order_number: string;
  approved_by_name: string;
}

interface FinancialSummary {
  startDate: string;
  endDate: string;
  grossCollected: number;
  refunded: number;
  netCollected: number;
  billCount: number;
  refundCount: number;
  averageOrderValue: number;
  paymentMethods: PaymentMethodBreakdown[];
  refunds: RefundActivity[];
}

interface TopProduct {
  product_id: number;
  product_name: string;
  category_name?: string;
  total_quantity: number;
  total_revenue: number;
  order_count: number;
  avg_price?: number;
}

interface RecentOrder {
  id: number;
  order_number: string;
  status: string;
  total: number;
  customer_name: string | null;
  table_name: string | null;
  created_at: string;
}

interface TopStaff {
  user_id: string;
  name: string;
  role: string;
  revenue: number;
  orderCount: number;
}

interface TopCategory {
  category_id: string | null;
  name: string;
  quantity: number;
  revenue: number;
}

interface HourBucket {
  hour: number;
  orderCount: number;
}

interface DayBucket {
  dayIndex: number;
  orderCount: number;
}


interface Insights {
  windowDays: number;
  aov: number;
  avgPrepTimeMinutes: number | null;
  topStaff: TopStaff[];
  topCategories: TopCategory[];
  busiestHour: HourBucket | null;
  idlestHour: HourBucket | null;
  busiestDayOfWeek: DayBucket | null;
  idlestDayOfWeek: DayBucket | null;
}

interface WeeklyComparison {
  sales: number;
  averageOrderValue: number;
}

interface DashboardTile {
  label: string;
  value: string | number;
  icon: LucideIcon;
  color: string;
  iconBg: string;
  href: string;
  comparison?: ReactNode;
  meta?: string;
}

interface DashboardMetric {
  label: string;
  value: string;
  icon: LucideIcon;
  iconBg: string;
  comparison?: ReactNode;
}

function getMonthRange(month: string): { startDate: string; endDate: string } {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { startDate: `${month}-01`, endDate: `${month}-${String(lastDay).padStart(2, '0')}` };
}

function getWeekRange(dateStr: string): { startDate: string; endDate: string } {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay();
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    startDate: monday.toISOString().slice(0, 10),
    endDate: sunday.toISOString().slice(0, 10),
  };
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Formats a 0-23 local hour index as a locale-appropriate time label (e.g. "2 PM"). */
function formatHourLabel(hour: number, locale: string): string {
  const reference = new Date(Date.UTC(2000, 0, 1, hour));
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', timeZone: 'UTC' }).format(reference);
}

/** Formats a 0=Sunday..6=Saturday index as a locale-appropriate weekday name. */
function formatWeekdayLabel(dayIndex: number, locale: string): string {
  // Reference Sunday date for locale weekday formatting.
  const reference = new Date(2000, 0, 2 + dayIndex);
  return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(reference);
}

const orderStatusColor: Record<string, string> = {
  pending: 'text-yellow-600 dark:text-yellow-400',
  preparing: 'text-blue-600 dark:text-blue-400',
  ready: 'text-green-600 dark:text-green-400',
  served: 'text-purple-600 dark:text-purple-400',
  completed: 'text-muted-foreground',
  cancelled: 'text-red-500 dark:text-red-400',
};

type OrdersKey = keyof AppConfig['Messages']['orders'];
type PosKey = keyof AppConfig['Messages']['pos'];

// Built-in payment method label keys mapped to typed `pos` leaf keys.
const BUILT_IN_PAYMENT_KEYS = {
  cash: 'methodCash',
  card: 'methodCard',
} as const satisfies Record<'cash' | 'card', PosKey>;

export default function DashboardPage() {
  const { currentTenant } = useAuthStore();
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');
  const tPos = useTranslations('pos');
  const tOrders = useTranslations('orders');
  const router = useRouter();
  const [stats, setStats] = useState<DailyStats | null>(null);
  const [daySummary, setDaySummary] = useState<DaySummary | null>(null);
  const [financialSummary, setFinancialSummary] = useState<FinancialSummary | null>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [weeklyComparison, setWeeklyComparison] = useState<WeeklyComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  const isOwner = tenantCan(currentTenant, 'dashboard.view');
  const canViewFinancials = tenantCan(currentTenant, 'reports.financial.view');
  const fmt = useFormatCurrency();
  // Financial figures require `reports.financial.view`, independently of `dashboard.view`;
  // mask them instead of showing a misleading zero when that permission isn't granted.
  const fmtFinancial = (value: number): string => (canViewFinancials ? fmt(value) : '—');
  const numFinancial = (value: number): string | number => (canViewFinancials ? value : '—');
  const { formatDateTime } = useFormatDate();
  const locale = useLocale();
  const isAr = locale.startsWith('ar');
  const timeZone = currentTenant?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  // The store's business day starts at its configured time, not at midnight, so
  // the day picker and its upper bound follow the same rule the cash-close modal
  // and the drawer movements use instead of the plain tenant-local date.
  const todayLocal = businessDateForInstant({
    instant: new Date(),
    timezone: timeZone,
    startTime: currentTenant?.business_day_start_time || '00:00',
  });
  const [selectedDate, setSelectedDate] = useState(todayLocal);
  const [selectedMonth, setSelectedMonth] = useState(todayLocal.slice(0, 7));
  const [customStartDate, setCustomStartDate] = useState(shiftDate(todayLocal, -7));
  const [customEndDate, setCustomEndDate] = useState(todayLocal);
  const [periodMode, setPeriodMode] = useState<'day' | 'week' | 'month' | 'custom'>('day');
  const dayInputRef = useRef<HTMLInputElement>(null);
  const weekInputRef = useRef<HTMLInputElement>(null);
  const monthInputRef = useRef<HTMLInputElement>(null);
  const customStartInputRef = useRef<HTMLInputElement>(null);
  const customEndInputRef = useRef<HTMLInputElement>(null);

  // Ordered items table filter/sort state
  const [itemSearch, setItemSearch] = useState('');
  const [itemCategoryFilter, setItemCategoryFilter] = useState<string>('all');
  const [itemSortField, setItemSortField] = useState<'quantity' | 'revenue' | 'name' | 'avg_price'>('quantity');
  const [itemSortAsc, setItemSortAsc] = useState<boolean>(false);

  const isToday = periodMode === 'day' && selectedDate === todayLocal;
  const range = useMemo(() => {
    if (periodMode === 'day') {
      return { startDate: selectedDate, endDate: selectedDate };
    }
    if (periodMode === 'week') {
      return getWeekRange(selectedDate);
    }
    if (periodMode === 'month') {
      return getMonthRange(selectedMonth);
    }
    return {
      startDate: customStartDate || todayLocal,
      endDate: customEndDate || todayLocal,
    };
  }, [periodMode, selectedDate, selectedMonth, customStartDate, customEndDate, todayLocal]);

  /** Opens Chromium's native calendar UI while preserving keyboard fallback. */
  const openPicker = (input: HTMLInputElement | null) => {
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      // Older embedded Chromium builds may not expose showPicker. Focusing the
      // native input still leaves keyboard date entry available.
      input.focus();
    }
  };

  useEffect(() => {
    if (currentTenant && !isOwner) {
      router.replace('/pos');
    }
  }, [currentTenant, isOwner, router]);

  // Reset loading state during render when query parameters change.
  const syncKey = `${isOwner}:${periodMode}:${range.startDate}:${range.endDate}`;
  const [syncedKey, setSyncedKey] = useState(syncKey);
  if (syncKey !== syncedKey) {
    setSyncedKey(syncKey);
    if (isOwner) setLoading(true);
  }

  useEffect(() => {
    if (!isOwner) return;
    const controller = new AbortController();
    const dailyStatsRequest = isToday
      ? api.get('/reports/daily-stats', { signal: controller.signal })
      : Promise.resolve(null);
    const scopedSummary = api.get('/reports/summary', {
      params: { start_date: range.startDate, end_date: range.endDate },
      signal: controller.signal,
    });
    const previousWeekDate = shiftDate(selectedDate, -7);
    const comparisonRequest = periodMode === 'day' && canViewFinancials
      ? api.get('/reports/financial-summary', {
          params: { start_date: previousWeekDate, end_date: previousWeekDate },
          signal: controller.signal,
        })
          .then((res) => ({
            sales: Number(res.data.financialSummary?.netCollected ?? 0),
            averageOrderValue: Number(res.data.financialSummary?.averageOrderValue ?? 0),
          }))
          .catch((err: unknown) => {
            if (err instanceof Error && (err.name === 'CanceledError' || err.name === 'AbortError')) throw err;
            return null;
          })
      : Promise.resolve(null);
    // `dashboard.view` and `reports.financial.view` are independently configurable, so an
    // owner may grant one without the other. Skip the financial-summary call entirely in
    // that case rather than letting its 403 reject the whole Promise.all and blank the tiles
    // (running orders, tables, top products, ...) that only need `dashboard.view`.
    const financialSummaryRequest = canViewFinancials
      ? api.get('/reports/financial-summary', { params: { start_date: range.startDate, end_date: range.endDate }, signal: controller.signal })
      : Promise.resolve(null);
    Promise.all([
      dailyStatsRequest,
      scopedSummary,
      financialSummaryRequest,
      api.get('/reports/topProducts', { params: { start_date: range.startDate, end_date: range.endDate, limit: 1000 }, signal: controller.signal }),
      api.get('/reports/recentOrders', {
        params: { start_date: range.startDate, end_date: range.endDate, limit: 8 },
        signal: controller.signal,
      }),
      api.get('/reports/insights', { params: { start_date: range.startDate, end_date: range.endDate }, signal: controller.signal }),
      comparisonRequest,
    ])
      .then(([statsRes, summaryRes, financialRes, topRes, recentRes, insightsRes, comparisonRes]) => {
        setStats(statsRes?.data ?? null);
        setDaySummary(summaryRes?.data?.summary ?? null);
        setFinancialSummary(financialRes?.data.financialSummary ?? null);
        setTopProducts(topRes.data.topProducts || []);
        setRecentOrders(recentRes.data.recentOrders || []);
        setInsights(insightsRes.data);
        setWeeklyComparison(comparisonRes);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && (err.name === 'CanceledError' || err.name === 'AbortError')) return;
        toast.error(tCommon('somethingWrong'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, canViewFinancials, periodMode, range.startDate, range.endDate]);

  // Day-close wizard lives in useCashClose + CashCloseModal; the page
  // only opens it and mounts it.
  const cashClose = useCashClose();

  const downloadBlob = (data: Blob, filename: string) => {
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportDailySales = async (format: 'xlsx' | 'csv') => {
    if (periodMode !== 'day' || isExporting) return;
    setIsExporting(true);
    try {
      if (format === 'xlsx') {
        const res = await api.get('/reports/daily-sales/export', {
          params: { date: selectedDate, format: 'xlsx' },
          responseType: 'blob',
        });
        downloadBlob(res.data as Blob, `daily-sales-${selectedDate}.xlsx`);
        return;
      }
      toast(t('exportCsvStarted'));
      for (const part of ['summary', 'items'] as const) {
        const res = await api.get('/reports/daily-sales/export', {
          params: { date: selectedDate, format: 'csv', part },
          responseType: 'blob',
        });
        downloadBlob(res.data as Blob, `daily-sales-${selectedDate}-${part}.csv`);
      }
    } catch {
      toast.error(tCommon('downloadFailed'));
    } finally {
      setIsExporting(false);
    }
  };

  const exportItemizedReport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const start = periodMode === 'day' ? selectedDate : range.startDate;
      const end = periodMode === 'day' ? selectedDate : range.endDate;
      const res = await api.get('/reports/sales-itemized', {
        params: { start_date: start, end_date: end },
      });
      const items = res.data?.items || [];
      if (items.length === 0) {
        toast.error('No sales items in selected range');
        return;
      }
      const header = 'Order Number,Date,Product,Quantity,Gross Price,Discount,Net Price,Ingredient Cost,Packaging Cost,Total Cost,Gross Margin,Margin %\\n';
      const rows = items.map((it: { order_number: string; created_at: string; product_name: string; quantity: number; gross_item_price: number; item_discount: number; net_item_price: number; ingredient_cost: number; packaging_cost: number; total_cost: number; gross_margin: number; margin_percent: number }) =>
        `"${it.order_number}","${it.created_at}","${it.product_name}",${it.quantity},${it.gross_item_price},${it.item_discount},${it.net_item_price},${it.ingredient_cost},${it.packaging_cost},${it.total_cost},${it.gross_margin},${it.margin_percent}`
      ).join('\\n');
      const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
      downloadBlob(blob, `itemized-sales-${start}-to-${end}.csv`);
      toast.success('Itemized sales report downloaded');
    } catch {
      toast.error(tCommon('downloadFailed'));
    } finally {
      setIsExporting(false);
    }
  };

  const exportOrderedItemsCsv = () => {
    if (topProducts.length === 0) {
      toast.error(isAr ? 'لا توجد منتجات مباعة في هذه الفترة' : 'No ordered items in selected period');
      return;
    }
    const header = 'Product,Category,Quantity Ordered,Average Price,Total Revenue,Order Count\n';
    const rows = topProducts.map((p) =>
      `"${(p.product_name || '').replace(/"/g, '""')}","${(p.category_name || '').replace(/"/g, '""')}",${p.total_quantity},${p.avg_price ?? (p.total_quantity > 0 ? (p.total_revenue / p.total_quantity).toFixed(2) : 0)},${p.total_revenue},${p.order_count}`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, `ordered-items-${range.startDate}-to-${range.endDate}.csv`);
    toast.success(isAr ? 'تم تنزيل تقرير المنتجات المطلوبة' : 'Ordered items report downloaded');
  };

  const categoriesList = useMemo(() => {
    const set = new Set<string>();
    topProducts.forEach((p) => {
      if (p.category_name) set.add(p.category_name);
    });
    return Array.from(set).sort();
  }, [topProducts]);

  const filteredOrderedItems = useMemo(() => {
    return topProducts
      .filter((item) => {
        if (itemCategoryFilter !== 'all' && item.category_name !== itemCategoryFilter) {
          return false;
        }
        if (itemSearch.trim()) {
          const q = itemSearch.toLowerCase();
          const matchName = item.product_name.toLowerCase().includes(q);
          const matchCat = (item.category_name || '').toLowerCase().includes(q);
          if (!matchName && !matchCat) return false;
        }
        return true;
      })
      .sort((a, b) => {
        let diff = 0;
        if (itemSortField === 'quantity') {
          diff = a.total_quantity - b.total_quantity;
        } else if (itemSortField === 'revenue') {
          diff = a.total_revenue - b.total_revenue;
        } else if (itemSortField === 'avg_price') {
          const pA = a.avg_price ?? (a.total_quantity ? a.total_revenue / a.total_quantity : 0);
          const pB = b.avg_price ?? (b.total_quantity ? b.total_revenue / b.total_quantity : 0);
          diff = pA - pB;
        } else if (itemSortField === 'name') {
          diff = a.product_name.localeCompare(b.product_name);
        }
        return itemSortAsc ? diff : -diff;
      });
  }, [topProducts, itemCategoryFilter, itemSearch, itemSortField, itemSortAsc]);

  const totalOrderedQuantity = useMemo(() => {
    return topProducts.reduce((sum, p) => sum + Number(p.total_quantity || 0), 0);
  }, [topProducts]);

  const totalOrderedRevenue = useMemo(() => {
    return topProducts.reduce((sum, p) => sum + Number(p.total_revenue || 0), 0);
  }, [topProducts]);

  const maxProductQuantity = useMemo(() => {
    return Math.max(...topProducts.map((p) => Number(p.total_quantity || 0)), 1);
  }, [topProducts]);

  if (!isOwner) return null;

  const paymentMethods = financialSummary?.paymentMethods ?? [];
  const paymentMethodsTotal = paymentMethods.reduce((sum, pm) => sum + Number(pm.total), 0);

  const getComparisonBadge = (current: number, previous: number) => {
    const difference = current - previous;
    const direction = difference === 0 ? 'flat' : difference > 0 ? 'up' : 'down';
    const percent = previous === 0 ? null : Math.round((Math.abs(difference) / Math.abs(previous)) * 100);
    const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;
    const label = difference === 0
      ? t('kpiNoChangeVsSameDayLastWeek')
      : previous === 0
        ? t('kpiNewVsSameDayLastWeek')
        : t('kpiChangeVsSameDayLastWeek', { percent: `${direction === 'down' ? '-' : direction === 'up' ? '+' : ''}${percent}` });
    const tone = direction === 'up'
      ? 'bg-emerald-100/80 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
      : direction === 'down'
        ? 'bg-red-100/80 text-red-700 dark:bg-red-950/50 dark:text-red-300'
        : 'bg-muted text-muted-foreground';
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${tone}`}>
        <Icon size={13} />
        {label}
      </span>
    );
  };

  const salesComparison = weeklyComparison
    ? getComparisonBadge(financialSummary?.netCollected ?? 0, weeklyComparison.sales)
    : null;
  const aovComparison = weeklyComparison
    ? getComparisonBadge(financialSummary?.averageOrderValue ?? 0, weeklyComparison.averageOrderValue)
    : null;

  const primaryTiles: DashboardTile[] = isToday
    ? [
        {
          label: t('todaySales'),
          value: fmtFinancial(financialSummary?.netCollected ?? 0),
          comparison: salesComparison,
          icon: Banknote,
          color: 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-800/50 dark:bg-emerald-950/30',
          iconBg: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
          href: '/orders',
        },
        {
          label: t('runningOrders'),
          value: stats?.runningOrders ?? 0,
          meta: t('liveNow'),
          icon: ChefHat,
          color: 'border-blue-200 bg-blue-50/80 dark:border-blue-800/50 dark:bg-blue-950/30',
          iconBg: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
          href: '/orders',
        },
        {
          label: t('pendingOrders'),
          value: stats?.pendingOrders ?? 0,
          meta: t('liveNow'),
          icon: Clock,
          color: 'border-amber-200 bg-amber-50/80 dark:border-amber-800/50 dark:bg-amber-950/30',
          iconBg: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
          href: '/orders',
        },
        {
          label: t('tablesOccupied'),
          value: stats?.tablesOccupied ?? 0,
          meta: t('liveNow'),
          icon: LayoutGrid,
          color: 'border-violet-200 bg-violet-50/80 dark:border-violet-800/50 dark:bg-violet-950/30',
          iconBg: 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300',
          href: '/tables',
        },
      ]
    : [
        {
          label: t('sales'),
          value: fmtFinancial(financialSummary?.netCollected ?? daySummary?.bills.collected ?? 0),
          comparison: salesComparison,
          icon: Banknote,
          color: 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-800/50 dark:bg-emerald-950/30',
          iconBg: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
          href: '/orders',
        },
        {
          label: t('orders'),
          value: daySummary?.orders.count ?? recentOrders.length,
          icon: ClipboardList,
          color: 'border-blue-200 bg-blue-50/80 dark:border-blue-800/50 dark:bg-blue-950/30',
          iconBg: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
          href: '/orders',
        },
        {
          label: isAr ? 'القطع المباعة' : 'Units Sold',
          value: totalOrderedQuantity,
          icon: Package,
          color: 'border-amber-200 bg-amber-50/80 dark:border-amber-800/50 dark:bg-amber-950/30',
          iconBg: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
          href: '#ordered-items-section',
        },
        {
          label: t('billsCollected'),
          value: numFinancial(financialSummary?.billCount ?? daySummary?.bills.count ?? 0),
          icon: ReceiptText,
          color: 'border-violet-200 bg-violet-50/80 dark:border-violet-800/50 dark:bg-violet-950/30',
          iconBg: 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300',
          href: '/orders',
        },
      ];

  const secondaryMetrics: DashboardMetric[] = [
    {
      label: t('aov'),
      value: fmtFinancial(financialSummary?.averageOrderValue ?? 0),
      comparison: aovComparison,
      icon: TrendingUp,
      iconBg: 'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300',
    },
    {
      label: t('busiestHour'),
      value: insights?.busiestHour ? `${formatHourLabel(insights.busiestHour.hour, locale)} (${insights.busiestHour.orderCount})` : '—',
      icon: Clock,
      iconBg: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
    },
    {
      label: t('busiestDay'),
      value: insights?.busiestDayOfWeek ? `${formatWeekdayLabel(insights.busiestDayOfWeek.dayIndex, locale)} (${insights.busiestDayOfWeek.orderCount})` : '—',
      icon: CalendarDays,
      iconBg: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
    },
    {
      label: t('avgPrepTime'),
      value: insights?.avgPrepTimeMinutes != null ? t('minutesValue', { minutes: insights.avgPrepTimeMinutes }) : '—',
      icon: Timer,
      iconBg: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300',
    },
    ...(isToday && stats?.avgTableTurnMinutes != null ? [{
      label: t('avgTableTurn'),
      value: (() => {
        const { h, m } = splitHoursMinutes(stats.avgTableTurnMinutes);
        return h > 0 ? tCommon('timeHoursMinutes', { h, m }) : tCommon('timeMinutes', { m });
      })(),
      icon: Hourglass,
      iconBg: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300',
    }] : []),
  ];

  return (
    <div className="min-h-full bg-background p-4 sm:p-6 lg:p-7 space-y-7">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {t('title')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {periodMode === 'day'
              ? (isToday ? (isAr ? 'عرض إحصائيات وتقارير اليوم المباشرة' : 'Live today stats and reports') : (isAr ? `تقرير يوم: ${selectedDate}` : `Report for ${selectedDate}`))
              : periodMode === 'week'
                ? (isAr ? `تقرير الأسبوع: من ${range.startDate} إلى ${range.endDate}` : `Week report: ${range.startDate} to ${range.endDate}`)
                : periodMode === 'month'
                  ? (isAr ? `تقرير شهر: ${selectedMonth}` : `Month report: ${selectedMonth}`)
                  : (isAr ? `تقرير فترة مخصصة: من ${range.startDate} إلى ${range.endDate}` : `Custom period: ${range.startDate} to ${range.endDate}`)}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-start gap-2 xl:justify-end">
          {/* Day Mode Picker */}
          {periodMode === 'day' && (
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <input
                  ref={dayInputRef}
                  type="date"
                  value={selectedDate}
                  max={todayLocal}
                  onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
                  className="h-10 appearance-none rounded-xl border border-border bg-card ps-3 pe-10 text-sm text-foreground shadow-sm [color-scheme:light] focus:outline-none focus:ring-2 focus:ring-brand/30 dark:[color-scheme:dark] [&::-webkit-calendar-picker-indicator]:pointer-events-none [&::-webkit-calendar-picker-indicator]:opacity-0"
                  aria-label={t('selectDate')}
                />
                <button
                  type="button"
                  onClick={() => openPicker(dayInputRef.current)}
                  className="absolute inset-y-0 end-0 z-10 flex w-9 items-center justify-center rounded-e-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={t('openDatePicker')}
                >
                  <CalendarDays size={16} />
                </button>
              </div>
              <Button
                type="button"
                variant={selectedDate === todayLocal ? 'default' : 'outline'}
                size="sm"
                className="h-10 rounded-xl text-xs px-3"
                onClick={() => setSelectedDate(todayLocal)}
              >
                {isAr ? 'اليوم' : 'Today'}
              </Button>
              <Button
                type="button"
                variant={selectedDate === shiftDate(todayLocal, -1) ? 'default' : 'outline'}
                size="sm"
                className="h-10 rounded-xl text-xs px-3"
                onClick={() => setSelectedDate(shiftDate(todayLocal, -1))}
              >
                {isAr ? 'أمس' : 'Yesterday'}
              </Button>
            </div>
          )}

          {/* Week Mode Picker */}
          {periodMode === 'week' && (
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <input
                  ref={weekInputRef}
                  type="date"
                  value={selectedDate}
                  max={todayLocal}
                  onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
                  className="h-10 appearance-none rounded-xl border border-border bg-card ps-3 pe-10 text-sm text-foreground shadow-sm [color-scheme:light] focus:outline-none focus:ring-2 focus:ring-brand/30 dark:[color-scheme:dark] [&::-webkit-calendar-picker-indicator]:pointer-events-none [&::-webkit-calendar-picker-indicator]:opacity-0"
                  aria-label="Select Week Date"
                />
                <button
                  type="button"
                  onClick={() => openPicker(weekInputRef.current)}
                  className="absolute inset-y-0 end-0 z-10 flex w-9 items-center justify-center rounded-e-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Open Week Picker"
                >
                  <CalendarDays size={16} />
                </button>
              </div>
              <Button
                type="button"
                variant={selectedDate === todayLocal ? 'default' : 'outline'}
                size="sm"
                className="h-10 rounded-xl text-xs px-3"
                onClick={() => setSelectedDate(todayLocal)}
              >
                {isAr ? 'هذا الأسبوع' : 'This Week'}
              </Button>
              <Button
                type="button"
                variant={selectedDate === shiftDate(todayLocal, -7) ? 'default' : 'outline'}
                size="sm"
                className="h-10 rounded-xl text-xs px-3"
                onClick={() => setSelectedDate(shiftDate(todayLocal, -7))}
              >
                {isAr ? 'الأسبوع الماضي' : 'Last Week'}
              </Button>
            </div>
          )}

          {/* Month Mode Picker */}
          {periodMode === 'month' && (
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <input
                  ref={monthInputRef}
                  type="month"
                  value={selectedMonth}
                  max={todayLocal.slice(0, 7)}
                  onChange={(e) => e.target.value && setSelectedMonth(e.target.value)}
                  className="h-10 appearance-none rounded-xl border border-border bg-card ps-3 pe-10 text-sm text-foreground shadow-sm [color-scheme:light] focus:outline-none focus:ring-2 focus:ring-brand/30 dark:[color-scheme:dark] [&::-webkit-calendar-picker-indicator]:pointer-events-none [&::-webkit-calendar-picker-indicator]:opacity-0"
                  aria-label={t('selectMonth')}
                />
                <button
                  type="button"
                  onClick={() => openPicker(monthInputRef.current)}
                  className="absolute inset-y-0 end-0 z-10 flex w-9 items-center justify-center rounded-e-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={t('openMonthPicker')}
                >
                  <CalendarDays size={16} />
                </button>
              </div>
              <Button
                type="button"
                variant={selectedMonth === todayLocal.slice(0, 7) ? 'default' : 'outline'}
                size="sm"
                className="h-10 rounded-xl text-xs px-3"
                onClick={() => setSelectedMonth(todayLocal.slice(0, 7))}
              >
                {isAr ? 'هذا الشهر' : 'This Month'}
              </Button>
            </div>
          )}

          {/* Custom Date Range Mode Pickers */}
          {periodMode === 'custom' && (
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="relative">
                <input
                  ref={customStartInputRef}
                  type="date"
                  value={customStartDate}
                  max={customEndDate || todayLocal}
                  onChange={(e) => e.target.value && setCustomStartDate(e.target.value)}
                  className="h-10 appearance-none rounded-xl border border-border bg-card ps-3 pe-10 text-sm text-foreground shadow-sm [color-scheme:light] focus:outline-none focus:ring-2 focus:ring-brand/30 dark:[color-scheme:dark] [&::-webkit-calendar-picker-indicator]:pointer-events-none [&::-webkit-calendar-picker-indicator]:opacity-0"
                  aria-label="Start Date"
                />
                <button
                  type="button"
                  onClick={() => openPicker(customStartInputRef.current)}
                  className="absolute inset-y-0 end-0 z-10 flex w-9 items-center justify-center rounded-e-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <CalendarDays size={16} />
                </button>
              </div>
              <span className="text-muted-foreground text-xs font-semibold px-1">→</span>
              <div className="relative">
                <input
                  ref={customEndInputRef}
                  type="date"
                  value={customEndDate}
                  min={customStartDate}
                  max={todayLocal}
                  onChange={(e) => e.target.value && setCustomEndDate(e.target.value)}
                  className="h-10 appearance-none rounded-xl border border-border bg-card ps-3 pe-10 text-sm text-foreground shadow-sm [color-scheme:light] focus:outline-none focus:ring-2 focus:ring-brand/30 dark:[color-scheme:dark] [&::-webkit-calendar-picker-indicator]:pointer-events-none [&::-webkit-calendar-picker-indicator]:opacity-0"
                  aria-label="End Date"
                />
                <button
                  type="button"
                  onClick={() => openPicker(customEndInputRef.current)}
                  className="absolute inset-y-0 end-0 z-10 flex w-9 items-center justify-center rounded-e-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <CalendarDays size={16} />
                </button>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10 rounded-xl text-xs px-2.5"
                onClick={() => {
                  setCustomStartDate(shiftDate(todayLocal, -7));
                  setCustomEndDate(todayLocal);
                }}
              >
                7d
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10 rounded-xl text-xs px-2.5"
                onClick={() => {
                  setCustomStartDate(shiftDate(todayLocal, -30));
                  setCustomEndDate(todayLocal);
                }}
              >
                30d
              </Button>
            </div>
          )}

          {/* Period Mode Selector Tabs */}
          <div className="flex h-10 rounded-xl border border-border bg-card p-1 shadow-sm" role="group" aria-label={t('periodView')}>
            {([
              { mode: 'day', label: isAr ? 'يوم' : t('day') },
              { mode: 'week', label: isAr ? 'أسبوع' : 'Week' },
              { mode: 'month', label: isAr ? 'شهر' : t('month') },
              { mode: 'custom', label: isAr ? 'مخصص' : 'Custom' },
            ] as const).map(({ mode, label }) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPeriodMode(mode)}
                className={`min-w-14 rounded-lg px-2.5 text-xs font-semibold transition-colors ${periodMode === mode ? 'bg-foreground text-background shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}
                aria-pressed={periodMode === mode}
              >
                {label}
              </button>
            ))}
          </div>

          <span className="mx-1 hidden h-7 w-px bg-border xl:block" aria-hidden="true" />

          <Button
            asChild
            variant="outline"
            className="h-10 rounded-xl bg-card px-4 shadow-sm"
          >
            <Link href="/finance">
              <Wallet size={14} />
              Finance
            </Link>
          </Button>

          <Button
            type="button"
            onClick={cashClose.openCloseModal}
            className="h-10 rounded-xl bg-brand px-4 text-white shadow-sm hover:bg-brand-hover"
          >
            <Lock size={14} />
            {t('closeShift')}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                disabled={isExporting}
                className="h-10 rounded-xl bg-card px-4 shadow-sm"
                title={t('exportSales')}
              >
                <Download size={14} />
                {t('exportSales')}
                <ChevronDown size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={exportOrderedItemsCsv}>
                <Package size={14} />
                {isAr ? 'تقرير المنتجات المطلوبة (CSV)' : 'Ordered Items & Qty (CSV)'}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportItemizedReport()}>
                <ReceiptText size={14} />
                Itemized Margins (CSV)
              </DropdownMenuItem>
              {periodMode === 'day' && (
                <>
                  <DropdownMenuItem onSelect={() => exportDailySales('xlsx')}>
                    <FileSpreadsheet size={14} />
                    {t('exportXlsx')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => exportDailySales('csv')}>
                    <FileText size={14} />
                    {t('exportCsv')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <CashCloseModal model={cashClose} />

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" role="status" aria-live="polite">
          <span className="sr-only">{tCommon('loading')}</span>
          {[0, 1, 2, 3].map((item) => (
            <div key={item} aria-hidden="true" className="h-36 animate-pulse rounded-2xl border border-border bg-card/70" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {primaryTiles.map((tile) => (
              <Link
                key={tile.label}
                href={tile.href}
                className={`group rounded-2xl border p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${tile.color}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-sm font-medium text-muted-foreground">{tile.label}</span>
                  <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${tile.iconBg}`}>
                    <tile.icon size={19} />
                  </span>
                </div>
                <p className="mt-5 text-3xl font-bold tracking-tight text-foreground">
                  {tile.value}
                </p>
                <div className="mt-3 min-h-6">
                  {tile.comparison || (tile.meta && <span className="text-xs font-medium text-muted-foreground">{tile.meta}</span>)}
                </div>
              </Link>
            ))}
          </div>

          {secondaryMetrics.length > 0 && (
            <div className="mt-5 grid grid-cols-1 overflow-hidden rounded-2xl border border-border bg-card shadow-sm sm:grid-cols-3">
              {secondaryMetrics.map((metric, index) => (
                <div key={metric.label} className={`flex items-center gap-3 p-4 sm:p-5 ${index > 0 ? 'border-t border-border sm:border-s-0 sm:border-t-0 sm:border-s' : ''}`}>
                  <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${metric.iconBg}`}>
                    <metric.icon size={18} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">{metric.label}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <p className="text-lg font-semibold text-foreground">{metric.value}</p>
                      {metric.comparison}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Recent Orders */}
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                    <ClipboardList size={16} />
                  </span>
                  <h2 className="font-semibold text-foreground">
                    {isToday ? t('recentOrders') : periodMode === 'month' ? t('monthOrders') : t('orders')}
                  </h2>
                </div>
                <Link href="/orders" className="flex items-center gap-1 text-xs text-brand hover:text-brand-hover font-medium">
                  {t('viewAll')} <ArrowRight size={12} className="rtl-flip" />
                </Link>
              </div>
              {recentOrders.length === 0 ? (
                <div className="flex min-h-48 flex-col items-center justify-center px-6 py-10 text-center">
                  <span className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                    <ClipboardList size={23} />
                  </span>
                  <p className="text-sm font-medium text-foreground">{t('noOrdersYet')}</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {recentOrders.map((order) => (
                    <Link
                      key={order.id}
                      href="/orders"
                      className="flex items-center justify-between px-5 py-3 transition-colors hover:bg-muted/60"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">#<Ltr>{order.order_number}</Ltr></span>
                          <span className={`text-xs font-medium ${orderStatusColor[order.status] || 'text-muted-foreground'}`}>
                            {(() => { const k = (ORDER_STATUS_LABEL_KEYS as Record<string, OrdersKey | undefined>)[order.status]; return k ? tOrders(k) : order.status; })()}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {order.customer_name || order.table_name || t('walkIn')}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-foreground shrink-0">
                        {fmt(Number(order.total))}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Top Products Today */}
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                    <TrendingUp size={16} />
                  </span>
                  <h2 className="font-semibold text-foreground">
                    {periodMode === 'month' ? t('topProductsMonth') : isToday ? t('topProductsToday') : t('topProducts')}
                  </h2>
                </div>
                <Link href="/products" className="flex items-center gap-1 text-xs text-brand hover:text-brand-hover font-medium">
                  {t('viewAll')} <ArrowRight size={12} className="rtl-flip" />
                </Link>
              </div>
              {topProducts.length === 0 ? (
                <div className="flex min-h-48 flex-col items-center justify-center px-6 py-10 text-center">
                  <span className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                    <TrendingUp size={23} />
                  </span>
                  <p className="text-sm font-medium text-foreground">{t('noSalesYet')}</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {topProducts.map((product) => (
                    <div key={product.product_id} className="flex items-center justify-between px-5 py-3">
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-foreground">{product.product_name}</span>
                        <p className="text-xs text-muted-foreground">{t('productSoldOrders', { quantity: product.total_quantity, orders: product.order_count })}</p>
                      </div>
                      <span className="text-sm font-semibold text-foreground shrink-0">
                        {fmt(Number(product.total_revenue))}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Top Staff */}
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                    <Trophy size={16} />
                  </span>
                  <h2 className="font-semibold text-foreground">{t('topStaff')}</h2>
                </div>
                <Link href="/staff" className="flex items-center gap-1 text-xs text-brand hover:text-brand-hover font-medium">
                  {t('viewAll')} <ArrowRight size={12} className="rtl-flip" />
                </Link>
              </div>
              {(insights?.topStaff.length ?? 0) === 0 ? (
                <div className="flex min-h-48 flex-col items-center justify-center px-6 py-10 text-center">
                  <span className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                    <Trophy size={23} />
                  </span>
                  <p className="text-sm font-medium text-foreground">{t('noSalesYet')}</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {insights!.topStaff.map((staff) => (
                    <div key={staff.user_id} className="flex items-center justify-between px-5 py-3">
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-foreground">{staff.name}</span>
                        <p className="text-xs text-muted-foreground">{t('staffOrderCount', { orders: staff.orderCount })}</p>
                      </div>
                      <span className="text-sm font-semibold text-foreground shrink-0">
                        {fmt(Number(staff.revenue))}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top Categories */}
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
                    <Tags size={16} />
                  </span>
                  <h2 className="font-semibold text-foreground">{t('topCategories')}</h2>
                </div>
                <Link href="/products" className="flex items-center gap-1 text-xs text-brand hover:text-brand-hover font-medium">
                  {t('viewAll')} <ArrowRight size={12} className="rtl-flip" />
                </Link>
              </div>
              {(insights?.topCategories.length ?? 0) === 0 ? (
                <div className="flex min-h-48 flex-col items-center justify-center px-6 py-10 text-center">
                  <span className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                    <Tags size={23} />
                  </span>
                  <p className="text-sm font-medium text-foreground">{t('noSalesYet')}</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {insights!.topCategories.map((category) => (
                    <div key={category.category_id ?? category.name} className="flex items-center justify-between px-5 py-3">
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-foreground">{category.name}</span>
                        <p className="text-xs text-muted-foreground">{t('categoryQuantitySold', { quantity: category.quantity })}</p>
                      </div>
                      <span className="text-sm font-semibold text-foreground shrink-0">
                        {fmt(Number(category.revenue))}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {periodMode === 'month' && canViewFinancials && (
            <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div>
                  <h2 className="flex items-center gap-2 font-semibold text-foreground">
                    <span className="flex size-9 items-center justify-center rounded-xl bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
                      <RotateCcw size={16} />
                    </span>
                    {t('refundActivity')}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">{t('refundActivityHint')}</p>
                </div>
                <span className="text-sm font-semibold text-red-600">{fmt(financialSummary?.refunded ?? 0)}</span>
              </div>
              {(financialSummary?.refunds.length ?? 0) === 0 ? (
                <p className="px-6 py-10 text-center text-sm text-muted-foreground">{t('noRefunds')}</p>
              ) : (
                <div className="divide-y divide-border">
                  {financialSummary!.refunds.map((refund) => (
                    <div key={refund.id} className="grid grid-cols-1 gap-2 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="text-sm font-semibold text-foreground">
                            {t('refundReference', { bill: refund.bill_number, order: refund.order_number })}
                          </span>
                          <span className="text-xs text-muted-foreground">{refund.method}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t('refundApproved', { name: refund.approved_by_name })}
                          {' · '}
                          {t('refundedAt', { date: formatDateTime(refund.created_at) })}
                          {' · '}
                          {t('collectedAt', { date: formatDateTime(refund.paid_at) })}
                        </p>
                        {refund.reason && <p className="mt-1 text-xs text-muted-foreground truncate">{refund.reason}</p>}
                      </div>
                      <span className="text-base font-bold text-red-600 sm:text-end">{fmt(-Number(refund.amount))}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* All Ordered Items & Quantities Section */}
          <section id="ordered-items-section" className="mt-5 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex flex-col gap-3 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                  <Package size={20} />
                </span>
                <div>
                  <h2 className="text-base font-bold text-foreground">
                    {isAr ? 'جميع المنتجات المطلوبة والكميات' : 'All Ordered Items & Quantities'}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {isAr
                      ? 'قائمة تفصيلية بجميع الأصناف المطلوبة مع كمياتها ومتوسط أسعارها وإجمالي مبيعاتها'
                      : 'Detailed breakdown of all ordered products with quantities, average price, and revenue'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  onClick={exportOrderedItemsCsv}
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-xl text-xs gap-1.5"
                >
                  <Download size={13} />
                  {isAr ? 'تصدير المنتجات (CSV)' : 'Export Items (CSV)'}
                </Button>
              </div>
            </div>

            {/* Filter & Search Bar */}
            <div className="border-b border-border bg-muted/30 p-4 space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative flex-1 max-w-sm">
                  <Search size={14} className="absolute inset-y-0 start-3 my-auto text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    value={itemSearch}
                    onChange={(e) => setItemSearch(e.target.value)}
                    placeholder={isAr ? 'بحث عن صنف أو قسم...' : 'Search item or category...'}
                    className="h-9 w-full rounded-xl border border-border bg-card ps-9 pe-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand/30"
                  />
                  {itemSearch && (
                    <button
                      type="button"
                      onClick={() => setItemSearch('')}
                      className="absolute inset-y-0 end-2.5 my-auto text-xs text-muted-foreground hover:text-foreground"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Sort controls */}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="font-medium me-1">{isAr ? 'الترتيب:' : 'Sort:'}</span>
                  {(
                    [
                      { id: 'quantity', label: isAr ? 'الكمية' : 'Quantity' },
                      { id: 'revenue', label: isAr ? 'الإيراد' : 'Revenue' },
                      { id: 'avg_price', label: isAr ? 'السعر' : 'Price' },
                      { id: 'name', label: isAr ? 'الاسم' : 'Name' },
                    ] as const
                  ).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        if (itemSortField === s.id) {
                          setItemSortAsc(!itemSortAsc);
                        } else {
                          setItemSortField(s.id);
                          setItemSortAsc(s.id === 'name');
                        }
                      }}
                      className={`h-7 px-2.5 rounded-lg border text-xs font-semibold transition-colors ${
                        itemSortField === s.id
                          ? 'border-brand bg-brand text-white'
                          : 'border-border bg-card text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {s.label} {itemSortField === s.id ? (itemSortAsc ? '↑' : '↓') : ''}
                    </button>
                  ))}
                </div>
              </div>

              {/* Category Filter Pills */}
              {categoriesList.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setItemCategoryFilter('all')}
                    className={`h-6 px-2.5 rounded-full text-[11px] font-semibold transition-colors ${
                      itemCategoryFilter === 'all'
                        ? 'bg-foreground text-background'
                        : 'bg-card border border-border text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {isAr ? 'الكل' : 'All'} ({topProducts.length})
                  </button>
                  {categoriesList.map((cat) => {
                    const count = topProducts.filter((p) => p.category_name === cat).length;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setItemCategoryFilter(cat)}
                        className={`h-6 px-2.5 rounded-full text-[11px] font-semibold transition-colors ${
                          itemCategoryFilter === cat
                            ? 'bg-brand text-white'
                            : 'bg-card border border-border text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        {cat} ({count})
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Summary Stats Strip */}
              <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-muted-foreground pt-1">
                <span>
                  {isAr ? 'عدد الأصناف المطلوبة:' : 'Ordered Items:'}{' '}
                  <strong className="text-foreground">{topProducts.length}</strong>
                </span>
                <span>•</span>
                <span>
                  {isAr ? 'إجمالي القطع المباعة:' : 'Total Units Sold:'}{' '}
                  <strong className="text-foreground">{totalOrderedQuantity}</strong>
                </span>
                <span>•</span>
                <span>
                  {isAr ? 'إجمالي مبيعات الأصناف:' : 'Total Items Revenue:'}{' '}
                  <strong className="text-foreground">{fmt(totalOrderedRevenue)}</strong>
                </span>
              </div>
            </div>

            {/* Table */}
            {filteredOrderedItems.length === 0 ? (
              <div className="flex min-h-48 flex-col items-center justify-center px-6 py-12 text-center">
                <span className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                  <Package size={24} />
                </span>
                <p className="text-sm font-semibold text-foreground">
                  {isAr ? 'لا توجد منتجات مطابقة في هذه الفترة' : 'No matching items ordered in this period'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {isAr ? 'جرّب تغيير التاريخ أو كلمات البحث' : 'Try selecting another date or clearing your search'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-start text-xs">
                  <thead className="border-b border-border bg-muted/40 font-semibold text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-start w-12">#</th>
                      <th className="px-4 py-3 text-start">{isAr ? 'المنتج والقسم' : 'Product & Category'}</th>
                      <th className="px-4 py-3 text-start min-w-[160px]">{isAr ? 'الكمية المطلوبة' : 'Quantity Sold'}</th>
                      <th className="px-4 py-3 text-end">{isAr ? 'متوسط السعر' : 'Avg Unit Price'}</th>
                      <th className="px-4 py-3 text-end">{isAr ? 'إجمالي المبيعات' : 'Total Revenue'}</th>
                      <th className="px-4 py-3 text-end">{isAr ? 'نسبة المبيعات' : 'Sales Share'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredOrderedItems.map((item, idx) => {
                      const avgPrice = item.avg_price ?? (item.total_quantity > 0 ? item.total_revenue / item.total_quantity : 0);
                      const sharePercent = totalOrderedRevenue > 0
                        ? Math.round((item.total_revenue / totalOrderedRevenue) * 100)
                        : 0;
                      const qtyBarPercent = maxProductQuantity > 0
                        ? Math.max(8, Math.round((item.total_quantity / maxProductQuantity) * 100))
                        : 0;
                      const isTop3 = idx < 3 && itemSortField === 'quantity' && !itemSortAsc;

                      return (
                        <tr key={item.product_id} className="transition-colors hover:bg-muted/40">
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex size-6 items-center justify-center rounded-lg text-[11px] font-bold ${
                                isTop3
                                  ? idx === 0
                                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200'
                                    : idx === 1
                                      ? 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
                                      : 'bg-amber-50 text-amber-700 border border-amber-300 dark:bg-amber-950/40 dark:text-amber-300'
                                  : 'text-muted-foreground'
                              }`}
                            >
                              {idx + 1}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-foreground text-sm">{item.product_name}</div>
                            {item.category_name && (
                              <span className="inline-block mt-0.5 text-[11px] px-2 py-0.5 rounded-md bg-muted text-muted-foreground font-medium">
                                {item.category_name}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <span className="font-bold text-foreground text-sm min-w-8">
                                {item.total_quantity}
                              </span>
                              <div className="h-2 flex-1 max-w-[120px] rounded-full bg-muted overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-brand transition-all"
                                  style={{ width: `${qtyBarPercent}%` }}
                                />
                              </div>
                              <span className="text-[11px] text-muted-foreground">
                                ({item.order_count} {isAr ? 'طلب' : 'orders'})
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-end font-medium text-muted-foreground">
                            {fmt(avgPrice)}
                          </td>
                          <td className="px-4 py-3 text-end font-bold text-foreground">
                            {fmt(Number(item.total_revenue))}
                          </td>
                          <td className="px-4 py-3 text-end">
                            <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full bg-brand/10 text-brand">
                              {sharePercent}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Payment Methods */}
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="flex items-center gap-3 border-b border-border px-5 py-4">
                <span className="flex size-9 items-center justify-center rounded-xl bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300">
                  <Wallet size={16} />
                </span>
                <h2 className="font-semibold text-foreground">{t('paymentMethods')}</h2>
              </div>
              <div className="p-5">
                {paymentMethods.length === 0 ? (
                  <div className="flex min-h-40 flex-col items-center justify-center text-center">
                    <span className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                      <Wallet size={23} />
                    </span>
                    <p className="text-sm font-medium text-foreground">{t('noPaymentsYet')}</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {paymentMethods.map((pm) => {
                      const meta = PAYMENT_METHODS.find((m) => m.key === pm.method);
                      const Icon = meta?.icon ?? Wallet;
                      const label = meta ? tPos(BUILT_IN_PAYMENT_KEYS[meta.key]) : pm.method === 'wallet' ? tPos('methodWallet') : String(pm.method || tCommon('unknown'));
                      const percent = paymentMethodsTotal > 0
                        ? Math.max(0, Math.min(100, Math.round((Number(pm.total) / paymentMethodsTotal) * 100)))
                        : 0;
                      return (
                        <div key={pm.method ?? 'unknown'}>
                          <div className="mb-1.5 flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <Icon size={14} className="text-muted-foreground" />
                              <span className="truncate text-sm font-medium text-foreground">{label}</span>
                            </div>
                            <span className="shrink-0 text-sm font-semibold text-foreground">{fmt(Number(pm.total))}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                              <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${percent}%` }} />
                            </div>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {t('paymentMethodCount', { count: pm.count, percent })}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Business Patterns */}
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="border-b border-border px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/50 dark:text-fuchsia-300">
                    <BarChart3 size={16} />
                  </span>
                  <div>
                    <h2 className="font-semibold text-foreground">{t('businessPatterns')}</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t('businessPatternsHint', { days: insights?.windowDays ?? 30 })}</p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4">
                <div className="bg-card p-4">
                  <p className="text-xs text-muted-foreground">{t('busiestHour')}</p>
                  <p className="mt-2 text-lg font-bold text-foreground">
                    {insights?.busiestHour ? formatHourLabel(insights.busiestHour.hour, locale) : t('notEnoughData')}
                  </p>
                  {insights?.busiestHour && <p className="mt-1 text-xs text-muted-foreground">{t('ordersCount', { count: insights.busiestHour.orderCount })}</p>}
                </div>
                <div className="bg-card p-4">
                  <p className="text-xs text-muted-foreground">{t('idlestHour')}</p>
                  <p className="mt-2 text-lg font-bold text-foreground">
                    {insights?.idlestHour ? formatHourLabel(insights.idlestHour.hour, locale) : t('notEnoughData')}
                  </p>
                  {insights?.idlestHour && <p className="mt-1 text-xs text-muted-foreground">{t('ordersCount', { count: insights.idlestHour.orderCount })}</p>}
                </div>
                <div className="bg-card p-4">
                  <p className="text-xs text-muted-foreground">{t('busiestDay')}</p>
                  <p className="mt-2 text-lg font-bold text-foreground">
                    {insights?.busiestDayOfWeek ? formatWeekdayLabel(insights.busiestDayOfWeek.dayIndex, locale) : t('notEnoughData')}
                  </p>
                  {insights?.busiestDayOfWeek && <p className="mt-1 text-xs text-muted-foreground">{t('ordersCount', { count: insights.busiestDayOfWeek.orderCount })}</p>}
                </div>
                <div className="bg-card p-4">
                  <p className="text-xs text-muted-foreground">{t('idlestDay')}</p>
                  <p className="mt-2 text-lg font-bold text-foreground">
                    {insights?.idlestDayOfWeek ? formatWeekdayLabel(insights.idlestDayOfWeek.dayIndex, locale) : t('notEnoughData')}
                  </p>
                  {insights?.idlestDayOfWeek && <p className="mt-1 text-xs text-muted-foreground">{t('ordersCount', { count: insights.idlestDayOfWeek.orderCount })}</p>}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
