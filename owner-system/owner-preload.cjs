/**
 * FloOwner Control System v4.6.1 - Standalone Native Desktop Preload Script
 * Secure IPC bridge exposing native capabilities to flo-owner-control.html.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  version: '4.6.1',
  listLocalKeys: () => ipcRenderer.invoke('owner:list-local-keys'),
  readLocalKey: (filePath) => ipcRenderer.invoke('owner:read-local-key', filePath),
  verifyPassword: (password) => ipcRenderer.invoke('owner:verify-password', password),
  scanSubnet: (prefix) => ipcRenderer.invoke('owner:scan-subnet', prefix),
  launchMcp: (options) => ipcRenderer.invoke('owner:mcp-launch', options),
});
