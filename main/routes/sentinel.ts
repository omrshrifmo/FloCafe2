import { Router, Request, Response, NextFunction } from 'express';
import os from 'os';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { exec, execSync, spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';
import { getDatabase } from '../db';
import {
  verifyHardwareLicense,
  activateWithKeyFile,
  revokeLicense,
  getHardwareFingerprint,
  verifyOwnerCredentials,
  getAutoRenewPolicy,
  setAutoRenewPolicy,
  AutoRenewPolicy,
  OWNER_MASTER_PUBLIC_KEY,
} from '../services/hardware-license';

export const sentinelRoutes = Router();

sentinelRoutes.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-owner-password, x-owner-master-key');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

// Fallback DB instance for standalone daemon mode (:3009)
let activeSentinelDb: any = null;

export function setSentinelDb(dbInstance: any): void {
  activeSentinelDb = dbInstance;
}

export function resolveSentinelDbPath(): string {
  if (process.env.FLO_DB_PATH && fs.existsSync(process.env.FLO_DB_PATH)) {
    return process.env.FLO_DB_PATH;
  }

  const cwdDb = path.join(process.cwd(), 'flo.db');
  if (fs.existsSync(cwdDb)) return cwdDb;

  const platform = os.platform();
  const candidates: string[] = [];
  if (platform === 'win32') {
    candidates.push(path.join(process.env.APPDATA || '', 'flo-desktop', 'flo.db'));
    candidates.push(path.join(process.env.LOCALAPPDATA || '', 'flo-desktop', 'flo.db'));
  } else if (platform === 'darwin') {
    candidates.push(path.join(os.homedir(), 'Library', 'Application Support', 'flo-desktop', 'flo.db'));
  } else {
    candidates.push(path.join(os.homedir(), '.config', 'flo-desktop', 'flo.db'));
  }
  candidates.push(path.resolve(__dirname, '../../flo.db'));
  candidates.push(path.resolve(__dirname, '../../../flo.db'));

  for (const cand of candidates) {
    if (cand && fs.existsSync(cand)) return cand;
  }

  return cwdDb;
}

export function getDatabaseSafe(): any {
  try {
    return getDatabase();
  } catch {
    if (activeSentinelDb) return activeSentinelDb;
    const dbPath = resolveSentinelDbPath();
    const Database = require('better-sqlite3');
    activeSentinelDb = new Database(dbPath);
    return activeSentinelDb;
  }
}

// Zero-Cost Tunnel State
let activeTunnelProcess: ChildProcess | null = null;
let activeTunnelUrl: string | null = null;
let activeTunnelProvider: string | null = null;
let autoReconnectTunnel = false;

export function getActiveTunnelUrl(): string | null {
  return activeTunnelUrl;
}

export function setActiveTunnelUrl(url: string | null): void {
  activeTunnelUrl = url;
}

export function stopTunnel(): boolean {
  autoReconnectTunnel = false;
  if (activeTunnelProcess) {
    try {
      activeTunnelProcess.kill('SIGTERM');
    } catch {}
    activeTunnelProcess = null;
  }
  activeTunnelUrl = null;
  activeTunnelProvider = null;
  return true;
}

export async function startTunnel(provider = 'auto', port = Number(process.env.SENTINEL_PORT || 3009)): Promise<{ url: string | null; provider: string }> {
  stopTunnel();
  autoReconnectTunnel = true;

  let chosenProvider = provider;
  if (chosenProvider === 'auto') {
    let hasCloudflared = false;
    try {
      const probeCmd = process.platform === 'win32' ? 'where cloudflared' : 'which cloudflared';
      execSync(probeCmd, { stdio: 'ignore' });
      hasCloudflared = true;
    } catch {}
    chosenProvider = hasCloudflared ? 'cloudflared' : 'localhost.run';
  }

  activeTunnelProvider = chosenProvider;

  return new Promise((resolve) => {
    let resolved = false;
    const finish = (url: string | null) => {
      if (!resolved) {
        resolved = true;
        activeTunnelUrl = url;
        if (url) {
          void publishFleetBeacon();
        }
        resolve({ url, provider: chosenProvider });
      }
    };

    const timeout = setTimeout(() => {
      finish(activeTunnelUrl);
    }, 12000);

    try {
      if (chosenProvider === 'cloudflared') {
        const proc = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${port}`], {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
        activeTunnelProcess = proc;

        const onData = (data: Buffer) => {
          const text = data.toString('utf8');
          const match = text.match(/https:\/\/[a-zA-Z0-9.-]+\.trycloudflare\.com/i);
          if (match) {
            clearTimeout(timeout);
            finish(match[0]);
          }
        };

        proc.stdout?.on('data', onData);
        proc.stderr?.on('data', onData);
        proc.on('close', () => {
          if (activeTunnelProcess === proc) {
            activeTunnelProcess = null;
            activeTunnelUrl = null;
            if (autoReconnectTunnel && process.env.NODE_ENV !== 'test') {
              setTimeout(() => {
                if (autoReconnectTunnel) void startTunnel(chosenProvider, port);
              }, 10000);
            }
          }
          finish(null);
        });
      } else {
        // Built-in OpenSSH localhost.run tunnel (works on Win 10/11 & Linux out-of-the-box, no account)
        const sshArgs = [
          '-o', 'StrictHostKeyChecking=no',
          '-o', 'UserKnownHostsFile=/dev/null',
          '-o', 'ServerAliveInterval=30',
          '-R', `80:127.0.0.1:${port}`,
          'nokey@localhost.run',
        ];
        const proc = spawn('ssh', sshArgs, {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
        activeTunnelProcess = proc;

        const onData = (data: Buffer) => {
          const text = data.toString('utf8');
          const match = text.match(/https:\/\/[a-zA-Z0-9.-]+(\.localhost\.run|\.lhr\.life|\.lhr\.rocks)/i);
          if (match) {
            clearTimeout(timeout);
            finish(match[0]);
          }
        };

        proc.stdout?.on('data', onData);
        proc.stderr?.on('data', onData);
        proc.on('close', () => {
          if (activeTunnelProcess === proc) {
            activeTunnelProcess = null;
            activeTunnelUrl = null;
            if (autoReconnectTunnel && process.env.NODE_ENV !== 'test') {
              setTimeout(() => {
                if (autoReconnectTunnel) void startTunnel(chosenProvider, port);
              }, 10000);
            }
          }
          finish(null);
        });
      }
    } catch (err: any) {
      clearTimeout(timeout);
      finish(null);
    }
  });
}

// ── Zero-Cost Encrypted Rendezvous Beacon (ntfy.sh pub/sub) ───────────────────

export function getFleetRendezvousTopic(): string {
  return 'flocafe_sov_' + crypto.createHash('sha256').update(OWNER_MASTER_PUBLIC_KEY.trim()).digest('hex').slice(0, 20);
}

function getFleetEncryptionKey(): Buffer {
  return crypto.createHash('sha256').update('flocafe-sovereign-v4:' + OWNER_MASTER_PUBLIC_KEY.trim()).digest();
}

export function encryptFleetBeacon(payload: any): string {
  const key = getFleetEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('hex'),
  });
}

export function decryptFleetBeacon(encryptedStr: string | any): any {
  try {
    const key = getFleetEncryptionKey();
    const parsed = typeof encryptedStr === 'string' ? JSON.parse(encryptedStr) : encryptedStr;
    if (!parsed || !parsed.iv || !parsed.tag || !parsed.data) return null;
    const iv = Buffer.from(parsed.iv, 'hex');
    const tag = Buffer.from(parsed.tag, 'hex');
    const data = Buffer.from(parsed.data, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    return JSON.parse(decrypted);
  } catch {
    return null;
  }
}

export async function publishFleetBeacon(customPayload?: any): Promise<void> {
  if (process.env.NODE_ENV === 'test' && !process.env.TEST_RENDEZVOUS_FORCE) return;
  try {
    const db = getDatabaseSafe();
    const license = verifyHardwareLicense(db);
    const hwid = getHardwareFingerprint();
    const net = getNetworkInfo();
    let version = '4.4.1';
    try {
      const pkgPath = path.resolve(__dirname, '../../package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.version) version = pkg.version;
      }
    } catch {}

    const payload = customPayload || {
      hwid,
      node_name: os.hostname(),
      os_platform: os.platform(),
      flocafe_version: version,
      flocafe_running: true,
      license_tier: license.tier || 'unactivated',
      license_valid: Boolean(license.valid),
      license_expires_at: license.expires_at || null,
      lan_ips: net.lanIps,
      p2p_ips: net.p2pDetails?.map((d: any) => d.ip) || (net.p2pIp ? [net.p2pIp] : []),
      tunnel_url: activeTunnelUrl,
      sentinel_port: 3009,
      timestamp: Date.now(),
    };

    const encryptedBeacon = encryptFleetBeacon(payload);
    const topic = getFleetRendezvousTopic();
    const url = `https://ntfy.sh/${topic}`;

    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Title': 'FloCafe Beacon',
        'Priority': 'low',
      },
      timeout: 5000,
    });
    req.on('error', () => {});
    req.on('timeout', () => { req.destroy(); });
    req.write(encryptedBeacon);
    req.end();
  } catch {}
}

export async function discoverFleetNodes(): Promise<any[]> {
  const topic = getFleetRendezvousTopic();
  const url = `https://ntfy.sh/${topic}/json?poll=1&since=24h`;

  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const lines = data.split('\n').filter(Boolean);
          const nodesByHwid: Record<string, any> = {};

          for (const line of lines) {
            try {
              const msg = JSON.parse(line);
              if (msg.event === 'message' && msg.message) {
                const decrypted = decryptFleetBeacon(msg.message);
                if (decrypted && decrypted.hwid) {
                  const existing = nodesByHwid[decrypted.hwid];
                  if (!existing || (decrypted.timestamp && decrypted.timestamp > (existing.timestamp || 0))) {
                    nodesByHwid[decrypted.hwid] = decrypted;
                  }
                }
              }
            } catch {}
          }

          resolve(Object.values(nodesByHwid));
        } catch {
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

export function getNetworkInfo() {
  const interfaces = os.networkInterfaces();
  const lanIps: string[] = [];
  let p2pIp: string | null = null;
  const p2pDetails: Array<{ name: string; ip: string; type: string }> = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if ((addr.family === 'IPv4' || (addr as unknown as { family: number }).family === 4) && !addr.internal) {
        const ip = addr.address;
        const isTailscale = name.toLowerCase().includes('tailscale') || ip.startsWith('100.');
        const isZeroTier = name.toLowerCase().startsWith('zt');
        const isWireguard = name.toLowerCase().startsWith('wg');

        if (isTailscale || isZeroTier || isWireguard) {
          const type = isTailscale ? 'tailscale' : isZeroTier ? 'zerotier' : 'wireguard';
          p2pDetails.push({ name, ip, type });
          if (!p2pIp) p2pIp = ip;
        } else {
          lanIps.push(ip);
        }
      }
    }
  }

  return { lanIps, p2pIp, p2pDetails };
}

/**
 * Middleware: Enforces cryptographic Zero-Trust Owner Authentication.
 */
export function requireOwnerAuth(req: Request, res: Response, next: NextFunction): void {
  const reactivationPassword =
    (req.headers['x-owner-password'] as string) ||
    req.body?.reactivationPassword ||
    (req.query?.reactivationPassword as string);

  let ownerMasterKeyContent =
    (req.headers['x-owner-master-key'] as string) ||
    req.body?.ownerMasterKeyContent ||
    req.body?.owner_master_key ||
    (req.query?.ownerMasterKeyContent as string);

  if (typeof ownerMasterKeyContent === 'string') {
    if (!ownerMasterKeyContent.trim().startsWith('{')) {
      try {
        const decoded = Buffer.from(ownerMasterKeyContent, 'base64').toString('utf8');
        if (decoded.trim().startsWith('{')) {
          ownerMasterKeyContent = decoded;
        }
      } catch {}
    }
    if (ownerMasterKeyContent.trim().startsWith('{')) {
      try {
        ownerMasterKeyContent = JSON.parse(ownerMasterKeyContent);
      } catch {}
    }
  }

  const ownerSignature =
    (req.headers['x-owner-signature'] as string) ||
    req.body?.ownerSignature ||
    req.body?.owner_signature;

  const ownerChallenge =
    (req.headers['x-owner-challenge'] as string) ||
    req.body?.ownerChallenge ||
    req.body?.owner_challenge;

  const auth = verifyOwnerCredentials({
    reactivationPassword,
    ownerMasterKeyContent,
    ownerSignature,
    ownerChallenge,
  });

  if (!auth.success) {
    res.status(403).json({
      error: 'FORBIDDEN_OWNER_AUTH_REQUIRED',
      message: auth.error || 'Cryptographic Owner authentication required.',
    });
    return;
  }

  next();
}

// 1. GET /api/sentinel/ping - Public discovery beacon
sentinelRoutes.get('/ping', async (req: Request, res: Response) => {
  try {
    const db = getDatabaseSafe();
    const license = verifyHardwareLicense(db);
    const hwid = getHardwareFingerprint();
    const net = getNetworkInfo();

    let version = '4.3.0';
    try {
      const pkgPath = path.resolve(__dirname, '../../package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.version) version = pkg.version;
      }
    } catch {}

    // Check if FloCafe GUI / backend is active
    let flocafeRunning = false;
    const currentPort = (req.socket as any)?.localPort;
    if (currentPort && currentPort !== 3009) {
      flocafeRunning = true;
    } else {
      try {
        const pingTest = await new Promise<boolean>((resolve) => {
          const r = http.get('http://127.0.0.1:3001/api/health', { timeout: 800 }, (resp) => {
            resolve(resp.statusCode === 200 || resp.statusCode === 401 || resp.statusCode === 402);
          });
          r.on('error', () => resolve(false));
          r.on('timeout', () => { r.destroy(); resolve(false); });
        });
        flocafeRunning = pingTest;
      } catch {}
    }

    res.json({
      status: 'ok',
      node_name: os.hostname(),
      hwid,
      os_platform: os.platform(),
      os_release: os.release(),
      arch: os.arch(),
      flocafe_version: version,
      flocafe_running: flocafeRunning,
      license_tier: license.tier || 'unactivated',
      license_valid: Boolean(license.valid),
      license_expires_at: license.expires_at || null,
      lan_ips: net.lanIps,
      p2p_ip: net.p2pIp,
      p2p_details: net.p2pDetails,
      tunnel_url: activeTunnelUrl,
      tunnel_provider: activeTunnelProvider,
      uptime_seconds: Math.floor(os.uptime()),
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Ping failed', details: err.message });
  }
});

// 2. GET /api/sentinel/diagnostics - OS & machine health (Owner Auth)
sentinelRoutes.get('/diagnostics', requireOwnerAuth, (_req: Request, res: Response) => {
  try {
    const db = getDatabaseSafe();
    const net = getNetworkInfo();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    let sqliteIntegrity = 'ok';
    let sqliteJournalMode = 'unknown';
    let dbFileSizeBytes = 0;
    try {
      const row = db.prepare('PRAGMA integrity_check').get() as any;
      sqliteIntegrity = row ? Object.values(row)[0] as string : 'ok';
      const jRow = db.prepare('PRAGMA journal_mode').get() as any;
      sqliteJournalMode = jRow ? Object.values(jRow)[0] as string : 'unknown';
    } catch (dbErr: any) {
      sqliteIntegrity = `error: ${dbErr.message}`;
    }

    try {
      const dbPath = (db as any).name;
      if (dbPath && fs.existsSync(dbPath)) {
        dbFileSizeBytes = fs.statSync(dbPath).size;
      }
    } catch {}

    let configuredPrinters = 0;
    try {
      const pRow = db.prepare('SELECT count(*) as count FROM printers').get() as any;
      configuredPrinters = pRow?.count || 0;
    } catch {}

    res.json({
      status: 'ok',
      timestamp: Date.now(),
      system: {
        hostname: os.hostname(),
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        cpu_cores: os.cpus().length,
        load_average: os.loadavg(),
        memory: {
          total_bytes: totalMem,
          free_bytes: freeMem,
          used_percent: Number((((totalMem - freeMem) / totalMem) * 100).toFixed(1)),
        },
        uptime_seconds: Math.floor(os.uptime()),
      },
      network: {
        lan_ips: net.lanIps,
        p2p_ip: net.p2pIp,
        p2p_details: net.p2pDetails,
      },
      tunnel: {
        url: activeTunnelUrl,
        provider: activeTunnelProvider,
        active: Boolean(activeTunnelUrl),
      },
      sqlite: {
        integrity: sqliteIntegrity,
        journal_mode: sqliteJournalMode,
        db_size_bytes: dbFileSizeBytes,
      },
      printers: {
        configured_count: configuredPrinters,
      },
      license: verifyHardwareLicense(db),
      auto_renew_policy: getAutoRenewPolicy(db),
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Diagnostics failed', details: err.message });
  }
});

// 3. GET /api/sentinel/insights - Live business analytics (Owner Auth)
sentinelRoutes.get('/insights', requireOwnerAuth, (_req: Request, res: Response) => {
  try {
    const db = getDatabaseSafe();
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    let todayRevenue = 0;
    let todayOrdersCount = 0;
    try {
      const todayRow = db.prepare(`
        SELECT COALESCE(SUM(total), 0) as rev, count(*) as cnt
        FROM orders
        WHERE date(created_at) = date('now') AND status != 'cancelled'
      `).get() as any;
      todayRevenue = Number(todayRow?.rev || 0);
      todayOrdersCount = Number(todayRow?.cnt || 0);
    } catch {}

    let monthlyRevenue = 0;
    let monthlyOrdersCount = 0;
    try {
      const mRow = db.prepare(`
        SELECT COALESCE(SUM(total), 0) as rev, count(*) as cnt
        FROM orders
        WHERE date(created_at) >= date('now', '-30 days') AND status != 'cancelled'
      `).get() as any;
      monthlyRevenue = Number(mRow?.rev || 0);
      monthlyOrdersCount = Number(mRow?.cnt || 0);
    } catch {}

    let openTablesCount = 0;
    try {
      const tRow = db.prepare(`SELECT count(*) as cnt FROM tables WHERE status = 'occupied'`).get() as any;
      openTablesCount = Number(tRow?.cnt || 0);
    } catch {}

    let activeCashSession = null;
    try {
      activeCashSession = db.prepare(`
        SELECT id, opened_at, opening_balance, expected_balance
        FROM cash_sessions
        WHERE status = 'open'
        ORDER BY id DESC LIMIT 1
      `).get() || null;
    } catch {}

    let lowStockCount = 0;
    let lowStockItems: any[] = [];
    try {
      const items = db.prepare(`
        SELECT id, name, stock_quantity, min_stock_alert
        FROM products
        WHERE track_inventory = 1 AND stock_quantity <= min_stock_alert
        LIMIT 10
      `).all() as any[];
      lowStockCount = items.length;
      lowStockItems = items;
    } catch {}

    let activeStaffCount = 0;
    try {
      const sRow = db.prepare(`SELECT count(*) as cnt FROM users WHERE is_active = 1`).get() as any;
      activeStaffCount = Number(sRow?.cnt || 0);
    } catch {}

    res.json({
      status: 'ok',
      timestamp: Date.now(),
      today: {
        date: todayStr,
        revenue: todayRevenue,
        orders_count: todayOrdersCount,
        avg_ticket: todayOrdersCount > 0 ? Number((todayRevenue / todayOrdersCount).toFixed(2)) : 0,
      },
      last_30_days: {
        revenue: monthlyRevenue,
        orders_count: monthlyOrdersCount,
      },
      operations: {
        open_tables_count: openTablesCount,
        active_cash_session: activeCashSession,
        low_stock_count: lowStockCount,
        low_stock_items: lowStockItems,
        active_staff_count: activeStaffCount,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Insights failed', details: err.message });
  }
});

// 4. POST /api/sentinel/app-control - Remote FloCafe GUI lifecycle & DB maintenance (Owner Auth)
sentinelRoutes.post('/app-control', requireOwnerAuth, (req: Request, res: Response) => {
  try {
    const { action } = req.body || {};
    const db = getDatabaseSafe();

    if (action === 'backup_db') {
      const backupDir = path.resolve(process.cwd(), 'backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      const backupPath = path.join(backupDir, `flo-checkpoint-${Date.now()}.db`);
      db.prepare('VACUUM INTO ?').run(backupPath);
      return res.json({
        success: true,
        action,
        backup_path: backupPath,
        created_at: new Date().toISOString(),
      });
    }

    if (action === 'run_safe_fixes') {
      db.prepare('PRAGMA optimize').run();
      db.prepare('PRAGMA wal_checkpoint(PASSIVE)').run();
      return res.json({
        success: true,
        action,
        message: 'Safe SQLite maintenance optimization completed.',
      });
    }

    if (action === 'start') {
      const candidates: string[] = [];
      if (process.env.FLOCAFE_GUI_EXEC_PATH) candidates.push(process.env.FLOCAFE_GUI_EXEC_PATH);
      if (process.platform === 'win32') {
        candidates.push('C:\\Program Files\\Flo Cafe\\Flo Cafe.exe');
        candidates.push(path.join(process.env.LOCALAPPDATA || '', 'Programs', 'flo-desktop', 'Flo Cafe.exe'));
        candidates.push(process.execPath);
      } else {
        candidates.push('/usr/bin/flocafe');
        candidates.push('/usr/local/bin/flocafe');
        candidates.push(process.execPath);
      }

      const validTarget = candidates.find((p) => p && fs.existsSync(p)) || process.execPath;
      const cleanEnv = { ...process.env };
      delete cleanEnv.ELECTRON_RUN_AS_NODE;

      try {
        const child = spawn(validTarget, [], {
          detached: true,
          stdio: 'ignore',
          env: cleanEnv,
        });
        child.unref();
        return res.json({
          success: true,
          action,
          message: 'FloCafe GUI launched successfully.',
          pid: child.pid,
          exec_path: validTarget,
        });
      } catch (launchErr: any) {
        return res.status(500).json({ error: `Failed to launch FloCafe GUI: ${launchErr.message}` });
      }
    }

    if (action === 'stop') {
      try {
        if (process.platform === 'win32') {
          execSync('taskkill /IM "Flo Cafe.exe" /F', { stdio: 'ignore' });
        } else {
          execSync('pkill -f "flocafe" -o', { stdio: 'ignore' });
        }
      } catch {}
      return res.json({
        success: true,
        action,
        message: 'FloCafe GUI stop command executed.',
      });
    }

    if (action === 'restart') {
      try {
        if (process.platform === 'win32') {
          execSync('taskkill /IM "Flo Cafe.exe" /F', { stdio: 'ignore' });
        } else {
          execSync('pkill -f "flocafe" -o', { stdio: 'ignore' });
        }
      } catch {}

      setTimeout(() => {
        const candidates = [
          process.env.FLOCAFE_GUI_EXEC_PATH,
          process.platform === 'win32' ? 'C:\\Program Files\\Flo Cafe\\Flo Cafe.exe' : '/usr/bin/flocafe',
          process.execPath,
        ];
        const validTarget = candidates.find((p) => p && fs.existsSync(p)) || process.execPath;
        const cleanEnv = { ...process.env };
        delete cleanEnv.ELECTRON_RUN_AS_NODE;
        try {
          const child = spawn(validTarget, [], { detached: true, stdio: 'ignore', env: cleanEnv });
          child.unref();
        } catch {}
      }, 1000);

      return res.json({
        success: true,
        action,
        message: 'FloCafe GUI restart sequence initiated.',
      });
    }

    return res.status(400).json({ error: `Unknown app-control action: ${action}` });
  } catch (err: any) {
    return res.status(500).json({ error: 'App control failed', details: err.message });
  }
});

// 5. POST /api/sentinel/sql-query - Analytical / maintenance queries (Owner Auth)
sentinelRoutes.post('/sql-query', requireOwnerAuth, (req: Request, res: Response) => {
  try {
    const { query, params } = req.body || {};
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Missing SQL query string.' });
    }

    const trimmed = query.trim();
    const db = getDatabaseSafe();

    if (/^(SELECT|PRAGMA|EXPLAIN)\b/i.test(trimmed)) {
      const stmt = db.prepare(trimmed);
      const rows = Array.isArray(params) ? stmt.all(...params) : stmt.all();
      return res.json({ success: true, rows, count: rows.length });
    }

    const stmt = db.prepare(trimmed);
    const info = Array.isArray(params) ? stmt.run(...params) : stmt.run();
    return res.json({ success: true, changes: info.changes, lastInsertRowid: info.lastInsertRowid });
  } catch (err: any) {
    return res.status(500).json({ error: 'SQL execution failed', details: err.message });
  }
});

// 6. POST /api/sentinel/exec-support - Unrestricted Owner-Authorized Remote Shell / PowerShell (Owner Auth)
sentinelRoutes.post('/exec-support', requireOwnerAuth, (req: Request, res: Response) => {
  try {
    const { command, cwd, timeoutMs } = req.body || {};
    if (!command || typeof command !== 'string') {
      return res.status(400).json({ error: 'Missing command string.' });
    }

    const start = Date.now();
    const maxTimeout = Math.min(Math.max(Number(timeoutMs) || 30000, 1000), 120000);

    const execOptions: Record<string, unknown> = {
      timeout: maxTimeout,
      maxBuffer: 10 * 1024 * 1024,
      cwd: cwd && fs.existsSync(cwd) ? cwd : process.cwd(),
    };

    if (process.platform === 'win32') {
      execOptions.shell = 'powershell.exe';
    } else {
      execOptions.shell = '/bin/bash';
    }

    exec(command, execOptions, (error, stdout, stderr) => {
      const durationMs = Date.now() - start;
      res.json({
        command,
        exitCode: error ? (error.code ?? 1) : 0,
        stdout: stdout ? stdout.toString() : '',
        stderr: stderr ? stderr.toString() : (error ? error.message : ''),
        durationMs,
      });
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Remote command execution failed', details: err.message });
  }
});

// 7. POST /api/sentinel/self-update - Remote Software Update / Reinstall (Owner Auth)
sentinelRoutes.post('/self-update', requireOwnerAuth, async (req: Request, res: Response) => {
  try {
    const { update_mode, target_url } = req.body || {};
    const mode = update_mode || 'github_latest';

    // 1. Take pre-update backup of SQLite database
    const db = getDatabaseSafe();
    const backupDir = path.resolve(process.cwd(), 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const backupFile = path.join(backupDir, `flo-pre-update-${Date.now()}.db`);
    try {
      db.prepare('VACUUM INTO ?').run(backupFile);
    } catch {}

    if (process.platform === 'win32') {
      const downloadUrl = target_url || 'https://github.com/omrshrifmo/FloCafe2/releases/latest/download/flocafe-4.3.0-win-x64.exe';
      const tempInstaller = path.join(os.tmpdir(), `flocafe-update-${Date.now()}.exe`);

      res.json({
        success: true,
        update_mode: mode,
        message: `Self-update initiated on Windows. Downloading from ${downloadUrl}...`,
        backup_created: backupFile,
        installer_path: tempInstaller,
      });

      // Background download and silent install
      const fileStream = fs.createWriteStream(tempInstaller);
      const requestLib = downloadUrl.startsWith('https') ? https : http;
      requestLib.get(downloadUrl, (dlRes) => {
        dlRes.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close(() => {
            try {
              // Trigger silent NSIS installer detached
              const installer = spawn(tempInstaller, ['/S'], { detached: true, stdio: 'ignore' });
              installer.unref();
            } catch (instErr: any) {
              console.error('[Sentinel Update] Silent install failed:', instErr.message);
            }
          });
        });
      }).on('error', (err) => {
        console.error('[Sentinel Update] Download failed:', err.message);
      });
      return;
    }

    // Linux / Arch: git pull + build or service restart
    exec('git pull origin main && npm run build', { cwd: process.cwd(), timeout: 120000 }, (error, stdout, stderr) => {
      console.log('[Sentinel Update] Linux update finished:', { error, stdout, stderr });
    });

    return res.json({
      success: true,
      update_mode: mode,
      message: 'Self-update sequence started on Linux.',
      backup_created: backupFile,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Self-update failed', details: err.message });
  }
});

// 8. POST & GET /api/sentinel/tunnel - Zero-Cost Internet Tunnel Management
sentinelRoutes.get('/tunnel', (_req: Request, res: Response) => {
  res.json({
    status: activeTunnelUrl ? 'active' : 'inactive',
    tunnel_url: activeTunnelUrl,
    provider: activeTunnelProvider,
  });
});

sentinelRoutes.post('/tunnel', requireOwnerAuth, async (req: Request, res: Response) => {
  try {
    const { action, provider } = req.body || {};
    if (action === 'stop') {
      stopTunnel();
      return res.json({
        success: true,
        action: 'stop',
        status: 'inactive',
        tunnel_url: null,
      });
    }

    const tunnelResult = await startTunnel(provider || 'auto');
    return res.json({
      success: Boolean(tunnelResult.url),
      action: 'start',
      status: tunnelResult.url ? 'active' : 'failed',
      tunnel_url: tunnelResult.url,
      provider: tunnelResult.provider,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Tunnel control failed', details: err.message });
  }
});

// 9. POST /api/sentinel/remote-license - Remote license update & auto-renewal (Owner Auth)
sentinelRoutes.post('/remote-license', requireOwnerAuth, (req: Request, res: Response) => {
  try {
    const db = getDatabaseSafe();
    const {
      tierKeyContent,
      ownerMasterKeyContent,
      reactivationPassword,
      action,
      autoRenewPolicy,
    } = req.body || {};

    if (action === 'revoke') {
      const revokeRes = revokeLicense(db, {
        reactivationPassword,
        ownerMasterKeyContent,
      });
      if (revokeRes.success) {
        setAutoRenewPolicy(db, null);
        return res.json({
          success: true,
          action: 'revoke',
          license: verifyHardwareLicense(db),
        });
      }
      return res.status(400).json({ error: revokeRes.error || 'Failed to revoke license' });
    }

    if (!tierKeyContent) {
      return res.status(400).json({ error: 'Missing tierKeyContent in request body.' });
    }

    const activateRes = activateWithKeyFile(db, {
      tierKeyContent,
      ownerMasterKeyContent,
      reactivationPassword,
      forceReplaceActive: true,
    });

    if (activateRes.success) {
      if (autoRenewPolicy) {
        setAutoRenewPolicy(db, autoRenewPolicy as AutoRenewPolicy);
      }
      void publishFleetBeacon();
      return res.json({
        success: true,
        action: 'activate',
        license: activateRes.license,
        auto_renew_policy: getAutoRenewPolicy(db),
      });
    }

    return res.status(400).json({
      error: activateRes.error || 'Failed to activate license remotely',
      requires_owner_override: activateRes.requires_owner_override,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Remote license operation failed', details: err.message });
  }
});

// 10. POST /api/sentinel/telemetry-sink - Sovereign local sink for telemetry
sentinelRoutes.post('/telemetry-sink', (_req: Request, res: Response) => {
  res.json({ status: 'ok', received: true });
});

// 11. GET /api/sentinel/discover-fleet - Query discovered remote nodes via encrypted rendezvous
sentinelRoutes.get('/discover-fleet', requireOwnerAuth, async (_req: Request, res: Response) => {
  try {
    const nodes = await discoverFleetNodes();
    res.json({ status: 'ok', count: nodes.length, nodes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 12. PWA Serving for Owner Control
sentinelRoutes.get('/owner-app', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  let ownerHtmlPath = path.resolve(__dirname, '../../owner-system/flo-owner-control.html');
  if (fs.existsSync(ownerHtmlPath)) return res.sendFile(ownerHtmlPath);
  if (process.resourcesPath) {
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'owner-system', 'flo-owner-control.html');
    if (fs.existsSync(unpacked)) return res.sendFile(unpacked);
  }
  res.send('<!DOCTYPE html><html><body><h1>FloOwner Control</h1></body></html>');
});

sentinelRoutes.get('/owner-app/manifest.json', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.json({
    name: 'FloOwner Control System',
    short_name: 'FloOwner',
    description: 'FloOwner Sovereign Multi-Node Control & Remote Fleet Operations',
    start_url: '/owner-app',
    scope: '/owner-app',
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#1e293b',
    icons: [
      { src: '/assets/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/assets/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  });
});

sentinelRoutes.get('/owner-app/sw.js', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`const CACHE_NAME='flo-owner-cache-v4.4.1';const ASSETS_TO_CACHE=['/owner-app','/owner-app/manifest.json'];self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS_TO_CACHE)).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));`);
});
