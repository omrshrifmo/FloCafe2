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
  publishFleetBeacon,
  discoverFleetNodes,
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
  publishFleetBeacon,
  discoverFleetNodes,
};

export function startSentinelDaemon(port = Number(process.env.SENTINEL_PORT || 3009)) {
  const app = express();
  app.use(cors());
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-owner-password, x-owner-master-key');
    if (_req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
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

  // Auto-Start Internet Tunnel and Fleet Rendezvous Beacons (outside test)
  let beaconTimer: any = null;
  if (process.env.NODE_ENV !== 'test') {
    void startTunnel('auto', port).then((result) => {
      if (result.url) {
        console.log(`[Sentinel] Outbound Internet Tunnel active: ${result.url}`);
        void publishFleetBeacon();
      }
    });

    void publishFleetBeacon();
    beaconTimer = setInterval(() => {
      void publishFleetBeacon();
    }, 2 * 60 * 1000);
  }

  // Mount Sentinel API
  app.use('/api/sentinel', sentinelRoutes);

  // Direct PWA Hosting for FloOwner Control
  app.get('/owner-app', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    let ownerHtmlPath = path.resolve(__dirname, '../../owner-system/flo-owner-control.html');
    if (fs.existsSync(ownerHtmlPath)) return res.sendFile(ownerHtmlPath);
    if (process.resourcesPath) {
      const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'owner-system', 'flo-owner-control.html');
      if (fs.existsSync(unpacked)) return res.sendFile(unpacked);
    }
    res.send('<!DOCTYPE html><html><body><h1>FloOwner Control</h1></body></html>');
  });

  app.get('/owner-app/manifest.json', (_req, res) => {
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

  app.get('/owner-app/sw.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`const CACHE_NAME='flo-owner-cache-v4.4.0';const ASSETS_TO_CACHE=['/owner-app','/owner-app/manifest.json'];self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS_TO_CACHE)).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));`);
  });

  // Friendly root and direct endpoints
  app.get('/', (_req, res) => {
    res.json({
      service: 'flocafe-sentinel',
      version: '4.4.0',
      port,
      status: 'active',
      tunnel_url: getActiveTunnelUrl(),
      endpoints: [
        'GET /api/sentinel/ping',
        'GET /api/sentinel/diagnostics',
        'GET /api/sentinel/insights',
        'GET /api/sentinel/discover-fleet',
        'GET /api/sentinel/owner-app',
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
    if (beaconTimer) clearInterval(beaconTimer);
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
