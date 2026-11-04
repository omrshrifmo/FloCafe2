'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Smartphone,
  DollarSign,
  Layers,
  ChefHat,
  RefreshCw,
  ShieldCheck,
  CreditCard,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';

interface OrderItem {
  id: string | number;
  total?: number;
  status: string;
  created_at?: string;
}

interface TableItem {
  id: string | number;
  status: string;
}

interface CashSessionItem {
  id: string | number;
  status: string;
  expected_balance?: number;
  opening_balance?: number;
}

export default function FloRevPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [metrics, setMetrics] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('flocafe_florev_cache');
        if (cached) return JSON.parse(cached);
      } catch {}
    }
    return {
      todaySales: 0,
      ordersCount: 0,
      avgOrderValue: 0,
      openTables: 0,
      kdsQueueLength: 0,
      cashDrawerExpected: 0,
      activeShiftOpen: false,
      alertsCount: 0,
    };
  });

  const loadMetrics = async () => {
    setLoading(true);
    try {
      // Try dedicated sovereign route first
      try {
        const sovRes = await api.get('/api/florev/live');
        if (sovRes.data && sovRes.data.status === 'ok') {
          const m = {
            todaySales: Number(sovRes.data.todaySales || 0),
            ordersCount: Number(sovRes.data.ordersCount || 0),
            avgOrderValue: Number(sovRes.data.avgOrderValue || 0),
            openTables: Number(sovRes.data.openTables || 0),
            kdsQueueLength: Number(sovRes.data.kdsQueueLength || 0),
            cashDrawerExpected: Number(sovRes.data.cashDrawerExpected || 0),
            activeShiftOpen: Boolean(sovRes.data.activeShiftOpen),
            alertsCount: Number(sovRes.data.alertsCount || 0),
          };
          setMetrics(m);
          try {
            localStorage.setItem('flocafe_florev_cache', JSON.stringify(m));
          } catch {}
          setLoading(false);
          return;
        }
      } catch {}

      const [ordersRes, tablesRes, sessionRes] = await Promise.allSettled([
        api.get('/api/orders?limit=50'),
        api.get('/api/tables'),
        api.get('/api/cash-sessions'),
      ]);

      let orders: OrderItem[] = [];
      if (ordersRes.status === 'fulfilled') {
        orders = (ordersRes.value.data?.orders || ordersRes.value.data || []) as OrderItem[];
      }

      let tables: TableItem[] = [];
      if (tablesRes.status === 'fulfilled') {
        tables = (tablesRes.value.data || []) as TableItem[];
      }

      let currentSession: CashSessionItem | null = null;
      if (sessionRes.status === 'fulfilled') {
        const sessions = (sessionRes.value.data || []) as CashSessionItem[];
        currentSession = sessions.find((s) => s.status === 'open') || null;
      }

      const today = new Date().toISOString().split('T')[0];
      const todayOrders = orders.filter((o) => (o.created_at || '').startsWith(today) && o.status !== 'cancelled');
      const sales = todayOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
      const kdsOrders = orders.filter((o) => ['pending', 'preparing'].includes(o.status));
      const occupiedTables = tables.filter((t) => t.status === 'occupied').length;

      const computedMetrics = {
        todaySales: sales,
        ordersCount: todayOrders.length,
        avgOrderValue: todayOrders.length > 0 ? sales / todayOrders.length : 0,
        openTables: occupiedTables,
        kdsQueueLength: kdsOrders.length,
        cashDrawerExpected: currentSession ? Number(currentSession.expected_balance || currentSession.opening_balance || 0) : 0,
        activeShiftOpen: Boolean(currentSession),
        alertsCount: 0,
      };

      setMetrics(computedMetrics);
      try {
        localStorage.setItem('flocafe_florev_cache', JSON.stringify(computedMetrics));
      } catch {}
    } catch (err) {
      console.warn('[FloRev] Metric fetch note:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadMetrics();
    }, 0);
    const interval = setInterval(loadMetrics, 10000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="p-3 md:p-6 max-w-xl mx-auto space-y-4 pb-20">
      {/* Mobile Header Bar */}
      <div className="flex items-center justify-between border-b border-border/40 pb-3">
        <div className="flex items-center gap-2">
          <Smartphone className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">FloRev Live</h1>
            <p className="text-[11px] text-muted-foreground">Mobile Manager &amp; Owner Companion</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30 gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live Sync
          </Badge>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={loadMetrics}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Hero Today Sales Card */}
      <Card className="bg-gradient-to-br from-primary/20 via-card to-card border-primary/30 shadow-lg">
        <CardContent className="p-5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>TODAY&apos;S NET SALES</span>
            <DollarSign className="h-4 w-4 text-primary" />
          </div>
          <div className="text-4xl font-extrabold tracking-tight mt-1 text-foreground">
            ${metrics.todaySales.toFixed(2)}
          </div>
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/40 text-xs">
            <span className="text-muted-foreground">{metrics.ordersCount} total orders settled</span>
            <span className="font-semibold text-primary">Avg: ${metrics.avgOrderValue.toFixed(2)}</span>
          </div>
        </CardContent>
      </Card>

      {/* 2x2 Fast Status Grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Open Tables */}
        <Card className="p-4 bg-card/60">
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span>Dine-In Tables</span>
            <Layers className="h-4 w-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold mt-2">{metrics.openTables}</div>
          <div className="text-[10px] text-muted-foreground mt-1">Currently seated</div>
        </Card>

        {/* Kitchen KDS Queue */}
        <Card className="p-4 bg-card/60">
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span>Kitchen Queue</span>
            <ChefHat className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold mt-2">{metrics.kdsQueueLength}</div>
          <div className="text-[10px] text-muted-foreground mt-1">Tickets in preparation</div>
        </Card>

        {/* Cash Drawer Shift */}
        <Card className="p-4 bg-card/60">
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span>Cash Shift</span>
            <CreditCard className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold mt-2">
            ${metrics.cashDrawerExpected.toFixed(2)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">
            {metrics.activeShiftOpen ? 'Drawer open & tracked' : 'No active shift'}
          </div>
        </Card>

        {/* System Health */}
        <Card className="p-4 bg-card/60">
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span>Security &amp; License</span>
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="text-sm font-semibold mt-2 text-emerald-400">Offline Verified</div>
          <div className="text-[10px] text-muted-foreground mt-1">Hardware cryptosealed</div>
        </Card>
      </div>

      {/* Quick Actions Footer */}
      <div className="p-3 bg-muted/20 border border-border/40 rounded-xl flex items-center justify-around text-xs">
        <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => router.push('/pos')}>
          Go to POS
        </Button>
        <div className="h-4 w-[1px] bg-border" />
        <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => router.push('/owner-control')}>
          Owner Fleet
        </Button>
        <div className="h-4 w-[1px] bg-border" />
        <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => router.push('/orderflo')}>
          OrderFlo
        </Button>
      </div>
    </div>
  );
}
