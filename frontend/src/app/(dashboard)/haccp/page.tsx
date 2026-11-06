'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { useFormatDate } from '@/hooks/useFormatDate';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import toast from 'react-hot-toast';
import { useTranslations } from 'use-intl';
import { useAppLanguage } from '@/lib/i18n/bilingual';
import {
  ClipboardCheck,
  Thermometer,
  Plus,
  Play,
  CheckSquare,
  UserCheck,
  PackageCheck,
  X,
} from 'lucide-react';

interface ChecklistTemplate {
  id: number;
  title: string;
  category: string;
  frequency: string;
  is_active: number;
  items_json: string;
}

interface ChecklistItem {
  id: string;
  label: string;
  type: 'checkbox' | 'temperature';
  min_temp?: number;
  max_temp?: number;
}

interface ChecklistRun {
  id: number;
  template_id: number;
  template_title?: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  score_percent: number;
  has_critical_failure: number;
  answers_json: string;
  submitted_by_name: string | null;
  reviewed_by_name: string | null;
  created_at: string;
}

interface SanitationChecklist {
  id: string;
  business_date: string;
  shift_type: 'opening' | 'mid_shift' | 'closing';
  task_title: string;
  area: string;
  is_completed: number;
  verified_by: string | null;
  completed_at: string | null;
  notes: string | null;
}

interface CcpLog {
  id: string;
  station_name: string;
  ccp_category: string;
  target_min: number | null;
  target_max: number | null;
  recorded_value: number;
  unit: string;
  status: 'pass' | 'warning' | 'critical_breach';
  corrective_action: string | null;
  recorded_by: string;
  recorded_at: string;
}

interface HaccpBatch {
  id: string;
  batch_number: string;
  item_name: string;
  item_type: string;
  quantity: number;
  unit: string;
  received_at: string;
  expires_at: string;
  status: 'active' | 'expiring_soon' | 'expired' | 'discarded';
  notes: string | null;
}

export default function HaccpPage() {
  const t = useTranslations('haccp');
  const { isAr, tr, dir } = useAppLanguage();
  const { formatDate } = useFormatDate();

  const [activeTab, setActiveTab] = useState<'checklists' | 'ccp' | 'batches' | 'execute' | 'runs'>('checklists');

  // Templates & Runs State
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [runs, setRuns] = useState<ChecklistRun[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<ChecklistTemplate | null>(null);
  const [answers, setAnswers] = useState<Record<string, { value: boolean | number | string; passed: boolean; note?: string }>>({});
  const [submittingRun, setSubmittingRun] = useState(false);

  // Sanitation Checklists State
  const [sanitationDate, setSanitationDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [shiftFilter, setShiftFilter] = useState<string>('all');
  const [checklists, setChecklists] = useState<SanitationChecklist[]>([]);
  const [loadingChecklists, setLoadingChecklists] = useState(false);

  // CCP Temperature Logs State
  const [ccpLogs, setCcpLogs] = useState<CcpLog[]>([]);
  const [loadingCcp, setLoadingCcp] = useState(false);
  const [ccpStatusFilter, setCcpStatusFilter] = useState('all');
  const [showCcpModal, setShowCcpModal] = useState(false);
  const [ccpForm, setCcpForm] = useState({
    station_name: 'Espresso Bar Fridge',
    ccp_category: 'Cold Storage (Dairy)',
    target_min: '1.0',
    target_max: '4.0',
    recorded_value: '',
    unit: 'C',
    corrective_action: '',
  });

  // Batch Tracking State
  const [batches, setBatches] = useState<HaccpBatch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [batchStatusFilter, setBatchStatusFilter] = useState('all');
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchForm, setBatchForm] = useState({
    batch_number: '',
    item_name: '',
    item_type: 'dairy',
    quantity: '10',
    unit: 'L',
    expires_at: '',
    notes: '',
  });

  // 1. Load Templates & Runs
  const loadTemplatesAndRuns = useCallback(async () => {
    try {
      const [tplRes, runsRes] = await Promise.all([
        api.get('/haccp/templates'),
        api.get('/haccp/runs'),
      ]);
      const loadedTemplates: ChecklistTemplate[] = tplRes.data?.templates || [];
      setTemplates(loadedTemplates);
      setRuns(runsRes.data?.runs || []);
      setSelectedTemplate((current) => current || (loadedTemplates.length > 0 ? loadedTemplates[0] : null));
    } catch {
      toast.error(t('loadError'));
    }
  }, [t]);

  // 2. Load Daily Sanitation Checklists
  const loadChecklists = useCallback(async () => {
    setLoadingChecklists(true);
    try {
      const params: Record<string, string> = { business_date: sanitationDate };
      if (shiftFilter !== 'all') params.shift_type = shiftFilter;
      const res = await api.get('/haccp/checklists', { params });
      setChecklists(res.data?.checklists || []);
    } catch {
      toast.error('Failed to load sanitation checklists');
    } finally {
      setLoadingChecklists(false);
    }
  }, [sanitationDate, shiftFilter]);

  // 3. Load CCP Logs
  const loadCcpLogs = useCallback(async () => {
    setLoadingCcp(true);
    try {
      const params: Record<string, string> = {};
      if (ccpStatusFilter !== 'all') params.status = ccpStatusFilter;
      const res = await api.get('/haccp/ccp-logs', { params });
      setCcpLogs(res.data?.ccp_logs || []);
    } catch {
      toast.error('Failed to load CCP temperature logs');
    } finally {
      setLoadingCcp(false);
    }
  }, [ccpStatusFilter]);

  // 4. Load Perishable Batches
  const loadBatches = useCallback(async () => {
    setLoadingBatches(true);
    try {
      const params: Record<string, string> = {};
      if (batchStatusFilter !== 'all') params.status = batchStatusFilter;
      const res = await api.get('/haccp/batches', { params });
      setBatches(res.data?.batches || []);
    } catch {
      toast.error('Failed to load perishable batches');
    } finally {
      setLoadingBatches(false);
    }
  }, [batchStatusFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTemplatesAndRuns();
  }, [loadTemplatesAndRuns]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeTab === 'checklists') void loadChecklists();
    if (activeTab === 'ccp') void loadCcpLogs();
    if (activeTab === 'batches') void loadBatches();
  }, [activeTab, loadChecklists, loadCcpLogs, loadBatches]);

  // Handlers for Sanitation Checklists
  const handleToggleChecklist = async (id: string, currentStatus: number) => {
    try {
      await api.post(`/haccp/checklists/${id}/toggle`, {
        is_completed: currentStatus === 1 ? false : true,
      });
      void loadChecklists();
      toast.success(currentStatus === 1 ? 'Marked incomplete' : 'Task verified');
    } catch {
      toast.error('Failed to toggle checklist task');
    }
  };

  // Handlers for CCP Logs
  const handleCreateCcpLog = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = Number(ccpForm.recorded_value);
    if (!Number.isFinite(val)) {
      toast.error('Please enter a valid recorded temperature');
      return;
    }
    const min = ccpForm.target_min ? Number(ccpForm.target_min) : null;
    const max = ccpForm.target_max ? Number(ccpForm.target_max) : null;
    const isBreach = (min !== null && val < min) || (max !== null && val > max);

    if (isBreach && !ccpForm.corrective_action.trim()) {
      toast.error('Critical breach: you must provide a corrective action before logging');
      return;
    }

    try {
      await api.post('/haccp/ccp-logs', {
        station_name: ccpForm.station_name,
        ccp_category: ccpForm.ccp_category,
        target_min: min,
        target_max: max,
        recorded_value: val,
        unit: ccpForm.unit,
        corrective_action: ccpForm.corrective_action.trim() || undefined,
      });
      toast.success('CCP Temperature logged');
      setShowCcpModal(false);
      setCcpForm({
        station_name: 'Espresso Bar Fridge',
        ccp_category: 'Cold Storage (Dairy)',
        target_min: '1.0',
        target_max: '4.0',
        recorded_value: '',
        unit: 'C',
        corrective_action: '',
      });
      void loadCcpLogs();
    } catch (err: unknown) {
      const errResp = err as { response?: { data?: { error?: string } } };
      toast.error(errResp.response?.data?.error || 'Failed to record CCP log');
    }
  };

  // Handlers for Batches
  const handleCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batchForm.batch_number || !batchForm.item_name || !batchForm.expires_at) {
      toast.error('Batch #, Item Name, and Expiry Date are required');
      return;
    }
    try {
      await api.post('/haccp/batches', {
        batch_number: batchForm.batch_number,
        item_name: batchForm.item_name,
        item_type: batchForm.item_type,
        quantity: Number(batchForm.quantity) || 1,
        unit: batchForm.unit,
        expires_at: batchForm.expires_at,
        notes: batchForm.notes || undefined,
      });
      toast.success('Batch registered');
      setShowBatchModal(false);
      setBatchForm({
        batch_number: '',
        item_name: '',
        item_type: 'dairy',
        quantity: '10',
        unit: 'L',
        expires_at: '',
        notes: '',
      });
      void loadBatches();
    } catch (err: unknown) {
      const errResp = err as { response?: { data?: { error?: string } } };
      toast.error(errResp.response?.data?.error || 'Failed to create batch');
    }
  };

  const handleDiscardBatch = async (id: string) => {
    const reason = prompt('Reason for batch discard (e.g. expired, curdled, contaminated):');
    if (reason === null) return;
    try {
      await api.post(`/haccp/batches/${id}/discard`, { discard_reason: reason || 'Expired' });
      toast.success('Batch marked as discarded');
      void loadBatches();
    } catch (err: unknown) {
      const errResp = err as { response?: { data?: { error?: string } } };
      toast.error(errResp.response?.data?.error || 'Failed to discard batch');
    }
  };

  // Execution Handlers
  const handleSelectTemplate = (tpl: ChecklistTemplate) => {
    setSelectedTemplate(tpl);
    setAnswers({});
  };

  const parsedItems: ChecklistItem[] = selectedTemplate
    ? (() => {
        try {
          return JSON.parse(selectedTemplate.items_json);
        } catch {
          return [];
        }
      })()
    : [];

  const handleCheckboxChange = (itemId: string, checked: boolean) => {
    setAnswers((prev) => ({
      ...prev,
      [itemId]: { value: checked, passed: checked },
    }));
  };

  const handleTempChange = (item: ChecklistItem, tempStr: string) => {
    const val = parseFloat(tempStr);
    const hasMin = typeof item.min_temp === 'number';
    const hasMax = typeof item.max_temp === 'number';
    let passed = true;
    if (!isNaN(val)) {
      if (hasMin && val < (item.min_temp ?? 0)) passed = false;
      if (hasMax && val > (item.max_temp ?? 0)) passed = false;
    } else {
      passed = false;
    }

    setAnswers((prev) => ({
      ...prev,
      [item.id]: { value: isNaN(val) ? tempStr : val, passed },
    }));
  };

  const handleSubmitRun = async () => {
    if (!selectedTemplate) return;

    try {
      setSubmittingRun(true);
      const itemsAnswered = Object.keys(answers).length;
      if (itemsAnswered < parsedItems.length) {
        if (!confirm(`You have only checked ${itemsAnswered} of ${parsedItems.length} items. Submit anyway?`)) {
          setSubmittingRun(false);
          return;
        }
      }

      await api.post('/haccp/runs', {
        template_id: selectedTemplate.id,
        answers,
      });

      toast.success(t('submitSuccess'));
      setAnswers({});
      void loadTemplatesAndRuns();
      setActiveTab('runs');
    } catch {
      toast.error(t('submitError'));
    } finally {
      setSubmittingRun(false);
    }
  };

  const handleReviewRun = async (runId: number, status: 'approved' | 'rejected') => {
    try {
      await api.post(`/haccp/runs/${runId}/review`, { status, review_notes: 'Reviewed in manager console' });
      toast.success(`Inspection marked as ${status}`);
      void loadTemplatesAndRuns();
    } catch {
      toast.error(t('submitError'));
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-7xl mx-auto" dir={dir}>
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <ClipboardCheck className="h-7 w-7 text-brand" />
            {tr('HACCP Food Safety & Hygiene Control', 'نظام سلامة الغذاء والنظافة والرقابة الصحية (HACCP)')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {tr('Food Safety & Hygiene Quality Assurance (HACCP / ISO 22000)', 'ضمان جودة سلامة الغذاء والنظافة القياسية (HACCP / ISO 22000)')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'ccp' && (
            <Button onClick={() => setShowCcpModal(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />
              {tr('Log CCP Temperature', 'تسجيل درجة حرارة نقطة حرجة (CCP)')}
            </Button>
          )}
          {activeTab === 'batches' && (
            <Button onClick={() => setShowBatchModal(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />
              {tr('Register Batch', 'تسجيل تشغيلة / دفعة جديدة')}
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setActiveTab('checklists')}
          className={`py-2 px-3 text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'checklists' ? 'bg-brand text-brand-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <CheckSquare className="h-4 w-4" />
          {tr('Daily Sanitation Checklists', 'قوائم التعقيم والنظافة اليومية')}
        </button>

        <button
          onClick={() => setActiveTab('ccp')}
          className={`py-2 px-3 text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'ccp' ? 'bg-brand text-brand-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Thermometer className="h-4 w-4" />
          {tr('CCP Temperature Logs', 'سجل درجات الحرارة والنقاط الحرجة')}
        </button>

        <button
          onClick={() => setActiveTab('batches')}
          className={`py-2 px-3 text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'batches' ? 'bg-brand text-brand-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <PackageCheck className="h-4 w-4" />
          {tr('Perishable Batch Expiry', 'صلاحية التشغيلات السريعة التلف')}
        </button>

        <button
          onClick={() => setActiveTab('execute')}
          className={`py-2 px-3 text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'execute' ? 'bg-brand text-brand-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Play className="h-4 w-4" />
          {tr('Audit Templates', 'نماذج التفتيش')}
        </button>

        <button
          onClick={() => setActiveTab('runs')}
          className={`py-2 px-3 text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'runs' ? 'bg-brand text-brand-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <UserCheck className="h-4 w-4" />
          {tr('Audit Runs', 'عمليات التفتيش السابقة')} ({runs.length})
        </button>
      </div>

      {/* TAB 1: SANITATION CHECKLISTS */}
      {activeTab === 'checklists' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 bg-card p-4 rounded-xl border border-border">
            <div className="flex items-center gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Date</label>
                <input
                  type="date"
                  value={sanitationDate}
                  onChange={(e) => setSanitationDate(e.target.value)}
                  className="px-2.5 py-1.5 bg-background border border-border rounded-lg text-xs"
                />
              </div>

              <div>
                <label className="block text-xs text-muted-foreground mb-1">Shift</label>
                <select
                  value={shiftFilter}
                  onChange={(e) => setShiftFilter(e.target.value)}
                  className="px-3 py-1.5 bg-background border border-border rounded-lg text-xs"
                >
                  <option value="all">All Shifts</option>
                  <option value="opening">Opening</option>
                  <option value="mid_shift">Mid-Shift</option>
                  <option value="closing">Closing</option>
                </select>
              </div>
            </div>

            <Button size="sm" onClick={() => void loadChecklists()} disabled={loadingChecklists}>
              Refresh
            </Button>
          </div>

          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">Sanitation & Hygiene Tasks</h2>
              <span className="text-xs text-muted-foreground">
                {checklists.filter((c) => c.is_completed === 1).length} / {checklists.length} completed
              </span>
            </div>

            <div className="divide-y divide-border">
              {loadingChecklists ? (
                <div className="py-12 text-center text-muted-foreground">Loading tasks...</div>
              ) : checklists.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">No tasks scheduled for this shift.</div>
              ) : (
                checklists.map((c) => (
                  <div
                    key={c.id}
                    className={`p-4 flex items-center justify-between gap-4 transition-colors ${
                      c.is_completed ? 'bg-muted/10' : 'hover:bg-muted/30'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={c.is_completed === 1}
                        onChange={() => void handleToggleChecklist(c.id, c.is_completed)}
                        className="mt-1 h-5 w-5 rounded-md border-border text-brand focus:ring-brand cursor-pointer"
                      />
                      <div>
                        <div className={`font-medium ${c.is_completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                          {c.task_title}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-[10px] capitalize">
                            {c.shift_type.replace('_', ' ')}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{c.area}</span>
                          {c.verified_by && (
                            <span className="text-xs text-emerald-600 dark:text-emerald-400">
                              · Verified by {c.verified_by} ({formatDate(c.completed_at || '')})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: CCP TEMPERATURE LOGS */}
      {activeTab === 'ccp' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 bg-card p-4 rounded-xl border border-border">
            <div className="flex items-center gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Status Filter</label>
                <select
                  value={ccpStatusFilter}
                  onChange={(e) => setCcpStatusFilter(e.target.value)}
                  className="px-3 py-1.5 bg-background border border-border rounded-lg text-xs"
                >
                  <option value="all">All Readings</option>
                  <option value="pass">Pass</option>
                  <option value="warning">Warning</option>
                  <option value="critical_breach">Critical Breach</option>
                </select>
              </div>
            </div>

            <Button size="sm" onClick={() => void loadCcpLogs()} disabled={loadingCcp}>
              Refresh
            </Button>
          </div>

          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">Critical Control Point (CCP) Readings</h2>
              <span className="text-xs text-muted-foreground">{ccpLogs.length} logs</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground uppercase border-b border-border">
                  <tr>
                    <th className="py-3 px-4 text-start font-medium">Timestamp</th>
                    <th className="py-3 px-4 text-start font-medium">Station & CCP Category</th>
                    <th className="py-3 px-4 text-start font-medium">Target Range</th>
                    <th className="py-3 px-4 text-start font-medium">Recorded Value</th>
                    <th className="py-3 px-4 text-start font-medium">Status</th>
                    <th className="py-3 px-4 text-start font-medium">Corrective Action</th>
                    <th className="py-3 px-4 text-start font-medium">Staff</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loadingCcp ? (
                    <tr><td colSpan={7} className="py-12 text-center text-muted-foreground">Loading CCP logs...</td></tr>
                  ) : ccpLogs.length === 0 ? (
                    <tr><td colSpan={7} className="py-12 text-center text-muted-foreground">No CCP readings recorded.</td></tr>
                  ) : (
                    ccpLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3.5 px-4 text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(log.recorded_at)}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-medium text-foreground">{log.station_name}</div>
                          <div className="text-xs text-muted-foreground">{log.ccp_category}</div>
                        </td>
                        <td className="py-3.5 px-4 text-xs">
                          {log.target_min ?? '—'} to {log.target_max ?? '—'} °{log.unit}
                        </td>
                        <td className="py-3.5 px-4 font-bold">
                          {log.recorded_value} °{log.unit}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <Badge
                            variant={log.status === 'pass' ? 'default' : log.status === 'warning' ? 'secondary' : 'destructive'}
                            className="capitalize"
                          >
                            {log.status.replace('_', ' ')}
                          </Badge>
                        </td>
                        <td className="py-3.5 px-4 text-xs">
                          {log.corrective_action || '—'}
                        </td>
                        <td className="py-3.5 px-4 text-xs text-muted-foreground">
                          {log.recorded_by}
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

      {/* TAB 3: PERISHABLE BATCH TRACKING */}
      {activeTab === 'batches' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 bg-card p-4 rounded-xl border border-border">
            <div className="flex items-center gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Status</label>
                <select
                  value={batchStatusFilter}
                  onChange={(e) => setBatchStatusFilter(e.target.value)}
                  className="px-3 py-1.5 bg-background border border-border rounded-lg text-xs"
                >
                  <option value="all">All Batches</option>
                  <option value="active">Active</option>
                  <option value="expiring_soon">Expiring Soon</option>
                  <option value="expired">Expired</option>
                  <option value="discarded">Discarded</option>
                </select>
              </div>
            </div>

            <Button size="sm" onClick={() => void loadBatches()} disabled={loadingBatches}>
              Refresh
            </Button>
          </div>

          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">Perishable Inventory Batches & Lots</h2>
              <span className="text-xs text-muted-foreground">{batches.length} batches</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground uppercase border-b border-border">
                  <tr>
                    <th className="py-3 px-4 text-start font-medium">Batch #</th>
                    <th className="py-3 px-4 text-start font-medium">Item Name</th>
                    <th className="py-3 px-4 text-start font-medium">Quantity</th>
                    <th className="py-3 px-4 text-start font-medium">Received Date</th>
                    <th className="py-3 px-4 text-start font-medium">Expiry Date</th>
                    <th className="py-3 px-4 text-start font-medium">Status</th>
                    <th className="py-3 px-4 text-center font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loadingBatches ? (
                    <tr><td colSpan={7} className="py-12 text-center text-muted-foreground">Loading batches...</td></tr>
                  ) : batches.length === 0 ? (
                    <tr><td colSpan={7} className="py-12 text-center text-muted-foreground">No perishable batches registered.</td></tr>
                  ) : (
                    batches.map((b) => (
                      <tr key={b.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3.5 px-4 font-mono text-xs font-semibold">
                          {b.batch_number}
                        </td>
                        <td className="py-3.5 px-4 font-medium text-foreground">
                          {b.item_name}
                          <span className="text-xs text-muted-foreground ml-2 capitalize">({b.item_type})</span>
                        </td>
                        <td className="py-3.5 px-4 text-sm font-semibold">
                          {b.quantity} {b.unit}
                        </td>
                        <td className="py-3.5 px-4 text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(b.received_at)}
                        </td>
                        <td className="py-3.5 px-4 text-xs font-medium whitespace-nowrap">
                          {formatDate(b.expires_at)}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <Badge
                            variant={
                              b.status === 'active'
                                ? 'default'
                                : b.status === 'expiring_soon'
                                ? 'secondary'
                                : b.status === 'expired'
                                ? 'destructive'
                                : 'outline'
                            }
                            className="capitalize"
                          >
                            {b.status.replace('_', ' ')}
                          </Badge>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          {b.status !== 'discarded' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void handleDiscardBatch(b.id)}
                              className="text-rose-600 hover:text-rose-700 hover:bg-rose-500/10 p-1.5 h-auto text-xs"
                            >
                              Discard
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">Discarded</span>
                          )}
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

      {/* TAB 4: AUDIT TEMPLATES / EXECUTE */}
      {activeTab === 'execute' && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-card p-4 rounded-2xl border border-border space-y-2">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {t('tabTemplates')}
            </h2>
            {templates.map((tpl) => (
              <button
                key={tpl.id}
                onClick={() => handleSelectTemplate(tpl)}
                className={`w-full text-start p-3 rounded-xl text-sm transition-all border ${
                  selectedTemplate?.id === tpl.id
                    ? 'bg-brand/10 border-brand text-brand font-semibold shadow-xs'
                    : 'bg-background hover:bg-muted border-border text-foreground'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>{tpl.title}</span>
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {tpl.frequency}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground block mt-1 capitalize">{tpl.category}</span>
              </button>
            ))}
          </div>

          <div className="md:col-span-3 bg-card p-6 rounded-2xl border border-border space-y-6">
            {selectedTemplate ? (
              <>
                <div className="flex items-center justify-between border-b border-border pb-4">
                  <div>
                    <h2 className="text-xl font-bold text-foreground">{selectedTemplate.title}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t('colChecklistItem')}
                    </p>
                  </div>
                  <Badge variant="secondary" className="capitalize">
                    {selectedTemplate.category}
                  </Badge>
                </div>

                <div className="space-y-4">
                  {parsedItems.map((item) => {
                    const ans = answers[item.id];
                    if (item.type === 'temperature') {
                      const tempOutOfRange = ans && !ans.passed;
                      return (
                        <div
                          key={item.id}
                          className={`p-4 rounded-xl border transition-all ${
                            tempOutOfRange
                              ? 'bg-red-500/10 border-red-500/40 text-red-950 dark:text-red-200'
                              : 'bg-muted/40 border-border/60'
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div>
                              <div className="font-medium text-foreground flex items-center gap-2">
                                <Thermometer className="h-4 w-4 text-brand" />
                                {item.label}
                              </div>
                              <span className="text-xs text-muted-foreground block mt-0.5">
                                {t('allowedRange', { min: item.min_temp ?? 0, max: item.max_temp ?? 0 })}
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                step="0.1"
                                placeholder="Temp °C"
                                value={typeof ans?.value === 'number' || typeof ans?.value === 'string' ? ans.value : ''}
                                onChange={(e) => handleTempChange(item, e.target.value)}
                                className="w-28 px-3 py-1.5 text-sm bg-background border border-border rounded-lg"
                              />
                              {ans && (
                                <Badge variant={ans.passed ? 'default' : 'destructive'}>
                                  {ans.passed ? t('statusPass') : t('statusFail')}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={item.id}
                        className="p-4 rounded-xl border border-border/60 bg-muted/40 flex items-center justify-between gap-4"
                      >
                        <div className="font-medium text-foreground">{item.label}</div>
                        <input
                          type="checkbox"
                          checked={Boolean(ans?.value)}
                          onChange={(e) => handleCheckboxChange(item.id, e.target.checked)}
                          className="h-5 w-5 rounded-md border-border text-brand focus:ring-brand cursor-pointer"
                        />
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center justify-end pt-4 border-t border-border">
                  <Button onClick={handleSubmitRun} disabled={submittingRun}>
                    {submittingRun ? t('submitting') : t('btnSubmitLog')}
                  </Button>
                </div>
              </>
            ) : (
              <div className="py-16 text-center text-muted-foreground">Select an audit template to begin inspection.</div>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: AUDIT RUNS */}
      {activeTab === 'runs' && (
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Completed Inspection Runs</h2>
            <span className="text-xs text-muted-foreground">{runs.length} runs</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground uppercase border-b border-border">
                <tr>
                  <th className="py-3 px-4 text-start font-medium">Date</th>
                  <th className="py-3 px-4 text-start font-medium">Template</th>
                  <th className="py-3 px-4 text-start font-medium">Auditor</th>
                  <th className="py-3 px-4 text-start font-medium">Score</th>
                  <th className="py-3 px-4 text-start font-medium">Status</th>
                  <th className="py-3 px-4 text-center font-medium">Review</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.length === 0 ? (
                  <tr><td colSpan={6} className="py-12 text-center text-muted-foreground">No inspection runs recorded.</td></tr>
                ) : (
                  runs.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3.5 px-4 text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(r.created_at)}
                      </td>
                      <td className="py-3.5 px-4 font-medium text-foreground">
                        {r.template_title || `Template #${r.template_id}`}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-muted-foreground">
                        {r.submitted_by_name || 'Staff'}
                      </td>
                      <td className="py-3.5 px-4 font-bold">
                        {r.score_percent}%
                        {r.has_critical_failure === 1 && (
                          <span className="text-xs text-rose-600 block">Critical Fail</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <Badge
                          variant={r.status === 'approved' ? 'default' : r.status === 'rejected' ? 'destructive' : 'secondary'}
                          className="capitalize"
                        >
                          {r.status}
                        </Badge>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {r.status === 'submitted' ? (
                          <div className="flex items-center justify-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleReviewRun(r.id, 'approved')}
                              className="text-emerald-600 hover:text-emerald-700 h-7 text-xs"
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleReviewRun(r.id, 'rejected')}
                              className="text-rose-600 hover:text-rose-700 h-7 text-xs"
                            >
                              Reject
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground capitalize">
                            {r.reviewed_by_name ? `By ${r.reviewed_by_name}` : 'Completed'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL: LOG CCP TEMPERATURE */}
      {showCcpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h3 className="text-lg font-bold text-foreground">Log CCP Temperature Check</h3>
              <button
                type="button"
                onClick={() => setShowCcpModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCcpLog} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Station Name *</label>
                  <input
                    type="text"
                    value={ccpForm.station_name}
                    onChange={(e) => setCcpForm({ ...ccpForm, station_name: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">CCP Category *</label>
                  <input
                    type="text"
                    value={ccpForm.ccp_category}
                    onChange={(e) => setCcpForm({ ...ccpForm, ccp_category: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Target Min (°C)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={ccpForm.target_min}
                    onChange={(e) => setCcpForm({ ...ccpForm, target_min: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Target Max (°C)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={ccpForm.target_max}
                    onChange={(e) => setCcpForm({ ...ccpForm, target_max: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Recorded Value *</label>
                  <input
                    type="number"
                    step="0.1"
                    value={ccpForm.recorded_value}
                    onChange={(e) => setCcpForm({ ...ccpForm, recorded_value: e.target.value })}
                    placeholder="e.g. 3.2"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-semibold"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Corrective Action (Required if outside target range)
                </label>
                <textarea
                  value={ccpForm.corrective_action}
                  onChange={(e) => setCcpForm({ ...ccpForm, corrective_action: e.target.value })}
                  placeholder="e.g. Adjusted thermostat, moved milk to walk-in cooler, discarded spoiled item"
                  rows={2}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-border">
                <Button type="button" variant="outline" onClick={() => setShowCcpModal(false)}>
                  Cancel
                </Button>
                <Button type="submit">
                  Log Reading
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: REGISTER BATCH */}
      {showBatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h3 className="text-lg font-bold text-foreground">Register Perishable Batch</h3>
              <button
                type="button"
                onClick={() => setShowBatchModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateBatch} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Batch / Lot # *</label>
                  <input
                    type="text"
                    value={batchForm.batch_number}
                    onChange={(e) => setBatchForm({ ...batchForm, batch_number: e.target.value })}
                    placeholder="LOT-2026-04"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Item Name *</label>
                  <input
                    type="text"
                    value={batchForm.item_name}
                    onChange={(e) => setBatchForm({ ...batchForm, item_name: e.target.value })}
                    placeholder="Fresh Whole Milk"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Quantity</label>
                  <input
                    type="number"
                    step="any"
                    value={batchForm.quantity}
                    onChange={(e) => setBatchForm({ ...batchForm, quantity: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Unit</label>
                  <input
                    type="text"
                    value={batchForm.unit}
                    onChange={(e) => setBatchForm({ ...batchForm, unit: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Expiry Date *</label>
                  <input
                    type="date"
                    value={batchForm.expires_at}
                    onChange={(e) => setBatchForm({ ...batchForm, expires_at: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
                <textarea
                  value={batchForm.notes}
                  onChange={(e) => setBatchForm({ ...batchForm, notes: e.target.value })}
                  placeholder="Storage instructions or supplier notes"
                  rows={2}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-border">
                <Button type="button" variant="outline" onClick={() => setShowBatchModal(false)}>
                  Cancel
                </Button>
                <Button type="submit">
                  Register Batch
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
