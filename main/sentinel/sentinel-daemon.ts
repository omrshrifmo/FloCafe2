import express from 'express';
import cors from 'cors';
import os from 'os';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { sentinelRoutes } from '../routes/sentinel';
import { initHardwareLicenseSchema, verifyHardwareLicense } from '../services/hardware-license';

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
  } catch (err: any) {
    console.warn(`[Sentinel] Database initialization warning at ${dbPath}:`, err.message);
  }

  // Mount Sentinel API
  app.use('/api/sentinel', sentinelRoutes);

  // Friendly root and direct endpoints
  app.get('/', (_req, res) => {
    res.json({
      service: 'flocafe-sentinel',
      version: '4.1.0',
      port,
      status: 'active',
      endpoints: [
        'GET /api/sentinel/ping',
        'GET /api/sentinel/diagnostics',
        'GET /api/sentinel/insights',
        'POST /api/sentinel/app-control',
        'POST /api/sentinel/sql-query',
        'POST /api/sentinel/exec-support',
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
