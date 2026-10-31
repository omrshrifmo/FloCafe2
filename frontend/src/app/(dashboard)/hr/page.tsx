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
  Users,
  Clock,
  DollarSign,
  Plus,
  Play,
  Printer,
  Calendar,
  CheckCircle2,
  X,
  CreditCard,
  Briefcase,
} from 'lucide-react';

interface EmployeeProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  employment_type: string;
  salary_basis: 'monthly' | 'hourly' | 'daily';
  base_salary: number;
  hourly_rate: number;
  overtime_rate: number;
  national_id: string | null;
  phone: string | null;
  hire_date: string | null;
  emergency_contact: string | null;
}

interface AdvanceLoan {
  id: number;
  user_id: string;
  staff_name: string;
  amount: number;
  deduction_per_period: number;
  balance_remaining: number;
  status: string;
  reason: string | null;
  created_at: string;
}

interface PayrollCalculation {
  user_id: string;
  staff_name: string;
  role: string;
  salary_basis: string;
  base_pay: number;
  overtime_pay: number;
  attendance_deduction: number;
  loan_deduction: number;
  net_pay: number;
  total_hours: number;
  overtime_hours: number;
}

export default function HrPage() {
  const t = useTranslations('hrm');
  const tCommon = useTranslations('common');
  const { currentTenant } = useAuthStore();
  const fmtCurrency = useFormatCurrency();
  const { formatDate } = useFormatDate();

  const [activeTab, setActiveTab] = useState<'attendance' | 'advances' | 'payroll' | 'profiles'>('attendance');

  // Data states
  const [employees, setEmployees] = useState<EmployeeProfile[]>([]);
  const [advances, setAdvances] = useState<AdvanceLoan[]>([]);

  // Attendance Punch Clock state
  const [punchPin, setPunchPin] = useState('');
  const [punchAction, setPunchAction] = useState<'in' | 'out'>('in');
  const [punching, setPunching] = useState(false);

  // Advance Request Modal
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [advanceForm, setAdvanceForm] = useState({
    user_id: '',
    amount: '',
    deduction_per_period: '',
    reason: '',
  });

  // Payroll Calculation State
  const [payrollPeriod, setPayrollPeriod] = useState({
    period_start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    period_end: new Date().toISOString().split('T')[0],
  });
  const [payrollCalculations, setPayrollCalculations] = useState<PayrollCalculation[]>([]);
  const [calculating, setCalculating] = useState(false);
  const [generatingRun, setGeneratingRun] = useState(false);
  const [selectedPayslip, setSelectedPayslip] = useState<PayrollCalculation | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [empRes, advRes] = await Promise.all([
        api.get('/hr/employees'),
        api.get('/hr/advances'),
      ]);
      setEmployees(empRes.data?.employees || []);
      setAdvances(advRes.data?.advances || []);
    } catch {
      toast.error(t('loadError'));
    }
  }, [t]);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.get('/hr/employees'),
      api.get('/hr/advances'),
    ])
      .then(([empRes, advRes]) => {
        if (!active) return;
        setEmployees(empRes.data?.employees || []);
        setAdvances(advRes.data?.advances || []);
      })
      .catch(() => {
        if (active) toast.error(t('loadError'));
      });
    return () => {
      active = false;
    };
  }, [t]);

  // Attendance Clock-in / Clock-out
  const handlePunchClock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!punchPin || punchPin.length < 4) {
      toast.error(t('pinPlaceholder'));
      return;
    }

    try {
      setPunching(true);
      if (punchAction === 'in') {
        const res = await api.post('/hr/attendance/clock-in', { pin: punchPin });
        toast.success(res.data?.attendance?.staff_name || t('punchSuccess'));
      } else {
        const res = await api.post('/hr/attendance/clock-out', { pin: punchPin });
        toast.success(res.data?.attendance?.staff_name || t('punchSuccess'));
      }
      setPunchPin('');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg || t('punchError'));
    } finally {
      setPunching(false);
    }
  };

  // Submit Advance Request
  const handleRequestAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!advanceForm.user_id || !advanceForm.amount) {
      toast.error(t('formAmount'));
      return;
    }

    try {
      await api.post('/hr/advances', {
        user_id: advanceForm.user_id,
        amount: Number(advanceForm.amount),
        deduction_per_period: Number(advanceForm.deduction_per_period || 0),
        reason: advanceForm.reason || null,
      });
      toast.success(t('advanceSuccess'));
      setShowAdvanceModal(false);
      setAdvanceForm({ user_id: '', amount: '', deduction_per_period: '', reason: '' });
      void loadAll();
    } catch {
      toast.error(t('advanceError'));
    }
  };

  // Run Payroll Calculation
  const handleCalculatePayroll = async () => {
    try {
      setCalculating(true);
      const res = await api.post('/hr/payroll/calculate', payrollPeriod);
      setPayrollCalculations(res.data?.calculations || []);
      toast.success(t('calculating'));
    } catch {
      toast.error(t('payrollFinalizedError'));
    } finally {
      setCalculating(false);
    }
  };

  // Finalize Payroll Run
  const handleFinalizePayrollRun = async () => {
    if (payrollCalculations.length === 0) return;
    try {
      setGeneratingRun(true);
      await api.post('/hr/payroll/runs', {
        period_start: payrollPeriod.period_start,
        period_end: payrollPeriod.period_end,
        items: payrollCalculations,
      });
      toast.success(t('payrollFinalizedSuccess'));
      void loadAll();
    } catch {
      toast.error(t('payrollFinalizedError'));
    } finally {
      setGeneratingRun(false);
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Users className="h-7 w-7 text-brand" />
            {t('title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'advances' && (
            <Button onClick={() => setShowAdvanceModal(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />
              {t('btnRequestAdvance')}
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border gap-2">
        <button
          onClick={() => setActiveTab('attendance')}
          className={`py-2.5 px-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'attendance'
              ? 'border-brand text-brand'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Clock className="h-4 w-4" />
          {t('tabAttendance')}
        </button>

        <button
          onClick={() => setActiveTab('advances')}
          className={`py-2.5 px-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'advances'
              ? 'border-brand text-brand'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <CreditCard className="h-4 w-4" />
          {t('tabAdvances')}
        </button>

        <button
          onClick={() => setActiveTab('payroll')}
          className={`py-2.5 px-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'payroll'
              ? 'border-brand text-brand'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <DollarSign className="h-4 w-4" />
          {t('tabPayroll')}
        </button>

        <button
          onClick={() => setActiveTab('profiles')}
          className={`py-2.5 px-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'profiles'
              ? 'border-brand text-brand'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Briefcase className="h-4 w-4" />
          {t('tabProfiles')}
        </button>
      </div>

      {/* TAB 1: PUNCH CLOCK */}
      {activeTab === 'attendance' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-card p-6 rounded-2xl border border-border shadow-xs space-y-4">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Clock className="h-5 w-5 text-brand" />
              {t('punchClockTitle')}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t('punchClockSubtitle')}
            </p>

            <form onSubmit={handlePunchClock} className="space-y-4 pt-2">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={punchAction === 'in' ? 'default' : 'outline'}
                  onClick={() => setPunchAction('in')}
                  className="flex-1"
                >
                  {t('btnClockIn')}
                </Button>
                <Button
                  type="button"
                  variant={punchAction === 'out' ? 'default' : 'outline'}
                  onClick={() => setPunchAction('out')}
                  className="flex-1"
                >
                  {t('btnClockOut')}
                </Button>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">{t('pinPlaceholder')}</label>
                <input
                  type="password"
                  maxLength={6}
                  value={punchPin}
                  onChange={(e) => setPunchPin(e.target.value)}
                  placeholder="••••"
                  className="w-full text-center tracking-widest text-xl px-4 py-3 bg-background border border-border rounded-xl font-mono focus:outline-hidden focus:ring-2 focus:ring-brand"
                  required
                />
              </div>

              <Button type="submit" disabled={punching} className="w-full py-6 text-base font-semibold">
                {punching ? t('punching') : punchAction === 'in' ? t('btnClockIn') : t('btnClockOut')}
              </Button>
            </form>
          </div>

          <div className="md:col-span-2 bg-card p-6 rounded-2xl border border-border">
            <h2 className="text-base font-semibold text-foreground mb-4">{t('tabAttendance')}</h2>
            <div className="space-y-3">
              {employees.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">{t('noAdvances')}</p>
              ) : (
                employees.slice(0, 6).map((emp) => (
                  <div key={emp.id} className="flex items-center justify-between p-3.5 bg-muted/40 rounded-xl border border-border/50">
                    <div>
                      <div className="font-medium text-foreground">{emp.name}</div>
                      <div className="text-xs text-muted-foreground capitalize">{emp.role} · {emp.employment_type}</div>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {emp.salary_basis === 'hourly' ? `${fmtCurrency(emp.hourly_rate)}/hr` : `${fmtCurrency(emp.base_salary)}/mo`}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ADVANCES & LOANS */}
      {activeTab === 'advances' && (
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">{t('tabAdvances')}</h2>
            <span className="text-xs text-muted-foreground">{advances.length}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground uppercase border-b border-border">
                <tr>
                  <th className="py-3 px-4 text-start font-medium">{t('colDateRequested')}</th>
                  <th className="py-3 px-4 text-start font-medium">{t('colStaff')}</th>
                  <th className="py-3 px-4 text-start font-medium">{t('colReason')}</th>
                  <th className="py-3 px-4 text-end font-medium">{t('colAdvanceAmount')}</th>
                  <th className="py-3 px-4 text-end font-medium">{t('colInstallment')}</th>
                  <th className="py-3 px-4 text-end font-medium">{t('colBalance')}</th>
                  <th className="py-3 px-4 text-center font-medium">{t('colStatus')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {advances.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-muted-foreground">
                      {t('noAdvances')}
                    </td>
                  </tr>
                ) : (
                  advances.map((adv) => (
                    <tr key={adv.id} className="hover:bg-muted/30">
                      <td className="py-3.5 px-4 text-xs text-muted-foreground">{formatDate(adv.created_at)}</td>
                      <td className="py-3.5 px-4 font-medium text-foreground">{adv.staff_name}</td>
                      <td className="py-3.5 px-4 text-xs text-muted-foreground">{adv.reason || '—'}</td>
                      <td className="py-3.5 px-4 text-end font-semibold">{fmtCurrency(adv.amount)}</td>
                      <td className="py-3.5 px-4 text-end text-muted-foreground">{fmtCurrency(adv.deduction_per_period)}</td>
                      <td className="py-3.5 px-4 text-end font-bold text-amber-600">{fmtCurrency(adv.balance_remaining)}</td>
                      <td className="py-3.5 px-4 text-center">
                        <Badge variant={adv.status === 'active' ? 'secondary' : 'outline'} className="capitalize">
                          {adv.status}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: PAYROLL RUNS */}
      {activeTab === 'payroll' && (
        <div className="space-y-6">
          <div className="bg-card p-5 rounded-2xl border border-border flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span>{t('payrollPeriodStart')}:</span>
              </div>
              <input
                type="date"
                value={payrollPeriod.period_start}
                onChange={(e) => setPayrollPeriod({ ...payrollPeriod, period_start: e.target.value })}
                className="px-2.5 py-1.5 bg-background border border-border rounded-lg text-xs"
              />
              <span className="text-xs text-muted-foreground">-</span>
              <input
                type="date"
                value={payrollPeriod.period_end}
                onChange={(e) => setPayrollPeriod({ ...payrollPeriod, period_end: e.target.value })}
                className="px-2.5 py-1.5 bg-background border border-border rounded-lg text-xs"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={handleCalculatePayroll} disabled={calculating} variant="outline" className="gap-1.5">
                <Play className="h-4 w-4" />
                {calculating ? t('calculating') : t('btnCalculatePayroll')}
              </Button>
              {payrollCalculations.length > 0 && (
                <Button onClick={handleFinalizePayrollRun} disabled={generatingRun} className="gap-1.5">
                  <CheckCircle2 className="h-4 w-4" />
                  {generatingRun ? t('generating') : t('btnGenerateRun')}
                </Button>
              )}
            </div>
          </div>

          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">{t('tabPayroll')}</h2>
              <span className="text-xs text-muted-foreground">{payrollCalculations.length}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground uppercase border-b border-border">
                  <tr>
                    <th className="py-3 px-4 text-start font-medium">{t('colEmployee')}</th>
                    <th className="py-3 px-4 text-start font-medium">{t('colSalaryBasis')}</th>
                    <th className="py-3 px-4 text-end font-medium">{t('colBaseSalary')}</th>
                    <th className="py-3 px-4 text-end font-medium">{t('colOvertime')}</th>
                    <th className="py-3 px-4 text-end font-medium">{t('colDeductions')}</th>
                    <th className="py-3 px-4 text-end font-medium font-bold text-foreground">{t('colNetPay')}</th>
                    <th className="py-3 px-4 text-center font-medium">{t('colAction')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {payrollCalculations.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-muted-foreground">
                        {t('noPayrollCalculations')}
                      </td>
                    </tr>
                  ) : (
                    payrollCalculations.map((calc, i) => (
                      <tr key={i} className="hover:bg-muted/30">
                        <td className="py-3.5 px-4">
                          <div className="font-medium text-foreground">{calc.staff_name}</div>
                          <div className="text-xs text-muted-foreground capitalize">{calc.role}</div>
                        </td>
                        <td className="py-3.5 px-4 text-xs text-muted-foreground capitalize">{calc.salary_basis}</td>
                        <td className="py-3.5 px-4 text-end">{fmtCurrency(calc.base_pay)}</td>
                        <td className="py-3.5 px-4 text-end text-emerald-600">+{fmtCurrency(calc.overtime_pay)}</td>
                        <td className="py-3.5 px-4 text-end text-rose-600">-{fmtCurrency(calc.loan_deduction)}</td>
                        <td className="py-3.5 px-4 text-end font-bold text-foreground">{fmtCurrency(calc.net_pay)}</td>
                        <td className="py-3.5 px-4 text-center">
                          <Button size="sm" variant="ghost" onClick={() => setSelectedPayslip(calc)} className="gap-1 text-xs">
                            <Printer className="h-3.5 w-3.5" />
                            {t('btnViewPayslip')}
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

      {/* TAB 4: PROFILES */}
      {activeTab === 'profiles' && (
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">{t('tabProfiles')}</h2>
            <span className="text-xs text-muted-foreground">{employees.length}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground uppercase border-b border-border">
                <tr>
                  <th className="py-3 px-4 text-start font-medium">{t('colEmployee')}</th>
                  <th className="py-3 px-4 text-start font-medium">{t('colSalaryBasis')}</th>
                  <th className="py-3 px-4 text-start font-medium">Type</th>
                  <th className="py-3 px-4 text-start font-medium">{t('colSalaryBasis')}</th>
                  <th className="py-3 px-4 text-end font-medium">{t('colBaseSalary')}</th>
                  <th className="py-3 px-4 text-start font-medium">Contact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {employees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-muted/30">
                    <td className="py-3.5 px-4 font-medium text-foreground">{emp.name}</td>
                    <td className="py-3.5 px-4 text-xs capitalize text-muted-foreground">{emp.role}</td>
                    <td className="py-3.5 px-4 text-xs capitalize text-muted-foreground">{emp.employment_type}</td>
                    <td className="py-3.5 px-4 text-xs capitalize text-muted-foreground">{emp.salary_basis}</td>
                    <td className="py-3.5 px-4 text-end font-semibold">
                      {emp.salary_basis === 'hourly' ? `${fmtCurrency(emp.hourly_rate)}/hr` : `${fmtCurrency(emp.base_salary)}/mo`}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-muted-foreground">{emp.phone || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Advance Request Modal */}
      {showAdvanceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h3 className="text-lg font-bold text-foreground">{t('modalAdvanceTitle')}</h3>
              <button type="button" onClick={() => setShowAdvanceModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleRequestAdvance} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">{t('formEmployee')}</label>
                <select
                  value={advanceForm.user_id}
                  onChange={(e) => setAdvanceForm({ ...advanceForm, user_id: e.target.value })}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                  required
                >
                  <option value="">{t('formEmployee')}...</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.role})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">{t('formAmount')}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    value={advanceForm.amount}
                    onChange={(e) => setAdvanceForm({ ...advanceForm, amount: e.target.value })}
                    placeholder="0.00"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">{t('formInstallment')}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={advanceForm.deduction_per_period}
                    onChange={(e) => setAdvanceForm({ ...advanceForm, deduction_per_period: e.target.value })}
                    placeholder="0.00"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">{t('formReason')}</label>
                <textarea
                  value={advanceForm.reason}
                  onChange={(e) => setAdvanceForm({ ...advanceForm, reason: e.target.value })}
                  placeholder={t('formReason')}
                  rows={2}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-border">
                <Button type="button" variant="outline" onClick={() => setShowAdvanceModal(false)}>
                  {t('btnCancel')}
                </Button>
                <Button type="submit">{t('btnSaveAdvance')}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payslip Printable Modal */}
      {selectedPayslip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="font-bold text-foreground text-lg">{t('modalPayslipTitle')}</h3>
                <span className="text-xs text-muted-foreground">{currentTenant?.business_name || 'FloCafe'}</span>
              </div>
              <button type="button" onClick={() => setSelectedPayslip(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('colStaff')}:</span>
                <span className="font-semibold">{selectedPayslip.staff_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Role:</span>
                <span className="capitalize">{selectedPayslip.role}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('payrollPeriodStart')}:</span>
                <span>{payrollPeriod.period_start} - {payrollPeriod.period_end}</span>
              </div>
              <div className="border-t border-border pt-2 space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('lblGrossPay')}</span>
                  <span>{fmtCurrency(selectedPayslip.base_pay)}</span>
                </div>
                {selectedPayslip.overtime_pay > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <span>{t('lblOvertimePay')} ({selectedPayslip.overtime_hours} hrs):</span>
                    <span>+{fmtCurrency(selectedPayslip.overtime_pay)}</span>
                  </div>
                )}
                {selectedPayslip.loan_deduction > 0 && (
                  <div className="flex justify-between text-rose-600">
                    <span>{t('lblLoanDeduction')}</span>
                    <span>-{fmtCurrency(selectedPayslip.loan_deduction)}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-bold pt-2 border-t border-border">
                  <span>{t('lblNetPayable')}</span>
                  <span className="text-brand">{fmtCurrency(selectedPayslip.net_pay)}</span>
                </div>
              </div>
            </div>

            <div className="pt-3 flex gap-2">
              <Button onClick={() => window.print()} className="w-full gap-1.5">
                <Printer className="h-4 w-4" />
                {t('btnPrintPayslip')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
