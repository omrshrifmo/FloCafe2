import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { getDatabase, now } from '../db';

export interface ReceiptLogoMetadata {
  id: string;
  filename: string;
  mimeType: string;
  width: number;
  height: number;
  sha256: string;
  dataUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImageParseResult {
  format: 'png' | 'jpeg' | 'webp';
  width: number;
  height: number;
}

const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB limit
const MAX_DIMENSION = 4096; // 4096 px limit to protect against decompression bombs

/** Sanitizes an uploaded filename to prevent directory traversal. */
export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') return 'logo.png';
  const basename = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  return basename.length > 0 ? basename : 'logo.png';
}

/** Resolves directory used for local regenerable logo disk cache. */
export function getBrandingMediaDir(): string {
  const userData = app?.getPath ? app.getPath('userData') : process.cwd();
  const brandingDir = path.join(userData, 'media', 'branding');
  if (!fs.existsSync(brandingDir)) {
    fs.mkdirSync(brandingDir, { recursive: true });
  }
  return brandingDir;
}

/** Parses image dimensions and validates format from buffer magic bytes. */
export function validateImageBuffer(buffer: Buffer): ImageParseResult {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Image data is empty');
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`Receipt logo file exceeds 2 MB limit (received ${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
  }

  // 1. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 24 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width <= 0 || height <= 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
      throw new Error(`Image dimensions ${width}x${height} exceed maximum supported ${MAX_DIMENSION}x${MAX_DIMENSION} limit`);
    }
    return { format: 'png', width, height };
  }

  // 2. JPEG: FF D8 FF
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    let offset = 2;
    while (offset < buffer.length - 8) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1];
      // SOF markers: SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2)
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        if (width <= 0 || height <= 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
          throw new Error(`Image dimensions ${width}x${height} exceed maximum supported ${MAX_DIMENSION}x${MAX_DIMENSION} limit`);
        }
        return { format: 'jpeg', width, height };
      }
      if (marker === 0xd9 || marker === 0xda) break; // SOS or EOI
      const length = buffer.readUInt16BE(offset + 2);
      offset += 2 + length;
    }
    throw new Error('Could not parse valid JPEG frame header');
  }

  // 3. WebP: RIFF ... WEBP
  if (
    buffer.length >= 30 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    const chunkHeader = buffer.toString('ascii', 12, 16);
    if (chunkHeader === 'VP8 ') {
      const width = buffer.readUInt16LE(26) & 0x3fff;
      const height = buffer.readUInt16LE(28) & 0x3fff;
      if (width <= 0 || height <= 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
        throw new Error(`Image dimensions ${width}x${height} exceed maximum supported ${MAX_DIMENSION}x${MAX_DIMENSION} limit`);
      }
      return { format: 'webp', width, height };
    }
    if (chunkHeader === 'VP8L') {
      const b0 = buffer[21];
      const b1 = buffer[22];
      const b2 = buffer[23];
      const b3 = buffer[24];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      if (width <= 0 || height <= 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
        throw new Error(`Image dimensions ${width}x${height} exceed maximum supported ${MAX_DIMENSION}x${MAX_DIMENSION} limit`);
      }
      return { format: 'webp', width, height };
    }
    if (chunkHeader === 'VP8X') {
      const width = 1 + buffer.readUIntLE(24, 3);
      const height = 1 + buffer.readUIntLE(27, 3);
      if (width <= 0 || height <= 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
        throw new Error(`Image dimensions ${width}x${height} exceed maximum supported ${MAX_DIMENSION}x${MAX_DIMENSION} limit`);
      }
      return { format: 'webp', width, height };
    }
  }

  throw new Error('Invalid image format. Supported formats: PNG, JPEG, WebP');
}

/** Stores a new receipt logo asset atomically, updates the active pointer, and purges orphans. */
export async function storeReceiptLogo(buffer: Buffer, originalFilename: string): Promise<ReceiptLogoMetadata> {
  const { format, width, height } = validateImageBuffer(buffer);
  const mimeType = format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp';
  const cleanFilename = sanitizeFilename(originalFilename);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const assetId = `logo_${crypto.randomBytes(8).toString('hex')}`;
  const timestamp = now();
  const db = getDatabase();

  const brandingDir = getBrandingMediaDir();
  const cachePath = path.join(brandingDir, `${assetId}.png`);

  // Write new local cache file first
  fs.writeFileSync(cachePath, buffer);

  try {
    db.transaction(() => {
      // 1. Get previous active logo id
      const currentActiveRow = db.prepare("SELECT value FROM settings WHERE key = 'receipt_logo_asset_id'").get() as { value?: string } | undefined;
      const previousAssetId = currentActiveRow?.value?.trim() || null;

      // 2. Insert new asset row
      db.prepare(`
        INSERT INTO receipt_assets (id, kind, filename, mime_type, width, height, sha256, data, created_at, updated_at)
        VALUES (?, 'receipt_logo', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(assetId, cleanFilename, mimeType, width, height, sha256, buffer, timestamp, timestamp);

      // 3. Atomically update settings pointer
      db.prepare(`
        INSERT INTO settings (key, value, updated_at) VALUES ('receipt_logo_asset_id', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(assetId, timestamp);

      // 4. Clean up previous asset row from DB
      if (previousAssetId && previousAssetId !== assetId) {
        db.prepare("DELETE FROM receipt_assets WHERE id = ? AND kind = 'receipt_logo'").run(previousAssetId);
      }
    })();

    // 5. Clean up previous disk cache file after transaction commit
    const currentActive = db.prepare("SELECT value FROM settings WHERE key = 'receipt_logo_asset_id'").get() as { value?: string } | undefined;
    if (currentActive?.value === assetId) {
      const files = fs.readdirSync(brandingDir);
      for (const file of files) {
        if (file.startsWith('logo_') && !file.includes(assetId)) {
          try { fs.unlinkSync(path.join(brandingDir, file)); } catch { }
        }
      }
    }
  } catch (err) {
    // Clean up newly created disk cache if transaction failed
    try { if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath); } catch { }
    throw err;
  }

  return {
    id: assetId,
    filename: cleanFilename,
    mimeType,
    width,
    height,
    sha256,
    dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** Deletes the active receipt logo, clears the setting pointer, and removes the unreferenced asset. */
export async function deleteReceiptLogo(): Promise<boolean> {
  const db = getDatabase();
  const brandingDir = getBrandingMediaDir();

  let assetIdToRemove: string | null = null;
  db.transaction(() => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'receipt_logo_asset_id'").get() as { value?: string } | undefined;
    assetIdToRemove = row?.value?.trim() || null;

    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES ('receipt_logo_asset_id', '', ?)
      ON CONFLICT(key) DO UPDATE SET value = '', updated_at = excluded.updated_at
    `).run(now());

    if (assetIdToRemove) {
      db.prepare("DELETE FROM receipt_assets WHERE id = ? AND kind = 'receipt_logo'").run(assetIdToRemove);
    }
  })();

  if (assetIdToRemove) {
    try {
      const cachePath = path.join(brandingDir, `${assetIdToRemove}.png`);
      if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
    } catch { }
  }

  return true;
}

interface ReceiptAssetRow {
  id: string;
  filename: string;
  mime_type: string;
  width: number;
  height: number;
  sha256: string;
  data?: Buffer;
  created_at: string;
  updated_at: string;
}

/** Fetches active logo metadata, regenerating the local disk cache from DB if missing. */
export function getActiveReceiptLogo(): ReceiptLogoMetadata | null {
  const db = getDatabase();
  const settingRow = db.prepare("SELECT value FROM settings WHERE key = 'receipt_logo_asset_id'").get() as { value?: string } | undefined;
  const activeId = settingRow?.value?.trim();
  if (!activeId) return null;

  const asset = db.prepare("SELECT id, filename, mime_type, width, height, sha256, data, created_at, updated_at FROM receipt_assets WHERE id = ?").get(activeId) as ReceiptAssetRow | undefined;
  if (!asset) return null;

  // Ensure disk cache is present
  const brandingDir = getBrandingMediaDir();
  const cachePath = path.join(brandingDir, `${asset.id}.png`);
  if (!fs.existsSync(cachePath) && asset.data) {
    fs.writeFileSync(cachePath, asset.data);
  }

  const dataUrl = asset.data ? `data:${asset.mime_type};base64,${asset.data.toString('base64')}` : undefined;

  return {
    id: asset.id,
    filename: asset.filename,
    mimeType: asset.mime_type,
    width: asset.width,
    height: asset.height,
    sha256: asset.sha256,
    dataUrl,
    createdAt: asset.created_at,
    updatedAt: asset.updated_at,
  };
}

/** Fetches active logo metadata along with its binary data buffer. */
export function getActiveReceiptLogoAsset(): (ReceiptLogoMetadata & { data: Buffer }) | null {
  const db = getDatabase();
  const settingRow = db.prepare("SELECT value FROM settings WHERE key = 'receipt_logo_asset_id'").get() as { value?: string } | undefined;
  const activeId = settingRow?.value?.trim();
  if (!activeId) return null;

  const asset = db.prepare("SELECT id, filename, mime_type, width, height, sha256, data, created_at, updated_at FROM receipt_assets WHERE id = ?").get(activeId) as ReceiptAssetRow | undefined;
  if (!asset || !asset.data) return null;

  return {
    id: asset.id,
    filename: asset.filename,
    mimeType: asset.mime_type,
    width: asset.width,
    height: asset.height,
    sha256: asset.sha256,
    data: asset.data,
    createdAt: asset.created_at,
    updatedAt: asset.updated_at,
  };
}

/** Fetches active logo data buffer and cache path. */
export function getActiveReceiptLogoData(): { metadata: ReceiptLogoMetadata; data: Buffer; cachePath: string } | null {
  const metadata = getActiveReceiptLogo();
  if (!metadata) return null;

  const db = getDatabase();
  const row = db.prepare("SELECT data FROM receipt_assets WHERE id = ?").get(metadata.id) as { data: Buffer } | undefined;
  if (!row || !row.data) return null;

  const brandingDir = getBrandingMediaDir();
  const cachePath = path.join(brandingDir, `${metadata.id}.png`);
  if (!fs.existsSync(cachePath)) {
    fs.writeFileSync(cachePath, row.data);
  }

  return {
    metadata,
    data: row.data,
    cachePath,
  };
}

/** Rehydrates local disk cache files from SQLite receipt_assets and cleans orphans. Returns count of restored files. */
export function rehydrateReceiptAssets(): number {
  let rehydratedCount = 0;
  try {
    const db = getDatabase();
    const brandingDir = getBrandingMediaDir();

    const activeRow = db.prepare("SELECT value FROM settings WHERE key = 'receipt_logo_asset_id'").get() as { value?: string } | undefined;
    const activeId = activeRow?.value?.trim();

    if (activeId) {
      const asset = db.prepare("SELECT id, data FROM receipt_assets WHERE id = ?").get(activeId) as { id: string; data: Buffer } | undefined;
      if (asset && asset.data) {
        const cachePath = path.join(brandingDir, `${asset.id}.png`);
        if (!fs.existsSync(cachePath) || fs.statSync(cachePath).size === 0) {
          fs.writeFileSync(cachePath, asset.data);
          rehydratedCount++;
        }
      }
    }

    // Prune unreferenced disk cache files
    const diskFiles = fs.readdirSync(brandingDir);
    for (const file of diskFiles) {
      if (file.startsWith('logo_') && (!activeId || !file.includes(activeId))) {
        try { fs.unlinkSync(path.join(brandingDir, file)); } catch { }
      }
    }
  } catch (err) {
    console.warn('[ReceiptAssets] Rehydration error:', (err as Error).message);
  }
  return rehydratedCount;
}
