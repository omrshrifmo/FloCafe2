'use client';

import { useState, useMemo } from 'react';
import { useCartStore, buildActiveCartPayload } from '@/store/cart';
import { useHeldOrdersStore, type HeldOrder } from '@/store/held-orders';
import { usePrinterStore } from '@/hooks/usePrinter';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { nameToColor } from '@/lib/image-utils';
import { Button } from '@/components/ui/button';
import { useTranslations, useLocale } from 'use-intl';
import api from '@/lib/api';
import { parseDbTimestamp } from '@/lib/utils';
import toast from 'react-hot-toast';
import type { Category, Product, Table, CartItem } from '@/lib/types';
import {
  Zap,
  Repeat,
  Trash2,
  ArrowLeft,
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
} from 'lucide-react';

interface FastTouchModeProps {
  categories: Category[];
  products: Product[];
  tables?: Table[];
  currency?: string;
  submitting?: boolean;
  onExit: () => void;
  onProductClick?: (product: Product) => void;
  onPlaceOrder?: () => void;
  onShowTablePicker?: () => void;
  onShowSplitMove?: (table?: Table) => void;
  onEditItem?: (item: CartItem) => void;
  onCheckout?: () => void;
  onQuickCheckout?: (method: 'cash' | 'card', tenderAmount?: number) => void;
}

const CATEGORY_COLORS: string[] = [
  'bg-amber-500/10 border-amber-500/25 text-amber-950 dark:text-amber-100 hover:bg-amber-500/20',
  'bg-emerald-500/10 border-emerald-500/25 text-emerald-950 dark:text-emerald-100 hover:bg-emerald-500/20',
  'bg-blue-500/10 border-blue-500/25 text-blue-950 dark:text-blue-100 hover:bg-blue-500/20',
  'bg-purple-500/10 border-purple-500/25 text-purple-950 dark:text-purple-100 hover:bg-purple-500/20',
  'bg-rose-500/10 border-rose-500/25 text-rose-950 dark:text-rose-100 hover:bg-rose-500/20',
  'bg-cyan-500/10 border-cyan-500/25 text-cyan-950 dark:text-cyan-100 hover:bg-cyan-500/20',
];

export function FastTouchMode({
  categories,
  products,
  tables = [],
  submitting = false,
  onExit,
  onProductClick,
  onPlaceOrder,
  onShowTablePicker,
  onShowSplitMove,
  onEditItem,
  onCheckout,
  onQuickCheckout,
}: FastTouchModeProps) {
  const cart = useCartStore();
  const heldOrders = useHeldOrdersStore();
  const fmtCurrency = useFormatCurrency();
  const locale = useLocale();
  const isArabic = locale.startsWith('ar');

  const t = useTranslations('pos');
  const tCommon = useTranslations('common');
  const tPrint = useTranslations('print');

  const [selectedCatId, setSelectedCatId] = useState<string | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [printingPreliminary, setPrintingPreliminary] = useState(false);
  const [showHeldModal, setShowHeldModal] = useState(false);
  const printPreliminaryReceipt = usePrinterStore((s) => s.printPreliminaryReceipt);

  // Quick item note inline editing state
  const [editingNoteItemId, setEditingNoteItemId] = useState<string | null>(null);
  const [itemNoteDraft, setItemNoteDraft] = useState('');

  const total = cart.subtotal();

  const allHeldOrdersList = useMemo(() => {
    return Object.values(heldOrders.orders || {});
  }, [heldOrders.orders]);

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

  // Selected table name
  const currentTable = useMemo(() => {
    if (!cart.tableId) return null;
    return tables.find((tb) => String(tb.id) === String(cart.tableId)) || null;
  }, [tables, cart.tableId]);

  // Repeat Last Item
  const handleRepeatLast = () => {
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
    if (printingPreliminary || cart.items.length === 0) return;
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
      // Check if table has an active order
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
  const handleCheckoutClick = () => {
    if (cart.items.length === 0) {
      toast.error(t('cartEmpty'));
      return;
    }
    if (onCheckout) {
      onCheckout();
    } else if (onQuickCheckout) {
      onQuickCheckout('cash', total);
    }
  };

  // Tap product: if item has options/addons, open modal; otherwise fast 1-tap add
  const handleTileClick = (prod: Product) => {
    const hasAddons = prod.addon_groups && prod.addon_groups.length > 0;
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
      {/* Top Bar - Physical Left holds Exit Fast-Touch Button and Title */}
      <div className="h-14 px-4 bg-card border-b border-border flex items-center justify-between shrink-0" dir="ltr">
        {/* PHYSICAL LEFT: Exit button & Title */}
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={onExit}
            className="gap-1.5 text-xs font-bold bg-background border-border hover:bg-muted shadow-2xs"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>{isArabic ? 'خروج من اللمس السريع' : 'Exit Fast-Touch'}</span>
          </Button>

          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-amber-500/10 text-amber-500 rounded-lg">
              <Zap className="h-4 w-4" />
            </div>
            <span className="font-extrabold text-sm text-foreground">
              {isArabic ? 'نقاط البيع السريع' : 'Fast-Touch Express POS'}
            </span>
          </div>
        </div>

        {/* PHYSICAL RIGHT: Held orders, Repeat Last Item & Clear Cart */}
        <div className="flex items-center gap-2">
          {/* Held Orders quick badge button */}
          {allHeldOrdersList.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowHeldModal(true)}
              className="gap-1.5 text-xs bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30 hover:bg-amber-500/20 font-bold"
            >
              <Clock className="h-3.5 w-3.5" />
              <span>{isArabic ? `الطلبات المعلقة (${allHeldOrdersList.length})` : `Held Orders (${allHeldOrdersList.length})`}</span>
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={handleRepeatLast}
            disabled={cart.items.length === 0}
            className="gap-1.5 text-xs text-brand border-brand/30 hover:bg-brand/10 font-bold"
          >
            <Repeat className="h-3.5 w-3.5" />
            <span>{isArabic ? 'تكرار آخر صنف' : 'Repeat Last Item'}</span>
          </Button>

          {cart.items.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={cart.clearCart}
              className="text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 font-semibold"
            >
              <Trash2 className="h-3.5 w-3.5 me-1" />
              <span>{isArabic ? 'إفراغ السلة' : 'Clear'}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Main 3-Column Screen: Left=Cart, Center=Products Grid, Right=Categories */}
      <div className="flex-1 flex overflow-hidden" dir="ltr">
        {/* 1. LEFT COLUMN: Cart Panel with Order Type, Table, Items, Notes, & 5 Bottom Actions */}
        <div className="w-[380px] lg:w-[420px] bg-card border-r border-border shrink-0 flex flex-col overflow-hidden">
          <div className="flex-1 flex flex-col p-3 gap-2.5 overflow-hidden" dir={isArabic ? 'rtl' : 'ltr'}>
            {/* Order Type & Table Selection */}
            <div className="space-y-2 shrink-0 bg-muted/40 p-2.5 rounded-xl border border-border">
              {/* Takeaway / Dine In Selector */}
              <div className="flex gap-1.5 bg-card p-1 rounded-lg border border-border/80">
                <button
                  type="button"
                  onClick={() => cart.setOrderType('dine_in')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-bold transition-colors ${
                    cart.orderType === 'dine_in'
                      ? 'bg-brand text-white shadow-2xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <UtensilsCrossed className="h-3.5 w-3.5" />
                  <span>{t('orderTypeDineIn')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => cart.setOrderType('takeaway')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-bold transition-colors ${
                    cart.orderType === 'takeaway'
                      ? 'bg-brand text-white shadow-2xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Package className="h-3.5 w-3.5" />
                  <span>{t('orderTypeTakeaway')}</span>
                </button>
              </div>

              {/* Table Selector & Guest Count (shown when Dine In is selected) */}
              {cart.orderType === 'dine_in' && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onShowTablePicker}
                    className="flex-1 flex items-center justify-between px-3 py-2 bg-card hover:bg-muted/70 rounded-lg border border-border text-xs font-bold text-foreground transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <UtensilsCrossed className="h-4 w-4 text-brand" />
                      <span>
                        {currentTable
                          ? `${t('tableLabel')}: ${currentTable.name}`
                          : (isArabic ? 'اختر طاولة' : t('selectTable'))}
                      </span>
                    </div>
                    <span className="text-[11px] text-brand underline font-semibold">
                      {isArabic ? 'تغيير' : 'Change'}
                    </span>
                  </button>

                  <div className="flex items-center gap-1 bg-card px-2 py-1 rounded-lg border border-border">
                    <Users className="h-3.5 w-3.5 text-muted-foreground" />
                    <button
                      type="button"
                      onClick={() => cart.setGuestCount(Math.max(1, cart.guestCount - 1))}
                      className="h-5 w-5 rounded bg-muted flex items-center justify-center text-xs font-bold hover:bg-muted/80"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="text-xs font-bold w-4 text-center">{cart.guestCount}</span>
                    <button
                      type="button"
                      onClick={() => cart.setGuestCount(Math.min(99, cart.guestCount + 1))}
                      className="h-5 w-5 rounded bg-muted flex items-center justify-center text-xs font-bold hover:bg-muted/80"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Cart Items List */}
            <div className="flex-1 overflow-y-auto space-y-2 border border-border rounded-xl p-2.5 bg-muted/20">
              {cart.items.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-xs text-center py-8">
                  <Zap className="h-8 w-8 text-muted-foreground/30 mb-2" />
                  <span>{isArabic ? 'اضغط على الأصناف لإضافتها مباشرة' : 'Tap items to add directly'}</span>
                </div>
              ) : (
                cart.items.map((line) => (
                  <div
                    key={line.id}
                    className="p-2 rounded-xl bg-background border border-border/70 space-y-1.5 shadow-2xs"
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-xs text-foreground truncate">{line.product.name}</div>
                        <div className="text-[11px] text-muted-foreground font-mono">
                          {fmtCurrency(line.product.price)}
                        </div>
                      </div>

                      {/* Quantity & Total */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => cart.updateQuantity(line.id, line.quantity - 1)}
                          className="h-6 w-6 rounded-md bg-muted flex items-center justify-center text-foreground hover:bg-muted/80"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="font-bold text-xs w-5 text-center">{line.quantity}</span>
                        <button
                          type="button"
                          onClick={() => cart.updateQuantity(line.id, line.quantity + 1)}
                          className="h-6 w-6 rounded-md bg-muted flex items-center justify-center text-foreground hover:bg-muted/80"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                        <span className="font-bold text-xs font-mono ms-1 text-foreground min-w-12 text-end">
                          {fmtCurrency(line.product.price * line.quantity)}
                        </span>
                        <button
                          type="button"
                          onClick={() => cart.removeItem(line.id)}
                          className="p-1 text-muted-foreground hover:text-rose-600 rounded"
                          title={tCommon('remove')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Addons List */}
                    {line.addons.length > 0 && (
                      <div className="text-[11px] text-muted-foreground space-y-0.5 ps-2 border-s-2 border-brand/40">
                        {line.addons.map((addon) => (
                          <div key={addon.id} className="flex justify-between">
                            <span>+ {addon.name} {(addon.quantity || 1) > 1 ? `×${addon.quantity}` : ''}</span>
                            {Number(addon.price) > 0 && <span>{fmtCurrency(Number(addon.price) * (addon.quantity || 1))}</span>}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Special Instructions / Item Note */}
                    {line.special_instructions && editingNoteItemId !== line.id && (
                      <div className="flex items-center justify-between text-[11px] bg-muted/40 px-2 py-1 rounded-md text-muted-foreground italic">
                        <span className="truncate">💬 {line.special_instructions}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingNoteItemId(line.id);
                            setItemNoteDraft(line.special_instructions || '');
                          }}
                          className="text-[10px] text-brand underline ms-2 font-medium"
                        >
                          {tCommon('edit')}
                        </button>
                      </div>
                    )}

                    {/* Inline Item Note Edit Input */}
                    {editingNoteItemId === line.id ? (
                      <div className="flex items-center gap-1.5 pt-1">
                        <input
                          type="text"
                          value={itemNoteDraft}
                          onChange={(e) => setItemNoteDraft(e.target.value)}
                          placeholder={isArabic ? 'ملاحظة الصنف (مثل: بدون سكر)...' : 'Item note (e.g., extra ice)...'}
                          className="flex-1 text-xs px-2 py-1 rounded-md bg-muted/60 border border-border focus:outline-none focus:ring-1 focus:ring-brand"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveItemNote(line.id);
                            if (e.key === 'Escape') setEditingNoteItemId(null);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveItemNote(line.id)}
                          className="p-1 rounded bg-brand text-white hover:bg-brand/90"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingNoteItemId(null)}
                          className="p-1 rounded bg-muted text-muted-foreground hover:bg-muted/80"
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
                            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-brand"
                          >
                            <MessageSquare className="h-3 w-3" />
                            <span>{isArabic ? 'إضافة ملاحظة للصنف' : 'Add Note'}</span>
                          </button>
                        )}

                        {onEditItem && (
                          <button
                            type="button"
                            onClick={() => onEditItem(line)}
                            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-brand ms-auto"
                          >
                            <SquarePen className="h-3 w-3" />
                            <span>{isArabic ? 'تعديل الخيارات' : 'Edit Options'}</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
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
                rows={2}
                maxLength={200}
                className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-brand resize-none"
              />
            </div>

            {/* Subtotal Display */}
            <div className="p-2.5 bg-muted/40 rounded-xl border border-border flex items-center justify-between shrink-0">
              <div>
                <span className="text-xs text-muted-foreground font-semibold">{t('subtotal')}</span>
                <div className="text-[11px] text-muted-foreground">
                  {cart.itemCount()} {t('items')}
                </div>
              </div>
              <span className="text-2xl font-black text-foreground font-mono">{fmtCurrency(total)}</span>
            </div>

            {/* The 5 Bottom Action Buttons */}
            <div className="space-y-2 shrink-0 pt-0.5">
              <div className="grid grid-cols-2 gap-2">
                {/* 1. Serve Order Button */}
                <Button
                  size="default"
                  disabled={cart.items.length === 0 || submitting}
                  onClick={handleServeOrder}
                  className="h-11 bg-brand hover:bg-brand/90 text-white font-bold text-xs gap-1.5 rounded-xl shadow-2xs"
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
                  className="h-11 text-xs font-bold gap-1.5 rounded-xl border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
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
                  className="h-11 text-xs font-bold gap-1.5 rounded-xl border-border text-foreground hover:bg-muted"
                >
                  <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
                  <span>{isArabic ? 'تقسيم / نقل' : 'Split / Move'}</span>
                </Button>

                {/* 4. Pre-checkout Receipt Print Button */}
                <Button
                  variant="outline"
                  size="default"
                  disabled={cart.items.length === 0 || printingPreliminary}
                  onClick={handlePrintPreliminary}
                  className="h-11 text-xs font-bold gap-1.5 rounded-xl border-border text-foreground hover:bg-muted"
                >
                  <Printer className="h-4 w-4 text-muted-foreground" />
                  <span>{printingPreliminary ? (isArabic ? 'جاري الطباعة...' : 'Printing...') : (isArabic ? 'طباعة أولية' : t('printBill'))}</span>
                </Button>
              </div>

              {/* 5. Single Direct Checkout Button */}
              <Button
                size="lg"
                disabled={cart.items.length === 0}
                onClick={handleCheckoutClick}
                className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-black text-sm gap-2 rounded-xl shadow-md transition-all active:scale-[0.99]"
              >
                <CreditCard className="h-5 w-5" />
                <span>{isArabic ? 'الدفع وإنهاء الطلب' : t('checkout')} · {fmtCurrency(total)}</span>
              </Button>
            </div>
          </div>
        </div>

        {/* 2. CENTER COLUMN: Search bar & Products Big Touch Tiles Grid */}
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
                className="p-1 rounded-full text-muted-foreground hover:bg-muted"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Product grid */}
          <div className="flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 p-1 content-start" dir={isArabic ? 'rtl' : 'ltr'}>
            {filteredProducts.map((prod, i) => {
              const colorClass = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
              const hasAddons = prod.addon_groups && prod.addon_groups.length > 0;
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
                  className={`min-h-36 p-3 rounded-2xl border flex flex-col justify-between text-start transition-all active:scale-[0.97] shadow-2xs hover:shadow-sm relative ${colorClass}`}
                >
                  {/* In-cart count badge */}
                  {inCartQty > 0 && (
                    <div className="absolute top-2 end-2 z-10 bg-brand text-white text-[11px] font-black h-5 min-w-5 px-1.5 rounded-full flex items-center justify-center shadow-sm">
                      {inCartQty}×
                    </div>
                  )}

                  {/* Product Image / Monogram Tile */}
                  <div className="relative w-full h-20 rounded-xl overflow-hidden mb-2 bg-black/5 dark:bg-white/5 shrink-0">
                    <div
                      className="absolute inset-0 flex items-center justify-center font-extrabold text-lg text-white/90"
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
                        className="absolute inset-0 w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : null}
                  </div>

                  {/* Product Name */}
                  <span className="font-bold text-xs sm:text-sm line-clamp-2 leading-tight text-foreground">
                    {prod.name}
                  </span>

                  {/* Price & Addons / Plus Indicator */}
                  <div className="flex items-center justify-between mt-auto pt-2 gap-1">
                    <span className="font-extrabold text-xs sm:text-sm font-mono text-foreground">
                      {fmtCurrency(prod.price)}
                    </span>

                    {hasAddons ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onProductClick?.(prod);
                        }}
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-700 dark:text-amber-300 hover:bg-amber-500/30"
                      >
                        + {isArabic ? 'خيارات' : 'Options'}
                      </button>
                    ) : (
                      <div className="p-1 rounded-lg bg-black/5 dark:bg-white/10 text-muted-foreground">
                        <Plus className="h-3.5 w-3.5" />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. RIGHT COLUMN: Categories Vertical Column */}
        <div className="w-48 lg:w-56 bg-card border-l border-border flex flex-col p-2.5 gap-2 shrink-0 overflow-hidden">
          <div className="text-xs font-bold text-muted-foreground uppercase px-2 py-1 tracking-wider" dir={isArabic ? 'rtl' : 'ltr'}>
            {isArabic ? 'الفئات' : 'Categories'}
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 pe-1" dir={isArabic ? 'rtl' : 'ltr'}>
            {/* All Items Button */}
            <button
              type="button"
              onClick={() => setSelectedCatId('all')}
              className={`w-full px-3 py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-between border ${
                selectedCatId === 'all'
                  ? 'bg-brand text-white border-brand shadow-sm'
                  : 'bg-card text-foreground border-border hover:bg-muted'
              }`}
            >
              <span>{t('allCategories')}</span>
              <span className={`text-[11px] px-1.5 py-0.5 rounded-md font-mono ${selectedCatId === 'all' ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground'}`}>
                {products.length}
              </span>
            </button>

            {/* Individual Category Buttons */}
            {categories.map((cat) => {
              const isSelected = String(selectedCatId) === String(cat.id);
              const count = products.filter((p) => p.is_active && String(p.category_id) === String(cat.id)).length;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCatId(cat.id)}
                  className={`w-full px-3 py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-between border ${
                    isSelected
                      ? 'bg-brand text-white border-brand shadow-sm'
                      : 'bg-card text-foreground border-border hover:bg-muted'
                  }`}
                >
                  <span className="truncate me-1">{cat.name}</span>
                  <span className={`text-[11px] px-1.5 py-0.5 rounded-md font-mono shrink-0 ${isSelected ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Held Orders List Modal Overlay */}
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
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted"
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
                        className="bg-brand hover:bg-brand/90 text-white font-bold text-xs gap-1.5 rounded-lg shrink-0"
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
