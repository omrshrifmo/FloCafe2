'use client';

import React, { useState, useEffect } from 'react';
import {
  Building2,
  DollarSign,
  TrendingUp,
  Package,
  AlertTriangle,
  RefreshCw,
  FileSpreadsheet,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';

interface FloAdminStats {
  revenueToday: number;
  ordersToday: number;
  revenueMonth: number;
  ordersMonth: number;
  inventoryValue: number;
  totalProducts: number;
  lowStockCount: number;
  activeStaffCount: number;
}

interface OrderRecord {
  id: string | number;
  order_number?: string;
  created_at?: string;
  status: string;
  total?: number;
  payment_status?: string;
}

interface InventoryItemRecord {
  id: string | number;
  name: string;
  sku?: string;
  unit?: string;
  quantity?: number;
  min_quantity?: number;
  min_stock_alert?: number;
  cost_price?: number;
}

export default function FloAdminPage() {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<FloAdminStats>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('flocafe_floadmin_cache');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.stats) return parsed.stats;
        }
      } catch {}
    }
    return {
      revenueToday: 0,
      ordersToday: 0,
      revenueMonth: 0,
      ordersMonth: 0,
      inventoryValue: 0,
      totalProducts: 0,
      lowStockCount: 0,
      activeStaffCount: 0,
    };
  });
  const [recentOrders, setRecentOrders] = useState<OrderRecord[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('flocafe_floadmin_cache');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.recentOrders) return parsed.recentOrders;
        }
      } catch {}
    }
    return [];
  });
  const [lowStockItems, setLowStockItems] = useState<InventoryItemRecord[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('flocafe_floadmin_cache');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.lowStockItems) return parsed.lowStockItems;
        }
      } catch {}
    }
    return [];
  });

  const loadData = async () => {
    setLoading(true);
    try {
      // Try dedicated sovereign back-office route first
      try {
        const sovRes = await api.get('/api/floadmin/stats');
        if (sovRes.data && sovRes.data.status === 'ok') {
          const s = sovRes.data.stats;
          const rOrders = (sovRes.data.recentOrders || []) as OrderRecord[];
          const lStock = (sovRes.data.lowStockItems || []) as InventoryItemRecord[];
          setStats(s);
          setRecentOrders(rOrders);
          setLowStockItems(lStock);
          try {
            localStorage.setItem('flocafe_floadmin_cache', JSON.stringify({
              stats: s,
              recentOrders: rOrders,
              lowStockItems: lStock,
            }));
          } catch {}
          setLoading(false);
          return;
        }
      } catch {}

      const [ordersRes, inventoryRes, staffRes] = await Promise.allSettled([
        api.get('/api/orders?limit=20'),
        api.get('/api/inventory/items'),
        api.get('/api/staff'),
      ]);

      let orders: OrderRecord[] = [];
      if (ordersRes.status === 'fulfilled') {
        orders = (ordersRes.value.data?.orders || ordersRes.value.data || []) as OrderRecord[];
        setRecentOrders(orders.slice(0, 8));
      }

      let items: InventoryItemRecord[] = [];
      if (inventoryRes.status === 'fulfilled') {
        items = (inventoryRes.value.data?.items || inventoryRes.value.data || []) as InventoryItemRecord[];
        const low = items.filter((i) => (i.quantity || 0) <= (i.min_quantity || i.min_stock_alert || 5));
        setLowStockItems(low.slice(0, 5));
      }

      const staffCount = staffRes.status === 'fulfilled' ? ((staffRes.value.data as unknown[])?.length || 0) : 0;

      const today = new Date().toISOString().split('T')[0];
      const todayOrders = orders.filter((o) => (o.created_at || '').startsWith(today) && o.status !== 'cancelled');
      const todayRev = todayOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
      const totalRev = orders.filter((o) => o.status !== 'cancelled').reduce((sum, o) => sum + Number(o.total || 0), 0);
      const invVal = items.reduce((sum, i) => sum + (Number(i.quantity || 0) * Number(i.cost_price || 0)), 0);

      const computedStats = {
        revenueToday: todayRev,
        ordersToday: todayOrders.length,
        revenueMonth: totalRev,
        ordersMonth: orders.length,
        inventoryValue: invVal,
        totalProducts: items.length,
        lowStockCount: items.filter((i) => (i.quantity || 0) <= (i.min_quantity || i.min_stock_alert || 5)).length,
        activeStaffCount: staffCount,
      };

      setStats(computedStats);
      try {
        localStorage.setItem('flocafe_floadmin_cache', JSON.stringify({
          stats: computedStats,
          recentOrders: orders.slice(0, 8),
          lowStockItems: items.filter((i) => (i.quantity || 0) <= (i.min_quantity || i.min_stock_alert || 5)).slice(0, 5),
        }));
      } catch {}
    } catch (err) {
      console.error('[FloAdmin] Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadData();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary" />
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">FloAdmin Local Back-Office</h1>
            <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
              100% Offline-First
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Self-Hosted Multi-Store HQ Command, Financial P&amp;L, Inventory Valuation &amp; Operational Health
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading} className="gap-1.5">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh Data
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card/60 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between text-xs">
              <span>Today&apos;s Net Revenue</span>
              <DollarSign className="h-4 w-4 text-emerald-400" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-400">
              ${stats.revenueToday.toFixed(2)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {stats.ordersToday} orders settled today
          </CardContent>
        </Card>

        <Card className="bg-card/60 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between text-xs">
              <span>Total Recorded Sales</span>
              <TrendingUp className="h-4 w-4 text-primary" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-primary">
              ${stats.revenueMonth.toFixed(2)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {stats.ordersMonth} total recorded orders
          </CardContent>
        </Card>

        <Card className="bg-card/60 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between text-xs">
              <span>Inventory Asset Value</span>
              <Package className="h-4 w-4 text-amber-400" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-amber-400">
              ${stats.inventoryValue.toFixed(2)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {stats.totalProducts} tracked SKUs on hand
          </CardContent>
        </Card>

        <Card className="bg-card/60 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between text-xs">
              <span>Low-Stock Warnings</span>
              <AlertTriangle className="h-4 w-4 text-destructive" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-destructive">
              {stats.lowStockCount}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Items requiring immediate replenishment
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Transactions */}
        <Card>
          <CardHeader className="pb-3 border-b border-border/40">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
                Recent Orders Ledger
              </span>
              <Badge variant="secondary" className="text-xs">Live</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {recentOrders.length > 0 ? (
              <div className="divide-y divide-border/30">
                {recentOrders.map((ord) => (
                  <div key={ord.id} className="p-3 flex items-center justify-between text-xs hover:bg-muted/30">
                    <div>
                      <div className="font-semibold">Order #{ord.order_number || ord.id}</div>
                      <div className="text-muted-foreground text-[11px]">
                        {ord.created_at ? new Date(ord.created_at).toLocaleTimeString() : 'Recent'} • {ord.status}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold">${Number(ord.total || 0).toFixed(2)}</div>
                      <Badge variant="outline" className="text-[10px] py-0">{ord.payment_status || 'settled'}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-muted-foreground">No recent transactions recorded.</div>
            )}
          </CardContent>
        </Card>

        {/* Low Stock & Operations */}
        <Card>
          <CardHeader className="pb-3 border-b border-border/40">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                Critical Low-Stock Feed
              </span>
              <Badge variant="outline" className="text-xs">{lowStockItems.length} Warnings</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {lowStockItems.length > 0 ? (
              <div className="divide-y divide-border/30">
                {lowStockItems.map((item) => (
                  <div key={item.id} className="p-3 flex items-center justify-between text-xs hover:bg-muted/30">
                    <div>
                      <div className="font-semibold">{item.name}</div>
                      <div className="text-muted-foreground text-[11px] font-mono">
                        SKU: {item.sku || 'N/A'} • Unit: {item.unit || 'pcs'}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-destructive">{item.quantity || 0}</span>
                      <span className="text-muted-foreground"> / min {item.min_quantity || 5}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-emerald-400 flex flex-col items-center gap-2">
                <CheckCircle2 className="h-6 w-6" />
                <span>All inventory stock levels are healthy!</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
