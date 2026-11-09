'use strict';

const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

let cachedHwid = null;

function readStableMachineId() {
  const platform = os.platform();
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
    for (const p of ['/etc/machine-id', '/var/lib/dbus/machine-id', '/sys/class/dmi/id/product_uuid']) {
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
  return machineId || 'default-node-id';
}

function formatHwid(parts) {
  const combined = parts.join('|');
  const fullHash = crypto.createHash('sha256').update(combined).digest('hex').toUpperCase();
  return `FLOHW-${fullHash.slice(0, 4)}-${fullHash.slice(4, 8)}-${fullHash.slice(8, 12)}-${fullHash.slice(12, 16)}`;
}

function getPrimaryMac() {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces).sort()) {
      if (/veth|docker|br-|tun|tap/i.test(name)) continue;
      for (const iface of interfaces[name]) {
        if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
          return iface.mac.toLowerCase();
        }
      }
    }
  } catch {}
  return '';
}

function getHardwareFingerprint() {
  if (cachedHwid) return cachedHwid;

  const machineId = readStableMachineId();
  const cpus = os.cpus() || [];
  const cpuModel = cpus[0]?.model || os.arch();
  const cpuCores = cpus.length;
  const totalMem2GB = Math.round(os.totalmem() / (2 * 1024 * 1024 * 1024));

  const parts = [
    `mid:${machineId}`,
    `cpu:${cpuModel}:${cpuCores}`,
    `mem:${totalMem2GB}`,
  ];

  const formatted = formatHwid(parts);
  cachedHwid = formatted;
  return formatted;
}

function getCompatibleHardwareFingerprints() {
  const set = new Set();
  const machineId = readStableMachineId();
  const cpus = os.cpus() || [];
  const cpuModel = cpus[0]?.model || os.arch();
  const cpuCores = cpus.length;
  const mem2GB = Math.round(os.totalmem() / (2 * 1024 * 1024 * 1024));
  const mem512MB = Math.round(os.totalmem() / (512 * 1024 * 1024));
  const mac = getPrimaryMac();
  const host = (os.hostname() || 'flocafe-node').toLowerCase();

  // Canonical (mem2GB, no mac/host)
  set.add(formatHwid([`mid:${machineId}`, `cpu:${cpuModel}:${cpuCores}`, `mem:${mem2GB}`]));

  // Legacy variants
  for (const mem of [mem2GB, mem512MB]) {
    const base = [`mid:${machineId}`, `cpu:${cpuModel}:${cpuCores}`, `mem:${mem}`];
    set.add(formatHwid(base));
    if (mac) {
      set.add(formatHwid([...base, `mac:${mac}`]));
      set.add(formatHwid([...base, `mac:${mac}`, `host:${host}`]));
    }
    set.add(formatHwid([...base, `host:${host}`]));
  }

  return set;
}

function clearCachedHwidForTest() {
  cachedHwid = null;
}

module.exports = {
  getHardwareFingerprint,
  readStableMachineId,
  getCompatibleHardwareFingerprints,
  clearCachedHwidForTest,
};
