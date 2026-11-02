'use client';

import React, { useState } from 'react';
import { ShieldCheck, Copy, Check, X } from 'lucide-react';
import { useLicenseStore } from '@/store/license';

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
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-5 space-y-4 text-slate-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-5 text-emerald-400" />
                <h3 className="font-semibold text-sm">FloCafe Hardware License</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5">
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

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  void fetchStatus();
                  setShowModal(false);
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
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
