'use client';

import { useState, useEffect } from 'react';
import { X, Clock, CalendarClock, ShieldCheck, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { useTranslations } from 'use-intl';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import type { Order, Customer } from '@/lib/types';

interface Props {
  order: Order;
  onClose: () => void;
  onSuccess: () => void;
}

export default function DeferredCheckoutModal({ order, onClose, onSuccess }: Props) {
  const t = useTranslations('pos');
  const tCommon = useTranslations('common');
  const fmt = useFormatCurrency();
  const [tab, setTab] = useState<'finish_later' | 'pay_later'>('finish_later');
  const [submitting, setSubmitting] = useState(false);

  // Finish Later state
  const [keepTable, setKeepTable] = useState(false);

  // Pay Later state
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | number | ''>(order.customer_id || '');
  const [reason, setReason] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [currentUserRole, setCurrentUserRole] = useState<string>('');

  useEffect(() => {
    let active = true;
    // Load customers for selection if order doesn't have one
    api.get('/customers?per_page=100')
      .then((res) => {
        if (!active) return;
        setCustomers(res.data?.customers || []);
      })
      .catch(() => {});

    // Check current user role
    api.get('/auth/me')
      .then((res) => {
        if (!active) return;
        setCurrentUserRole(res.data?.user?.role || '');
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  const isOwnerManager = ['owner', 'manager', 'admin'].includes(currentUserRole);

  const handleFinishLater = async () => {
    setSubmitting(true);
    try {
      await api.post(`/orders/${order.id}/finish-later`, {
        keep_table: keepTable,
      });
      toast.success(t('finishLaterSuccess'));
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error || (err as Error)?.message || t('finishLaterFailed');
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePayLater = async () => {
    if (!selectedCustomerId) {
      toast.error(t('customerMandatoryError'));
      return;
    }
    if (!reason.trim()) {
      toast.error(t('deferReasonRequiredError'));
      return;
    }
    if (!isOwnerManager && !managerPin) {
      toast.error(t('managerPinRequiredError'));
      return;
    }

    setSubmitting(true);
    try {
      await api.post(`/orders/${order.id}/defer-payment`, {
        customer_id: selectedCustomerId,
        reason: reason.trim(),
        manager_pin: managerPin || undefined,
      });
      toast.success(t('deferPaymentSuccess'));
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error || (err as Error)?.message || t('deferPaymentFailed');
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const balance = order.bill?.balance ?? order.total;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card w-full max-w-md rounded-2xl border border-border shadow-xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Clock size={18} className="text-brand" />
            <h3 className="font-semibold text-foreground">{t('deferredModalTitle')}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-muted-foreground hover:text-foreground active:bg-muted"
            aria-label={tCommon('cancel')}
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab switch */}
        <div className="grid grid-cols-2 p-1 m-4 mb-0 bg-muted/60 rounded-xl text-sm font-medium">
          <button
            type="button"
            onClick={() => setTab('finish_later')}
            className={`py-2 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              tab === 'finish_later'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Clock size={14} /> {t('finishLaterTab')}
          </button>
          <button
            type="button"
            onClick={() => setTab('pay_later')}
            className={`py-2 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              tab === 'pay_later'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <CalendarClock size={14} /> {t('payLaterTab')}
          </button>
        </div>

        {/* Body */}
        <div className="p-4 flex-1 overflow-y-auto space-y-4">
          <div className="p-3 bg-muted/40 rounded-xl flex justify-between items-center text-sm">
            <span className="text-muted-foreground">Order #{order.order_number}</span>
            <span className="font-bold text-foreground">{fmt(Number(balance))}</span>
          </div>

          {tab === 'finish_later' ? (
            <div className="space-y-4">
              <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-xl text-xs text-blue-700 dark:text-blue-300 space-y-1">
                <p className="font-semibold">{t('finishLaterModeTitle')}</p>
                <p>
                  {t('finishLaterModeDesc')}
                </p>
              </div>

              {order.table_id && (
                <label className="flex items-start gap-2.5 p-3 rounded-xl border border-border bg-card cursor-pointer">
                  <input
                    type="checkbox"
                    checked={keepTable}
                    onChange={(e) => setKeepTable(e.target.checked)}
                    className="mt-0.5 rounded border-border text-brand focus:ring-brand"
                  />
                  <div className="text-xs">
                    <p className="font-semibold text-foreground">{t('keepTableOccupied')}</p>
                    <p className="text-muted-foreground mt-0.5">
                      {t('keepTableOccupiedDesc')}
                    </p>
                  </div>
                </label>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-xl text-xs text-amber-700 dark:text-amber-300 space-y-1">
                <p className="font-semibold">{t('payLaterModeTitle')}</p>
                <p>
                  {t('payLaterModeDesc')}
                </p>
              </div>

              {/* Customer selection */}
              <div>
                <label className="text-xs font-semibold text-foreground flex items-center gap-1.5 mb-1">
                  <UserCheck size={14} className="text-brand" />
                  {t('mandatoryCustomer')}
                </label>
                <select
                  value={selectedCustomerId}
                  onChange={(e) => setSelectedCustomerId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border bg-card rounded-lg focus:outline-none focus:ring-2 focus:ring-brand/30"
                >
                  <option value="">{t('selectCustomerPlaceholder')}</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.phone ? `(${c.phone})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Reason */}
              <div>
                <label className="text-xs font-semibold text-foreground block mb-1">
                  {t('deferralReasonLabel')}
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value.slice(0, 200))}
                  placeholder={t('deferralReasonPlaceholder')}
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-border bg-card rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
              </div>

              {/* Manager PIN */}
              {!isOwnerManager && (
                <div>
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5 mb-1">
                    <ShieldCheck size={14} className="text-brand" />
                    {t('managerPinAuthLabel')}
                  </label>
                  <input
                    type="password"
                    maxLength={10}
                    value={managerPin}
                    onChange={(e) => setManagerPin(e.target.value)}
                    placeholder={t('enterManagerPinPlaceholder')}
                    className="w-full px-3 py-2 text-sm border border-border bg-card rounded-lg focus:outline-none focus:ring-2 focus:ring-brand/30 font-mono"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1" disabled={submitting}>
            {tCommon('cancel')}
          </Button>
          {tab === 'finish_later' ? (
            <Button onClick={handleFinishLater} disabled={submitting} className="flex-1">
              {submitting ? tCommon('saving') : t('finishLater')}
            </Button>
          ) : (
            <Button
              onClick={handlePayLater}
              disabled={submitting || !selectedCustomerId || !reason.trim() || (!isOwnerManager && !managerPin)}
              className="flex-1"
            >
              {submitting ? t('deferring') : t('confirmPayLater')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
