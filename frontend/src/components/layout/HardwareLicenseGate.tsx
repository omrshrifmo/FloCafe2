'use client';

import React, { useEffect, useState, useRef } from 'react';
import { ShieldAlert, ShieldCheck, KeyRound, Copy, Check, Lock, RefreshCw, AlertTriangle, Key } from 'lucide-react';
import { useLicenseStore, type LicenseStatus } from '@/store/license';
import api from '@/lib/api';

export default function HardwareLicenseGate({ children }: { children: React.ReactNode }) {
  const { status, loading, fetchStatus, setStatus } = useLicenseStore();
  const [tierKeyContent, setTierKeyContent] = useState<string>('');
  const [tierKeyFileName, setTierKeyFileName] = useState<string>('');
  const [tierKeyFilePath, setTierKeyFilePath] = useState<string | undefined>(undefined);
  const [tierKeyInfo, setTierKeyInfo] = useState<{ tier?: string; label?: string; usage_count?: number } | null>(null);

  const [ownerMasterContent, setOwnerMasterContent] = useState<string>('');
  const [ownerMasterFileName, setOwnerMasterFileName] = useState<string>('');
  const [reactivationPassword, setReactivationPassword] = useState<string>('');
  const [userExpandedOverride, setUserExpandedOverride] = useState<boolean>(false);

  const [copiedHwid, setCopiedHwid] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const tierFileInputRef = useRef<HTMLInputElement>(null);
  const masterFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetchStatus();

    const handleLockEvent = (e: Event) => {
      const custom = e as CustomEvent<LicenseStatus>;
      if (custom.detail) {
        setStatus(custom.detail);
      } else {
        void fetchStatus();
      }
    };

    const handleFocus = () => {
      void fetchStatus();
    };

    window.addEventListener('flo:hardware-license-locked', handleLockEvent);
    window.addEventListener('focus', handleFocus);
    const interval = window.setInterval(() => {
      void fetchStatus();
    }, 60_000);

    return () => {
      window.removeEventListener('flo:hardware-license-locked', handleLockEvent);
      window.removeEventListener('focus', handleFocus);
      window.clearInterval(interval);
    };
  }, [fetchStatus, setStatus]);

  const isOverrideMandatory = Boolean(
    status?.requires_owner_override ||
    (tierKeyInfo?.usage_count !== undefined && tierKeyInfo.usage_count > 0)
  );
  const showOverridePanel = userExpandedOverride || isOverrideMandatory;

  const handleCopyHwid = async () => {
    if (!status?.hwid) return;
    try {
      await navigator.clipboard.writeText(status.hwid);
      setCopiedHwid(true);
      setTimeout(() => setCopiedHwid(false), 2500);
    } catch {
      // Fallback
    }
  };

  const handleTierKeySelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTierKeyFileName(file.name);
    const filePath = (file as unknown as { path?: string })?.path;
    setTierKeyFilePath(filePath || undefined);
    setErrorMsg(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setTierKeyContent(text);
      try {
        const parsed = JSON.parse(text);
        setTierKeyInfo({
          tier: parsed.tier,
          label: parsed.label,
          usage_count: Number(parsed.usage_count) || 0,
        });
        if ((Number(parsed.usage_count) || 0) > 0) {
          setUserExpandedOverride(true);
        }
      } catch {
        setTierKeyInfo(null);
      }
    };
    reader.readAsText(file);
  };

  const handleMasterKeySelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setOwnerMasterFileName(file.name);
    setErrorMsg(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setOwnerMasterContent(text);
    };
    reader.readAsText(file);
  };

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tierKeyContent.trim()) {
      setErrorMsg('Please select a valid FloCafe Duration Key file (.flokey).');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await api.post('/license/activate', {
        tierKeyContent,
        tierKeyFilePath,
        ownerMasterKeyContent: ownerMasterContent.trim() ? ownerMasterContent : undefined,
        reactivationPassword: reactivationPassword.trim() ? reactivationPassword : undefined,
      });

      if (res.data?.success) {
        setSuccessMsg(res.data.message || 'Hardware successfully activated!');
        const updated = await fetchStatus();
        if (updated?.valid) {
          // Clear inputs on success
          setTierKeyContent('');
          setTierKeyFileName('');
          setTierKeyFilePath(undefined);
          setTierKeyInfo(null);
          setOwnerMasterContent('');
          setOwnerMasterFileName('');
          setReactivationPassword('');
        }
      } else if (res.data?.requires_owner_override) {
        setUserExpandedOverride(true);
        setErrorMsg(res.data.message || 'Owner override required. Enter password and load owner-reactivate-master.flokey.');
      } else {
        setErrorMsg(res.data?.message || 'Activation failed.');
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string; message?: string } } };
      const msg = error.response?.data?.message || error.response?.data?.error || 'Failed to activate hardware license.';
      setErrorMsg(msg);
      if (msg.toLowerCase().includes('owner') || msg.toLowerCase().includes('override') || msg.toLowerCase().includes('master')) {
        setUserExpandedOverride(true);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !status) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-200">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
          <p className="text-sm text-slate-400">Verifying offline hardware license...</p>
        </div>
      </div>
    );
  }

  // If license is valid, pass through to normal app
  if (status?.valid) {
    return <>{children}</>;
  }

  // Reason mapping
  const lockReason = status?.reason;
  let reasonTitle = 'Hardware License Required';
  let reasonDescription = 'This physical computer is not yet licensed for offline operation. Load a FloCafe .flokey license file to activate this hardware.';
  let badgeColor = 'bg-amber-500/10 text-amber-400 border-amber-500/20';

  if (lockReason === 'hardware_mismatch') {
    reasonTitle = 'Hardware Mismatch — Anti-Copy Protection';
    reasonDescription = 'FloCafe installation folder or database was copied from another computer. FloCafe is bound to physical hardware and refuses to run on unauthorized devices.';
    badgeColor = 'bg-red-500/10 text-red-400 border-red-500/20';
  } else if (lockReason === 'license_expired') {
    reasonTitle = 'Time-Limited License Expired';
    reasonDescription = `Your ${status?.tier || ''} license has expired. Please load a renewed license key to continue using FloCafe.`;
    badgeColor = 'bg-orange-500/10 text-orange-400 border-orange-500/20';
  } else if (lockReason === 'clock_tamper_detected') {
    reasonTitle = 'System Clock Tampering Detected';
    reasonDescription = 'The physical system clock was moved backward by more than 5 minutes. Adjust the system clock or re-activate with owner credentials.';
    badgeColor = 'bg-red-500/10 text-red-400 border-red-500/20';
  } else if (lockReason === 'invalid_signature') {
    reasonTitle = 'Cryptographic Signature Invalid';
    reasonDescription = 'The stored license certificate failed cryptographic verification against embedded Ed25519 public keys.';
    badgeColor = 'bg-red-500/10 text-red-400 border-red-500/20';
  }

  return (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-slate-950/95 backdrop-blur-md p-4 overflow-y-auto text-slate-100 font-sans">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 sm:p-8 space-y-6 app-region-no-drag my-auto">
        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="size-12 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center shrink-0">
            <ShieldAlert className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              FloCafe Hardware Security
            </h2>
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border mt-2 ${badgeColor}`}>
              <AlertTriangle className="size-3.5 shrink-0" />
              <span>{reasonTitle}</span>
            </div>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              {reasonDescription}
            </p>
          </div>
        </div>

        {/* HWID Card */}
        <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold uppercase tracking-wider text-slate-300">Device Hardware ID (HWID)</span>
            <span className="text-[11px] text-slate-500">Offline Asymmetric Binding</span>
          </div>
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-700/60 rounded-lg p-2.5 font-mono text-xs sm:text-sm text-cyan-300">
            <span className="truncate flex-1 select-all font-semibold tracking-wide">
              {status?.hwid || 'Detecting hardware...'}
            </span>
            <button
              type="button"
              onClick={handleCopyHwid}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs transition-colors shrink-0"
              title="Copy HWID to clipboard"
            >
              {copiedHwid ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
              <span>{copiedHwid ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            Provide this Hardware Fingerprint to the FloCafe owner to receive your signed offline activation key.
          </p>
        </div>

        {/* Activation Form */}
        <form onSubmit={handleActivate} className="space-y-4">
          {/* Primary Key File Picker */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
              1. Load Duration License Key (.flokey)
            </label>
            <input
              type="file"
              ref={tierFileInputRef}
              onChange={handleTierKeySelected}
              accept=".flokey,.json,.pem"
              className="hidden"
            />
            <div
              onClick={() => tierFileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-700 hover:border-blue-500/80 rounded-xl p-4 cursor-pointer transition-colors bg-slate-950/40 hover:bg-slate-950/80 flex flex-col items-center justify-center gap-2 text-center"
            >
              <KeyRound className="size-6 text-blue-400" />
              {tierKeyFileName ? (
                <div>
                  <p className="text-sm font-medium text-white">{tierKeyFileName}</p>
                  {tierKeyInfo && (
                    <p className="text-xs text-blue-400 font-mono mt-0.5">
                      Tier: {tierKeyInfo.label || tierKeyInfo.tier} {tierKeyInfo.usage_count ? `• (Used ${tierKeyInfo.usage_count}x)` : ''}
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-xs font-medium text-slate-300">Click to choose key file</p>
                  <p className="text-[11px] text-slate-500">forever.flokey, 1y.flokey, 6m.flokey, 3m.flokey, 1m.flokey, 1w.flokey, 3d.flokey, 24h.flokey</p>
                </div>
              )}
            </div>
          </div>

          {/* Toggle for Owner Override */}
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => setUserExpandedOverride(!showOverridePanel)}
              className="text-xs text-blue-400 hover:text-blue-300 underline font-medium"
            >
              {showOverridePanel ? 'Hide Owner Re-Activation Override' : 'Re-Activating / Renewing Used Key or Device? Click for Owner Override'}
            </button>
          </div>

          {/* Owner Override Panel */}
          {showOverridePanel && (
            <div className="bg-slate-950/90 border border-amber-500/30 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold">
                <Lock className="size-4 shrink-0" />
                <span>Owner Re-Activation Override Required</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Single-use protection requires both the Owner Re-Activation Password and the Owner Master Private Key (owner-reactivate-master.flokey) whenever re-activating a previously consumed key or device.
              </p>

              {/* Password */}
              <div className="space-y-1">
                <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                  Owner Re-Activation Password
                </label>
                <input
                  type="password"
                  value={reactivationPassword}
                  onChange={(e) => setReactivationPassword(e.target.value)}
                  placeholder="Enter Owner Password"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Master Key File Picker */}
              <div className="space-y-1">
                <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                  Owner Master Key (owner-reactivate-master.flokey)
                </label>
                <input
                  type="file"
                  ref={masterFileInputRef}
                  onChange={handleMasterKeySelected}
                  accept=".flokey,.json,.pem"
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => masterFileInputRef.current?.click()}
                  className="w-full inline-flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 transition-colors"
                >
                  <Key className="size-3.5 text-amber-400" />
                  <span className="truncate">{ownerMasterFileName || 'Select owner-reactivate-master.flokey'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Error Message */}
          {errorMsg && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-300 flex items-start gap-2">
              <AlertTriangle className="size-4 shrink-0 mt-0.5 text-red-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Success Message */}
          {successMsg && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-xs text-emerald-300 flex items-start gap-2">
              <ShieldCheck className="size-4 shrink-0 mt-0.5 text-emerald-400" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={submitting || !tierKeyContent.trim()}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold py-2.5 px-4 rounded-xl text-sm transition-colors shadow-lg shadow-blue-600/20 cursor-pointer disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <RefreshCw className="size-4 animate-spin" />
                <span>Verifying Offline Signature...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="size-4" />
                <span>Verify & Activate This Hardware</span>
              </>
            )}
          </button>
        </form>

        <div className="text-center pt-2 border-t border-slate-800/80">
          <p className="text-[11px] text-slate-500">
            FloCafe Offline Cryptographic Hardware-Bound Protection • v4.0.10
          </p>
        </div>
      </div>
    </div>
  );
}
