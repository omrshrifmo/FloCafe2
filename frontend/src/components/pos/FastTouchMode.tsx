'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useCartStore, buildActiveCartPayload } from '@/store/cart';
import { useHeldOrdersStore, type HeldOrder } from '@/store/held-orders';
import { usePrinterStore } from '@/hooks/usePrinter';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { nameToColor } from '@/lib/image-utils';
import { Button } from '@/components/ui/button';
import { useTranslations, useLocale } from 'use-intl';
import api from '@/lib/api';
import axios from 'axios';
import { parseDbTimestamp } from '@/lib/utils';
import toast from 'react-hot-toast';
import type { Category, Product, Table, CartItem, Order, OrderItem } from '@/lib/types';
import {
  Zap,
  Repeat,
  Trash2,
  UtensilsCrossed,
  Package,
  Plus,
  Minus,
  Pause,
  Printer,
  ArrowRightLeft,
  CreditCard,
  MessageSquare,
  SquarePen,
  Users,
  Check,
  X,
  Search,
  Clock,
  RotateCcw,
  CheckCircle2,
  Lock,
} from 'lucide-react';

interface FastTouchModeProps {
  categories: Category[];
  products: Product[];
  tables?: Table[];
  currency?: string;
  submitting?: boolean;
  pendingOrder?: Order | null;
  onExit: () => void;
  onProductClick?: (product: Product) => void;
  onPlaceOrder?: () => void;
  onShowTablePicker?: () => void;
  onShowSplitMove?: (table?: Table) => void;
  onEditItem?: (item: CartItem) => void;
  onCheckout?: () => void;
  onTableCheckout?: (table: Table) => void;
  onQuickCheckout?: (method: 'cash' | 'card', tenderAmount?: number) => void;
  hasOpenShift?: boolean;
  onOpenShift?: () => void;
}

// Canonical Category Color Mapping matching FloCafe category palette
const CATEGORY_COLOR_MAP: Record<string, { bg: string; text: string; border: string; activeBg: string; activeText: string; accentStripe: string }> = {
  red: {
    bg: 'bg-red-50/80 dark:bg-red-950/30',
    text: 'text-red-700 dark:text-red-300',
    border: 'border-red-300 dark:border-red-800/50',
    activeBg: 'bg-red-600',
    activeText: 'text-white',
    accentStripe: 'bg-red-500',
  },
  orange: {
    bg: 'bg-orange-50/80 dark:bg-orange-950/30',
    text: 'text-orange-700 dark:text-orange-300',
    border: 'border-orange-300 dark:border-orange-800/50',
    activeBg: 'bg-orange-600',
    activeText: 'text-white',
    accentStripe: 'bg-orange-500',
  },
  amber: {
    bg: 'bg-amber-50/80 dark:bg-amber-950/30',
    text: 'text-amber-800 dark:text-amber-300',
    border: 'border-amber-300 dark:border-amber-800/50',
    activeBg: 'bg-amber-600',
    activeText: 'text-white',
    accentStripe: 'bg-amber-500',
  },
  yellow: {
    bg: 'bg-yellow-50/80 dark:bg-yellow-950/30',
    text: 'text-yellow-800 dark:text-yellow-300',
    border: 'border-yellow-300 dark:border-yellow-800/50',
    activeBg: 'bg-yellow-500',
    activeText: 'text-slate-950',
    accentStripe: 'bg-yellow-400',
  },
  lime: {
    bg: 'bg-lime-50/80 dark:bg-lime-950/30',
    text: 'text-lime-800 dark:text-lime-300',
    border: 'border-lime-300 dark:border-lime-800/50',
    activeBg: 'bg-lime-600',
    activeText: 'text-white',
    accentStripe: 'bg-lime-500',
  },
  green: {
    bg: 'bg-green-50/80 dark:bg-green-950/30',
    text: 'text-green-800 dark:text-green-300',
    border: 'border-green-300 dark:border-green-800/50',
    activeBg: 'bg-green-600',
    activeText: 'text-white',
    accentStripe: 'bg-green-500',
  },
  emerald: {
    bg: 'bg-emerald-50/80 dark:bg-emerald-950/30',
    text: 'text-emerald-800 dark:text-emerald-300',
    border: 'border-emerald-300 dark:border-emerald-800/50',
    activeBg: 'bg-emerald-600',
    activeText: 'text-white',
    accentStripe: 'bg-emerald-500',
  },
  teal: {
    bg: 'bg-teal-50/80 dark:bg-teal-950/30',
    text: 'text-teal-800 dark:text-teal-300',
    border: 'border-teal-300 dark:border-teal-800/50',
    activeBg: 'bg-teal-600',
    activeText: 'text-white',
    accentStripe: 'bg-teal-500',
  },
  cyan: {
    bg: 'bg-cyan-50/80 dark:bg-cyan-950/30',
    text: 'text-cyan-800 dark:text-cyan-300',
    border: 'border-cyan-300 dark:border-cyan-800/50',
    activeBg: 'bg-cyan-600',
    activeText: 'text-white',
    accentStripe: 'bg-cyan-500',
  },
  sky: {
    bg: 'bg-sky-50/80 dark:bg-sky-950/30',
    text: 'text-sky-800 dark:text-sky-300',
    border: 'border-sky-300 dark:border-sky-800/50',
    activeBg: 'bg-sky-600',
    activeText: 'text-white',
    accentStripe: 'bg-sky-500',
  },
  blue: {
    bg: 'bg-blue-50/80 dark:bg-blue-950/30',
    text: 'text-blue-800 dark:text-blue-300',
    border: 'border-blue-300 dark:border-blue-800/50',
    activeBg: 'bg-blue-600',
    activeText: 'text-white',
    accentStripe: 'bg-blue-500',
  },
  indigo: {
    bg: 'bg-indigo-50/80 dark:bg-indigo-950/30',
    text: 'text-indigo-800 dark:text-indigo-300',
    border: 'border-indigo-300 dark:border-indigo-800/50',
    activeBg: 'bg-indigo-600',
    activeText: 'text-white',
    accentStripe: 'bg-indigo-500',
  },
  violet: {
    bg: 'bg-violet-50/80 dark:bg-violet-950/30',
    text: 'text-violet-800 dark:text-violet-300',
    border: 'border-violet-300 dark:border-violet-800/50',
    activeBg: 'bg-violet-600',
    activeText: 'text-white',
    accentStripe: 'bg-violet-500',
  },
  purple: {
    bg: 'bg-purple-50/80 dark:bg-purple-950/30',
    text: 'text-purple-800 dark:text-purple-300',
    border: 'border-purple-300 dark:border-purple-800/50',
    activeBg: 'bg-purple-600',
    activeText: 'text-white',
    accentStripe: 'bg-purple-500',
  },
  fuchsia: {
    bg: 'bg-fuchsia-50/80 dark:bg-fuchsia-950/30',
    text: 'text-fuchsia-800 dark:text-fuchsia-300',
    border: 'border-fuchsia-300 dark:border-fuchsia-800/50',
    activeBg: 'bg-fuchsia-600',
    activeText: 'text-white',
    accentStripe: 'bg-fuchsia-500',
  },
  pink: {
    bg: 'bg-pink-50/80 dark:bg-pink-950/30',
    text: 'text-pink-800 dark:text-pink-300',
    border: 'border-pink-300 dark:border-pink-800/50',
    activeBg: 'bg-pink-600',
    activeText: 'text-white',
    accentStripe: 'bg-pink-500',
  },
  rose: {
    bg: 'bg-rose-50/80 dark:bg-rose-950/30',
    text: 'text-rose-800 dark:text-rose-300',
    border: 'border-rose-300 dark:border-rose-800/50',
    activeBg: 'bg-rose-600',
    activeText: 'text-white',
    accentStripe: 'bg-rose-500',
  },
  slate: {
    bg: 'bg-slate-100 dark:bg-slate-900/50',
    text: 'text-slate-800 dark:text-slate-200',
    border: 'border-slate-300 dark:border-slate-700',
    activeBg: 'bg-slate-700',
    activeText: 'text-white',
    accentStripe: 'bg-slate-600',
  },
  gray: {
    bg: 'bg-gray-100 dark:bg-gray-900/50',
    text: 'text-gray-800 dark:text-gray-200',
    border: 'border-gray-300 dark:border-gray-700',
    activeBg: 'bg-gray-700',
    activeText: 'text-white',
    accentStripe: 'bg-gray-600',
  },
};

const DEFAULT_CATEGORY_STYLE = {
  bg: 'bg-card',
  text: 'text-foreground',
  border: 'border-border',
  activeBg: 'bg-brand',
  activeText: 'text-white',
  accentStripe: 'bg-brand',
};

export function FastTouchMode({
  categories,
  products,
  tables = [],
  submitting = false,
  pendingOrder = null,
  onExit,
  onProductClick,
  onPlaceOrder,
  onShowTablePicker,
  onShowSplitMove,
  onEditItem,
  onCheckout,
  onTableCheckout,
  onQuickCheckout,
  hasOpenShift = true,
  onOpenShift,
}: FastTouchModeProps) {
  const cart = useCartStore();
  const heldOrders = useHeldOrdersStore();
  const fmtCurrency = useFormatCurrency();
  const locale = useLocale();
  const isArabic = locale.startsWith('ar');

  const t = useTranslations('pos');
  const tPrint = useTranslations('print');

  const [selectedCatId, setSelectedCatId] = useState<string | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [printingPreliminary, setPrintingPreliminary] = useState(false);
  const [showHeldModal, setShowHeldModal] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const printPreliminaryReceipt = usePrinterStore((s) => s.printPreliminaryReceipt);

  // Quick item note inline editing state
  const [editingNoteItemId, setEditingNoteItemId] = useState<string | null>(null);
  const [itemNoteDraft, setItemNoteDraft] = useState('');

  // Served items state loaded from table's active order
  const [fetchedActiveOrder, setFetchedActiveOrder] = useState<Order | null>(null);
  const [loadingServedItems, setLoadingServedItems] = useState(false);

  // Table draft isolation across tables and order types
  const tableDraftsRef = useRef<Record<string, { items: CartItem[]; guestCount: number; orderNotes: string }>>({});
  const currentScopeKey = cart.orderType === 'dine_in' ? `table:${cart.tableId || 'none'}` : 'takeaway';
  const previousScopeKeyRef = useRef<string>(currentScopeKey);

  useEffect(() => {
    const prevKey = previousScopeKeyRef.current;
    if (prevKey !== currentScopeKey) {
      // Save items from previous scope
      const currentCartState = useCartStore.getState();
      tableDraftsRef.current[prevKey] = {
        items: currentCartState.items,
        guestCount: currentCartState.guestCount,
        orderNotes: currentCartState.orderNotes,
      };

      // Restore items for new scope
      const targetDraft = tableDraftsRef.current[currentScopeKey];
      if (targetDraft) {
        cart.loadItems(targetDraft.items, cart.tableId, cart.customerId, targetDraft.guestCount, targetDraft.orderNotes);
      } else {
        cart.loadItems([], cart.tableId, cart.customerId, cart.guestCount, '');
      }

      previousScopeKeyRef.current = currentScopeKey;
    }
  }, [currentScopeKey, cart.tableId, cart.customerId]);

  // Derive active order: pendingOrder takes precedence, followed by fetched table order
  const activeTableOrder = (cart.orderType === 'dine_in' && cart.tableId)
    ? (pendingOrder || fetchedActiveOrder)
    : null;

  // Global Escape keyboard listener to exit Fast-Touch
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onExit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onExit]);

  // Selected table
  const currentTable = useMemo(() => {
    if (!cart.tableId) return null;
    return tables.find((tb) => String(tb.id) === String(cart.tableId)) || null;
  }, [tables, cart.tableId]);

  // Asynchronously load served order items when selected table changes without pendingOrder
  useEffect(() => {
    let isCancelled = false;
    if (!pendingOrder && cart.orderType === 'dine_in' && cart.tableId) {
      Promise.resolve().then(async () => {
        if (isCancelled) return;
        setLoadingServedItems(true);
        try {
          const { data } = await api.get(`/tables/${cart.tableId}`);
          if (isCancelled) return;
          const tbl = data.table;
          const order = tbl?.activeOrder || tbl?.current_order;
          if (order?.id) {
            const orderRes = await api.get(`/orders/${order.id}`);
            if (!isCancelled) setFetchedActiveOrder(orderRes.data.order || order);
          } else if (!isCancelled) {
            setFetchedActiveOrder(null);
          }
        } catch {
          if (!isCancelled) setFetchedActiveOrder(null);
        } finally {
          if (!isCancelled) setLoadingServedItems(false);
        }
      });
    }
    return () => {
      isCancelled = true;
    };
  }, [cart.tableId, cart.orderType, pendingOrder]);

  const servedItems: OrderItem[] = useMemo(() => {
    if (!activeTableOrder?.items) return [];
    return activeTableOrder.items.filter((item) => item.status !== 'cancelled' && item.status !== 'voided');
  }, [activeTableOrder]);

  const servedSubtotal = useMemo(() => {
    return servedItems.reduce((sum, item) => sum + (Number(item.total) || Number(item.subtotal) || (Number(item.unit_price) * item.quantity)), 0);
  }, [servedItems]);

  const cartSubtotal = cart.subtotal();
  const grandTotal = servedSubtotal + cartSubtotal;

  const allHeldOrdersList = useMemo(() => {
    return Object.values(heldOrders.orders || {});
  }, [heldOrders.orders]);

  // Category map for fast lookup
  const categoryMap = useMemo(() => {
    const map = new Map<string, Category>();
    categories.forEach((cat) => map.set(String(cat.id), cat));
    return map;
  }, [categories]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (!p.is_active) return false;
      if (selectedCatId !== 'all' && String(p.category_id) !== String(selectedCatId)) return false;
      if (q) {
        const matchesName = p.name.toLowerCase().includes(q);
        const matchesBarcode = p.barcode ? p.barcode.toLowerCase().includes(q) : false;
        const matchesSku = p.sku ? p.sku.toLowerCase().includes(q) : false;
        if (!matchesName && !matchesBarcode && !matchesSku) return false;
      }
      return true;
    });
  }, [products, selectedCatId, searchQuery]);

  // Repeat Last Item
  const handleRepeatLast = () => {
    if (hasOpenShift === false) {
      toast.error(isArabic ? 'يجب فتح الوردية أولاً قبل إنشاء أو تسجيل أي طلب.' : 'You must open a shift first before making any orders.');
      onOpenShift?.();
      return;
    }
    if (cart.items.length === 0) {
      toast.error(isArabic ? 'لا توجد عناصر في الطلب لتكرارها' : 'No items in order to repeat');
      return;
    }
    const lastItem = cart.items[cart.items.length - 1];
    cart.addItem(lastItem.product, 1, lastItem.addons, lastItem.special_instructions);
    toast.success(isArabic ? `تم تكرار: ${lastItem.product.name}` : `Repeated: ${lastItem.product.name}`);
  };

  // Pre-checkout receipt print
  const handlePrintPreliminary = async () => {
    if (printingPreliminary) return;
    if (cart.items.length === 0 && servedItems.length === 0) {
      toast.error(t('cartEmpty'));
      return;
    }
    setPrintingPreliminary(true);
    try {
      const cartPayload = buildActiveCartPayload(cart);
      const warnings = await printPreliminaryReceipt({ cart: cartPayload });
      if (warnings.length > 0) {
        toast(warnings[0].message || tPrint('preliminaryTitle'), { icon: '⚠️' });
      } else {
        toast.success(tPrint('preliminaryTitle'));
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : (isArabic ? 'فشل طباعة الفاتورة الأولية' : 'Failed to print preliminary receipt'));
    } finally {
      setPrintingPreliminary(false);
    }
  };

  // Hold order
  const handleHold = async () => {
    if (hasOpenShift === false) {
      toast.error(isArabic ? 'يجب فتح الوردية أولاً قبل إنشاء أو تسجيل أي طلب.' : 'You must open a shift first before making any orders.');
      onOpenShift?.();
      return;
    }
    if (cart.orderType === 'dine_in' && !cart.tableId) {
      toast.error(t('selectTableFirst'));
      return;
    }
    if (cart.items.length === 0) {
      toast.error(t('cartEmpty'));
      return;
    }
    const tableId = cart.tableId || 'takeaway';
    const tableName = currentTable?.name || (isArabic ? 'سفري' : 'Takeaway');
    try {
      await heldOrders.holdOrder(tableId, cart.items, cart.customerId, cart.guestCount, cart.orderNotes);
      cart.clearCart();
      toast.success(isArabic ? `تم تعليق الطلب لـ ${tableName}` : t('orderHeldFor', { table: tableName }));
    } catch {
      toast.error(t('holdOrderFailed'));
    }
  };

  // Restore held order
  const handleRestoreHeldOrder = async (held: HeldOrder) => {
    try {
      const restored = await heldOrders.restoreOrder(held.tableId);
      if (restored) {
        cart.loadItems(restored.items, restored.tableId, restored.customerId, restored.guestCount, restored.orderNotes, restored.id);
        cart.setOrderType(restored.tableId === 'takeaway' ? 'takeaway' : 'dine_in');
        setShowHeldModal(false);
        toast.success(isArabic ? 'تم استرجاع الطلب المعلق بنجاح' : 'Held order restored');
      } else {
        await heldOrders.fetchHeldOrders();
        toast.error(t('loadOrderFailed'));
      }
    } catch {
      toast.error(t('loadOrderFailed'));
    }
  };

  // Split / Move
  const handleSplitMove = () => {
    if (currentTable) {
      const hasOrder = currentTable.status === 'occupied' || Boolean(currentTable.current_order) || Boolean(currentTable.activeOrder);
      if (hasOrder) {
        onShowSplitMove?.(currentTable);
        return;
      }
      toast(isArabic ? 'اختر طاولة مشغولة تحتوي على طلب فعال للنقل أو التقسيم' : 'Select an occupied table with an active order to split or move', { icon: 'ℹ️' });
      onShowTablePicker?.();
    } else if (onShowTablePicker) {
      onShowTablePicker();
    }
  };

  // Serve Order
  const handleServeOrder = () => {
    if (hasOpenShift === false) {
      toast.error(isArabic ? 'يجب فتح الوردية أولاً قبل إنشاء أو تسجيل أي طلب.' : 'You must open a shift first before making any orders.');
      onOpenShift?.();
      return;
    }
    if (cart.items.length === 0) {
      toast.error(t('cartEmpty'));
      return;
    }
    if (cart.orderType === 'dine_in' && !cart.tableId) {
      toast.error(t('selectTableFirst'));
      onShowTablePicker?.();
      return;
    }
    onPlaceOrder?.();
  };

  // Handle direct checkout
  const handleCheckoutClick = async () => {
    if (hasOpenShift === false) {
      toast.error(isArabic ? 'يجب فتح الوردية أولاً قبل إنشاء أو تسجيل أي طلب.' : 'You must open a shift first before making any orders.');
      onOpenShift?.();
      return;
    }
    if (cart.items.length === 0 && servedItems.length === 0) {
      toast.error(t('cartEmpty'));
      return;
    }

    if (activeTableOrder && currentTable) {
      // If there are unsubmitted cart items for this table, append them first so the order is unified
      if (cart.items.length > 0) {
        setCheckingOut(true);
        try {
          const itemsPayload = cart.items.map((item) => ({
            product_id: Number(item.product.id),
            quantity: Number(item.quantity),
            unit_price: Number(item.product.price),
            notes: item.special_instructions || null,
            addons: item.addons?.map((addon) => ({
              addon_id: Number(addon.id),
              addon_name: addon.name,
              price: Number(addon.price),
              quantity: typeof addon.quantity === 'number' ? addon.quantity : 1,
            })) || [],
          }));

          await api.post(`/orders/${activeTableOrder.id}/items`, { items: itemsPayload });
          cart.clearCart();
          delete tableDraftsRef.current[currentScopeKey];
          // Refresh order and table state
          const { data } = await api.get(`/orders/${activeTableOrder.id}`);
          if (data?.order) setFetchedActiveOrder(data.order);
        } catch (err: unknown) {
          const msg = axios.isAxiosError(err) && err.response?.data?.error
            ? err.response.data.error
            : (isArabic ? 'فشل إضافة العناصر إلى الطلب' : 'Failed to add items to table order');
          toast.error(msg);
          setCheckingOut(false);
          return;
        } finally {
          setCheckingOut(false);
        }
      }

      if (onTableCheckout) {
        onTableCheckout(currentTable);
        return;
      }
      if (onShowSplitMove) {
        onShowSplitMove(currentTable);
        return;
      }
    }

    if (onCheckout) {
      onCheckout();
    } else if (onQuickCheckout) {
      onQuickCheckout('cash', grandTotal);
    }
  };

  // Tap product: 1-TAP DIRECT ADD if product has NO addons!
  const handleTileClick = (prod: Product) => {
    if (hasOpenShift === false) {
      toast.error(isArabic ? 'يجب فتح الوردية أولاً قبل إنشاء أو تسجيل أي طلب.' : 'You must open a shift first before making any orders.');
      onOpenShift?.();
      return;
    }
    const hasAddons = Boolean(
      prod.addon_groups &&
      prod.addon_groups.length > 0 &&
      prod.addon_groups.some((g) => g.is_active !== false && g.addons && g.addons.length > 0)
    );

    if (hasAddons && onProductClick) {
      onProductClick(prod);
    } else {
      cart.addItem(prod);
    }
  };

  // Save inline item note
  const handleSaveItemNote = (itemId: string) => {
    const item = cart.items.find((i) => i.id === itemId);
    if (!item) return;
    cart.updateItemDetails(itemId, item.quantity, item.addons, itemNoteDraft.trim());
    setEditingNoteItemId(null);
    setItemNoteDraft('');
  };

  return (
    <div className="fixed inset-0 z-40 bg-background flex flex-col overflow-hidden select-none">
      {/* =========================================================================
          TOP BAR:
          Physical Left: Bulletproof Exit Button & App Title
          Center: Order Type Switcher (Dine In / Takeaway) + Table Picker & Guest Count
          Physical Right: Held Orders, Repeat Last Item, Clear Cart
         ========================================================================= */}
      <div
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className="h-16 px-4 bg-card border-b border-border flex items-center justify-between shrink-0 gap-3 app-region-no-drag relative z-50 pointer-events-auto select-none"
        dir="ltr"
      >
        {/* 1. PHYSICAL LEFT: Exit button & Title */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            id="exit-fast-touch-btn"
            onClick={(e) => {
              e.stopPropagation();
              onExit();
            }}
            className="flex items-center gap-2 h-11 min-h-[44px] px-4 rounded-xl border border-rose-500/50 text-rose-600 dark:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 active:scale-[0.98] transition-all text-sm font-black shadow-sm cursor-pointer z-50 shrink-0 touch-manipulation select-none"
            title="Exit Fast-Touch POS (Esc)"
          >
            <X className="h-4 w-4 stroke-[2.5]" />
            <span>{isArabic ? 'خروج من اللمس السريع' : 'Exit Fast-Touch'}</span>
          </button>

          <div className="hidden sm:flex items-center gap-2">
            <div className="p-2 bg-amber-500/10 text-amber-500 rounded-lg">
              <Zap className="h-4 w-4" />
            </div>
            <span className="font-extrabold text-sm text-foreground">
              {isArabic ? 'نقاط البيع السريع' : 'Fast-Touch Express POS'}
            </span>
          </div>
        </div>

        {/* 2. TOP CENTER: Order Type (Dine In / Takeaway) + Table Selection & Guests */}
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-center" dir={isArabic ? 'rtl' : 'ltr'}>
          {/* Order Type Switcher */}
          <div className="flex items-center bg-muted/60 p-1 rounded-xl border border-border shrink-0 h-11">
            <button
              type="button"
              onClick={() => cart.setOrderType('dine_in')}
              className={`flex items-center gap-2 h-9 min-h-[36px] px-3.5 rounded-lg text-sm font-extrabold transition-all cursor-pointer touch-manipulation select-none ${
                cart.orderType === 'dine_in'
                  ? 'bg-brand text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <UtensilsCrossed className="h-4 w-4" />
              <span>{t('orderTypeDineIn')}</span>
            </button>

            <button
              type="button"
              onClick={() => cart.setOrderType('takeaway')}
              className={`flex items-center gap-2 h-9 min-h-[36px] px-3.5 rounded-lg text-sm font-extrabold transition-all cursor-pointer touch-manipulation select-none ${
                cart.orderType === 'takeaway'
                  ? 'bg-brand text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Package className="h-4 w-4" />
              <span>{t('orderTypeTakeaway')}</span>
            </button>
          </div>

          {/* Table Selector & Guests Stepper (Only active if Dine In) */}
          {cart.orderType === 'dine_in' && (
            <div className="flex items-center gap-2 shrink-0">
              {/* Table Button */}
              <button
                type="button"
                onClick={onShowTablePicker}
                className={`flex items-center gap-2.5 h-11 min-h-[44px] px-4 rounded-xl border text-sm font-extrabold transition-all cursor-pointer shadow-sm touch-manipulation select-none active:scale-[0.98] ${
                  currentTable
                    ? 'bg-card border-brand/50 text-foreground hover:bg-muted'
                    : 'bg-amber-500/15 border-amber-500/50 text-amber-900 dark:text-amber-200 animate-pulse'
                }`}
              >
                <UtensilsCrossed className="h-4 w-4 text-brand" />
                <span>
                  {currentTable
                    ? `${t('tableLabel')}: ${currentTable.name}`
                    : (isArabic ? 'اختر طاولة' : t('selectTable'))}
                </span>

                {currentTable?.status === 'occupied' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-black bg-orange-500/20 text-orange-600 dark:text-orange-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                    {isArabic ? 'مشغولة' : 'Occupied'}
                  </span>
                )}

                <span className="text-xs text-brand underline font-bold ms-0.5">
                  {isArabic ? 'تغيير' : 'Change'}
                </span>
              </button>

              {/* Guest Count Stepper */}
              <div className="flex items-center gap-1.5 bg-muted/60 px-2 py-0.5 rounded-xl border border-border h-11">
                <Users className="h-4 w-4 text-muted-foreground" />
                <button
                  type="button"
                  onClick={() => cart.setGuestCount(Math.max(1, cart.guestCount - 1))}
                  className="h-9 w-9 rounded-lg bg-card border border-border flex items-center justify-center text-sm font-bold hover:bg-muted active:scale-95 cursor-pointer touch-manipulation"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="text-sm font-black w-6 text-center font-mono">{cart.guestCount}</span>
                <button
                  type="button"
                  onClick={() => cart.setGuestCount(Math.min(99, cart.guestCount + 1))}
                  className="h-9 w-9 rounded-lg bg-card border border-border flex items-center justify-center text-sm font-bold hover:bg-muted active:scale-95 cursor-pointer touch-manipulation"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 3. PHYSICAL RIGHT: Held Orders, Repeat Last Item & Clear Cart */}
        <div className="flex items-center gap-2 shrink-0">
          {hasOpenShift === false && (
            <button
              type="button"
              onClick={onOpenShift}
              className="flex items-center gap-2 h-11 min-h-[44px] px-4 rounded-xl border border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-extrabold text-sm animate-pulse cursor-pointer hover:bg-amber-500/20 active:scale-[0.98] transition-all touch-manipulation"
            >
              <Lock className="h-4 w-4" />
              <span>{isArabic ? 'الوردية مغلقة - افتح الوردية' : 'Shift Closed - Open Shift'}</span>
            </button>
          )}

          {allHeldOrdersList.length > 0 && (
            <button
              type="button"
              onClick={() => setShowHeldModal(true)}
              className="flex items-center gap-2 h-11 min-h-[44px] px-4 rounded-xl text-sm bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30 hover:bg-amber-500/20 font-bold active:scale-[0.98] transition-all touch-manipulation cursor-pointer"
            >
              <Clock className="h-4 w-4" />
              <span>{isArabic ? `الطلبات المعلقة (${allHeldOrdersList.length})` : `Held Orders (${allHeldOrdersList.length})`}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleRepeatLast}
            disabled={cart.items.length === 0}
            className="flex items-center gap-2 h-11 min-h-[44px] px-4 rounded-xl text-sm text-brand border border-brand/30 hover:bg-brand/10 font-bold active:scale-[0.98] transition-all touch-manipulation cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
          >
            <Repeat className="h-4 w-4" />
            <span className="hidden sm:inline">{isArabic ? 'تكرار آخر صنف' : 'Repeat Last'}</span>
          </button>

          {cart.items.length > 0 && (
            <button
              type="button"
              onClick={() => {
                cart.clearCart();
                delete tableDraftsRef.current[currentScopeKey];
              }}
              className="flex items-center gap-2 h-11 min-h-[44px] px-3.5 rounded-xl text-sm text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 font-bold active:scale-[0.98] transition-all touch-manipulation cursor-pointer"
            >
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline ms-1">{isArabic ? 'إفراغ' : 'Clear'}</span>
            </button>
          )}
        </div>

        {/* 4. TOP-RIGHT 25% EMPTY SPACE: User requested the top-right 25% space to remain completely empty */}
        <div className="w-[25%] shrink-0 hidden md:block pointer-events-none" />
      </div>

      {/* =========================================================================
          MAIN 3-COLUMN VIEW:
          Column 1 (Left): Cart with Served Items, Pending Additions, Order Notes & 5 Bottom Buttons
          Column 2 (Center): Instant Search & Big Touch Product Grid
          Column 3 (Right): Category List with Assigned Colors & Icons
         ========================================================================= */}
      <div className="flex-1 flex overflow-hidden" dir="ltr">
        {/* =====================================================================
            1. LEFT COLUMN: Cart Panel with Served Items, New Items & Action Buttons
           ===================================================================== */}
        <div className="w-[380px] lg:w-[420px] bg-card border-r border-border shrink-0 flex flex-col overflow-hidden">
          <div className="flex-1 flex flex-col p-3 gap-2.5 overflow-hidden" dir={isArabic ? 'rtl' : 'ltr'}>
            {/* Table & Order status banner */}
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-muted/40 border border-border shrink-0">
              <div className="flex items-center gap-2">
                <UtensilsCrossed className="h-4 w-4 text-brand" />
                <div>
                  <div className="text-xs font-black text-foreground">
                    {cart.orderType === 'dine_in'
                      ? (currentTable ? `${t('tableLabel')}: ${currentTable.name}` : (isArabic ? 'طاولة غير محددة' : 'No Table Selected'))
                      : (isArabic ? 'طلب سفري' : 'Takeaway Order')}
                  </div>
                  {activeTableOrder && (
                    <div className="text-[10px] text-muted-foreground font-mono">
                      #{activeTableOrder.order_number} · {activeTableOrder.status}
                    </div>
                  )}
                </div>
              </div>

              {currentTable && (
                <span className={`text-[11px] font-black px-2 py-0.5 rounded-full ${
                  servedItems.length > 0
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {servedItems.length > 0
                    ? (isArabic ? `${servedItems.length} صنف مقدم` : `${servedItems.length} served`)
                    : (isArabic ? 'طاولة شاغرة' : 'New Table')}
                </span>
              )}
            </div>

            {/* Scrollable Items Container (Served Items + New Pending Items) */}
            <div className="flex-1 overflow-y-auto space-y-3 pe-1">
              {/* SECTION A: SERVED ITEMS (Items already ordered/served on this table) */}
              {servedItems.length > 0 && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-2.5 space-y-2">
                  <div className="flex items-center justify-between pb-1.5 border-b border-emerald-500/20 text-emerald-800 dark:text-emerald-200">
                    <div className="flex items-center gap-1.5 text-xs font-black">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>{isArabic ? 'عناصر مقدمة للطاولة (سابقاً)' : 'Served Items on Table'}</span>
                    </div>
                    <span className="text-xs font-mono font-bold">{fmtCurrency(servedSubtotal)}</span>
                  </div>

                  <div className="space-y-1.5">
                    {servedItems.map((item) => {
                      const itemTotal = Number(item.total) || Number(item.subtotal) || (Number(item.unit_price) * item.quantity);
                      return (
                        <div
                          key={item.id}
                          className="flex items-center justify-between p-2 rounded-lg bg-card/80 border border-emerald-500/20 text-xs"
                        >
                          <div className="flex-1 min-w-0 pe-2">
                            <div className="flex items-center gap-1.5">
                              <span className="px-1.5 py-0.2 rounded font-black text-[11px] bg-emerald-600 text-white font-mono shrink-0">
                                {item.quantity}×
                              </span>
                              <span className="font-bold text-foreground truncate">
                                {item.product_name}
                              </span>
                            </div>

                            {item.addons && item.addons.length > 0 && (
                              <div className="text-[10px] text-muted-foreground ps-6 truncate">
                                + {item.addons.map((a) => a.name).join(', ')}
                              </div>
                            )}

                            {item.special_instructions && (
                              <div className="text-[10px] text-amber-600 dark:text-amber-400 ps-6 italic truncate">
                                💬 {item.special_instructions}
                              </div>
                            )}
                          </div>

                          <div className="text-end shrink-0">
                            <span className="font-extrabold font-mono text-xs text-foreground">
                              {fmtCurrency(itemTotal)}
                            </span>
                            <div className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">
                              {isArabic ? 'مقدم' : 'Served'}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {loadingServedItems && (
                <div className="p-3 text-center text-xs text-muted-foreground animate-pulse">
                  {isArabic ? 'جاري تحميل الأصناف السابقة للطاولة...' : 'Loading served table items...'}
                </div>
              )}

              {/* SECTION B: NEW ITEMS TO ADD */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-black text-foreground px-1">
                  <span>
                    {isArabic ? 'أصناف جديدة قيد الطلب' : 'New Items in Cart'} ({cart.items.length})
                  </span>
                  {cart.items.length > 0 && (
                    <span className="font-mono text-brand font-bold">{fmtCurrency(cartSubtotal)}</span>
                  )}
                </div>

                {cart.items.length === 0 ? (
                  <div className="text-center py-6 px-4 border border-dashed border-border rounded-xl bg-muted/20 text-muted-foreground text-xs">
                    {isArabic
                      ? 'لا توجد أصناف جديدة مضافة. اضغط على أي صنف من القائمة لإضافته مباشرة بنقرة واحدة.'
                      : 'Cart is empty. Tap any product on the right to add it directly.'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {cart.items.map((line) => (
                      <div
                        key={line.id}
                        className="p-2.5 rounded-xl border border-border bg-card shadow-2xs space-y-1.5"
                      >
                        {/* Line Item Header: Name, Quantity & Price */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <span className="font-bold text-xs text-foreground truncate block">
                              {line.product.name}
                            </span>
                            <div className="text-[11px] text-muted-foreground font-mono">
                              {fmtCurrency(line.product.price)}
                            </div>
                          </div>

                          {/* Stepper */}
                          <div className="flex items-center gap-1 shrink-0 bg-muted/60 p-0.5 rounded-lg border border-border">
                            <button
                              type="button"
                              onClick={() => cart.updateQuantity(line.id, line.quantity - 1)}
                              className="h-6 w-6 rounded-md bg-card flex items-center justify-center text-xs font-bold hover:bg-muted active:scale-95 cursor-pointer"
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <span className="text-xs font-black w-6 text-center font-mono">
                              {line.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => cart.updateQuantity(line.id, line.quantity + 1)}
                              className="h-6 w-6 rounded-md bg-card flex items-center justify-center text-xs font-bold hover:bg-muted active:scale-95 cursor-pointer"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>

                          {/* Total for this line */}
                          <span className="text-xs font-black font-mono text-foreground shrink-0 w-16 text-end">
                            {fmtCurrency((line.product.price + line.addons.reduce((s, a) => s + a.price, 0)) * line.quantity)}
                          </span>

                          {/* Delete Item */}
                          <button
                            type="button"
                            onClick={() => cart.removeItem(line.id)}
                            className="p-1 rounded-md text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer shrink-0"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* Addons summary */}
                        {line.addons.length > 0 && (
                          <div className="text-[11px] text-muted-foreground ps-1 flex flex-wrap gap-1">
                            {line.addons.map((addon) => (
                              <span key={addon.id} className="bg-muted px-1.5 py-0.5 rounded text-[10px]">
                                + {addon.name} ({fmtCurrency(addon.price)})
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Special instructions / Inline Item Note */}
                        {line.special_instructions && (
                          <div className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-md flex items-center justify-between">
                            <span>💬 {line.special_instructions}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingNoteItemId(line.id);
                                setItemNoteDraft(line.special_instructions || '');
                              }}
                              className="text-[10px] text-brand underline cursor-pointer"
                            >
                              {isArabic ? 'تعديل' : 'Edit'}
                            </button>
                          </div>
                        )}

                        {/* Inline Note Editor */}
                        {editingNoteItemId === line.id ? (
                          <div className="flex items-center gap-1.5 pt-1">
                            <input
                              type="text"
                              value={itemNoteDraft}
                              onChange={(e) => setItemNoteDraft(e.target.value)}
                              placeholder={isArabic ? 'ملاحظة للصنف (بدون سكر، زيادة ثلج...)' : 'Item note...'}
                              className="flex-1 text-xs px-2 py-1 rounded border border-brand bg-background focus:outline-none"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveItemNote(line.id);
                                if (e.key === 'Escape') setEditingNoteItemId(null);
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveItemNote(line.id)}
                              className="p-1 rounded bg-brand text-white hover:bg-brand/90 cursor-pointer"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingNoteItemId(null)}
                              className="p-1 rounded bg-muted text-muted-foreground hover:bg-muted/80 cursor-pointer"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 pt-0.5">
                            {!line.special_instructions && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingNoteItemId(line.id);
                                  setItemNoteDraft('');
                                }}
                                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-brand cursor-pointer"
                              >
                                <MessageSquare className="h-3 w-3" />
                                <span>{isArabic ? 'إضافة ملاحظة للصنف' : 'Add Note'}</span>
                              </button>
                            )}

                            {onEditItem && (
                              <button
                                type="button"
                                onClick={() => onEditItem(line)}
                                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-brand ms-auto cursor-pointer"
                              >
                                <SquarePen className="h-3 w-3" />
                                <span>{isArabic ? 'تعديل الخيارات' : 'Edit Options'}</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Whole Order Notes Textarea */}
            <div className="shrink-0 space-y-1">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground font-semibold">
                <span className="flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" />
                  {isArabic ? 'ملاحظات الطلب العام' : 'Order Notes'}
                </span>
                <span>{cart.orderNotes.length}/200</span>
              </div>
              <textarea
                value={cart.orderNotes}
                onChange={(e) => cart.setOrderNotes(e.target.value.slice(0, 200))}
                placeholder={isArabic ? 'اكتب ملاحظات عامة للطلب هنا...' : t('orderNotesPlaceholder')}
                rows={1}
                maxLength={200}
                className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-brand resize-none"
              />
            </div>

            {/* Subtotal & Grand Total Display */}
            <div className="p-2.5 bg-muted/40 rounded-xl border border-border space-y-1 shrink-0">
              {servedItems.length > 0 && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{isArabic ? 'أصناف مقدمة سابقة:' : 'Served subtotal:'}</span>
                  <span className="font-mono font-bold">{fmtCurrency(servedSubtotal)}</span>
                </div>
              )}

              {cart.items.length > 0 && servedItems.length > 0 && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{isArabic ? 'أصناف جديدة مضافة:' : 'New items subtotal:'}</span>
                  <span className="font-mono font-bold">{fmtCurrency(cartSubtotal)}</span>
                </div>
              )}

              <div className="flex items-center justify-between pt-1 border-t border-border/60">
                <div>
                  <span className="text-xs text-muted-foreground font-bold">{t('total')}</span>
                  <div className="text-[10px] text-muted-foreground">
                    {servedItems.length + cart.itemCount()} {t('items')}
                  </div>
                </div>
                <span className="text-2xl font-black text-foreground font-mono">{fmtCurrency(grandTotal)}</span>
              </div>
            </div>

            {/* The 5 Bottom Action Buttons */}
            <div className="space-y-2 shrink-0 pt-0.5">
              <div className="grid grid-cols-2 gap-2">
                {/* 1. Serve Order Button */}
                <Button
                  size="default"
                  disabled={cart.items.length === 0 || submitting}
                  onClick={handleServeOrder}
                  className="h-11 bg-brand hover:bg-brand/90 text-white font-bold text-xs gap-1.5 rounded-xl shadow-2xs cursor-pointer"
                >
                  <UtensilsCrossed className="h-4 w-4" />
                  <span>{isArabic ? 'تقديم الطلب (للمطبخ)' : t('placeOrderButton')}</span>
                </Button>

                {/* 2. Hold Order Button */}
                <Button
                  variant="outline"
                  size="default"
                  disabled={cart.items.length === 0}
                  onClick={handleHold}
                  className="h-11 text-xs font-bold gap-1.5 rounded-xl border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 cursor-pointer"
                >
                  <Pause className="h-4 w-4" />
                  <span>{isArabic ? 'تعليق الطلب' : t('holdButton')}</span>
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {/* 3. Order Splitting and Moving Button */}
                <Button
                  variant="outline"
                  size="default"
                  onClick={handleSplitMove}
                  className="h-11 text-xs font-bold gap-1.5 rounded-xl border-border text-foreground hover:bg-muted cursor-pointer"
                >
                  <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
                  <span>{isArabic ? 'تقسيم / نقل' : 'Split / Move'}</span>
                </Button>

                {/* 4. Pre-checkout Receipt Print Button */}
                <Button
                  variant="outline"
                  size="default"
                  disabled={(cart.items.length === 0 && servedItems.length === 0) || printingPreliminary}
                  onClick={handlePrintPreliminary}
                  className="h-11 text-xs font-bold gap-1.5 rounded-xl border-border text-foreground hover:bg-muted cursor-pointer"
                >
                  <Printer className="h-4 w-4 text-muted-foreground" />
                  <span>{printingPreliminary ? (isArabic ? 'جاري الطباعة...' : 'Printing...') : (isArabic ? 'طباعة أولية' : t('printBill'))}</span>
                </Button>
              </div>

              {/* 5. Single Direct Checkout Button */}
              <Button
                size="lg"
                disabled={(cart.items.length === 0 && servedItems.length === 0) || checkingOut}
                onClick={handleCheckoutClick}
                className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-black text-sm gap-2 rounded-xl shadow-md transition-all active:scale-[0.99] cursor-pointer"
              >
                <CreditCard className="h-5 w-5" />
                <span>
                  {checkingOut
                    ? (isArabic ? 'جاري تجهيز الحساب...' : 'Preparing Checkout...')
                    : (isArabic ? 'الدفع وإنهاء الحساب' : t('checkout'))} · {fmtCurrency(grandTotal)}
                </span>
              </Button>
            </div>
          </div>
        </div>

        {/* =====================================================================
            2. CENTER COLUMN: Instant Search & Products Grid with Guaranteed Names
           ===================================================================== */}
        <div className="flex-1 flex flex-col p-3 overflow-hidden gap-2">
          {/* Quick search input */}
          <div className="flex items-center gap-2 bg-card px-3 py-2 rounded-xl border border-border shadow-2xs shrink-0" dir={isArabic ? 'rtl' : 'ltr'}>
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isArabic ? `بحث في الأصناف والباركود (${filteredProducts.length} صنف)...` : `Search items & barcodes (${filteredProducts.length} products)...`}
              className="flex-1 bg-transparent text-xs focus:outline-none text-foreground placeholder:text-muted-foreground"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="p-1 rounded-full text-muted-foreground hover:bg-muted cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Product Big Touch Tiles Grid */}
          <div className="flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 p-1 content-start" dir={isArabic ? 'rtl' : 'ltr'}>
            {filteredProducts.map((prod) => {
              const category = categoryMap.get(String(prod.category_id));
              const catColorKey = category?.color?.toLowerCase() || '';
              const style = CATEGORY_COLOR_MAP[catColorKey] || DEFAULT_CATEGORY_STYLE;

              const hasAddons = Boolean(
                prod.addon_groups &&
                prod.addon_groups.length > 0 &&
                prod.addon_groups.some((g) => g.is_active !== false && g.addons && g.addons.length > 0)
              );

              const prodWithImg = prod as Product & { image_url?: string; image?: string };
              const hasImg = prod.has_image || Boolean(prodWithImg.image_url) || Boolean(prodWithImg.image);
              const imgUrl = hasImg
                ? (prodWithImg.image_url || prodWithImg.image || `${api.defaults.baseURL}/products/${prod.id}/image?t=${prod.updated_at ? parseDbTimestamp(prod.updated_at).getTime() : 0}`)
                : null;

              // Check quantity in active cart
              const inCartQty = cart.items
                .filter((line) => line.product.id === prod.id)
                .reduce((sum, line) => sum + line.quantity, 0);

              return (
                <button
                  key={prod.id}
                  type="button"
                  onClick={() => handleTileClick(prod)}
                  className={`min-h-[175px] rounded-2xl border flex flex-col justify-between text-start transition-all active:scale-[0.97] shadow-2xs hover:shadow-md relative overflow-hidden bg-card ${style.border} cursor-pointer group`}
                >
                  {/* Category Accent Stripe at the top of tile */}
                  <div className={`h-1.5 w-full shrink-0 ${style.accentStripe}`} />

                  {/* In-cart count badge */}
                  {inCartQty > 0 && (
                    <div className="absolute top-2.5 end-2.5 z-10 bg-brand text-white text-[11px] font-black h-5 min-w-5 px-1.5 rounded-full flex items-center justify-center shadow-md">
                      {inCartQty}×
                    </div>
                  )}

                  {/* Product Image / Color Initial */}
                  <div className="p-2.5 pb-1 flex-1 flex flex-col">
                    <div className="relative w-full h-20 rounded-xl overflow-hidden mb-2 bg-muted shrink-0">
                      <div
                        className="absolute inset-0 flex items-center justify-center font-black text-xl text-white/95"
                        style={{ backgroundColor: nameToColor(prod.name) }}
                      >
                        {prod.name.substring(0, 2).toUpperCase()}
                      </div>
                      {imgUrl ? (
                        <img
                          src={imgUrl}
                          alt={prod.name}
                          loading="lazy"
                          decoding="async"
                          className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      ) : null}
                    </div>

                    {/* ITEM NAME: Always visible, bold, high-contrast, clean 2-line clamp */}
                    <div className="font-bold text-xs sm:text-sm text-foreground leading-snug line-clamp-2 min-h-[2rem]">
                      {prod.name}
                    </div>
                  </div>

                  {/* Price & 1-Tap Add Indicator */}
                  <div className="p-2.5 pt-0 mt-auto flex items-center justify-between gap-1 border-t border-border/40 bg-muted/20">
                    <span className="font-black text-xs sm:text-sm font-mono text-foreground">
                      {fmtCurrency(prod.price)}
                    </span>

                    {hasAddons ? (
                      <span
                        className="text-[10px] font-black px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-700 dark:text-amber-300"
                      >
                        + {isArabic ? 'خيارات' : 'Options'}
                      </span>
                    ) : (
                      <div className={`h-6 w-6 rounded-lg flex items-center justify-center text-white ${style.activeBg} shadow-2xs`}>
                        <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* =====================================================================
            3. RIGHT COLUMN: Categories Column with Assigned Colors & Icons
           ===================================================================== */}
        <div className="w-48 lg:w-56 bg-card border-l border-border flex flex-col p-2.5 gap-2 shrink-0 overflow-hidden">
          <div className="text-xs font-black text-muted-foreground uppercase px-2 py-1 tracking-wider" dir={isArabic ? 'rtl' : 'ltr'}>
            {isArabic ? 'الفئات' : 'Categories'}
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 pe-1" dir={isArabic ? 'rtl' : 'ltr'}>
            {/* All Items Button */}
            <button
              type="button"
              onClick={() => setSelectedCatId('all')}
              className={`w-full px-3 py-2.5 rounded-xl text-xs font-black transition-all flex items-center justify-between border cursor-pointer ${
                selectedCatId === 'all'
                  ? 'bg-brand text-white border-brand shadow-sm'
                  : 'bg-card text-foreground border-border hover:bg-muted'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <span>🌟</span>
                <span>{t('allCategories')}</span>
              </span>
              <span className={`text-[11px] px-1.5 py-0.5 rounded-md font-mono ${selectedCatId === 'all' ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground'}`}>
                {products.length}
              </span>
            </button>

            {/* Individual Category Buttons with Assigned Database Colors & Icons */}
            {categories.map((cat) => {
              const isSelected = String(selectedCatId) === String(cat.id);
              const count = products.filter((p) => p.is_active && String(p.category_id) === String(cat.id)).length;
              const catColorKey = cat.color?.toLowerCase() || '';
              const style = CATEGORY_COLOR_MAP[catColorKey] || DEFAULT_CATEGORY_STYLE;

              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCatId(cat.id)}
                  className={`w-full px-3 py-2.5 rounded-xl text-xs font-black transition-all flex items-center justify-between border cursor-pointer ${
                    isSelected
                      ? `${style.activeBg} ${style.activeText} border-transparent shadow-md ring-2 ring-foreground/20`
                      : `${style.bg} ${style.text} ${style.border} hover:brightness-95`
                  }`}
                >
                  <span className="flex items-center gap-1.5 truncate me-1">
                    {cat.icon && <span className="text-sm shrink-0">{cat.icon}</span>}
                    <span className="truncate">{cat.name}</span>
                  </span>
                  <span className={`text-[11px] px-1.5 py-0.5 rounded-md font-mono shrink-0 ${isSelected ? 'bg-black/20 text-white' : 'bg-black/5 dark:bg-white/10 text-inherit'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* =========================================================================
          HELD ORDERS MODAL
         ========================================================================= */}
      {showHeldModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4" dir={isArabic ? 'rtl' : 'ltr'}>
          <div className="bg-card w-full max-w-lg rounded-2xl border border-border shadow-2xl p-5 flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-amber-500" />
                <h3 className="font-bold text-base text-foreground">
                  {isArabic ? 'الطلبات المعلقة' : 'Held Orders'} ({allHeldOrdersList.length})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowHeldModal(false)}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-3 space-y-2.5">
              {allHeldOrdersList.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-xs">
                  {isArabic ? 'لا توجد طلبات معلقة حالياً' : 'No held orders at the moment'}
                </div>
              ) : (
                allHeldOrdersList.map((held) => {
                  const heldTable = tables.find((t) => String(t.id) === String(held.tableId));
                  const heldTitle = heldTable?.name || (held.tableId === 'takeaway' ? (isArabic ? 'سفري' : 'Takeaway') : held.tableId);
                  const heldTotal = held.items.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);

                  return (
                    <div
                      key={held.tableId}
                      className="p-3 rounded-xl border border-border bg-muted/30 flex items-center justify-between gap-3"
                    >
                      <div>
                        <div className="font-bold text-sm text-foreground flex items-center gap-2">
                          <span>{heldTitle}</span>
                          <span className="text-[11px] font-normal text-muted-foreground font-mono">
                            ({held.items.length} {t('items')})
                          </span>
                        </div>
                        <div className="text-xs font-bold text-brand font-mono mt-0.5">
                          {fmtCurrency(heldTotal)}
                        </div>
                        {held.orderNotes && (
                          <div className="text-[11px] text-muted-foreground mt-1 truncate max-w-xs">
                            💬 {held.orderNotes}
                          </div>
                        )}
                      </div>

                      <Button
                        size="sm"
                        onClick={() => handleRestoreHeldOrder(held)}
                        className="bg-brand hover:bg-brand/90 text-white font-bold text-xs gap-1.5 rounded-lg shrink-0 cursor-pointer"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span>{isArabic ? 'استرجاع الطلب' : 'Restore'}</span>
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
