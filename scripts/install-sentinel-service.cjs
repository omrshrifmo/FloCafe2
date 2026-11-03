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
console.log(`[Sentinel Installer] Node/Electron binary: ${nodeBin}`);
console.log(`[Sentinel Installer] Daemon script: ${daemonScript}`);

if (platform === 'win32') {
  const taskName = 'FloCafeSentinelDaemon';
  const appDataDir = process.env.APPDATA ? path.join(process.env.APPDATA, 'flo-desktop') : path.join(os.homedir(), 'AppData', 'Roaming', 'flo-desktop');
  if (!fs.existsSync(appDataDir)) fs.mkdirSync(appDataDir, { recursive: true });
  const wrapperCmd = path.join(appDataDir, 'run-sentinel.cmd');

  if (isUninstall) {
    try {
      execSync(`schtasks /Delete /TN "${taskName}" /F`, { stdio: 'ignore' });
      console.log(`[Sentinel Installer] Windows Task "${taskName}" removed.`);
    } catch {}
    try {
      execSync(`reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "FloCafeSentinel" /f`, { stdio: 'ignore' });
      console.log(`[Sentinel Installer] HKCU Run entry removed.`);
    } catch {}
    if (fs.existsSync(wrapperCmd)) {
      try { fs.unlinkSync(wrapperCmd); } catch {}
    }
  } else {
    // Generate wrapper script with ELECTRON_RUN_AS_NODE=1
    const cmdContent = `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\nstart "" /B "${nodeBin}" "${daemonScript}"\r\n`;
    fs.writeFileSync(wrapperCmd, cmdContent, 'utf8');
    console.log(`[Sentinel Installer] Created wrapper cmd: ${wrapperCmd}`);

    // 1. Current-User Run Registry Entry (100% reliable, no elevation prompts)
    try {
      execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "FloCafeSentinel" /t REG_SZ /d "\\"${wrapperCmd}\\"" /f`, { stdio: 'inherit' });
      console.log('[Sentinel Installer] Registered in HKCU Run startup.');
    } catch (regErr) {
      console.warn('[Sentinel Installer] Registry run entry note:', regErr.message);
    }

    // 2. Task Scheduler fallback
    try {
      const taskCmd = `schtasks /Create /SC ONLOGON /RL LIMITED /TN "${taskName}" /TR "\\"${wrapperCmd}\\"" /F`;
      execSync(taskCmd, { stdio: 'inherit' });
      console.log(`[Sentinel Installer] Windows Task "${taskName}" registered.`);
      try { execSync(`schtasks /Run /TN "${taskName}"`, { stdio: 'ignore' }); } catch {}
    } catch (taskErr) {
      console.warn('[Sentinel Installer] Task Scheduler registration note (HKCU Run will handle startup):', taskErr.message);
    }
  }
} else {
  // Linux systemd user service + autostart desktop entry fallback
  const systemdDir = path.join(os.homedir(), '.config', 'systemd', 'user');
  const serviceFile = path.join(systemdDir, 'flocafe-sentinel.service');
  const autostartDir = path.join(os.homedir(), '.config', 'autostart');
  const desktopFile = path.join(autostartDir, 'flocafe-sentinel.desktop');

  if (isUninstall) {
    try {
      execSync('systemctl --user stop flocafe-sentinel.service', { stdio: 'ignore' });
      execSync('systemctl --user disable flocafe-sentinel.service', { stdio: 'ignore' });
      if (fs.existsSync(serviceFile)) fs.unlinkSync(serviceFile);
      execSync('systemctl --user daemon-reload', { stdio: 'ignore' });
      console.log('[Sentinel Installer] Systemd user service removed.');
    } catch {}
    if (fs.existsSync(desktopFile)) {
      try { fs.unlinkSync(desktopFile); } catch {}
      console.log('[Sentinel Installer] Autostart desktop entry removed.');
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
Environment=ELECTRON_RUN_AS_NODE=1
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
      console.warn(`[Sentinel Installer] Systemd configuration note:`, err.message);
    }

    // Autostart fallback for non-systemd / XDG sessions
    try {
      if (!fs.existsSync(autostartDir)) fs.mkdirSync(autostartDir, { recursive: true });
      const desktopContent = `[Desktop Entry]
Type=Application
Name=FloCafe Sentinel Daemon
Exec=env ELECTRON_RUN_AS_NODE=1 "${nodeBin}" "${daemonScript}"
Terminal=false
X-GNOME-Autostart-enabled=true
`;
      fs.writeFileSync(desktopFile, desktopContent, 'utf8');
      console.log(`[Sentinel Installer] Wrote autostart desktop file: ${desktopFile}`);
    } catch {}
  }
}
