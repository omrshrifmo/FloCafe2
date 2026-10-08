'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { useFormatNumber } from '@/hooks/useFormatNumber';
import { useFormatDate } from '@/hooks/useFormatDate';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import toast from 'react-hot-toast';
import {
  ClipboardList,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Printer,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';

interface StocktakeSession {
  id: number;
  status: 'draft' | 'in_progress' | 'completed' | 'cancelled';
  scope: string;
  counter_name: string | null;
  notes: string | null;
  variance_threshold: number;
  created_at: string;
  finalized_at: string | null;
  total_variance?: number;
}

interface StocktakeItem {
  id: number;
  supply_id: string;
  supply_name: string;
  base_unit: string;
  expected_quantity: number;
  counted_quantity: number | null;
  variance_quantity: number | null;
  variance_cost?: number;
  notes?: string;
}

export function StocktakeManager() {
  const fmtNum = useFormatNumber();
  const { formatDate } = useFormatDate();

  const [sessions, setSessions] = useState<StocktakeSession[]>([]);
  const [activeSession, setActiveSession] = useState<StocktakeSession | null>(null);
  const [sessionItems, setSessionItems] = useState<StocktakeItem[]>([]);
  const [search, setSearch] = useState('');

  // New Session Modal
  const [showNewModal, setShowNewModal] = useState(false);
  const [newScope, setNewScope] = useState('all');
  const [newCounter, setNewCounter] = useState('');
  const [newNotes, setNewNotes] = useState('');

  // Finalize Modal
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [managerPin, setManagerPin] = useState('');
  const [finalizing, setFinalizing] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      const res = await api.get('/stocktakes');
      setSessions(res.data?.sessions || []);
    } catch {
      toast.error('Failed to load stocktake sessions');
    }
  }, []);

  useEffect(() => {
    let active = true;
    api.get('/stocktakes')
      .then((res) => {
        if (!active) return;
        setSessions(res.data?.sessions || []);
      })
      .catch(() => {
        if (active) toast.error('Failed to load stocktake sessions');
      });
    return () => {
      active = false;
    };
  }, []);

  const openSession = async (session: StocktakeSession) => {
    try {
      const res = await api.get(`/stocktakes/${session.id}`);
      setActiveSession(res.data?.session || session);
      setSessionItems(res.data?.items || []);
    } catch {
      toast.error('Failed to load session details');
    }
  };

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post('/stocktakes', {
        scope: newScope,
        counter_name: newCounter || null,
        notes: newNotes || null,
      });
      toast.success('Stocktake session started');
      setShowNewModal(false);
      setNewCounter('');
      setNewNotes('');
      void loadSessions();
      if (res.data?.id) {
        void openSession({ id: res.data.id, status: 'in_progress', scope: newScope, counter_name: newCounter, notes: newNotes, variance_threshold: 50, created_at: new Date().toISOString(), finalized_at: null });
      }
    } catch {
      toast.error('Failed to create stocktake session');
    }
  };

  const handleUpdateItemCount = (supplyId: string, countStr: string) => {
    const countedVal = countStr === '' ? null : parseFloat(countStr);
    setSessionItems((prev) =>
      prev.map((item) => {
        if (item.supply_id !== supplyId) return item;
        const variance = countedVal !== null ? countedVal - item.expected_quantity : null;
        return {
          ...item,
          counted_quantity: countedVal,
          variance_quantity: variance,
        };
      })
    );
  };

  const handleSaveDraft = async () => {
    if (!activeSession) return;
    try {
      const itemsPayload = sessionItems.map((item) => ({
        supply_id: item.supply_id,
        counted_quantity: item.counted_quantity,
        notes: item.notes,
      }));
      await api.put(`/stocktakes/${activeSession.id}/items`, { items: itemsPayload });
      toast.success('Draft counts saved');
    } catch {
      toast.error('Failed to save draft counts');
    }
  };

  const calculateTotalDiscrepancy = () => {
    return sessionItems.reduce((acc, it) => acc + Math.abs(it.variance_quantity || 0), 0);
  };

  const handleFinalize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSession) return;
    const totalVariance = calculateTotalDiscrepancy();
    const exceedsThreshold = totalVariance > (activeSession.variance_threshold || 50);

    if (exceedsThreshold && (!managerPin || managerPin.length < 4)) {
      toast.error('Manager PIN required for high variance discrepancy');
      return;
    }

    try {
      setFinalizing(true);
      // Save latest draft first
      const itemsPayload = sessionItems.map((item) => ({
        supply_id: item.supply_id,
        counted_quantity: item.counted_quantity,
        notes: item.notes,
      }));
      await api.put(`/stocktakes/${activeSession.id}/items`, { items: itemsPayload });

      // Finalize
      await api.post(`/stocktakes/${activeSession.id}/finalize`, {
        manager_pin: managerPin || undefined,
        auto_adjust_inventory: true,
      });

      toast.success('Stocktake finalized & inventory adjusted');
      setShowFinalizeModal(false);
      setManagerPin('');
      setActiveSession(null);
      void loadSessions();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg || 'Failed to finalize stocktake');
    } finally {
      setFinalizing(false);
    }
  };

  const filteredItems = sessionItems.filter((it) =>
    it.supply_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Session Active View */}
      {activeSession ? (
        <div className="bg-card rounded-2xl border border-border p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-4">
            <div>
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={() => setActiveSession(null)}>
                  <RotateCcw className="h-4 w-4 me-1" /> Back
                </Button>
                <h2 className="text-xl font-bold text-foreground">
                  Stocktake #{activeSession.id}
                </h2>
                <Badge variant={activeSession.status === 'completed' ? 'secondary' : 'default'} className="capitalize">
                  {activeSession.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Counter: {activeSession.counter_name || 'Staff'} · Started: {formatDate(activeSession.created_at)}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5">
                <Printer className="h-4 w-4" /> Print Variance
              </Button>
              {activeSession.status !== 'completed' && (
                <>
                  <Button variant="secondary" size="sm" onClick={handleSaveDraft}>
                    Save Draft
                  </Button>
                  <Button size="sm" onClick={() => setShowFinalizeModal(true)} className="gap-1.5">
                    <CheckCircle2 className="h-4 w-4" /> Finalize
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Search bar */}
          <div className="relative max-w-sm">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search supply items..."
              className="w-full ps-9 pe-4 py-2 bg-background border border-border rounded-lg text-sm"
            />
          </div>

          {/* Counting Table */}
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground uppercase border-b border-border">
                <tr>
                  <th className="py-3 px-4 text-start font-medium">Supply Name</th>
                  <th className="py-3 px-4 text-center font-medium">Unit</th>
                  <th className="py-3 px-4 text-end font-medium">Expected Stock</th>
                  <th className="py-3 px-4 text-center font-medium w-36">Physical Count</th>
                  <th className="py-3 px-4 text-end font-medium">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredItems.map((item) => (
                  <tr key={item.supply_id} className="hover:bg-muted/30">
                      <td className="py-3 px-4 font-medium text-foreground">{item.supply_name}</td>
                      <td className="py-3 px-4 text-center text-xs text-muted-foreground">{item.base_unit}</td>
                      <td className="py-3 px-4 text-end font-mono">{fmtNum(item.expected_quantity)}</td>
                      <td className="py-3 px-4 text-center">
                        <input
                          type="number"
                          step="any"
                          disabled={activeSession.status === 'completed'}
                          value={item.counted_quantity !== null ? item.counted_quantity : ''}
                          onChange={(e) => handleUpdateItemCount(item.supply_id, e.target.value)}
                          placeholder="—"
                          className="w-28 px-3 py-1.5 bg-background border border-border rounded-lg text-sm font-bold text-center focus:ring-2 focus:ring-brand outline-hidden"
                        />
                      </td>
                      <td className={`py-3 px-4 text-end font-bold font-mono ${
                        item.variance_quantity === null
                          ? 'text-muted-foreground'
                          : item.variance_quantity < 0
                          ? 'text-rose-600'
                          : item.variance_quantity > 0
                          ? 'text-emerald-600'
                          : 'text-muted-foreground'
                      }`}>
                        {item.variance_quantity !== null
                          ? `${item.variance_quantity > 0 ? '+' : ''}${fmtNum(item.variance_quantity)}`
                          : '—'}
                      </td>
                    </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Sessions List */
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-brand" />
                Physical Stocktake Sessions
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Audit raw inventory against database records with manager variance sign-off
              </p>
            </div>
            <Button onClick={() => setShowNewModal(true)} className="gap-1.5">
              <Plus className="h-4 w-4" /> Start New Stocktake
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground uppercase border-b border-border">
                <tr>
                  <th className="py-3 px-4 text-start font-medium">Session #</th>
                  <th className="py-3 px-4 text-start font-medium">Scope</th>
                  <th className="py-3 px-4 text-start font-medium">Counter</th>
                  <th className="py-3 px-4 text-start font-medium">Created Date</th>
                  <th className="py-3 px-4 text-center font-medium">Status</th>
                  <th className="py-3 px-4 text-end font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sessions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-muted-foreground">
                      No stocktake sessions recorded. Click &quot;Start New Stocktake&quot; to begin inventory count.
                    </td>
                  </tr>
                ) : (
                  sessions.map((sess) => (
                    <tr key={sess.id} className="hover:bg-muted/30">
                      <td className="py-3.5 px-4 font-bold text-foreground">#{sess.id}</td>
                      <td className="py-3.5 px-4 text-xs capitalize text-muted-foreground">{sess.scope}</td>
                      <td className="py-3.5 px-4 text-xs text-foreground">{sess.counter_name || 'Staff'}</td>
                      <td className="py-3.5 px-4 text-xs text-muted-foreground">{formatDate(sess.created_at)}</td>
                      <td className="py-3.5 px-4 text-center">
                        <Badge
                          variant={sess.status === 'completed' ? 'secondary' : sess.status === 'in_progress' ? 'default' : 'outline'}
                          className="capitalize"
                        >
                          {sess.status}
                        </Badge>
                      </td>
                      <td className="py-3.5 px-4 text-end">
                        <Button size="sm" variant="ghost" onClick={() => openSession(sess)}>
                          {sess.status === 'completed' ? 'View Report' : 'Continue Count'}
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Start Session Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h3 className="text-lg font-bold text-foreground">Start New Stocktake</h3>
              <button type="button" onClick={() => setShowNewModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSession} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Scope</label>
                <select
                  value={newScope}
                  onChange={(e) => setNewScope(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                >
                  <option value="all">Full Inventory (All Supplies)</option>
                  <option value="bar">Bar & Beverages</option>
                  <option value="kitchen">Kitchen & Food</option>
                  <option value="packaging">Packaging Materials</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Counter Staff Name</label>
                <input
                  type="text"
                  value={newCounter}
                  onChange={(e) => setNewCounter(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
                <textarea
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="Month-end inventory, spot check, etc."
                  rows={2}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-border">
                <Button type="button" variant="outline" onClick={() => setShowNewModal(false)}>
                  Cancel
                </Button>
                <Button type="submit">Start Session</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Finalize Modal with Manager PIN */}
      {showFinalizeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h3 className="text-lg font-bold text-foreground">Finalize Stocktake</h3>
              <button type="button" onClick={() => setShowFinalizeModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleFinalize} className="p-6 space-y-4">
              <div className="p-4 bg-muted/40 rounded-xl space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Discrepancy:</span>
                  <span className="font-bold text-foreground">{fmtNum(calculateTotalDiscrepancy())} units</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Finalizing will automatically record inventory adjustment movements so database stock matches your counted physical inventory.
                </p>
              </div>

              {calculateTotalDiscrepancy() > (activeSession?.variance_threshold || 50) && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-600">
                    <AlertTriangle className="h-4 w-4" />
                    Manager Override PIN Required (Variance &gt; {activeSession?.variance_threshold || 50})
                  </div>
                  <input
                    type="password"
                    maxLength={6}
                    value={managerPin}
                    onChange={(e) => setManagerPin(e.target.value)}
                    placeholder="Enter 4-digit Manager PIN"
                    className="w-full text-center tracking-widest text-lg px-4 py-2.5 bg-background border border-border rounded-xl font-mono focus:outline-hidden focus:ring-2 focus:ring-brand"
                    required
                  />
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-border">
                <Button type="button" variant="outline" onClick={() => setShowFinalizeModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={finalizing}>
                  {finalizing ? 'Finalizing...' : 'Confirm & Apply Adjustments'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
