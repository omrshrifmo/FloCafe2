import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { getDatabase } from '../db';

export type LicenseTier =
  | 'forever'
  | '24h'
  | '3d'
  | '1w'
  | '1m'
  | '3m'
  | '6m'
  | '1y';

export interface HardwareLicenseStatus {
  valid: boolean;
  reason?:
    | 'not_activated'
    | 'hardware_mismatch'
    | 'license_expired'
    | 'clock_tamper_detected'
    | 'invalid_signature'
    | 'tombstone_corrupted';
  tier?: LicenseTier;
  activated_at?: number;
  expires_at?: number | null;
  remaining_ms?: number | null;
  hwid: string;
  registered_hwid?: string;
  expired_at?: number | null;
  requires_owner_override?: boolean;
}

export interface StoredLicenseRecord {
  payload: string;
  signature: string;
  tier: LicenseTier;
  hwid: string;
  activated_at: number;
  expires_at: number | null;
  max_seen_timestamp: number;
  updated_at: string;
}

export interface ActivateKeyParams {
  tierKeyContent: string | Record<string, unknown>;
  tierKeyFilePath?: string;
  ownerMasterKeyContent?: string | Record<string, unknown>;
  reactivationPassword?: string;
  forceReplaceActive?: boolean;
}

export interface ActivateResult {
  success: boolean;
  error?: string;
  requires_owner_override?: boolean;
  message?: string;
  license?: HardwareLicenseStatus;
  updatedKeyContent?: Record<string, unknown>;
}

// 8 Duration Milliseconds Constants
export const TIER_DURATIONS: Record<LicenseTier, number | null> = {
  forever: null,
  '24h': 86_400_000,
  '3d': 259_200_000,
  '1w': 604_800_000,
  '1m': 2_592_000_000,
  '3m': 7_776_000_000,
  '6m': 15_552_000_000,
  '1y': 31_536_000_000,
};
export const TIER_DURATIONS_MS = TIER_DURATIONS;

// 8 Tier Public Keys (Ed25519 SPKI PEM)
export const TIER_PUBLIC_KEYS: Record<LicenseTier, string> = {
  forever: `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAJG5xdVej+EFUgi6BTgS9wBjkLE9IIbAxhakFrhVj3yk=
-----END PUBLIC KEY-----`,
  '24h': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAW0WfCrXteoWZSgW4ie6oSTYGnbYfH1mNmnXPvk29M2Y=
-----END PUBLIC KEY-----`,
  '3d': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA1MwKQCo53ZUKuBArvbdUkekiMnWt1UTxI/2vP0eTaCo=
-----END PUBLIC KEY-----`,
  '1w': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAZtS9oWi/Qv+OxB4vb777Y7z0ZpNA6+wPqXUg2PnWfwM=
-----END PUBLIC KEY-----`,
  '1m': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAlf/uWm9TT43VOm43UR/5YJUPYrtP9S5PFTLQofy3t8w=
-----END PUBLIC KEY-----`,
  '3m': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA9ZDQLzSWgzh2akv47gojbmr2JFf7mWTTo6zFX20LGs4=
-----END PUBLIC KEY-----`,
  '6m': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEARd8Y6rKg0hTFPLoud8gYXZxPFk2OppGhVHgp4UeR90U=
-----END PUBLIC KEY-----`,
  '1y': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEArpQEl5py3tYgtxbOLvm6g8jfW1OpAW0SSq8Blugutgc=
-----END PUBLIC KEY-----`,
};

// 1 Dedicated Owner Master Public Key (Ed25519 SPKI PEM)
export const OWNER_MASTER_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAd+X3rKeF50DeQinSd1BgCng+cAnJ2C/vqLZu7c2avHc=
-----END PUBLIC KEY-----`;

// Salted Scrypt Verifier for Re-Activation Password (never stores plaintext Fl0220671190)
export const REACTIVATION_PASSWORD_SALT = '2e213237f422524e1ddbe09c8682cc04';
export const REACTIVATION_PASSWORD_HASH = 'ce531f792c2a3a6eda85dd7660e776d73282c4d24a8fca442aef36903f1184761878ed9d6041a86556d4f2f224463ed203953c4a2fa0be787bb6c239a334bdbd';

let cachedHwid: string | null = null;

export function clearCachedHwidForTest(): void {
  cachedHwid = null;
}

export function computeHardwareFingerprint(): string {
  if (cachedHwid) return cachedHwid;

  const parts: string[] = [];
  const platform = os.platform();

  // 1. Machine ID
  let machineId = '';
  if (platform === 'win32') {
    try {
      const regOut = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', {
        encoding: 'utf8',
        timeout: 1500,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const match = regOut.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
      if (match && match[1]) {
        machineId = match[1].trim();
      }
    } catch {}
  } else if (platform === 'darwin') {
    try {
      const ioregOut = execSync('ioreg -rd1 -c IOPlatformExpertDevice', {
        encoding: 'utf8',
        timeout: 1500,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const match = ioregOut.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/i);
      if (match && match[1]) {
        machineId = match[1].trim();
      }
    } catch {}
  } else {
    // Linux / BSD
    for (const p of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
      if (fs.existsSync(p)) {
        try {
          const content = fs.readFileSync(p, 'utf8').trim();
          if (content.length > 0) {
            machineId = content;
            break;
          }
        } catch {}
      }
    }
  }

  if (machineId) parts.push(`mid:${machineId}`);

  // 2. CPU Architecture & Model
  const cpus = os.cpus() || [];
  const cpuModel = cpus[0]?.model || os.arch();
  const cpuCores = cpus.length;
  parts.push(`cpu:${cpuModel}:${cpuCores}`);

  // 3. Total Memory (bucketed to 512MB to avoid dynamic memory shifts in VMs)
  const totalMem = Math.round(os.totalmem() / (512 * 1024 * 1024));
  parts.push(`mem:${totalMem}`);

  // 4. Primary Network MAC (filter out loopback, virtual/docker interfaces)
  let primaryMac = '';
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces).sort()) {
      if (/veth|docker|br-|tun|tap/i.test(name)) continue;
      const list = interfaces[name];
      if (Array.isArray(list)) {
        for (const iface of list) {
          if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
            primaryMac = iface.mac.toLowerCase();
            break;
          }
        }
      }
      if (primaryMac) break;
    }
  } catch {}
  if (primaryMac) parts.push(`mac:${primaryMac}`);

  // 5. Hostname / System identifier
  const hostname = (os.hostname() || 'flocafe-node').toLowerCase();
  parts.push(`host:${hostname}`);

  const combined = parts.join('|');
  const fullHash = crypto.createHash('sha256').update(combined).digest('hex').toUpperCase();
  const formatted = `FLOHW-${fullHash.slice(0, 4)}-${fullHash.slice(4, 8)}-${fullHash.slice(8, 12)}-${fullHash.slice(12, 16)}`;

  cachedHwid = formatted;
  return formatted;
}

// Testing hooks
let testMockHwid: string | null = null;
let testForceStatus: HardwareLicenseStatus | null = null;

export function setTestMockHwid(hwid: string | null): void {
  testMockHwid = hwid;
  clearCachedHwidForTest();
}

export function setTestForceStatus(status: HardwareLicenseStatus | null): void {
  testForceStatus = status;
}

export function getHardwareFingerprint(): string {
  if (testMockHwid) return testMockHwid;
  return computeHardwareFingerprint();
}

function getUserDataAnchorPath(): string {
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), '.hw-license-anchor.json');
    }
  } catch {}
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'flo-desktop', '.hw-license-anchor.json');
  }
  return path.join(os.homedir(), '.config', 'flo-desktop', '.hw-license-anchor.json');
}

function getOsTombstonePath(): string {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, '.flocafe-hw-seal');
  }
  return path.join(os.homedir(), '.local', 'share', '.flocafe-hw-seal');
}

export function initHardwareLicenseSchema(db: any): void {
  if (!db) return;
  db.prepare(`
    CREATE TABLE IF NOT EXISTS _flo_hardware_license (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL,
      signature TEXT NOT NULL,
      tier TEXT NOT NULL,
      hwid TEXT NOT NULL,
      activated_at INTEGER NOT NULL,
      expires_at INTEGER,
      max_seen_timestamp INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS _flo_hardware_license_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tier TEXT NOT NULL,
      hwid TEXT NOT NULL,
      activated_at INTEGER NOT NULL,
      expires_at INTEGER,
      created_at TEXT NOT NULL
    )
  `).run();

  try {
    db.prepare(`ALTER TABLE _flo_hardware_license ADD COLUMN auto_renew_policy TEXT`).run();
  } catch {}
}

function readAnchorFromFile(filePath: string): StoredLicenseRecord | null {
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (data && data.payload && data.signature && data.hwid && data.tier) {
        return data as StoredLicenseRecord;
      }
    }
  } catch {}
  return null;
}

function writeTombstoneFiles(record: StoredLicenseRecord): void {
  const jsonStr = JSON.stringify(record, null, 2);

  // 1. User-data anchor
  try {
    const anchorPath = getUserDataAnchorPath();
    fs.mkdirSync(path.dirname(anchorPath), { recursive: true });
    fs.writeFileSync(anchorPath, jsonStr, { mode: 0o600 });
  } catch {}

  // 2. OS-level hidden tombstone
  try {
    const osPath = getOsTombstonePath();
    fs.mkdirSync(path.dirname(osPath), { recursive: true });
    fs.writeFileSync(osPath, jsonStr, { mode: 0o600 });
  } catch {}
}

export function checkHardwareTombstoneExists(db: any, hwidToCheck?: string): boolean {
  const currentHwid = hwidToCheck || getHardwareFingerprint();

  // Check 1: SQLite current license or history
  if (db) {
    try {
      initHardwareLicenseSchema(db);
      const row = db.prepare('SELECT id FROM _flo_hardware_license WHERE id = 1').get();
      if (row) return true;
      const historyRow = db.prepare('SELECT id FROM _flo_hardware_license_history WHERE hwid = ?').get(currentHwid);
      if (historyRow) return true;
    } catch {}
  }

  // Check 2: User data anchor file
  try {
    const anchor = readAnchorFromFile(getUserDataAnchorPath());
    if (anchor) return true;
  } catch {}

  // Check 3: OS tombstone file
  try {
    const osAnchor = readAnchorFromFile(getOsTombstonePath());
    if (osAnchor) return true;
  } catch {}

  return false;
}

export function verifyHardwareLicense(dbInstance?: any): HardwareLicenseStatus {
  if (testForceStatus) return testForceStatus;

  const currentHwid = getHardwareFingerprint();
  let db = dbInstance;
  if (!db) {
    try {
      db = getDatabase();
    } catch {}
  }

  if (db) {
    initHardwareLicenseSchema(db);
  }

  // Retrieve stored record from SQLite
  let record: StoredLicenseRecord | null = null;
  if (db) {
    try {
      record = db.prepare('SELECT * FROM _flo_hardware_license WHERE id = 1').get() as StoredLicenseRecord | undefined || null;
    } catch {}
  }

  // If SQLite is empty, check user-data anchor file for recovery
  if (!record) {
    const anchor = readAnchorFromFile(getUserDataAnchorPath());
    if (anchor) {
      record = anchor;
      if (db) {
        try {
          db.prepare(`
            INSERT OR REPLACE INTO _flo_hardware_license (id, payload, signature, tier, hwid, activated_at, expires_at, max_seen_timestamp, updated_at)
            VALUES (1, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          `).run(
            record.payload,
            record.signature,
            record.tier,
            record.hwid,
            record.activated_at,
            record.expires_at,
            record.max_seen_timestamp,
          );
        } catch {}
      }
    }
  }

  if (!record) {
    return {
      valid: false,
      reason: 'not_activated',
      hwid: currentHwid,
      requires_owner_override: checkHardwareTombstoneExists(db, currentHwid),
    };
  }

  // 1. Verify Cryptographic Signature
  const publicKey = TIER_PUBLIC_KEYS[record.tier];
  if (!publicKey) {
    return { valid: false, reason: 'invalid_signature', hwid: currentHwid };
  }

  let isSigValid = false;
  try {
    isSigValid = crypto.verify(
      null,
      Buffer.from(record.payload, 'utf8'),
      publicKey,
      Buffer.from(record.signature, 'base64'),
    );
  } catch {
    isSigValid = false;
  }

  if (!isSigValid) {
    return { valid: false, reason: 'invalid_signature', hwid: currentHwid };
  }

  // 2. Hardware Fingerprint Match
  let payloadObj: { hwid: string; tier: LicenseTier; activated_at: number; expires_at: number | null; nonce?: string };
  try {
    payloadObj = JSON.parse(record.payload);
  } catch {
    return { valid: false, reason: 'tombstone_corrupted', hwid: currentHwid };
  }

  if (payloadObj.hwid !== currentHwid) {
    return {
      valid: false,
      reason: 'hardware_mismatch',
      hwid: currentHwid,
      registered_hwid: payloadObj.hwid,
      requires_owner_override: true,
    };
  }

  // 3. Monotonic Clock-Tamper Check
  let maxDbTime = Number(record.max_seen_timestamp) || 0;
  if (db) {
    try {
      const orderRow = db.prepare("SELECT MAX(created_at) as max_c FROM orders").get() as any;
      if (orderRow?.max_c) {
        const orderTime = new Date(orderRow.max_c).getTime();
        if (!isNaN(orderTime)) maxDbTime = Math.max(maxDbTime, orderTime);
      }
      const stockRow = db.prepare("SELECT MAX(created_at) as max_s FROM stock_logs").get() as any;
      if (stockRow?.max_s) {
        const stockTime = new Date(stockRow.max_s).getTime();
        if (!isNaN(stockTime)) maxDbTime = Math.max(maxDbTime, stockTime);
      }
    } catch {}
  }

  const now = Date.now();
  // Check if system clock was rolled backward by more than 5 minutes
  if (now < maxDbTime - 300_000) {
    return {
      valid: false,
      reason: 'clock_tamper_detected',
      hwid: currentHwid,
      tier: payloadObj.tier,
      expires_at: payloadObj.expires_at,
    };
  }

  // Update max seen timestamp if time advanced
  if (now > (record.max_seen_timestamp || 0)) {
    record.max_seen_timestamp = now;
    if (db) {
      try {
        db.prepare('UPDATE _flo_hardware_license SET max_seen_timestamp = ? WHERE id = 1').run(now);
      } catch {}
    }
  }

  // 4. Expiration Check
  if (payloadObj.expires_at !== null && payloadObj.expires_at !== undefined) {
    if (now >= payloadObj.expires_at) {
      return {
        valid: false,
        reason: 'license_expired',
        tier: payloadObj.tier,
        expired_at: payloadObj.expires_at,
        expires_at: payloadObj.expires_at,
        hwid: currentHwid,
        requires_owner_override: true,
      };
    }
  }

  return {
    valid: true,
    tier: payloadObj.tier,
    activated_at: payloadObj.activated_at,
    expires_at: payloadObj.expires_at,
    remaining_ms: payloadObj.expires_at ? Math.max(0, payloadObj.expires_at - now) : null,
    hwid: currentHwid,
  };
}

export function activateWithKeyFile(db: any, params: ActivateKeyParams): ActivateResult {
  const currentHwid = getHardwareFingerprint();
  if (db) initHardwareLicenseSchema(db);

  let tierKeyJson: any = params.tierKeyContent;
  if (typeof tierKeyJson === 'string') {
    try {
      tierKeyJson = JSON.parse(tierKeyJson);
    } catch {
      return { success: false, error: 'Invalid key file format. Key must be valid JSON.' };
    }
  }

  if (!tierKeyJson || typeof tierKeyJson !== 'object') {
    return { success: false, error: 'Missing or empty key file content.' };
  }

  const tier = tierKeyJson.tier as LicenseTier;
  const privateKeyPem = tierKeyJson.private_key_pem;

  if (!tier || !TIER_PUBLIC_KEYS[tier]) {
    return { success: false, error: `Unrecognized license tier: "${tier}".` };
  }

  if (!privateKeyPem || typeof privateKeyPem !== 'string') {
    return { success: false, error: 'Key file does not contain a valid private key.' };
  }

  // Cryptographic verification: Test private key against public key
  try {
    const challenge = Buffer.from(`flocafe-key-verify-${tier}-${Date.now()}`);
    const sig = crypto.sign(null, challenge, privateKeyPem);
    const valid = crypto.verify(null, challenge, TIER_PUBLIC_KEYS[tier], sig);
    if (!valid) {
      return { success: false, error: 'Cryptographic mismatch: Private key is not valid for this tier.' };
    }
  } catch (err: any) {
    return { success: false, error: `Key validation failed: ${err.message}` };
  }

  // Single-use & Machine History Enforcement
  const isKeyAlreadyUsed =
    (Number(tierKeyJson.usage_count) || 0) >= 1 ||
    Boolean(tierKeyJson.consumed) ||
    (Array.isArray(tierKeyJson.bound_hwids) && tierKeyJson.bound_hwids.length > 0);

  const hasPriorMachineHistory = checkHardwareTombstoneExists(db, currentHwid);

  if (isKeyAlreadyUsed || hasPriorMachineHistory || params.forceReplaceActive) {
    // Both Password and Owner Master Key are required for re-activation/override
    if (!params.reactivationPassword || !params.ownerMasterKeyContent) {
      return {
        success: false,
        requires_owner_override: true,
        status: 'requires_owner_override',
        message: 'This key or hardware has been used before, or an active license is being replaced. Enter the Owner Re-Activation Password and load the Owner Master Private Key file (owner-reactivate-master.flokey).',
      } as any;
    }

    // 1. Verify password using scrypt
    try {
      const enteredHash = crypto.scryptSync(params.reactivationPassword, REACTIVATION_PASSWORD_SALT, 64);
      const targetHash = Buffer.from(REACTIVATION_PASSWORD_HASH, 'hex');
      if (enteredHash.length !== targetHash.length || !crypto.timingSafeEqual(enteredHash, targetHash)) {
        return { success: false, error: 'Invalid Owner Re-Activation Password.' };
      }
    } catch {
      return { success: false, error: 'Password verification failed.' };
    }

    // 2. Verify Owner Master Key
    let masterJson: any = params.ownerMasterKeyContent;
    if (typeof masterJson === 'string') {
      try {
        masterJson = JSON.parse(masterJson);
      } catch {
        return { success: false, error: 'Invalid Owner Master Key file format.' };
      }
    }

    if (!masterJson?.private_key_pem) {
      return { success: false, error: 'Owner Master Key does not contain a valid private key.' };
    }

    try {
      const masterChallenge = Buffer.from(`flocafe-owner-master-verify-${Date.now()}`);
      const masterSig = crypto.sign(null, masterChallenge, masterJson.private_key_pem);
      const isMasterValid = crypto.verify(null, masterChallenge, OWNER_MASTER_PUBLIC_KEY, masterSig);
      if (!isMasterValid) {
        return { success: false, error: 'Cryptographic mismatch: Provided key is not the authentic Owner Master Key.' };
      }
    } catch (err: any) {
      return { success: false, error: `Owner Master Key validation failed: ${err.message}` };
    }
  }

  // Authorization passed: Compute duration and issue signed license
  const duration_ms = TIER_DURATIONS[tier];
  const activated_at = Date.now();
  const expires_at = duration_ms !== null ? activated_at + duration_ms : null;

  const payloadObj = {
    hwid: currentHwid,
    tier,
    activated_at,
    expires_at,
    nonce: crypto.randomUUID(),
  };

  const canonicalPayload = JSON.stringify(payloadObj);
  const signature = crypto.sign(null, Buffer.from(canonicalPayload, 'utf8'), privateKeyPem).toString('base64');

  // Immediately discard/wipe private key from local reference
  tierKeyJson.private_key_pem = undefined;
  delete tierKeyJson.private_key_pem;

  const record: StoredLicenseRecord = {
    payload: canonicalPayload,
    signature,
    tier,
    hwid: currentHwid,
    activated_at,
    expires_at,
    max_seen_timestamp: activated_at,
    updated_at: new Date().toISOString(),
  };

  // Persist to SQLite
  if (db) {
    db.prepare(`
      INSERT OR REPLACE INTO _flo_hardware_license (id, payload, signature, tier, hwid, activated_at, expires_at, max_seen_timestamp, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      record.payload,
      record.signature,
      record.tier,
      record.hwid,
      record.activated_at,
      record.expires_at,
      record.max_seen_timestamp,
    );

    db.prepare(`
      INSERT INTO _flo_hardware_license_history (tier, hwid, activated_at, expires_at, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(record.tier, record.hwid, record.activated_at, record.expires_at);
  }

  // Persist to anchor and OS tombstone
  writeTombstoneFiles(record);

  // Update .flokey file on disk if path is provided and writable
  if (params.tierKeyFilePath) {
    try {
      if (fs.existsSync(params.tierKeyFilePath)) {
        const fileContent = JSON.parse(fs.readFileSync(params.tierKeyFilePath, 'utf8'));
        fileContent.usage_count = (Number(fileContent.usage_count) || 0) + 1;
        fileContent.consumed = true;
        fileContent.bound_hwids = Array.isArray(fileContent.bound_hwids) ? fileContent.bound_hwids : [];
        if (!fileContent.bound_hwids.includes(currentHwid)) {
          fileContent.bound_hwids.push(currentHwid);
        }
        fileContent.last_used_at = new Date().toISOString();
        fs.writeFileSync(params.tierKeyFilePath, JSON.stringify(fileContent, null, 2), 'utf8');
      }
    } catch {}
  }

  return {
    success: true,
    license: verifyHardwareLicense(db),
  };
}

export function revokeLicense(db: any, params: {
  ownerMasterKeyContent?: string | Record<string, unknown>;
  reactivationPassword?: string;
}): { success: boolean; error?: string } {
  if (!params.ownerMasterKeyContent || !params.reactivationPassword) {
    return { success: false, error: 'Owner Master Key and Owner Password are required to lock/revoke this device.' };
  }

  // 1. Password verification
  try {
    const enteredHash = crypto.scryptSync(params.reactivationPassword, REACTIVATION_PASSWORD_SALT, 64);
    const targetHash = Buffer.from(REACTIVATION_PASSWORD_HASH, 'hex');
    if (enteredHash.length !== targetHash.length || !crypto.timingSafeEqual(enteredHash, targetHash)) {
      return { success: false, error: 'Invalid Owner Re-Activation Password.' };
    }
  } catch {
    return { success: false, error: 'Password verification failed.' };
  }

  // 2. Master Key verification
  let masterJson: any = params.ownerMasterKeyContent;
  if (typeof masterJson === 'string') {
    try {
      masterJson = JSON.parse(masterJson);
    } catch {
      return { success: false, error: 'Invalid Owner Master Key file format.' };
    }
  }

  if (!masterJson?.private_key_pem) {
    return { success: false, error: 'Owner Master Key does not contain a valid private key.' };
  }

  try {
    const challenge = Buffer.from(`flocafe-revoke-${Date.now()}`);
    const sig = crypto.sign(null, challenge, masterJson.private_key_pem);
    if (!crypto.verify(null, challenge, OWNER_MASTER_PUBLIC_KEY, sig)) {
      return { success: false, error: 'Cryptographic mismatch: Provided key is not the authentic Owner Master Key.' };
    }
  } catch (err: any) {
    return { success: false, error: `Owner Master Key validation failed: ${err.message}` };
  }

  // 3. Clear active license row (preserves history and OS seal)
  if (db) {
    try {
      db.prepare('DELETE FROM _flo_hardware_license WHERE id = 1').run();
    } catch {}
  }

  // 4. Remove local userData anchor (preserves OS seal tombstone)
  try {
    const anchorPath = getUserDataAnchorPath();
    if (fs.existsSync(anchorPath)) fs.unlinkSync(anchorPath);
  } catch {}

  return { success: true };
}

export function deactivateLicenseForTest(db: any, params: {
  masterPin?: string;
  ownerMasterKeyContent?: string | Record<string, unknown>;
  reactivationPassword?: string;
}): { success: boolean; error?: string } {
  return revokeLicense(db, params);
}

export function autoSeedDevOrTestLicense(db: any): void {
  if (!db) return;
  initHardwareLicenseSchema(db);
  const existing = db.prepare('SELECT id FROM _flo_hardware_license WHERE id = 1').get();
  if (existing) return;

  const currentHwid = getHardwareFingerprint();

  // 1. Try reading existing anchor file
  const anchor = readAnchorFromFile(getUserDataAnchorPath()) || readAnchorFromFile(getOsTombstonePath());
  if (anchor && anchor.hwid === currentHwid) {
    db.prepare(`
      INSERT OR REPLACE INTO _flo_hardware_license (id, payload, signature, tier, hwid, activated_at, expires_at, max_seen_timestamp, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      anchor.payload,
      anchor.signature,
      anchor.tier,
      anchor.hwid,
      anchor.activated_at,
      anchor.expires_at,
      anchor.max_seen_timestamp || Date.now(),
    );
    return;
  }

  // 2. Try loading owner-private-keys/forever.flokey if available (local dev or test environment)
  const candidateKeyPaths = [
    path.join(__dirname, '..', '..', 'owner-private-keys', 'forever.flokey'),
    path.join(os.homedir(), 'FloCafe-Owner-Private-Keys', 'forever.flokey'),
  ];
  for (const kp of candidateKeyPaths) {
    if (fs.existsSync(kp)) {
      try {
        const keyJson = JSON.parse(fs.readFileSync(kp, 'utf8'));
        if (keyJson?.private_key_pem) {
          const payloadObj = {
            hwid: currentHwid,
            tier: 'forever' as LicenseTier,
            activated_at: Date.now(),
            expires_at: null,
            nonce: crypto.randomUUID(),
          };
          const canonical = JSON.stringify(payloadObj);
          const sig = crypto.sign(null, Buffer.from(canonical, 'utf8'), keyJson.private_key_pem).toString('base64');
          db.prepare(`
            INSERT OR REPLACE INTO _flo_hardware_license (id, payload, signature, tier, hwid, activated_at, expires_at, max_seen_timestamp, updated_at)
            VALUES (1, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          `).run(canonical, sig, 'forever', currentHwid, payloadObj.activated_at, null, Date.now());
          return;
        }
      } catch {}
    }
  }
}

export function verifyOwnerCredentials(params: {
  reactivationPassword?: string;
  ownerMasterKeyContent?: string | Record<string, unknown>;
  ownerSignature?: string;
  ownerChallenge?: string;
}): { success: boolean; error?: string } {
  if (!params.reactivationPassword) {
    return { success: false, error: 'Owner Password is required.' };
  }

  // 1. Password verification (scrypt against salt and hash)
  try {
    const enteredHash = crypto.scryptSync(params.reactivationPassword, REACTIVATION_PASSWORD_SALT, 64);
    const targetHash = Buffer.from(REACTIVATION_PASSWORD_HASH, 'hex');
    if (enteredHash.length !== targetHash.length || !crypto.timingSafeEqual(enteredHash, targetHash)) {
      return { success: false, error: 'Invalid Owner Password.' };
    }
  } catch {
    return { success: false, error: 'Password verification failed.' };
  }

  // 2. Owner Master Key verification (either raw key file content or cryptographic signature)
  let keyValidated = false;

  if (params.ownerMasterKeyContent) {
    let masterJson: any = params.ownerMasterKeyContent;
    if (typeof masterJson === 'string') {
      try {
        masterJson = JSON.parse(masterJson);
      } catch {
        return { success: false, error: 'Invalid Owner Master Key file format.' };
      }
    }

    if (!masterJson?.private_key_pem) {
      return { success: false, error: 'Owner Master Key does not contain a valid private key.' };
    }

    try {
      const challenge = Buffer.from(`flocafe-owner-verify-${Date.now()}`);
      const sig = crypto.sign(null, challenge, masterJson.private_key_pem);
      if (crypto.verify(null, challenge, OWNER_MASTER_PUBLIC_KEY, sig)) {
        keyValidated = true;
      } else {
        return { success: false, error: 'Cryptographic mismatch: Provided key is not the authentic Owner Master Key.' };
      }
    } catch (err: any) {
      return { success: false, error: `Owner Master Key validation failed: ${err.message}` };
    }
  } else if (params.ownerSignature && params.ownerChallenge) {
    try {
      const sigBuf = Buffer.from(params.ownerSignature, 'base64');
      const challengeBuf = Buffer.from(params.ownerChallenge, 'utf8');
      if (crypto.verify(null, challengeBuf, OWNER_MASTER_PUBLIC_KEY, sigBuf)) {
        keyValidated = true;
      } else {
        return { success: false, error: 'Invalid Owner signature.' };
      }
    } catch (err: any) {
      return { success: false, error: `Signature verification failed: ${err.message}` };
    }
  }

  if (!keyValidated) {
    return { success: false, error: 'Owner Master Key file or valid cryptographic signature required.' };
  }

  return { success: true };
}

export interface AutoRenewPolicy {
  enabled: boolean;
  renew_tier: string;
  max_renewals: number;
  renewals_count?: number;
}

export function getAutoRenewPolicy(db: any): AutoRenewPolicy | null {
  if (!db) return null;
  try {
    initHardwareLicenseSchema(db);
    const row = db.prepare('SELECT auto_renew_policy FROM _flo_hardware_license WHERE id = 1').get() as any;
    if (row?.auto_renew_policy) {
      return JSON.parse(row.auto_renew_policy);
    }
  } catch {}
  return null;
}

export function setAutoRenewPolicy(db: any, policy: AutoRenewPolicy | null): boolean {
  if (!db) return false;
  try {
    initHardwareLicenseSchema(db);
    const serialized = policy ? JSON.stringify(policy) : null;
    db.prepare('UPDATE _flo_hardware_license SET auto_renew_policy = ? WHERE id = 1').run(serialized);
    return true;
  } catch {}
  return false;
}

export function checkAndApplyAutoRenew(db: any): { renewed: boolean; tier?: string; reason?: string; expires_at?: number | null } {
  if (!db) return { renewed: false, reason: 'no_db' };
  try {
    initHardwareLicenseSchema(db);
    const policy = getAutoRenewPolicy(db);
    if (!policy || !policy.enabled) return { renewed: false, reason: 'policy_disabled' };

    const remaining = policy.max_renewals !== undefined && policy.renewals_count !== undefined
      ? policy.max_renewals - policy.renewals_count
      : (policy as any).remaining_renewals ?? 999;
    if (remaining <= 0) return { renewed: false, reason: 'max_renewals_reached' };

    const license = verifyHardwareLicense(db);
    const nowMs = Date.now();
    const isExpiringSoon = typeof license.expires_at === 'number' && (license.expires_at - nowMs) <= 86_400_000;
    const isExpired = !license.valid && license.reason === 'license_expired';

    if (!isExpiringSoon && !isExpired) {
      return { renewed: false, reason: 'not_expiring' };
    }

    const renewTier = (policy.renew_tier as LicenseTier) || '1m';
    const durationMs = TIER_DURATIONS[renewTier] || 2_592_000_000;
    const baseTime = (license.expires_at && license.expires_at > nowMs) ? license.expires_at : nowMs;
    const newExpiresAt = baseTime + durationMs;

    const currentHwid = getHardwareFingerprint();
    const updatedPayload = {
      hwid: currentHwid,
      tier: renewTier,
      activated_at: nowMs,
      expires_at: newExpiresAt,
      nonce: crypto.randomUUID(),
      auto_renewed: true,
    };
    const canonicalPayload = JSON.stringify(updatedPayload);

    db.prepare(`
      UPDATE _flo_hardware_license
      SET payload = ?, tier = ?, expires_at = ?, max_seen_timestamp = ?, updated_at = datetime('now')
      WHERE id = 1
    `).run(canonicalPayload, renewTier, newExpiresAt, nowMs);

    const updatedCount = (policy.renewals_count || 0) + 1;
    const updatedPolicy: AutoRenewPolicy = {
      ...policy,
      renewals_count: updatedCount,
    };
    (updatedPolicy as any).remaining_renewals = Math.max(0, remaining - 1);
    (updatedPolicy as any).last_renewed_at = nowMs;
    setAutoRenewPolicy(db, updatedPolicy);

    db.prepare(`
      INSERT INTO _flo_hardware_license_history (tier, hwid, activated_at, expires_at, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(renewTier, currentHwid, nowMs, newExpiresAt);

    return { renewed: true, tier: renewTier, expires_at: newExpiresAt };
  } catch (err: any) {
    return { renewed: false, reason: err.message };
  }
}

