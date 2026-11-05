'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Loader2, AlertTriangle, CheckCircle2, XCircle, QrCode, Ban, Send, Inbox, Copy, KeyRound, Info,
  RefreshCw, Sparkles, Gift, Receipt,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth';
import { useTranslations, type AppConfig } from 'use-intl';
import { useConfirm } from '@/hooks/use-confirm';
import { usePosSettingsStore } from '@/store/pos-settings';
import { useFormatDate } from '@/hooks/useFormatDate';
import { dialCodeFor, parsePhone } from '@/lib/phone';
import { Ltr } from '@/components/layout/Ltr';
import { tenantCan } from '@/lib/permissions';

interface WhatsAppStatus {
  enabled: boolean;
  state: 'disconnected' | 'connecting' | 'waiting_qr' | 'waiting_pairing' | 'connected' | 'cooldown';
  connectedPhone: string | null;
  lastError: string | null;
  lastErrorReason: string | null;
  cooldownUntil: string | null;
}

type WhatsAppApiErrorKey = keyof AppConfig['Messages']['whatsapp']['apiError'];

// Exhaustively typed backend error codes for the `whatsapp.apiError` namespace.
const WHATSAPP_API_ERROR_KEYS: readonly WhatsAppApiErrorKey[] = [
  'bad_connect_method',
  'body_required',
  'inbound_not_found',
  'no_pairing_code',
  'no_qr',
  'phone_not_in_blocklist',
  'phone_required',
  'phone_required_pairing',
];

function isWhatsAppApiErrorKey(code: string): code is WhatsAppApiErrorKey {
  return (WHATSAPP_API_ERROR_KEYS as readonly string[]).includes(code);
}

/** Show a backend error as a localized toast, mapping `whatsapp.apiError.<reason>` and never surfacing raw English. */
function toastApiError(err: unknown, fallback: string, tApiError: (key: WhatsAppApiErrorKey) => string): void {
  const data = (err as { response?: { data?: { reason?: string; code?: string } } })?.response?.data;
  const code = data?.reason || data?.code;
  toast.error(code && isWhatsAppApiErrorKey(code) ? tApiError(code) : fallback);
}

interface SentMessage {
  id: number;
  phone_e164: string;
  bill_id: number | null;
  customer_id: number | null;
  direction: 'inbound' | 'outbound';
  kind: 'bill_receipt' | 'manual_reply' | 'auto_followup';
  status: string;
  body: string;
  error: string | null;
  queued_at: string;
  seen_at: string | null;
  typing_at: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  created_by_user_id: string | null;
}

interface InboxMessage {
  id: number;
  phone_e164: string;
  body: string;
  status: string;
  queued_at: string;
}

interface BlocklistRow {
  phone_e164: string;
  reason: string | null;
  blocked_at: string;
  blocked_by_user_id: string | null;
}

type WhatsAppMessageStatus = 'queued' | 'typing' | 'sent' | 'delivered' | 'read' | 'failed';
type WhatsAppStatusKey = keyof AppConfig['Messages']['whatsapp']['status'];

const WHATSAPP_STATUS_KEYS = {
  queued: 'queued',
  typing: 'typing',
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
} as const satisfies Record<WhatsAppMessageStatus, WhatsAppStatusKey>;

type WhatsAppMessageKind = 'bill_receipt' | 'manual_reply' | 'auto_followup';
type WhatsAppKindKey = keyof AppConfig['Messages']['whatsapp']['kind'];

const WHATSAPP_KIND_KEYS = {
  bill_receipt: 'bill_receipt',
  manual_reply: 'manual_reply',
  auto_followup: 'auto_followup',
} as const satisfies Record<WhatsAppMessageKind, WhatsAppKindKey>;

type WhatsAppState = 'disconnected' | 'connecting' | 'waiting_qr' | 'waiting_pairing' | 'connected' | 'cooldown';
type WhatsAppStateKey = keyof AppConfig['Messages']['whatsapp']['state'];

const STATE_KEYS = {
  disconnected: 'disconnected',
  connecting: 'connecting',
  waiting_qr: 'waiting_qr',
  waiting_pairing: 'waiting_pairing',
  connected: 'connected',
  cooldown: 'cooldown',
} as const satisfies Record<WhatsAppState, WhatsAppStateKey>;

type WhatsAppLastErrorReason = 'reconnecting' | 'rate_limited' | 'logged_out' | 'cooldown';
type WhatsAppLastErrorKey = keyof AppConfig['Messages']['whatsapp']['lastError'];

const WHATSAPP_LAST_ERROR_KEYS = {
  reconnecting: 'reconnecting',
  rate_limited: 'rate_limited',
  logged_out: 'logged_out',
  cooldown: 'cooldown',
} as const satisfies Record<WhatsAppLastErrorReason, WhatsAppLastErrorKey>;

const STATUS_STEPS = ['queued', 'typing', 'sent', 'delivered', 'read'] as const;
type StatusStep = typeof STATUS_STEPS[number];

function stepIndex(status: string): number {
  return STATUS_STEPS.indexOf(status as StatusStep);
}

function StatusStepper({ status }: { status: string }) {
  const tStatus = useTranslations('whatsapp.status');
  const failed = status === 'failed';
  const current = failed ? -1 : stepIndex(status);
  const statusKey = (WHATSAPP_STATUS_KEYS as Record<string, WhatsAppStatusKey | undefined>)[status];
  const title = failed ? tStatus('failed') : statusKey ? tStatus(statusKey) : status;
  return (
    <div className="flex items-center gap-1" title={title}>
      {STATUS_STEPS.map((step, i) => {
        const reached = !failed && i <= current;
        return (
          <span
            key={step}
            className={`h-1.5 w-4 rounded-full ${reached ? 'bg-primary' : 'bg-muted'} ${i === current ? 'ring-2 ring-primary/30' : ''}`}
          />
        );
      })}
      {failed && <span className="ms-1 text-xs text-destructive">{tStatus('failed')}</span>}
    </div>
  );
}

/** Translates backend lastError by reason code, falling back to raw message. */
function translateLastError(
  reason: string | null | undefined,
  raw: string | null | undefined,
  tLastError: (k: WhatsAppLastErrorKey, p?: Record<string, string | number>) => string,
): string {
  if (reason === 'reconnecting') {
    // Extract the status code from the raw message if present.
    const m = raw?.match(/\((\d+|unknown)\)/);
    const code = m?.[1] ?? 'unknown';
    const seconds = 5;
    return tLastError('reconnecting', { code, seconds });
  }
  if (reason === 'rate_limited') {
    const m = raw?.match(/\((\d+)\)/);
    const code = m?.[1] ?? '429';
    return tLastError('rate_limited', { code });
  }
  const key = (WHATSAPP_LAST_ERROR_KEYS as Record<string, WhatsAppLastErrorKey | undefined>)[reason ?? ''];
  if (key) return tLastError(key);
  return raw ?? tLastError('cooldown');
}

export default function WhatsAppPage() {
  const tNav = useTranslations('nav');
  const tTabs = useTranslations('whatsapp.tabs');
  const tConnection = useTranslations('whatsapp.connection');
  const tConnect = useTranslations('whatsapp.connect');
  const tActive = useTranslations('whatsapp.active');
  const tBlocklist = useTranslations('whatsapp.blocklist');
  const tInbox = useTranslations('whatsapp.inbox');
  const tSent = useTranslations('whatsapp.sent');
  const tCommon = useTranslations('common');
  const tState = useTranslations('whatsapp.state');
  const tKind = useTranslations('whatsapp.kind');
  const tLastError = useTranslations('whatsapp.lastError');
  const tApiError = useTranslations('whatsapp.apiError');
  const { confirm, ConfirmDialog } = useConfirm();
  const setWhatsappEnabled = usePosSettingsStore((s) => s.setWhatsappEnabled);
  const { currentTenant } = useAuthStore();
  const isAdmin = tenantCan(currentTenant, 'whatsapp.manage');
  const { formatDateTime: fmt, formatTime: fmtClock } = useFormatDate();

  const tenantCountry = currentTenant?.country || '';
  const dialCode = dialCodeFor(tenantCountry) || '';

  const copyToClipboard = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(tInbox('phoneCopied', { phone: label }));
    } catch {
      toast.error(tInbox('copyFailed'));
    }
  };

  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingPhone, setPairingPhone] = useState(dialCode);

  const [sentMessages, setSentMessages] = useState<SentMessage[]>([]);
  const [inbox, setInbox] = useState<InboxMessage[]>([]);
  const [blocklist, setBlocklist] = useState<BlocklistRow[]>([]);
  const [blockPhone, setBlockPhone] = useState('');
  const [blockReason, setBlockReason] = useState('');

  // Selected tab persisted in localStorage; null falls back to connection-state default.
  const [userTab, setUserTab] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem('whatsapp.activeTab');
  });
  const [filterGroups, setFilterGroupsState] = useState(true);

  const refreshStatus = useCallback(async () => {
    try {
      const { data } = await api.get('/whatsapp/status');
      setStatus(data);
      if (typeof data?.filterGroups === 'boolean') setFilterGroupsState(data.filterGroups);
    } catch {
      // ignore
    }
  }, []);

  // Winback & Auto-Receipt State
  interface WinBackCandidate {
    id: string;
    name: string | null;
    phone: string;
    days_inactive: number;
    last_order_at: string;
  }
  interface WinBackVoucher {
    id: string;
    customer_phone: string;
    customer_name: string | null;
    voucher_code: string;
    discount_pct: number;
    status: string;
    sent_at: string;
    expires_at: string;
  }
  const [autoReceiptEnabled, setAutoReceiptEnabled] = useState(true);
  const [winbackEnabled, setWinbackEnabled] = useState(true);
  const [inactiveDays, setInactiveDays] = useState(14);
  const [discountPct, setDiscountPct] = useState(15);
  const [winbackTemplate, setWinbackTemplate] = useState('');
  const [candidates, setCandidates] = useState<WinBackCandidate[]>([]);
  const [vouchers, setVouchers] = useState<WinBackVoucher[]>([]);
  const [loadingWinback, setLoadingWinback] = useState(false);
  const [dispatchingWinback, setDispatchingWinback] = useState(false);
  const [savingWinbackSettings, setSavingWinbackSettings] = useState(false);

  const loadWinback = useCallback(async () => {
    try {
      setLoadingWinback(true);
      const [candRes, vouchRes, setRes] = await Promise.all([
        api.get('/whatsapp/winback/candidates').catch(() => ({ data: { candidates: [] } })),
        api.get('/whatsapp/winback/vouchers').catch(() => ({ data: { vouchers: [] } })),
        api.get('/settings').catch(() => ({ data: {} })),
      ]);
      setCandidates(candRes.data?.candidates || []);
      setVouchers(vouchRes.data?.vouchers || []);
      const settings = setRes.data?.settings || setRes.data || {};
      if (settings.whatsapp_auto_receipt_enabled !== undefined) {
        setAutoReceiptEnabled(settings.whatsapp_auto_receipt_enabled === 'true');
      }
      if (settings.whatsapp_winback_enabled !== undefined) {
        setWinbackEnabled(settings.whatsapp_winback_enabled === 'true');
      }
      if (settings.whatsapp_winback_inactive_days) {
        setInactiveDays(Number(settings.whatsapp_winback_inactive_days) || 14);
      }
      if (settings.whatsapp_winback_discount_pct) {
        setDiscountPct(Number(settings.whatsapp_winback_discount_pct) || 15);
      }
      if (settings.whatsapp_winback_template) {
        setWinbackTemplate(settings.whatsapp_winback_template);
      }
    } catch {
      toast.error('Failed to load win-back automation data');
    } finally {
      setLoadingWinback(false);
    }
  }, []);

  const handleSaveWinbackSettings = async () => {
    try {
      setSavingWinbackSettings(true);
      await api.put('/whatsapp/winback/settings', {
        auto_receipt_enabled: autoReceiptEnabled,
        winback_enabled: winbackEnabled,
        inactive_days: inactiveDays,
        discount_pct: discountPct,
        template: winbackTemplate,
      });
      toast.success('Win-back & auto-receipt settings saved');
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSavingWinbackSettings(false);
    }
  };

  const handleRunWinbackCampaign = async () => {
    try {
      setDispatchingWinback(true);
      const res = await api.post('/whatsapp/winback/run', {
        inactive_days: inactiveDays,
        discount_pct: discountPct,
      });
      toast.success(`Dispatched win-back campaign to ${res.data?.vouchers_created || 0} customers!`);
      loadWinback();
    } catch {
      toast.error('Failed to run win-back campaign');
    } finally {
      setDispatchingWinback(false);
    }
  };

  const defaultTab = status?.state === 'connected' ? 'sent' : 'connection';
  const effectiveTab = (userTab === 'inbox' && !isAdmin) ? defaultTab : userTab ?? defaultTab;
  const onTabChange = (v: string) => {
    setUserTab(v);
    if (typeof window !== 'undefined') window.localStorage.setItem('whatsapp.activeTab', v);
  };

  useEffect(() => {
    if (effectiveTab === 'winback') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadWinback();
    }
  }, [effectiveTab, loadWinback]);

  const refreshQr = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const { data } = await api.get('/whatsapp/qr');
      setQrDataUrl(data.dataUrl);
    } catch {
      setQrDataUrl(null);
    }
  }, [isAdmin]);

  const refreshPairing = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const { data } = await api.get('/whatsapp/pairing-code');
      setPairingCode(data.code);
    } catch {
      setPairingCode(null);
    }
  }, [isAdmin]);

  const refreshSent = useCallback(async () => {
    try {
      const { data } = await api.get('/whatsapp/messages', { params: { direction: 'outbound', limit: 100 } });
      setSentMessages(data.messages ?? []);
    } catch { /* ignore */ }
  }, []);

  const refreshInbox = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const { data } = await api.get('/whatsapp/inbox', { params: { limit: 100 } });
      setInbox(data.messages ?? []);
    } catch { /* ignore */ }
  }, [isAdmin]);

  const refreshBlocklist = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const { data } = await api.get('/whatsapp/blocklist');
      setBlocklist(data.blocklist ?? []);
    } catch { /* ignore */ }
  }, [isAdmin]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    const id = setInterval(() => { void refreshStatus(); }, 5000);
    return () => clearInterval(id);
  }, [refreshStatus]);

  useEffect(() => {
    if (!isAdmin) return;
    if (status?.state === 'waiting_qr') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void refreshQr();
      const id = setInterval(refreshQr, 5000);
      return () => clearInterval(id);
    }
    setQrDataUrl(null);
    return undefined;
  }, [status?.state, isAdmin, refreshQr]);

  useEffect(() => {
    if (!isAdmin) return;
    if (status?.state === 'waiting_pairing') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void refreshPairing();
      const id = setInterval(refreshPairing, 5000);
      return () => clearInterval(id);
    }
    setPairingCode(null);
    return undefined;
  }, [status?.state, isAdmin, refreshPairing]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshSent();
  }, [refreshSent]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshInbox();
  }, [refreshInbox]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshBlocklist();
  }, [refreshBlocklist]);

  const disableFeature = async () => {
    if (!await confirm(tActive('disableConfirm'), {
      title: tActive('disableTitle'),
      confirmLabel: tActive('disableCta'),
      destructive: true,
    })) return;
    try {
      await api.post('/whatsapp/disable');
      setWhatsappEnabled(false);
      toast.success(tActive('disabledSuccess'));
      void refreshStatus();
} catch (err) { toastApiError(err, tActive('disableFailed'), tApiError);
    }
  };

  const connectQr = async () => {
    try {
      await api.post('/whatsapp/connect', { method: 'qr' });
      void refreshStatus();
} catch (err) { toastApiError(err, tConnect('qrFailed'), tApiError);
    }
  };

  const connectPairing = async () => {
    if (!pairingPhone.trim()) {
      toast.error(tConnect('pairingPhoneRequired'));
      return;
    }
    try {
      const { data } = await api.post('/whatsapp/connect', { method: 'pairing_code', phone: pairingPhone.trim() });
      if (data?.code) setPairingCode(data.code);
      void refreshStatus();
} catch (err) { toastApiError(err, tConnect('pairingFailed'), tApiError);
    }
  };

  const disconnect = async () => {
    if (!await confirm(tConnect('disconnectConfirm'), {
      title: tConnect('disconnectTitle'),
      confirmLabel: tConnect('disconnectCta'),
      destructive: true,
    })) return;
    try {
      await api.post('/whatsapp/disconnect');
      toast.success(tConnect('disconnectedSuccess'));
      void refreshStatus();
} catch (err) { toastApiError(err, tConnect('disconnectFailed'), tApiError);
    }
  };

  const addBlock = async () => {
    const tenantCountry = currentTenant?.country ?? '';
    const parsed = parsePhone(blockPhone.trim(), tenantCountry);
    if (!parsed) {
      toast.error(tBlocklist('phoneRequired'));
      return;
    }
    try {
      await api.post('/whatsapp/blocklist', { phone_e164: parsed.e164, reason: blockReason });
      setBlockPhone('');
      setBlockReason('');
      void refreshBlocklist();
      toast.success(tBlocklist('addedSuccess'));
    } catch (err) { toastApiError(err, tBlocklist('failed'), tApiError);
    }
  };

  const removeBlock = async (phone: string) => {
    if (!await confirm(tBlocklist('removeConfirm', { phone }), {
      confirmLabel: tBlocklist('removeCta'),
      destructive: true,
    })) return;
    try {
      await api.delete(`/whatsapp/blocklist/${encodeURIComponent(phone)}`);
      void refreshBlocklist();
} catch (err) { toastApiError(err, tBlocklist('failed'), tApiError);
    }
  };

  const blockFromInbox = async (phone: string) => {
    if (blocklist.some((b) => b.phone_e164 === phone)) {
      toast.error(tBlocklist('alreadyBlocked'));
      return;
    }
    try {
      await api.post('/whatsapp/blocklist', { phone_e164: phone, reason: tBlocklist('defaultReason') });
      void refreshBlocklist();
      void refreshInbox();
      toast.success(tBlocklist('fromInboxSuccess', { phone }));
    } catch (err) {
      toastApiError(err, tBlocklist('failed'), tApiError);
    }
  };

  const stateLabel = (state: string) => {
    const key = (STATE_KEYS as Record<string, WhatsAppStateKey | undefined>)[state];
    return key ? tState(key) : state;
  };

  return (
    <>
      {ConfirmDialog}
      <div className="space-y-4 p-2">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{tNav('whatsapp')}</h1>
        {status && (
          <Badge variant={status.state === 'connected' ? 'default' : status.state === 'cooldown' ? 'destructive' : 'secondary'}>
            {stateLabel(status.state)}
            {status.connectedPhone ? <> · <Ltr>{status.connectedPhone}</Ltr></> : null}
          </Badge>
        )}
      </div>

      <Tabs value={effectiveTab} onValueChange={onTabChange}>
        <TabsList>
          <TabsTrigger value="sent"><Send className="size-4" /> {tTabs('sent')}</TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="inbox"><Inbox className="size-4" /> {tTabs('inbox')}</TabsTrigger>
          )}
          <TabsTrigger value="winback"><RefreshCw className="size-4" /> Win-Back &amp; Receipts</TabsTrigger>
          <TabsTrigger value="connection"><QrCode className="size-4" /> {tTabs('connection')}</TabsTrigger>
        </TabsList>

        <TabsContent value="connection" className="space-y-4">
          {!status?.enabled && (
            <Card>
              <CardContent className="text-sm text-muted-foreground flex items-center justify-between gap-4 py-4">
                <span>
                  {tConnection('notEnabled')}
                </span>
                <Button asChild variant="outline" size="sm">
                  <Link href="/settings?tab=whatsapp">
                    {tConnection('enableInSettings')}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {status?.enabled && (
            <>
              {isAdmin && (
                <Card>
                  <CardHeader>
                    <CardTitle>{tConnect('title')}</CardTitle>
                    <CardDescription>{tConnect('description')}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {status.state === 'disconnected' && (
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-lg border bg-card p-4 flex flex-col gap-3">
                          <div className="flex items-center gap-2">
                            <div className="flex items-center justify-center size-9 rounded-md bg-brand-light dark:bg-[var(--color-brand-light)] text-brand dark:text-indigo-300">
                              <QrCode className="size-5" />
                            </div>
                            <h3 className="font-semibold text-sm">{tConnect('qrMethodTitle')}</h3>
                          </div>
                          <p className="text-sm text-muted-foreground">{tConnect('qrMethodDescription')}</p>
                          <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                            <div className="flex items-start gap-1.5">
                              <Info className="size-3.5 mt-0.5 shrink-0" />
                              <span>{tConnect('qrMethodWhere')}</span>
                            </div>
                          </div>
                          <Button onClick={connectQr} className="mt-auto w-full">
                            <QrCode className="size-4" /> {tConnect('startQr')}
                          </Button>
                        </div>

                        <div className="rounded-lg border bg-card p-4 flex flex-col gap-3">
                          <div className="flex items-center gap-2">
                            <div className="flex items-center justify-center size-9 rounded-md bg-brand-light dark:bg-[var(--color-brand-light)] text-brand dark:text-indigo-300">
                              <KeyRound className="size-5" />
                            </div>
                            <h3 className="font-semibold text-sm">{tConnect('pairingMethodTitle')}</h3>
                          </div>
                          <p className="text-sm text-muted-foreground">{tConnect('pairingMethodDescription')}</p>
                          <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                            <div className="flex items-start gap-1.5">
                              <Info className="size-3.5 mt-0.5 shrink-0" />
                              <span>{tConnect('pairingMethodWhere')}</span>
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs text-muted-foreground">{tConnect('pairingPhoneLabel')}</label>
                            <Input
                              value={pairingPhone}
                              onChange={(e) => setPairingPhone(e.target.value)}
                              placeholder={tConnect('pairingPhonePlaceholder', { dialCode: dialCode || '+CC' })}
                              inputMode="tel"
                              dir="ltr"
                            />
                          </div>
                          <Button onClick={connectPairing} variant="outline" className="w-full">
                            <KeyRound className="size-4" /> {tConnect('usePairing')}
                          </Button>
                        </div>
                      </div>
                    )}

                    {status.state === 'waiting_qr' && (
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">{tConnect('qrInstruction')}</p>
                        {qrDataUrl ? (
                          <div className="rounded-md border p-3 inline-block bg-card">
                            <img src={qrDataUrl} alt={tTabs('connection')} className="w-64 h-64" />
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {tConnect('qrGenerating')}</div>
                        )}
                        <p className="text-xs text-muted-foreground">{tConnect('qrRefreshHint')}</p>
                      </div>
                    )}

                    {status.state === 'waiting_pairing' && (
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">{tConnect('pairingInstruction')}</p>
                        {pairingCode ? (
                          <Ltr as="div" className="text-3xl font-mono tracking-widest p-4 rounded-md bg-muted inline-block">{pairingCode}</Ltr>
                        ) : (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {tConnect('pairingWaiting')}</div>
                        )}
                      </div>
                    )}

                    {status.state === 'connected' && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-green-700">
                          <CheckCircle2 className="size-5" />
                          <span>{tConnect('connectedAs')}</span>
                          <button
                            type="button"
                            onClick={() => status.connectedPhone && copyToClipboard(status.connectedPhone, status.connectedPhone)}
                            className="inline-flex items-center gap-1 font-mono font-semibold hover:underline cursor-pointer"
                            title={tInbox('copyPhone')}
                          >
                            <Ltr>{status.connectedPhone}</Ltr>
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" onClick={disconnect}>{tConnect('disconnectCta')}</Button>
                        </div>
                        <label className="flex items-start gap-3 text-sm cursor-pointer pt-2 border-t">
                          <input
                            type="checkbox"
                            className="mt-1 size-4 accent-primary"
                            checked={filterGroups}
                            onChange={(e) => {
                              const next = e.target.checked;
                              setFilterGroupsState(next);
                              void api.post('/whatsapp/settings', { filterGroups: next })
                                .catch(() => { setFilterGroupsState(!next); toast.error(tCommon('saveFailed')); });
                            }}
                          />
                          <span className="text-muted-foreground">
                            {tConnect('filterGroupsLabel')}
                          </span>
                        </label>
                      </div>
                    )}

                    {status.state === 'cooldown' && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-amber-700"><AlertTriangle className="size-5" /> {translateLastError(status.lastErrorReason, status.lastError, tLastError)}</div>
                        {status.cooldownUntil && <p className="text-xs text-muted-foreground">{tConnect('cooldownResumesAt', { time: fmtClock(status.cooldownUntil) })}</p>}
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" onClick={disconnect}>{tConnect('disconnectCta')}</Button>
                        </div>
                      </div>
                    )}

                    {status.state === 'connecting' && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {tConnect('connecting')}</div>
                    )}

                    <div className="pt-2 border-t flex justify-end">
                      <Button variant="destructive" size="sm" onClick={disableFeature}>{tActive('disableCta')}</Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {!isAdmin && status.state === 'connected' && status.connectedPhone && (
                <Card>
                  <CardHeader>
                    <CardTitle>{tConnect('title')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 text-green-700">
                      <CheckCircle2 className="size-5" />
                      <span>{tConnect('connectedAs')}</span>
                      <Ltr as="strong" className="font-mono">{status.connectedPhone}</Ltr>
                    </div>
                  </CardContent>
                </Card>
              )}

              {isAdmin && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Ban className="size-5" /> {tBlocklist('title')}</CardTitle>
                    <CardDescription>{tBlocklist('description')}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-2 items-end">
                      <div className="flex-1 min-w-[180px]">
                        <label className="text-xs text-muted-foreground">{tBlocklist('phoneLabel')}</label>
                        <Input
                          value={blockPhone}
                          onChange={(e) => setBlockPhone(e.target.value)}
                          placeholder={tBlocklist('phonePlaceholder', { dialCode: dialCode || '+CC' })}
                          inputMode="tel"
                          dir="ltr"
                        />
                      </div>
                      <div className="flex-1 min-w-[180px]">
                        <label className="text-xs text-muted-foreground">{tBlocklist('reasonLabel')}</label>
                        <Input value={blockReason} onChange={(e) => setBlockReason(e.target.value)} placeholder={tBlocklist('reasonPlaceholder')} />
                      </div>
                      <Button onClick={addBlock}>{tBlocklist('addCta')}</Button>
                    </div>
                    {blocklist.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{tBlocklist('empty')}</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{tBlocklist('colPhone')}</TableHead>
                            <TableHead>{tBlocklist('colReason')}</TableHead>
                            <TableHead>{tBlocklist('colWhen')}</TableHead>
                            <TableHead></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {blocklist.map((b) => (
                            <TableRow key={b.phone_e164}>
                              <TableCell className="font-mono text-sm"><Ltr>{b.phone_e164}</Ltr></TableCell>
                              <TableCell className="text-sm text-muted-foreground">{b.reason ?? '—'}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{fmt(b.blocked_at)}</TableCell>
                              <TableCell><Button size="sm" variant="ghost" onClick={() => removeBlock(b.phone_e164)}>{tBlocklist('removeCta')}</Button></TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="sent" className="space-y-2">
          <Card>
            <CardHeader>
              <CardTitle>{tSent('title')}</CardTitle>
              <CardDescription>{tSent('description')}</CardDescription>
            </CardHeader>
            <CardContent>
              {sentMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center text-sm text-muted-foreground">
                  <Send className="size-8 mb-2 opacity-40" />
                  <p className="font-medium text-foreground">{tSent('empty')}</p>
                  <p className="mt-1 max-w-sm">{tSent('emptyHint')}</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tSent('colWhen')}</TableHead>
                      <TableHead>{tSent('colPhone')}</TableHead>
                      <TableHead>{tSent('colKind')}</TableHead>
                      <TableHead>{tSent('colStatus')}</TableHead>
                      <TableHead>{tSent('colBody')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sentMessages.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(m.queued_at)}</TableCell>
                        <TableCell className="font-mono text-xs">
                          <button
                            type="button"
                            onClick={() => copyToClipboard(m.phone_e164, m.phone_e164)}
                            className="hover:text-foreground transition-colors cursor-pointer"
                            title={tInbox('copyPhone')}
                          >
                            <Ltr>{m.phone_e164}</Ltr>
                          </button>
                        </TableCell>
                        <TableCell className="text-xs">{tKind(WHATSAPP_KIND_KEYS[m.kind])}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <StatusStepper status={m.status} />
                            {m.error && <div className="text-xs text-destructive">{m.error}</div>}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm max-w-md">
                          <div className="line-clamp-3 whitespace-pre-line break-words">{m.body}</div>
                          <details className="text-xs text-muted-foreground mt-1">
                            <summary>{tSent('timeline')}</summary>
                            <div>{tSent('timelineQueued', { time: fmt(m.queued_at) })}</div>
                            {m.typing_at && <div>{tSent('timelineTyping', { time: fmt(m.typing_at) })}</div>}
                            {m.sent_at && <div>{tSent('timelineSent', { time: fmt(m.sent_at) })}</div>}
                            {m.delivered_at && <div>{tSent('timelineDelivered', { time: fmt(m.delivered_at) })}</div>}
                            {m.read_at && <div>{tSent('timelineRead', { time: fmt(m.read_at) })}</div>}
                            {m.failed_at && <div>{tSent('timelineFailed', { time: fmt(m.failed_at) })}</div>}
                          </details>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="inbox" className="space-y-2">
            <Card>
              <CardHeader>
                <CardTitle>{tInbox('title')}</CardTitle>
                <CardDescription>{tInbox('description')}</CardDescription>
              </CardHeader>
              <CardContent>
                {inbox.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center text-sm text-muted-foreground">
                    <Inbox className="size-8 mb-2 opacity-40" />
                    <p className="font-medium text-foreground">{tInbox('empty')}</p>
                    <p className="mt-1 max-w-sm">{tInbox('emptyHint')}</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tSent('colWhen')}</TableHead>
                        <TableHead>{tSent('colPhone')}</TableHead>
                        <TableHead>{tSent('colBody')}</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {inbox.map((m) => {
                        const isBlocked = blocklist.some((b) => b.phone_e164 === m.phone_e164);
                        return (
                          <TableRow key={m.id}>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmt(m.queued_at)}</TableCell>
                            <TableCell className="font-mono text-xs">
                              <button
                                type="button"
                                onClick={() => copyToClipboard(m.phone_e164, m.phone_e164)}
                                className="inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
                                title={tInbox('copyPhone')}
                              >
                                <Copy className="size-3 opacity-0 group-hover:opacity-100" />
                                <Ltr>{m.phone_e164}</Ltr>
                              </button>
                            </TableCell>
                            <TableCell className="text-sm whitespace-pre-line break-words max-w-md">{m.body}</TableCell>
                            <TableCell>
                              {isBlocked ? (
                                <Badge variant="secondary">{tInbox('blocked')}</Badge>
                              ) : (
                                <Button size="sm" variant="outline" onClick={() => blockFromInbox(m.phone_e164)}>
                                  <Ban className="size-3" /> {tInbox('blockCta')}
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="winback" className="space-y-6">
          {/* Automation Controls */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Receipt className="size-4 text-brand" />
                  Automated Checkout Receipts
                </CardTitle>
                <CardDescription className="text-xs">
                  Instantly dispatch an itemized WhatsApp receipt to the customer upon payment completion.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-xs">
                <label className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoReceiptEnabled}
                    onChange={(e) => setAutoReceiptEnabled(e.target.checked)}
                    className="size-4 accent-brand rounded"
                  />
                  <div>
                    <span className="font-semibold text-foreground block">Auto-Send WhatsApp Receipt</span>
                    <span className="text-muted-foreground text-[11px]">Sends branded receipt + loyalty stamp progress on order checkout</span>
                  </div>
                </label>
                <div className="flex justify-end">
                  <Button size="sm" onClick={handleSaveWinbackSettings} disabled={savingWinbackSettings} className="text-xs">
                    {savingWinbackSettings ? 'Saving...' : 'Save Receipt Setting'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="size-4 text-purple-500" />
                  14-Day Inactive Customer Win-Back
                </CardTitle>
                <CardDescription className="text-xs">
                  Automatically engage lapsed customers with an exclusive win-back voucher.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-medium text-foreground">Inactive Days Threshold</label>
                    <Input
                      type="number"
                      min={7}
                      max={90}
                      value={inactiveDays}
                      onChange={(e) => setInactiveDays(parseInt(e.target.value) || 14)}
                      className="mt-1 h-8 text-xs"
                    />
                  </div>
                  <div>
                    <label className="font-medium text-foreground">Discount Percent (%)</label>
                    <Input
                      type="number"
                      min={5}
                      max={50}
                      value={discountPct}
                      onChange={(e) => setDiscountPct(parseFloat(e.target.value) || 15)}
                      className="mt-1 h-8 text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="font-medium text-foreground">Message Template</label>
                  <textarea
                    rows={2}
                    value={winbackTemplate}
                    onChange={(e) => setWinbackTemplate(e.target.value)}
                    placeholder="Hi {name}! We miss seeing you at {store}. Enjoy {discount}% OFF with code {code}!"
                    className="w-full mt-1 p-2 bg-background border border-border rounded text-xs"
                  />
                  <span className="text-[10px] text-muted-foreground">Variables: &#123;name&#125;, &#123;store&#125;, &#123;discount&#125;, &#123;code&#125;</span>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <Button size="sm" onClick={handleSaveWinbackSettings} disabled={savingWinbackSettings} className="text-xs">
                    {savingWinbackSettings ? 'Saving...' : 'Save Win-Back Settings'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Inactive Candidates & 1-Click Dispatch */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-base">Inactive Customers Preview ({candidates.length})</CardTitle>
                <CardDescription className="text-xs">
                  Customers with no visits in &gt;= {inactiveDays} days who haven&apos;t received a voucher in 30 days.
                </CardDescription>
              </div>
              <Button
                size="sm"
                variant="default"
                onClick={handleRunWinbackCampaign}
                disabled={dispatchingWinback || candidates.length === 0}
                className="text-xs bg-purple-600 hover:bg-purple-700 text-white"
              >
                <Gift className="size-3.5 me-1.5" />
                {dispatchingWinback ? 'Dispatching...' : `Dispatch Win-Back Campaign (${candidates.length})`}
              </Button>
            </CardHeader>
            <CardContent>
              {loadingWinback ? (
                <div className="py-8 text-center text-xs text-muted-foreground">Loading candidates...</div>
              ) : candidates.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">No inactive customers eligible right now! Great job on retention.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Last Order</TableHead>
                      <TableHead className="text-end">Days Inactive</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {candidates.slice(0, 10).map((cand) => (
                      <TableRow key={cand.id}>
                        <TableCell className="font-semibold text-xs">{cand.name || 'Valued Guest'}</TableCell>
                        <TableCell className="font-mono text-xs">{cand.phone}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmt(cand.last_order_at)}</TableCell>
                        <TableCell className="text-end font-bold text-rose-500 text-xs">{cand.days_inactive} days</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Sent Win-Back Vouchers History */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Win-Back Vouchers Issued ({vouchers.length})</CardTitle>
              <CardDescription className="text-xs">
                Live track voucher dispatch, redemption rate, and expiry.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {vouchers.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">No win-back vouchers issued yet.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Voucher Code</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Discount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Sent At</TableHead>
                      <TableHead>Expires</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vouchers.slice(0, 15).map((v) => (
                      <TableRow key={v.id}>
                        <TableCell className="font-mono font-bold text-xs text-purple-600 dark:text-purple-400">{v.voucher_code}</TableCell>
                        <TableCell className="text-xs">{v.customer_name || v.customer_phone}</TableCell>
                        <TableCell className="text-xs font-semibold">{v.discount_pct}% OFF</TableCell>
                        <TableCell>
                          <Badge variant={v.status === 'redeemed' ? 'secondary' : v.status === 'expired' ? 'destructive' : 'outline'} className="text-[10px] uppercase">
                            {v.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmt(v.sent_at)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmt(v.expires_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {status?.lastError && status.state !== 'cooldown' && (
        <div className="text-sm text-red-600 flex items-center gap-1">
          <XCircle className="size-4" /> {translateLastError(status.lastErrorReason, status.lastError, tLastError)}
        </div>
      )}
      </div>
    </>
  );
}
