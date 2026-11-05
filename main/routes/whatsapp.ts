import { Router, Request, Response } from 'express';
import { requirePermission } from '../services/authorization';
import { asyncHandler } from '../middleware/async-handler';
import { getDatabase, getSettingValue, upsertSettings } from '../db';
import { getHttpRequestSignal, trackHttpRequestWork } from '../shutdown';
import * as whatsapp from '../services/whatsapp';
import * as QRCode from 'qrcode';
import { parsePhoneE164 } from '../lib/phone';

const router = Router();

function parsePaginationParam(value: unknown, fallback: number, max?: number): number | null {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || (max !== undefined && parsed > max)) return null;
  return parsed;
}

router.get('/status', requirePermission('whatsapp.use'), (_req: Request, res: Response) => {
  const s = whatsapp.getStatus();
  // Don't expose the raw QR string via /status; the QR endpoint returns a rendered image.
  res.json({
    ...s,
    qr: undefined,
    pairingCode: undefined,
    // Default ON when the row hasn't been seeded yet (existing installs that
    // were already at v29 before whatsapp_filter_groups was added).
    filterGroups: getSettingValue('whatsapp_filter_groups') !== 'false',
  });
});

router.post('/settings', requirePermission('whatsapp.manage'), (req: Request, res: Response) => {
  const next = (req.body as { filterGroups?: boolean } | undefined)?.filterGroups;
  if (typeof next !== 'boolean') {
    res.status(400).json({ error: 'filterGroups must be a boolean' });
    return;
  }
  upsertSettings({ whatsapp_filter_groups: next ? 'true' : 'false' });
  res.json({ ok: true, filterGroups: next });
});

router.get('/qr', requirePermission('whatsapp.manage'), asyncHandler(async (_req, res) => {
  const status = whatsapp.getStatus();
  if (!status.qr) {
    res.status(404).json({ error: 'no QR available', reason: 'no_qr' });
    return;
  }
  const dataUrl = await QRCode.toDataURL(status.qr, { margin: 1, width: 320 });
  res.json({ dataUrl });
}));

router.get('/pairing-code', requirePermission('whatsapp.manage'), (_req: Request, res: Response) => {
  const status = whatsapp.getStatus();
  if (!status.pairingCode) {
    res.status(404).json({ error: 'no pairing code available', reason: 'no_pairing_code' });
    return;
  }
  res.json({ code: status.pairingCode });
});

router.post('/enable', requirePermission('whatsapp.manage'), asyncHandler(async (req, res) => {
  const userId = (req as any).user?.userId ?? null;
  const result = await whatsapp.enable(userId ?? 'unknown');
  res.json(result);
}));

router.post('/disable', requirePermission('whatsapp.manage'), (_req: Request, res: Response) => {
  whatsapp.disable();
  res.json({ ok: true });
});

router.post('/connect', requirePermission('whatsapp.manage'), asyncHandler(async (req, res) => {
  const { method, phone } = req.body ?? {};
  if (method === 'qr') {
    res.json(await trackHttpRequestWork(req, whatsapp.connectWithQr(getHttpRequestSignal(req))));
  } else if (method === 'pairing_code') {
    if (!phone) {
      res.status(400).json({ error: 'phone required for pairing code', reason: 'phone_required_pairing' });
      return;
    }
    const tenantCountry = getSettingValue('country') || '';
    const parsedPhone = parsePhoneE164(String(phone), tenantCountry);
    if (!parsedPhone) {
      res.status(400).json({ error: 'Valid phone number required for pairing code', reason: 'invalid_phone' });
      return;
    }
    res.json(await trackHttpRequestWork(req, whatsapp.connectWithPairingCode(parsedPhone.e164, getHttpRequestSignal(req))));
  } else {
    res.status(400).json({ error: 'method must be "qr" or "pairing_code"', reason: 'bad_connect_method' });
  }
}));

router.post('/disconnect', requirePermission('whatsapp.manage'), (_req: Request, res: Response) => {
  whatsapp.disconnect();
  res.json({ ok: true });
});

router.post('/send', requirePermission('whatsapp.use'), asyncHandler(async (req, res) => {
  const { bill_id, phone_e164, body, kind } = req.body ?? {};
  if (!phone_e164) {
    res.status(400).json({ error: 'phone_e164 required', reason: 'phone_required' });
    return;
  }
  const tenantCountry = getSettingValue('country') || '';
  const parsedPhone = parsePhoneE164(String(phone_e164), tenantCountry);
  if (!parsedPhone) {
    res.status(400).json({ error: 'Valid phone_e164 required', reason: 'invalid_phone' });
    return;
  }
  if (!body || typeof body !== 'string') {
    res.status(400).json({ error: 'body required', reason: 'body_required' });
    return;
  }
  const userId = (req as any).user?.userId ?? null;
  const result = await trackHttpRequestWork(req, whatsapp.sendMessage({
    phoneE164: parsedPhone.e164,
    body: String(body),
    billId: bill_id != null ? Number(bill_id) : null,
    customerId: null,
    kind: (kind as any) || 'manual_reply',
    userId,
    signal: getHttpRequestSignal(req),
  }));
  if (!result.ok) {
    const status = result.reason === 'not_connected' || result.reason === 'cooldown' ? 503 : 400;
    res.status(status).json({ error: result.error, reason: result.reason });
    return;
  }
  res.json({ ok: true, messageId: result.messageId });
}));

router.get('/messages', requirePermission('whatsapp.use'), (req: Request, res: Response) => {
  const limitValue = parsePaginationParam(req.query.limit, 50, 200);
  const offset = parsePaginationParam(req.query.offset, 0);
  if (limitValue === null || limitValue < 1) {
    return res.status(400).json({ error: 'limit must be an integer between 1 and 200' });
  }
  if (offset === null) {
    return res.status(400).json({ error: 'offset must be a non-negative integer' });
  }
  const limit = limitValue;
  const direction = req.query.direction === 'inbound' || req.query.direction === 'outbound' ? req.query.direction : undefined;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const phone = typeof req.query.phone === 'string' ? req.query.phone : undefined;
  const billId = req.query.bill_id != null ? parsePaginationParam(req.query.bill_id, 0) : undefined;
  if (billId === null) {
    return res.status(400).json({ error: 'bill_id must be a non-negative integer' });
  }
  res.json({ messages: whatsapp.listMessages({ direction, status, phone, billId, limit, offset }) });
});

router.get('/inbox', requirePermission('whatsapp.manage'), (req: Request, res: Response) => {
  const limitValue = parsePaginationParam(req.query.limit, 50, 200);
  const offset = parsePaginationParam(req.query.offset, 0);
  if (limitValue === null || limitValue < 1) {
    return res.status(400).json({ error: 'limit must be an integer between 1 and 200' });
  }
  if (offset === null) {
    return res.status(400).json({ error: 'offset must be a non-negative integer' });
  }
  const limit = limitValue;
  res.json({ messages: whatsapp.listInbox(limit, offset) });
});

router.post('/inbox/:messageId/reply', requirePermission('whatsapp.manage'), asyncHandler(async (req, res) => {
  const { body } = req.body ?? {};
  if (!body || typeof body !== 'string') {
    res.status(400).json({ error: 'body required', reason: 'body_required' });
    return;
  }
  const db = getDatabase();
  const msg = db.prepare('SELECT phone_e164 FROM whatsapp_messages WHERE id = ? AND direction = ?')
    .get(Number(req.params.messageId), 'inbound') as { phone_e164: string } | undefined;
  if (!msg) {
    res.status(404).json({ error: 'inbound message not found', reason: 'inbound_not_found' });
    return;
  }
  const userId = (req as any).user?.userId ?? null;
  const result = await trackHttpRequestWork(req, whatsapp.sendMessage({
    phoneE164: msg.phone_e164,
    body: String(body),
    billId: null,
    customerId: null,
    kind: 'manual_reply',
    userId,
    signal: getHttpRequestSignal(req),
  }));
  if (!result.ok) {
    const status = result.reason === 'not_connected' || result.reason === 'cooldown' ? 503 : 400;
    res.status(status).json({ error: result.error, reason: result.reason });
    return;
  }
  res.json({ ok: true, messageId: result.messageId });
}));

router.get('/blocklist', requirePermission('whatsapp.manage'), (_req: Request, res: Response) => {
  res.json({ blocklist: whatsapp.listBlocklist() });
});

router.post('/blocklist', requirePermission('whatsapp.manage'), (req: Request, res: Response) => {
  const { phone_e164, reason } = req.body ?? {};
  const tenantCountry = getSettingValue('country') || '';
  const parsed = parsePhoneE164(String(phone_e164 || ''), tenantCountry);
  if (!parsed) {
    res.status(400).json({ error: 'Valid phone_e164 required', reason: 'invalid_phone' });
    return;
  }
  const userId = (req as any).user?.userId ?? null;
  whatsapp.addToBlocklist(parsed.e164, String(reason ?? ''), userId ?? 'unknown');
  res.json({ ok: true });
});

router.delete('/blocklist/:phone', requirePermission('whatsapp.manage'), (req: Request, res: Response) => {
  const removed = whatsapp.removeFromBlocklist(String(req.params.phone));
  if (!removed) {
    res.status(404).json({ error: 'phone not in blocklist', reason: 'phone_not_in_blocklist' });
    return;
  }
  res.json({ ok: true });
});

// ==========================================
// 14-Day Win-Back & Auto-Receipt Automation
// ==========================================
router.get('/winback/candidates', requirePermission('whatsapp.use'), (_req: Request, res: Response) => {
  try {
    const { findWinBackCandidates } = require('../services/whatsapp-winback');
    const inactiveDays = _req.query.inactive_days ? Number(_req.query.inactive_days) : undefined;
    const candidates = findWinBackCandidates(inactiveDays);
    res.json({ success: true, count: candidates.length, candidates });
  } catch (error: any) {
    console.error('[WhatsApp] Error listing winback candidates:', error);
    res.status(500).json({ error: error.message || 'Failed to list winback candidates' });
  }
});

router.get('/winback/vouchers', requirePermission('whatsapp.use'), (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const vouchers = db.prepare(`
      SELECT * FROM customer_winback_vouchers ORDER BY sent_at DESC LIMIT ?
    `).all(limit) as any[];
    res.json({ success: true, count: vouchers.length, vouchers });
  } catch (error: any) {
    console.error('[WhatsApp] Error listing winback vouchers:', error);
    res.status(500).json({ error: error.message || 'Failed to list winback vouchers' });
  }
});

router.post('/winback/run', requirePermission('whatsapp.manage'), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { runWinBackCampaign } = require('../services/whatsapp-winback');
    const { inactive_days, discount_pct } = req.body || {};
    const result = await runWinBackCampaign({
      inactiveDays: inactive_days !== undefined ? Number(inactive_days) : undefined,
      discountPct: discount_pct !== undefined ? Number(discount_pct) : undefined,
    });
    res.json({ success: true, ...result });
  } catch (error: any) {
    console.error('[WhatsApp] Error executing winback campaign:', error);
    res.status(500).json({ error: error.message || 'Failed to execute winback campaign' });
  }
}));

router.put('/winback/settings', requirePermission('whatsapp.manage'), (req: Request, res: Response) => {
  try {
    const {
      auto_receipt_enabled,
      winback_enabled,
      inactive_days,
      discount_pct,
      template,
    } = req.body || {};

    const updates: Record<string, string> = {};
    if (auto_receipt_enabled !== undefined) {
      updates.whatsapp_auto_receipt_enabled = auto_receipt_enabled ? 'true' : 'false';
    }
    if (winback_enabled !== undefined) {
      updates.whatsapp_winback_enabled = winback_enabled ? 'true' : 'false';
    }
    if (inactive_days !== undefined) {
      updates.whatsapp_winback_inactive_days = String(inactive_days);
    }
    if (discount_pct !== undefined) {
      updates.whatsapp_winback_discount_pct = String(discount_pct);
    }
    if (template !== undefined) {
      updates.whatsapp_winback_template = String(template);
    }

    upsertSettings(updates);
    res.json({ success: true, settings: updates });
  } catch (error: any) {
    console.error('[WhatsApp] Error updating winback settings:', error);
    res.status(500).json({ error: error.message || 'Failed to update winback settings' });
  }
});

router.post('/winback/redeem', requirePermission('orders.create'), (req: Request, res: Response) => {
  try {
    const { code, order_id } = req.body || {};
    if (!code) {
      return res.status(400).json({ error: 'Voucher code is required' });
    }
    const { redeemWinBackVoucher } = require('../services/whatsapp-winback');
    const result = redeemWinBackVoucher(code, order_id);
    if (!result.valid) {
      return res.status(400).json({ error: result.error || 'Invalid or expired voucher' });
    }
    res.json({ success: true, ...result });
  } catch (error: any) {
    console.error('[WhatsApp] Error redeeming winback voucher:', error);
    res.status(500).json({ error: error.message || 'Failed to redeem voucher' });
  }
});

export const whatsappRoutes = router;
