import { Router } from 'express';
import { requirePermission } from '../services/authorization';
import { TunnelService } from '../services/tunnel';
import { setSettingValue } from '../db';

export const tunnelRoutes = Router();

// Tunnel status
tunnelRoutes.get('/status', requirePermission('mobile-access.manage'), (req, res) => {
  res.json(TunnelService.getStatus());
});

// Configure tunnel
tunnelRoutes.post('/config', requirePermission('mobile-access.manage'), (req, res) => {
  try {
    const { enabled, subdomain, token } = req.body;
    if (enabled !== undefined) {
      setSettingValue('tunnel_enabled', enabled ? '1' : '0');
    }
    if (subdomain !== undefined) {
      setSettingValue('tunnel_subdomain', String(subdomain).trim());
    }
    if (token !== undefined) {
      setSettingValue('tunnel_token', String(token).trim());
    }
    res.json(TunnelService.getStatus());
  } catch (error: any) {
    console.error('[API] Error configuring tunnel:', error);
    res.status(500).json({ error: 'Failed to configure tunnel' });
  }
});

// Start tunnel
tunnelRoutes.post('/start', requirePermission('mobile-access.manage'), async (req, res) => {
  try {
    const status = await TunnelService.startTunnel();
    res.json(status);
  } catch (error: any) {
    console.error('[API] Error starting tunnel:', error);
    res.status(400).json({ error: error.message || 'Failed to start tunnel' });
  }
});

// Stop tunnel
tunnelRoutes.post('/stop', requirePermission('mobile-access.manage'), (req, res) => {
  try {
    const status = TunnelService.stopTunnel();
    res.json(status);
  } catch (error: any) {
    console.error('[API] Error stopping tunnel:', error);
    res.status(500).json({ error: 'Failed to stop tunnel' });
  }
});

// Emergency kill switch
tunnelRoutes.post('/kill', requirePermission('mobile-access.manage'), (req, res) => {
  try {
    const status = TunnelService.emergencyKill();
    res.json(status);
  } catch (error: any) {
    console.error('[API] Error triggering tunnel kill switch:', error);
    res.status(500).json({ error: 'Failed to trigger kill switch' });
  }
});

// Reset emergency kill switch
tunnelRoutes.post('/reset-kill', requirePermission('mobile-access.manage'), (req, res) => {
  try {
    const status = TunnelService.resetKillSwitch();
    res.json(status);
  } catch (error: any) {
    console.error('[API] Error resetting kill switch:', error);
    res.status(500).json({ error: 'Failed to reset kill switch' });
  }
});
