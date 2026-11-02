'use client';

import React, { useState, useRef } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Copy,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Lock,
  AlertTriangle,
  Loader2,
  FileCheck,
  Key,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useLicenseStore } from '@/store/license';
import api from '@/lib/api';

function formatRemaining(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return 'Perpetual';
  if (ms <= 0) return 'Expired';
  const totalHours = Math.floor(ms / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

export default function LicenseBadge() {
  const { status, fetchStatus } = useLicenseStore();
  const [showModal, setShowModal] = useState(false);
  const [copiedHwid, setCopiedHwid] = useState(false);

  // Owner Panel State
  const [showOwnerPanel, setShowOwnerPanel] = useState(false);
  const [activeTab, setActiveTab] = useState<'switch' | 'revoke'>('switch');

  // Tab A - New Duration Key
  const [newTierKeyContent, setNewTierKeyContent] = useState('');
  const [newTierKeyFileName, setNewTierKeyFileName] = useState('');
  const [newTierKeyFilePath, setNewTierKeyFilePath] = useState<string | undefined>(undefined);
  const [newTierKeyInfo, setNewTierKeyInfo] = useState<{ tier?: string; label?: string } | null>(null);

  // Common Owner Inputs
  const [ownerMasterContent, setOwnerMasterContent] = useState('');
  const [ownerMasterFileName, setOwnerMasterFileName] = useState('');
  const [reactivationPassword, setReactivationPassword] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const tierFileInputRef = useRef<HTMLInputElement>(null);
  const switchMasterFileInputRef = useRef<HTMLInputElement>(null);
  const revokeMasterFileInputRef = useRef<HTMLInputElement>(null);

  if (!status?.valid) return null;

  const isForever = status.tier === 'forever' || !status.expires_at;
  const remainingText = isForever ? 'Forever License' : `Expires in ${formatRemaining(status.remaining_ms)}`;

  const handleCopyHwid = async () => {
    if (!status.hwid) return;
    try {
      await navigator.clipboard.writeText(status.hwid);
      setCopiedHwid(true);
      setTimeout(() => setCopiedHwid(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleTierKeySelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setNewTierKeyFileName(file.name);
    const filePath = (file as unknown as { path?: string })?.path;
    setNewTierKeyFilePath(filePath || undefined);
    setFormError(null);
    setFormSuccess(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setNewTierKeyContent(text);
      try {
        const parsed = JSON.parse(text);
        setNewTierKeyInfo({
          tier: parsed.tier,
          label: parsed.label || parsed.tier,
        });
      } catch {
        setNewTierKeyInfo(null);
      }
    };
    reader.readAsText(file);
  };

  const handleMasterKeySelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setOwnerMasterFileName(file.name);
    setFormError(null);
    setFormSuccess(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setOwnerMasterContent(text);
    };
    reader.readAsText(file);
  };

  const resetForm = () => {
    setNewTierKeyContent('');
    setNewTierKeyFileName('');
    setNewTierKeyFilePath(undefined);
    setNewTierKeyInfo(null);
    setOwnerMasterContent('');
    setOwnerMasterFileName('');
    setReactivationPassword('');
    setFormError(null);
    setFormSuccess(null);
  };

  const handleSwitchDuration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTierKeyContent.trim()) {
      setFormError('Please select a new Duration Key file (.flokey).');
      return;
    }
    if (!ownerMasterContent.trim()) {
      setFormError('Please select the Owner Master Key file (owner-reactivate-master.flokey).');
      return;
    }
    if (!reactivationPassword.trim()) {
      setFormError('Please enter the Owner Re-Activation Password.');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setFormSuccess(null);

    try {
      const res = await api.post('/license/activate', {
        tierKeyContent: newTierKeyContent,
        tierKeyFilePath: newTierKeyFilePath,
        ownerMasterKeyContent: ownerMasterContent.trim(),
        reactivationPassword: reactivationPassword.trim(),
        forceReplaceActive: true,
      });

      if (res.data?.success) {
        toast.success('License duration replaced successfully!');
        setFormSuccess('License duration updated successfully!');
        resetForm();
        await fetchStatus();
      } else {
        setFormError(res.data?.message || res.data?.error || 'Failed to replace license duration.');
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string; message?: string } } };
      const msg = error.response?.data?.message || error.response?.data?.error || 'Failed to replace license duration.';
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokeDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ownerMasterContent.trim()) {
      setFormError('Please select the Owner Master Key file (owner-reactivate-master.flokey).');
      return;
    }
    if (!reactivationPassword.trim()) {
      setFormError('Please enter the Owner Re-Activation Password.');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setFormSuccess(null);

    try {
      const res = await api.post('/license/revoke', {
        ownerMasterKeyContent: ownerMasterContent.trim(),
        reactivationPassword: reactivationPassword.trim(),
      });

      if (res.data?.success) {
        toast.success('Device locked and license revoked.');
        setShowModal(false);
        await fetchStatus();
      } else {
        setFormError(res.data?.error || 'Failed to revoke license.');
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string; message?: string } } };
      const msg = error.response?.data?.message || error.response?.data?.error || 'Failed to revoke license.';
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 transition-colors cursor-pointer select-none"
        title="Hardware License Active — Click for details"
      >
        <ShieldCheck className="size-3 shrink-0" />
        <span className="truncate max-w-[120px]">{remainingText}</span>
      </button>

      {showModal && (
        <div className="fixed inset-0 z-[9999999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 app-region-no-drag">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-5 space-y-4 text-slate-100">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-5 text-emerald-400" />
                <h3 className="font-semibold text-sm">FloCafe Hardware License</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowModal(false);
                  setShowOwnerPanel(false);
                }}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Status Summary */}
            <div className="space-y-2.5 text-xs bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5">
              <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                <span className="text-slate-400">License Tier</span>
                <span className="font-semibold text-white capitalize">{status.tier_label || status.tier}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Status</span>
                <span className="font-semibold text-emerald-400">Hardware Bound & Active</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Duration</span>
                <span className="font-semibold text-white">{remainingText}</span>
              </div>
              {status.expires_at ? (
                <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">Expires At</span>
                  <span className="font-mono text-slate-300">{new Date(status.expires_at).toLocaleString()}</span>
                </div>
              ) : null}
              <div className="py-1">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-slate-400">Hardware ID (HWID)</span>
                  <button
                    type="button"
                    onClick={handleCopyHwid}
                    className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300"
                  >
                    {copiedHwid ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
                    <span>{copiedHwid ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <div className="bg-slate-900 border border-slate-700/60 rounded px-2 py-1 font-mono text-[11px] text-cyan-300 select-all truncate">
                  {status.hwid}
                </div>
              </div>
            </div>

            {/* Expandable Owner Override Toggle Button */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowOwnerPanel(!showOwnerPanel);
                  setFormError(null);
                  setFormSuccess(null);
                }}
                className="w-full py-2 px-3 rounded-xl border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs font-medium flex items-center justify-between transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <KeyRound className="size-4 text-amber-400 shrink-0" />
                  <span>🔑 Change / Replace License Duration or Lock Device (Owner Only)</span>
                </span>
                {showOwnerPanel ? (
                  <ChevronUp className="size-4 text-amber-400 shrink-0" />
                ) : (
                  <ChevronDown className="size-4 text-amber-400 shrink-0" />
                )}
              </button>
            </div>

            {/* Expandable Owner Panel */}
            {showOwnerPanel && (
              <div className="space-y-3.5 p-4 rounded-xl border border-amber-500/30 bg-slate-950/80">
                {/* Tabs */}
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-900 rounded-lg border border-slate-800 text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('switch');
                      setFormError(null);
                      setFormSuccess(null);
                    }}
                    className={`py-1.5 px-2 rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      activeTab === 'switch'
                        ? 'bg-amber-500 text-slate-950 font-semibold shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Key className="size-3.5" />
                    <span>Switch Duration</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('revoke');
                      setFormError(null);
                      setFormSuccess(null);
                    }}
                    className={`py-1.5 px-2 rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      activeTab === 'revoke'
                        ? 'bg-rose-500 text-white font-semibold shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Lock className="size-3.5" />
                    <span>Lock / Revoke</span>
                  </button>
                </div>

                {/* Form feedback */}
                {formError && (
                  <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                    <AlertTriangle className="size-4 shrink-0 text-rose-400" />
                    <span>{formError}</span>
                  </div>
                )}
                {formSuccess && (
                  <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                    <Check className="size-4 shrink-0 text-emerald-400" />
                    <span>{formSuccess}</span>
                  </div>
                )}

                {/* Tab A: Switch License Duration */}
                {activeTab === 'switch' && (
                  <form onSubmit={handleSwitchDuration} className="space-y-3 text-xs">
                    <div>
                      <label className="block text-slate-300 mb-1 font-medium">
                        New Duration Key File (.flokey)
                      </label>
                      <input
                        ref={tierFileInputRef}
                        type="file"
                        accept=".flokey,.json,.pem"
                        onChange={handleTierKeySelected}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => tierFileInputRef.current?.click()}
                        className="w-full flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-700 hover:border-slate-600 text-slate-300 text-xs transition-colors cursor-pointer"
                      >
                        <span className="truncate">
                          {newTierKeyFileName || 'Choose .flokey key file (3d, 1m, forever...)'}
                        </span>
                        {newTierKeyFileName ? (
                          <FileCheck className="size-4 text-emerald-400 shrink-0 ml-2" />
                        ) : (
                          <span className="text-slate-500 text-[11px] shrink-0 ml-2">Browse...</span>
                        )}
                      </button>
                      {newTierKeyInfo && (
                        <p className="mt-1 text-[11px] text-emerald-400">
                          Detected Tier: <strong className="capitalize">{newTierKeyInfo.label || newTierKeyInfo.tier}</strong>
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-slate-300 mb-1 font-medium">
                        Owner Master Key File (owner-reactivate-master.flokey)
                      </label>
                      <input
                        ref={switchMasterFileInputRef}
                        type="file"
                        accept=".flokey,.json,.pem"
                        onChange={handleMasterKeySelected}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => switchMasterFileInputRef.current?.click()}
                        className="w-full flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-700 hover:border-slate-600 text-slate-300 text-xs transition-colors cursor-pointer"
                      >
                        <span className="truncate">
                          {ownerMasterFileName || 'Load owner-reactivate-master.flokey'}
                        </span>
                        {ownerMasterFileName ? (
                          <FileCheck className="size-4 text-emerald-400 shrink-0 ml-2" />
                        ) : (
                          <span className="text-slate-500 text-[11px] shrink-0 ml-2">Browse...</span>
                        )}
                      </button>
                    </div>

                    <div>
                      <label className="block text-slate-300 mb-1 font-medium">
                        Owner Re-Activation Password
                      </label>
                      <input
                        type="password"
                        value={reactivationPassword}
                        onChange={(e) => setReactivationPassword(e.target.value)}
                        placeholder="Enter Owner Password"
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 focus:border-amber-400 focus:outline-none text-slate-200 placeholder-slate-500 text-xs"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" />
                          <span>Applying New Duration...</span>
                        </>
                      ) : (
                        <span>Switch License Duration Now</span>
                      )}
                    </button>
                  </form>
                )}

                {/* Tab B: Immediately Lock / Deactivate This Device */}
                {activeTab === 'revoke' && (
                  <form onSubmit={handleRevokeDevice} className="space-y-3 text-xs">
                    <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[11px] flex items-start gap-2">
                      <ShieldAlert className="size-4 text-rose-400 shrink-0 mt-0.5" />
                      <span>
                        Locking this device immediately invalidates the active license and triggers the full-screen hardware lock. FloCafe will refuse to run until re-activated by the owner.
                      </span>
                    </div>

                    <div>
                      <label className="block text-slate-300 mb-1 font-medium">
                        Owner Master Key File (owner-reactivate-master.flokey)
                      </label>
                      <input
                        ref={revokeMasterFileInputRef}
                        type="file"
                        accept=".flokey,.json,.pem"
                        onChange={handleMasterKeySelected}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => revokeMasterFileInputRef.current?.click()}
                        className="w-full flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-700 hover:border-slate-600 text-slate-300 text-xs transition-colors cursor-pointer"
                      >
                        <span className="truncate">
                          {ownerMasterFileName || 'Load owner-reactivate-master.flokey'}
                        </span>
                        {ownerMasterFileName ? (
                          <FileCheck className="size-4 text-emerald-400 shrink-0 ml-2" />
                        ) : (
                          <span className="text-slate-500 text-[11px] shrink-0 ml-2">Browse...</span>
                        )}
                      </button>
                    </div>

                    <div>
                      <label className="block text-slate-300 mb-1 font-medium">
                        Owner Re-Activation Password
                      </label>
                      <input
                        type="password"
                        value={reactivationPassword}
                        onChange={(e) => setReactivationPassword(e.target.value)}
                        placeholder="Enter Owner Password"
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 focus:border-rose-400 focus:outline-none text-slate-200 placeholder-slate-500 text-xs"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" />
                          <span>Locking Device...</span>
                        </>
                      ) : (
                        <span>Immediately Lock / Deactivate This Device</span>
                      )}
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* Footer */}
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  void fetchStatus();
                  setShowModal(false);
                  setShowOwnerPanel(false);
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
