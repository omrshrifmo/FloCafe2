#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const TIERS = [
  { tier: 'forever', label: 'Forever / Perpetual License', duration_ms: null },
  { tier: '24h', label: '24 Hours License', duration_ms: 86_400_000 },
  { tier: '3d', label: '3 Days License', duration_ms: 259_200_000 },
  { tier: '1w', label: '1 Week (7 Days) License', duration_ms: 604_800_000 },
  { tier: '1m', label: '1 Month (30 Days) License', duration_ms: 2_592_000_000 },
  { tier: '3m', label: '3 Months (90 Days) License', duration_ms: 7_776_000_000 },
  { tier: '6m', label: '6 Months (180 Days) License', duration_ms: 15_552_000_000 },
  { tier: '1y', label: '1 Year (365 Days) License', duration_ms: 31_536_000_000 },
];

const MASTER_TIER = {
  tier: 'owner_reactivate_master',
  label: 'Owner Re-Activation Master Key',
  duration_ms: null,
};

const PASSWORD_PLAIN = 'Fl0220671190';

// Destination directories
const repoDir = path.resolve(__dirname, '..');
const localKeysDir = path.join(repoDir, 'owner-private-keys');
const homeOwnerDir = path.join(os.homedir(), 'FloCafe-Owner-Private-Keys');

fs.mkdirSync(localKeysDir, { recursive: true });
fs.mkdirSync(homeOwnerDir, { recursive: true });

console.log('Generating / Loading FloCafe Cryptographic Ed25519 License Keypairs...');

const generatedKeys = {};

// Helper to generate or load key
function getOrCreateKey(item, isMaster = false) {
  const fileName = isMaster ? 'owner-reactivate-master.flokey' : `${item.tier}.flokey`;
  const primaryPath = path.join(homeOwnerDir, fileName);
  const fallbackPath = path.join(localKeysDir, fileName);

  let existing = null;
  for (const p of [primaryPath, fallbackPath]) {
    if (fs.existsSync(p)) {
      try {
        existing = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (existing.private_key_pem && existing.public_key_pem) {
          break;
        }
      } catch {}
    }
  }

  let privateKeyPem;
  let publicKeyPem;

  if (existing && existing.private_key_pem && existing.public_key_pem) {
    privateKeyPem = existing.private_key_pem;
    publicKeyPem = existing.public_key_pem;
    console.log(`Loaded existing key: ${fileName}`);
  } else {
    const keyPair = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    publicKeyPem = keyPair.publicKey;
    privateKeyPem = keyPair.privateKey;
    console.log(`Generated new Ed25519 keypair: ${fileName}`);
  }

  const pubFingerprint = crypto.createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 16);

  const flokeyObject = {
    version: 1,
    key_type: isMaster ? 'owner_master' : 'tier',
    tier: item.tier,
    label: item.label,
    duration_ms: item.duration_ms,
    private_key_pem: privateKeyPem,
    public_key_pem: publicKeyPem,
    public_key_fingerprint: pubFingerprint,
    usage_count: existing?.usage_count || 0,
    bound_hwids: existing?.bound_hwids || [],
    created_at: existing?.created_at || new Date().toISOString(),
  };

  const jsonStr = JSON.stringify(flokeyObject, null, 2);
  fs.writeFileSync(primaryPath, jsonStr, { mode: 0o600 });
  fs.writeFileSync(fallbackPath, jsonStr, { mode: 0o600 });

  return {
    ...item,
    isMaster,
    publicKeyPem,
    privateKeyPem,
    pubFingerprint,
    flokeyObject,
  };
}

// Generate/Load Tier Keys
for (const t of TIERS) {
  generatedKeys[t.tier] = getOrCreateKey(t, false);
}

// Generate/Load Master Key
const masterKey = getOrCreateKey(MASTER_TIER, true);
generatedKeys.owner_reactivate_master = masterKey;

// Generate Salt & Scrypt Hash for Password
const salt = crypto.randomBytes(16).toString('hex');
const passwordHash = crypto.scryptSync(PASSWORD_PLAIN, salt, 64).toString('hex');

console.log('\n============================================================');
console.log('FloCafe Owner License Cryptographic Summary');
console.log('============================================================');
console.log(`Saved 9 Private Keys to:`);
console.log(`  1. ${homeOwnerDir}`);
console.log(`  2. ${localKeysDir}`);
console.log(`\nReactivation Password Salt: ${salt}`);
console.log(`Reactivation Password Scrypt Hash (64 bytes): ${passwordHash}`);
console.log('\nTier Public Keys:');
for (const [tier, data] of Object.entries(generatedKeys)) {
  console.log(`\n--- Tier: ${tier} (${data.label}) ---`);
  console.log(data.publicKeyPem.trim());
}

// Auto-activate current developer machine
try {
  const { getHardwareFingerprint } = require('../main/services/hardware-fingerprint.cjs');
  const hwid = getHardwareFingerprint();
  console.log(`\nDetected Developer Machine HWID: ${hwid}`);

  // Create forever activation payload
  const payload = {
    hwid,
    tier: 'forever',
    activated_at: Date.now(),
    expires_at: null,
    nonce: crypto.randomUUID(),
  };
  const canonicalPayload = JSON.stringify(payload);
  const signature = crypto.sign(null, Buffer.from(canonicalPayload, 'utf8'), generatedKeys.forever.privateKeyPem).toString('base64');

  const anchor = {
    payload: canonicalPayload,
    signature,
    tier: 'forever',
    hwid,
    activated_at: payload.activated_at,
    expires_at: null,
    max_seen_timestamp: Date.now(),
    updated_at: new Date().toISOString(),
  };

  // Write to userData anchor (~/.config/flo-desktop/.hw-license-anchor.json)
  const userDataDir = path.join(os.homedir(), '.config', 'flo-desktop');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(path.join(userDataDir, '.hw-license-anchor.json'), JSON.stringify(anchor, null, 2), { mode: 0o600 });

  // Write to OS seal (~/.local/share/.flocafe-hw-seal)
  const osSealDir = path.join(os.homedir(), '.local', 'share');
  fs.mkdirSync(osSealDir, { recursive: true });
  fs.writeFileSync(path.join(osSealDir, '.flocafe-hw-seal'), JSON.stringify(anchor, null, 2), { mode: 0o600 });

  console.log('✅ Developer machine successfully auto-activated with Forever License anchor.');
} catch (e) {
  console.log(`Note: Developer machine anchor will be written once hardware fingerprint service is compiled (${e.message}).`);
}

module.exports = {
  generatedKeys,
  salt,
  passwordHash,
};
