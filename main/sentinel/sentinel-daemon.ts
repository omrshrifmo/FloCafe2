import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import {
  sentinelRoutes,
  getNetworkInfo,
  setSentinelDb,
  resolveSentinelDbPath,
  getActiveTunnelUrl,
  startTunnel,
  stopTunnel,
} from '../routes/sentinel';
import {
  initHardwareLicenseSchema,
  verifyHardwareLicense,
  checkAndApplyAutoRenew,
} from '../services/hardware-license';

export {
  getNetworkInfo,
  resolveSentinelDbPath,
  checkAndApplyAutoRenew,
  startTunnel,
  stopTunnel,
  getActiveTunnelUrl,
};

export function startSentinelDaemon(port = Number(process.env.SENTINEL_PORT || 3009)) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Ensure DB can be opened or created
  const dbPath = resolveSentinelDbPath();
  let db: any = null;
  try {
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
    db = new Database(dbPath);
    initHardwareLicenseSchema(db);
    setSentinelDb(db);
  } catch (err: any) {
    console.warn(`[Sentinel] Database initialization warning at ${dbPath}:`, err.message);
  }

  // Initial and background 10-minute Auto-Renew execution loop
  if (db) {
    try {
      checkAndApplyAutoRenew(db);
    } catch {}
  }
  const autoRenewTimer = setInterval(() => {
    if (db) {
      try {
        checkAndApplyAutoRenew(db);
      } catch (err: any) {
        console.error('[Sentinel] Background auto-renew check error:', err.message);
      }
    }
  }, 10 * 60 * 1000);

  // Mount Sentinel API
  app.use('/api/sentinel', sentinelRoutes);

  // Friendly root and direct endpoints
  app.get('/', (_req, res) => {
    res.json({
      service: 'flocafe-sentinel',
      version: '4.3.0',
      port,
      status: 'active',
      tunnel_url: getActiveTunnelUrl(),
      endpoints: [
        'GET /api/sentinel/ping',
        'GET /api/sentinel/diagnostics',
        'GET /api/sentinel/insights',
        'POST /api/sentinel/app-control',
        'POST /api/sentinel/sql-query',
        'POST /api/sentinel/exec-support',
        'POST /api/sentinel/self-update',
        'GET /api/sentinel/tunnel',
        'POST /api/sentinel/tunnel',
        'POST /api/sentinel/remote-license',
      ],
    });
  });

  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`[Sentinel] FloCafe OS Daemon active on port ${port} (0.0.0.0:${port})`);
    console.log(`[Sentinel] Database connected at: ${dbPath}`);
  });

  const shutdown = () => {
    console.log('[Sentinel] Shutting down daemon...');
    clearInterval(autoRenewTimer);
    stopTunnel();
    server.close(() => {
      if (db) {
        try { db.close(); } catch {}
      }
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return { app, server, db };
}

if (require.main === module) {
  startSentinelDaemon();
}
