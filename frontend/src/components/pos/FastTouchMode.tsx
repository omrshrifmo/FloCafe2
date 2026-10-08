'use client';

import { useState, useMemo } from 'react';
import { useCartStore } from '@/store/cart';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { Button } from '@/components/ui/button';
import toast from 'react-hot-toast';
import type { Category, Product } from '@/lib/types';
import {
  Zap,
  Repeat,
  CreditCard,
  Banknote,
  Plus,
  Minus,
  Trash2,
  ArrowLeft,
} from 'lucide-react';

interface FastTouchModeProps {
  categories: Category[];
  products: Product[];
  onExit: () => void;
  onQuickCheckout: (method: 'cash' | 'card', tenderAmount?: number) => void;
}

const CATEGORY_COLORS: string[] = [
  'bg-amber-500/15 border-amber-500/30 text-amber-900 dark:text-amber-200 hover:bg-amber-500/25',
  'bg-emerald-500/15 border-emerald-500/30 text-emerald-900 dark:text-emerald-200 hover:bg-emerald-500/25',
  'bg-blue-500/15 border-blue-500/30 text-blue-900 dark:text-blue-200 hover:bg-blue-500/25',
  'bg-purple-500/15 border-purple-500/30 text-purple-900 dark:text-purple-200 hover:bg-purple-500/25',
  'bg-rose-500/15 border-rose-500/30 text-rose-900 dark:text-rose-200 hover:bg-rose-500/25',
  'bg-cyan-500/15 border-cyan-500/30 text-cyan-900 dark:text-cyan-200 hover:bg-cyan-500/25',
];

export function FastTouchMode({ categories, products, onExit, onQuickCheckout }: FastTouchModeProps) {
  const { items, addItem, updateQuantity, clearCart, subtotal } = useCartStore();
  const fmtCurrency = useFormatCurrency();

  const [selectedCatId, setSelectedCatId] = useState<string | 'all'>('all');
  const [splitGuests, setSplitGuests] = useState<number | null>(null);

  const total = subtotal();

  const filteredProducts = useMemo(() => {
    if (selectedCatId === 'all') return products.filter((p) => p.is_active);
    return products.filter((p) => p.is_active && String(p.category_id) === String(selectedCatId));
  }, [products, selectedCatId]);

  // Repeat Last Item
  const handleRepeatLast = () => {
    if (items.length === 0) {
      toast.error('No items in order to repeat');
      return;
    }
    const lastItem = items[items.length - 1];
    addItem(lastItem.product, 1, lastItem.addons, lastItem.special_instructions);
    toast.success(`Repeated: ${lastItem.product.name}`);
  };

  // Quick tender denominations
  const denominations = [5, 10, 20, 50, 100];

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col overflow-hidden select-none">
      {/* Top Bar */}
      <div className="h-14 px-4 bg-card border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={onExit} className="gap-1.5 text-xs">
            <ArrowLeft className="h-4 w-4" /> Exit Fast-Touch
          </Button>
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-amber-500/10 text-amber-500 rounded-lg">
              <Zap className="h-4 w-4" />
            </div>
            <span className="font-bold text-sm text-foreground">Fast-Touch Express POS</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRepeatLast}
            disabled={items.length === 0}
            className="gap-1.5 text-xs text-brand border-brand/30 hover:bg-brand/10"
          >
            <Repeat className="h-3.5 w-3.5" /> Repeat Last Item
          </Button>

          {items.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearCart} className="text-xs text-rose-600 hover:text-rose-700">
              <Trash2 className="h-3.5 w-3.5 me-1" /> Clear
            </Button>
          )}
        </div>
      </div>

      {/* Main Grid: Left is Products, Right is Quick Register */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT COLUMN: Categories & Big Tiles */}
        <div className="flex-1 flex flex-col p-4 overflow-hidden gap-3 border-e border-border">
          {/* Category Bar */}
          <div className="flex gap-2 overflow-x-auto pb-1 shrink-0 scrollbar-none">
            <button
              onClick={() => setSelectedCatId('all')}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 border ${
                selectedCatId === 'all'
                  ? 'bg-brand text-white border-brand shadow-sm'
                  : 'bg-card text-muted-foreground border-border hover:bg-muted'
              }`}
            >
              All Items ({products.length})
            </button>
            {categories.map((cat) => {
              const isSelected = String(selectedCatId) === String(cat.id);
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCatId(cat.id)}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 border ${
                    isSelected
                      ? 'bg-brand text-white border-brand shadow-sm'
                      : 'bg-card text-foreground border-border hover:bg-muted'
                  }`}
                >
                  {cat.name}
                </button>
              );
            })}
          </div>

          {/* Product Big Touch Tiles */}
          <div className="flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 p-1">
            {filteredProducts.map((prod, i) => {
              const colorClass = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
              return (
                <button
                  key={prod.id}
                  onClick={() => addItem(prod)}
                  className={`h-28 p-3 rounded-2xl border flex flex-col justify-between text-start transition-all active:scale-95 shadow-2xs ${colorClass}`}
                >
                  <span className="font-bold text-sm line-clamp-2 leading-tight">
                    {prod.name}
                  </span>
                  <div className="flex items-center justify-between mt-auto">
                    <span className="font-extrabold text-sm font-mono">
                      {fmtCurrency(prod.price)}
                    </span>
                    <div className="p-1 rounded-lg bg-black/10 dark:bg-white/10">
                      <Plus className="h-3.5 w-3.5" />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* RIGHT COLUMN: Fast Register & Direct Tendering */}
        <div className="w-96 flex flex-col bg-card shrink-0 p-4 gap-4 overflow-hidden">
          {/* Cart Items List */}
          <div className="flex-1 overflow-y-auto space-y-2 border border-border rounded-xl p-3 bg-muted/20">
            {items.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-xs text-center py-12">
                <Zap className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <span>Tap items to add directly</span>
              </div>
            ) : (
              items.map((line) => (
                <div key={line.id} className="flex items-center justify-between p-2 rounded-lg bg-background border border-border/60">
                  <div className="flex-1 min-w-0 me-2">
                    <div className="font-semibold text-xs text-foreground truncate">{line.product.name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">
                      {fmtCurrency(line.product.price)} each
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => updateQuantity(line.id, line.quantity - 1)}
                      className="h-6 w-6 rounded bg-muted flex items-center justify-center text-foreground hover:bg-muted/80"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="font-bold text-xs w-5 text-center">{line.quantity}</span>
                    <button
                      onClick={() => updateQuantity(line.id, line.quantity + 1)}
                      className="h-6 w-6 rounded bg-muted flex items-center justify-center text-foreground hover:bg-muted/80"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                    <span className="font-bold text-xs font-mono ms-1 text-foreground min-w-12 text-end">
                      {fmtCurrency(line.product.price * line.quantity)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Subtotal & Split Display */}
          <div className="p-4 bg-muted/40 rounded-xl border border-border space-y-2 shrink-0">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Subtotal:</span>
              <span className="text-2xl font-black text-foreground font-mono">{fmtCurrency(total)}</span>
            </div>

            {splitGuests && splitGuests > 1 && (
              <div className="flex items-center justify-between text-xs text-brand font-semibold pt-1 border-t border-border">
                <span>Split ({splitGuests} Guests):</span>
                <span>{fmtCurrency(total / splitGuests)} each</span>
              </div>
            )}

            {/* Split Guests Quick Selector */}
            <div className="flex items-center gap-1.5 pt-2">
              <span className="text-[10px] text-muted-foreground uppercase font-bold">Split:</span>
              {[2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setSplitGuests(splitGuests === n ? null : n)}
                  className={`px-2 py-0.5 rounded text-[11px] font-bold border transition-colors ${
                    splitGuests === n
                      ? 'bg-brand text-white border-brand'
                      : 'bg-background border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Quick Tender Bar (Exact & Denominations) */}
          <div className="space-y-2 shrink-0">
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="lg"
                disabled={items.length === 0}
                onClick={() => onQuickCheckout('cash', total)}
                className="h-14 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm gap-2 rounded-xl"
              >
                <Banknote className="h-5 w-5" />
                Exact Cash
              </Button>

              <Button
                size="lg"
                disabled={items.length === 0}
                onClick={() => onQuickCheckout('card', total)}
                className="h-14 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm gap-2 rounded-xl"
              >
                <CreditCard className="h-5 w-5" />
                Exact Card
              </Button>
            </div>

            {/* Common Cash Denominations */}
            <div className="grid grid-cols-5 gap-1.5">
              {denominations.map((denom) => (
                <button
                  key={denom}
                  disabled={items.length === 0 || denom < total}
                  onClick={() => onQuickCheckout('cash', denom)}
                  className="py-2.5 bg-muted/60 hover:bg-muted disabled:opacity-40 rounded-lg text-xs font-black font-mono border border-border transition-colors text-foreground"
                >
                  ${denom}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
