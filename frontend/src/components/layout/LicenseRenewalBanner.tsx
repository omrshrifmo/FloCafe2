'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, AlertCircle, Info, X } from 'lucide-react';
import api from '@/lib/api';

export interface RenewalBannerData {
  active: boolean;
  message?: string;
  banner_type?: 'warning' | 'critical' | 'info';
  action_url?: string;
  dismissible?: boolean;
  days_left?: number;
  expires_at?: number;
}

export default function LicenseRenewalBanner() {
  const [banner, setBanner] = useState<RenewalBannerData | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let mounted = true;
    const fetchBanner = async () => {
      try {
        const { data } = await api.get('/license/renewal-banner');
        if (mounted && data?.banner && data.banner.active) {
          setBanner(data.banner);
        } else if (mounted) {
          setBanner(null);
        }
      } catch {
        if (mounted) setBanner(null);
      }
    };

    void fetchBanner();
    const interval = setInterval(fetchBanner, 60000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  if (!banner || !banner.active || (banner.dismissible && dismissed)) {
    return null;
  }

  const isCritical = banner.banner_type === 'critical';
  const isInfo = banner.banner_type === 'info';

  const bgClass = isCritical
    ? 'bg-rose-600 text-white border-rose-700'
    : isInfo
    ? 'bg-sky-600 text-white border-sky-700'
    : 'bg-amber-500 text-amber-950 border-amber-600';

  const Icon = isCritical ? AlertCircle : isInfo ? Info : AlertTriangle;

  return (
    <aside
      role="alert"
      aria-live="polite"
      className={`w-full px-4 py-2 border-b text-sm font-medium flex items-center justify-between shrink-0 shadow-sm transition-all duration-200 ${bgClass}`}
    >
      <div className="flex items-center gap-2.5 overflow-hidden">
        <Icon className="size-4 shrink-0" />
        <span className="truncate">{banner.message || 'License Renewal Notice'}</span>
        {banner.action_url && (
          <a
            href={banner.action_url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 font-semibold ml-2 hover:opacity-80 transition-opacity"
          >
            Renew Now
          </a>
        )}
      </div>
      {banner.dismissible && (
        <button
          onClick={() => setDismissed(true)}
          className="p-1 rounded hover:bg-black/10 transition-colors ml-4 shrink-0 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-white"
          aria-label="Dismiss banner"
        >
          <X className="size-4" />
        </button>
      )}
    </aside>
  );
}

