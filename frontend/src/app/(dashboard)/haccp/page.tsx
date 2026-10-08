'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useFormatDate } from '@/hooks/useFormatDate';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import toast from 'react-hot-toast';
import {
  ClipboardCheck,
  Thermometer,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Plus,
  Play,
  RotateCcw,
  CheckSquare,
  Sparkles,
  UserCheck,
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

export default function HaccpPage() {
  const { currentTenant } = useAuthStore();
  const { formatDate } = useFormatDate();

  const [activeTab, setActiveTab] = useState<'execute' | 'runs' | 'templates'>('execute');
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [runs, setRuns] = useState<ChecklistRun[]>([]);

  // Execution State
  const [selectedTemplate, setSelectedTemplate] = useState<ChecklistTemplate | null>(null);
  const [answers, setAnswers] = useState<Record<string, { value: boolean | number | string; passed: boolean; note?: string }>>({});
  const [submittingRun, setSubmittingRun] = useState(false);

  const loadData = useCallback(async () => {
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
      toast.error('Failed to load HACCP checklists');
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.get('/haccp/templates'),
      api.get('/haccp/runs'),
    ])
      .then(([tplRes, runsRes]) => {
        if (!active) return;
        const loadedTemplates: ChecklistTemplate[] = tplRes.data?.templates || [];
        setTemplates(loadedTemplates);
        setRuns(runsRes.data?.runs || []);
        setSelectedTemplate((current) => current || (loadedTemplates.length > 0 ? loadedTemplates[0] : null));
      })
      .catch(() => {
        if (active) toast.error('Failed to load HACCP checklists');
      });
    return () => {
      active = false;
    };
  }, []);

  // Handle template selection
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

      toast.success('HACCP inspection submitted successfully');
      setAnswers({});
      void loadData();
      setActiveTab('runs');
    } catch {
      toast.error('Failed to submit checklist inspection');
    } finally {
      setSubmittingRun(false);
    }
  };

  const handleReviewRun = async (runId: number, status: 'approved' | 'rejected') => {
    try {
      await api.post(`/haccp/runs/${runId}/review`, { status, review_notes: 'Reviewed in manager console' });
      toast.success(`Inspection marked as ${status}`);
      void loadData();
    } catch {
      toast.error('Failed to review inspection');
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <ClipboardCheck className="h-7 w-7 text-brand" />
            Hygiene & HACCP Checklists
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Food safety compliance, refrigeration temperatures, daily opening/closing procedures
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border gap-2">
        <button
          onClick={() => setActiveTab('execute')}
          className={`py-2.5 px-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'execute'
              ? 'border-brand text-brand'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <CheckSquare className="h-4 w-4" />
          Perform Inspection
        </button>

        <button
          onClick={() => setActiveTab('runs')}
          className={`py-2.5 px-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'runs'
              ? 'border-brand text-brand'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <UserCheck className="h-4 w-4" />
          Review History
        </button>
      </div>

      {/* TAB 1: EXECUTE INSPECTION */}
      {activeTab === 'execute' && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* Template Selector Sidebar */}
          <div className="bg-card p-4 rounded-2xl border border-border space-y-2">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Checklists
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

          {/* Checklist Form */}
          <div className="md:col-span-3 bg-card p-6 rounded-2xl border border-border space-y-6">
            {selectedTemplate ? (
              <>
                <div className="flex items-center justify-between border-b border-border pb-4">
                  <div>
                    <h2 className="text-xl font-bold text-foreground">{selectedTemplate.title}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Check each item carefully. Log exact temperature numbers for coolers and freezers.
                    </p>
                  </div>
                  <Badge variant="secondary" className="capitalize">
                    {selectedTemplate.category}
                  </Badge>
                </div>

                <div className="space-y-4">
                  {parsedItems.map((item) => {
                    const ans = answers[item.id];
                    const isPassed = ans?.passed;

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
                                Safe Range: {item.min_temp}°C to {item.max_temp}°C
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                step="0.1"
                                placeholder="°C"
                                onChange={(e) => handleTempChange(item, e.target.value)}
                                className={`w-28 px-3 py-2 bg-background border rounded-lg text-sm font-semibold text-center ${
                                  tempOutOfRange ? 'border-red-500 text-red-600 ring-2 ring-red-500/20' : 'border-border'
                                }`}
                              />
                              {tempOutOfRange && (
                                <Badge variant="destructive" className="flex items-center gap-1">
                                  <AlertTriangle className="h-3 w-3" />
                                  Out of range!
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <label
                        key={item.id}
                        className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${
                          ans?.value
                            ? 'bg-emerald-500/5 border-emerald-500/30'
                            : 'bg-muted/40 border-border/60 hover:bg-muted/70'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(ans?.value)}
                          onChange={(e) => handleCheckboxChange(item.id, e.target.checked)}
                          className="mt-1 h-5 w-5 rounded border-border text-brand focus:ring-brand"
                        />
                        <div className="flex-1">
                          <span className={`text-sm font-medium ${ans?.value ? 'text-foreground' : 'text-foreground/90'}`}>
                            {item.label}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>

                <div className="pt-4 border-t border-border flex justify-end">
                  <Button onClick={handleSubmitRun} disabled={submittingRun} className="gap-2 px-6">
                    <CheckCircle2 className="h-4 w-4" />
                    {submittingRun ? 'Submitting...' : 'Submit Completed Checklist'}
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-center py-12 text-muted-foreground">Select a checklist template to begin</p>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: REVIEW HISTORY */}
      {activeTab === 'runs' && (
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Completed HACCP Submissions</h2>
            <span className="text-xs text-muted-foreground">{runs.length} inspections</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground uppercase border-b border-border">
                <tr>
                  <th className="py-3 px-4 text-start font-medium">Date</th>
                  <th className="py-3 px-4 text-start font-medium">Checklist</th>
                  <th className="py-3 px-4 text-start font-medium">Submitted By</th>
                  <th className="py-3 px-4 text-center font-medium">Score</th>
                  <th className="py-3 px-4 text-center font-medium">Critical Issues</th>
                  <th className="py-3 px-4 text-center font-medium">Status</th>
                  <th className="py-3 px-4 text-end font-medium">Manager Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-muted-foreground">
                      No inspection submissions recorded yet
                    </td>
                  </tr>
                ) : (
                  runs.map((run) => (
                    <tr key={run.id} className="hover:bg-muted/30">
                      <td className="py-3.5 px-4 text-xs text-muted-foreground">{formatDate(run.created_at)}</td>
                      <td className="py-3.5 px-4 font-medium text-foreground">{run.template_title || `Template #${run.template_id}`}</td>
                      <td className="py-3.5 px-4 text-xs text-muted-foreground">{run.submitted_by_name || 'Staff'}</td>
                      <td className="py-3.5 px-4 text-center font-bold">
                        <span className={run.score_percent >= 90 ? 'text-emerald-600' : 'text-amber-600'}>
                          {run.score_percent}%
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        {run.has_critical_failure ? (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="h-3 w-3" /> Yes
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-emerald-600">None</Badge>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <Badge
                          variant={run.status === 'approved' ? 'secondary' : run.status === 'rejected' ? 'destructive' : 'outline'}
                          className="capitalize"
                        >
                          {run.status}
                        </Badge>
                      </td>
                      <td className="py-3.5 px-4 text-end">
                        {run.status === 'submitted' && (
                          <div className="flex items-center justify-end gap-1.5">
                            <Button size="sm" variant="outline" onClick={() => handleReviewRun(run.id, 'approved')} className="h-7 text-xs text-emerald-600">
                              Approve
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => handleReviewRun(run.id, 'rejected')} className="h-7 text-xs text-rose-600">
                              Reject
                            </Button>
                          </div>
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
    </div>
  );
}
