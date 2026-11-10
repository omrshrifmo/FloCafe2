/**
 * FloOwner Control System v4.9.2 - Standalone Native Desktop Main Process
 * Lightweight Electron launcher dedicated to FloCafe remote fleet administration.
 */

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REACTIVATION_PASSWORD_SALT = '2e213237f422524e1ddbe09c8682cc04';
const REACTIVATION_PASSWORD_HASH = 'ce531f792c2a3a6eda85dd7660e776d73282c4d24a8fca442aef36903f1184761878ed9d6041a86556d4f2f224463ed203953c4a2fa0be787bb6c239a334bdbd';

let mainWindow = null;
let activeMcpProcess = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'FloOwner Control System v4.9.2',
    autoHideMenuBar: true,
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, 'owner-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const htmlPath = path.join(__dirname, 'flo-owner-control.html');
  mainWindow.loadFile(htmlPath);

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (activeMcpProcess) {
      try {
        activeMcpProcess.kill();
      } catch {}
    }
  });
}

// IPC Handlers

// 1. List local owner private keys
ipcMain.handle('owner:list-local-keys', async () => {
  const candidateDirs = [
    '/home/omrshrifmo/FloCafe-Owner-Private-Keys',
    path.join(os.homedir(), 'FloCafe-Owner-Private-Keys'),
    path.resolve(process.cwd(), 'owner-private-keys'),
    path.resolve(__dirname, '../owner-private-keys'),
    path.resolve(__dirname, 'owner-private-keys'),
    path.join(process.resourcesPath || '', 'owner-private-keys'),
  ];

  const foundKeys = [];
  const seenNames = new Set();

  for (const dir of candidateDirs) {
    try {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          if ((file.endsWith('.flokey') || file.endsWith('.json')) && !seenNames.has(file)) {
            const fullPath = path.join(dir, file);
            try {
              const content = fs.readFileSync(fullPath, 'utf8');
              let parsed = null;
              try {
                parsed = JSON.parse(content);
              } catch {}
              seenNames.add(file);
              foundKeys.push({
                name: file,
                path: fullPath,
                content,
                data: parsed,
              });
            } catch {}
          }
        }
      }
    } catch {}
  }

  // Auto-generate unified Mobile Vault Bundle if keys were found
  if (foundKeys.length > 0) {
    try {
      const bundleDir = '/home/omrshrifmo/FloCafe-Owner-Private-Keys';
      const bundleFile = path.join(bundleDir, 'flo-owner-vault-bundle.flokey');
      if (fs.existsSync(bundleDir)) {
        const validIndividualKeys = foundKeys.filter((k) => k.name !== 'flo-owner-vault-bundle.flokey' && k.data?.key_type);
        if (validIndividualKeys.length > 0) {
          const bundleObj = {
            bundle_type: 'flo_owner_vault_bundle',
            version: 1,
            generated_at: new Date().toISOString(),
            keys_count: validIndividualKeys.length,
            keys: validIndividualKeys.map((k) => ({
              name: k.name,
              tier: k.data?.tier || (k.name.includes('master') ? 'owner_reactivate_master' : k.name.replace(/\.flokey$/, '')),
              key_type: k.data?.key_type || (k.name.includes('master') ? 'owner_master' : 'tier'),
              content: k.content,
              data: k.data,
            })),
          };
          fs.writeFileSync(bundleFile, JSON.stringify(bundleObj, null, 2), { mode: 0o600 });
        }
      }
    } catch (e) {
      console.warn('[Owner Main] Could not write flo-owner-vault-bundle.flokey:', e);
    }
  }

  return foundKeys;
});

// 2. Read specific local key file
ipcMain.handle('owner:read-local-key', async (_event, filePath) => {
  if (!filePath || typeof filePath !== 'string') return null;
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
  } catch (err) {
    console.error('[Owner Main] Error reading key file:', err);
  }
  return null;
});

// 3. Verify owner password natively with scrypt
ipcMain.handle('owner:verify-password', async (_event, password) => {
  if (!password || typeof password !== 'string') return false;
  try {
    const computedHash = crypto.scryptSync(password, REACTIVATION_PASSWORD_SALT, 64).toString('hex');
    return computedHash === REACTIVATION_PASSWORD_HASH;
  } catch {
    return false;
  }
});

// 4. Subnet scanning via native Node HTTP
ipcMain.handle('owner:scan-subnet', async (_event, prefix) => {
  const basePrefix = prefix && typeof prefix === 'string' ? prefix : '192.168.1';
  const checks = [];

  for (let i = 1; i <= 254; i++) {
    const ip = `${basePrefix}.${i}`;
    checks.push(
      new Promise((resolve) => {
        const req = http.get(
          {
            hostname: ip,
            port: 3009,
            path: '/api/sentinel/ping',
            timeout: 1000,
          },
          (res) => {
            if (res.statusCode === 200) {
              let body = '';
              res.setEncoding('utf8');
              res.on('data', (chunk) => {
                body += chunk;
              });
              res.on('end', () => {
                try {
                  const pingData = JSON.parse(body);
                  resolve({
                    url: `http://${ip}:3009`,
                    name: pingData.node_name || `FloCafe (${ip})`,
                    ping: pingData,
                  });
                } catch {
                  resolve(null);
                }
              });
            } else {
              resolve(null);
            }
          }
        );

        req.on('error', () => resolve(null));
        req.on('timeout', () => {
          req.destroy();
          resolve(null);
        });
      })
    );
  }

  const results = await Promise.all(checks);
  return results.filter(Boolean);
});

// 5. Native MCP launch
ipcMain.handle('owner:mcp-launch', async (_event, options) => {
  const mcpScriptPath = path.resolve(__dirname, '../scripts/flocafe-owner-mcp.cjs');
  const fallbackMcp = path.resolve(__dirname, 'flocafe-owner-mcp.cjs');
  const targetScript = fs.existsSync(mcpScriptPath) ? mcpScriptPath : fallbackMcp;

  if (!fs.existsSync(targetScript)) {
    return { success: false, error: 'MCP server script not found' };
  }

  if (activeMcpProcess) {
    return { success: true, running: true, message: 'MCP server already active' };
  }

  try {
    const env = {
      ...process.env,
      FLOCAFE_OWNER_PASSWORD: options?.password || 'Fl0220671190',
    };
    activeMcpProcess = spawn('node', [targetScript], {
      env,
      stdio: 'pipe',
    });

    activeMcpProcess.on('exit', () => {
      activeMcpProcess = null;
    });

    return { success: true, running: true, pid: activeMcpProcess.pid };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// App lifecycle
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
