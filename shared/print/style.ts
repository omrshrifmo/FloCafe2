/**
 * Shared print kernel — unified print style & visual preferences (#442).
 * Pure functions and canonical style models for receipts and kitchen tickets (KOT).
 */


export type PrintRenderMode = 'legacy_text' | 'branded_raster';
export type PrintFontFamily = 'system' | 'cairo' | 'almarai';
export type PrintFontSize = 'small' | 'medium' | 'large' | 'xlarge';
export type PrintFontWeight = 'regular' | 'bold';
export type FontSizeStep = PrintFontSize;
export type PrintBorderStyle = 'none' | 'solid' | 'dashed' | 'dotted' | 'double';
export type BorderStyleType = PrintBorderStyle;
export type PrintDividerStyle = 'none' | 'solid' | 'dashed' | 'dotted';
export type DividerStyleType = PrintDividerStyle;
export type PrintDirection = 'auto' | 'rtl' | 'ltr';
export type KotStyleMode = 'inherit' | 'custom';
export type KotRenderModePreference = 'inherit' | PrintRenderMode;

export type ThermalDensityPreset = 'light' | 'normal' | 'dark' | 'extra_dark' | 'custom';

/** Software-side thermal contrast and black-pixel expansion controls */
export interface ThermalContrastStyle {
  readonly densityPreset: ThermalDensityPreset;
  readonly threshold: number; // 80 to 220 dots, default 135
  readonly inkGain: number;   // 0 to 2 physical dots expansion, default 0
  readonly ditheringMode: 'threshold' | 'error-diffusion';
}

export const DEFAULT_THERMAL_CONTRAST: ThermalContrastStyle = Object.freeze({
  densityPreset: 'normal' as const,
  threshold: 135,
  inkGain: 0,
  ditheringMode: 'threshold' as const,
});

/** Resolves density preset into concrete threshold and ink gain values */
export function resolveDensitySettings(
  preset: ThermalDensityPreset = 'normal',
  customThreshold?: number,
  customInkGain?: number,
): { threshold: number; inkGain: number } {
  switch (preset) {
    case 'light':
      return { threshold: 110, inkGain: 0 };
    case 'normal':
      return { threshold: 135, inkGain: 0 };
    case 'dark':
      return { threshold: 160, inkGain: 1 };
    case 'extra_dark':
      return { threshold: 185, inkGain: 1 };
    case 'custom': {
      const th = typeof customThreshold === 'number'
        ? Math.max(80, Math.min(220, Math.round(customThreshold)))
        : 135;
      const ig = typeof customInkGain === 'number'
        ? Math.max(0, Math.min(2, Math.round(customInkGain)))
        : 0;
      return { threshold: th, inkGain: ig };
    }
  }
}

/** Complete typography scale and role-based weights */
export interface TypographyStyle {
  readonly fontFamily: PrintFontFamily;
  readonly storeNameSize: PrintFontSize;    // Default: 'large'
  readonly headerMetaSize: PrintFontSize;    // Default: 'small'
  readonly itemNamesSize: PrintFontSize;     // Default: 'medium'
  readonly itemModifiersSize: PrintFontSize; // Default: 'small'
  readonly itemNotesSize: PrintFontSize;     // Default: 'small'
  readonly totalsSize: PrintFontSize;        // Default: 'large'
  readonly footerSize: PrintFontSize;        // Default: 'small'
  readonly kotItemSize?: PrintFontSize;      // Default: 'large'
  readonly kotNotesSize?: PrintFontSize;     // Default: 'medium'
  readonly reportSize?: PrintFontSize;       // Default: 'medium'
  readonly reportTotalsSize?: PrintFontSize; // Default: 'large'

  // Per-role font weights
  readonly storeNameWeight?: PrintFontWeight; // Default: 'bold'
  readonly itemNamesWeight?: PrintFontWeight; // Default: 'regular'
  readonly totalsWeight?: PrintFontWeight;    // Default: 'bold'
  readonly kotItemWeight?: PrintFontWeight;   // Default: 'bold'
  readonly kotNotesWeight?: PrintFontWeight;  // Default: 'bold'
  readonly reportTotalsWeight?: PrintFontWeight; // Default: 'bold'

  // Advanced Global Scales (percentages)
  readonly receiptScalePercent?: number; // 75 to 220, default 100
  readonly kotScalePercent?: number;     // 75 to 260, default 100
  readonly reportScalePercent?: number;  // 75 to 180, default 100
}

/** Frame and border attributes */
export interface FrameStyle {
  readonly borderStyle: PrintBorderStyle;    // Default: 'none'
  readonly borderThickness: number;          // 1 to 4 dots (default: 1)
  readonly borderPadding: number;            // 0 to 24 dots (default: 8)
  readonly borderRadius: number;             // 0 to 16 dots (default: 0)
  readonly dividerStyle: PrintDividerStyle;  // Default: 'dashed'
}

/** Logo layout parameters */
export interface LogoStyle {
  readonly showLogo: boolean;                // Default: true
  readonly maxWidthPercent: number;          // 20 to 100 (default: 60)
  readonly spacingBottomDots: number;        // 0 to 40 (default: 12)
  readonly alignment: 'center';              // Fixed: centered by default
}

/** The complete visual styling profile of a printed document */
export interface DocumentVisualPreferences {
  readonly renderMode: PrintRenderMode;
  readonly typography: TypographyStyle;
  readonly frame: FrameStyle;
  readonly logo: LogoStyle;
  readonly direction: PrintDirection;
  readonly contrast?: ThermalContrastStyle;
}

/** KOT-specific operational options (content toggles, strictly non-financial) */
export interface KotOperationalPreferences {
  readonly headerCompact: boolean;           // Default: false
  readonly prominentNotes: boolean;          // Default: false
  readonly showPrices: boolean;              // Default: false (strictly operational item price)
  readonly showTotals: boolean;              // Default: false (strictly operational items subtotal)
}

/** Dedicated nested override structure for KOT custom mode */
export interface KotVisualOverrides {
  readonly renderMode?: KotRenderModePreference;
  readonly typography?: Partial<TypographyStyle>;
  readonly frame?: Partial<FrameStyle>;
  readonly logo?: Partial<LogoStyle>;
  readonly direction?: PrintDirection;
  readonly operational?: Partial<KotOperationalPreferences>;
  readonly contrast?: Partial<ThermalContrastStyle>;
}

/** Canonical print style preferences stored in database */
export interface StorePrintStylePreferences {
  readonly version: 1;
  readonly receipt: DocumentVisualPreferences;
  readonly kotStyleMode: KotStyleMode;       // 'inherit' | 'custom'
  readonly kotOverrides: KotVisualOverrides;
  /** Reserved for future per-station overrides */
  readonly stationOverrides?: Record<string, KotVisualOverrides>;
}

/** Resolved concrete raster pixel dimensions */
export interface RasterFontSizeDimension {
  readonly fontSizePx: number;
  readonly lineHeightPx: number;
}

/** ESC/POS hardware text control token */
export interface LegacyEscPosSizeSpec {
  readonly initToken: string;
  readonly resetToken: string;
}

/** Default canonical print preferences */
export const DEFAULT_PRINT_STYLE_PREFERENCES: StorePrintStylePreferences = Object.freeze({
  version: 1,
  receipt: {
    renderMode: 'legacy_text' as const,
    typography: {
      fontFamily: 'almarai' as const,
      storeNameSize: 'large' as const,
      headerMetaSize: 'small' as const,
      itemNamesSize: 'medium' as const,
      itemModifiersSize: 'small' as const,
      itemNotesSize: 'small' as const,
      totalsSize: 'large' as const,
      footerSize: 'small' as const,
      kotItemSize: 'large' as const,
      kotNotesSize: 'medium' as const,
      reportSize: 'medium' as const,
      reportTotalsSize: 'large' as const,
      storeNameWeight: 'bold' as const,
      itemNamesWeight: 'regular' as const,
      totalsWeight: 'bold' as const,
      kotItemWeight: 'bold' as const,
      kotNotesWeight: 'bold' as const,
      reportTotalsWeight: 'bold' as const,
      receiptScalePercent: 100,
      kotScalePercent: 100,
      reportScalePercent: 100,
    },
    frame: {
      borderStyle: 'none' as const,
      borderThickness: 1,
      borderPadding: 8,
      borderRadius: 0,
      dividerStyle: 'dashed' as const,
    },
    logo: {
      showLogo: true,
      maxWidthPercent: 60,
      spacingBottomDots: 12,
      alignment: 'center' as const,
    },
    direction: 'auto' as const,
    contrast: DEFAULT_THERMAL_CONTRAST,
  },
  kotStyleMode: 'inherit' as const,
  kotOverrides: {
    renderMode: 'inherit' as const,
    operational: {
      headerCompact: false,
      prominentNotes: false,
      showPrices: false,
      showTotals: false,
    },
  },
});

/** Check whether a language code uses RTL base script */
export function isRtlPrintLanguage(lang?: string): boolean {
  if (!lang) return false;
  const l = lang.toLowerCase().trim();
  return l === 'ar' || l === 'fa' || l === 'ur' || l.startsWith('ar-') || l.startsWith('fa-') || l.startsWith('ur-');
}

/** Fully resolved, concrete styling ready for consumption by renderers */
export interface ResolvedPrintStyle {
  readonly target: 'receipt' | 'kot';
  readonly renderMode: PrintRenderMode;
  readonly typography: TypographyStyle;
  readonly frame: FrameStyle;
  readonly logo: LogoStyle;
  readonly direction: 'rtl' | 'ltr';
  readonly operational: KotOperationalPreferences;
  readonly contrast: ThermalContrastStyle;
}

/**
 * Pure resolver: computes exact resolved style for a target document (receipt or KOT).
 * When target is KOT and kotStyleMode === 'inherit', inherits EVERY visual property exactly
 * from the receipt with ZERO silent visual substitutions.
 */
export function resolveEffectivePrintStyle(
  prefs: StorePrintStylePreferences,
  target: 'receipt' | 'kot',
  baseLanguage?: string,
  stationId?: string,
): ResolvedPrintStyle {
  const safePrefs = validatePrintStylePreferences(prefs) || DEFAULT_PRINT_STYLE_PREFERENCES;

  // Resolve Customer Receipt Base Direction
  const receiptDir = safePrefs.receipt.direction === 'auto'
    ? (isRtlPrintLanguage(baseLanguage) ? 'rtl' : 'ltr')
    : safePrefs.receipt.direction;

  const receiptContrast: ThermalContrastStyle = safePrefs.receipt.contrast || DEFAULT_THERMAL_CONTRAST;

  if (target === 'receipt') {
    return Object.freeze({
      target: 'receipt',
      renderMode: safePrefs.receipt.renderMode,
      typography: Object.freeze({ ...safePrefs.receipt.typography }),
      frame: Object.freeze({ ...safePrefs.receipt.frame }),
      logo: Object.freeze({ ...safePrefs.receipt.logo }),
      direction: receiptDir,
      contrast: Object.freeze({ ...receiptContrast }),
      operational: Object.freeze({
        headerCompact: false,
        prominentNotes: false,
        showPrices: false,
        showTotals: false,
      }),
    });
  }

  // Target is KOT: Check inheritance mode
  if (safePrefs.kotStyleMode === 'inherit') {
    return Object.freeze({
      target: 'kot',
      // True visual inheritance: exact copy of every receipt visual property
      renderMode: safePrefs.receipt.renderMode,
      typography: Object.freeze({ ...safePrefs.receipt.typography }),
      frame: Object.freeze({ ...safePrefs.receipt.frame }),
      logo: Object.freeze({ ...safePrefs.receipt.logo }),
      direction: receiptDir,
      contrast: Object.freeze({ ...receiptContrast }),
      // Operational properties (content safety toggles independent from visual style)
      operational: Object.freeze({
        headerCompact: safePrefs.kotOverrides?.operational?.headerCompact ?? false,
        prominentNotes: safePrefs.kotOverrides?.operational?.prominentNotes ?? false,
        showPrices: safePrefs.kotOverrides?.operational?.showPrices ?? false,
        showTotals: safePrefs.kotOverrides?.operational?.showTotals ?? false,
      }),
    });
  }

  // Target is KOT with 'custom' mode:
  // Check for future station override first, else fallback to global kotOverrides
  const stationOverride = stationId && safePrefs.stationOverrides?.[stationId];
  const o = stationOverride || safePrefs.kotOverrides || {};

  const resolvedKotRenderMode: PrintRenderMode = (!o.renderMode || o.renderMode === 'inherit')
    ? safePrefs.receipt.renderMode
    : o.renderMode;

  const kotDirPreference = o.direction ?? safePrefs.receipt.direction;
  const resolvedKotDir = kotDirPreference === 'auto'
    ? (isRtlPrintLanguage(baseLanguage) ? 'rtl' : 'ltr')
    : kotDirPreference;

  const kotContrast: ThermalContrastStyle = {
    ...receiptContrast,
    ...(o.contrast || {}),
  };

  return Object.freeze({
    target: 'kot',
    renderMode: resolvedKotRenderMode,
    typography: Object.freeze({
      ...safePrefs.receipt.typography,
      ...(o.typography || {}),
    }),
    frame: Object.freeze({
      ...safePrefs.receipt.frame,
      ...(o.frame || {}),
    }),
    logo: Object.freeze({
      ...safePrefs.receipt.logo,
      ...(o.logo || {}),
    }),
    direction: resolvedKotDir,
    contrast: Object.freeze(kotContrast),
    operational: Object.freeze({
      headerCompact: o.operational?.headerCompact ?? false,
      prominentNotes: o.operational?.prominentNotes ?? false,
      showPrices: o.operational?.showPrices ?? false,
      showTotals: o.operational?.showTotals ?? false,
    }),
  });
}

// ── Explicit Size Mapping & Clamping (Requirement 4) ─────────────────────────

/**
 * Resolves pixel size and line-height for branded raster rendering.
 * Differentiates 80mm (576 dots) vs 58mm (384 dots) and clamps to prevent column overlap.
 */
export function resolveRasterFontSize(
  sizeOrWidth: PrintFontSize | number,
  is58mmOrSize: boolean | number | PrintFontSize = false,
  element?: 'storeName' | 'headerMeta' | 'item' | 'addon' | 'note' | 'total' | 'footer' | string,
  scalePercent: number = 100,
): RasterFontSizeDimension {
  let size: PrintFontSize = 'medium';
  let is58mm = false;

  if (typeof sizeOrWidth === 'number') {
    is58mm = sizeOrWidth <= 400;
    size = (typeof is58mmOrSize === 'string' ? is58mmOrSize : 'medium') as PrintFontSize;
  } else {
    size = sizeOrWidth;
    if (typeof is58mmOrSize === 'number') {
      is58mm = is58mmOrSize <= 400;
    } else if (typeof is58mmOrSize === 'boolean') {
      is58mm = is58mmOrSize;
    }
  }

  const normalizedElement = (element === 'itemNotes' || element === 'note')
    ? 'note'
    : ((element === 'itemModifiers' || element === 'addon') ? 'addon' : element);

  const factor = Math.max(75, Math.min(300, scalePercent || 100)) / 100;

  if (is58mm) {
    // 58mm profile: clamped dimensions to preserve 384-dot budget
    let baseSize = 16;
    let baseLine = 21;
    switch (size) {
      case 'small': baseSize = 13; baseLine = 17; break;
      case 'medium': baseSize = 16; baseLine = 21; break;
      case 'large': baseSize = 21; baseLine = 27; break;
      case 'xlarge': baseSize = 26; baseLine = 33; break;
    }
    let fontSizePx = Math.round(baseSize * factor);
    let lineHeightPx = Math.round(baseLine * factor);
    if (normalizedElement === 'note' || normalizedElement === 'addon') {
      fontSizePx = Math.min(18, fontSizePx);
      lineHeightPx = Math.min(24, lineHeightPx);
    } else {
      fontSizePx = Math.min(26, fontSizePx);
      lineHeightPx = Math.min(34, lineHeightPx);
    }
    return { fontSizePx, lineHeightPx };
  }

  // 80mm profile: standard 576-dot budget
  let baseSize = 19;
  let baseLine = 25;
  switch (size) {
    case 'small': baseSize = 15; baseLine = 20; break;
    case 'medium': baseSize = 19; baseLine = 25; break;
    case 'large': baseSize = 26; baseLine = 34; break;
    case 'xlarge': baseSize = 34; baseLine = 44; break;
  }
  return {
    fontSizePx: Math.round(baseSize * factor),
    lineHeightPx: Math.round(baseLine * factor),
  };
}

/**
 * Resolves legacy ESC/POS control tokens for hardware text mode.
 * Maps sizes strictly to supported hardware commands (Font B, Font A, Double Height/Width).
 */
export function resolveLegacyEscPosSize(size: PrintFontSize): LegacyEscPosSizeSpec {
  switch (size) {
    case 'small':
      return { initToken: '{FONT_B}', resetToken: '{FONT_A}' };
    case 'medium':
      return { initToken: '{FONT_A}', resetToken: '{FONT_A}' };
    case 'large':
      return { initToken: '{DBL_HEIGHT}', resetToken: '{NORMAL}' };
    case 'xlarge':
      return { initToken: '{DBL_WIDTH_HEIGHT}', resetToken: '{NORMAL}' };
  }
}

// ── Centralized Validation ───────────────────────────────────────────────────

// ── Centralized Validation & Normalization ───────────────────────────────────

const VALID_RENDER_MODES = new Set<PrintRenderMode>(['legacy_text', 'branded_raster']);
const VALID_FONT_FAMILIES = new Set<PrintFontFamily>(['system', 'cairo', 'almarai']);
const VALID_FONT_SIZES = new Set<PrintFontSize>(['small', 'medium', 'large', 'xlarge']);
const VALID_BORDER_STYLES = new Set<PrintBorderStyle>(['none', 'solid', 'dashed', 'dotted', 'double']);
const VALID_DIVIDER_STYLES = new Set<PrintDividerStyle>(['none', 'solid', 'dashed', 'dotted']);
const VALID_DIRECTIONS = new Set<PrintDirection>(['auto', 'rtl', 'ltr']);
const VALID_KOT_MODES = new Set<KotStyleMode>(['inherit', 'custom']);

/**
 * Normalizes any partial or un-sanitized preference object into a full, safe StorePrintStylePreferences.
 * Enforces boundary clamping on numeric values and provides resilient defaults.
 */
export function normalizePrintStylePreferences(raw: unknown): StorePrintStylePreferences {
  const d = DEFAULT_PRINT_STYLE_PREFERENCES;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return d;

  const rawObj = raw as Record<string, unknown>;
  const kotStyleMode = (typeof rawObj.kotStyleMode === 'string' && VALID_KOT_MODES.has(rawObj.kotStyleMode as KotStyleMode))
    ? (rawObj.kotStyleMode as KotStyleMode)
    : d.kotStyleMode;

  const r = (rawObj.receipt && typeof rawObj.receipt === 'object' && !Array.isArray(rawObj.receipt))
    ? (rawObj.receipt as Record<string, unknown>)
    : {};
  const renderMode = (typeof r.renderMode === 'string' && VALID_RENDER_MODES.has(r.renderMode as PrintRenderMode))
    ? (r.renderMode as PrintRenderMode)
    : d.receipt.renderMode;
  const direction = (typeof r.direction === 'string' && VALID_DIRECTIONS.has(r.direction as PrintDirection))
    ? (r.direction as PrintDirection)
    : d.receipt.direction;

  const rt = (r.typography && typeof r.typography === 'object' && !Array.isArray(r.typography))
    ? (r.typography as Record<string, unknown>)
    : {};
  const fontFamily = (typeof rt.fontFamily === 'string' && VALID_FONT_FAMILIES.has(rt.fontFamily as PrintFontFamily))
    ? (rt.fontFamily as PrintFontFamily)
    : d.receipt.typography.fontFamily;
  const storeNameSize = (typeof rt.storeNameSize === 'string' && VALID_FONT_SIZES.has(rt.storeNameSize as PrintFontSize))
    ? (rt.storeNameSize as PrintFontSize)
    : d.receipt.typography.storeNameSize;
  const headerMetaSize = (typeof rt.headerMetaSize === 'string' && VALID_FONT_SIZES.has(rt.headerMetaSize as PrintFontSize))
    ? (rt.headerMetaSize as PrintFontSize)
    : d.receipt.typography.headerMetaSize;
  const itemNamesSize = (typeof rt.itemNamesSize === 'string' && VALID_FONT_SIZES.has(rt.itemNamesSize as PrintFontSize))
    ? (rt.itemNamesSize as PrintFontSize)
    : d.receipt.typography.itemNamesSize;
  const itemModifiersSize = (typeof rt.itemModifiersSize === 'string' && VALID_FONT_SIZES.has(rt.itemModifiersSize as PrintFontSize))
    ? (rt.itemModifiersSize as PrintFontSize)
    : d.receipt.typography.itemModifiersSize;
  const itemNotesSize = (typeof rt.itemNotesSize === 'string' && VALID_FONT_SIZES.has(rt.itemNotesSize as PrintFontSize))
    ? (rt.itemNotesSize as PrintFontSize)
    : d.receipt.typography.itemNotesSize;
  const totalsSize = (typeof rt.totalsSize === 'string' && VALID_FONT_SIZES.has(rt.totalsSize as PrintFontSize))
    ? (rt.totalsSize as PrintFontSize)
    : d.receipt.typography.totalsSize;
  const footerSize = (typeof rt.footerSize === 'string' && VALID_FONT_SIZES.has(rt.footerSize as PrintFontSize))
    ? (rt.footerSize as PrintFontSize)
    : d.receipt.typography.footerSize;
  const kotItemSize = (typeof rt.kotItemSize === 'string' && VALID_FONT_SIZES.has(rt.kotItemSize as PrintFontSize))
    ? (rt.kotItemSize as PrintFontSize)
    : (d.receipt.typography.kotItemSize || 'large');
  const kotNotesSize = (typeof rt.kotNotesSize === 'string' && VALID_FONT_SIZES.has(rt.kotNotesSize as PrintFontSize))
    ? (rt.kotNotesSize as PrintFontSize)
    : (d.receipt.typography.kotNotesSize || 'medium');
  const reportSize = (typeof rt.reportSize === 'string' && VALID_FONT_SIZES.has(rt.reportSize as PrintFontSize))
    ? (rt.reportSize as PrintFontSize)
    : (d.receipt.typography.reportSize || 'medium');
  const reportTotalsSize = (typeof rt.reportTotalsSize === 'string' && VALID_FONT_SIZES.has(rt.reportTotalsSize as PrintFontSize))
    ? (rt.reportTotalsSize as PrintFontSize)
    : (d.receipt.typography.reportTotalsSize || 'large');

  const normalizeWeight = (w: unknown, fallback: PrintFontWeight): PrintFontWeight =>
    w === 'regular' || w === 'bold' ? w : fallback;

  const storeNameWeight = normalizeWeight(rt.storeNameWeight, 'bold');
  const itemNamesWeight = normalizeWeight(rt.itemNamesWeight, 'regular');
  const totalsWeight = normalizeWeight(rt.totalsWeight, 'bold');
  const kotItemWeight = normalizeWeight(rt.kotItemWeight, 'bold');
  const kotNotesWeight = normalizeWeight(rt.kotNotesWeight, 'bold');
  const reportTotalsWeight = normalizeWeight(rt.reportTotalsWeight, 'bold');

  const normalizeScale = (val: unknown, min: number, max: number, def: number): number => {
    if (typeof val !== 'number' || !Number.isFinite(val)) return def;
    return Math.max(min, Math.min(max, Math.round(val)));
  };

  const receiptScalePercent = normalizeScale(rt.receiptScalePercent, 75, 220, 100);
  const kotScalePercent = normalizeScale(rt.kotScalePercent, 75, 260, 100);
  const reportScalePercent = normalizeScale(rt.reportScalePercent, 75, 180, 100);

  const rf = (r.frame && typeof r.frame === 'object' && !Array.isArray(r.frame))
    ? (r.frame as Record<string, unknown>)
    : {};
  const borderStyle = (typeof rf.borderStyle === 'string' && VALID_BORDER_STYLES.has(rf.borderStyle as PrintBorderStyle))
    ? (rf.borderStyle as PrintBorderStyle)
    : d.receipt.frame.borderStyle;
  const borderThickness = typeof rf.borderThickness === 'number'
    ? Math.max(1, Math.min(6, Math.round(rf.borderThickness)))
    : d.receipt.frame.borderThickness;
  const borderPadding = typeof rf.borderPadding === 'number'
    ? Math.max(0, Math.min(32, Math.round(rf.borderPadding)))
    : d.receipt.frame.borderPadding;
  const borderRadius = typeof rf.borderRadius === 'number'
    ? Math.max(0, Math.min(32, Math.round(rf.borderRadius)))
    : d.receipt.frame.borderRadius;
  const dividerStyle = (typeof rf.dividerStyle === 'string' && VALID_DIVIDER_STYLES.has(rf.dividerStyle as PrintDividerStyle))
    ? (rf.dividerStyle as PrintDividerStyle)
    : d.receipt.frame.dividerStyle;

  const rl = (r.logo && typeof r.logo === 'object' && !Array.isArray(r.logo))
    ? (r.logo as Record<string, unknown>)
    : {};
  const showLogo = typeof rl.showLogo === 'boolean' ? rl.showLogo : d.receipt.logo.showLogo;
  const maxWidthPercent = typeof rl.maxWidthPercent === 'number'
    ? Math.max(20, Math.min(100, Math.round(rl.maxWidthPercent)))
    : d.receipt.logo.maxWidthPercent;
  const spacingBottomDots = typeof rl.spacingBottomDots === 'number'
    ? Math.max(0, Math.min(50, Math.round(rl.spacingBottomDots)))
    : d.receipt.logo.spacingBottomDots;
  const alignment = 'center' as const;

  const rc = (r.contrast && typeof r.contrast === 'object' && !Array.isArray(r.contrast))
    ? (r.contrast as Record<string, unknown>)
    : {};
  const validPresets = new Set<ThermalDensityPreset>(['light', 'normal', 'dark', 'extra_dark', 'custom']);
  const densityPreset = (typeof rc.densityPreset === 'string' && validPresets.has(rc.densityPreset as ThermalDensityPreset))
    ? (rc.densityPreset as ThermalDensityPreset)
    : DEFAULT_THERMAL_CONTRAST.densityPreset;
  const resolvedDensity = resolveDensitySettings(
    densityPreset,
    typeof rc.threshold === 'number' ? rc.threshold : undefined,
    typeof rc.inkGain === 'number' ? rc.inkGain : undefined,
  );
  const ditheringMode = rc.ditheringMode === 'error-diffusion' ? 'error-diffusion' : 'threshold';
  const receiptContrast: ThermalContrastStyle = {
    densityPreset,
    threshold: resolvedDensity.threshold,
    inkGain: resolvedDensity.inkGain,
    ditheringMode,
  };

  const ko = (rawObj.kotOverrides && typeof rawObj.kotOverrides === 'object' && !Array.isArray(rawObj.kotOverrides))
    ? (rawObj.kotOverrides as Record<string, unknown>)
    : {};
  const kotRenderMode = (ko.renderMode === 'inherit' || (typeof ko.renderMode === 'string' && VALID_RENDER_MODES.has(ko.renderMode as PrintRenderMode)))
    ? (ko.renderMode as KotRenderModePreference)
    : 'inherit';
  const kotDirection = (typeof ko.direction === 'string' && VALID_DIRECTIONS.has(ko.direction as PrintDirection))
    ? (ko.direction as PrintDirection)
    : undefined;

  const kotTypo = (ko.typography && typeof ko.typography === 'object' && !Array.isArray(ko.typography))
    ? (ko.typography as Partial<TypographyStyle>)
    : undefined;
  const kotFrame = (ko.frame && typeof ko.frame === 'object' && !Array.isArray(ko.frame))
    ? (ko.frame as Partial<FrameStyle>)
    : undefined;
  const kotLogo = (ko.logo && typeof ko.logo === 'object' && !Array.isArray(ko.logo))
    ? (ko.logo as Partial<LogoStyle>)
    : undefined;

  const koc = (ko.contrast && typeof ko.contrast === 'object' && !Array.isArray(ko.contrast))
    ? (ko.contrast as Record<string, unknown>)
    : undefined;
  const kotContrast: Partial<ThermalContrastStyle> | undefined = koc
    ? {
        densityPreset: typeof koc.densityPreset === 'string' && validPresets.has(koc.densityPreset as ThermalDensityPreset)
          ? (koc.densityPreset as ThermalDensityPreset)
          : undefined,
        threshold: typeof koc.threshold === 'number' ? Math.max(80, Math.min(220, Math.round(koc.threshold))) : undefined,
        inkGain: typeof koc.inkGain === 'number' ? Math.max(0, Math.min(2, Math.round(koc.inkGain))) : undefined,
        ditheringMode: koc.ditheringMode === 'error-diffusion' ? 'error-diffusion' : 'threshold',
      }
    : undefined;

  const kop = (ko.operational && typeof ko.operational === 'object' && !Array.isArray(ko.operational))
    ? (ko.operational as Record<string, unknown>)
    : {};
  const operational: KotOperationalPreferences = {
    headerCompact: Boolean(kop.headerCompact),
    prominentNotes: Boolean(kop.prominentNotes),
    showPrices: Boolean(kop.showPrices),
    showTotals: Boolean(kop.showTotals),
  };

  const stationOverrides = (rawObj.stationOverrides && typeof rawObj.stationOverrides === 'object' && !Array.isArray(rawObj.stationOverrides))
    ? (rawObj.stationOverrides as Record<string, KotVisualOverrides>)
    : undefined;

  return {
    version: 1,
    receipt: {
      renderMode,
      typography: {
        fontFamily,
        storeNameSize,
        headerMetaSize,
        itemNamesSize,
        itemModifiersSize,
        itemNotesSize,
        totalsSize,
        footerSize,
        kotItemSize,
        kotNotesSize,
        reportSize,
        reportTotalsSize,
        storeNameWeight,
        itemNamesWeight,
        totalsWeight,
        kotItemWeight,
        kotNotesWeight,
        reportTotalsWeight,
        receiptScalePercent,
        kotScalePercent,
        reportScalePercent,
      },
      frame: {
        borderStyle,
        borderThickness,
        borderPadding,
        borderRadius,
        dividerStyle,
      },
      logo: {
        showLogo,
        maxWidthPercent,
        spacingBottomDots,
        alignment,
      },
      direction,
      contrast: receiptContrast,
    },
    kotStyleMode,
    kotOverrides: {
      renderMode: kotRenderMode,
      ...(kotDirection ? { direction: kotDirection } : {}),
      ...(kotTypo ? { typography: kotTypo } : {}),
      ...(kotFrame ? { frame: kotFrame } : {}),
      ...(kotLogo ? { logo: kotLogo } : {}),
      ...(kotContrast ? { contrast: kotContrast } : {}),
      operational,
    },
    ...(stationOverrides ? { stationOverrides } : {}),
  };
}

/**
 * Returns the recommended XP-K200L High Readability preset.
 * Applies 125% receipt scale, 145% KOT scale, 115% report scale, bold item names and totals,
 * and dark thermal density with 1-dot ink gain without modifying printer hardware settings.
 */
export function getHighReadabilityPreset(
  basePrefs?: StorePrintStylePreferences,
): StorePrintStylePreferences {
  const base = basePrefs || DEFAULT_PRINT_STYLE_PREFERENCES;
  const darkDensity = resolveDensitySettings('dark');

  return {
    ...base,
    receipt: {
      ...base.receipt,
      renderMode: 'branded_raster',
      typography: {
        ...base.receipt.typography,
        receiptScalePercent: 125,
        kotScalePercent: 145,
        reportScalePercent: 115,
        itemNamesWeight: 'bold',
        totalsWeight: 'bold',
        kotItemWeight: 'bold',
        kotNotesWeight: 'bold',
        reportTotalsWeight: 'bold',
      },
      contrast: {
        densityPreset: 'dark',
        threshold: darkDensity.threshold,
        inkGain: darkDensity.inkGain,
        ditheringMode: 'threshold',
      },
    },
    kotOverrides: {
      ...base.kotOverrides,
      typography: {
        ...base.kotOverrides.typography,
        itemNamesWeight: 'bold',
        kotItemWeight: 'bold',
        kotNotesWeight: 'bold',
        kotScalePercent: 145,
      },
      contrast: {
        densityPreset: 'dark',
        threshold: darkDensity.threshold,
        inkGain: darkDensity.inkGain,
        ditheringMode: 'threshold',
      },
    },
  };
}

/**
 * Validates and normalizes preferences input.
 * Returns the sanitized StorePrintStylePreferences object, or null if input is fundamentally invalid.
 */
export function validatePrintStylePreferences(obj: unknown): StorePrintStylePreferences | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const record = obj as Record<string, unknown>;
  if (record.version !== undefined && record.version !== 1) return null;
  return normalizePrintStylePreferences(record);
}

/**
 * Safe parser for persisted JSON.
 * Returns valid preferences or DEFAULT_PRINT_STYLE_PREFERENCES on corruption/error.
 */
export function parsePrintStylePreferences(rawJson: unknown): StorePrintStylePreferences {
  if (typeof rawJson !== 'string' || !rawJson.trim()) {
    return DEFAULT_PRINT_STYLE_PREFERENCES;
  }
  try {
    const parsed = JSON.parse(rawJson);
    const validated = validatePrintStylePreferences(parsed);
    if (validated) {
      return validated;
    }
    console.warn('[PrintStyle] Preferences JSON failed schema validation, falling back to defaults.');
    return DEFAULT_PRINT_STYLE_PREFERENCES;
  } catch (err) {
    console.warn('[PrintStyle] Failed to parse preferences JSON, falling back to defaults:', err);
    return DEFAULT_PRINT_STYLE_PREFERENCES;
  }
}
