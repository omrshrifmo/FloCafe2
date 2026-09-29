import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import * as zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import type {
  BrandedReceiptRequest,
  BrandedReceiptOutput,
  BrandedFontFamily,
  RasterBand,
} from './branded-receipt-renderer';
import {
  DEFAULT_RASTER_MAX_BAND_HEIGHT,
  encodeCanonicalDocumentToRaster,
  type RenderedThermalDocument,
  type RasterImageTransport,
} from '../../shared/print/raster';

export const CANONICAL_RENDERER_ID = 'FloCafe-Chromium-Canvas-v3.11.8';
export const CANONICAL_RENDERER_VERSION = '3.11.8';

// ── In-Memory Font Cache ────────────────────────────────────────────────────

interface BundledFontDef {
  readonly family: string;
  readonly weight: 'normal' | 'bold';
  readonly dataUrl: string;
}

const fontDataUrlCache = new Map<string, string>();

export function getBundledFontDataUrl(family: string, weight: 'regular' | 'bold'): string | null {
  const cacheKey = `${family}:${weight}`;
  if (fontDataUrlCache.has(cacheKey)) {
    return fontDataUrlCache.get(cacheKey)!;
  }

  const normalizedFamily = family.toLowerCase().includes('cairo') ? 'cairo' : 'almarai';
  const fileName = normalizedFamily === 'cairo'
    ? (weight === 'bold' ? 'Cairo-Bold.ttf' : 'Cairo-Regular.ttf')
    : (weight === 'bold' ? 'Almarai-Bold.ttf' : 'Almarai-Regular.ttf');

  const candidatePaths = [
    path.join(__dirname, '../assets/fonts', normalizedFamily, fileName),
    path.join(__dirname, '../../assets/fonts', normalizedFamily, fileName),
    path.join(__dirname, '../../../main/assets/fonts', normalizedFamily, fileName),
    path.join(process.cwd(), 'main/assets/fonts', normalizedFamily, fileName),
    path.join(process.cwd(), 'dist/main/assets/fonts', normalizedFamily, fileName),
    path.join(process.cwd(), 'frontend/public/fonts', fileName),
  ];

  for (const fontPath of candidatePaths) {
    if (fs.existsSync(fontPath)) {
      try {
        const buffer = fs.readFileSync(fontPath);
        const dataUrl = `data:font/truetype;base64,${buffer.toString('base64')}`;
        fontDataUrlCache.set(cacheKey, dataUrl);
        return dataUrl;
      } catch {
        // Fall through
      }
    }
  }

  return null;
}

export function resolveBundledFontDefs(family: BrandedFontFamily): BundledFontDef[] {
  const defs: BundledFontDef[] = [];
  const normalized = String(family || '').toLowerCase();
  if (normalized !== 'system' && normalized !== 'cairo' && normalized !== 'almarai') {
    return defs;
  }
  const primaryFamily = normalized === 'almarai' ? 'Almarai' : 'Cairo';

  const reg = getBundledFontDataUrl(primaryFamily, 'regular');
  if (reg) defs.push({ family: primaryFamily, weight: 'normal', dataUrl: reg });

  const bold = getBundledFontDataUrl(primaryFamily, 'bold');
  if (bold) defs.push({ family: primaryFamily, weight: 'bold', dataUrl: bold });

  // Also include the other bundled font as secondary fallback
  const altFamily = primaryFamily === 'Cairo' ? 'Almarai' : 'Cairo';
  const altReg = getBundledFontDataUrl(altFamily, 'regular');
  if (altReg) defs.push({ family: altFamily, weight: 'normal', dataUrl: altReg });
  const altBold = getBundledFontDataUrl(altFamily, 'bold');
  if (altBold) defs.push({ family: altFamily, weight: 'bold', dataUrl: altBold });

  return defs;
}

// ── Pure Node PNG Generator ─────────────────────────────────────────────────

export function createMonochromePngBuffer(width: number, height: number, pixels: Uint8Array): Buffer {
  const rowLength = 1 + width;
  const rawData = Buffer.alloc(height * rowLength);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowLength;
    rawData[rowOffset] = 0; // Filter type 0
    for (let x = 0; x < width; x++) {
      const isBlack = pixels[y * width + x] !== 0;
      rawData[rowOffset + 1 + x] = isBlack ? 0 : 255;
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const ihdrChunk = createPngChunk('IHDR', ihdr);
  const idatChunk = createPngChunk('IDAT', compressed);
  const iendChunk = createPngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([pngSignature, ihdrChunk, idatChunk, iendChunk]);
}

function createPngChunk(type: string, data: Buffer): Buffer {
  const length = data.length;
  const chunk = Buffer.alloc(12 + length);
  chunk.writeUInt32BE(length, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const crc = calculatePngCrc(chunk.subarray(4, 8 + length));
  chunk.writeUInt32BE(crc, 8 + length);
  return chunk;
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) c = 0xEDB88320 ^ (c >>> 1);
    else c = c >>> 1;
  }
  crcTable[n] = c;
}

function calculatePngCrc(buf: Buffer): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── In-Process Warm Surface Management ──────────────────────────────────────

let warmBrowserWindow: any = null;

function getWarmSurface(): any {
  if (warmBrowserWindow && !warmBrowserWindow.isDestroyed()) {
    return warmBrowserWindow;
  }

  let electronModule: any = null;
  try {
    electronModule = require('electron');
  } catch {
    return null;
  }

  const { BrowserWindow, app } = electronModule;
  if (typeof BrowserWindow !== 'function' || !app || typeof app.isReady !== 'function' || !app.isReady()) {
    return null;
  }

  warmBrowserWindow = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
    },
  });

  void warmBrowserWindow.loadURL('about:blank');
  return warmBrowserWindow;
}

export function destroyWarmSurface(): void {
  if (warmBrowserWindow && !warmBrowserWindow.isDestroyed()) {
    try {
      warmBrowserWindow.close();
    } catch {}
    warmBrowserWindow = null;
  }
}

// ── Canonical Canvas Render Function (Executed in Chromium) ─────────────────

export function getCanvasDocumentRenderFunction(): string {
  return `
    async (doc, fontDefs) => {
      try {
        if (!fontDefs || fontDefs.length === 0) {
          return { ok: false, code: 'font-unavailable', error: 'No bundled fonts provided' };
        }

        for (const f of fontDefs) {
          const font = new FontFace(f.family, 'url(' + f.dataUrl + ')', { weight: f.weight || 'normal' });
          try {
            await font.load();
            document.fonts.add(font);
          } catch (err) {
            return { ok: false, code: 'font-unavailable', error: 'Failed to load font ' + f.family + ': ' + (err.message || String(err)) };
          }
        }
        await document.fonts.ready;

        const primaryFamily = doc.fontFamily === 'almarai' ? 'Almarai' : 'Cairo';
        if (doc.fontFamily !== 'system' && !document.fonts.check('16px "' + primaryFamily + '"')) {
          return { ok: false, code: 'font-unavailable', error: 'Font verification failed for ' + primaryFamily };
        }

        const width = doc.widthDots || 576;
        const geom = doc.geometry || {};
        const padding = geom.paddingDots !== undefined ? geom.paddingDots : (width <= 384 ? 8 : 16);
        const contentLeft = geom.contentLeft !== undefined ? geom.contentLeft : padding;
        const contentWidth = geom.contentWidth !== undefined ? geom.contentWidth : (width - padding * 2);
        const fontStack = '"' + primaryFamily + '", "Cairo", "Almarai", sans-serif';

        const typo = (doc.style && doc.style.typography) || {};
        const is58 = width <= 384;
        const isKot = doc.kind === 'branded-kot';
        const isReport = doc.kind === 'branded-report';

        let scaleFactor = 1.0;
        if (isKot) {
          scaleFactor = Math.max(0.75, Math.min(2.6, (typo.kotScalePercent || 100) / 100));
        } else if (isReport) {
          scaleFactor = Math.max(0.75, Math.min(1.8, (typo.reportScalePercent || 100) / 100));
        } else {
          scaleFactor = Math.max(0.75, Math.min(2.2, (typo.receiptScalePercent || 100) / 100));
        }

        const sizeMap80 = {
          storeName: { small: 20, medium: 26, large: 32, xlarge: 40 },
          headerMeta: { small: 13, medium: 15, large: 18, xlarge: 22 },
          itemNames: { small: 14, medium: 18, large: 24, xlarge: 30 },
          kotItem: { small: 18, medium: 26, large: 34, xlarge: 42 },
          itemModifiers: { small: 12, medium: 14, large: 17, xlarge: 20 },
          itemNotes: { small: 12, medium: 14, large: 17, xlarge: 20 },
          kotNotes: { small: 15, medium: 20, large: 26, xlarge: 32 },
          totals: { small: 16, medium: 20, large: 26, xlarge: 34 },
          footer: { small: 12, medium: 14, large: 17, xlarge: 20 },
          report: { small: 14, medium: 17, large: 21, xlarge: 26 },
          reportTotals: { small: 17, medium: 22, large: 28, xlarge: 36 },
        };

        const sizeMap58 = {
          storeName: { small: 17, medium: 21, large: 26, xlarge: 32 },
          headerMeta: { small: 11, medium: 13, large: 15, xlarge: 18 },
          itemNames: { small: 12, medium: 15, large: 18, xlarge: 22 },
          kotItem: { small: 15, medium: 20, large: 25, xlarge: 30 },
          itemModifiers: { small: 11, medium: 12, large: 14, xlarge: 16 },
          itemNotes: { small: 11, medium: 13, large: 15, xlarge: 18 },
          kotNotes: { small: 13, medium: 16, large: 20, xlarge: 25 },
          totals: { small: 13, medium: 16, large: 20, xlarge: 25 },
          footer: { small: 11, medium: 12, large: 14, xlarge: 17 },
          report: { small: 12, medium: 14, large: 17, xlarge: 21 },
          reportTotals: { small: 14, medium: 18, large: 22, xlarge: 27 },
        };

        const activeSizeMap = is58 ? sizeMap58 : sizeMap80;

        const resolveRoleSize = (role, presetOrVal, defaultPreset) => {
          let base = 15;
          const rolePreset = presetOrVal || defaultPreset;
          if (typeof rolePreset === 'number') {
            base = rolePreset;
          } else if (activeSizeMap[role] && activeSizeMap[role][rolePreset]) {
            base = activeSizeMap[role][rolePreset];
          } else if (activeSizeMap[role]) {
            base = activeSizeMap[role][defaultPreset] || activeSizeMap[role].medium || 15;
          }
          return Math.max(10, Math.min(60, Math.round(base * scaleFactor)));
        };

        const storeNameSize = resolveRoleSize('storeName', typo.storeNameSize, 'large');
        const headerMetaSize = resolveRoleSize('headerMeta', typo.headerMetaSize, 'small');
        const itemNamesSize = isKot
          ? resolveRoleSize('kotItem', typo.kotItemSize, 'large')
          : resolveRoleSize('itemNames', typo.itemNamesSize, 'medium');
        const itemModifiersSize = resolveRoleSize('itemModifiers', typo.itemModifiersSize, 'small');
        const itemNotesSize = isKot
          ? resolveRoleSize('kotNotes', typo.kotNotesSize, 'medium')
          : resolveRoleSize('itemNotes', typo.itemNotesSize, 'small');
        const totalsSize = resolveRoleSize('totals', typo.totalsSize, 'large');
        const footerSize = resolveRoleSize('footer', typo.footerSize, 'small');
        const reportSize = resolveRoleSize('report', typo.reportSize, 'medium');
        const reportTotalsSize = resolveRoleSize('reportTotals', typo.reportTotalsSize, 'large');

        // Role weights
        const storeNameBold = typo.storeNameWeight ? typo.storeNameWeight === 'bold' : true;
        const itemNamesBold = isKot
          ? (typo.kotItemWeight ? typo.kotItemWeight === 'bold' : true)
          : (typo.itemNamesWeight ? typo.itemNamesWeight === 'bold' : false);
        const itemNotesBold = isKot
          ? (typo.kotNotesWeight ? typo.kotNotesWeight === 'bold' : true)
          : true;
        const totalsBold = typo.totalsWeight ? typo.totalsWeight === 'bold' : true;
        const reportTotalsBold = typo.reportTotalsWeight ? typo.reportTotalsWeight === 'bold' : true;

        // Preload logo image if provided
        let logoImg = null;
        let logoW = 0;
        let logoH = 0;
        if (doc.logo && doc.logo.dataUrl) {
          try {
            logoImg = new Image();
            await new Promise((resolve, reject) => {
              logoImg.onload = resolve;
              logoImg.onerror = reject;
              logoImg.src = doc.logo.dataUrl;
            });
            const capW = Math.min(contentWidth, Math.round(width * 0.70));
            const capH = Math.round(contentWidth * 0.40);
            const scale = Math.min(1, capW / Math.max(1, doc.logo.width || logoImg.naturalWidth), capH / Math.max(1, doc.logo.height || logoImg.naturalHeight));
            logoW = Math.max(16, Math.round((doc.logo.width || logoImg.naturalWidth) * scale));
            logoH = Math.max(16, Math.round((doc.logo.height || logoImg.naturalHeight) * scale));
          } catch {
            logoImg = null;
          }
        }

        // Scratch canvas for dynamic height calculation
        const scratchCanvas = document.createElement('canvas');
        scratchCanvas.width = width;
        scratchCanvas.height = 8000;
        const ctx = scratchCanvas.getContext('2d', { alpha: false });
        if (!ctx) return { ok: false, code: 'render-failed', error: 'Canvas 2D context unavailable' };

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, 8000);
        ctx.fillStyle = '#000000';

        const drawLine = (lineY, thickness = 2, style = 'solid') => {
          ctx.fillStyle = '#000000';
          if (style === 'dotted') {
            for (let x = contentLeft; x < contentLeft + contentWidth; x += 4) {
              ctx.fillRect(x, lineY, 2, thickness);
            }
          } else if (style === 'dashed') {
            for (let x = contentLeft; x < contentLeft + contentWidth; x += 8) {
              ctx.fillRect(x, lineY, 5, thickness);
            }
          } else if (style === 'double') {
            ctx.fillRect(contentLeft, lineY, contentWidth, 1);
            ctx.fillRect(contentLeft, lineY + 3, contentWidth, 1);
          } else {
            ctx.fillRect(contentLeft, lineY, contentWidth, thickness);
          }
        };

        const drawText = (str, x, textY, opts = {}) => {
          if (!str) return 0;
          const size = opts.size || 16;
          const bold = opts.bold || false;
          const align = opts.align || 'left';
          ctx.font = (bold ? 'bold ' : 'normal ') + size + 'px ' + fontStack;
          ctx.textBaseline = 'top';
          ctx.direction = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(str) ? 'rtl' : 'ltr';
          ctx.textAlign = align;
          ctx.fillStyle = '#000000';
          ctx.fillText(str, x, textY);
          return ctx.measureText(str).width;
        };

        const wrapText = (str, maxWidth, size, bold = false) => {
          if (!str) return [];
          ctx.font = (bold ? 'bold ' : 'normal ') + size + 'px ' + fontStack;
          const words = str.split(' ');
          const lines = [];
          let curLine = '';
          for (const w of words) {
            const cand = curLine ? curLine + ' ' + w : w;
            if (ctx.measureText(cand).width > maxWidth && curLine) {
              lines.push(curLine);
              curLine = w;
            } else {
              curLine = cand;
            }
          }
          if (curLine) lines.push(curLine);
          return lines.length > 0 ? lines : [str];
        };

        let y = 16;

        // 1. Edge Rulers (Diagnostic only)
        const isDiag = doc.kind === 'diagnostic';

        // 2. Logo
        if (logoImg) {
          const logoX = contentLeft + Math.floor((contentWidth - logoW) / 2);
          ctx.drawImage(logoImg, logoX, y, logoW, logoH);
          y += logoH + 16;
        }

        // 3. Header
        if (doc.header) {
          if (doc.header.banner) {
            for (const bLine of doc.header.banner.split('\\n')) {
              drawText(bLine, contentLeft + contentWidth / 2, y, { align: 'center', bold: true, size: Math.round(headerMetaSize * 1.1) });
              y += Math.round(headerMetaSize * 1.45);
            }
            y += 4;
          }
          if (doc.header.businessName) {
            drawText(doc.header.businessName, contentLeft + contentWidth / 2, y, { align: 'center', bold: storeNameBold, size: storeNameSize });
            y += Math.round(storeNameSize * 1.35);
          }
          if (doc.header.address) {
            drawText(doc.header.address, contentLeft + contentWidth / 2, y, { align: 'center', bold: false, size: headerMetaSize });
            y += Math.round(headerMetaSize * 1.4);
          }
          if (doc.header.phone) {
            drawText('TEL: ' + doc.header.phone, contentLeft + contentWidth / 2, y, { align: 'center', bold: false, size: headerMetaSize });
            y += Math.round(headerMetaSize * 1.4);
          }
          if (doc.header.taxId) {
            drawText('TAX ID: ' + doc.header.taxId, contentLeft + contentWidth / 2, y, { align: 'center', bold: false, size: headerMetaSize });
            y += Math.round(headerMetaSize * 1.4);
          }
          drawLine(y, 2);
          y += 12;
        }

        // 4. Meta
        if (doc.meta) {
          const hasInv = Boolean(doc.meta.invoiceNumber || doc.meta.quoteReference);
          const hasOrd = Boolean(doc.meta.orderNumber);
          if (hasInv || hasOrd) {
            if (doc.meta.invoiceNumber) drawText('INV: ' + doc.meta.invoiceNumber, contentLeft, y, { align: 'left', bold: true, size: Math.round(headerMetaSize * 1.15) });
            else if (doc.meta.quoteReference) drawText('REF: ' + doc.meta.quoteReference, contentLeft, y, { align: 'left', bold: true, size: Math.round(headerMetaSize * 1.15) });
            if (doc.meta.orderNumber) drawText('#' + doc.meta.orderNumber, contentLeft + contentWidth, y, { align: 'right', bold: true, size: Math.round(headerMetaSize * 1.15) });
            y += Math.round(headerMetaSize * 1.45);
          }
          if (doc.meta.timestamp || doc.meta.tableName) {
            if (doc.meta.timestamp) drawText(doc.meta.timestamp, contentLeft, y, { align: 'left', size: headerMetaSize });
            if (doc.meta.tableName) drawText(doc.meta.tableName, contentLeft + contentWidth, y, { align: 'right', size: headerMetaSize });
            y += Math.round(headerMetaSize * 1.4);
          }
          if (doc.meta.customerName || doc.meta.customerPhone) {
            if (doc.meta.customerName) drawText('CUST: ' + doc.meta.customerName, contentLeft, y, { align: 'left', size: headerMetaSize });
            if (doc.meta.customerPhone) drawText(doc.meta.customerPhone, contentLeft + contentWidth, y, { align: 'right', size: headerMetaSize });
            y += Math.round(headerMetaSize * 1.4);
          }
          if (doc.meta.serverName) {
            drawText('SERVER: ' + doc.meta.serverName, contentLeft, y, { align: 'left', size: headerMetaSize });
            y += Math.round(headerMetaSize * 1.4);
          }
          drawLine(y, 1);
          y += 12;
        }

        // 5. Document Kind Specific Body
        if (doc.kind === 'diagnostic') {
          drawText('0 px', 12, y, { align: 'left', bold: true, size: 13 });
          drawText(width + ' px', width - 12, y, { align: 'right', bold: true, size: 13 });
          drawText('|----------------------------------|', contentLeft + contentWidth / 2, y, { align: 'center', bold: true, size: 13 });
          y += 22;

          drawText('▲▲▲ TOP OF PAGE / بداية الصفحة ▲▲▲', contentLeft + contentWidth / 2, y, { align: 'center', bold: true, size: 16 });
          y += 24;
          drawLine(y, 2);
          y += 12;

          const transportLabel = doc.transport === 'esc_star_24' ? 'ESC * 24-DOT COMPATIBILITY' : 'GS v 0 RASTER';
          drawText('TRANSPORT: ' + transportLabel, contentLeft + contentWidth / 2, y, { align: 'center', bold: true, size: 15 });
          y += 22;
          drawText('PROFILE: XP-K200L 80 mm – FloCafe Full Raster', contentLeft + contentWidth / 2, y, { align: 'center', size: 13 });
          y += 18;
          drawText('WIDTH: ' + width + ' dots (' + Math.round(width / 8) + ' bytes/row)', contentLeft + contentWidth / 2, y, { align: 'center', size: 13 });
          y += 18;
          drawText('RENDERER: FloCafe-Chromium-Canvas-v3.11.8', contentLeft + contentWidth / 2, y, { align: 'center', size: 13 });
          y += 22;
          drawLine(y, 1);
          y += 12;

          drawText('فلو كافيه - نظام نقاط البيع للمطاعم والمقاهي (Cairo Bold)', contentLeft + contentWidth / 2, y, { align: 'center', bold: true, size: 16 });
          y += 24;
          drawText('تطبيق الكاشير والمطبخ السحابي غير المتصل (Almarai Regular)', contentLeft + contentWidth / 2, y, { align: 'center', size: 14 });
          y += 22;
          drawText('FloCafe Offline-First POS & Kitchen Display System', contentLeft + contentWidth / 2, y, { align: 'center', size: 14 });
          y += 20;
          drawText('شاي كرك بالحليب / Karak Tea with Milk - 12.00 SAR', contentLeft + contentWidth / 2, y, { align: 'center', bold: true, size: 14 });
          y += 24;

          drawText('أرقام عربية مشرقية: ٠ ١ ٢ ٣ ٤ ٥ ٦ ٧ ٨ ٩', contentLeft + contentWidth / 2, y, { align: 'center', bold: true, size: 15 });
          y += 22;
          drawText('Western Digits: 0 1 2 3 4 5 6 7 8 9', contentLeft + contentWidth / 2, y, { align: 'center', size: 14 });
          y += 20;
          drawText('Symbols: ! @ # $ % ^ & * ( ) _ + - = [ ] : ; , . / ?', contentLeft + contentWidth / 2, y, { align: 'center', size: 13 });
          y += 24;

          drawLine(y, 1); y += 8;
          drawLine(y, 2, 'dashed'); y += 8;
          drawLine(y, 2, 'dotted'); y += 8;
          drawLine(y, 2, 'double'); y += 14;

          // Torture block: 8x8 checkerboard
          for (let cy = 0; cy < 24; cy += 8) {
            for (let cx = contentLeft; cx < contentLeft + contentWidth; cx += 8) {
              if ((((cx - contentLeft) / 8) + (cy / 8)) % 2 === 0) {
                ctx.fillRect(cx, y + cy, 8, 8);
              }
            }
          }
          y += 28;

          // Solid black bar
          ctx.fillRect(contentLeft, y, contentWidth, 24);
          y += 28;

          // Outlined box
          ctx.strokeRect(contentLeft, y, contentWidth, 30);
          drawText('FRAME & ALIGNMENT BOX', contentLeft + contentWidth / 2, y + 8, { align: 'center', bold: true, size: 13 });
          y += 36;

          // Sample RTL table row
          drawText('PRICE / السعر', contentLeft, y, { align: 'left', bold: true, size: 14 });
          drawText('QTY / الكمية', contentLeft + 140, y, { align: 'center', bold: true, size: 14 });
          drawText('ITEM / الصنف', contentLeft + contentWidth, y, { align: 'right', bold: true, size: 14 });
          y += 20;
          drawLine(y, 1); y += 8;
          drawText('18.00 SAR', contentLeft, y, { align: 'left', size: 15 });
          drawText('2x', contentLeft + 140, y, { align: 'center', size: 15 });
          drawText('قهوة فلات وايت / Flat White Coffee - طاولة ٤', contentLeft + contentWidth, y, { align: 'right', size: 15 });
          y += 26;

          y += 8; drawLine(y, 2); y += 8;
          drawText('◆◆◆ MIDDLE OF PAGE / منتصف الصفحة ◆◆◆', contentLeft + contentWidth / 2, y, { align: 'center', bold: true, size: 16 });
          y += 24;
          drawLine(y, 2); y += 12;

          // 24-dot slice alignment patterns
          for (let s = 0; s < 6; s++) {
            const sy = y + s * 24;
            ctx.fillRect(contentLeft, sy, 30, 22);
            drawText('SLICE ' + (s + 1) + ' (24-DOT)', contentLeft + 40, sy + 4, { align: 'left', size: 12 });
            ctx.fillRect(contentLeft + contentWidth - 30, sy, 30, 22);
          }
          y += 6 * 24 + 12;

          drawLine(y, 2); y += 8;
          drawText('▼▼▼ BOTTOM OF PAGE / نهاية الصفحة ▼▼▼', contentLeft + contentWidth / 2, y, { align: 'center', bold: true, size: 16 });
          y += 22;
          drawText('NON-FINANCIAL DOCUMENT — NO CASH DRAWER PULSE', contentLeft + contentWidth / 2, y, { align: 'center', size: 12 });
          y += 18;
          drawLine(y, 2); y += 12;

        } else if (doc.kind === 'branded-report') {
          for (const sec of (doc.reportSections || [])) {
            if (sec.title) {
              drawText(sec.title, contentLeft + contentWidth / 2, y, { align: 'center', bold: reportTotalsBold, size: reportTotalsSize });
              y += Math.round(reportTotalsSize * 1.4);
              drawLine(y, 1);
              y += 8;
            }
            for (const line of (sec.lines || [])) {
              const isTotLine = Boolean(line.isBold);
              const lSize = isTotLine ? Math.max(reportSize, reportTotalsSize) : reportSize;
              const lBold = isTotLine ? reportTotalsBold : false;
              if (line.value) {
                drawText(line.label, contentLeft, y, { align: 'left', bold: lBold, size: lSize });
                drawText(line.value, contentLeft + contentWidth, y, { align: 'right', bold: lBold, size: lSize });
              } else {
                drawText(line.label, contentLeft, y, { align: line.align || 'left', bold: lBold, size: lSize });
              }
              y += Math.round(lSize * 1.45);
            }
            drawLine(y, 1);
            y += 12;
          }

        } else {
          // Receipts, Preliminary receipts, KOTs
          const itemLineH = Math.round(itemNamesSize * 1.35);
          const modLineH = Math.round(itemModifiersSize * 1.35);
          const noteLineH = Math.round(itemNotesSize * 1.35);

          const hasPrices = (doc.items || []).some(it => it.price !== undefined && it.price !== 0) || !isKot;
          let priceW = 0;
          let qtyW = Math.max(Math.round(itemNamesSize * 2.2), Math.floor(contentWidth * 0.16));
          if (hasPrices) {
            priceW = Math.max(Math.round(itemNamesSize * 3.8), Math.floor(contentWidth * 0.28));
          }
          const itemW = Math.max(60, contentWidth - priceW - qtyW);

          if (hasPrices) {
            drawText('PRICE', contentLeft, y, { align: 'left', bold: true, size: headerMetaSize });
          }
          drawText('QTY', contentLeft + priceW + 8, y, { align: 'left', bold: true, size: headerMetaSize });
          drawText('ITEM', contentLeft + priceW + qtyW, y, { align: 'left', bold: true, size: headerMetaSize });
          y += Math.round(headerMetaSize * 1.4);
          drawLine(y, 1);
          y += 8;

          for (const item of (doc.items || [])) {
            const priceStr = typeof item.price === 'number' ? item.price.toFixed(2) : String(item.price || '');
            if (hasPrices) {
              drawText(priceStr, contentLeft, y + 2, { align: 'left', size: itemNamesSize, bold: itemNamesBold });
            }
            drawText(String(item.quantity), contentLeft + priceW + 8, y + 2, { align: 'left', size: itemNamesSize, bold: itemNamesBold });

            // Word wrap long item names
            const nameLines = wrapText(item.name, itemW - 8, itemNamesSize, itemNamesBold);
            for (let l = 0; l < nameLines.length; l++) {
              drawText(nameLines[l], contentLeft + priceW + qtyW, y + 2 + l * itemLineH, { align: 'left', size: itemNamesSize, bold: itemNamesBold });
            }
            y += Math.max(itemLineH + 6, nameLines.length * itemLineH + 6);

            if (item.addons && item.addons.length > 0) {
              for (const addon of item.addons) {
                drawText('+ ' + addon.name, contentLeft + priceW + qtyW + 8, y, { align: 'left', size: itemModifiersSize });
                if (hasPrices && addon.price) {
                  drawText(addon.price.toFixed(2), contentLeft, y, { align: 'left', size: itemModifiersSize });
                }
                y += modLineH;
              }
            }
            if (item.notes) {
              drawText('* ' + item.notes, contentLeft + priceW + qtyW + 8, y, { align: 'left', bold: itemNotesBold, size: itemNotesSize });
              y += noteLineH;
            }
          }
          drawLine(y, 1);
          y += 12;

          for (const tot of (doc.totals || [])) {
            const sz = tot.isLarge ? totalsSize : Math.round(totalsSize * 0.85);
            const isBoldTot = tot.isBold !== undefined ? tot.isBold : totalsBold;
            drawText(String(tot.label), contentLeft, y + 2, { align: 'left', bold: isBoldTot, size: sz });
            drawText(String(tot.value), contentLeft + contentWidth, y + 2, { align: 'right', bold: isBoldTot, size: sz });
            y += Math.round(sz * 1.45);
          }
          if ((doc.totals || []).length > 0) {
            drawLine(y, 1);
            y += 14;
          }
        }

        // 6. Footer
        if (doc.footer) {
          if (doc.footer.thankYou) {
            drawText(doc.footer.thankYou, contentLeft + contentWidth / 2, y, { align: 'center', bold: true, size: Math.round(footerSize * 1.15) });
            y += Math.round(footerSize * 1.45);
          }
          if (doc.footer.footerNote) {
            for (const fLine of doc.footer.footerNote.split('\\n')) {
              drawText(fLine, contentLeft + contentWidth / 2, y, { align: 'center', size: footerSize });
              y += Math.round(footerSize * 1.4);
            }
          }
        }

        const finalHeight = Math.max(128, y + 24);

        // If diagnostic, paint edge ticks down entire finalHeight
        if (isDiag) {
          for (let ey = 0; ey < finalHeight; ey += 16) {
            ctx.fillRect(0, ey, 8, 8);
            ctx.fillRect(width - 8, ey, 8, 8);
          }
        }

        // Frame
        if (doc.style && doc.style.frame && doc.style.frame.borderStyle && doc.style.frame.borderStyle !== 'none') {
          const thickness = doc.style.frame.borderThickness || 1;
          const pad = doc.style.frame.borderPadding || 8;
          ctx.lineWidth = thickness;
          ctx.strokeStyle = '#000000';
          ctx.strokeRect(
            Math.max(0, contentLeft - pad),
            4,
            Math.min(width - 1, contentWidth + pad * 2),
            Math.min(finalHeight - 8, y + 8),
          );
        }

        // Create cropped final canvas
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = width;
        finalCanvas.height = finalHeight;
        const finalCtx = finalCanvas.getContext('2d');
        finalCtx.drawImage(scratchCanvas, 0, 0, width, finalHeight, 0, 0, width, finalHeight);

        // 1-bit monochrome bitmap conversion with threshold and thermal ink gain
        const imgData = finalCtx.getImageData(0, 0, width, finalHeight).data;
        const mono = new Uint8Array(width * finalHeight);
        const threshold = typeof doc.threshold === 'number'
          ? doc.threshold
          : ((doc.style && doc.style.contrast && typeof doc.style.contrast.threshold === 'number')
              ? doc.style.contrast.threshold
              : 140);
        const inkGain = typeof doc.inkGain === 'number'
          ? doc.inkGain
          : ((doc.style && doc.style.contrast && typeof doc.style.contrast.inkGain === 'number')
              ? doc.style.contrast.inkGain
              : 0);

        for (let i = 0; i < mono.length; i++) {
          const a = imgData[i * 4 + 3];
          if (a < 64) {
            mono[i] = 0;
          } else {
            const r = imgData[i * 4];
            const g = imgData[i * 4 + 1];
            const b = imgData[i * 4 + 2];
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            mono[i] = lum < threshold ? 1 : 0;
          }
        }

        if (inkGain > 0) {
          const clampedGain = Math.min(2, Math.max(1, Math.round(inkGain)));
          const gained = new Uint8Array(mono.length);
          for (let gy = 0; gy < finalHeight; gy++) {
            const rowOff = gy * width;
            for (let gx = 0; gx < width; gx++) {
              if (mono[rowOff + gx] === 1) {
                gained[rowOff + gx] = 1;
                for (let g = 1; g <= clampedGain; g++) {
                  if (gx + g < width) {
                    gained[rowOff + gx + g] = 1;
                  }
                }
              }
            }
          }
          mono.set(gained);
        }

        // Encode to base64
        let binary = '';
        for (let i = 0; i < mono.length; i += 8192) {
          binary += String.fromCharCode.apply(null, mono.subarray(i, i + 8192));
        }

        return {
          ok: true,
          widthDots: width,
          heightDots: finalHeight,
          monoBase64: btoa(binary),
        };
      } catch (error) {
        return { ok: false, code: 'render-failed', error: error.message || String(error) };
      }
    }
  `;
}

function getElectronBinaryPath(): string {
  try {
    const electron = require('electron');
    if (typeof electron === 'string') return electron;
    if (electron && typeof electron.path === 'string') return electron.path;
  } catch {}

  const candidatePaths = [
    path.join(process.cwd(), 'node_modules/.bin/electron'),
    path.join(process.cwd(), 'node_modules/electron/dist/electron'),
    path.join(__dirname, '../../node_modules/electron/dist/electron'),
  ];
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) return p;
  }
  return 'electron';
}

function renderViaWorker(request: BrandedReceiptRequest, fonts: BundledFontDef[], timeoutMs = 10000): any {
  const electronPath = getElectronBinaryPath();
  const candidateWorkerPaths = [
    path.join(__dirname, 'canvas-worker.cjs'),
    path.join(__dirname, '../printers/canvas-worker.cjs'),
    path.join(process.cwd(), 'main/printers/canvas-worker.cjs'),
    path.join(process.cwd(), 'dist/main/printers/canvas-worker.cjs'),
  ];

  let workerPath = candidateWorkerPaths.find((p) => fs.existsSync(p));
  if (!workerPath) {
    throw new Error('Canvas worker script not found');
  }

  const outputFile = path.join(os.tmpdir(), `flocafe-canvas-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  const payload = JSON.stringify({
    request,
    fonts,
    outputFile,
    renderScript: getCanvasDocumentRenderFunction(),
  });

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  try {
    const child = spawnSync(electronPath, [workerPath], {
      input: payload,
      env,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });

    if (child.error) {
      throw child.error;
    }

    if (fs.existsSync(outputFile)) {
      const data = fs.readFileSync(outputFile, 'utf8');
      try {
        return JSON.parse(data);
      } finally {
        try { fs.unlinkSync(outputFile); } catch {}
      }
    }

    if (!child.stdout || child.stdout.trim().length === 0) {
      throw new Error(`Canvas worker exited with code ${child.status}: ${child.stderr || 'No output'}`);
    }

    return JSON.parse(child.stdout.trim());
  } finally {
    try {
      if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
    } catch {}
  }
}

// ── Primary Canonical Document Renderer ─────────────────────────────────────

export async function renderCanonicalDocument(
  request: BrandedReceiptRequest,
  transportOverride?: RasterImageTransport,
): Promise<BrandedReceiptOutput> {
  const startTime = Date.now();
  const fontFamily: BrandedFontFamily = request.fontFamily || 'almarai';
  const bundledFonts = resolveBundledFontDefs(fontFamily);

  if (fontFamily !== 'system' && bundledFonts.length === 0) {
    throw new Error(`font-unavailable: Bundled font files unavailable on disk for ${fontFamily}`);
  }

  const transport: RasterImageTransport = transportOverride || (request.transport === 'esc_star_24' ? 'esc_star_24' : 'gs_v_0');
  const renderFn = getCanvasDocumentRenderFunction();

  let rawResult: any = null;
  const warmSurface = getWarmSurface();

  if (warmSurface) {
    const fullScript = `(${renderFn})(${JSON.stringify(request)}, ${JSON.stringify(bundledFonts)})`;
    rawResult = await warmSurface.webContents.executeJavaScript(fullScript);
  } else {
    rawResult = renderViaWorker(request, bundledFonts);
  }

  if (!rawResult || !rawResult.ok) {
    const code = rawResult?.code || 'render-failed';
    const err = rawResult?.error || 'Canvas rendering failed';
    const errorObj = new Error(`${code}: ${err}`);
    (errorObj as any).code = code;
    throw errorObj;
  }

  const widthDots: number = rawResult.widthDots;
  const heightDots: number = rawResult.heightDots;
  const monochromeBitmap = Buffer.from(rawResult.monoBase64, 'base64');

  if (monochromeBitmap.length !== widthDots * heightDots) {
    throw new Error(`Pixel buffer size mismatch: expected ${widthDots * heightDots} bytes, got ${monochromeBitmap.length}`);
  }

  const previewPng = createMonochromePngBuffer(widthDots, heightDots, monochromeBitmap);
  const previewDataUrl = `data:image/png;base64,${previewPng.toString('base64')}`;
  const pixelHash = crypto.createHash('sha256').update(monochromeBitmap).digest('hex');

  const selectedFontSet = bundledFonts.map((f) => f.family);
  const isDiagnostic = request.meta?.orderNumber === 'DIAG-RASTER-PROBE' ||
    Boolean(request.header?.banner && request.header.banner.includes('DIAGNOSTIC'));
  const isPreliminary = Boolean(request.header?.banner && request.header.banner.includes('PRELIMINARY'));

  const documentKind = isDiagnostic
    ? 'diagnostic'
    : (isPreliminary
        ? 'preliminary'
        : (request.kind === 'branded-report'
            ? 'financial_report'
            : (request.kind === 'branded-kot' ? 'kot' : 'receipt')));

  const document: RenderedThermalDocument = {
    widthDots,
    heightDots,
    monochromeBitmap,
    monochromePixels: monochromeBitmap,
    previewPng,
    pixelHash,
    rendererId: CANONICAL_RENDERER_ID,
    selectedFontSet,
    documentKind,
    rendererVersion: CANONICAL_RENDERER_VERSION,
  };

  const rasterBytes = Buffer.from(encodeCanonicalDocumentToRaster(document, transport, 'full', request.maxBandHeight || DEFAULT_RASTER_MAX_BAND_HEIGHT));

  // Build semantic bands for backward-compatible inspections
  const bands: RasterBand[] = [];
  const maxBandHeight = request.maxBandHeight || DEFAULT_RASTER_MAX_BAND_HEIGHT;
  for (let offset = 0; offset < heightDots; offset += maxBandHeight) {
    const bHeight = Math.min(maxBandHeight, heightDots - offset);
    bands.push({
      widthDots,
      heightDots: bHeight,
      pixels: monochromeBitmap.subarray(offset * widthDots, (offset + bHeight) * widthDots),
    });
  }

  return {
    ok: true,
    unit: {
      unitId: request.requestId,
      financial: true,
      complete: true,
      bands,
    },
    rasterBytes,
    previewDataUrl,
    renderTimeMs: Date.now() - startTime,
    dimensions: {
      widthDots,
      heightDots,
      bandCount: bands.length,
    },
    document,
    pixelHash,
  };
}

export function renderCanonicalDocumentSync(
  request: BrandedReceiptRequest,
  transportOverride?: RasterImageTransport,
): BrandedReceiptOutput {
  const startTime = Date.now();
  const fontFamily: BrandedFontFamily = request.fontFamily || 'almarai';
  const bundledFonts = resolveBundledFontDefs(fontFamily);

  if (fontFamily !== 'system' && bundledFonts.length === 0) {
    const err = new Error(`font-unavailable: Bundled font files unavailable on disk for ${fontFamily}`);
    (err as any).code = 'font-unavailable';
    throw err;
  }

  const transport: RasterImageTransport = transportOverride || (request.transport === 'esc_star_24' ? 'esc_star_24' : 'gs_v_0');
  const rawResult = renderViaWorker(request, bundledFonts);

  if (!rawResult || !rawResult.ok) {
    const code = rawResult?.code || 'render-failed';
    const err = rawResult?.error || 'Canvas rendering failed';
    const errorObj = new Error(`${code}: ${err}`);
    (errorObj as any).code = code;
    throw errorObj;
  }

  const widthDots: number = rawResult.widthDots;
  const heightDots: number = rawResult.heightDots;
  const monochromeBitmap = Buffer.from(rawResult.monoBase64, 'base64');

  if (monochromeBitmap.length !== widthDots * heightDots) {
    throw new Error(`Pixel buffer size mismatch: expected ${widthDots * heightDots} bytes, got ${monochromeBitmap.length}`);
  }

  const previewPng = createMonochromePngBuffer(widthDots, heightDots, monochromeBitmap);
  const previewDataUrl = `data:image/png;base64,${previewPng.toString('base64')}`;
  const pixelHash = crypto.createHash('sha256').update(monochromeBitmap).digest('hex');

  const selectedFontSet = bundledFonts.map((f) => f.family);
  const isDiagnostic = request.meta?.orderNumber === 'DIAG-RASTER-PROBE' ||
    Boolean(request.header?.banner && request.header.banner.includes('DIAGNOSTIC'));
  const isPreliminary = Boolean(request.header?.banner && request.header.banner.includes('PRELIMINARY'));

  const documentKind = isDiagnostic
    ? 'diagnostic'
    : (isPreliminary
        ? 'preliminary'
        : (request.kind === 'branded-report'
            ? 'financial_report'
            : (request.kind === 'branded-kot' ? 'kot' : 'receipt')));

  const document: RenderedThermalDocument = {
    widthDots,
    heightDots,
    monochromeBitmap,
    monochromePixels: monochromeBitmap,
    previewPng,
    pixelHash,
    rendererId: CANONICAL_RENDERER_ID,
    selectedFontSet,
    documentKind,
    rendererVersion: CANONICAL_RENDERER_VERSION,
  };

  const rasterBytes = Buffer.from(encodeCanonicalDocumentToRaster(document, transport, 'full', request.maxBandHeight || DEFAULT_RASTER_MAX_BAND_HEIGHT));

  const bands: RasterBand[] = [];
  const maxBandHeight = request.maxBandHeight || DEFAULT_RASTER_MAX_BAND_HEIGHT;
  for (let offset = 0; offset < heightDots; offset += maxBandHeight) {
    const bHeight = Math.min(maxBandHeight, heightDots - offset);
    bands.push({
      widthDots,
      heightDots: bHeight,
      pixels: monochromeBitmap.subarray(offset * widthDots, (offset + bHeight) * widthDots),
    });
  }

  return {
    ok: true,
    unit: {
      unitId: request.requestId,
      financial: true,
      complete: true,
      bands,
    },
    rasterBytes,
    previewDataUrl,
    renderTimeMs: Date.now() - startTime,
    dimensions: {
      widthDots,
      heightDots,
      bandCount: bands.length,
    },
    document,
    pixelHash,
  };
}
