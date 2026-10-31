'use client';

import { useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Banknote, Loader2, Shield, ShoppingCart, Receipt, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Ltr } from '@/components/layout/Ltr';
import { useAuthStore } from '@/store/auth';
import { tenantCan } from '@/lib/permissions';
import type { CashDrawerMovementType, CashDrawerMovementsModel } from '@/hooks/useCashDrawerMovements';

export function CashDrawerMovementModal({ model }: { model: CashDrawerMovementsModel }) {
  const { currentTenant } = useAuthStore();
  const canVoid = tenantCan(currentTenant, 'cash.movements.void');
  const {
    open, setOpen, businessDate, setBusinessDate, loadMovements, movementType, setMovementType,
    amountInput, setAmountInput, reason, setReason, movements, loading, submitting, error,
    recordMovement, voidMovement, fmt, minorFactor, unitAdapter, t, tCommon, todayLocal,
    expenseCategory, setExpenseCategory, costType, setCostType, expenseTitle, setExpenseTitle,
    expenseNotes, setExpenseNotes, purchaseMode, setPurchaseMode, selectedPoId, setSelectedPoId,
    purchaseTargetType, setPurchaseTargetType, purchaseTargetId, setPurchaseTargetId,
    purchaseQuantity, setPurchaseQuantity, purchaseSupplierId, setPurchaseSupplierId,
    openPurchaseOrders, availableItems, suppliers, loadingOptions,
  } = model;

  const [voidingId, setVoidingId] = useState<number | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const movementLabel = (type: CashDrawerMovementType) => {
    if (type === 'opening_float') return t('openingFloat');
    if (type === 'pay_in') return t('payIn');
    if (type === 'pay_out') return t('payOut');
    if (type === 'safe_drop') return t('safeDrop');
    if (type === 'expense') return 'Direct Expense';
    if (type === 'purchase') return 'COD Purchase';
    return type;
  };

  const filteredItems = availableItems.filter((i) => i.target_type === purchaseTargetType);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!submitting) setOpen(next); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Banknote size={18} />
            {t('cashMovement')}
          </DialogTitle>
          <DialogDescription>{t('cashMovementHint')}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="movement-business-date" className="block text-sm text-muted-foreground mb-1">
                {t('businessDateLabel')}
              </label>
              <input
                id="movement-business-date"
                type="date"
                value={businessDate}
                max={todayLocal}
                onChange={(event) => {
                  const next = event.target.value;
                  if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || next > todayLocal) return;
                  setBusinessDate(next);
                  void loadMovements(next);
                }}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground outline-none focus:ring-2 focus:ring-brand/30"
              />
            </div>

            <div>
              <label htmlFor="movement-type" className="block text-sm text-muted-foreground mb-1">
                {t('movementType')}
              </label>
              <select
                id="movement-type"
                value={movementType}
                onChange={(event) => {
                  setMovementType(event.target.value as CashDrawerMovementType);
                }}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground outline-none focus:ring-2 focus:ring-brand/30"
              >
                <option value="pay_in">{t('payIn')}</option>
                <option value="pay_out">{t('payOut')}</option>
                <option value="expense">Direct Expense (Petty Cash)</option>
                <option value="purchase">Purchase (Cash on Delivery)</option>
                <option value="safe_drop">{t('safeDrop')}</option>
                <option value="opening_float">{t('openingFloat')}</option>
              </select>
            </div>
          </div>

          {/* EXPENSE FORM */}
          {movementType === 'expense' && (
            <div className="p-3 border border-border rounded-lg bg-muted/20 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Receipt size={16} className="text-amber-500" />
                <span>Operating Expense from Drawer</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="expense-category" className="block text-xs text-muted-foreground mb-1">
                    Expense Category
                  </label>
                  <select
                    id="expense-category"
                    value={expenseCategory}
                    onChange={(e) => setExpenseCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground outline-none focus:ring-2 focus:ring-brand/30"
                  >
                    <option value="Store Supplies & Ice">Store Supplies & Ice</option>
                    <option value="Utilities">Utilities (Water, Power, Net)</option>
                    <option value="Maintenance">Maintenance & Repairs</option>
                    <option value="Packaging">Packaging & Consumables</option>
                    <option value="Transport">Transport / Delivery Fuel</option>
                    <option value="Marketing">Marketing / Local Promo</option>
                    <option value="Other">Other Operating Expense</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="cost-type" className="block text-xs text-muted-foreground mb-1">
                    Cost Type
                  </label>
                  <select
                    id="cost-type"
                    value={costType}
                    onChange={(e) => setCostType(e.target.value as 'direct' | 'indirect')}
                    className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground outline-none focus:ring-2 focus:ring-brand/30"
                  >
                    <option value="direct">Direct (Cost of Operations)</option>
                    <option value="indirect">Indirect (General Overhead)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label htmlFor="expense-title" className="block text-xs text-muted-foreground mb-1">
                    Title / Vendor Name *
                  </label>
                  <input
                    id="expense-title"
                    type="text"
                    placeholder="e.g. 5 bags of ice / Electric bill / Plumber"
                    value={expenseTitle}
                    onChange={(e) => setExpenseTitle(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground outline-none focus:ring-2 focus:ring-brand/30"
                  />
                </div>
                <div>
                  <label htmlFor="expense-amount" className="block text-xs text-muted-foreground mb-1">
                    Amount Paid *
                  </label>
                  <input
                    id="expense-amount"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={unitAdapter.step}
                    placeholder="0.00"
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground outline-none focus:ring-2 focus:ring-brand/30 font-semibold"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="expense-notes" className="block text-xs text-muted-foreground mb-1">
                  Notes / Receipt # (Optional)
                </label>
                <input
                  id="expense-notes"
                  type="text"
                  placeholder="Receipt number or specific details"
                  value={expenseNotes}
                  onChange={(e) => setExpenseNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground outline-none focus:ring-2 focus:ring-brand/30"
                />
              </div>
            </div>
          )}

          {/* PURCHASE FORM */}
          {movementType === 'purchase' && (
            <div className="p-3 border border-border rounded-lg bg-muted/20 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <ShoppingCart size={16} className="text-emerald-500" />
                  <span>Receive & Pay Stock (COD)</span>
                </div>
                <div className="flex items-center gap-1 bg-background border border-border rounded-lg p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setPurchaseMode('po')}
                    className={`px-2.5 py-1 rounded-md transition-colors ${
                      purchaseMode === 'po' ? 'bg-brand text-brand-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Receive Open PO
                  </button>
                  <button
                    type="button"
                    onClick={() => setPurchaseMode('direct')}
                    className={`px-2.5 py-1 rounded-md transition-colors ${
                      purchaseMode === 'direct' ? 'bg-brand text-brand-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Quick Walk-in Purchase
                  </button>
                </div>
              </div>

              {purchaseMode === 'po' ? (
                <div className="space-y-3">
                  <div>
                    <label htmlFor="po-select" className="block text-xs text-muted-foreground mb-1">
                      Select Open Purchase Order *
                    </label>
                    {loadingOptions ? (
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5 py-2">
                        <Loader2 size={12} className="animate-spin" /> Loading open POs...
                      </div>
                    ) : openPurchaseOrders.length === 0 ? (
                      <div className="text-xs text-muted-foreground p-2 border border-border rounded-lg bg-background">
                        No pending purchase orders awaiting receiving. Switch to Quick Walk-in Purchase.
                      </div>
                    ) : (
                      <select
                        id="po-select"
                        value={selectedPoId || ''}
                        onChange={(e) => {
                          const id = Number(e.target.value);
                          setSelectedPoId(id || null);
                          const po = openPurchaseOrders.find((p) => p.id === id);
                          if (po) {
                            setAmountInput(String(po.total_amount));
                            setReason(`PO #${po.po_number} - ${po.supplier_name}`);
                          }
                        }}
                        className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground outline-none focus:ring-2 focus:ring-brand/30"
                      >
                        <option value="">-- Choose Purchase Order --</option>
                        {openPurchaseOrders.map((po) => (
                          <option key={po.id} value={po.id}>
                            #{po.po_number} · {po.supplier_name} · Total: {po.total_amount} {po.currency}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div>
                    <label htmlFor="po-amount" className="block text-xs text-muted-foreground mb-1">
                      Cash Deducted from Drawer *
                    </label>
                    <input
                      id="po-amount"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={unitAdapter.step}
                      placeholder="0.00"
                      value={amountInput}
                      onChange={(e) => setAmountInput(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground outline-none focus:ring-2 focus:ring-brand/30 font-semibold"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="purchase-target-type" className="block text-xs text-muted-foreground mb-1">
                        Stock Type
                      </label>
                      <select
                        id="purchase-target-type"
                        value={purchaseTargetType}
                        onChange={(e) => {
                          setPurchaseTargetType(e.target.value as 'inventory' | 'supplies');
                          setPurchaseTargetId(null);
                        }}
                        className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground outline-none focus:ring-2 focus:ring-brand/30"
                      >
                        <option value="inventory">Finished Goods / Merchandise</option>
                        <option value="supplies">Raw Material / Store Supply</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="purchase-supplier" className="block text-xs text-muted-foreground mb-1">
                        Supplier (Optional)
                      </label>
                      <select
                        id="purchase-supplier"
                        value={purchaseSupplierId}
                        onChange={(e) => setPurchaseSupplierId(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground outline-none focus:ring-2 focus:ring-brand/30"
                      >
                        <option value="">-- Direct Local Vendor --</option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="purchase-item" className="block text-xs text-muted-foreground mb-1">
                      Select Item to Restock *
                    </label>
                    <select
                      id="purchase-item"
                      value={purchaseTargetId || ''}
                      onChange={(e) => {
                        const id = Number(e.target.value);
                        setPurchaseTargetId(id || null);
                        const itm = filteredItems.find((i) => i.id === id);
                        if (itm) {
                          setReason(`Quick restock: ${itm.name}`);
                        }
                      }}
                      className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground outline-none focus:ring-2 focus:ring-brand/30"
                    >
                      <option value="">-- Choose Stock Item --</option>
                      {filteredItems.map((itm) => (
                        <option key={itm.id} value={itm.id}>
                          {itm.name} ({itm.unit || 'unit'}) · Current: {itm.quantity} · Avg Cost: {itm.cost_per_unit}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="purchase-qty" className="block text-xs text-muted-foreground mb-1">
                        Received Quantity *
                      </label>
                      <input
                        id="purchase-qty"
                        type="number"
                        min={0.01}
                        step="any"
                        placeholder="e.g. 10"
                        value={purchaseQuantity}
                        onChange={(e) => setPurchaseQuantity(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground outline-none focus:ring-2 focus:ring-brand/30"
                      />
                    </div>
                    <div>
                      <label htmlFor="purchase-cash" className="block text-xs text-muted-foreground mb-1">
                        Total Cash Paid from Drawer *
                      </label>
                      <input
                        id="purchase-cash"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={unitAdapter.step}
                        placeholder="0.00"
                        value={amountInput}
                        onChange={(e) => setAmountInput(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground outline-none focus:ring-2 focus:ring-brand/30 font-semibold"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STANDARD REASON & AMOUNT (pay_in, pay_out, safe_drop, opening_float) */}
          {movementType !== 'expense' && movementType !== 'purchase' && (
            <div className="space-y-3">
              <div>
                <label htmlFor="movement-amount" className="block text-sm text-muted-foreground mb-1">
                  {t('movementAmount')} *
                </label>
                <input
                  id="movement-amount"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={unitAdapter.step}
                  value={amountInput}
                  onChange={(event) => setAmountInput(event.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground outline-none focus:ring-2 focus:ring-brand/30"
                />
              </div>

              <div>
                <label htmlFor="movement-reason" className="block text-sm text-muted-foreground mb-1">
                  {t('movementReason')} {movementType === 'opening_float' && <span>({tCommon('optional')})</span>}
                </label>
                <textarea
                  id="movement-reason"
                  value={reason}
                  maxLength={500}
                  rows={2}
                  onChange={(event) => setReason(event.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground outline-none focus:ring-2 focus:ring-brand/30 resize-y"
                />
              </div>
            </div>
          )}

          {error && <p className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}

          <section aria-labelledby="movement-history-heading">
            <h3 id="movement-history-heading" className="text-sm font-medium text-foreground mb-2">{t('movementHistory')}</h3>
            {loading ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground"><Loader2 size={16} className="animate-spin" /></div>
            ) : movements.length === 0 ? (
              <p className="text-sm text-muted-foreground rounded-lg border border-border p-3">{t('noMovements')}</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border max-h-56 overflow-y-auto">
                {movements.map((movement) => (
                  <li key={movement.id} className={`p-3 space-y-2 ${movement.voided_at ? 'opacity-60' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground flex items-center gap-2">
                          {movement.movement_type === 'pay_in' ? (
                            <ArrowDownToLine size={14} className="text-emerald-500" />
                          ) : movement.movement_type === 'expense' ? (
                            <Receipt size={14} className="text-amber-500" />
                          ) : movement.movement_type === 'purchase' ? (
                            <ShoppingCart size={14} className="text-blue-500" />
                          ) : movement.movement_type === 'pay_out' || movement.movement_type === 'safe_drop' ? (
                            <ArrowUpFromLine size={14} className="text-rose-500" />
                          ) : (
                            <Shield size={14} />
                          )}
                          {movementLabel(movement.movement_type)}
                          {movement.voided_at && <span className="text-xs text-red-700 dark:text-red-300">({t('voided')})</span>}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{movement.reason || t('openingFloat')} · {movement.created_by_name}</p>
                      </div>
                      <Ltr><span className="text-sm font-semibold text-foreground whitespace-nowrap">{fmt(movement.amount_cents / minorFactor)}</span></Ltr>
                    </div>
                    {movement.voided_at ? (
                      <p className="text-xs text-muted-foreground">{movement.void_reason}</p>
                    ) : !canVoid ? null : voidingId === movement.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          value={voidReason}
                          maxLength={500}
                          onChange={(event) => setVoidReason(event.target.value)}
                          placeholder={t('voidReason')}
                          className="min-w-0 flex-1 px-2 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground outline-none focus:ring-2 focus:ring-brand/30"
                        />
                        <Button type="button" size="sm" onClick={async () => { if (await voidMovement(movement.id, voidReason)) { setVoidingId(null); setVoidReason(''); } }}>
                          {t('voidMovement')}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => { setVoidingId(null); setVoidReason(''); }} aria-label={tCommon('cancel')}>
                          <X size={14} />
                        </Button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => { setVoidingId(movement.id); setVoidReason(''); }} className="text-xs text-red-700 dark:text-red-300 hover:underline">
                        {t('voidMovement')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            <X size={14} />
            {tCommon('close')}
          </Button>
          <Button onClick={recordMovement} disabled={submitting || loading}>
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Banknote size={14} />}
            {t('recordMovement')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
