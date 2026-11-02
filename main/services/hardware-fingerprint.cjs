'use strict';

const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

let cachedHwid = null;

function getHardwareFingerprint() {
  if (cachedHwid) return cachedHwid;

  const parts = [];
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
      for (const iface of interfaces[name]) {
        if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
          primaryMac = iface.mac.toLowerCase();
          break;
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

function clearCachedHwidForTest() {
  cachedHwid = null;
}

module.exports = {
  getHardwareFingerprint,
  clearCachedHwidForTest,
};
