import { Router, Request, Response, NextFunction } from 'express';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { exec, execSync } from 'child_process';
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
} from '../services/hardware-license';

export const sentinelRoutes = Router();

export function getNetworkInfo() {
  const interfaces = os.networkInterfaces();
  const lanIps: string[] = [];
  let p2pIp: string | null = null;
  const p2pDetails: Array<{ name: string; ip: string; type: string }> = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
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
 * Requires valid Owner Password (scrypt-verified Fl0220671190) AND
 * either Owner Master Key content (owner-reactivate-master.flokey) OR valid signature.
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
    // Support base64 encoded key files in headers
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
sentinelRoutes.get('/ping', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const license = verifyHardwareLicense(db);
    const hwid = getHardwareFingerprint();
    const net = getNetworkInfo();

    let version = '4.1.0';
    try {
      const pkgPath = path.resolve(__dirname, '../../package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.version) version = pkg.version;
      }
    } catch {}

    res.json({
      status: 'ok',
      node_name: os.hostname(),
      hwid,
      os_platform: os.platform(),
      os_release: os.release(),
      arch: os.arch(),
      flocafe_version: version,
      flocafe_running: true,
      license_tier: license.tier || 'unactivated',
      license_valid: Boolean(license.valid),
      license_expires_at: license.expires_at || null,
      lan_ips: net.lanIps,
      p2p_ip: net.p2pIp,
      p2p_details: net.p2pDetails,
      uptime_seconds: Math.floor(os.uptime()),
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Ping failed', details: err.message });
  }
});

// 2. GET /api/sentinel/diagnostics - OS & machine health (Owner Auth)
sentinelRoutes.get('/diagnostics', requireOwnerAuth, (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const net = getNetworkInfo();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    // SQLite Health
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

    // Printer count
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
    const db = getDatabase();
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    // Today's Revenue & Completed Orders
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

    // 30-Day Revenue
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

    // Active Open Tables
    let openTablesCount = 0;
    try {
      const tRow = db.prepare(`
        SELECT count(*) as cnt FROM tables WHERE status = 'occupied'
      `).get() as any;
      openTablesCount = Number(tRow?.cnt || 0);
    } catch {}

    // Expected Cash Drawer Balance from active cash shift
    let activeCashSession = null;
    try {
      activeCashSession = db.prepare(`
        SELECT id, opened_at, opening_balance, expected_balance
        FROM cash_sessions
        WHERE status = 'open'
        ORDER BY id DESC LIMIT 1
      `).get() || null;
    } catch {}

    // Low Stock Warnings
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

    // Active Staff Count
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

// 4. POST /api/sentinel/app-control - App lifecycle & DB checkpoints (Owner Auth)
sentinelRoutes.post('/app-control', requireOwnerAuth, (req: Request, res: Response) => {
  try {
    const { action } = req.body || {};
    const db = getDatabase();

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

    if (action === 'restart' || action === 'stop' || action === 'start') {
      return res.json({
        success: true,
        action,
        message: `App control command '${action}' acknowledged.`,
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
    const db = getDatabase();

    if (/^(SELECT|PRAGMA|EXPLAIN)\b/i.test(trimmed)) {
      const stmt = db.prepare(trimmed);
      const rows = Array.isArray(params) ? stmt.all(...params) : stmt.all();
      return res.json({ success: true, rows, count: rows.length });
    }

    // Write operations require Owner Auth (which is already verified by requireOwnerAuth)
    const stmt = db.prepare(trimmed);
    const info = Array.isArray(params) ? stmt.run(...params) : stmt.run();
    return res.json({ success: true, changes: info.changes, lastInsertRowid: info.lastInsertRowid });
  } catch (err: any) {
    return res.status(500).json({ error: 'SQL execution failed', details: err.message });
  }
});

// 6. POST /api/sentinel/exec-support - Signed diagnostic & maintenance commands (Owner Auth)
sentinelRoutes.post('/exec-support', requireOwnerAuth, (req: Request, res: Response) => {
  try {
    const { command } = req.body || {};
    if (!command || typeof command !== 'string') {
      return res.status(400).json({ error: 'Missing command string.' });
    }

    // Whitelist check for safe diagnostic/maintenance commands
    const allowedPrefixes = [
      'git status',
      'git log',
      'git pull',
      'npm run build',
      'systemctl --user status flocafe-sentinel',
      'systemctl status flocafe-sentinel',
      'systemctl restart cups',
      'lpstat',
      'free',
      'df',
      'uptime',
      'node -v',
      'uname',
    ];

    const isAllowed = allowedPrefixes.some((p) => command.trim().startsWith(p));
    if (!isAllowed) {
      return res.status(403).json({
        error: 'COMMAND_NOT_PERMITTED',
        message: `Command '${command}' is not in the safe diagnostic allowlist.`,
      });
    }

    exec(command, { timeout: 15000 }, (error, stdout, stderr) => {
      res.json({
        command,
        exitCode: error ? error.code || 1 : 0,
        stdout: stdout || '',
        stderr: stderr || (error ? error.message : ''),
      });
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Command execution failed', details: err.message });
  }
});

// 7. POST /api/sentinel/remote-license - Remote license update & auto-renewal (Owner Auth)
sentinelRoutes.post('/remote-license', requireOwnerAuth, (req: Request, res: Response) => {
  try {
    const db = getDatabase();
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

// 8. POST /api/sentinel/telemetry-sink - Sovereign local sink for telemetry
sentinelRoutes.post('/telemetry-sink', (_req: Request, res: Response) => {
  res.json({ status: 'ok', received: true });
});
