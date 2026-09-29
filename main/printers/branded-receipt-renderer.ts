import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import * as crypto from 'node:crypto';
import {
  DEFAULT_RASTER_MAX_BAND_HEIGHT,
  encodeWholeReceiptRaster,
  resolveRasterTransport,
  validateRasterBand,
  type RasterBand,
  type RasterSemanticUnit,
  type RasterImageTransport,
  type BrandedRasterTransport,
  type RenderedThermalDocument,
} from '../../shared/print/raster';
import type { ThermalPrinterCapabilities } from '../../shared/print/thermal-capabilities';
import type { CustomerDocumentSource, CustomerDocumentVariant, ResolvedPrintStyle } from '../../shared/print';

export type { RenderedThermalDocument, RasterBand, RasterSemanticUnit };

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

export interface BrandedReportSectionLine {
  readonly label: string;
  readonly value?: string;
  readonly isBold?: boolean;
  readonly align?: 'left' | 'center' | 'right';
}

export interface BrandedReportSection {
  readonly title?: string;
  readonly lines: readonly BrandedReportSectionLine[];
}

export interface BrandedReceiptRequest {
  readonly version: 1;
  readonly kind: 'branded-receipt' | 'branded-kot' | 'branded-report';
  readonly requestId: string;
  readonly widthDots: number;
  readonly maxBandHeight: number;
  readonly transport?: BrandedRasterTransport;
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
    readonly quoteReference?: string;
    readonly timestamp?: string;
    readonly tableName?: string;
    readonly customerName?: string;
    readonly customerPhone?: string;
    readonly onlinePlatform?: string;
    readonly externalOrderId?: string;
    readonly serverName?: string;
    readonly stationName?: string;
  };
  readonly items: readonly BrandedReceiptItem[];
  readonly totals: readonly BrandedReceiptTotalRow[];
  readonly footer: {
    readonly footerNote?: string;
    readonly thankYou?: string;
  };
  readonly reportSections?: readonly BrandedReportSection[];
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
  readonly document: RenderedThermalDocument;
  readonly pixelHash: string;
}

export interface BrandedReceiptRenderFailure {
  readonly ok: false;
  readonly error: string;
  readonly code?: 'font-unavailable' | 'render-failed' | 'invalid-request';
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
  documentVariant?: CustomerDocumentVariant;
  source?: CustomerDocumentSource;
  transport?: BrandedRasterTransport;
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

  const isPreliminary = options.documentVariant === 'preliminary' || bill.documentVariant === 'preliminary';
  const isCart = options.source?.kind === 'active_cart' || bill.source?.kind === 'active_cart';

  if (isPreliminary) {
    if (bill.paid_amount !== undefined && Number(bill.paid_amount) > 0) {
      totals.push({ label: 'Paid / المدفوع', value: formatAmt(Number(bill.paid_amount)) });
    }
    const balanceRemaining = bill.balance !== undefined
      ? Number(bill.balance)
      : Math.max(0, Number(bill.total || order.total || 0) - Number(bill.paid_amount || 0));
    totals.push({ label: 'Balance Due / المتبقي', value: formatAmt(balanceRemaining) });
  } else {
    if (bill.paid_amount !== undefined && Number(bill.paid_amount) > 0) {
      totals.push({ label: 'Paid / المدفوع', value: formatAmt(Number(bill.paid_amount)) });
    }
    if (bill.balance !== undefined && Number(bill.balance) > 0) {
      totals.push({ label: 'Balance / المتبقي', value: formatAmt(Number(bill.balance)) });
    }
  }

  const defaultBanner = options.order?.isReprint ? '*** REPRINT / إعادة طباعة ***' : undefined;
  const preliminaryBanner = '*** PRELIMINARY RECEIPT — NOT PAID / فاتورة مبدئية — غير مدفوعة ***';

  return {
    version: 1,
    kind: 'branded-receipt',
    requestId: options.requestId || `branded-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    widthDots,
    maxBandHeight: DEFAULT_RASTER_MAX_BAND_HEIGHT,
    transport: options.transport,
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
      banner: isPreliminary ? preliminaryBanner : defaultBanner,
    },
    meta: {
      invoiceNumber: isCart ? undefined : (bill.bill_number ? String(bill.bill_number) : undefined),
      orderNumber: isCart ? undefined : (order.order_number ? String(order.order_number) : undefined),
      quoteReference: isCart ? (options.source && 'quoteId' in options.source ? options.source.quoteId : (bill.quoteId || '')) : undefined,
      timestamp: bill.created_at || order.created_at || new Date().toISOString().replace('T', ' ').slice(0, 19),
      tableName: order.table?.name || business.table_name || undefined,
      customerName: order.customer?.name || business.customer_name || undefined,
      customerPhone: order.customer?.phone || business.customer_phone || undefined,
      onlinePlatform: order.online_platform || business.online_platform || undefined,
      externalOrderId: order.external_order_id || business.external_order_id || undefined,
    },
    items,
    totals,
    footer: {
      footerNote: isPreliminary
        ? (business.footer_note
          ? `${business.footer_note}\nThis is not a tax invoice or final bill / هذه ليست فاتورة ضريبية أو نهائية`
          : 'This is not a tax invoice or final bill / هذه ليست فاتورة ضريبية أو نهائية')
        : (business.footer_note || undefined),
      thankYou: isPreliminary ? undefined : 'Thank you for your visit / شكراً لزيارتكم',
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
  transport?: BrandedRasterTransport;
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

  const isEscStar = options.transport === 'esc_star_24';
  const transportBanner = isEscStar
    ? '▲ TOP MARKER / بداية الفحص النقطي\nTRANSPORT: ESC * 24-DOT COMPATIBILITY / وضع التوافق ESC *\nFLOCAFE PRINTER DIAGNOSTIC — NOT A SALES RECEIPT (v3.11.7)\nاختبار طابعة FloCafe — ليست فاتورة بيع'
    : '▲ TOP MARKER / بداية الفحص النقطي\nTRANSPORT: GS v 0 RASTER / نمط الصور النقطية GS v 0\nFLOCAFE PRINTER DIAGNOSTIC — NOT A SALES RECEIPT (v3.11.7)\nاختبار طابعة FloCafe — ليست فاتورة بيع';
  const transportLabel = isEscStar ? 'ESC * 24-Dot Mode' : 'GS v 0 Raster Mode';

  const items: BrandedReceiptItem[] = [
    {
      name: 'قهوة مختصة مقطرة V60 / Specialty Coffee V60',
      quantity: 2,
      price: 36.00,
      unitPrice: 18.00,
      notes: 'Arabic & Latin typography rendering test / فحص الخطوط',
    },
    {
      name: 'كرواسون بالزبدة السويسرية / Croissant',
      quantity: 1,
      price: 18.50,
      unitPrice: 18.50,
      addons: [{ name: 'إضافة مربى فراولة / Strawberry Jam', price: 3.50 }],
    },
    {
      name: '◆ MID MARKER / منتصف الفحص النقطي',
      quantity: 1,
      price: 0.00,
      unitPrice: 0.00,
      notes: 'Continuous 24-dot slice alignment / محاذاة مستمرة',
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
    transport: options.transport,
    fontFamily,
    bundledFonts: bundledFonts.length > 0 ? bundledFonts : undefined,
    logo: logoPayload,
    geometry,
    ditheringMode: 'threshold',
    threshold: 128,
    style: {
      target: 'receipt',
      renderMode: 'branded_raster',
      typography: {
        fontFamily,
        storeNameSize: 'large',
        headerMetaSize: 'small',
        itemNamesSize: 'medium',
        itemModifiersSize: 'small',
        itemNotesSize: 'small',
        totalsSize: 'large',
        footerSize: 'small',
      },
      frame: {
        borderStyle: 'solid',
        borderThickness: 2,
        borderRadius: 0,
        borderPadding: 8,
        dividerStyle: 'dashed',
      },
      logo: {
        showLogo: Boolean(logoPayload),
        maxWidthPercent: 60,
        spacingBottomDots: 12,
        alignment: 'center',
      },
      direction: 'rtl',
      operational: {
        headerCompact: false,
        prominentNotes: false,
        showPrices: false,
        showTotals: false,
      },
    },
    header: {
      businessName: business.name || 'FloCafe POS',
      address: business.address || undefined,
      phone: business.phone || undefined,
      banner: transportBanner,
    },
    meta: {
      orderNumber: 'DIAG-RASTER-PROBE',
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      tableName: `Printer: ${printerName} | ${transportLabel}`,
      customerName: `Format: ${paperSpec} | Version: 3.11.7`,
      customerPhone: `Margin: [|<-- ${widthDots} dots -->|]`,
    },
    items,
    totals,
    footer: {
      footerNote: 'DIAGNOSTIC TEST COMPLETE — NOT A SALES RECEIPT\nانتهى اختبار الطابعة — ليست فاتورة بيع أو مطالبة مالية\n▼ BOTTOM MARKER / نهاية الفحص النقطي',
      thankYou: `Width: ${widthDots} dots | Margin Markers: [|<-- ${widthDots} dots -->|]`,
    },
  };
}

// ── Build Branded KOT Request (Kitchen Order Ticket) ────────────────────────

export function buildBrandedKotRequest(options: {
  order: any;
  items: any[];
  stationName: string;
  business?: any;
  printer?: any;
  widthDots?: number;
  fontFamily?: BrandedFontFamily;
  logoAsset?: BrandedLogoAsset | null;
  style?: ResolvedPrintStyle;
  transport?: BrandedRasterTransport;
  requestId?: string;
}): BrandedReceiptRequest {
  const widthDots = options.widthDots ?? (options.printer?.paper_width?.includes('58') ? DEFAULT_RASTER_WIDTH_58MM : DEFAULT_RASTER_WIDTH_80MM);
  const geometry = computeBrandedGeometry({ widthDots });
  const fontFamily = options.fontFamily ?? (options.style?.typography?.fontFamily as BrandedFontFamily) ?? 'almarai';
  const bundledFonts = resolveBundledFontList(fontFamily);
  const business = options.business ?? {};
  const order = options.order ?? {};
  const items = options.items ?? [];
  const style = options.style;

  let logoPayload: BrandedReceiptRequest['logo'];
  if (style?.logo?.showLogo && options.logoAsset && options.logoAsset.data.length > 0) {
    logoPayload = {
      dataUrl: `data:${options.logoAsset.mimeType};base64,${options.logoAsset.data.toString('base64')}`,
      width: options.logoAsset.width,
      height: options.logoAsset.height,
    };
  }

  const showPrices = style?.operational?.showPrices ?? false;
  const showTotals = style?.operational?.showTotals ?? false;

  const kotItems: BrandedReceiptItem[] = items.map((item: any) => {
    const name = String(item.product_name || item.name || 'Item');
    const quantity = Number(item.quantity || 1);
    const price = showPrices ? Number(item.total_price || item.price || 0) : 0;
    const unitPrice = showPrices && item.unit_price !== undefined ? Number(item.unit_price) : undefined;
    const addons = Array.isArray(item.addons)
      ? item.addons.map((a: any) => ({ name: String(a.name || a.addon_name || ''), price: showPrices ? Number(a.price || 0) : 0 }))
      : undefined;
    const notes = item.notes ? String(item.notes) : undefined;
    return { name, quantity, price, unitPrice, addons, notes };
  });

  const totals: BrandedReceiptTotalRow[] = [];
  if (showTotals) {
    const sum = kotItems.reduce((acc, it) => acc + it.price, 0);
    const currency = business.currency_symbol || business.currency || '';
    totals.push({
      label: 'Items Subtotal / مجموع الأصناف',
      value: `${sum.toFixed(2)} ${currency}`.trim(),
      isBold: true,
    });
  }

  const orderNum = order.order_number ? String(order.order_number) : undefined;
  const tableName = order.table?.name || business.table_name || undefined;
  const timestamp = order.created_at || new Date().toISOString().replace('T', ' ').slice(0, 19);
  const serverName = order.server_name || order.user?.name || undefined;

  return {
    version: 1,
    kind: 'branded-kot',
    requestId: options.requestId || `kot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    widthDots,
    maxBandHeight: DEFAULT_RASTER_MAX_BAND_HEIGHT,
    transport: options.transport,
    fontFamily,
    style,
    bundledFonts: bundledFonts.length > 0 ? bundledFonts : undefined,
    logo: logoPayload,
    geometry,
    ditheringMode: 'threshold',
    threshold: 128,
    header: {
      businessName: options.stationName || 'Kitchen',
      banner: 'تذكرة طلب المطبخ / Kitchen Order Ticket',
    },
    meta: {
      orderNumber: orderNum,
      tableName,
      timestamp: serverName ? `${timestamp} | Server: ${serverName}` : timestamp,
      serverName,
      stationName: options.stationName,
    },
    items: kotItems,
    totals,
    footer: {
      footerNote: 'تذكرة تشغيلية فقط — ليست مطالبة مالية أو فاتورة بيع\nOperational Ticket · Non-Financial',
    },
  };
}

// ── Build Branded Report Request (Financial Z / X / Shift Report) ────────────

export function buildBrandedReportRequest(options: {
  title: string;
  sections?: readonly string[];
  reportSections?: readonly BrandedReportSection[];
  business?: any;
  printer?: any;
  widthDots?: number;
  fontFamily?: BrandedFontFamily;
  transport?: BrandedRasterTransport;
  requestId?: string;
}): BrandedReceiptRequest {
  const widthDots = options.widthDots ?? (options.printer?.paper_width?.includes('58') ? DEFAULT_RASTER_WIDTH_58MM : DEFAULT_RASTER_WIDTH_80MM);
  const geometry = computeBrandedGeometry({ widthDots });
  const fontFamily = options.fontFamily ?? 'almarai';
  const bundledFonts = resolveBundledFontList(fontFamily);
  const business = options.business ?? {};

  let parsedSections = options.reportSections;
  if (!parsedSections && options.sections) {
    const lines: BrandedReportSectionLine[] = [];
    for (const rawLine of options.sections) {
      if (rawLine === undefined || rawLine === null) continue;
      const isBold = rawLine.includes('{BOLD}');
      const isCenter = rawLine.includes('{CENTER}');
      const isRight = rawLine.includes('{RIGHT}');
      const clean = rawLine.replace(/\{[^}]+\}/g, '').trimEnd();
      if (!clean) {
        lines.push({ label: '', align: 'left' });
        continue;
      }
      const colSplit = clean.split(/\s{2,}/);
      if (colSplit.length === 2 && !isCenter) {
        lines.push({
          label: colSplit[0].trim(),
          value: colSplit[1].trim(),
          isBold,
          align: 'left',
        });
      } else {
        lines.push({
          label: clean.trim(),
          isBold,
          align: isCenter ? 'center' : (isRight ? 'right' : 'left'),
        });
      }
    }
    parsedSections = [{ lines }];
  }

  return {
    version: 1,
    kind: 'branded-report',
    requestId: options.requestId || `report-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    widthDots,
    maxBandHeight: DEFAULT_RASTER_MAX_BAND_HEIGHT,
    transport: options.transport,
    fontFamily,
    bundledFonts: bundledFonts.length > 0 ? bundledFonts : undefined,
    geometry,
    ditheringMode: 'threshold',
    threshold: 128,
    header: {
      businessName: business.name || 'FloCafe',
      banner: options.title || 'FINANCIAL REPORT / تقرير مالي',
    },
    meta: {
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    },
    items: [],
    totals: [],
    footer: {
      footerNote: 'تقرير مالي معتمد — تم التوليد بنظام FloCafe\nVerified Financial Report',
    },
    reportSections: parsedSections || [],
  };
}

// ── Canonical Document Compositor & Renderer Integration ───────────────────

import {
  renderCanonicalDocument,
  renderCanonicalDocumentSync,
  createMonochromePngBuffer,
  CANONICAL_RENDERER_ID,
  CANONICAL_RENDERER_VERSION,
} from './canvas-engine';

export {
  createMonochromePngBuffer,
  CANONICAL_RENDERER_ID,
  CANONICAL_RENDERER_VERSION,
};

export function renderBrandedReceiptSoftware(
  request: BrandedReceiptRequest,
  transportOverride?: RasterImageTransport,
): BrandedReceiptOutput {
  return renderCanonicalDocumentSync(request, transportOverride);
}

// ── Main Branded Receipt Renderer Entry Point ───────────────────────────────

export async function renderBrandedReceipt(
  request: BrandedReceiptRequest,
  rendererOrTransport?: { render: (req: any) => Promise<any> } | RasterImageTransport,
  maybeRenderer?: { render: (req: any) => Promise<any> },
): Promise<BrandedReceiptRenderResult> {
  const startTime = Date.now();
  const transportOverride: RasterImageTransport | undefined = typeof rendererOrTransport === 'string' ? rendererOrTransport : undefined;
  const transport: RasterImageTransport = transportOverride || resolveRasterTransport(request.transport);
  const renderer = typeof rendererOrTransport === 'object' && rendererOrTransport !== null ? rendererOrTransport : maybeRenderer;

  try {
    if (renderer && typeof renderer.render === 'function') {
      let renderPromise = renderer.render(request);

      const warnTimer = setTimeout(() => {
        console.warn(`[Branded Receipt] Warning: Render taking longer than ${PRE_DISPATCH_TIMEOUT_WARN_MS}ms for request ${request.requestId}`);
      }, PRE_DISPATCH_TIMEOUT_WARN_MS);

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

      if (result && result.ok === false) {
        if (result.code === 'font-unavailable') {
          return {
            ok: false,
            code: 'font-unavailable',
            error: result.detail || 'Font unavailable',
            stage: 'render',
            renderTimeMs: Date.now() - startTime,
          };
        }
        console.warn(`[Branded Receipt] Custom renderer returned error: ${result?.detail || 'unknown'}. Using canonical renderer.`);
      } else if (result && result.ok === true && result.unit) {
        return result;
      }
    }

    // Canonical full-page Unicode-aware document renderer
    const output = await renderCanonicalDocument(request, transport);
    return output;
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    const isFontUnavailable = errorMsg.includes('font-unavailable');
    return {
      ok: false,
      code: isFontUnavailable ? 'font-unavailable' : 'render-failed',
      error: errorMsg,
      stage: 'render',
      renderTimeMs: Date.now() - startTime,
    };
  }
}
