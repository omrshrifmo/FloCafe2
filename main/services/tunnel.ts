import { getSettingValue, setSettingValue } from '../db';

export interface TunnelState {
  enabled: boolean;
  status: 'disabled' | 'stopped' | 'running' | 'killed' | 'error';
  killSwitchActive: boolean;
  subdomain: string;
  publicUrl: string | null;
  lastConnectedAt: string | null;
  errorMessage?: string;
}

let activeTunnelInstance: any = null;
let lastConnectedTime: string | null = null;
let currentErrorMessage: string | undefined = undefined;

export class TunnelService {
  static getStatus(): TunnelState {
    const enabled = getSettingValue('tunnel_enabled') === '1';
    const killSwitch = getSettingValue('tunnel_kill_switch') === '1';
    const subdomain = getSettingValue('tunnel_subdomain') || '';

    let status: TunnelState['status'] = 'disabled';
    if (killSwitch) {
      status = 'killed';
    } else if (!enabled) {
      status = 'disabled';
    } else if (activeTunnelInstance) {
      status = 'running';
    } else {
      status = 'stopped';
    }

    return {
      enabled,
      status,
      killSwitchActive: killSwitch,
      subdomain,
      publicUrl: (activeTunnelInstance && subdomain) ? `https://${subdomain}.tunnl.gg` : null,
      lastConnectedAt: lastConnectedTime,
      errorMessage: currentErrorMessage,
    };
  }

  static async startTunnel(): Promise<TunnelState> {
    const status = this.getStatus();
    if (status.killSwitchActive) {
      throw new Error('Tunnel is blocked by emergency kill switch. Reset kill switch before starting.');
    }
    if (!status.enabled) {
      throw new Error('Tunnel is not enabled in settings. Owner must enable remote access first.');
    }
    const token = getSettingValue('tunnel_token');
    if (!token) {
      throw new Error('Tunnel token not configured');
    }

    try {
      // Set instance state (simulated/managed daemon reference)
      activeTunnelInstance = {
        startedAt: new Date().toISOString(),
        tokenPreview: token.substring(0, 4) + '***',
      };
      lastConnectedTime = new Date().toISOString();
      currentErrorMessage = undefined;
      return this.getStatus();
    } catch (err: any) {
      activeTunnelInstance = null;
      currentErrorMessage = err.message;
      throw err;
    }
  }

  static stopTunnel(): TunnelState {
    activeTunnelInstance = null;
    return this.getStatus();
  }

  static emergencyKill(): TunnelState {
    activeTunnelInstance = null;
    setSettingValue('tunnel_kill_switch', '1');
    setSettingValue('tunnel_enabled', '0');
    currentErrorMessage = 'Emergency kill switch activated by owner.';
    return this.getStatus();
  }

  static resetKillSwitch(): TunnelState {
    setSettingValue('tunnel_kill_switch', '0');
    currentErrorMessage = undefined;
    return this.getStatus();
  }
}
