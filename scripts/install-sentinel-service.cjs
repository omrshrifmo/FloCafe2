#!/usr/bin/env node
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const isUninstall = process.argv.includes('--uninstall') || process.argv.includes('-u');
const platform = os.platform();
const projectRoot = path.resolve(__dirname, '..');
const daemonScript = path.join(projectRoot, 'scripts', 'flocafe-sentinel.cjs');
const nodeBin = process.execPath;

console.log(`[Sentinel Installer] Target Platform: ${platform}`);
console.log(`[Sentinel Installer] Node binary: ${nodeBin}`);
console.log(`[Sentinel Installer] Daemon script: ${daemonScript}`);

if (platform === 'win32') {
  // Windows Task Scheduler Service
  const taskName = 'FloCafeSentinelDaemon';
  if (isUninstall) {
    try {
      execSync(`schtasks /Delete /TN "${taskName}" /F`, { stdio: 'inherit' });
      console.log(`[Sentinel Installer] Windows Task "${taskName}" removed successfully.`);
    } catch (err) {
      console.warn(`[Sentinel Installer] Windows Task remove note: ${err.message}`);
    }
  } else {
    try {
      const cmd = `schtasks /Create /SC ONLOGON /RL HIGHEST /TN "${taskName}" /TR "\\"${nodeBin}\\" \\"${daemonScript}\\"" /F`;
      execSync(cmd, { stdio: 'inherit' });
      console.log(`[Sentinel Installer] Windows Task "${taskName}" registered successfully (runs on logon).`);
      // Optionally start immediately
      try {
        execSync(`schtasks /Run /TN "${taskName}"`, { stdio: 'inherit' });
      } catch {}
    } catch (err) {
      console.error(`[Sentinel Installer] Failed to register Windows Task:`, err.message);
      process.exit(1);
    }
  }
} else {
  // Linux systemd user service
  const systemdDir = path.join(os.homedir(), '.config', 'systemd', 'user');
  const serviceFile = path.join(systemdDir, 'flocafe-sentinel.service');

  if (isUninstall) {
    try {
      execSync('systemctl --user stop flocafe-sentinel.service', { stdio: 'ignore' });
      execSync('systemctl --user disable flocafe-sentinel.service', { stdio: 'ignore' });
      if (fs.existsSync(serviceFile)) fs.unlinkSync(serviceFile);
      execSync('systemctl --user daemon-reload', { stdio: 'ignore' });
      console.log('[Sentinel Installer] Linux systemd user service removed successfully.');
    } catch (err) {
      console.warn(`[Sentinel Installer] Linux service uninstall note: ${err.message}`);
    }
  } else {
    try {
      if (!fs.existsSync(systemdDir)) fs.mkdirSync(systemdDir, { recursive: true });

      const unitContent = `[Unit]
Description=FloCafe Sentinel Background OS Daemon
After=network.target

[Service]
Type=simple
WorkingDirectory=${projectRoot}
ExecStart=${nodeBin} ${daemonScript}
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=SENTINEL_PORT=3009

[Install]
WantedBy=default.target
`;

      fs.writeFileSync(serviceFile, unitContent, 'utf8');
      console.log(`[Sentinel Installer] Wrote service unit to: ${serviceFile}`);

      execSync('systemctl --user daemon-reload', { stdio: 'inherit' });
      execSync('systemctl --user enable flocafe-sentinel.service', { stdio: 'inherit' });
      execSync('systemctl --user restart flocafe-sentinel.service', { stdio: 'inherit' });
      console.log('[Sentinel Installer] Linux systemd service flocafe-sentinel.service enabled and started!');
    } catch (err) {
      console.warn(`[Sentinel Installer] Systemd configuration note (can run manually in containers):`, err.message);
    }
  }
}
