'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Server,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  Cpu,
  Activity,
  Key,
  Database,
  Terminal,
  Lock,
  Unlock,
  Plus,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Radio,
  FileKey,
  DollarSign,
  TrendingUp,
  Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

interface PingData {
  status?: string;
  node_name?: string;
  hwid?: string;
  os_platform?: string;
  license_tier?: string;
  p2p_ip?: string | null;
  [key: string]: unknown;
}

interface NodeFleetEntry {
  id: string;
  name: string;
  url: string;
  online: boolean;
  pingData?: PingData;
}

interface InsightsData {
  today?: {
    revenue?: number;
    orders_count?: number;
    avg_ticket?: number;
  };
  last_30_days?: {
    revenue?: number;
    orders_count?: number;
  };
  operations?: {
    open_tables_count?: number;
    active_cash_session?: Record<string, unknown> | null;
    low_stock_count?: number;
    low_stock_items?: Array<{ id: string | number; name: string; stock_quantity: number; min_stock_alert: number }>;
  };
}

interface DiagnosticsData {
  system?: {
    arch?: string;
    cpu_cores?: number;
    load_average?: number[];
    memory?: {
      used_percent?: number;
      free_bytes: number;
    };
  };
  sqlite?: {
    integrity?: string;
    db_size_bytes: number;
    journal_mode?: string;
  };
  network?: {
    lan_ips?: string[];
    p2p_ip?: string | null;
  };
}

export default function OwnerControlPage() {
  const [nodes, setNodes] = useState<NodeFleetEntry[]>([
    { id: 'sentinel', name: 'Local Sentinel OS Daemon (:3009)', url: 'http://127.0.0.1:3009', online: false },
    { id: 'local-api', name: 'Local FloCafe API (:3001)', url: 'http://127.0.0.1:3001', online: false },
  ]);
  const [selectedNodeId, setSelectedNodeId] = useState<string>('sentinel');
  const [newNodeUrl, setNewNodeUrl] = useState('');
  const [newNodeName, setNewNodeName] = useState('');

  // Owner Vault
  const [ownerPassword, setOwnerPassword] = useState('Fl0220671190');
  const [ownerMasterKeyJson, setOwnerMasterKeyJson] = useState<Record<string, unknown> | null>(null);
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const masterKeyInputRef = useRef<HTMLInputElement>(null);

  // Active Node Diagnostics & Insights
  const [diagnostics, setDiagnostics] = useState<DiagnosticsData | null>(null);
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ text: string; error?: boolean } | null>(null);

  // License Management
  const [selectedTier, setSelectedTier] = useState<string>('forever');
  const [tierKeyJson, setTierKeyJson] = useState<Record<string, unknown> | null>(null);
  const [autoRenew, setAutoRenew] = useState(false);
  const tierKeyInputRef = useRef<HTMLInputElement>(null);

  // SQL Query execution
  const [sqlQuery, setSqlQuery] = useState('SELECT * FROM orders ORDER BY id DESC LIMIT 5;');
  const [sqlResult, setSqlResult] = useState<unknown>(null);

  // Load master key from disk or file picker
  const handleMasterKeyUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target?.result as string);
        if (parsed.private_key_pem) {
          setOwnerMasterKeyJson(parsed);
          setVaultUnlocked(true);
          setActionMessage({ text: `Owner Master Key loaded (${file.name})` });
        } else {
          setActionMessage({ text: 'File does not contain valid private_key_pem', error: true });
        }
      } catch {
        setActionMessage({ text: 'Failed to parse JSON key file', error: true });
      }
    };
    reader.readAsText(file);
  };

  const handleTierKeyUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target?.result as string);
        setTierKeyJson(parsed);
        setActionMessage({ text: `License Key loaded (${file.name})` });
      } catch {
        setActionMessage({ text: 'Failed to parse License key JSON', error: true });
      }
    };
    reader.readAsText(file);
  };

  // Ping all fleet nodes
  const refreshNodes = useCallback(async () => {
    setNodes((prevNodes) =>
      Promise.all(
        prevNodes.map(async (n) => {
          try {
            const res = await fetch(`${n.url}/api/sentinel/ping`, { signal: AbortSignal.timeout(3500) });
            if (res.ok) {
              const data = await res.json();
              return { ...n, online: true, pingData: data };
            }
          } catch {}
          return { ...n, online: false };
        })
      ) as unknown as NodeFleetEntry[]
    );
  }, []);

  useEffect(() => {
    let mounted = true;
    const runPing = () => {
      setNodes((prevNodes) => {
        void Promise.all(
          prevNodes.map(async (n) => {
            try {
              const res = await fetch(`${n.url}/api/sentinel/ping`, { signal: AbortSignal.timeout(3500) });
              if (res.ok) {
                const data = await res.json();
                return { ...n, online: true, pingData: data };
              }
            } catch {}
            return { ...n, online: false };
          })
        ).then((updated) => {
          if (mounted) setNodes(updated);
        });
        return prevNodes;
      });
    };

    const timer = setTimeout(runPing, 0);
    const interval = setInterval(runPing, 10000);
    return () => {
      mounted = false;
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, []);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || nodes[0];

  // Fetch diagnostics and insights for selected node
  const fetchNodeDetails = useCallback(async () => {
    if (!selectedNode || !selectedNode.online) return;
    setLoadingAction('fetch-details');
    try {
      const headers: Record<string, string> = {
        'x-owner-password': ownerPassword,
      };
      if (ownerMasterKeyJson) {
        headers['x-owner-master-key'] = btoa(JSON.stringify(ownerMasterKeyJson));
      }

      // Insights
      const inRes = await fetch(`${selectedNode.url}/api/sentinel/insights`, { headers });
      if (inRes.ok) setInsights(await inRes.json());

      // Diagnostics
      const diagRes = await fetch(`${selectedNode.url}/api/sentinel/diagnostics`, { headers });
      if (diagRes.ok) setDiagnostics(await diagRes.json());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionMessage({ text: `Failed to fetch node metrics: ${msg}`, error: true });
    } finally {
      setLoadingAction(null);
    }
  }, [selectedNode, ownerPassword, ownerMasterKeyJson]);

  useEffect(() => {
    if (selectedNode?.online && vaultUnlocked) {
      const timer = setTimeout(() => {
        void fetchNodeDetails();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [selectedNodeId, vaultUnlocked, fetchNodeDetails, selectedNode?.online]);

  // Execute App Control Action
  const handleAppControl = async (action: string) => {
    if (!selectedNode) return;
    setLoadingAction(`action-${action}`);
    setActionMessage(null);
    try {
      const res = await fetch(`${selectedNode.url}/api/sentinel/app-control`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-owner-password': ownerPassword,
          'x-owner-master-key': ownerMasterKeyJson ? btoa(JSON.stringify(ownerMasterKeyJson)) : '',
        },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActionMessage({ text: `Action '${action}' succeeded: ${data.message || data.backup_path || 'OK'}` });
      } else {
        setActionMessage({ text: data.error || data.message || `Failed to execute ${action}`, error: true });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionMessage({ text: `Request failed: ${msg}`, error: true });
    } finally {
      setLoadingAction(null);
    }
  };

  // Push remote license or revoke
  const handleRemoteLicense = async (action: 'activate' | 'revoke') => {
    if (!selectedNode) return;
    setLoadingAction('license-action');
    setActionMessage(null);
    try {
      const res = await fetch(`${selectedNode.url}/api/sentinel/remote-license`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-owner-password': ownerPassword,
          'x-owner-master-key': ownerMasterKeyJson ? btoa(JSON.stringify(ownerMasterKeyJson)) : '',
        },
        body: JSON.stringify({
          action,
          tierKeyContent: tierKeyJson ? JSON.stringify(tierKeyJson) : undefined,
          ownerMasterKeyContent: ownerMasterKeyJson,
          reactivationPassword: ownerPassword,
          autoRenewPolicy: autoRenew ? { enabled: true, renew_tier: selectedTier, max_renewals: 12 } : null,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActionMessage({ text: `Remote license ${action} applied successfully!` });
        refreshNodes();
        fetchNodeDetails();
      } else {
        setActionMessage({ text: data.error || 'License operation failed', error: true });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionMessage({ text: `Remote license error: ${msg}`, error: true });
    } finally {
      setLoadingAction(null);
    }
  };

  // Run SQL Query
  const handleRunSql = async () => {
    if (!selectedNode) return;
    setLoadingAction('run-sql');
    try {
      const res = await fetch(`${selectedNode.url}/api/sentinel/sql-query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-owner-password': ownerPassword,
          'x-owner-master-key': ownerMasterKeyJson ? btoa(JSON.stringify(ownerMasterKeyJson)) : '',
        },
        body: JSON.stringify({ query: sqlQuery }),
      });
      const data = await res.json();
      setSqlResult(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSqlResult({ error: msg });
    } finally {
      setLoadingAction(null);
    }
  };

  const addCustomNode = () => {
    if (!newNodeUrl) return;
    const cleanUrl = newNodeUrl.replace(/\/$/, '');
    const id = `node-${Date.now()}`;
    setNodes([...nodes, { id, name: newNodeName || cleanUrl, url: cleanUrl, online: false }]);
    setNewNodeUrl('');
    setNewNodeName('');
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Radio className="h-6 w-6 text-primary animate-pulse" />
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">FloOwner Fleet Command</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Zero-Cost, Serverless Remote Telemetry, OS Sentinel Daemon &amp; Remote License Manager
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refreshNodes} className="gap-1.5">
            <RefreshCw className="h-4 w-4" />
            Refresh Fleet
          </Button>
          <Badge variant={vaultUnlocked ? 'default' : 'secondary'} className="gap-1 px-3 py-1 text-xs">
            {vaultUnlocked ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Lock className="h-3.5 w-3.5" />}
            {vaultUnlocked ? 'Vault Unlocked' : 'Vault Locked'}
          </Badge>
        </div>
      </div>

      {/* Owner Vault Unlocker Card */}
      <Card className="border-primary/20 bg-card/60 backdrop-blur-md">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Key className="h-4 w-4 text-primary" />
              Owner Cryptographic Vault
            </span>
            <span className="text-xs text-muted-foreground font-normal">
              Required for signed remote control &amp; license deployment
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Owner Master Password</label>
              <Input
                type="password"
                value={ownerPassword}
                onChange={(e) => setOwnerPassword(e.target.value)}
                placeholder="Enter Owner Password"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Owner Master Key File</label>
              <div className="flex gap-2 mt-1">
                <input
                  type="file"
                  ref={masterKeyInputRef}
                  onChange={handleMasterKeyUpload}
                  accept=".flokey,.json"
                  className="hidden"
                />
                <Button
                  variant="outline"
                  className="w-full justify-start text-xs text-muted-foreground"
                  onClick={() => masterKeyInputRef.current?.click()}
                >
                  <FileKey className="h-4 w-4 mr-2" />
                  {ownerMasterKeyJson ? 'Master Key Loaded' : 'Load owner-reactivate-master.flokey'}
                </Button>
              </div>
            </div>
            <div>
              <Button
                className="w-full gap-2"
                variant={vaultUnlocked ? 'secondary' : 'default'}
                onClick={() => {
                  if (ownerPassword && ownerMasterKeyJson) {
                    setVaultUnlocked(true);
                    setActionMessage({ text: 'Vault unlocked for remote fleet commands' });
                  } else {
                    setActionMessage({ text: 'Enter password and select owner-reactivate-master.flokey', error: true });
                  }
                }}
              >
                {vaultUnlocked ? <Unlock className="h-4 w-4 text-emerald-400" /> : <Lock className="h-4 w-4" />}
                {vaultUnlocked ? 'Vault Active' : 'Unlock Fleet Vault'}
              </Button>
            </div>
          </div>
          {actionMessage && (
            <div
              className={`mt-3 text-xs p-2.5 rounded-md flex items-center gap-2 ${
                actionMessage.error ? 'bg-destructive/15 text-destructive' : 'bg-emerald-500/15 text-emerald-400'
              }`}
            >
              {actionMessage.error ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {actionMessage.text}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fleet Nodes Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left: Node List */}
        <div className="space-y-4 md:col-span-1">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center justify-between">
                <span>Fleet Nodes ({nodes.length})</span>
                <span className="text-xs text-muted-foreground font-normal">LAN &amp; P2P</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-3">
              {nodes.map((node) => {
                const isSelected = node.id === selectedNodeId;
                return (
                  <div
                    key={node.id}
                    onClick={() => setSelectedNodeId(node.id)}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      isSelected
                        ? 'border-primary bg-primary/10 shadow-sm'
                        : 'border-border/60 hover:border-primary/40 bg-card/40'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-sm truncate">{node.name}</div>
                      <span className={`h-2.5 w-2.5 rounded-full ${node.online ? 'bg-emerald-500 animate-pulse' : 'bg-destructive'}`} />
                    </div>
                    <div className="text-xs text-muted-foreground font-mono mt-1 truncate">{node.url}</div>
                    {node.pingData && (
                      <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                          {node.pingData.os_platform || 'linux'}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                          {node.pingData.license_tier || 'unactivated'}
                        </Badge>
                        {node.pingData.p2p_ip && (
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-primary">
                            P2P: {node.pingData.p2p_ip}
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Add Node form */}
              <div className="pt-2 border-t border-border/40 space-y-2">
                <Input
                  placeholder="Node Name (e.g. Branch 2 Kitchen)"
                  value={newNodeName}
                  onChange={(e) => setNewNodeName(e.target.value)}
                  className="text-xs h-8"
                />
                <Input
                  placeholder="URL (e.g. http://100.x.y.z:3009)"
                  value={newNodeUrl}
                  onChange={(e) => setNewNodeUrl(e.target.value)}
                  className="text-xs h-8"
                />
                <Button size="sm" variant="outline" className="w-full text-xs h-8 gap-1.5" onClick={addCustomNode}>
                  <Plus className="h-3.5 w-3.5" />
                  Add Remote Node
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Selected Node Command Deck */}
        <div className="space-y-4 md:col-span-2">
          <Card>
            <CardHeader className="pb-3 border-b border-border/30">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Server className="h-5 w-5 text-primary" />
                    {selectedNode.name}
                  </CardTitle>
                  <CardDescription className="font-mono text-xs mt-0.5">
                    {selectedNode.url} • {selectedNode.online ? 'Online' : 'Offline / Unreachable'}
                  </CardDescription>
                </div>
                {selectedNode.online && (
                  <Button size="sm" variant="secondary" onClick={fetchNodeDetails} disabled={loadingAction === 'fetch-details'}>
                    <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loadingAction === 'fetch-details' ? 'animate-spin' : ''}`} />
                    Refresh Metrics
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <Tabs defaultValue="insights" className="w-full">
                <TabsList className="grid grid-cols-4 mb-4">
                  <TabsTrigger value="insights" className="text-xs">Live Insights</TabsTrigger>
                  <TabsTrigger value="diagnostics" className="text-xs">OS &amp; Health</TabsTrigger>
                  <TabsTrigger value="license" className="text-xs">License Manager</TabsTrigger>
                  <TabsTrigger value="maintenance" className="text-xs">Maintenance &amp; SQL</TabsTrigger>
                </TabsList>

                {/* Tab 1: Live Insights */}
                <TabsContent value="insights" className="space-y-4">
                  {insights ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Card className="bg-card/40 p-3">
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
                            Today&apos;s Sales
                          </div>
                          <div className="text-xl font-bold mt-1">${insights.today?.revenue?.toFixed(2) || '0.00'}</div>
                          <div className="text-[11px] text-muted-foreground">{insights.today?.orders_count || 0} orders</div>
                        </Card>
                        <Card className="bg-card/40 p-3">
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <TrendingUp className="h-3.5 w-3.5 text-primary" />
                            30-Day Sales
                          </div>
                          <div className="text-xl font-bold mt-1">${insights.last_30_days?.revenue?.toFixed(2) || '0.00'}</div>
                          <div className="text-[11px] text-muted-foreground">{insights.last_30_days?.orders_count || 0} orders</div>
                        </Card>
                        <Card className="bg-card/40 p-3">
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <Layers className="h-3.5 w-3.5 text-amber-400" />
                            Active Tables
                          </div>
                          <div className="text-xl font-bold mt-1">{insights.operations?.open_tables_count || 0}</div>
                          <div className="text-[11px] text-muted-foreground">Currently occupied</div>
                        </Card>
                        <Card className="bg-card/40 p-3">
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                            Low Stock Alerts
                          </div>
                          <div className="text-xl font-bold mt-1">{insights.operations?.low_stock_count || 0}</div>
                          <div className="text-[11px] text-muted-foreground">Products near reorder</div>
                        </Card>
                      </div>

                      {Boolean(insights.operations?.low_stock_items && insights.operations.low_stock_items.length > 0) && (
                        <div className="border border-border/40 rounded-lg p-3">
                          <div className="text-xs font-semibold mb-2 flex items-center gap-1 text-amber-400">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Critical Inventory Depletion
                          </div>
                          <div className="space-y-1">
                            {insights.operations?.low_stock_items?.map((item) => (
                              <div key={item.id} className="text-xs flex justify-between py-1 border-b border-border/20">
                                <span>{item.name}</span>
                                <span className="font-mono text-destructive">
                                  {item.stock_quantity} remaining (alert at {item.min_stock_alert})
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="py-8 text-center text-xs text-muted-foreground">
                      {vaultUnlocked ? 'Click "Refresh Metrics" to fetch live store insights.' : 'Unlock Owner Vault to access business analytics.'}
                    </div>
                  )}
                </TabsContent>

                {/* Tab 2: OS & Diagnostics */}
                <TabsContent value="diagnostics" className="space-y-4">
                  {diagnostics ? (
                    <div className="space-y-4 text-xs">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        <Card className="p-3 bg-card/40">
                          <div className="text-muted-foreground flex items-center gap-1.5">
                            <Cpu className="h-4 w-4 text-primary" />
                            CPU &amp; Architecture
                          </div>
                          <div className="font-mono mt-1 font-semibold">
                            {diagnostics.system?.arch} • {diagnostics.system?.cpu_cores} cores
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            Load: {diagnostics.system?.load_average?.map((l: number) => l.toFixed(2)).join(', ')}
                          </div>
                        </Card>
                        <Card className="p-3 bg-card/40">
                          <div className="text-muted-foreground flex items-center gap-1.5">
                            <Activity className="h-4 w-4 text-emerald-400" />
                            RAM Usage
                          </div>
                          <div className="font-mono mt-1 font-semibold">
                            {diagnostics.system?.memory?.used_percent}% used
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {((diagnostics.system?.memory?.free_bytes || 0) / 1024 / 1024 / 1024).toFixed(2)} GB free
                          </div>
                        </Card>
                        <Card className="p-3 bg-card/40">
                          <div className="text-muted-foreground flex items-center gap-1.5">
                            <Database className="h-4 w-4 text-cyan-400" />
                            SQLite Health
                          </div>
                          <div className="font-mono mt-1 font-semibold text-emerald-400">
                            {diagnostics.sqlite?.integrity}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                            {((diagnostics.sqlite?.db_size_bytes || 0) / 1024 / 1024).toFixed(2)} MB • {diagnostics.sqlite?.journal_mode}
                          </div>
                        </Card>
                      </div>

                      {diagnostics.network && (
                        <div className="p-3 border rounded-lg space-y-1">
                          <div className="font-semibold text-muted-foreground">Network Interfaces &amp; Zero-Cost P2P</div>
                          <div className="flex flex-wrap gap-2 pt-1">
                            {diagnostics.network.lan_ips?.map((ip: string) => (
                              <Badge key={ip} variant="outline" className="font-mono text-xs">LAN: {ip}</Badge>
                            ))}
                            {diagnostics.network.p2p_ip && (
                              <Badge variant="default" className="font-mono text-xs bg-emerald-600">P2P: {diagnostics.network.p2p_ip}</Badge>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="py-8 text-center text-xs text-muted-foreground">
                      Unlock Owner Vault and click Refresh Metrics to inspect OS telemetry.
                    </div>
                  )}
                </TabsContent>

                {/* Tab 3: Remote License Manager */}
                <TabsContent value="license" className="space-y-4">
                  <div className="p-4 border rounded-lg space-y-3 bg-card/40">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-sm">Remote Asymmetric License Provisioning</div>
                      <Badge variant="outline">HWID: {selectedNode.pingData?.hwid || 'Pending'}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Remotely sign, switch duration, or immediately lock/revoke the target machine using your offline Ed25519 keys.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                      <div>
                        <label className="text-xs font-medium">Select Duration Tier</label>
                        <select
                          className="w-full mt-1 bg-background border border-border rounded-md px-3 py-2 text-xs"
                          value={selectedTier}
                          onChange={(e) => setSelectedTier(e.target.value)}
                        >
                          <option value="forever">Forever (Permanent Sovereign)</option>
                          <option value="24h">24 Hours</option>
                          <option value="3d">3 Days</option>
                          <option value="1w">1 Week</option>
                          <option value="1m">1 Month</option>
                          <option value="3m">3 Months</option>
                          <option value="6m">6 Months</option>
                          <option value="1y">1 Year</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium">Target License Key File</label>
                        <div className="flex gap-2 mt-1">
                          <input
                            type="file"
                            ref={tierKeyInputRef}
                            onChange={handleTierKeyUpload}
                            accept=".flokey,.json"
                            className="hidden"
                          />
                          <Button
                            variant="outline"
                            className="w-full justify-start text-xs h-9"
                            onClick={() => tierKeyInputRef.current?.click()}
                          >
                            <FileKey className="h-4 w-4 mr-2" />
                            {tierKeyJson ? `${tierKeyJson.tier || 'Key'} Loaded` : `Load ${selectedTier}.flokey`}
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-2">
                      <input
                        type="checkbox"
                        id="autoRenew"
                        checked={autoRenew}
                        onChange={(e) => setAutoRenew(e.target.checked)}
                        className="rounded border-border"
                      />
                      <label htmlFor="autoRenew" className="text-xs text-muted-foreground cursor-pointer">
                        Enable Auto-Renewal Policy for this trusted branch
                      </label>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-3 border-t border-border/40">
                      <Button
                        size="sm"
                        className="gap-1.5"
                        disabled={!vaultUnlocked || loadingAction === 'license-action'}
                        onClick={() => handleRemoteLicense('activate')}
                      >
                        <ShieldCheck className="h-4 w-4" />
                        Push Remote License ({selectedTier})
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="gap-1.5"
                        disabled={!vaultUnlocked || loadingAction === 'license-action'}
                        onClick={() => handleRemoteLicense('revoke')}
                      >
                        <ShieldAlert className="h-4 w-4" />
                        Emergency Lock / Revoke Machine
                      </Button>
                    </div>
                  </div>
                </TabsContent>

                {/* Tab 4: Maintenance & SQL */}
                <TabsContent value="maintenance" className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-9 gap-1.5"
                      disabled={!vaultUnlocked}
                      onClick={() => handleAppControl('backup_db')}
                    >
                      <Database className="h-4 w-4 text-primary" />
                      Immediate DB Backup
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-9 gap-1.5"
                      disabled={!vaultUnlocked}
                      onClick={() => handleAppControl('run_safe_fixes')}
                    >
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      Run Safe DB Optimize
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-9 gap-1.5"
                      disabled={!vaultUnlocked}
                      onClick={() => handleAppControl('restart')}
                    >
                      <RotateCcw className="h-4 w-4 text-amber-400" />
                      Restart FloCafe App
                    </Button>
                  </div>

                  {/* SQL Query Console */}
                  <div className="space-y-2 pt-2">
                    <label className="text-xs font-semibold flex items-center gap-1.5">
                      <Terminal className="h-4 w-4 text-primary" />
                      Remote SQLite Analytical Console
                    </label>
                    <div className="flex gap-2">
                      <Input
                        value={sqlQuery}
                        onChange={(e) => setSqlQuery(e.target.value)}
                        placeholder="SELECT * FROM orders LIMIT 10;"
                        className="font-mono text-xs"
                      />
                      <Button size="sm" onClick={handleRunSql} disabled={!vaultUnlocked}>
                        Execute
                      </Button>
                    </div>
                    {Boolean(sqlResult) && (
                      <pre className="p-3 bg-black/60 rounded-md text-[11px] font-mono overflow-auto max-h-60 border border-border/40 text-emerald-300">
                        {JSON.stringify(sqlResult, null, 2)}
                      </pre>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
