'use client';

import { useState, useEffect } from 'react';
import { Bell, AlertTriangle, ShieldAlert, ArrowRight, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { useTranslations } from 'use-intl';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface LowItem {
  id: string;
  name: string;
  target_type: 'inventory' | 'supply';
  quantity: number;
  reorder_level: number;
  severity: 'out_of_stock' | 'critical' | 'low_warning';
}

export default function OperationalAlertsBell() {
  const t = useTranslations('operationalAlerts');
  const [warnings, setWarnings] = useState<LowItem[]>([]);
  const [haccpBreaches, setHaccpBreaches] = useState<number>(0);
  const [generatingPo, setGeneratingPo] = useState(false);
  const [open, setOpen] = useState(false);

  const fetchAlerts = async () => {
    try {
      const [warnRes, assistRes] = await Promise.all([
        api.get('/stocktakes/warnings').catch(() => ({ data: { warnings: [] } })),
        api.get('/owner-assist/diagnostics').catch(() => ({ data: { operational_alerts: {} } })),
      ]);

      const items = warnRes.data?.warnings || [];
      setWarnings(items);

      const alerts = assistRes.data?.operational_alerts || {};
      setHaccpBreaches(Number(alerts.haccp_critical_breaches_last_7d) || 0);
    } catch {
      // Quiet fail if not authenticated
    }
  };

  useEffect(() => {
    let active = true;
    Promise.all([
      api.get('/stocktakes/warnings').catch(() => ({ data: { warnings: [] } })),
      api.get('/owner-assist/diagnostics').catch(() => ({ data: { operational_alerts: {} } })),
    ]).then(([warnRes, assistRes]) => {
      if (!active) return;
      const items = (warnRes.data?.warnings || []) as LowItem[];
      setWarnings(items);
      const alerts = assistRes.data?.operational_alerts || {};
      setHaccpBreaches(Number(alerts.haccp_critical_breaches_last_7d) || 0);
    });

    const interval = setInterval(() => {
      void fetchAlerts();
    }, 15000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const totalAlerts = warnings.length + (haccpBreaches > 0 ? 1 : 0);

  const handleAutoRestock = async () => {
    setGeneratingPo(true);
    try {
      const res = await api.post('/purchasing/purchase-orders/auto-restock-low', {});
      toast.success(res.data?.message || t('generatedSuccess'));
      setOpen(false);
      void fetchAlerts();
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : null;
      toast.error(msg || t('generatedError'));
    } finally {
      setGeneratingPo(false);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('ariaLabel')}
          className="relative flex items-center justify-center size-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors focus:outline-none"
        >
          <Bell className="size-4" />
          {totalAlerts > 0 && (
            <span className="absolute -top-1 -end-1 flex items-center justify-center size-4 text-[10px] font-bold text-white bg-destructive rounded-full animate-pulse shadow-sm">
              {totalAlerts > 9 ? '9+' : totalAlerts}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 md:w-96 p-0 shadow-lg border border-border bg-card">
        <div className="flex items-center justify-between p-3 border-b border-border bg-muted/40">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-500" />
            <h4 className="text-sm font-semibold text-foreground">{t('title')}</h4>
          </div>
          {totalAlerts > 0 && (
            <Badge variant="destructive" className="text-xs px-1.5 py-0">
              {t('alertBadge', { count: totalAlerts })}
            </Badge>
          )}
        </div>

        <div className="p-3 max-h-80 overflow-y-auto space-y-2.5">
          {haccpBreaches > 0 && (
            <div className="p-2.5 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <ShieldAlert className="size-4 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-red-700 dark:text-red-400">
                    {t('haccpBreachTitle', { count: haccpBreaches })}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{t('haccpBreachDesc')}</p>
                </div>
              </div>
              <Link
                href="/haccp"
                onClick={() => setOpen(false)}
                className="text-xs font-medium text-red-600 hover:underline flex items-center shrink-0"
              >
                {t('logAction')} <ArrowRight className="size-3 ms-1" />
              </Link>
            </div>
          )}

          {warnings.length === 0 && haccpBreaches === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              {t('allHealthy')}
            </div>
          ) : (
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                {t('lowParItems', { count: warnings.length })}
              </p>
              <div className="space-y-1.5">
                {warnings.slice(0, 6).map((item) => (
                  <div
                    key={`${item.target_type}-${item.id}`}
                    className="flex items-center justify-between text-xs p-1.5 rounded hover:bg-accent/40"
                  >
                    <span className="font-medium text-foreground truncate max-w-[170px]" title={item.name}>
                      {item.name}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[11px] text-muted-foreground">
                        {item.quantity} / {item.reorder_level}
                      </span>
                      <Badge
                        variant={item.severity === 'out_of_stock' ? 'destructive' : 'secondary'}
                        className="text-[10px] px-1 py-0 uppercase"
                      >
                        {item.severity === 'out_of_stock'
                          ? t('outOfStockBadge')
                          : item.severity === 'critical'
                          ? t('criticalBadge')
                          : t('lowBadge')}
                      </Badge>
                    </div>
                  </div>
                ))}
                {warnings.length > 6 && (
                  <p className="text-[11px] text-center text-muted-foreground pt-1">
                    {t('moreLowItems', { count: warnings.length - 6 })}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {warnings.length > 0 && (
          <div className="p-2.5 border-t border-border bg-muted/20 flex items-center justify-between gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={handleAutoRestock}
              disabled={generatingPo}
              className="w-full text-xs font-semibold h-8"
            >
              <RefreshCw className={`size-3.5 me-1.5 ${generatingPo ? 'animate-spin' : ''}`} />
              {t('autoGenerateRestock')}
            </Button>
            <Link
              href="/inventory"
              onClick={() => setOpen(false)}
              className="shrink-0 text-xs text-muted-foreground hover:text-foreground font-medium px-2 py-1"
            >
              {t('stocktakeLink')}
            </Link>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
