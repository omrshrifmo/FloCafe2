import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import {
  DEFAULT_RASTER_MAX_BAND_HEIGHT,
  encodeWholeReceiptRaster,
  validateRasterBand,
  type RasterBand,
  type RasterSemanticUnit,
} from '../../shared/print/raster';
import type { ThermalPrinterCapabilities } from '../../shared/print/thermal-capabilities';
import type { PrinterCutMode } from './profiles';
import type { ResolvedPrintStyle } from '../../shared/print';

export type DitheringMode = 'threshold' | 'error-diffusion';
export type BrandedFontFamily = 'system' | 'cairo' | 'almarai';

export interface BrandedGeometry {
  readonly widthDots: number;
  readonly paddingDots: number;
  readonly borderThicknessDots: number;
  readonly borderInsetDots: number;
  readonly contentWidth: number;
  readonly contentLeft: number;
}

export interface ItemTableColumns {
  readonly priceWidth: number;
  readonly qtyWidth: number;
  readonly itemWidth: number;
  readonly contentWidth: number;
}

export interface BrandedLogoAsset {
  readonly data: Buffer;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
}

export interface BrandedReceiptItem {
  readonly name: string;
  readonly quantity: number;
  readonly price: number;
  readonly unitPrice?: number;
  readonly addons?: readonly { readonly name: string; readonly price: number }[];
  readonly notes?: string;
}

export interface BrandedReceiptTotalRow {
  readonly label: string;
  readonly value: string;
  readonly isBold?: boolean;
  readonly isLarge?: boolean;
}

export interface BrandedReceiptRequest {
  readonly version: 1;
  readonly kind: 'branded-receipt' | 'branded-kot';
  readonly requestId: string;
  readonly widthDots: number;
  readonly maxBandHeight: number;
  readonly fontFamily: BrandedFontFamily;
  readonly style?: ResolvedPrintStyle;
  readonly bundledFonts?: readonly { readonly family: string; readonly dataUrl: string; readonly weight?: string }[];
  readonly logo?: {
    readonly dataUrl: string;
    readonly width: number;
    readonly height: number;
  };
  readonly geometry: BrandedGeometry;
  readonly ditheringMode: DitheringMode;
  readonly threshold: number;
  readonly header: {
    readonly businessName: string;
    readonly address?: string;
    readonly phone?: string;
    readonly taxId?: string;
    readonly banner?: string;
  };
  readonly meta: {
    readonly invoiceNumber?: string;
    readonly orderNumber?: string;
    readonly timestamp?: string;
    readonly tableName?: string;
    readonly customerName?: string;
    readonly customerPhone?: string;
  };
  readonly items: readonly BrandedReceiptItem[];
  readonly totals: readonly BrandedReceiptTotalRow[];
  readonly footer: {
    readonly footerNote?: string;
    readonly thankYou?: string;
  };
}

export interface BrandedReceiptOutput {
  readonly ok: true;
  readonly unit: RasterSemanticUnit;
  readonly rasterBytes: Buffer;
  readonly previewDataUrl?: string;
  readonly renderTimeMs: number;
  readonly dimensions: {
    readonly widthDots: number;
    readonly heightDots: number;
    readonly bandCount: number;
  };
}

export interface BrandedReceiptRenderFailure {
  readonly ok: false;
  readonly error: string;
  readonly stage: 'prepare' | 'render';
  readonly renderTimeMs: number;
}

export type BrandedReceiptRenderResult = BrandedReceiptOutput | BrandedReceiptRenderFailure;

export const DEFAULT_RASTER_WIDTH_80MM = 576;
export const DEFAULT_RASTER_WIDTH_58MM = 384;
export const DEFAULT_RECEIPT_PADDING_DOTS = 16;
export const PRE_DISPATCH_TIMEOUT_WARN_MS = 4000;
export const PRE_DISPATCH_TIMEOUT_HARD_MS = 8000;

// ── Layout Geometry Calculation ─────────────────────────────────────────────

export function computeBrandedGeometry(options: {
  widthDots: number;
  paddingDots?: number;
  borderThicknessDots?: number;
  borderInsetDots?: number;
}): BrandedGeometry {
  const widthDots = Math.round(options.widthDots);
  if (!Number.isSafeInteger(widthDots) || widthDots < 64 || widthDots > 8192) {
    throw new Error(`Invalid raster widthDots: ${options.widthDots}. Must be between 64 and 8192.`);
  }

  const paddingDots = Math.max(0, Math.round(options.paddingDots ?? DEFAULT_RECEIPT_PADDING_DOTS));
  const borderThicknessDots = Math.max(0, Math.round(options.borderThicknessDots ?? 0));
  const borderInsetDots = Math.max(0, Math.round(options.borderInsetDots ?? 0));

  const totalInset = paddingDots + borderThicknessDots + borderInsetDots;
  const contentWidth = widthDots - (totalInset * 2);

  if (contentWidth < 32) {
    throw new Error(
      `Available content width ${contentWidth} is too narrow for raster width ${widthDots} with insets ${totalInset * 2}`,
    );
  }

  return {
    widthDots,
    paddingDots,
    borderThicknessDots,
    borderInsetDots,
    contentWidth,
    contentLeft: totalInset,
  };
}

export function calculateItemTableColumns(contentWidth: number): ItemTableColumns {
  const safeContentWidth = Math.max(32, contentWidth);
  const priceWidth = Math.max(64, Math.floor(safeContentWidth * 0.25));
  const qtyWidth = Math.max(40, Math.floor(safeContentWidth * 0.15));
  const itemWidth = Math.max(32, safeContentWidth - priceWidth - qtyWidth);

  return {
    priceWidth,
    qtyWidth,
    itemWidth,
    contentWidth: safeContentWidth,
  };
}

// ── Capability-Derived Logo Dimension Calculation ───────────────────────────

export interface LogoDimensions {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly maxAllowedWidth: number;
  readonly maxAllowedHeight: number;
}

export const LOGO_WIDTH_SAFE_PERCENTAGE = 0.70; // 70% of total raster width
export const LOGO_HEIGHT_MAX_ASPECT_RATIO = 0.40; // Max height is 40% of printable content width
export const MIN_READABLE_LOGO_DIMENSION_DOTS = 16; // Minimum floor for legibility

/**
 * Calculates dynamic, capability-derived logo dimensions.
 * Explicit upper caps:
 *   maxAllowedWidth = min(contentWidth, round(widthDots * safePercentage))
 *   maxAllowedHeight = round(contentWidth * heightRatio)
 * Sizing preserves aspect ratio and fits strictly within both capability-derived upper caps.
 */
export function computeCapabilityDerivedLogoDimensions(
  logo: { width: number; height: number },
  geometry: BrandedGeometry,
  options?: {
    widthSafePercentage?: number;
    heightMaxAspectRatio?: number;
  },
): LogoDimensions {
  const widthPercentage = options?.widthSafePercentage ?? LOGO_WIDTH_SAFE_PERCENTAGE;
  const heightRatio = options?.heightMaxAspectRatio ?? LOGO_HEIGHT_MAX_ASPECT_RATIO;

  const capabilityWidthCap = Math.round(geometry.widthDots * widthPercentage);
  const maxAllowedWidth = Math.max(MIN_READABLE_LOGO_DIMENSION_DOTS, Math.min(geometry.contentWidth, capabilityWidthCap));
  const maxAllowedHeight = Math.max(MIN_READABLE_LOGO_DIMENSION_DOTS, Math.round(geometry.contentWidth * heightRatio));

  const scale = Math.min(
    1,
    maxAllowedWidth / Math.max(1, logo.width),
    maxAllowedHeight / Math.max(1, logo.height),
  );

  const scaledWidth = Math.max(MIN_READABLE_LOGO_DIMENSION_DOTS, Math.min(maxAllowedWidth, Math.round(logo.width * scale)));
  const scaledHeight = Math.max(MIN_READABLE_LOGO_DIMENSION_DOTS, Math.min(maxAllowedHeight, Math.round(logo.height * scale)));

  return {
    width: scaledWidth,
    height: scaledHeight,
    scale,
    maxAllowedWidth,
    maxAllowedHeight,
  };
}

// ── Image Processing: Luminance Thresholding & Error-Diffusion ──────────────

export function convertImageBufferToMonochrome(
  rgbaPixels: Uint8Array,
  width: number,
  height: number,
  options: { mode?: DitheringMode; threshold?: number } = {},
): Uint8Array {
  const mode = options.mode ?? 'threshold';
  const threshold = options.threshold ?? 128;
  const pixelCount = width * height;
  const monochrome = new Uint8Array(pixelCount);

  if (mode === 'threshold') {
    for (let i = 0; i < pixelCount; i++) {
      const offset = i * 4;
      const r = rgbaPixels[offset];
      const g = rgbaPixels[offset + 1];
      const b = rgbaPixels[offset + 2];
      const a = rgbaPixels[offset + 3];

      if (a < 128) {
        monochrome[i] = 0;
      } else {
        const luminance = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        monochrome[i] = luminance < threshold ? 1 : 0;
      }
    }
    return monochrome;
  }

  // Error-diffusion dithering (Floyd-Steinberg)
  const grayscale = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    const a = rgbaPixels[offset + 3];
    if (a < 128) {
      grayscale[i] = 255;
    } else {
      grayscale[i] = 0.299 * rgbaPixels[offset] + 0.587 * rgbaPixels[offset + 1] + 0.114 * rgbaPixels[offset + 2];
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const oldVal = grayscale[idx];
      const newVal = oldVal < threshold ? 0 : 255;
      monochrome[idx] = newVal === 0 ? 1 : 0;
      const error = oldVal - newVal;

      if (x + 1 < width) {
        grayscale[idx + 1] += error * (7 / 16);
      }
      if (y + 1 < height) {
        if (x - 1 >= 0) {
          grayscale[(y + 1) * width + (x - 1)] += error * (3 / 16);
        }
        grayscale[(y + 1) * width + x] += error * (5 / 16);
        if (x + 1 < width) {
          grayscale[(y + 1) * width + (x + 1)] += error * (1 / 16);
        }
      }
    }
  }

  return monochrome;
}

// ── Font Asset Resolution ───────────────────────────────────────────────────

const fontDataUrlCache = new Map<string, string>();

export function getBundledFontDataUrl(
  family: 'almarai' | 'cairo',
  weight: 'regular' | 'bold',
): string | null {
  const cacheKey = `${family}:${weight}`;
  const cached = fontDataUrlCache.get(cacheKey);
  if (cached) return cached;

  const fontFilename = family === 'almarai'
    ? (weight === 'bold' ? 'Almarai-Bold.ttf' : 'Almarai-Regular.ttf')
    : (weight === 'bold' ? 'Cairo-Bold.ttf' : 'Cairo-Regular.ttf');

  const possiblePaths = [
    path.join(__dirname, `../assets/fonts/${family}/${fontFilename}`),
    path.join(__dirname, `../../main/assets/fonts/${family}/${fontFilename}`),
    path.join(process.cwd(), `main/assets/fonts/${family}/${fontFilename}`),
    path.join(process.cwd(), `dist/main/assets/fonts/${family}/${fontFilename}`),
  ];

  for (const fontPath of possiblePaths) {
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

export function resolveBundledFontList(
  family: BrandedFontFamily,
): readonly { readonly family: string; readonly dataUrl: string; readonly weight?: string }[] {
  if (family === 'system') return [];

  const fonts: { family: string; dataUrl: string; weight?: string }[] = [];
  const regular = getBundledFontDataUrl(family, 'regular');
  if (regular) {
    fonts.push({ family: family === 'almarai' ? 'Almarai' : 'Cairo', dataUrl: regular, weight: 'normal' });
  }
  const bold = getBundledFontDataUrl(family, 'bold');
  if (bold) {
    fonts.push({ family: family === 'almarai' ? 'Almarai' : 'Cairo', dataUrl: bold, weight: 'bold' });
  }

  return fonts;
}

// ── Build Branded Receipt Request ───────────────────────────────────────────

export function buildBrandedReceiptRequest(options: {
  order: any;
  bill: any;
  business?: any;
  widthDots?: number;
  paddingDots?: number;
  borderThicknessDots?: number;
  borderInsetDots?: number;
  fontFamily?: BrandedFontFamily;
  logoAsset?: BrandedLogoAsset | null;
  ditheringMode?: DitheringMode;
  threshold?: number;
  requestId?: string;
}): BrandedReceiptRequest {
  const widthDots = options.widthDots ?? DEFAULT_RASTER_WIDTH_80MM;
  const geometry = computeBrandedGeometry({
    widthDots,
    paddingDots: options.paddingDots,
    borderThicknessDots: options.borderThicknessDots,
    borderInsetDots: options.borderInsetDots,
  });

  const fontFamily = options.fontFamily ?? 'almarai';
  const bundledFonts = resolveBundledFontList(fontFamily);

  const business = options.business ?? {};
  const bill = options.bill ?? {};
  const order = options.order ?? {};

  let logoPayload: BrandedReceiptRequest['logo'];
  if (options.logoAsset && options.logoAsset.data.length > 0) {
    logoPayload = {
      dataUrl: `data:${options.logoAsset.mimeType};base64,${options.logoAsset.data.toString('base64')}`,
      width: options.logoAsset.width,
      height: options.logoAsset.height,
    };
  }

  const items: BrandedReceiptItem[] = [];
  const rawItems = order.items || bill.items || [];
  for (const item of rawItems) {
    const name = String(item.product_name || item.name || 'Item');
    const quantity = Number(item.quantity || 1);
    const price = Number(item.total_price || item.price || 0);
    const unitPrice = item.unit_price !== undefined ? Number(item.unit_price) : undefined;
    const addons = Array.isArray(item.addons)
      ? item.addons.map((a: any) => ({ name: String(a.name || a.addon_name || ''), price: Number(a.price || 0) }))
      : undefined;
    const notes = item.notes ? String(item.notes) : undefined;

    items.push({ name, quantity, price, unitPrice, addons, notes });
  }

  const currencySymbol = business.currency_symbol || business.currency || '$';
  const formatAmt = (amt: number): string => `${currencySymbol} ${amt.toFixed(business.trim_decimals ? 0 : 2)}`;

  const totals: BrandedReceiptTotalRow[] = [];
  if (bill.subtotal !== undefined) {
    totals.push({ label: 'Subtotal / المجموع الفرعي', value: formatAmt(Number(bill.subtotal || 0)) });
  }
  if (bill.discount_amount && Number(bill.discount_amount) > 0) {
    totals.push({ label: 'Discount / الخصم', value: `-${formatAmt(Number(bill.discount_amount))}` });
  }
  if (bill.tax_amount && Number(bill.tax_amount) > 0) {
    totals.push({ label: 'Tax / الضريبة', value: formatAmt(Number(bill.tax_amount)) });
  }
  if (bill.service_charge && Number(bill.service_charge) > 0) {
    totals.push({ label: 'Service / خدمة', value: formatAmt(Number(bill.service_charge)) });
  }
  if (bill.delivery_charge && Number(bill.delivery_charge) > 0) {
    totals.push({ label: 'Delivery / توصيل', value: formatAmt(Number(bill.delivery_charge)) });
  }

  totals.push({
    label: 'Total / الإجمالي',
    value: formatAmt(Number(bill.total || order.total || 0)),
    isBold: true,
    isLarge: true,
  });

  if (bill.paid_amount !== undefined && Number(bill.paid_amount) > 0) {
    totals.push({ label: 'Paid / المدفوع', value: formatAmt(Number(bill.paid_amount)) });
  }
  if (bill.balance !== undefined && Number(bill.balance) > 0) {
    totals.push({ label: 'Balance / المتبقي', value: formatAmt(Number(bill.balance)) });
  }

  return {
    version: 1,
    kind: 'branded-receipt',
    requestId: options.requestId || `branded-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    widthDots,
    maxBandHeight: DEFAULT_RASTER_MAX_BAND_HEIGHT,
    fontFamily,
    bundledFonts: bundledFonts.length > 0 ? bundledFonts : undefined,
    logo: logoPayload,
    geometry,
    ditheringMode: options.ditheringMode ?? 'threshold',
    threshold: options.threshold ?? 128,
    header: {
      businessName: business.name || 'FloCafe',
      address: business.address || undefined,
      phone: business.phone || undefined,
      taxId: business.taxRegistrationNumber || undefined,
      banner: options.order?.isReprint ? '*** REPRINT / إعادة طباعة ***' : undefined,
    },
    meta: {
      invoiceNumber: bill.bill_number ? String(bill.bill_number) : undefined,
      orderNumber: order.order_number ? String(order.order_number) : undefined,
      timestamp: bill.created_at || order.created_at || new Date().toISOString().replace('T', ' ').slice(0, 19),
      tableName: order.table?.name || business.table_name || undefined,
      customerName: business.customer_name || undefined,
      customerPhone: business.customer_phone || undefined,
    },
    items,
    totals,
    footer: {
      footerNote: business.footer_note || undefined,
      thankYou: 'Thank you for your visit / شكراً لزيارتكم',
    },
  };
}

// ── Build Branded Diagnostic Request (Non-Financial Diagnostic Receipt) ─────

export function buildBrandedDiagnosticRequest(options: {
  business?: any;
  printer?: any;
  widthDots?: number;
  fontFamily?: BrandedFontFamily;
  logoAsset?: BrandedLogoAsset | null;
  requestId?: string;
}): BrandedReceiptRequest {
  const widthDots = options.widthDots ?? (options.printer?.paper_width?.includes('58') ? DEFAULT_RASTER_WIDTH_58MM : DEFAULT_RASTER_WIDTH_80MM);
  const geometry = computeBrandedGeometry({ widthDots });

  const fontFamily = options.fontFamily ?? 'almarai';
  const bundledFonts = resolveBundledFontList(fontFamily);
  const business = options.business ?? {};

  let logoPayload: BrandedReceiptRequest['logo'];
  if (options.logoAsset && options.logoAsset.data.length > 0) {
    logoPayload = {
      dataUrl: `data:${options.logoAsset.mimeType};base64,${options.logoAsset.data.toString('base64')}`,
      width: options.logoAsset.width,
      height: options.logoAsset.height,
    };
  }

  const printerName = options.printer?.name || 'Thermal Receipt Printer';
  const paperSpec = `${widthDots} dots (${widthDots >= 500 ? '80mm' : '58mm'})`;

  const items: BrandedReceiptItem[] = [
    {
      name: 'قهوة مختصة مقطرة V60 / Specialty Coffee',
      quantity: 2,
      price: 36.00,
      unitPrice: 18.00,
      notes: 'Arabic & Latin typography rendering test',
    },
    {
      name: 'كرواسون بالزبدة السويسرية / Croissant',
      quantity: 1,
      price: 18.50,
      unitPrice: 18.50,
      addons: [{ name: 'إضافة مربى فراولة / Strawberry Jam', price: 3.50 }],
    },
    {
      name: 'Cold Brew بالحليب المكثف / Iced Latte',
      quantity: 3,
      price: 54.00,
      unitPrice: 18.00,
    },
    {
      name: 'شاي أخضر ياسمين إنجليزي / Jasmine Tea',
      quantity: 1,
      price: 12.00,
      unitPrice: 12.00,
    },
    {
      name: 'مياه معدنية طبيعية 500مل / Water',
      quantity: 2,
      price: 8.00,
      unitPrice: 4.00,
    },
    {
      name: 'كعكة التمر بالكراميل / Date Cake',
      quantity: 1,
      price: 24.00,
      unitPrice: 24.00,
      notes: 'Multi-band overflow & feed test',
    },
  ];

  const currencySymbol = business.currency_symbol || business.currency || 'SAR';
  const totals: BrandedReceiptTotalRow[] = [
    { label: 'Sample Subtotal / إجمالي تجريبي', value: `${currencySymbol} 152.50` },
    { label: 'Sample Tax (15%) / ضريبة تجريبية', value: `${currencySymbol} 22.88` },
    { label: 'Sample Total / الإجمالي التجريبي', value: `${currencySymbol} 175.38`, isBold: true, isLarge: true },
  ];

  return {
    version: 1,
    kind: 'branded-receipt',
    requestId: options.requestId || `diag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    widthDots,
    maxBandHeight: DEFAULT_RASTER_MAX_BAND_HEIGHT,
    fontFamily,
    bundledFonts: bundledFonts.length > 0 ? bundledFonts : undefined,
    logo: logoPayload,
    geometry,
    ditheringMode: 'threshold',
    threshold: 128,
    header: {
      businessName: business.name || 'FloCafe POS',
      address: business.address || undefined,
      phone: business.phone || undefined,
      banner: 'FLOCAFE PRINTER DIAGNOSTIC — NOT A SALES RECEIPT\nاختبار طابعة FloCafe — ليست فاتورة بيع',
    },
    meta: {
      orderNumber: 'DIAG-RASTER-PROBE',
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      tableName: `Printer: ${printerName}`,
      customerName: `Format: ${paperSpec}`,
      customerPhone: `Margin: [|<-- ${widthDots} dots -->|]`,
    },
    items,
    totals,
    footer: {
      footerNote: 'DIAGNOSTIC TEST COMPLETE — NOT A SALES RECEIPT\nانتهى اختبار الطابعة — ليست فاتورة بيع أو مطالبة مالية',
      thankYou: `Width: ${widthDots} dots | Margin Markers: [|<-- ${widthDots} dots -->|]`,
    },
  };
}

// ── 5x7 Monospaced Font Table & Decoding Helpers ───────────────────────────

const FONT_5X7: Record<string, number[]> = {
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00],
  '!': [0x00, 0x00, 0x5f, 0x00, 0x00],
  '"': [0x00, 0x07, 0x00, 0x07, 0x00],
  '#': [0x14, 0x7f, 0x14, 0x7f, 0x14],
  '$': [0x24, 0x2a, 0x7f, 0x2a, 0x12],
  '%': [0x23, 0x13, 0x08, 0x64, 0x62],
  '&': [0x36, 0x49, 0x55, 0x22, 0x50],
  "'": [0x00, 0x05, 0x03, 0x00, 0x00],
  '(': [0x00, 0x1c, 0x22, 0x41, 0x00],
  ')': [0x00, 0x41, 0x22, 0x1c, 0x00],
  '*': [0x14, 0x08, 0x3e, 0x08, 0x14],
  '+': [0x08, 0x08, 0x3e, 0x08, 0x08],
  ',': [0x00, 0x50, 0x30, 0x00, 0x00],
  '-': [0x08, 0x08, 0x08, 0x08, 0x08],
  '.': [0x00, 0x60, 0x60, 0x00, 0x00],
  '/': [0x20, 0x10, 0x08, 0x04, 0x02],
  '0': [0x3e, 0x51, 0x49, 0x45, 0x3e],
  '1': [0x00, 0x42, 0x7f, 0x40, 0x00],
  '2': [0x42, 0x61, 0x51, 0x49, 0x46],
  '3': [0x21, 0x41, 0x45, 0x4b, 0x31],
  '4': [0x18, 0x14, 0x12, 0x7f, 0x10],
  '5': [0x27, 0x45, 0x45, 0x45, 0x39],
  '6': [0x3c, 0x4a, 0x49, 0x49, 0x30],
  '7': [0x01, 0x71, 0x09, 0x05, 0x03],
  '8': [0x36, 0x49, 0x49, 0x49, 0x36],
  '9': [0x06, 0x49, 0x49, 0x29, 0x1e],
  ':': [0x00, 0x36, 0x36, 0x00, 0x00],
  ';': [0x00, 0x56, 0x36, 0x00, 0x00],
  '<': [0x08, 0x14, 0x22, 0x41, 0x00],
  '=': [0x14, 0x14, 0x14, 0x14, 0x14],
  '>': [0x00, 0x41, 0x22, 0x14, 0x08],
  '?': [0x02, 0x01, 0x51, 0x09, 0x06],
  '@': [0x32, 0x49, 0x79, 0x41, 0x3e],
  'A': [0x7e, 0x11, 0x11, 0x11, 0x7e],
  'B': [0x7f, 0x49, 0x49, 0x49, 0x36],
  'C': [0x3e, 0x41, 0x41, 0x41, 0x22],
  'D': [0x7f, 0x41, 0x41, 0x22, 0x1c],
  'E': [0x7f, 0x49, 0x49, 0x49, 0x41],
  'F': [0x7f, 0x09, 0x09, 0x09, 0x01],
  'G': [0x3e, 0x41, 0x49, 0x49, 0x7a],
  'H': [0x7f, 0x08, 0x08, 0x08, 0x7f],
  'I': [0x00, 0x41, 0x7f, 0x41, 0x00],
  'J': [0x20, 0x40, 0x41, 0x3f, 0x01],
  'K': [0x7f, 0x08, 0x14, 0x22, 0x41],
  'L': [0x7f, 0x40, 0x40, 0x40, 0x40],
  'M': [0x7f, 0x02, 0x0c, 0x02, 0x7f],
  'N': [0x7f, 0x04, 0x08, 0x10, 0x7f],
  'O': [0x3e, 0x41, 0x41, 0x41, 0x3e],
  'P': [0x7f, 0x09, 0x09, 0x09, 0x06],
  'Q': [0x3e, 0x41, 0x51, 0x21, 0x5e],
  'R': [0x7f, 0x09, 0x19, 0x29, 0x46],
  'S': [0x46, 0x49, 0x49, 0x49, 0x31],
  'T': [0x01, 0x01, 0x7f, 0x01, 0x01],
  'U': [0x3f, 0x40, 0x40, 0x40, 0x3f],
  'V': [0x1f, 0x20, 0x40, 0x20, 0x1f],
  'W': [0x3f, 0x40, 0x38, 0x40, 0x3f],
  'X': [0x63, 0x14, 0x08, 0x14, 0x63],
  'Y': [0x07, 0x08, 0x70, 0x08, 0x07],
  'Z': [0x61, 0x51, 0x49, 0x45, 0x43],
  '[': [0x00, 0x7f, 0x41, 0x41, 0x00],
  '\\': [0x02, 0x04, 0x08, 0x10, 0x20],
  ']': [0x00, 0x41, 0x41, 0x7f, 0x00],
  '^': [0x04, 0x02, 0x01, 0x02, 0x04],
  '_': [0x40, 0x40, 0x40, 0x40, 0x40],
  '`': [0x00, 0x01, 0x02, 0x04, 0x00],
  'a': [0x20, 0x54, 0x54, 0x54, 0x78],
  'b': [0x7f, 0x48, 0x44, 0x44, 0x38],
  'c': [0x38, 0x44, 0x44, 0x44, 0x20],
  'd': [0x38, 0x44, 0x44, 0x48, 0x7f],
  'e': [0x38, 0x54, 0x54, 0x54, 0x18],
  'f': [0x08, 0x7e, 0x09, 0x01, 0x02],
  'g': [0x0c, 0x52, 0x52, 0x52, 0x3e],
  'h': [0x7f, 0x08, 0x04, 0x04, 0x78],
  'i': [0x00, 0x44, 0x7d, 0x40, 0x00],
  'j': [0x20, 0x40, 0x44, 0x3d, 0x00],
  'k': [0x7f, 0x10, 0x28, 0x44, 0x00],
  'l': [0x00, 0x41, 0x7f, 0x40, 0x00],
  'm': [0x7c, 0x04, 0x18, 0x04, 0x78],
  'n': [0x7c, 0x08, 0x04, 0x04, 0x78],
  'o': [0x38, 0x44, 0x44, 0x44, 0x38],
  'p': [0x7c, 0x14, 0x14, 0x14, 0x08],
  'q': [0x08, 0x14, 0x14, 0x18, 0x7c],
  'r': [0x7c, 0x08, 0x04, 0x04, 0x08],
  's': [0x48, 0x54, 0x54, 0x54, 0x20],
  't': [0x04, 0x3f, 0x44, 0x40, 0x20],
  'u': [0x3c, 0x40, 0x40, 0x20, 0x7c],
  'v': [0x1c, 0x20, 0x40, 0x20, 0x1c],
  'w': [0x3c, 0x40, 0x30, 0x40, 0x3c],
  'x': [0x44, 0x28, 0x10, 0x28, 0x44],
  'y': [0x0c, 0x50, 0x50, 0x50, 0x3c],
  'z': [0x44, 0x64, 0x54, 0x4c, 0x44],
  '|': [0x00, 0x00, 0x7f, 0x00, 0x00],
  '~': [0x10, 0x08, 0x18, 0x10, 0x08],
};

function decodePngDataUrlToMonochrome(
  dataUrl: string,
  targetWidth: number,
  targetHeight: number,
  threshold = 128,
): Uint8Array | null {
  try {
    if (!dataUrl || !dataUrl.startsWith('data:image/png;base64,')) return null;
    const base64Data = dataUrl.slice('data:image/png;base64,'.length);
    const pngBuf = Buffer.from(base64Data, 'base64');
    if (pngBuf.length < 24) return null;
    if (pngBuf[0] !== 0x89 || pngBuf[1] !== 0x50 || pngBuf[2] !== 0x4E || pngBuf[3] !== 0x47) return null;

    const width = pngBuf.readUInt32BE(16);
    const height = pngBuf.readUInt32BE(20);
    const colorType = pngBuf[25];
    if (width <= 0 || height <= 0 || width > 4096 || height > 4096) return null;

    const idatChunks: Buffer[] = [];
    let offset = 8;
    while (offset < pngBuf.length - 8) {
      const length = pngBuf.readUInt32BE(offset);
      const type = pngBuf.toString('ascii', offset + 4, offset + 8);
      if (type === 'IDAT') {
        idatChunks.push(pngBuf.subarray(offset + 8, offset + 8 + length));
      }
      offset += 12 + length;
    }
    if (idatChunks.length === 0) return null;

    const compressed = Buffer.concat(idatChunks);
    const uncompressed = zlib.inflateSync(compressed);

    let bytesPerPixel = 1;
    if (colorType === 0) bytesPerPixel = 1; // Grayscale
    else if (colorType === 2) bytesPerPixel = 3; // RGB
    else if (colorType === 4) bytesPerPixel = 2; // Grayscale + Alpha
    else if (colorType === 6) bytesPerPixel = 4; // RGBA
    else return null;

    const srcStride = 1 + width * bytesPerPixel;
    const srcPixels = new Uint8Array(width * height);

    for (let y = 0; y < height; y++) {
      const lineOffset = y * srcStride;
      const filter = uncompressed[lineOffset];
      const prevLineOffset = y > 0 ? (y - 1) * srcStride : -1;

      for (let x = 0; x < width; x++) {
        const pxOffset = lineOffset + 1 + x * bytesPerPixel;
        let rawVal0 = uncompressed[pxOffset];
        if (filter === 1) {
          const left = x > 0 ? uncompressed[pxOffset - bytesPerPixel] : 0;
          rawVal0 = (rawVal0 + left) & 0xff;
          uncompressed[pxOffset] = rawVal0;
        } else if (filter === 2 && prevLineOffset >= 0) {
          const up = uncompressed[prevLineOffset + 1 + x * bytesPerPixel];
          rawVal0 = (rawVal0 + up) & 0xff;
          uncompressed[pxOffset] = rawVal0;
        }

        let r = rawVal0, g = rawVal0, b = rawVal0, a = 255;
        if (colorType === 2 || colorType === 6) {
          let rawVal1 = uncompressed[pxOffset + 1];
          let rawVal2 = uncompressed[pxOffset + 2];
          if (filter === 1 && x > 0) {
            rawVal1 = (rawVal1 + uncompressed[pxOffset + 1 - bytesPerPixel]) & 0xff;
            rawVal2 = (rawVal2 + uncompressed[pxOffset + 2 - bytesPerPixel]) & 0xff;
            uncompressed[pxOffset + 1] = rawVal1;
            uncompressed[pxOffset + 2] = rawVal2;
          } else if (filter === 2 && prevLineOffset >= 0) {
            rawVal1 = (rawVal1 + uncompressed[prevLineOffset + 1 + x * bytesPerPixel + 1]) & 0xff;
            rawVal2 = (rawVal2 + uncompressed[prevLineOffset + 1 + x * bytesPerPixel + 2]) & 0xff;
            uncompressed[pxOffset + 1] = rawVal1;
            uncompressed[pxOffset + 2] = rawVal2;
          }
          g = rawVal1;
          b = rawVal2;
          if (colorType === 6) {
            let rawVal3 = uncompressed[pxOffset + 3];
            if (filter === 1 && x > 0) {
              rawVal3 = (rawVal3 + uncompressed[pxOffset + 3 - bytesPerPixel]) & 0xff;
              uncompressed[pxOffset + 3] = rawVal3;
            } else if (filter === 2 && prevLineOffset >= 0) {
              rawVal3 = (rawVal3 + uncompressed[prevLineOffset + 1 + x * bytesPerPixel + 3]) & 0xff;
              uncompressed[pxOffset + 3] = rawVal3;
            }
            a = rawVal3;
          }
        } else if (colorType === 4) {
          let rawVal1 = uncompressed[pxOffset + 1];
          if (filter === 1 && x > 0) {
            rawVal1 = (rawVal1 + uncompressed[pxOffset + 1 - bytesPerPixel]) & 0xff;
            uncompressed[pxOffset + 1] = rawVal1;
          } else if (filter === 2 && prevLineOffset >= 0) {
            rawVal1 = (rawVal1 + uncompressed[prevLineOffset + 1 + x * bytesPerPixel + 1]) & 0xff;
            uncompressed[pxOffset + 1] = rawVal1;
          }
          a = rawVal1;
        }

        if (a < 64) {
          srcPixels[y * width + x] = 0;
        } else {
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          srcPixels[y * width + x] = lum < threshold ? 1 : 0;
        }
      }
    }

    const dstPixels = new Uint8Array(targetWidth * targetHeight);
    for (let ty = 0; ty < targetHeight; ty++) {
      const sy = Math.floor((ty * height) / targetHeight);
      for (let tx = 0; tx < targetWidth; tx++) {
        const sx = Math.floor((tx * width) / targetWidth);
        dstPixels[ty * targetWidth + tx] = srcPixels[sy * width + sx];
      }
    }
    return dstPixels;
  } catch {
    return null;
  }
}

// ── Pure Software Bitmap & Banding Compositor (for Tests & Headless) ────────

export function renderBrandedReceiptSoftware(
  request: BrandedReceiptRequest,
): BrandedReceiptOutput {
  const startTime = Date.now();
  const width = request.widthDots || DEFAULT_RASTER_WIDTH_80MM;
  const geom = request.geometry || computeBrandedGeometry({ widthDots: width });
  const contentWidth = geom.contentWidth;
  const contentLeft = geom.contentLeft;
  const items = request.items || [];
  const totals = request.totals || [];

  // Estimate receipt height based on sections
  const rowHeight = 28;
  let estimatedHeight = 32; // initial top pad

  if (request.logo) {
    const logoDims = computeCapabilityDerivedLogoDimensions(request.logo, geom);
    estimatedHeight += logoDims.height + 16;
  }

  estimatedHeight += rowHeight * 4; // header (banner, name, address, phone)
  estimatedHeight += 16; // divider
  estimatedHeight += rowHeight * 3; // meta (order #, time, table)
  estimatedHeight += 16; // divider
  estimatedHeight += rowHeight; // table header
  estimatedHeight += 8; // divider

  for (const item of items) {
    estimatedHeight += rowHeight;
    if (item.addons && item.addons.length > 0) {
      estimatedHeight += item.addons.length * 20;
    }
  }

  estimatedHeight += 16; // divider
  estimatedHeight += totals.length * rowHeight;
  estimatedHeight += 16; // divider
  estimatedHeight += rowHeight * 2; // footer
  estimatedHeight += 48; // bottom margin / cut gap

  const height = Math.max(128, estimatedHeight);
  const totalPixels = width * height;
  const pixels = new Uint8Array(totalPixels);

  // Helper: draw horizontal divider line
  const drawLine = (y: number, thickness = 2) => {
    const dividerStyle = request.style?.frame?.dividerStyle;
    if (dividerStyle === 'none') return;
    for (let dy = 0; dy < thickness; dy++) {
      const lineY = y + dy;
      if (lineY >= height) break;
      for (let x = contentLeft; x < contentLeft + contentWidth; x++) {
        if (dividerStyle === 'dotted') {
          if (x % 4 === 0) pixels[lineY * width + x] = 1;
        } else if (dividerStyle === 'dashed') {
          if ((x % 8) < 5) pixels[lineY * width + x] = 1;
        } else {
          pixels[lineY * width + x] = 1;
        }
      }
    }
  };

  // Helper: render ASCII text string with 5x7 font
  const renderText = (startX: number, startY: number, str: string, scale = 1, isBold = false) => {
    let curX = startX;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) <= 126) {
        const cols = FONT_5X7[ch] || FONT_5X7[' '];
        for (let c = 0; c < 5; c++) {
          const colByte = cols[c];
          for (let r = 0; r < 7; r++) {
            if ((colByte & (1 << r)) !== 0) {
              for (let sx = 0; sx < scale; sx++) {
                for (let sy = 0; sy < scale; sy++) {
                  const px = curX + c * scale + sx;
                  const py = startY + r * scale + sy;
                  if (px >= 0 && px < width && py >= 0 && py < height) {
                    pixels[py * width + px] = 1;
                    if (isBold && px + 1 < width) {
                      pixels[py * width + px + 1] = 1;
                    }
                  }
                }
              }
            }
          }
        }
        curX += (5 + (isBold ? 2 : 1)) * scale;
      } else {
        // Simple 4x6 marker for non-ASCII / Arabic glyphs
        for (let sy = 1; sy < 7; sy++) {
          for (let sx = 0; sx < 4; sx++) {
            const px = curX + sx;
            const py = startY + sy * scale;
            if (px >= 0 && px < width && py >= 0 && py < height) {
              pixels[py * width + px] = (sx === 0 || sx === 3 || sy === 1 || sy === 6) ? 1 : 0;
            }
          }
        }
        curX += 5 * scale;
      }
    }
  };

  let currentY = 16;

  // 1. Logo
  if (request.logo) {
    const logoDims = computeCapabilityDerivedLogoDimensions(request.logo, geom);
    const logoW = logoDims.width;
    const logoH = logoDims.height;
    const logoX = contentLeft + Math.floor((contentWidth - logoW) / 2);

    let decodedLogo: Uint8Array | null = null;
    if (request.logo.dataUrl) {
      decodedLogo = decodePngDataUrlToMonochrome(request.logo.dataUrl, logoW, logoH, request.threshold || 128);
    }

    if (decodedLogo) {
      for (let dy = 0; dy < logoH; dy++) {
        for (let dx = 0; dx < logoW; dx++) {
          if (decodedLogo[dy * logoW + dx] === 1) {
            const px = logoX + dx;
            const py = currentY + dy;
            if (px >= 0 && px < width && py >= 0 && py < height) {
              pixels[py * width + px] = 1;
            }
          }
        }
      }
    } else {
      // Border box fallback with centered label
      for (let x = logoX; x < logoX + logoW; x++) {
        if (x < width) {
          pixels[currentY * width + x] = 1;
          pixels[(currentY + logoH - 1) * width + x] = 1;
        }
      }
      for (let y = currentY; y < currentY + logoH; y++) {
        if (y < height) {
          pixels[y * width + logoX] = 1;
          pixels[y * width + (logoX + logoW - 1)] = 1;
        }
      }
      renderText(Math.max(contentLeft, logoX + Math.floor(logoW / 2) - 30), currentY + Math.floor(logoH / 2) - 4, 'STORE LOGO', 1, true);
    }
    currentY += logoH + 16;
  }

  // 2. Header
  if (request.header.banner) {
    renderText(contentLeft, currentY, request.header.banner, 1, true);
    currentY += rowHeight;
  }
  if (request.header.businessName) {
    renderText(contentLeft, currentY, request.header.businessName, 2, true);
    currentY += rowHeight;
  }
  if (request.header.phone) {
    renderText(contentLeft, currentY, `TEL: ${request.header.phone}`, 1);
    currentY += 20;
  }
  if (request.header.taxId) {
    renderText(contentLeft, currentY, `TAX ID: ${request.header.taxId}`, 1);
    currentY += 20;
  }
  drawLine(currentY);
  currentY += 12;

  // 3. Metadata
  if (request.meta.invoiceNumber) {
    renderText(contentLeft, currentY, `INV: ${request.meta.invoiceNumber}`, 1, true);
  }
  if (request.meta.orderNumber) {
    renderText(contentLeft + Math.floor(contentWidth / 2), currentY, `#${request.meta.orderNumber}`, 1, true);
  }
  currentY += 20;

  if (request.meta.timestamp) {
    renderText(contentLeft, currentY, request.meta.timestamp, 1);
    currentY += 20;
  }
  drawLine(currentY);
  currentY += 12;

  // 4. Table Header & Items
  const cols = calculateItemTableColumns(contentWidth);
  renderText(contentLeft, currentY, 'PRICE', 1, true);
  renderText(contentLeft + cols.priceWidth + 8, currentY, 'QTY', 1, true);
  renderText(contentLeft + cols.priceWidth + cols.qtyWidth, currentY, 'ITEM', 1, true);
  currentY += rowHeight;
  drawLine(currentY, 1);
  currentY += 8;

  for (const item of items) {
    const priceStr = typeof item.price === 'number' ? item.price.toFixed(2) : String(item.price);
    const qtyStr = String(item.quantity);
    const nameStr = item.name.slice(0, 24);

    renderText(contentLeft, currentY + 4, priceStr, 1);
    renderText(contentLeft + cols.priceWidth + 8, currentY + 4, qtyStr, 1);
    renderText(contentLeft + cols.priceWidth + cols.qtyWidth, currentY + 4, nameStr, 1);
    currentY += rowHeight;

    if (item.addons && item.addons.length > 0) {
      for (const addon of item.addons) {
        renderText(contentLeft + cols.priceWidth + cols.qtyWidth + 10, currentY + 2, `+ ${addon.name}`, 1);
        currentY += 18;
      }
    }
  }

  drawLine(currentY);
  currentY += 12;

  // 5. Totals
  for (let i = 0; i < totals.length; i++) {
    const totalRow = totals[i];
    const isBold = totalRow.isBold || false;
    const scale = totalRow.isLarge ? 2 : 1;
    renderText(contentLeft, currentY + 4, String(totalRow.value), scale, isBold);
    renderText(contentLeft + cols.priceWidth + 8, currentY + 4, String(totalRow.label), scale, isBold);
    currentY += rowHeight;
  }

  drawLine(currentY);
  currentY += 16;

  // 6. Footer
  if (request.footer.thankYou) {
    renderText(contentLeft, currentY, request.footer.thankYou, 1, true);
    currentY += rowHeight;
  }

  // Draw outer frame border if enabled
  if (request.style?.frame?.borderStyle && request.style.frame.borderStyle !== 'none') {
    const bs = request.style.frame.borderStyle;
    const thickness = request.style.frame.borderThickness || 1;
    const padding = request.style.frame.borderPadding || 8;
    const minX = Math.max(0, contentLeft - padding);
    const maxX = Math.min(width - 1, contentLeft + contentWidth + padding);
    const minY = 4;
    const maxY = Math.min(height - 4, currentY + 8);

    const isBorderPixelOn = (pos: number) => {
      if (bs === 'dotted') return pos % 4 === 0;
      if (bs === 'dashed') return (pos % 8) < 5;
      return true;
    };

    for (let t = 0; t < thickness; t++) {
      for (let x = minX; x <= maxX; x++) {
        if (isBorderPixelOn(x)) {
          if (minY + t < height) pixels[(minY + t) * width + x] = 1;
          if (maxY - t >= 0 && maxY - t < height) pixels[(maxY - t) * width + x] = 1;
        }
      }
      for (let y = minY; y <= maxY; y++) {
        if (isBorderPixelOn(y)) {
          if (minX + t < width) pixels[y * width + (minX + t)] = 1;
          if (maxX - t >= 0) pixels[y * width + (maxX - t)] = 1;
        }
      }
    }
  }

  // Chunk pixels into 200-dot RasterBand[]
  const bands: RasterBand[] = [];
  const maxBandHeight = request.maxBandHeight || DEFAULT_RASTER_MAX_BAND_HEIGHT;
  for (let offset = 0; offset < height; offset += maxBandHeight) {
    const bandHeight = Math.min(maxBandHeight, height - offset);
    const bandPixels = pixels.slice(offset * width, (offset + bandHeight) * width);
    const band: RasterBand = {
      widthDots: width,
      heightDots: bandHeight,
      pixels: bandPixels,
    };
    validateRasterBand(band, maxBandHeight);
    bands.push(band);
  }

  const unit: RasterSemanticUnit = {
    unitId: request.requestId,
    financial: true,
    complete: true,
    bands,
  };

  // Generate lightweight PNG preview data URL
  const previewPng = createMonochromePngBuffer(width, height, pixels);
  const previewDataUrl = `data:image/png;base64,${previewPng.toString('base64')}`;

  const capabilities: ThermalPrinterCapabilities = {
    encoding: { codePages: ['ascii'], preferredCodePage: 'ascii' },
    shaping: { arabic: true },
    representability: { scripts: ['ascii', 'arabic'] },
    transliteration: { enabled: false },
    warnings: { unsupportedText: 'skip', financialText: 'refuse', orderTypeFallback: 'ascii' },
    raster: {
      enabled: true,
      widthDots: width,
      maxBandHeight,
      modes: ['whole-receipt'],
    },
  };

  const rasterBytes = Buffer.from(encodeWholeReceiptRaster(unit, capabilities, 'full'));

  return {
    ok: true,
    unit,
    rasterBytes,
    previewDataUrl,
    renderTimeMs: Date.now() - startTime,
    dimensions: {
      widthDots: width,
      heightDots: height,
      bandCount: bands.length,
    },
  };
}

// ── Pure Node PNG Generator for Preview ─────────────────────────────────────

function createMonochromePngBuffer(width: number, height: number, pixels: Uint8Array): Buffer {
  // Grayscale PNG with 1 byte per pixel (0 = black, 255 = white)
  const rowLength = 1 + width; // 1 filter byte + pixel bytes
  const rawData = Buffer.alloc(height * rowLength);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowLength;
    rawData[rowOffset] = 0; // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const isBlack = pixels[y * width + x] !== 0;
      rawData[rowOffset + 1 + x] = isBlack ? 0 : 255;
    }
  }

  const compressed = zlib.deflateSync(rawData);

  // PNG Header
  const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bit depth: 8
  ihdr[9] = 0; // Color type: 0 (Grayscale)
  ihdr[10] = 0; // Compression
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // Interlace
  const ihdrChunk = createPngChunk('IHDR', ihdr);

  // IDAT chunk
  const idatChunk = createPngChunk('IDAT', compressed);

  // IEND chunk
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

// ── Main Branded Receipt Renderer Entry Point ───────────────────────────────

export async function renderBrandedReceipt(
  request: BrandedReceiptRequest,
  renderer?: { render: (req: any) => Promise<any> },
): Promise<BrandedReceiptRenderResult> {
  const startTime = Date.now();

  try {
    // If a Chromium raster renderer is provided, attempt Chromium-based canvas rendering
    if (renderer && typeof renderer.render === 'function') {
      let renderPromise = renderer.render(request);

      // Warning timer at 4s
      const warnTimer = setTimeout(() => {
        console.warn(`[Branded Receipt] Warning: Render taking longer than ${PRE_DISPATCH_TIMEOUT_WARN_MS}ms for request ${request.requestId}`);
      }, PRE_DISPATCH_TIMEOUT_WARN_MS);

      // Hard timeout at 8s
      let timerId: NodeJS.Timeout;
      const timeoutPromise = new Promise<{ ok: false; code: 'render-failed'; detail: string }>((resolve) => {
        timerId = setTimeout(() => {
          resolve({
            ok: false,
            code: 'render-failed',
            detail: `Pre-dispatch render timed out after ${PRE_DISPATCH_TIMEOUT_HARD_MS}ms`,
          });
        }, PRE_DISPATCH_TIMEOUT_HARD_MS);
      });

      const result = await Promise.race([renderPromise, timeoutPromise]);
      clearTimeout(warnTimer);
      clearTimeout(timerId!);

      if (result && result.ok === true && result.unit) {
        const capabilities: ThermalPrinterCapabilities = {
          encoding: { codePages: ['ascii'], preferredCodePage: 'ascii' },
          shaping: { arabic: true },
          representability: { scripts: ['ascii', 'arabic'] },
          transliteration: { enabled: false },
          warnings: { unsupportedText: 'skip', financialText: 'refuse', orderTypeFallback: 'ascii' },
          raster: {
            enabled: true,
            widthDots: request.widthDots,
            maxBandHeight: request.maxBandHeight,
            modes: ['whole-receipt'],
          },
        };
        const rasterBytes = Buffer.from(encodeWholeReceiptRaster(result.unit, capabilities, 'full'));

        return {
          ok: true,
          unit: result.unit,
          rasterBytes,
          previewDataUrl: result.previewDataUrl,
          renderTimeMs: Date.now() - startTime,
          dimensions: {
            widthDots: request.widthDots,
            heightDots: result.unit.bands.reduce((sum: number, b: RasterBand) => sum + b.heightDots, 0),
            bandCount: result.unit.bands.length,
          },
        };
      }

      console.warn(`[Branded Receipt] Renderer returned error: ${result?.detail || 'unknown'}. Falling back to software compositor.`);
    }

    // Default: use software compositor (100% reliable, zero native dependencies)
    const output = renderBrandedReceiptSoftware(request);
    return output;
  } catch (error: any) {
    return {
      ok: false,
      error: error?.message || String(error),
      stage: 'render',
      renderTimeMs: Date.now() - startTime,
    };
  }
}
