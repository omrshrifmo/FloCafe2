/**
 * Renderer/transport-neutral raster contract for ESC/POS thermal printing.
 *
 * This module is deliberately pure: it knows nothing about Electron, fonts,
 * printers, or transports. A profile must opt into raster explicitly before
 * callers may encode a band. Pixels are packed MSB-first as required by
 * ESC/POS GS v 0 (m=0).
 */

import type { ThermalPrinterCapabilities } from './thermal-capabilities';

export const DEFAULT_RASTER_MAX_BAND_HEIGHT = 200;
const MAX_RASTER_WIDTH_DOTS = 8192;
export const GS_V_0_MODE = 0;

export type RasterTextDirection = 'ltr' | 'rtl';
export type RasterStyle = 'normal' | 'bold' | 'double-height' | 'double-width' | 'font-b';
export type RasterLayoutKind = 'financial-summary' | 'financial-item';

export interface RasterTextLayout {
  readonly kind: RasterLayoutKind;
  readonly columns: readonly {
    readonly text: string;
    readonly align: 'left' | 'right';
    readonly widthRatio?: number;
  }[];
}

export interface RasterBand {
  readonly widthDots: number;
  readonly heightDots: number;
  /** One byte per pixel, row-major. Non-zero pixels are printed black. */
  readonly pixels: Uint8Array;
}

/** A complete semantic unit rendered as one or more bounded raster bands. */
export interface RasterSemanticUnit {
  readonly unitId: string;
  readonly financial: boolean;
  readonly complete: boolean;
  readonly bands: readonly RasterBand[];
}

export type ThermalDocumentKind =
  | 'receipt'
  | 'preliminary'
  | 'kot'
  | 'financial_report'
  | 'diagnostic'
  | 'branded-receipt'
  | 'branded-kot'
  | 'branded-report';

/**
 * Canonical visual document artifact produced by the unified raster renderer.
 * Both visual preview and physical printer payloads consume the exact same
 * pixel buffer and share the same pixelHash.
 */
export interface RenderedThermalDocument {
  readonly widthDots: number;
  readonly heightDots: number;
  readonly monochromeBitmap: Uint8Array;
  readonly monochromePixels: Uint8Array;
  readonly previewPng: Buffer;
  readonly pixelHash: string;
  readonly rendererId: string;
  readonly selectedFontSet: string[];
  readonly documentKind: ThermalDocumentKind;
  readonly rendererVersion?: string;
  readonly rgbaPixels?: Uint8Array;
}

export interface RasterSemanticLineGroup {
  readonly groupId: string;
  readonly lineIndex: number;
  readonly lineCount: number;
  readonly sourceLines?: readonly string[];
  readonly sourceControlLines?: readonly string[];
  readonly sourceLayouts?: readonly (RasterTextLayout | undefined)[];
  readonly financialSourceLines?: readonly boolean[];
  readonly financial?: boolean;
}

export interface RasterRenderRequest {
  readonly version: 1;
  readonly requestId: string;
  readonly text: string;
  readonly widthDots: number;
  readonly maxBandHeight: number;
  readonly direction: RasterTextDirection;
  readonly align?: 'left' | 'center';
  readonly layout?: RasterTextLayout;
  readonly style: RasterStyle;
  readonly styles?: readonly RasterStyle[];
  readonly financial: boolean;
  readonly maxLines: number;
  /** An optional data: URL for a font bundled by the application, never a network URL. */
  readonly bundledFont?: { readonly family: string; readonly dataUrl: string };
}

export type RasterRenderResult =
  | { readonly version: 1; readonly requestId: string; readonly ok: true; readonly unit: RasterSemanticUnit }
  | { readonly version: 1; readonly requestId: string; readonly ok: false; readonly code: 'invalid-request' | 'font-unavailable' | 'render-failed'; readonly detail: string };

export interface RasterIpcRequestMessage {
  readonly version: 1;
  readonly request: RasterRenderRequest;
}

export interface RasterIpcResultMessage {
  readonly version: 1;
  readonly result: RasterRenderResult;
}

export function rasterCapabilityEnabled(
  capabilities: ThermalPrinterCapabilities | undefined,
  mode: 'mixed' | 'whole-receipt' = 'mixed',
): boolean {
  return capabilities?.raster.enabled === true
    && Number.isSafeInteger(capabilities.raster.widthDots)
    && capabilities.raster.widthDots > 0 && capabilities.raster.widthDots <= MAX_RASTER_WIDTH_DOTS
    && Number.isSafeInteger(capabilities.raster.maxBandHeight)
    && capabilities.raster.maxBandHeight > 0 && capabilities.raster.maxBandHeight <= DEFAULT_RASTER_MAX_BAND_HEIGHT
    && capabilities.raster.modes.includes(mode);
}

export function rasterWebUsbPathEnabled(
  capabilities: ThermalPrinterCapabilities | undefined,
  rendererAvailable: boolean,
  profileId: unknown,
): boolean {
  return rasterCapabilityEnabled(capabilities, 'mixed')
    && rendererAvailable
    && typeof profileId === 'string'
    && profileId.length > 0;
}

export function validateRasterBand(band: RasterBand, maxBandHeight = DEFAULT_RASTER_MAX_BAND_HEIGHT): void {
  if (!Number.isSafeInteger(maxBandHeight) || maxBandHeight <= 0 || maxBandHeight > 0xFFFF) throw new Error('Invalid maximum raster band height');
  if (!Number.isSafeInteger(band.widthDots) || band.widthDots <= 0) throw new Error('Raster width must be a positive integer');
  if (!Number.isSafeInteger(band.heightDots) || band.heightDots <= 0) throw new Error('Raster height must be a positive integer');
  if (band.heightDots > 0xFFFF) throw new Error('Raster height exceeds GS v 0 limit');
  if (band.heightDots > maxBandHeight) throw new Error(`Raster band exceeds maximum height of ${maxBandHeight}`);
  const widthBytes = Math.ceil(band.widthDots / 8);
  if (widthBytes > 0xFFFF) throw new Error('Raster width exceeds GS v 0 limit');
  const expectedLength = widthBytes * band.heightDots;
  if (band.pixels.length !== band.widthDots * band.heightDots) {
    throw new Error('Raster pixels must contain one value per pixel');
  }
  if (!Number.isSafeInteger(expectedLength)) throw new Error('Raster dimensions are too large');
}

export type BrandedRasterTransport = 'gs_v_0' | 'esc_star_24' | 'auto';
export type RasterImageTransport = 'gs_v_0' | 'esc_star_24';

export function resolveRasterTransport(
  preference?: string | null,
  profileDefault?: RasterImageTransport,
): RasterImageTransport {
  if (preference === 'esc_star_24') return 'esc_star_24';
  if (preference === 'gs_v_0') return 'gs_v_0';
  if (preference === 'auto' && profileDefault) return profileDefault;
  return 'gs_v_0';
}

/** Encode exactly one validated band using GS v 0, m=0 (normal density). */
export function encodeGsV0Band(band: RasterBand, maxBandHeight = DEFAULT_RASTER_MAX_BAND_HEIGHT): Uint8Array {
  validateRasterBand(band, maxBandHeight);
  const widthBytes = Math.ceil(band.widthDots / 8);
  const payload = new Uint8Array(widthBytes * band.heightDots);

  for (let y = 0; y < band.heightDots; y += 1) {
    for (let x = 0; x < band.widthDots; x += 1) {
      if (band.pixels[y * band.widthDots + x] !== 0) {
        payload[y * widthBytes + Math.floor(x / 8)] |= 0x80 >> (x % 8);
      }
    }
  }

  const command = new Uint8Array(8 + payload.length);
  command.set([0x1D, 0x76, 0x30, GS_V_0_MODE, widthBytes & 0xFF, (widthBytes >> 8) & 0xFF, band.heightDots & 0xFF, (band.heightDots >> 8) & 0xFF]);
  command.set(payload, 8);
  return command;
}

/**
 * Encode a full monochrome pixel buffer using sequential GS v 0 raster bands.
 *
 * Slices the full document into horizontal bands <= maxBandHeight, emitting
 * standard GS v 0 commands in strict top-to-bottom visual order with NO intermediate
 * line feeds, resets, or gaps.
 */
export function encodeGsV0Document(
  widthDots: number,
  heightDots: number,
  pixels: Uint8Array,
  maxBandHeight = DEFAULT_RASTER_MAX_BAND_HEIGHT,
): Uint8Array {
  if (!Number.isSafeInteger(widthDots) || widthDots <= 0 || widthDots > MAX_RASTER_WIDTH_DOTS) {
    throw new Error('Raster width must be a positive integer within valid limits');
  }
  if (!Number.isSafeInteger(heightDots) || heightDots <= 0) {
    throw new Error('Raster height must be a positive integer');
  }
  if (pixels.length !== widthDots * heightDots) {
    throw new Error('Raster pixels must contain one value per pixel');
  }

  const parts: Uint8Array[] = [];
  // Initialize printer: ESC @ (0x1B, 0x40)
  parts.push(new Uint8Array([0x1B, 0x40]));

  for (let offset = 0; offset < heightDots; offset += maxBandHeight) {
    const bandHeight = Math.min(maxBandHeight, heightDots - offset);
    const bandPixels = pixels.subarray(offset * widthDots, (offset + bandHeight) * widthDots);
    parts.push(encodeGsV0Band({ widthDots, heightDots: bandHeight, pixels: bandPixels }, maxBandHeight));
  }

  return concatBytes(parts);
}

/**
 * Encode a full monochrome pixel buffer using ESC * m=33 (24-dot double density).
 *
 * Slices vertically only at 24-dot boundaries across the entire document height in
 * strict sequential visual order. Line spacing is set to 24 dots (ESC 3 24) at the start,
 * and restored to standard 1/6-inch (ESC 2) only after the full document is completed.
 * Any final partial slice with height h < 24 sets ESC 3 h before its LF to maintain
 * exact vertical dot advance without vertical gaps, overlaps, or broken band transitions.
 */
export function encodeEscStar24Document(
  widthDots: number,
  heightDots: number,
  pixels: Uint8Array,
): Uint8Array {
  if (!Number.isSafeInteger(widthDots) || widthDots <= 0 || widthDots > MAX_RASTER_WIDTH_DOTS) {
    throw new Error('Raster width must be a positive integer within valid limits');
  }
  if (!Number.isSafeInteger(heightDots) || heightDots <= 0) {
    throw new Error('Raster height must be a positive integer');
  }
  if (pixels.length !== widthDots * heightDots) {
    throw new Error('Raster pixels must contain one value per pixel');
  }

  const nL = widthDots & 0xFF;
  const nH = (widthDots >> 8) & 0xFF;
  const parts: Uint8Array[] = [];

  // Reset printer, alignment to left, set line spacing to 24 dots: ESC @ ESC a 0 ESC 3 24
  parts.push(new Uint8Array([0x1B, 0x40, 0x1B, 0x61, 0x00, 0x1B, 0x33, 24]));

  for (let sliceY = 0; sliceY < heightDots; sliceY += 24) {
    const sliceHeight = Math.min(24, heightDots - sliceY);

    if (sliceHeight < 24) {
      parts.push(new Uint8Array([0x1B, 0x33, sliceHeight]));
    }

    const sliceHeader = new Uint8Array([0x1B, 0x2A, 33, nL, nH]);
    const sliceData = new Uint8Array(widthDots * 3);

    for (let x = 0; x < widthDots; x += 1) {
      const colOffset = x * 3;
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;

      for (let bit = 0; bit < 8; bit += 1) {
        const y = sliceY + bit;
        if (y < heightDots && pixels[y * widthDots + x] !== 0) {
          b0 |= 0x80 >> bit;
        }
      }

      for (let bit = 0; bit < 8; bit += 1) {
        const y = sliceY + 8 + bit;
        if (y < heightDots && pixels[y * widthDots + x] !== 0) {
          b1 |= 0x80 >> bit;
        }
      }

      for (let bit = 0; bit < 8; bit += 1) {
        const y = sliceY + 16 + bit;
        if (y < heightDots && pixels[y * widthDots + x] !== 0) {
          b2 |= 0x80 >> bit;
        }
      }

      sliceData[colOffset] = b0;
      sliceData[colOffset + 1] = b1;
      sliceData[colOffset + 2] = b2;
    }

    parts.push(sliceHeader, sliceData, new Uint8Array([0x0A]));
  }

  // Restore default line spacing: ESC 2 (0x1B, 0x32)
  // Left alignment: ESC a 0 (0x1B, 0x61, 0x00)
  parts.push(new Uint8Array([0x1B, 0x32, 0x1B, 0x61, 0x00]));

  return concatBytes(parts);
}

/**
 * Encodes a complete RenderedThermalDocument using the chosen transport (gs_v_0 or esc_star_24)
 * followed by standard feed and cut commands.
 */
export function encodeCanonicalDocumentToRaster(
  document: RenderedThermalDocument,
  transport: RasterImageTransport = 'gs_v_0',
  cutMode: 'full' | 'partial' = 'full',
  maxBandHeight = DEFAULT_RASTER_MAX_BAND_HEIGHT,
): Uint8Array {
  const bitmap = document.monochromeBitmap || document.monochromePixels;
  let rasterBytes: Uint8Array;
  if (transport === 'esc_star_24') {
    rasterBytes = encodeEscStar24Document(document.widthDots, document.heightDots, bitmap);
  } else {
    rasterBytes = encodeGsV0Document(document.widthDots, document.heightDots, bitmap, maxBandHeight);
  }
  return concatBytes([rasterBytes, encodeRasterFeedAndCut(cutMode)]);
}

/**
 * Encode exactly one validated band using ESC * m=33 (24-dot double density).
 */
export function encodeEscStar24Band(band: RasterBand, maxBandHeight = DEFAULT_RASTER_MAX_BAND_HEIGHT): Uint8Array {
  validateRasterBand(band, maxBandHeight);
  return encodeEscStar24Document(band.widthDots, band.heightDots, band.pixels);
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/**
 * Encode complete semantic units in order. No partial unit is ever emitted;
 * this is the shared pre-transport guard used by backend and WebUSB callers.
 */
export function encodeRasterUnits(
  units: readonly RasterSemanticUnit[],
  capabilities: ThermalPrinterCapabilities,
  mode: 'mixed' | 'whole-receipt' = 'mixed',
  transport: RasterImageTransport = 'gs_v_0',
): Uint8Array {
  if (!rasterCapabilityEnabled(capabilities, mode)) throw new Error(`Raster ${mode} output is not enabled for this printer profile`);
  const parts: Uint8Array[] = [];
  for (const unit of units) {
    if (!unit.complete || unit.bands.length === 0) {
      throw new Error(unit.financial ? 'Financial raster unit is incomplete' : `Raster unit ${unit.unitId} is incomplete`);
    }
    for (const band of unit.bands) {
      if (band.widthDots !== capabilities.raster.widthDots) {
        throw new Error(`Raster width ${band.widthDots} does not match profile width ${capabilities.raster.widthDots}`);
      }
      if (transport === 'esc_star_24') {
        parts.push(encodeEscStar24Band(band, capabilities.raster.maxBandHeight));
      } else {
        parts.push(encodeGsV0Band(band, capabilities.raster.maxBandHeight));
      }
    }
  }
  return concatBytes(parts);
}

/** Diagnostic bands used by the capability-gated printer test page. */
export function buildRasterDiagnosticBands(widthDots: number, maxBandHeight = DEFAULT_RASTER_MAX_BAND_HEIGHT): RasterBand[] {
  if (!Number.isSafeInteger(widthDots) || widthDots <= 0 || widthDots > MAX_RASTER_WIDTH_DOTS) throw new Error('Invalid diagnostic raster width');
  if (!Number.isSafeInteger(maxBandHeight) || maxBandHeight <= 0 || maxBandHeight > DEFAULT_RASTER_MAX_BAND_HEIGHT) {
    throw new Error('Invalid diagnostic raster band height');
  }
  const makeBand = (heightDots: number, yOffset: number, pixel: (x: number, y: number) => boolean): RasterBand => ({
    widthDots,
    heightDots,
    pixels: Uint8Array.from({ length: widthDots * heightDots }, (_, index) => {
      const x = index % widthDots;
      const y = yOffset + Math.floor(index / widthDots);
      return pixel(x, y) ? 1 : 0;
    }),
  });
  const bands: RasterBand[] = [];
  const appendBands = (heightDots: number, pixel: (x: number, y: number) => boolean): void => {
    for (let offset = 0; offset < heightDots; offset += maxBandHeight) {
      bands.push(makeBand(Math.min(maxBandHeight, heightDots - offset), offset, pixel));
    }
  };
  appendBands(48, (x) => x >= 8 && x < widthDots - 8);
  appendBands(48, (x, y) => Math.floor(x / 8) % 2 === Math.floor(y / 8) % 2);
  appendBands(24, () => true);
  bands.forEach((band) => validateRasterBand(band, maxBandHeight));
  return bands;
}

/** Tested compatibility path; callers must opt into the profile's whole-receipt mode. */
export function encodeWholeReceiptRaster(
  unit: RasterSemanticUnit,
  capabilities: ThermalPrinterCapabilities,
  cutMode: 'full' | 'partial',
  transport: RasterImageTransport = 'gs_v_0',
): Uint8Array {
  if (transport === 'esc_star_24') {
    if (!rasterCapabilityEnabled(capabilities, 'whole-receipt')) {
      throw new Error('Raster whole-receipt output is not enabled for this printer profile');
    }
    if (!unit.complete || unit.bands.length === 0) {
      throw new Error(unit.financial ? 'Financial raster unit is incomplete' : `Raster unit ${unit.unitId} is incomplete`);
    }
    const widthDots = capabilities.raster.widthDots;
    const totalHeight = unit.bands.reduce((sum, b) => sum + b.heightDots, 0);
    const fullPixels = new Uint8Array(widthDots * totalHeight);
    let offset = 0;
    for (const band of unit.bands) {
      if (band.widthDots !== widthDots) {
        throw new Error(`Raster width ${band.widthDots} does not match profile width ${widthDots}`);
      }
      fullPixels.set(band.pixels, offset);
      offset += band.pixels.length;
    }
    const rasterBytes = encodeEscStar24Document(widthDots, totalHeight, fullPixels);
    return concatBytes([rasterBytes, encodeRasterFeedAndCut(cutMode)]);
  }

  return concatBytes([encodeRasterUnits([unit], capabilities, 'whole-receipt', transport), encodeRasterFeedAndCut(cutMode)]);
}

export type MixedPrintPart =
  | { readonly kind: 'native'; readonly bytes: Uint8Array }
  | { readonly kind: 'raster'; readonly unit: RasterSemanticUnit };

/**
 * Assemble transport-neutral mixed output. Native bytes are copied verbatim;
 * raster parts are encoded in order, so backend and WebUSB share this boundary.
 */
export function encodeMixedPrintParts(
  parts: readonly MixedPrintPart[],
  capabilities: ThermalPrinterCapabilities,
  cutMode: 'full' | 'partial',
  transport: RasterImageTransport = 'gs_v_0',
): Uint8Array {
  const encoded: Uint8Array[] = [];
  for (const part of parts) {
    encoded.push(part.kind === 'native' ? new Uint8Array(part.bytes) : encodeRasterUnits([part.unit], capabilities, 'mixed', transport));
  }
  encoded.push(encodeRasterFeedAndCut(cutMode));
  return concatBytes(encoded);
}

/** Standard trailing feed and profile-selected cut used by all raw paths. */
export function encodeRasterFeedAndCut(cutMode: 'full' | 'partial', feedLines = 5): Uint8Array {
  if (!Number.isSafeInteger(feedLines) || feedLines < 0 || feedLines > 255) throw new Error('Invalid raster feed count');
  return new Uint8Array([
    0x1B, 0x64, feedLines,
    ...(cutMode === 'partial' ? [0x1D, 0x56, 0x42, 0x00] : [0x1D, 0x56, 0x00]),
  ]);
}

export function isBundledFontDataUrl(dataUrl: unknown): boolean {
  return typeof dataUrl === 'string' && dataUrl.length <= 4_000_000
    && /^data:font\/(?:woff2?|truetype|opentype);base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl);
}

export function isRasterRenderRequest(value: unknown): value is RasterRenderRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<RasterRenderRequest>;
  return request.version === 1
    && typeof request.requestId === 'string' && request.requestId.length > 0 && request.requestId.length <= 128
    && typeof request.text === 'string' && request.text.length <= 16_000
    && Number.isSafeInteger(request.widthDots) && (request.widthDots as number) > 0 && (request.widthDots as number) <= MAX_RASTER_WIDTH_DOTS
    && Number.isSafeInteger(request.maxBandHeight) && (request.maxBandHeight as number) > 0 && (request.maxBandHeight as number) <= DEFAULT_RASTER_MAX_BAND_HEIGHT
    && (request.direction === 'ltr' || request.direction === 'rtl')
    && (request.align === undefined || request.align === 'left' || request.align === 'center')
    && (request.layout === undefined || (
      !!request.layout
      && (request.layout.kind === 'financial-summary' || request.layout.kind === 'financial-item')
      && Array.isArray(request.layout.columns)
      && request.layout.columns.length >= 2
      && request.layout.columns.length <= 3
      && request.layout.columns.every((column) => !!column
        && typeof column.text === 'string'
        && column.text.length <= 16_000
        && (column.align === 'left' || column.align === 'right')
        && (column.widthRatio === undefined || (typeof column.widthRatio === 'number' && Number.isFinite(column.widthRatio) && column.widthRatio > 0 && column.widthRatio <= 1)))
      && request.layout.columns.reduce((sum, col) => sum + (typeof col?.widthRatio === 'number' ? col.widthRatio : 0), 0) <= 1.000001
    ))
    && ['normal', 'bold', 'double-height', 'double-width', 'font-b'].includes(request.style as string)
    && (request.styles === undefined || (Array.isArray(request.styles) && request.styles.length > 0 && request.styles.length <= 4
      && request.styles.every((style) => ['normal', 'bold', 'double-height', 'double-width', 'font-b'].includes(style))))
    && typeof request.financial === 'boolean'
    && Number.isSafeInteger(request.maxLines) && (request.maxLines as number) > 0 && (request.maxLines as number) <= 256
    && (request.bundledFont === undefined || (
      !!request.bundledFont
      && typeof request.bundledFont === 'object'
      && typeof request.bundledFont.family === 'string'
      && /^[A-Za-z0-9 _-]{1,64}$/.test(request.bundledFont.family)
      && isBundledFontDataUrl(request.bundledFont.dataUrl)
    ));
}

function isRasterBand(value: unknown): value is RasterBand {
  if (!value || typeof value !== 'object') return false;
  const band = value as Partial<RasterBand>;
  return Number.isSafeInteger(band.widthDots) && (band.widthDots as number) > 0
    && Number.isSafeInteger(band.heightDots) && (band.heightDots as number) > 0
    && band.pixels instanceof Uint8Array
    && band.pixels.length === (band.widthDots as number) * (band.heightDots as number);
}

function isRasterSemanticUnit(value: unknown): value is RasterSemanticUnit {
  if (!value || typeof value !== 'object') return false;
  const unit = value as Partial<RasterSemanticUnit>;
  return typeof unit.unitId === 'string'
    && typeof unit.financial === 'boolean'
    && typeof unit.complete === 'boolean'
    && Array.isArray(unit.bands)
    && unit.bands.every(isRasterBand);
}

export function isRasterRenderResult(value: unknown): value is RasterRenderResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<RasterRenderResult>;
  if (result.version !== 1 || typeof result.requestId !== 'string') return false;
  if (result.ok === true) return isRasterSemanticUnit(result.unit);
  return result.ok === false
    && (result.code === 'invalid-request' || result.code === 'font-unavailable' || result.code === 'render-failed')
    && typeof result.detail === 'string';
}
