import fs from 'fs';
import path from 'path';
import os from 'os';

export function getScreenSnapshotPath(): string {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, '.flocafe-last-screen.json');
  }
  return path.join(os.homedir(), '.local', 'share', '.flocafe-last-screen.json');
}

export interface ScreenSnapshotData {
  timestamp: number;
  capture_type: 'window_capture' | 'headless_telemetry';
  window_visible?: boolean;
  active_url?: string;
  resolution?: { width: number; height: number };
  memory_mb: number;
  uptime_sec: number;
  image_base64?: string | null;
}

export function readLatestScreenSnapshot(): ScreenSnapshotData | null {
  try {
    const snapPath = getScreenSnapshotPath();
    if (fs.existsSync(snapPath)) {
      return JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    }
  } catch {}
  return null;
}

export function writeScreenSnapshot(data: ScreenSnapshotData): void {
  try {
    const snapPath = getScreenSnapshotPath();
    fs.mkdirSync(path.dirname(snapPath), { recursive: true });
    const tmp = `${snapPath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, snapPath);
  } catch {}
}

export async function captureAndStoreScreenSnapshot(window?: any): Promise<ScreenSnapshotData> {
  const memMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
  const uptime = Math.round(process.uptime());

  let imageBase64: string | null = null;
  let activeUrl: string | undefined;
  let resolution: { width: number; height: number } | undefined;
  let isVisible = false;

  if (window && !window.isDestroyed()) {
    try {
      isVisible = window.isVisible();
      const bounds = window.getBounds();
      resolution = { width: bounds.width, height: bounds.height };
      activeUrl = window.webContents?.getURL?.() || undefined;

      const image = await window.webContents.capturePage();
      if (!image.isEmpty()) {
        const resized = image.resize({ width: 640 });
        imageBase64 = resized.toJPEG(60).toString('base64');
      }
    } catch {}
  }

  const snapshot: ScreenSnapshotData = {
    timestamp: Date.now(),
    capture_type: imageBase64 ? 'window_capture' : 'headless_telemetry',
    window_visible: isVisible,
    active_url: activeUrl,
    resolution,
    memory_mb: memMb,
    uptime_sec: uptime,
    image_base64: imageBase64,
  };

  writeScreenSnapshot(snapshot);
  return snapshot;
}

let snapshotInterval: NodeJS.Timeout | null = null;

export function startScreenSnapshotInterval(getWindow: () => any, intervalMs = 30000): void {
  if (snapshotInterval) return;
  void captureAndStoreScreenSnapshot(getWindow());
  snapshotInterval = setInterval(() => {
    void captureAndStoreScreenSnapshot(getWindow());
  }, intervalMs);
  if (snapshotInterval.unref) snapshotInterval.unref();
}

export function stopScreenSnapshotInterval(): void {
  if (snapshotInterval) {
    clearInterval(snapshotInterval);
    snapshotInterval = null;
  }
}

