'use client';

import React, { useState, useEffect } from 'react';
import {
  QrCode,
  Store,
  Layers,
  CheckCircle2,
  XCircle,
  Clock,
  Copy,
  ExternalLink,
  RefreshCw,
  ShoppingBag,
  Truck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import api from '@/lib/api';

interface TableRecord {
  id: string | number;
  name?: string;
  status?: string;
}

interface OrderRecord {
  id: string | number;
  order_number?: string;
  order_type?: string;
  table_id?: string | number;
  table_name?: string;
  created_at?: string;
  total?: number;
  status: string;
}

export default function OrderFloPage() {
  const [loading, setLoading] = useState(false);
  const [tables, setTables] = useState<TableRecord[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('flocafe_orderflo_cache');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed.tables)) return parsed.tables;
        }
      } catch {}
    }
    return [];
  });
  const [pendingOrders, setPendingOrders] = useState<OrderRecord[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('flocafe_orderflo_cache');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed.pendingOrders)) return parsed.pendingOrders;
        }
      } catch {}
    }
    return [];
  });
  const [selectedTable, setSelectedTable] = useState<TableRecord | null>(null);
  const [copiedTableId, setCopiedTableId] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      // Try dedicated sovereign orderflo routes first
      try {
        const [tablesSov, queueSov] = await Promise.allSettled([
          api.get('/api/orderflo/tables'),
          api.get('/api/orderflo/queue'),
        ]);

        let loadedTables: TableRecord[] = [];
        let loadedOrders: OrderRecord[] = [];

        if (tablesSov.status === 'fulfilled' && Array.isArray(tablesSov.value.data)) {
          loadedTables = tablesSov.value.data as TableRecord[];
          setTables(loadedTables);
          if (loadedTables.length > 0) {
            setSelectedTable((prev) => prev || loadedTables[0]);
          }
        }

        if (queueSov.status === 'fulfilled' && Array.isArray(queueSov.value.data)) {
          loadedOrders = queueSov.value.data as OrderRecord[];
          setPendingOrders(loadedOrders);
        }

        if (loadedTables.length > 0 || loadedOrders.length > 0) {
          try {
            localStorage.setItem('flocafe_orderflo_cache', JSON.stringify({
              tables: loadedTables,
              pendingOrders: loadedOrders,
            }));
          } catch {}
          setLoading(false);
          return;
        }
      } catch {}

      const [tablesRes, ordersRes] = await Promise.allSettled([
        api.get('/api/tables'),
        api.get('/api/orders?status=pending&limit=30'),
      ]);

      let tbls: TableRecord[] = [];
      let ords: OrderRecord[] = [];

      if (tablesRes.status === 'fulfilled') {
        tbls = (tablesRes.value.data || []) as TableRecord[];
        setTables(tbls);
        if (tbls.length > 0) {
          setSelectedTable((prev) => prev || tbls[0]);
        }
      }

      if (ordersRes.status === 'fulfilled') {
        ords = (ordersRes.value.data?.orders || ordersRes.value.data || []) as OrderRecord[];
        setPendingOrders(ords);
      }

      try {
        localStorage.setItem('flocafe_orderflo_cache', JSON.stringify({
          tables: tbls,
          pendingOrders: ords,
        }));
      } catch {}
    } catch (err) {
      console.warn('[OrderFlo] Load note:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadData();
    }, 0);
    const interval = setInterval(loadData, 8000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, []);

  const handleApproveOrder = async (orderId: number | string) => {
    try {
      await api.patch(`/api/orders/${orderId}/status`, { status: 'confirmed' });
      setPendingOrders((prev) => prev.filter((o) => o.id !== orderId));
    } catch (err: unknown) {
      console.error('[OrderFlo] Approve error:', err);
    }
  };

  const handleRejectOrder = async (orderId: number | string) => {
    try {
      await api.patch(`/api/orders/${orderId}/status`, { status: 'cancelled' });
      setPendingOrders((prev) => prev.filter((o) => o.id !== orderId));
    } catch (err: unknown) {
      console.error('[OrderFlo] Cancel error:', err);
    }
  };

  const getTableQrLink = (tableId: string | number) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/qr?table=${tableId}`;
  };

  const copyQrLink = (tableId: string | number) => {
    const link = getTableQrLink(tableId);
    navigator.clipboard.writeText(link);
    setCopiedTableId(String(tableId));
    setTimeout(() => setCopiedTableId(null), 2000);
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <QrCode className="h-6 w-6 text-primary" />
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">OrderFlo Self-Hosted Hub</h1>
            <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
              0% Commission
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Self-Hosted QR Table Ordering, Counter Self-Service Kiosks &amp; Direct Delivery Management
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading} className="gap-1.5">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh Queue
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => window.open('/qr', '_blank')}>
            <ExternalLink className="h-4 w-4" />
            Launch Table QR Menu
          </Button>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="incoming" className="w-full">
        <TabsList className="grid grid-cols-3 max-w-md mb-4">
          <TabsTrigger value="incoming" className="text-xs">
            Live Incoming ({pendingOrders.length})
          </TabsTrigger>
          <TabsTrigger value="tables" className="text-xs">
            Table QR Generator
          </TabsTrigger>
          <TabsTrigger value="kiosk" className="text-xs">
            Kiosk &amp; Delivery
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Live Incoming Orders Queue */}
        <TabsContent value="incoming" className="space-y-4">
          <Card>
            <CardHeader className="pb-3 border-b border-border/30">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <ShoppingBag className="h-4 w-4 text-primary" />
                  Incoming Digital Orders Approval Queue
                </span>
                <Badge variant="secondary" className="text-xs">
                  {pendingOrders.length} Pending
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {pendingOrders.length > 0 ? (
                <div className="divide-y divide-border/30">
                  {pendingOrders.map((ord) => (
                    <div key={ord.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-muted/30">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm">Order #{ord.order_number || ord.id}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {ord.order_type || 'dine-in'}
                          </Badge>
                          {Boolean(ord.table_id) && (
                            <Badge variant="secondary" className="text-[10px]">
                              Table {ord.table_name || ord.table_id}
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          <Clock className="h-3.5 w-3.5" />
                          <span>{ord.created_at ? new Date(ord.created_at).toLocaleTimeString() : 'Just now'}</span>
                          <span>•</span>
                          <span className="font-semibold text-foreground">${Number(ord.total || 0).toFixed(2)}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1 text-xs"
                          onClick={() => handleApproveOrder(ord.id)}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          Accept &amp; Send to KDS
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:bg-destructive/10 gap-1 text-xs"
                          onClick={() => handleRejectOrder(ord.id)}
                        >
                          <XCircle className="h-4 w-4" />
                          Decline
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-10 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
                  <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                  <span className="font-semibold text-sm">Incoming queue is clear</span>
                  <span>Direct QR and kiosk orders appear here instantly when placed by diners.</span>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Table QR Code Generator */}
        <TabsContent value="tables" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="md:col-span-1">
              <CardHeader className="pb-3 border-b border-border/30">
                <CardTitle className="text-sm">Restaurant Floor Tables</CardTitle>
              </CardHeader>
              <CardContent className="p-2 space-y-1">
                {tables.map((table) => {
                  const isSel = selectedTable?.id === table.id;
                  return (
                    <div
                      key={table.id}
                      onClick={() => setSelectedTable(table)}
                      className={`p-2.5 rounded-lg border cursor-pointer text-xs flex items-center justify-between ${
                        isSel ? 'border-primary bg-primary/10 font-semibold' : 'border-border/50 hover:bg-muted/30'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <Layers className="h-3.5 w-3.5 text-primary" />
                        {table.name || `Table ${table.id}`}
                      </span>
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {table.status || 'available'}
                      </Badge>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader className="pb-3 border-b border-border/30">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>Self-Ordering Standee: {selectedTable?.name || 'Table Selected'}</span>
                  <Badge variant="secondary">0% Fees</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 flex flex-col items-center justify-center space-y-4">
                {selectedTable ? (
                  <>
                    <div className="p-6 bg-white rounded-2xl shadow-md border flex flex-col items-center">
                      <div className="text-black font-extrabold text-base mb-2">SCAN TO ORDER</div>
                      <div className="h-44 w-44 bg-neutral-900 rounded-xl p-2 flex flex-col items-center justify-center text-center text-white text-xs">
                        <QrCode className="h-28 w-28 text-white" />
                        <span className="font-mono text-[10px] text-white/80 mt-1">Table {selectedTable.name}</span>
                      </div>
                      <div className="text-neutral-600 font-medium text-xs mt-3">FloCafe Digital Dining</div>
                    </div>

                    <div className="w-full max-w-sm space-y-2">
                      <div className="text-xs text-muted-foreground text-center font-mono break-all p-2 bg-muted/40 rounded border">
                        {getTableQrLink(selectedTable.id)}
                      </div>
                      <div className="flex gap-2 justify-center">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs gap-1.5"
                          onClick={() => copyQrLink(selectedTable.id)}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          {copiedTableId === String(selectedTable.id) ? 'Copied URL!' : 'Copy Table Link'}
                        </Button>
                        <Button
                          size="sm"
                          className="text-xs gap-1.5"
                          onClick={() => window.open(getTableQrLink(selectedTable.id), '_blank')}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Test Diner View
                        </Button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground">Select a table to generate its QR standee.</div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab 3: Self-Service Kiosks & Direct Delivery */}
        <TabsContent value="kiosk" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Store className="h-4 w-4 text-primary" />
                  Self-Service Ordering Kiosks
                </CardTitle>
                <CardDescription className="text-xs">
                  Run customer-facing counter tablets in full-screen locked kiosk mode.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Lock an Android tablet or iPad onto the ordering menu so walk-in customers can order and pay autonomously at the counter.
                </p>
                <Button size="sm" className="w-full gap-2 text-xs" onClick={() => window.open('/qr?mode=kiosk', '_blank')}>
                  <ExternalLink className="h-4 w-4" />
                  Launch Counter Kiosk Mode
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Truck className="h-4 w-4 text-primary" />
                  Direct Customer Delivery Orders
                </CardTitle>
                <CardDescription className="text-xs">
                  Accept commission-free delivery orders directly from your local website.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Integrated with local customer address capture and phone WhatsApp delivery notifications without any aggregator margins.
                </p>
                <Button size="sm" variant="outline" className="w-full gap-2 text-xs" onClick={() => window.open('/delivery', '_blank')}>
                  <ExternalLink className="h-4 w-4" />
                  Open Delivery Dispatch
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
