'use client';

import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useAuthStore } from '@/store/auth';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { useTranslations } from 'use-intl';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useCurrencyUnitAdapter } from '@/hooks/useCurrencyUnitAdapter';
import { getCurrencyMinorUnitFactor } from '@/lib/countries';
import { businessDateForInstant } from '@shared/business-date';

export type CashDrawerMovementType = 'opening_float' | 'pay_in' | 'pay_out' | 'safe_drop' | 'expense' | 'purchase';

export interface CashDrawerMovement {
  id: number;
  business_date: string;
  movement_type: CashDrawerMovementType;
  amount_cents: number;
  reason: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
  voided_at: string | null;
  voided_by: string | null;
  voided_by_name: string | null;
  void_reason: string | null;
}

export interface PurchaseOptionItem {
  id: number;
  name: string;
  sku?: string | null;
  category?: string;
  unit?: string;
  quantity: number;
  cost_per_unit: number;
  target_type: 'inventory' | 'supplies';
}

export interface OpenPurchaseOrder {
  id: number;
  po_number: string;
  supplier_id: string;
  supplier_name: string;
  total_amount: number;
  currency: string;
  status: string;
}

export interface SupplierOption {
  id: string;
  name: string;
  category?: string;
  payment_terms?: string;
}

export function useCashDrawerMovements() {
  const { currentTenant } = useAuthStore();
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');
  const fmt = useFormatCurrency();
  const unitAdapter = useCurrencyUnitAdapter();
  const minorFactor = getCurrencyMinorUnitFactor(currentTenant?.currency || '');
  const todayLocal = businessDateForInstant({
    instant: new Date(),
    timezone: currentTenant?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    startTime: currentTenant?.business_day_start_time || '00:00',
  });
  const [open, setOpen] = useState(false);
  const [businessDate, setBusinessDate] = useState(todayLocal);
  const [movementType, setMovementType] = useState<CashDrawerMovementType>('pay_in');
  const [amountInput, setAmountInput] = useState('');
  const [reason, setReason] = useState('');
  const [movements, setMovements] = useState<CashDrawerMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Expense-specific state
  const [expenseCategory, setExpenseCategory] = useState('Store Supplies & Ice');
  const [costType, setCostType] = useState<'direct' | 'indirect'>('direct');
  const [expenseTitle, setExpenseTitle] = useState('');
  const [expenseNotes, setExpenseNotes] = useState('');

  // Purchase-specific state
  const [purchaseMode, setPurchaseMode] = useState<'po' | 'direct'>('po');
  const [selectedPoId, setSelectedPoId] = useState<number | null>(null);
  const [purchaseTargetType, setPurchaseTargetType] = useState<'inventory' | 'supplies'>('inventory');
  const [purchaseTargetId, setPurchaseTargetId] = useState<number | null>(null);
  const [purchaseQuantity, setPurchaseQuantity] = useState('');
  const [purchaseSupplierId, setPurchaseSupplierId] = useState<string>('');

  // Purchase options data
  const [openPurchaseOrders, setOpenPurchaseOrders] = useState<OpenPurchaseOrder[]>([]);
  const [availableItems, setAvailableItems] = useState<PurchaseOptionItem[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  const movementRequestRef = useRef(0);
  const businessDateRef = useRef(businessDate);
  useEffect(() => {
    businessDateRef.current = businessDate;
  }, [businessDate]);

  const loadMovements = async (date?: string) => {
    const requestedDate = date ?? businessDateRef.current;
    if (date !== undefined) businessDateRef.current = date;
    const requestId = ++movementRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/cash-closures/movements', { params: { business_date: requestedDate } });
      if (requestId !== movementRequestRef.current || requestedDate !== businessDateRef.current) return;
      setMovements(response.data?.movements || []);
    } catch (err: unknown) {
      if (requestId !== movementRequestRef.current || requestedDate !== businessDateRef.current) return;
      const message = axios.isAxiosError(err)
        ? err.response?.data?.error || err.message
        : err instanceof Error ? err.message : tCommon('somethingWrong');
      setError(message);
    } finally {
      if (requestId === movementRequestRef.current) setLoading(false);
    }
  };

  const loadPurchaseMetadata = async () => {
    setLoadingOptions(true);
    try {
      const res = await api.get('/cash-closures/purchase-options');
      if (res.data) {
        setOpenPurchaseOrders(res.data.purchase_orders || []);
        setSuppliers(res.data.suppliers || []);
        setAvailableItems(res.data.items || []);
      }
    } catch (e) {
      console.error('Failed to load purchase metadata:', e);
    } finally {
      setLoadingOptions(false);
    }
  };

  const openModal = () => {
    setBusinessDate(todayLocal);
    setMovementType('pay_in');
    setAmountInput('');
    setReason('');
    setExpenseTitle('');
    setExpenseNotes('');
    setPurchaseQuantity('');
    setSelectedPoId(null);
    setPurchaseTargetId(null);
    setOpen(true);
    void loadMovements(todayLocal);
    void loadPurchaseMetadata();
  };

  const amountCents = () => {
    const amountText = amountInput.trim();
    if (amountText === '') return null;
    const amount = Number(amountText);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return Math.round(unitAdapter.toStored(amount) * minorFactor);
  };

  const recordMovement = async () => {
    setError(null);

    // Expense Mode
    if (movementType === 'expense') {
      const cents = amountCents();
      if (cents === null || cents <= 0) {
        setError(t('movementAmountRequired'));
        return;
      }
      if (!expenseTitle.trim()) {
        setError('Expense title or vendor name is required');
        return;
      }

      setSubmitting(true);
      try {
        await api.post('/cash-closures/movements', {
          business_date: businessDate,
          movement_type: 'expense',
          amount_cents: cents,
          expense_category: expenseCategory,
          cost_type: costType,
          title: expenseTitle.trim(),
          notes: expenseNotes.trim() || undefined,
          reason: `${expenseCategory}: ${expenseTitle.trim()}`,
        });
        setAmountInput('');
        setExpenseTitle('');
        setExpenseNotes('');
        await loadMovements();
        toast.success(t('movementSaved'));
      } catch (err: unknown) {
        const message = axios.isAxiosError(err)
          ? err.response?.data?.error || err.message
          : err instanceof Error ? err.message : t('movementSaveFailed');
        setError(message);
        toast.error(message);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Purchase Mode
    if (movementType === 'purchase') {
      if (purchaseMode === 'po') {
        if (!selectedPoId) {
          setError('Please select an open purchase order to receive');
          return;
        }
        const cents = amountCents();
        if (cents === null || cents <= 0) {
          setError(t('movementAmountRequired'));
          return;
        }

        setSubmitting(true);
        try {
          await api.post('/cash-closures/movements', {
            business_date: businessDate,
            movement_type: 'purchase',
            purchase_order_id: selectedPoId,
            amount_cents: cents,
            reason: reason.trim() || undefined,
          });
          setAmountInput('');
          setSelectedPoId(null);
          setReason('');
          await loadMovements();
          void loadPurchaseMetadata();
          toast.success('Purchase order received and paid from drawer');
        } catch (err: unknown) {
          const message = axios.isAxiosError(err)
            ? err.response?.data?.error || err.message
            : err instanceof Error ? err.message : t('movementSaveFailed');
          setError(message);
          toast.error(message);
        } finally {
          setSubmitting(false);
        }
        return;
      } else {
        // Direct Walk-In Stock Purchase
        if (!purchaseTargetId) {
          setError('Please select an item to purchase');
          return;
        }
        const qty = Number(purchaseQuantity);
        if (!Number.isFinite(qty) || qty <= 0) {
          setError('Please enter a valid purchase quantity greater than 0');
          return;
        }
        const cents = amountCents();
        if (cents === null || cents <= 0) {
          setError(t('movementAmountRequired'));
          return;
        }

        setSubmitting(true);
        try {
          await api.post('/cash-closures/movements', {
            business_date: businessDate,
            movement_type: 'purchase',
            target_type: purchaseTargetType,
            target_id: purchaseTargetId,
            quantity: qty,
            amount_cents: cents,
            supplier_id: purchaseSupplierId || undefined,
            reason: reason.trim() || undefined,
          });
          setAmountInput('');
          setPurchaseQuantity('');
          setPurchaseTargetId(null);
          setReason('');
          await loadMovements();
          void loadPurchaseMetadata();
          toast.success('Stock received and paid from drawer');
        } catch (err: unknown) {
          const message = axios.isAxiosError(err)
            ? err.response?.data?.error || err.message
            : err instanceof Error ? err.message : t('movementSaveFailed');
          setError(message);
          toast.error(message);
        } finally {
          setSubmitting(false);
        }
        return;
      }
    }

    // Standard Modes: opening_float, pay_in, pay_out, safe_drop
    const cents = amountCents();
    if (cents === null || (movementType !== 'opening_float' && cents === 0)) {
      setError(t('movementAmountRequired'));
      return;
    }
    if (movementType !== 'opening_float' && reason.trim() === '') {
      setError(t('movementReasonRequired'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/cash-closures/movements', {
        business_date: businessDate,
        movement_type: movementType,
        amount_cents: cents,
        reason: reason.trim() || undefined,
      });
      setAmountInput('');
      setReason('');
      await loadMovements();
      toast.success(t('movementSaved'));
    } catch (err: unknown) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.error || err.message
        : err instanceof Error ? err.message : t('movementSaveFailed');
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const voidMovement = async (id: number, voidReason: string) => {
    if (voidReason.trim() === '') {
      setError(t('voidReason') + ': ' + t('movementReasonRequired'));
      return false;
    }
    setError(null);
    try {
      await api.post(`/cash-closures/movements/${id}/void`, { reason: voidReason.trim() });
      await loadMovements();
      toast.success(t('movementVoided'));
      return true;
    } catch (err: unknown) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.error || err.message
        : err instanceof Error ? err.message : tCommon('somethingWrong');
      setError(message);
      toast.error(message);
      return false;
    }
  };

  return {
    open,
    setOpen,
    openModal,
    loadMovements,
    loadPurchaseMetadata,
    businessDate,
    setBusinessDate,
    movementType,
    setMovementType,
    amountInput,
    setAmountInput,
    reason,
    setReason,
    movements,
    loading,
    submitting,
    error,
    recordMovement,
    voidMovement,
    fmt,
    minorFactor,
    unitAdapter,
    t,
    tCommon,
    todayLocal,

    // Expense fields
    expenseCategory,
    setExpenseCategory,
    costType,
    setCostType,
    expenseTitle,
    setExpenseTitle,
    expenseNotes,
    setExpenseNotes,

    // Purchase fields
    purchaseMode,
    setPurchaseMode,
    selectedPoId,
    setSelectedPoId,
    purchaseTargetType,
    setPurchaseTargetType,
    purchaseTargetId,
    setPurchaseTargetId,
    purchaseQuantity,
    setPurchaseQuantity,
    purchaseSupplierId,
    setPurchaseSupplierId,

    // Purchase options
    openPurchaseOrders,
    availableItems,
    suppliers,
    loadingOptions,
  };
}

export type CashDrawerMovementsModel = ReturnType<typeof useCashDrawerMovements>;
