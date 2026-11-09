'use client';

import { useState, useEffect, useRef } from 'react';
import api from '@/lib/api';
import { useAppLanguage } from '@/lib/i18n/bilingual';
import {
  ShoppingCart, UtensilsCrossed, Package, Truck, Globe,
  Plus, Minus, Trash2, Pause, MapPin, SquarePen,
  Users, Printer,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCartStore, buildActiveCartPayload } from '@/store/cart';
import { usePrinterStore } from '@/hooks/usePrinter';
import { useHeldOrdersStore } from '@/store/held-orders';
import { useAuthStore } from '@/store/auth';
import { usePosSettingsStore } from '@/store/pos-settings';
import { useTranslations } from 'use-intl';
import toast from 'react-hot-toast';
import type { Table, Order, OrderItem, CartItem } from '@/lib/types';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { fractionalQuantityStep, roundToQuantityPrecision } from '@/lib/utils';

interface Props {
  tables: Table[];
  currency: string;
  submitting: boolean;
  onPlaceOrder: () => void;
  onShowTablePicker: () => void;
  onEditItem?: (item: CartItem) => void;
  variant?: 'sidebar' | 'drawer';
  existingOrder?: Order | null;
}

const orderTypeIcons = {
  dine_in: UtensilsCrossed,
  takeaway: Package,
  delivery: Truck,
  online: Globe,
};

function ItemQuantityControl({
  item,
  updateQuantity,
}: {
  item: CartItem;
  updateQuantity: (cartItemId: string, quantity: number) => void;
}) {
  const t = useTranslations('pos');
  const step = fractionalQuantityStep(item.product);
  const [draft, setDraft] = useState(() => String(item.quantity));
  const [lastQuantity, setLastQuantity] = useState(item.quantity);
  if (lastQuantity !== item.quantity) {
    setLastQuantity(item.quantity);
    setDraft(String(item.quantity));
  }

  const commitDraft = () => {
    if (step == null) return;
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setDraft(String(item.quantity));
      return;
    }
    const rounded = Math.max(step, roundToQuantityPrecision(parsed, step));
    updateQuantity(item.id, rounded);
    setDraft(String(rounded));
  };

  const stepBy = (sign: 1 | -1) => {
    if (step == null) {
      updateQuantity(item.id, item.quantity + sign);
      return;
    }
    const next = roundToQuantityPrecision(item.quantity + sign * step, step);
    updateQuantity(item.id, next);
    setDraft(String(next));
  };

  if (step == null) {
    return (
      <>
        <button
          onClick={() => stepBy(-1)}
          className="touch-target rounded-full bg-muted transition-colors hover:bg-muted/70 active:bg-muted/70"
          aria-label={t('remove')}
        >
          <Minus size={16} />
        </button>
        <span className="w-6 text-center text-base font-semibold tabular-nums">{item.quantity}</span>
        <button
          onClick={() => stepBy(1)}
          className="touch-target rounded-full bg-muted transition-colors hover:bg-muted/70 active:bg-muted/70"
          aria-label={t('addItems')}
        >
          <Plus size={16} />
        </button>
      </>
    );
  }

  return (
    <>
      <button
        onClick={() => stepBy(-1)}
        className="touch-target rounded-full bg-muted transition-colors hover:bg-muted/70 active:bg-muted/70"
        aria-label={t('remove')}
      >
        <Minus size={16} />
      </button>
      <input
        type="number"
        inputMode="decimal"
        min={step}
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitDraft();
        }}
        aria-label={t('quantity')}
        className="w-14 text-center text-base font-semibold tabular-nums border border-border bg-card rounded-md px-1 py-0.5 outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
      />
      <button
        onClick={() => stepBy(1)}
        className="touch-target rounded-full bg-muted transition-colors hover:bg-muted/70 active:bg-muted/70"
        aria-label={t('addItems')}
      >
        <Plus size={16} />
      </button>
    </>
  );
}

export default function CartPanel({ tables, submitting, onPlaceOrder, onEditItem, variant = 'sidebar', existingOrder }: Props) {
  const cart = useCartStore();
  const heldOrders = useHeldOrdersStore();
  const { currentTenant } = useAuthStore();
  const billingType = usePosSettingsStore((s) => s.billingType);
  const t = useTranslations('pos');
  const tCommon = useTranslations('common');
  const { tr } = useAppLanguage();
  const isRestaurant = (currentTenant?.business_type ?? 'restaurant') === 'restaurant';
  const fmt = useFormatCurrency();
  const canHold = isRestaurant && cart.orderType === 'dine_in' && cart.tableId && cart.items.length > 0 && billingType === 'postpaid';
  const [printingPreliminary, setPrintingPreliminary] = useState(false);
  const [deliveryChannels, setDeliveryChannels] = useState<Array<{ id: string; channel_name: string; commission_rate: number }>>([]);
  const printPreliminaryReceipt = usePrinterStore((s) => s.printPreliminaryReceipt);
  const tPrint = useTranslations('print');
  const tOrders = useTranslations('orders');

  const preBillPrintedRef = useRef(false);
  const preBillLastTotalRef = useRef(0);

  useEffect(() => {
    api.get('/finance/delivery-channels')
      .then((res) => setDeliveryChannels(res.data?.channels || []))
      .catch(() => {});
  }, []);

  const handlePrintPreliminary = async () => {
    if (printingPreliminary || cart.items.length === 0) return;
    setPrintingPreliminary(true);
    try {
      const cartPayload = buildActiveCartPayload(cart);
      const warnings = await printPreliminaryReceipt({ cart: cartPayload });
      preBillPrintedRef.current = true;
      preBillLastTotalRef.current = cart.subtotal();
      if (warnings.length > 0) {
        toast(warnings[0].message || tr('Preliminary receipt printed with warnings', 'تمت طباعة الفاتورة المبدئية مع تنبيهات'), { icon: '⚠️' });
      } else {
        toast.success(tr('Preliminary receipt printed', 'تمت طباعة الفاتورة المبدئية'));
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : tr('Failed to print preliminary receipt', 'فشل في طباعة الفاتورة المبدئية'));
    } finally {
      setPrintingPreliminary(false);
    }
  };

  const handleRemoveItem = (itemId: string, productName: string, price: number) => {
    if (preBillPrintedRef.current) {
      api.post('/finance/anti-theft/log', {
        event_type: 'post_print_item_removed',
        severity: 'critical',
        details: {
          item_id: itemId,
          product_name: productName,
          price,
          pre_bill_total: preBillLastTotalRef.current,
          context: 'cart_item_removed_after_prebill_print',
        },
      }).catch(console.error);
    }
    cart.removeItem(itemId);
  };

  const handleHold = async () => {
    if (!cart.tableId) {
      toast.error(t('selectTableFirst'));
      return;
    }
    if (cart.items.length === 0) {
      toast.error(t('cartEmpty'));
      return;
    }
    const tableName = tables.find((t) => t.id === cart.tableId)?.name || cart.tableId;
    try {
      await heldOrders.holdOrder(cart.tableId, cart.items, cart.customerId, cart.guestCount, cart.orderNotes);
      cart.clearCart();
      preBillPrintedRef.current = false;
      toast.success(t('orderHeldFor', { table: tableName }));
    } catch {
      toast.error(t('holdOrderFailed'));
    }
  };

  const handlePlaceOrderWrapped = () => {
    preBillPrintedRef.current = false;
    onPlaceOrder();
  };

  const isDrawer = variant === 'drawer';

  return (
    <div className={
      isDrawer
        ? 'flex flex-col w-full'
        : 'w-full h-full bg-card rounded-xl border border-border dark:border-border flex flex-col shadow-sm'
    }>
      {/* Order Type */}
      <div className="p-4 border-b border-border dark:border-border space-y-2">
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          {(['dine_in', 'takeaway', 'delivery', 'online'] as const)
            .filter((type) => isRestaurant || type !== 'dine_in')
            .map((type) => {
              const Icon = orderTypeIcons[type];
              const showIcon = type !== 'dine_in' && type !== 'online';
              const label = type === 'dine_in' ? t('orderTypeDineIn') : type === 'takeaway' ? t('orderTypeTakeaway') : type === 'delivery' ? t('orderTypeDelivery') : t('orderTypeOnline');
              return (
                <button
                  key={type}
                  onClick={() => cart.setOrderType(type)}
                  className={`touch-target flex-1 gap-1 px-2 rounded-md text-xs font-medium transition-colors ${showIcon ? '' : 'whitespace-nowrap'} ${
                    cart.orderType === type
                      ? 'bg-card text-brand shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {showIcon && <Icon size={14} />}
                  {label}
                </button>
              );
            })}
        </div>

        {cart.orderType === 'dine_in' && (
          <div className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Users size={15} /><span>{t('pax')}</span></div>
            <div className="flex items-center gap-2">
              <button type="button" aria-label={t('decreasePax')} onClick={() => cart.setGuestCount(Math.max(1, cart.guestCount - 1))} className="touch-target rounded-full bg-muted"><Minus size={15} /></button>
              <input aria-label={t('pax')} inputMode="numeric" type="number" min="1" max="99" value={cart.guestCount} onChange={(e) => cart.setGuestCount(Math.min(99, Math.max(1, Number(e.target.value) || 1)))} className="w-12 text-center text-base font-semibold border-0 outline-none bg-transparent" />
              <button type="button" aria-label={t('increasePax')} onClick={() => cart.setGuestCount(Math.min(99, cart.guestCount + 1))} className="touch-target rounded-full bg-muted"><Plus size={15} /></button>
            </div>
          </div>
        )}

        {/* Delivery address & channel — shown inline when delivery is selected */}
        {cart.orderType === 'delivery' && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <MapPin size={14} className="text-muted-foreground shrink-0" />
              <input
                type="text"
                value={cart.deliveryAddress}
                onChange={(e) => cart.setDeliveryAddress(e.target.value)}
                placeholder={t('deliveryAddress')}
                className="flex-1 min-h-10 px-3 py-1.5 text-xs border border-border bg-card rounded-lg focus:ring-1 focus:ring-brand outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={cart.deliveryChannelId || ''}
                onChange={(e) => {
                  const ch = deliveryChannels.find((c) => c.id === e.target.value);
                  cart.setDeliveryChannel(ch ? ch.id : null, ch ? ch.channel_name : null);
                }}
                className="w-full min-h-9 px-2 py-1 text-xs border border-border bg-card rounded-lg outline-none focus:ring-1 focus:ring-brand"
              >
                <option value="">{tr('Direct (0% comm)', 'مباشر (بدون عمولة)')}</option>
                {deliveryChannels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.channel_name} ({c.commission_rate}%)
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={cart.courierName}
                onChange={(e) => cart.setCourier(null, e.target.value)}
                placeholder={tr('Driver / Courier', 'سائق / مندوب توصيل')}
                className="w-full min-h-9 px-2 py-1 text-xs border border-border bg-card rounded-lg outline-none focus:ring-1 focus:ring-brand"
              />
            </div>
            {cart.deliveryChannelId && (
              <input
                type="text"
                value={cart.aggregatorOrderRef}
                onChange={(e) => cart.setAggregatorOrderRef(e.target.value)}
                placeholder={tr('Platform Order # (e.g. TAL-1049)', 'رقم طلب التطبيق (مثال: TAL-1049)')}
                className="w-full min-h-9 px-2 py-1 text-xs border border-border bg-card rounded-lg outline-none focus:ring-1 focus:ring-brand"
              />
            )}
          </div>
        )}

        {/* Online platform + external order id — shown inline when online is selected */}
        {cart.orderType === 'online' && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Globe size={14} className="text-muted-foreground shrink-0" />
              <input
                type="text"
                value={cart.onlinePlatform}
                onChange={(e) => cart.setOnlinePlatform(e.target.value)}
                placeholder={t('onlinePlatformPlaceholder')}
                className="flex-1 min-h-11 px-3 py-2 text-sm border border-border bg-card rounded-lg focus:ring-2 focus:ring-brand focus:border-brand outline-none"
              />
            </div>
            <input
              type="text"
              value={cart.externalOrderId}
              onChange={(e) => cart.setExternalOrderId(e.target.value)}
              placeholder={t('externalOrderIdPlaceholder')}
              className="flex-1 min-h-11 px-3 py-2 text-sm border border-border bg-card rounded-lg focus:ring-2 focus:ring-brand focus:border-brand outline-none"
            />
          </div>
        )}
      </div>

      {/* Cart Items */}
      <div className={isDrawer ? 'overflow-y-auto p-4 max-h-[40vh]' : 'flex-1 overflow-y-auto p-4'}>
        {/* Previously ordered items (add-items mode) */}
        {existingOrder && existingOrder.items && existingOrder.items.filter((i: OrderItem) => i.status !== 'cancelled').length > 0 && (
          <div className="mb-3 pb-3 border-b border-dashed border-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t('alreadyOrdered')}</p>
            <div className="space-y-1.5">
              {existingOrder.items.filter((i: OrderItem) => i.status !== 'cancelled').map((item: OrderItem) => (
                <div key={item.id} className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">{item.quantity}× {item.product_name}</span>
                  <span className="text-xs text-muted-foreground">{fmt(Number(item.total))}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {cart.items.length === 0 ? (
          <div className={`flex flex-col items-center justify-center text-muted-foreground ${existingOrder ? 'py-4' : isDrawer ? 'py-8' : 'h-full'}`}>
            <ShoppingCart size={existingOrder ? 24 : 40} />
            <p className="mt-2 text-sm">{existingOrder ? t('addNewItemsAbove') : t('cartEmpty')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {cart.items.map((item) => (
              <div key={item.id} className="border-b border-border/60 pb-3 last:border-b-0 last:pb-0">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 break-words text-sm font-medium leading-snug text-foreground">
                    {item.product.name}
                  </p>
                  <button
                    onClick={() => handleRemoveItem(item.id, item.product.name, Number(item.product.price))}
                    className="touch-target -me-2 -mt-2 shrink-0 rounded-full text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40 dark:hover:text-red-400 active:bg-red-50 dark:active:bg-red-950/40"
                    aria-label={t('remove')}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="min-w-0">
                  {item.addons.length > 0 && (
                    <div className="mt-0.5">
                      {item.addons.map((a) => (
                        <p key={a.id} className="break-words text-xs text-muted-foreground">
                          + {a.name}{(a.quantity || 1) > 1 ? ` ×${a.quantity}` : ''} {Number(a.price) > 0 && `(${fmt(Number(a.price) * (a.quantity || 1))})`}
                        </p>
                      ))}
                    </div>
                  )}
                  {item.special_instructions && (
                    <p className="text-xs text-muted-foreground italic mt-0.5 break-words">{item.special_instructions}</p>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    {fmt(Number(item.product.price))}
                  </p>
                  <div className="flex items-center gap-1.5">
                    {onEditItem && (
                      <button
                        onClick={() => onEditItem(item)}
                        className="touch-target shrink-0 gap-1 rounded-full bg-amber-100 px-3 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/60 dark:active:bg-amber-950/60 transition-colors hover:bg-amber-200 active:bg-amber-200"
                      >
                        <SquarePen size={12} />
                        {tCommon('edit')}
                      </button>
                    )}
                    <ItemQuantityControl item={item} updateQuantity={cart.updateQuantity} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cart Footer */}
      <div className="p-4 border-t border-border dark:border-border">
        {/* Order Notes */}
        {cart.items.length > 0 && (
          <div className="mb-3">
            <textarea
              value={cart.orderNotes}
              onChange={(e) => cart.setOrderNotes(e.target.value.slice(0, 200))}
              placeholder={t('orderNotesPlaceholder')}
              rows={2}
              maxLength={200}
              className="w-full min-h-20 px-3 py-2 text-sm border border-border bg-card rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            />
            <p className="text-xs text-muted-foreground text-end mt-0.5">{cart.orderNotes.length}/200</p>
          </div>
        )}
        <div className="flex justify-between mb-1 text-sm">
          <span className="text-muted-foreground">{t('items')}</span>
          <span className="font-medium">{cart.itemCount()}</span>
        </div>
        <div className="flex justify-between mb-4 text-lg">
          <span className="font-semibold text-foreground">{t('subtotal')}</span>
          <span className="font-bold text-brand">
            {fmt(cart.subtotal())}
          </span>
        </div>
        {cart.items.length > 0 && (
          <div className="mb-2">
            <Button
              type="button"
              variant="outline"
              onClick={handlePrintPreliminary}
              disabled={printingPreliminary || submitting}
              className="w-full"
            >
              <Printer size={15} className="me-2" />
              {printingPreliminary ? tr('Printing...', 'جاري الطباعة...') : tr('Print Pre-Bill Slip', 'طباعة فاتورة مبدئية')}
            </Button>
          </div>
        )}
        <div className="flex gap-2">
          {canHold && (
            <Button variant="outline" onClick={handleHold} className="flex-1">
              <Pause size={14} className="me-1" /> {tr('Hold Order', 'تعليق الطلب')}
            </Button>
          )}
          <Button
            onClick={handlePlaceOrderWrapped}
            disabled={submitting || cart.items.length === 0}
            className="flex-1"
            size="lg"
          >
            {submitting ? tr('Placing Order...', 'جاري التنفيذ...') : tr('Place Order', 'تأكيد وإرسال الطلب')}
          </Button>
        </div>
      </div>
    </div>
  );
}
