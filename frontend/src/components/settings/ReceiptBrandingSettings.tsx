'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Upload,
  Image as ImageIcon,
  Sparkles,
  RefreshCw,
  Trash2,
  AlertCircle,
  Eye,
  Printer,
  FileDown,
  Layers,
  ChefHat,
  Receipt,
  ShieldCheck,
  Info,
  Sliders,
  Maximize2,
  ChevronDown,
} from 'lucide-react';
import { useTranslations } from 'use-intl';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import type { PrintingForm, HwPrinter } from './PrintersSettingsTab';
import {
  DEFAULT_PRINT_STYLE_PREFERENCES,
  DEFAULT_THERMAL_CONTRAST,
  resolveEffectivePrintStyle,
  getHighReadabilityPreset,
  resolveDensitySettings,
  type StorePrintStylePreferences,
  type FontSizeStep,
  type BorderStyleType,
  type DividerStyleType,
  type ResolvedPrintStyle,
  type PrintFontFamily,
  type PrintFontWeight,
  type ThermalDensityPreset,
} from '@print/style';

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

export interface ReceiptPreviewData {
  business_name: string;
  business_address: string;
  business_phone: string;
  tax_registration_number: string;
  currency: string;
  logo_url: string | null;
  items: Array<{ name: string; quantity: number; price: number; unitPrice?: number }>;
  totals: Array<{ label: string; value: string; isBold?: boolean; isLarge?: boolean }>;
}

export interface KotPreviewData {
  station_name: string;
  order_number: string;
  table_name: string;
  server_name: string;
  timestamp: string;
  items: Array<{ name: string; quantity: number; price: number; unitPrice?: number; notes?: string }>;
  show_prices: boolean;
  show_totals: boolean;
  header_compact: boolean;
  prominent_notes: boolean;
}

interface ReceiptBrandingSettingsProps {
  printingForm: PrintingForm;
  setPrintingForm: React.Dispatch<React.SetStateAction<PrintingForm>>;
  markHydrationTouched: (field: string) => void;
  confirm: (message: string, options?: { title?: string; confirmLabel?: string; destructive?: boolean }) => Promise<boolean>;
  hwPrinters?: HwPrinter[];
}

export function ReceiptBrandingSettings({
  printingForm,
  setPrintingForm,
  markHydrationTouched,
  confirm,
  hwPrinters,
}: ReceiptBrandingSettingsProps) {
  const t = useTranslations('settings');

  // Document and Script tabs
  const [activeDoc, setActiveDoc] = useState<'receipt' | 'kot'>('receipt');
  const [previewScript, setPreviewScript] = useState<'ar' | 'mixed' | 'en'>('mixed');

  // Preview & Logo state
  const [logo, setLogo] = useState<ReceiptLogoMetadata | null>(null);
  const [loadingLogo, setLoadingLogo] = useState<boolean>(false);
  const [uploadingLogo, setUploadingLogo] = useState<boolean>(false);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewPixelHash, setPreviewPixelHash] = useState<string | null>(null);
  const [legacyCodePage, setLegacyCodePage] = useState<string>('default');
  const [showAdvancedLegacy, setShowAdvancedLegacy] = useState<boolean>(false);
  const [receiptData, setReceiptData] = useState<ReceiptPreviewData | null>(null);
  const [kotData, setKotData] = useState<KotPreviewData | null>(null);
  const [sampleText, setSampleText] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewViewMode, setPreviewViewMode] = useState<'thermal' | 'diagnostic' | 'raster'>('thermal');
  const [refreshCount, setRefreshCount] = useState<number>(0);
  const [diagnosticPrinting, setDiagnosticPrinting] = useState<boolean>(false);
  const [selectedPrinterId, setSelectedPrinterId] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const receiptPaperRef = useRef<HTMLDivElement | null>(null);

  const defaultPrinter = hwPrinters?.find((p) => p.is_default) || hwPrinters?.[0];
  const effectivePrinter = hwPrinters?.find((p) => p.id === (selectedPrinterId || defaultPrinter?.id)) || defaultPrinter;
  const is58mm = printingForm.printerPaperSize === 'thermal58';

  // Current canonical preferences
  const currentPrefs: StorePrintStylePreferences = printingForm.printStylePreferences || DEFAULT_PRINT_STYLE_PREFERENCES;

  // Pure resolution of styles for receipt and KOT
  const resolvedReceiptStyle = resolveEffectivePrintStyle(currentPrefs, 'receipt', previewScript);
  const resolvedKotStyle = resolveEffectivePrintStyle(currentPrefs, 'kot', previewScript);
  const activeResolvedStyle: ResolvedPrintStyle = activeDoc === 'receipt' ? resolvedReceiptStyle : resolvedKotStyle;

  // Helper to update preferences centrally
  const updatePrefs = (updater: (prev: StorePrintStylePreferences) => StorePrintStylePreferences) => {
    markHydrationTouched('printStylePreferences');
    setPrintingForm((prev) => {
      const base = prev.printStylePreferences || DEFAULT_PRINT_STYLE_PREFERENCES;
      const updated = updater(base);
      return {
        ...prev,
        printStylePreferences: updated,
        receiptRenderMode: updated.receipt.renderMode,
        receiptBrandedFontFamily: updated.receipt.typography.fontFamily,
      };
    });
  };

  const activeFontFamilyCss =
    activeResolvedStyle.typography.fontFamily === 'cairo'
      ? "'Cairo', 'Segoe UI', Tahoma, sans-serif"
      : activeResolvedStyle.typography.fontFamily === 'system'
        ? "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
        : "'Almarai', 'Segoe UI', Tahoma, sans-serif";

  // Browser Print handler
  const handlePrintBrowser = () => {
    if (!receiptPaperRef.current) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Please allow popups to print');
      return;
    }
    const mmWidth = is58mm ? '58mm' : '80mm';
    const content = receiptPaperRef.current.innerHTML;
    printWindow.document.write(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${activeDoc === 'kot' ? 'KOT Ticket' : 'Receipt'}</title>
    <style>
      @page { size: ${mmWidth} auto; margin: 0; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        width: ${mmWidth};
        max-width: ${mmWidth};
        margin: 0 auto;
        padding: 4mm 2mm;
        font-family: ${activeFontFamilyCss};
        color: #000;
        background: #fff;
      }
      @media print {
        body { width: ${mmWidth} !important; max-width: ${mmWidth} !important; }
      }
    </style>
  </head>
  <body>
    ${content}
    <script>
      window.onload = function() {
        window.focus();
        window.print();
        setTimeout(function() { window.close(); }, 500);
      };
    </script>
  </body>
</html>`);
    printWindow.document.close();
  };

  // Hardware diagnostic test print
  const handlePrintDiagnostic = async (transportOverride?: 'gs_v_0' | 'esc_star_24') => {
    if (effectivePrinter?.connection_type === 'webusb') {
      toast.error(
        'WebUSB printers are managed in the browser (via POS toolbar). For desktop print tests, click "Print / Save as PDF" or configure a USB or Network printer in Settings > Printers.',
        { duration: 7000 },
      );
      return;
    }

    try {
      setDiagnosticPrinting(true);
      const res = await api.post('/printers/diagnostic-branded', {
        printer_id: effectivePrinter?.id,
        font_family: activeResolvedStyle.typography.fontFamily,
        document_type: activeDoc,
        transport: transportOverride,
      });

      if (res.data?.success) {
        toast.success(t('printBrandedDiagnosticSuccess'));
      } else {
        toast.error(res.data?.error || t('printBrandedDiagnosticFailed'));
      }
    } catch (err: unknown) {
      const resp = (err as { response?: { data?: { error?: string; userMessage?: string; userMessageEn?: string; userMessageAr?: string; detail?: string; status?: string } } })?.response?.data;
      if (resp?.status === 'print_may_be_incomplete') {
        const warning = resp.userMessage || resp.userMessageEn || t('printMayBeIncomplete');
        toast.error(warning, { duration: 6000 });
      } else {
        const errorMsg = resp?.userMessageEn || resp?.userMessage || resp?.userMessageAr || resp?.error || resp?.detail || (err instanceof Error ? err.message : t('printBrandedDiagnosticFailed'));
        toast.error(errorMsg, { duration: 7000 });
      }
    } finally {
      setDiagnosticPrinting(false);
    }
  };

  // Load logo metadata
  useEffect(() => {
    let ignore = false;
    const timer = setTimeout(async () => {
      try {
        setLoadingLogo(true);
        const res = await api.get('/settings/receipt-logo');
        if (ignore) return;
        if (res.data?.success && res.data.logo) {
          setLogo(res.data.logo);
        } else {
          setLogo(null);
        }
      } catch {
        if (!ignore) setLogo(null);
      } finally {
        if (!ignore) setLoadingLogo(false);
      }

      // Fetch legacy code page from settings
      try {
        const sRes = await api.get('/settings');
        if (!ignore && sRes.data?.settings?.legacy_code_page) {
          setLegacyCodePage(sRes.data.settings.legacy_code_page);
        }
      } catch {
        // Non-fatal fallback
      }
    }, 0);

    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, []);

  // Fetch live preview from backend route whenever preferences, active doc, script, view mode, or paper width change
  useEffect(() => {
    let ignore = false;
    const timer = setTimeout(async () => {
      try {
        setPreviewLoading(true);
        setPreviewError(null);
        const targetDocType = previewViewMode === 'diagnostic' ? 'diagnostic' : activeDoc;
        const res = await api.get('/settings/receipt-preview', {
          params: {
            document_type: targetDocType,
            language: previewScript,
            paper_width: is58mm ? '58mm' : '80mm',
            style_preferences: JSON.stringify(currentPrefs),
          },
        });

        if (ignore) return;
        if (res.data?.success) {
          setPreviewImageUrl(res.data.preview_image_url || null);
          setPreviewPixelHash(res.data.pixel_hash || null);
          setReceiptData(res.data.receipt_data || null);
          setKotData(res.data.kot_data || null);
          setSampleText(res.data.sample_text || null);
        } else {
          setPreviewError('Failed to generate preview');
        }
      } catch (err: unknown) {
        if (ignore) return;
        const e = err as { response?: { data?: { error?: string } }; message?: string };
        setPreviewError(e?.response?.data?.error || e?.message || 'Error generating preview');
      } finally {
        if (!ignore) setPreviewLoading(false);
      }
    }, 50);

    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [
    activeDoc,
    previewScript,
    previewViewMode,
    is58mm,
    currentPrefs,
    refreshCount,
  ]);

  const handleSelectLegacyCodePage = async (codePageId: string) => {
    setLegacyCodePage(codePageId);
    try {
      await api.put('/settings/legacy_code_page', { value: codePageId });
      toast.success(t('printerUpdated') || 'Legacy code page updated');
    } catch {
      toast.error('Failed to update legacy code page');
    }
  };

  // Upload store logo
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error(t('logoFileSizeExceeded') || 'Logo file size exceeds 2 MB limit');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    try {
      setUploadingLogo(true);
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64Data = reader.result as string;
          const res = await api.post('/settings/receipt-logo', {
            data: base64Data,
            filename: file.name,
          });

          if (res.data?.success && res.data.logo) {
            setLogo(res.data.logo);
            toast.success(t('logoUploadedSuccessfully') || 'Store logo uploaded successfully');
            setRefreshCount((c) => c + 1);
          }
        } catch (uploadErr: unknown) {
          const e = uploadErr as { response?: { data?: { error?: string } }; message?: string };
          toast.error(e?.response?.data?.error || e?.message || 'Failed to upload logo');
        } finally {
          setUploadingLogo(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };
      reader.onerror = () => {
        toast.error('Failed to read image file');
        setUploadingLogo(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      };
      reader.readAsDataURL(file);
    } catch (err: unknown) {
      const e = err as { message?: string };
      toast.error(e?.message || 'Failed to upload logo');
      setUploadingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Remove store logo
  const handleRemoveLogo = async () => {
    const shouldRemove = await confirm(
      t('confirmRemoveLogo') || 'Are you sure you want to remove the store logo?',
      {
        title: t('removeLogo') || 'Remove Logo',
        confirmLabel: t('removeLogo') || 'Remove',
        destructive: true,
      },
    );

    if (!shouldRemove) return;

    try {
      setUploadingLogo(true);
      const res = await api.delete('/settings/receipt-logo');
      if (res.data?.success) {
        setLogo(null);
        toast.success(t('logoRemovedSuccessfully') || 'Store logo removed');
        setRefreshCount((c) => c + 1);
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      toast.error(e?.response?.data?.error || e?.message || 'Failed to remove logo');
    } finally {
      setUploadingLogo(false);
    }
  };

  // Thermal view divider helper
  const getDividerClass = (style: DividerStyleType) => {
    if (style === 'none') return 'border-transparent my-1';
    if (style === 'solid') return 'border-t border-black my-2';
    if (style === 'dotted') return 'border-t border-dotted border-gray-600 my-2';
    return 'border-t border-dashed border-gray-600 my-2';
  };

  return (
    <div className="bg-card rounded-xl border border-border p-6 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-border pb-4 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles size={20} className="text-brand" />
            <h2 className="font-semibold text-foreground text-base">{t('receiptBranding')}</h2>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{t('receiptBrandingDesc')}</p>
        </div>

        {/* Document Selector: Receipt vs KOT */}
        <div className="flex items-center p-1 bg-muted/60 rounded-xl border border-border self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setActiveDoc('receipt')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              activeDoc === 'receipt'
                ? 'bg-card text-foreground shadow-sm font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Receipt size={14} className={activeDoc === 'receipt' ? 'text-brand' : ''} />
            <span>{t('documentReceipt')}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveDoc('kot')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              activeDoc === 'kot'
                ? 'bg-card text-foreground shadow-sm font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <ChefHat size={14} className={activeDoc === 'kot' ? 'text-brand' : ''} />
            <span>{t('documentKot')}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Controls Column (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* 1. KOT OPERATIONAL CONTENT OPTIONS (Available in both Inherit and Custom modes) */}
          {activeDoc === 'kot' && (
            <div className="bg-card rounded-xl border border-border p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                    <ShieldCheck size={16} className="text-emerald-500" />
                    {t('kotOperationalSettings')}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{t('kotOperationalSettingsDesc')}</p>
                </div>
              </div>

              {/* Safety notice banner */}
              <div className="text-[11px] text-muted-foreground bg-muted/40 border border-border rounded-lg p-2.5 leading-relaxed">
                🛡️ <strong>Safety Guarantee:</strong> {t('kotSafeNotice')}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {/* showPrices */}
                <label className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/20 cursor-pointer">
                  <div className="space-y-0.5 pe-2">
                    <span className="text-xs font-semibold text-foreground block">{t('kotShowPrices')}</span>
                    <span className="text-[11px] text-muted-foreground block leading-tight">{t('kotShowPricesDesc')}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={currentPrefs.kotOverrides?.operational?.showPrices ?? false}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      updatePrefs((p) => ({
                        ...p,
                        kotOverrides: {
                          ...p.kotOverrides,
                          operational: { ...p.kotOverrides?.operational, showPrices: checked },
                        },
                      }));
                    }}
                    className="h-4 w-4 rounded border-border text-brand focus:ring-brand"
                  />
                </label>

                {/* showTotals */}
                <label className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/20 cursor-pointer">
                  <div className="space-y-0.5 pe-2">
                    <span className="text-xs font-semibold text-foreground block">{t('kotShowTotals')}</span>
                    <span className="text-[11px] text-muted-foreground block leading-tight">{t('kotShowTotalsDesc')}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={currentPrefs.kotOverrides?.operational?.showTotals ?? false}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      updatePrefs((p) => ({
                        ...p,
                        kotOverrides: {
                          ...p.kotOverrides,
                          operational: { ...p.kotOverrides?.operational, showTotals: checked },
                        },
                      }));
                    }}
                    className="h-4 w-4 rounded border-border text-brand focus:ring-brand"
                  />
                </label>

                {/* headerCompact */}
                <label className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/20 cursor-pointer">
                  <div className="space-y-0.5 pe-2">
                    <span className="text-xs font-semibold text-foreground block">{t('kotHeaderCompact')}</span>
                    <span className="text-[11px] text-muted-foreground block leading-tight">{t('kotHeaderCompactDesc')}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={currentPrefs.kotOverrides?.operational?.headerCompact ?? false}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      updatePrefs((p) => ({
                        ...p,
                        kotOverrides: {
                          ...p.kotOverrides,
                          operational: { ...p.kotOverrides?.operational, headerCompact: checked },
                        },
                      }));
                    }}
                    className="h-4 w-4 rounded border-border text-brand focus:ring-brand"
                  />
                </label>

                {/* prominentNotes */}
                <label className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/20 cursor-pointer">
                  <div className="space-y-0.5 pe-2">
                    <span className="text-xs font-semibold text-foreground block">{t('kotProminentNotes')}</span>
                    <span className="text-[11px] text-muted-foreground block leading-tight">{t('kotProminentNotesDesc')}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={currentPrefs.kotOverrides?.operational?.prominentNotes ?? false}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      updatePrefs((p) => ({
                        ...p,
                        kotOverrides: {
                          ...p.kotOverrides,
                          operational: { ...p.kotOverrides?.operational, prominentNotes: checked },
                        },
                      }));
                    }}
                    className="h-4 w-4 rounded border-border text-brand focus:ring-brand"
                  />
                </label>
              </div>
            </div>
          )}

          {/* 2. KOT VISUAL STYLE: Inherit vs Custom Mode Toggle */}
          {activeDoc === 'kot' && (
            <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                    <Layers size={16} className="text-brand" />
                    {t('kotStyleMode')}
                  </label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {currentPrefs.kotStyleMode === 'inherit'
                      ? 'Visual styling is mirrored directly from the customer receipt.'
                      : t('kotModeCustomDesc')}
                  </p>
                </div>
                <div className="flex items-center gap-1 bg-card p-1 rounded-lg border border-border">
                  <button
                    type="button"
                    onClick={() => updatePrefs((p) => ({ ...p, kotStyleMode: 'inherit' }))}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-all cursor-pointer ${
                      currentPrefs.kotStyleMode === 'inherit'
                        ? 'bg-brand text-white shadow-sm font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t('kotModeInherit')}
                  </button>
                  <button
                    type="button"
                    onClick={() => updatePrefs((p) => ({ ...p, kotStyleMode: 'custom' }))}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-all cursor-pointer ${
                      currentPrefs.kotStyleMode === 'custom'
                        ? 'bg-brand text-white shadow-sm font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t('kotModeCustom')}
                  </button>
                </div>
              </div>

              {currentPrefs.kotStyleMode === 'inherit' && (
                <div className="flex items-start gap-2 bg-brand/10 border border-brand/25 text-brand dark:text-brand-foreground rounded-lg p-3 text-xs leading-relaxed">
                  <Info size={16} className="shrink-0 mt-0.5 text-brand" />
                  <p>{t('kotInheritNotice')}</p>
                </div>
              )}
            </div>
          )}

          {/* RECOMMENDED XP-K200L HIGH READABILITY PRESET BANNER */}
          <div className="bg-brand/10 border border-brand/30 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-brand shrink-0" />
                <span className="text-xs font-bold text-foreground">XP-K200L 80 mm – High Readability</span>
                <span className="text-[10px] font-medium bg-brand/20 text-brand px-2 py-0.5 rounded-full">Recommended</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                One-click physical preset: 125% Receipt scale, 145% KOT scale, 115% Report scale, Bold items & totals, Dark thermal density (threshold 160, +1 dot ink gain). Retains existing printer hardware, port, width, and logo settings.
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                const ok = await confirm(
                  'Apply recommended XP-K200L High Readability typography and contrast settings? Your printer connection, paper width, and logo will remain unchanged.',
                  { title: 'Apply XP-K200L Preset', confirmLabel: 'Apply Preset' }
                );
                if (ok) {
                  const updated = getHighReadabilityPreset(currentPrefs);
                  updatePrefs(() => updated);
                  toast.success('Applied XP-K200L High Readability Preset');
                }
              }}
              className="shrink-0 px-3.5 py-1.5 rounded-lg bg-brand hover:bg-brand/90 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
            >
              Apply Preset / تطبيق الإعداد
            </button>
          </div>

          {/* RENDER MODE (Receipt or Custom KOT) */}
          {(activeDoc === 'receipt' || currentPrefs.kotStyleMode === 'custom') && (
            <div className="space-y-3">
              <label className="text-sm font-semibold text-foreground block">{t('receiptRenderMode')}</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (activeDoc === 'receipt') {
                      updatePrefs((p) => ({
                        ...p,
                        receipt: { ...p.receipt, renderMode: 'legacy_text' },
                      }));
                    } else {
                      updatePrefs((p) => ({
                        ...p,
                        kotOverrides: { ...p.kotOverrides, renderMode: 'legacy_text' },
                      }));
                    }
                  }}
                  className={`p-3 rounded-xl border text-start transition-all ${
                    (activeDoc === 'receipt' ? currentPrefs.receipt.renderMode : (currentPrefs.kotOverrides?.renderMode || currentPrefs.receipt.renderMode)) === 'legacy_text'
                      ? 'border-brand bg-brand/10 font-semibold text-foreground shadow-sm'
                      : 'border-border hover:bg-muted/30 text-muted-foreground'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">{t('renderModeLegacyText')}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                    {t('renderModeLegacyTextDesc')}
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (activeDoc === 'receipt') {
                      updatePrefs((p) => ({
                        ...p,
                        receipt: { ...p.receipt, renderMode: 'branded_raster' },
                      }));
                    } else {
                      updatePrefs((p) => ({
                        ...p,
                        kotOverrides: { ...p.kotOverrides, renderMode: 'branded_raster' },
                      }));
                    }
                  }}
                  className={`p-3 rounded-xl border text-start transition-all ${
                    (activeDoc === 'receipt' ? currentPrefs.receipt.renderMode : (currentPrefs.kotOverrides?.renderMode || currentPrefs.receipt.renderMode)) === 'branded_raster'
                      ? 'border-brand bg-brand/10 font-semibold text-foreground shadow-sm'
                      : 'border-border hover:bg-muted/30 text-muted-foreground'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">{t('renderModeBrandedRaster')}</span>
                    <Sparkles size={14} className="text-brand" />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                    {t('renderModeBrandedRasterDesc')}
                  </p>
                </button>
              </div>

              {/* Honest Notice for Legacy Text mode */}
              {activeResolvedStyle.renderMode === 'legacy_text' && (
                <div className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-lg p-2.5 leading-relaxed">
                  💡 <strong>Notice:</strong> {t('legacyTextNotice')}
                </div>
              )}
            </div>
          )}

          {/* FONT FAMILY SELECTION */}
          {(activeDoc === 'receipt' || currentPrefs.kotStyleMode === 'custom') && (
            <div className="space-y-3 pt-4 border-t border-border">
              <label className="text-sm font-semibold text-foreground block">{t('brandedFontFamily')}</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {[
                  { id: 'almarai' as PrintFontFamily, label: t('fontFamilyAlmarai'), sample: 'المراعي ١٢٣', font: "'Almarai', sans-serif" },
                  { id: 'cairo' as PrintFontFamily, label: t('fontFamilyCairo'), sample: 'القاهرة ١٢٣', font: "'Cairo', sans-serif" },
                  { id: 'system' as PrintFontFamily, label: t('fontFamilySystem'), sample: 'System 123', font: 'system-ui, sans-serif' },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      if (activeDoc === 'receipt') {
                        updatePrefs((p) => ({
                          ...p,
                          receipt: {
                            ...p.receipt,
                            typography: { ...p.receipt.typography, fontFamily: f.id },
                          },
                        }));
                      } else {
                        updatePrefs((p) => ({
                          ...p,
                          kotOverrides: {
                            ...p.kotOverrides,
                            typography: { ...p.kotOverrides?.typography, fontFamily: f.id },
                          },
                        }));
                      }
                    }}
                    className={`p-2.5 rounded-xl border text-start transition-all cursor-pointer ${
                      activeResolvedStyle.typography.fontFamily === f.id
                        ? 'border-brand bg-brand/10 font-semibold text-foreground shadow-sm'
                        : 'border-border hover:bg-muted/30 text-muted-foreground'
                    }`}
                  >
                    <p className="text-xs truncate font-medium">{f.label}</p>
                    <p className="text-xs text-foreground mt-1 font-semibold" style={{ fontFamily: f.font }}>
                      {f.sample}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* TYPOGRAPHY SCALING SECTION */}
          {(activeDoc === 'receipt' || currentPrefs.kotStyleMode === 'custom') && (
            <div className="space-y-4 pt-4 border-t border-border">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                    <Sliders size={16} className="text-brand" />
                    {t('typographySection')}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Configure document scaling, font weights, and per-role text sizes.
                  </p>
                </div>
              </div>

              {/* Quick Typography Presets */}
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-foreground block">Typography Preset / حجم الخط العام</span>
                <div className="grid grid-cols-4 gap-2">
                  {(['small', 'medium', 'large', 'xlarge'] as const).map((sizePreset) => (
                    <button
                      key={sizePreset}
                      type="button"
                      onClick={() => {
                        if (activeDoc === 'receipt') {
                          updatePrefs((p) => ({
                            ...p,
                            receipt: {
                              ...p.receipt,
                              typography: {
                                ...p.receipt.typography,
                                itemNamesSize: sizePreset,
                                totalsSize: sizePreset === 'small' ? 'medium' : sizePreset,
                                storeNameSize: sizePreset === 'small' ? 'medium' : sizePreset,
                              },
                            },
                          }));
                        } else {
                          updatePrefs((p) => ({
                            ...p,
                            kotOverrides: {
                              ...p.kotOverrides,
                              typography: {
                                ...p.kotOverrides?.typography,
                                itemNamesSize: sizePreset,
                                kotItemSize: sizePreset,
                                totalsSize: sizePreset === 'small' ? 'medium' : sizePreset,
                                storeNameSize: sizePreset === 'small' ? 'medium' : sizePreset,
                              },
                            },
                          }));
                        }
                      }}
                      className="p-2 rounded-lg border border-border hover:bg-muted/40 text-xs font-medium capitalize text-center transition-all cursor-pointer"
                    >
                      {sizePreset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Global Scale Sliders */}
              <div className="grid grid-cols-1 gap-3 bg-card p-3 rounded-xl border border-border">
                {activeDoc === 'receipt' ? (
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-foreground">Global Receipt Scale / مقياس الفاتورة العام</span>
                      <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-foreground font-bold">
                        {currentPrefs.receipt.typography.receiptScalePercent || 100}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="75"
                      max="220"
                      step="5"
                      value={currentPrefs.receipt.typography.receiptScalePercent || 100}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        updatePrefs((p) => ({
                          ...p,
                          receipt: {
                            ...p.receipt,
                            typography: { ...p.receipt.typography, receiptScalePercent: val },
                          },
                        }));
                      }}
                      className="w-full accent-brand cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>75% (Compact)</span>
                      <span>100% (Default)</span>
                      <span>125% (XP-K200L Rec.)</span>
                      <span>220% (Max)</span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-foreground">Global KOT Scale / مقياس تذكرة المطبخ العام</span>
                      <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-foreground font-bold">
                        {currentPrefs.kotOverrides?.typography?.kotScalePercent || currentPrefs.receipt.typography.kotScalePercent || 100}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="75"
                      max="260"
                      step="5"
                      value={currentPrefs.kotOverrides?.typography?.kotScalePercent || currentPrefs.receipt.typography.kotScalePercent || 100}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        updatePrefs((p) => ({
                          ...p,
                          kotOverrides: {
                            ...p.kotOverrides,
                            typography: { ...p.kotOverrides?.typography, kotScalePercent: val },
                          },
                        }));
                      }}
                      className="w-full accent-brand cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>75% (Compact)</span>
                      <span>100% (Default)</span>
                      <span>145% (XP-K200L Rec.)</span>
                      <span>260% (Max)</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Per-Role Font Weights */}
              <div className="space-y-2 pt-1">
                <span className="text-xs font-semibold text-foreground block">Font Weights / سماكة الخط للأدوار</span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {/* Store Name Weight */}
                  <div className="p-2 rounded-lg border border-border bg-card flex items-center justify-between">
                    <span className="text-xs text-foreground font-medium">Store Name</span>
                    <button
                      type="button"
                      onClick={() => {
                        const nextWeight: PrintFontWeight = currentPrefs.receipt.typography.storeNameWeight === 'regular' ? 'bold' : 'regular';
                        updatePrefs((p) => ({
                          ...p,
                          receipt: { ...p.receipt, typography: { ...p.receipt.typography, storeNameWeight: nextWeight } },
                        }));
                      }}
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all cursor-pointer ${
                        (currentPrefs.receipt.typography.storeNameWeight ?? 'bold') === 'bold'
                          ? 'bg-brand text-white'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {(currentPrefs.receipt.typography.storeNameWeight ?? 'bold').toUpperCase()}
                    </button>
                  </div>

                  {/* Item Names Weight */}
                  <div className="p-2 rounded-lg border border-border bg-card flex items-center justify-between">
                    <span className="text-xs text-foreground font-medium">Item Names</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (activeDoc === 'receipt') {
                          const nextWeight: PrintFontWeight = currentPrefs.receipt.typography.itemNamesWeight === 'bold' ? 'regular' : 'bold';
                          updatePrefs((p) => ({
                            ...p,
                            receipt: { ...p.receipt, typography: { ...p.receipt.typography, itemNamesWeight: nextWeight } },
                          }));
                        } else {
                          const nextWeight: PrintFontWeight = (currentPrefs.kotOverrides?.typography?.kotItemWeight ?? 'bold') === 'bold' ? 'regular' : 'bold';
                          updatePrefs((p) => ({
                            ...p,
                            kotOverrides: { ...p.kotOverrides, typography: { ...p.kotOverrides?.typography, kotItemWeight: nextWeight } },
                          }));
                        }
                      }}
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all cursor-pointer ${
                        (activeDoc === 'receipt' ? currentPrefs.receipt.typography.itemNamesWeight === 'bold' : (currentPrefs.kotOverrides?.typography?.kotItemWeight ?? 'bold') === 'bold')
                          ? 'bg-brand text-white'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {(activeDoc === 'receipt' ? (currentPrefs.receipt.typography.itemNamesWeight === 'bold' ? 'BOLD' : 'REGULAR') : ((currentPrefs.kotOverrides?.typography?.kotItemWeight ?? 'bold') === 'bold' ? 'BOLD' : 'REGULAR'))}
                    </button>
                  </div>

                  {/* Totals Weight */}
                  <div className="p-2 rounded-lg border border-border bg-card flex items-center justify-between">
                    <span className="text-xs text-foreground font-medium">Totals</span>
                    <button
                      type="button"
                      onClick={() => {
                        const nextWeight: PrintFontWeight = currentPrefs.receipt.typography.totalsWeight === 'regular' ? 'bold' : 'regular';
                        updatePrefs((p) => ({
                          ...p,
                          receipt: { ...p.receipt, typography: { ...p.receipt.typography, totalsWeight: nextWeight } },
                        }));
                      }}
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all cursor-pointer ${
                        (currentPrefs.receipt.typography.totalsWeight ?? 'bold') === 'bold'
                          ? 'bg-brand text-white'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {(currentPrefs.receipt.typography.totalsWeight ?? 'bold').toUpperCase()}
                    </button>
                  </div>
                </div>
              </div>

              {/* Per-Role Sizing Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {/* Store Name Size */}
                <div className="space-y-1">
                  <span className="text-xs font-medium text-foreground">{t('storeNameSize')}</span>
                  <select
                    value={activeResolvedStyle.typography.storeNameSize}
                    onChange={(e) => {
                      const val = e.target.value as FontSizeStep;
                      if (activeDoc === 'receipt') {
                        updatePrefs((p) => ({ ...p, receipt: { ...p.receipt, typography: { ...p.receipt.typography, storeNameSize: val } } }));
                      } else {
                        updatePrefs((p) => ({ ...p, kotOverrides: { ...p.kotOverrides, typography: { ...p.kotOverrides?.typography, storeNameSize: val } } }));
                      }
                    }}
                    className="w-full text-xs p-2 rounded-lg border border-border bg-card text-foreground"
                  >
                    <option value="small">{t('sizeSmall')}</option>
                    <option value="medium">{t('sizeMedium')}</option>
                    <option value="large">{t('sizeLarge')}</option>
                    <option value="xlarge">{t('sizeXLarge')}</option>
                  </select>
                </div>

                {/* Header Meta Size */}
                <div className="space-y-1">
                  <span className="text-xs font-medium text-foreground">{t('headerMetaSize')}</span>
                  <select
                    value={activeResolvedStyle.typography.headerMetaSize}
                    onChange={(e) => {
                      const val = e.target.value as FontSizeStep;
                      if (activeDoc === 'receipt') {
                        updatePrefs((p) => ({ ...p, receipt: { ...p.receipt, typography: { ...p.receipt.typography, headerMetaSize: val } } }));
                      } else {
                        updatePrefs((p) => ({ ...p, kotOverrides: { ...p.kotOverrides, typography: { ...p.kotOverrides?.typography, headerMetaSize: val } } }));
                      }
                    }}
                    className="w-full text-xs p-2 rounded-lg border border-border bg-card text-foreground"
                  >
                    <option value="small">{t('sizeSmall')}</option>
                    <option value="medium">{t('sizeMedium')}</option>
                    <option value="large">{t('sizeLarge')}</option>
                  </select>
                </div>

                {/* Item Names Size */}
                <div className="space-y-1">
                  <span className="text-xs font-medium text-foreground">{t('itemNamesSize')}</span>
                  <select
                    value={activeDoc === 'receipt' ? activeResolvedStyle.typography.itemNamesSize : (currentPrefs.kotOverrides?.typography?.kotItemSize || 'large')}
                    onChange={(e) => {
                      const val = e.target.value as FontSizeStep;
                      if (activeDoc === 'receipt') {
                        updatePrefs((p) => ({ ...p, receipt: { ...p.receipt, typography: { ...p.receipt.typography, itemNamesSize: val } } }));
                      } else {
                        updatePrefs((p) => ({ ...p, kotOverrides: { ...p.kotOverrides, typography: { ...p.kotOverrides?.typography, itemNamesSize: val, kotItemSize: val } } }));
                      }
                    }}
                    className="w-full text-xs p-2 rounded-lg border border-border bg-card text-foreground"
                  >
                    <option value="small">{t('sizeSmall')}</option>
                    <option value="medium">{t('sizeMedium')}</option>
                    <option value="large">{t('sizeLarge')}</option>
                    <option value="xlarge">{t('sizeXLarge')}</option>
                  </select>
                </div>

                {/* Item Modifiers Size */}
                <div className="space-y-1">
                  <span className="text-xs font-medium text-foreground">{t('itemModifiersSize')}</span>
                  <select
                    value={activeResolvedStyle.typography.itemModifiersSize}
                    onChange={(e) => {
                      const val = e.target.value as FontSizeStep;
                      if (activeDoc === 'receipt') {
                        updatePrefs((p) => ({ ...p, receipt: { ...p.receipt, typography: { ...p.receipt.typography, itemModifiersSize: val } } }));
                      } else {
                        updatePrefs((p) => ({ ...p, kotOverrides: { ...p.kotOverrides, typography: { ...p.kotOverrides?.typography, itemModifiersSize: val } } }));
                      }
                    }}
                    className="w-full text-xs p-2 rounded-lg border border-border bg-card text-foreground"
                  >
                    <option value="small">{t('sizeSmall')}</option>
                    <option value="medium">{t('sizeMedium')}</option>
                  </select>
                </div>

                {/* Item Notes Size */}
                <div className="space-y-1">
                  <span className="text-xs font-medium text-foreground">{t('itemNotesSize')}</span>
                  <select
                    value={activeDoc === 'receipt' ? activeResolvedStyle.typography.itemNotesSize : (currentPrefs.kotOverrides?.typography?.kotNotesSize || 'medium')}
                    onChange={(e) => {
                      const val = e.target.value as FontSizeStep;
                      if (activeDoc === 'receipt') {
                        updatePrefs((p) => ({ ...p, receipt: { ...p.receipt, typography: { ...p.receipt.typography, itemNotesSize: val } } }));
                      } else {
                        updatePrefs((p) => ({ ...p, kotOverrides: { ...p.kotOverrides, typography: { ...p.kotOverrides?.typography, itemNotesSize: val, kotNotesSize: val } } }));
                      }
                    }}
                    className="w-full text-xs p-2 rounded-lg border border-border bg-card text-foreground"
                  >
                    <option value="small">{t('sizeSmall')}</option>
                    <option value="medium">{t('sizeMedium')}</option>
                    <option value="large">{t('sizeLarge')}</option>
                    <option value="xlarge">{t('sizeXLarge')}</option>
                  </select>
                </div>

                {/* Totals Size */}
                <div className="space-y-1">
                  <span className="text-xs font-medium text-foreground">{t('totalsSize')}</span>
                  <select
                    value={activeResolvedStyle.typography.totalsSize}
                    onChange={(e) => {
                      const val = e.target.value as FontSizeStep;
                      if (activeDoc === 'receipt') {
                        updatePrefs((p) => ({ ...p, receipt: { ...p.receipt, typography: { ...p.receipt.typography, totalsSize: val } } }));
                      } else {
                        updatePrefs((p) => ({ ...p, kotOverrides: { ...p.kotOverrides, typography: { ...p.kotOverrides?.typography, totalsSize: val } } }));
                      }
                    }}
                    className="w-full text-xs p-2 rounded-lg border border-border bg-card text-foreground"
                  >
                    <option value="small">{t('sizeSmall')}</option>
                    <option value="medium">{t('sizeMedium')}</option>
                    <option value="large">{t('sizeLarge')}</option>
                    <option value="xlarge">{t('sizeXLarge')}</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* THERMAL CONTRAST & DENSITY SECTION */}
          {(activeDoc === 'receipt' || currentPrefs.kotStyleMode === 'custom') && (
            <div className="space-y-4 pt-4 border-t border-border">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                    <Sliders size={16} className="text-brand" />
                    Thermal Contrast &amp; Darkness / كثافة الطباعة الحرارية
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Software-side 1-bit thermal bitmap contrast and dot expansion.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const darkDensity = resolveDensitySettings('dark');
                    if (activeDoc === 'receipt') {
                      updatePrefs((p) => ({
                        ...p,
                        receipt: {
                          ...p.receipt,
                          contrast: {
                            densityPreset: 'dark',
                            threshold: darkDensity.threshold,
                            inkGain: darkDensity.inkGain,
                            ditheringMode: 'threshold',
                          },
                        },
                      }));
                    } else {
                      updatePrefs((p) => ({
                        ...p,
                        kotOverrides: {
                          ...p.kotOverrides,
                          contrast: {
                            densityPreset: 'dark',
                            threshold: darkDensity.threshold,
                            inkGain: darkDensity.inkGain,
                            ditheringMode: 'threshold',
                          },
                        },
                      }));
                    }
                    toast.success('Reset to recommended Dark contrast');
                  }}
                  className="text-xs text-brand hover:underline cursor-pointer"
                >
                  Reset to Defaults
                </button>
              </div>

              {/* Bilingual Explanation Box */}
              <div className="bg-muted/40 border border-border/60 rounded-xl p-3 text-xs leading-relaxed space-y-1">
                <p className="text-foreground font-medium">
                  Darkness affects the final black-and-white thermal bitmap. Darker settings increase black dots and improve thin text visibility.
                </p>
                <p className="text-muted-foreground font-arabic" dir="rtl">
                  تؤثر درجة الكثافة على الصورة الحرارية النهائية بالأبيض والأسود. تزيد الإعدادات الداكنة النقاط السوداء لتحسين وضوح النصوص الرفيعة.
                </p>
              </div>

              {/* Density Presets */}
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-foreground block">Density Preset / مستوى الكثافة</span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['light', 'normal', 'dark', 'extra_dark'] as const).map((preset) => {
                    const activePreset = activeResolvedStyle.contrast?.densityPreset || 'dark';
                    const isSelected = activePreset === preset;
                    const labels: Record<Exclude<ThermalDensityPreset, 'custom'>, { en: string; ar: string }> = {
                      light: { en: 'Light', ar: 'فاتح' },
                      normal: { en: 'Normal', ar: 'عادي' },
                      dark: { en: 'Dark (Rec.)', ar: 'داكن (موصى به)' },
                      extra_dark: { en: 'Extra Dark', ar: 'داكن جداً' },
                    };
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          const resolved = resolveDensitySettings(preset);
                          if (activeDoc === 'receipt') {
                            updatePrefs((p) => ({
                              ...p,
                              receipt: {
                                ...p.receipt,
                                contrast: {
                                  densityPreset: preset,
                                  threshold: resolved.threshold,
                                  inkGain: resolved.inkGain,
                                  ditheringMode: p.receipt.contrast?.ditheringMode ?? DEFAULT_THERMAL_CONTRAST.ditheringMode,
                                },
                              },
                            }));
                          } else {
                            updatePrefs((p) => ({
                              ...p,
                              kotOverrides: {
                                ...p.kotOverrides,
                                contrast: {
                                  densityPreset: preset,
                                  threshold: resolved.threshold,
                                  inkGain: resolved.inkGain,
                                  ditheringMode: p.kotOverrides?.contrast?.ditheringMode ?? DEFAULT_THERMAL_CONTRAST.ditheringMode,
                                },
                              },
                            }));
                          }
                        }}
                        className={`p-2.5 rounded-lg border text-center transition-all cursor-pointer ${
                          isSelected
                            ? 'border-brand bg-brand/10 font-bold text-foreground shadow-xs'
                            : 'border-border hover:bg-muted/40 text-muted-foreground'
                        }`}
                      >
                        <div className="text-xs font-medium">{labels[preset].en}</div>
                        <div className="text-[10px] text-muted-foreground font-arabic">{labels[preset].ar}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Advanced Threshold & Ink Gain */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                {/* Monochrome Threshold Slider */}
                <div className="space-y-1.5 bg-card p-3 rounded-lg border border-border">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold text-foreground">Black Threshold / حساسية السواد</span>
                    <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-foreground font-bold">
                      {activeResolvedStyle.contrast?.threshold ?? 160}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="80"
                    max="220"
                    step="5"
                    value={activeResolvedStyle.contrast?.threshold ?? 160}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (activeDoc === 'receipt') {
                        updatePrefs((p) => ({
                          ...p,
                          receipt: {
                            ...p.receipt,
                            contrast: {
                              densityPreset: 'custom',
                              threshold: val,
                              inkGain: p.receipt.contrast?.inkGain ?? DEFAULT_THERMAL_CONTRAST.inkGain,
                              ditheringMode: p.receipt.contrast?.ditheringMode ?? DEFAULT_THERMAL_CONTRAST.ditheringMode,
                            },
                          },
                        }));
                      } else {
                        updatePrefs((p) => ({
                          ...p,
                          kotOverrides: {
                            ...p.kotOverrides,
                            contrast: {
                              densityPreset: 'custom',
                              threshold: val,
                              inkGain: p.kotOverrides?.contrast?.inkGain ?? DEFAULT_THERMAL_CONTRAST.inkGain,
                              ditheringMode: p.kotOverrides?.contrast?.ditheringMode ?? DEFAULT_THERMAL_CONTRAST.ditheringMode,
                            },
                          },
                        }));
                      }
                    }}
                    className="w-full accent-brand cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>Lighter (80)</span>
                    <span>Standard (140)</span>
                    <span>Darker (220)</span>
                  </div>
                </div>

                {/* Thermal Ink Gain */}
                <div className="space-y-1.5 bg-card p-3 rounded-lg border border-border">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold text-foreground">Thermal Ink Gain / التمدد النقطي</span>
                    <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-foreground font-bold">
                      +{activeResolvedStyle.contrast?.inkGain ?? 0} dot(s)
                    </span>
                  </div>
                  <select
                    value={activeResolvedStyle.contrast?.inkGain ?? 0}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (activeDoc === 'receipt') {
                        updatePrefs((p) => ({
                          ...p,
                          receipt: {
                            ...p.receipt,
                            contrast: {
                              densityPreset: 'custom',
                              threshold: p.receipt.contrast?.threshold ?? DEFAULT_THERMAL_CONTRAST.threshold,
                              inkGain: val,
                              ditheringMode: p.receipt.contrast?.ditheringMode ?? DEFAULT_THERMAL_CONTRAST.ditheringMode,
                            },
                          },
                        }));
                      } else {
                        updatePrefs((p) => ({
                          ...p,
                          kotOverrides: {
                            ...p.kotOverrides,
                            contrast: {
                              densityPreset: 'custom',
                              threshold: p.kotOverrides?.contrast?.threshold ?? DEFAULT_THERMAL_CONTRAST.threshold,
                              inkGain: val,
                              ditheringMode: p.kotOverrides?.contrast?.ditheringMode ?? DEFAULT_THERMAL_CONTRAST.ditheringMode,
                            },
                          },
                        }));
                      }
                    }}
                    className="w-full text-xs p-2 rounded-lg border border-border bg-card text-foreground"
                  >
                    <option value="0">0 dots (Off / قياسي)</option>
                    <option value="1">1 dot (+1 Dot Gain – Recommended / موصى به)</option>
                    <option value="2">2 dots (+2 Dots Gain – Heavy Black / تمدد مضاعف)</option>
                  </select>
                  <p className="text-[10px] text-muted-foreground leading-tight">
                    Horizontally expands thin strokes by physical dots to ensure crisp Arabic details on 203 DPI heads.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* BORDERS & FRAMES SECTION */}
          {(activeDoc === 'receipt' || currentPrefs.kotStyleMode === 'custom') && (
            <div className="space-y-4 pt-4 border-t border-border">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                    <Maximize2 size={16} className="text-brand" />
                    {t('frameSection')}
                  </h3>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Border Style */}
                <div className="space-y-1">
                  <span className="text-xs font-medium text-foreground">{t('borderStyle')}</span>
                  <select
                    value={activeResolvedStyle.frame.borderStyle}
                    onChange={(e) => {
                      const val = e.target.value as BorderStyleType;
                      if (activeDoc === 'receipt') {
                        updatePrefs((p) => ({ ...p, receipt: { ...p.receipt, frame: { ...p.receipt.frame, borderStyle: val } } }));
                      } else {
                        updatePrefs((p) => ({ ...p, kotOverrides: { ...p.kotOverrides, frame: { ...p.kotOverrides?.frame, borderStyle: val } } }));
                      }
                    }}
                    className="w-full text-xs p-2 rounded-lg border border-border bg-card text-foreground"
                  >
                    <option value="none">{t('borderStyleNone')}</option>
                    <option value="solid">{t('borderStyleSolid')}</option>
                    <option value="dashed">{t('borderStyleDashed')}</option>
                    <option value="dotted">{t('borderStyleDotted')}</option>
                    <option value="double">{t('borderStyleDouble')}</option>
                  </select>
                </div>

                {/* Section Divider Style */}
                <div className="space-y-1">
                  <span className="text-xs font-medium text-foreground">{t('dividerStyle')}</span>
                  <select
                    value={activeResolvedStyle.frame.dividerStyle}
                    onChange={(e) => {
                      const val = e.target.value as DividerStyleType;
                      if (activeDoc === 'receipt') {
                        updatePrefs((p) => ({ ...p, receipt: { ...p.receipt, frame: { ...p.receipt.frame, dividerStyle: val } } }));
                      } else {
                        updatePrefs((p) => ({ ...p, kotOverrides: { ...p.kotOverrides, frame: { ...p.kotOverrides?.frame, dividerStyle: val } } }));
                      }
                    }}
                    className="w-full text-xs p-2 rounded-lg border border-border bg-card text-foreground"
                  >
                    <option value="dashed">{t('dividerStyleDashed')}</option>
                    <option value="solid">{t('dividerStyleSolid')}</option>
                    <option value="dotted">{t('dividerStyleDotted')}</option>
                    <option value="none">{t('dividerStyleNone')}</option>
                  </select>
                </div>

                {/* Border Thickness */}
                {activeResolvedStyle.frame.borderStyle !== 'none' && (
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-foreground">{t('borderThickness')}</span>
                    <select
                      value={activeResolvedStyle.frame.borderThickness}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (activeDoc === 'receipt') {
                          updatePrefs((p) => ({ ...p, receipt: { ...p.receipt, frame: { ...p.receipt.frame, borderThickness: val } } }));
                        } else {
                          updatePrefs((p) => ({ ...p, kotOverrides: { ...p.kotOverrides, frame: { ...p.kotOverrides?.frame, borderThickness: val } } }));
                        }
                      }}
                      className="w-full text-xs p-2 rounded-lg border border-border bg-card text-foreground"
                    >
                      <option value="1">1 px (Thin)</option>
                      <option value="2">2 px (Medium)</option>
                      <option value="3">3 px (Thick)</option>
                    </select>
                  </div>
                )}

                {/* Border Padding */}
                {activeResolvedStyle.frame.borderStyle !== 'none' && (
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-foreground">{t('borderPadding')}</span>
                    <select
                      value={activeResolvedStyle.frame.borderPadding}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (activeDoc === 'receipt') {
                          updatePrefs((p) => ({ ...p, receipt: { ...p.receipt, frame: { ...p.receipt.frame, borderPadding: val } } }));
                        } else {
                          updatePrefs((p) => ({ ...p, kotOverrides: { ...p.kotOverrides, frame: { ...p.kotOverrides?.frame, borderPadding: val } } }));
                        }
                      }}
                      className="w-full text-xs p-2 rounded-lg border border-border bg-card text-foreground"
                    >
                      <option value="4">{t('paddingCompact')} (4px)</option>
                      <option value="8">{t('paddingNormal')} (8px)</option>
                      <option value="16">{t('paddingSpacious')} (16px)</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STORE LOGO SECTION */}
          <div className="space-y-3 pt-4 border-t border-border">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <ImageIcon size={16} className="text-muted-foreground" />
                {t('storeLogo')}
              </label>
              {logo && (
                <span className="text-[11px] text-muted-foreground font-mono">
                  {logo.width} × {logo.height} px
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t('storeLogoDesc')}</p>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/png, image/jpeg, image/webp"
              onChange={handleFileUpload}
              className="hidden"
            />

            {/* Logo Preview & Upload button */}
            <div className="flex items-center gap-4">
              {logo ? (
                <div className="relative group border border-border rounded-xl p-2 bg-muted/20 flex items-center justify-center min-w-[120px] h-20">
                  <img
                    src={logo.dataUrl || `/api/settings/receipt-logo/image?v=${encodeURIComponent(logo.updatedAt || logo.sha256 || logo.id)}`}
                    alt="Store Logo"
                    className="max-h-16 max-w-[100px] object-contain"
                  />
                  <button
                    type="button"
                    onClick={handleRemoveLogo}
                    disabled={uploadingLogo}
                    className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground p-1 rounded-full shadow-md opacity-90 hover:opacity-100 transition-opacity"
                    title={t('removeLogo')}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ) : (
                <div className="border border-dashed border-border rounded-xl p-4 flex flex-col items-center justify-center text-center min-w-[120px] h-20 bg-muted/10">
                  <span className="text-[11px] text-muted-foreground">{t('noLogoConfigured')}</span>
                </div>
              )}

              <div className="space-y-2">
                <button
                  type="button"
                  disabled={uploadingLogo}
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3.5 py-2 rounded-xl bg-card hover:bg-muted text-foreground font-medium text-xs flex items-center gap-2 border border-border shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                >
                  <Upload size={14} className={uploadingLogo ? 'animate-bounce' : ''} />
                  <span>{logo ? t('replaceLogo') : t('uploadLogo')}</span>
                </button>

                {/* Print Logo Toggle */}
                <label className="flex items-center gap-2 cursor-pointer text-xs text-foreground">
                  <input
                    type="checkbox"
                    checked={activeResolvedStyle.logo.showLogo}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      if (activeDoc === 'receipt') {
                        updatePrefs((p) => ({ ...p, receipt: { ...p.receipt, logo: { ...p.receipt.logo, showLogo: checked } } }));
                      } else {
                        updatePrefs((p) => ({ ...p, kotOverrides: { ...p.kotOverrides, logo: { ...p.kotOverrides?.logo, showLogo: checked } } }));
                      }
                    }}
                    className="h-3.5 w-3.5 rounded border-border text-brand focus:ring-brand"
                  />
                  <span>{t('showLogoOnReceipt')}</span>
                </label>
              </div>
            </div>
          </div>

          {/* Branded Raster Image Transport Configuration & Focused Diagnostics */}
          <div className="pt-4 border-t border-border space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Printer size={14} className="text-brand" />
                {t('brandedRasterTransport')}
              </label>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {t('brandedRasterTransportHelp')}
              </p>
            </div>

            {/* Target Printer selector & transport dropdown */}
            <div className="bg-muted/30 p-3 rounded-xl border border-border/70 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground font-medium">Target Printer:</span>
                  {hwPrinters && hwPrinters.length > 1 ? (
                    <select
                      value={selectedPrinterId || defaultPrinter?.id || ''}
                      onChange={(e) => setSelectedPrinterId(e.target.value)}
                      className="bg-card text-foreground px-2 py-1 rounded border border-border text-[11px] font-mono"
                    >
                      {hwPrinters.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.connection_type.toUpperCase()}){p.is_default ? ' [Default]' : ''}
                        </option>
                      ))}
                    </select>
                  ) : effectivePrinter ? (
                    <span className="font-mono font-medium text-foreground bg-card px-2 py-0.5 rounded border border-border">
                      {effectivePrinter.name} ({effectivePrinter.connection_type.toUpperCase()})
                    </span>
                  ) : (
                    <span className="text-muted-foreground italic">No printer configured in Settings &gt; Printers</span>
                  )}
                </div>

                {effectivePrinter && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground font-medium">{t('currentTransport')}:</span>
                      <select
                        value={effectivePrinter.branded_raster_transport || 'gs_v_0'}
                        onChange={async (e) => {
                          const newTransport = e.target.value as 'gs_v_0' | 'esc_star_24' | 'auto';
                          try {
                            await api.patch(`/printers/${effectivePrinter.id}/transport`, {
                              branded_raster_transport: newTransport,
                            });
                            effectivePrinter.branded_raster_transport = newTransport;
                            toast.success(t('transportSaved'));
                            setRefreshCount((c) => c + 1);
                          } catch {
                            toast.error(t('actionFailed'));
                          }
                        }}
                        className="bg-card text-foreground px-2.5 py-1 rounded border border-border text-xs font-semibold"
                      >
                        <option value="gs_v_0">{t('brandedRasterTransportGsV0')}</option>
                        <option value="esc_star_24">{t('brandedRasterTransportEscStar')}</option>
                        <option value="auto">{t('brandedRasterTransportAuto')}</option>
                      </select>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{t('brandedRasterTransportStatusNote')}</p>
                  </div>
                )}
              </div>

              {/* Step-by-step diagnostic helper */}
              <div className="text-[11px] bg-card p-3 rounded-lg border border-border text-foreground space-y-1">
                <span className="font-semibold block text-brand">{t('transportHelperTitle')}</span>
                <ol className="list-decimal list-inside space-y-0.5 text-muted-foreground">
                  <li>{t('transportHelperStep1')}</li>
                  <li>{t('transportHelperStep2')}</li>
                  <li>{t('transportHelperStep3')}</li>
                  <li>{t('transportHelperStep4')}</li>
                </ol>
              </div>

              {/* Two focused diagnostic test buttons */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={diagnosticPrinting}
                  onClick={() => handlePrintDiagnostic('gs_v_0')}
                  className="px-3 py-2 rounded-lg bg-card hover:bg-muted text-foreground font-medium text-xs flex items-center gap-1.5 border border-border shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                >
                  <Printer size={13} className={diagnosticPrinting ? 'animate-pulse' : ''} />
                  <span>{t('printGsV0Test')}</span>
                </button>

                <button
                  type="button"
                  disabled={diagnosticPrinting}
                  onClick={() => handlePrintDiagnostic('esc_star_24')}
                  className="px-3 py-2 rounded-lg bg-brand text-white hover:bg-brand/90 font-medium text-xs flex items-center gap-1.5 border border-brand/50 shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                >
                  <Sparkles size={13} className={diagnosticPrinting ? 'animate-pulse' : ''} />
                  <span>{t('printEscStarTest')}</span>
                </button>

                <button
                  type="button"
                  onClick={handlePrintBrowser}
                  className="px-3 py-2 rounded-lg bg-card hover:bg-muted text-muted-foreground font-medium text-xs flex items-center gap-1.5 border border-border shadow-sm transition-all cursor-pointer ms-auto"
                  title="Open system print dialog to preview, print, or save as PDF"
                >
                  <FileDown size={13} />
                  <span>Print / Save as PDF</span>
                </button>
              </div>
            </div>

            {effectivePrinter?.connection_type === 'webusb' && (
              <div className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-lg p-2.5 leading-relaxed">
                💡 <strong>WebUSB Printer Notice:</strong> WebUSB communicates directly with browser sessions (via the POS toolbar Connect button). For desktop test prints, use <strong>Print / Save as PDF</strong> above, or configure a <strong>USB</strong> / <strong>Network</strong> printer in Settings &gt; Printers.
              </div>
            )}

            {/* ADVANCED: LEGACY ESC/POS TEXT COMPATIBILITY */}
            <div className="bg-card rounded-xl border border-border p-4 space-y-3">
              <button
                type="button"
                onClick={() => setShowAdvancedLegacy((prev) => !prev)}
                className="w-full flex items-center justify-between text-left cursor-pointer"
              >
                <div>
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                    <Sliders size={15} className="text-muted-foreground" />
                    Advanced → Legacy ESC/POS Text Compatibility
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Emergency hardware code page fallback for plain unbranded text printing only.
                  </p>
                </div>
                <ChevronDown
                  size={16}
                  className={`text-muted-foreground transition-transform ${showAdvancedLegacy ? 'rotate-180' : ''}`}
                />
              </button>

              {showAdvancedLegacy && (
                <div className="pt-2 border-t border-border space-y-3">
                  {activeResolvedStyle.renderMode === 'branded_raster' ? (
                    <div className="text-[11px] text-muted-foreground bg-muted/40 border border-border rounded-lg p-3 leading-relaxed">
                      ℹ️ <strong>Disabled in Branded Raster Mode:</strong> Legacy code pages (PC864, PC720, WPC1256) are emergency unbranded text fallback choices only. They are inactive while Full-Page Branded Raster is selected because FloCafe renders full Unicode-aware pages with native fonts directly to raster bitmap, without using printer text code pages.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Select the exclusive hardware code page for legacy ESC/POS text printing:
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {[
                          { id: 'default', label: 'Printer Default', desc: 'Standard ASCII / Auto' },
                          { id: 'pc864', label: 'PC864 (Arabic)', desc: 'Standard 8-bit Arabic codepage' },
                          { id: 'pc720', label: 'PC720 (Arabic)', desc: 'MS-DOS Arabic codepage' },
                          { id: 'wpc1256', label: 'WPC1256 (Windows Arabic)', desc: 'Windows-1256 codepage' },
                        ].map((cp) => (
                          <label
                            key={cp.id}
                            className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all ${
                              legacyCodePage === cp.id
                                ? 'border-brand bg-brand/5 text-foreground'
                                : 'border-border hover:bg-muted/30 text-muted-foreground'
                            }`}
                          >
                            <input
                              type="radio"
                              name="legacyCodePage"
                              value={cp.id}
                              checked={legacyCodePage === cp.id}
                              onChange={() => handleSelectLegacyCodePage(cp.id)}
                              className="mt-0.5 text-brand focus:ring-brand"
                            />
                            <div className="text-xs">
                              <div className="font-semibold text-foreground">{cp.label}</div>
                              <div className="text-[10px] text-muted-foreground">{cp.desc}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Live Preview Column (5 cols) */}
        <div className="lg:col-span-5 flex flex-col items-center">
          <div className="w-full flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Eye size={14} className="text-muted-foreground" />
                {t('receiptPreview')}
              </span>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  activeResolvedStyle.renderMode === 'branded_raster'
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30'
                }`}
              >
                {activeResolvedStyle.renderMode === 'branded_raster' ? 'Branded Raster' : 'Legacy Text'}
              </span>
              {activeDoc === 'kot' && currentPrefs.kotStyleMode === 'inherit' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30">
                  Inherited Style
                </span>
              )}
            </div>
            <button
              type="button"
              disabled={previewLoading}
              onClick={() => setRefreshCount((c) => c + 1)}
              className="text-[11px] text-brand hover:underline flex items-center gap-1 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw size={12} className={previewLoading ? 'animate-spin' : ''} />
              {t('refreshPreview')}
            </button>
          </div>

          {/* Script / Language Switcher */}
          <div className="w-full flex items-center justify-between gap-1 p-1 bg-muted/40 rounded-lg mb-2 border border-border text-[11px]">
            <span className="text-muted-foreground px-2 font-medium">{t('previewLanguage')}:</span>
            <div className="flex items-center gap-1">
              {[
                { id: 'ar' as const, label: 'العربية' },
                { id: 'mixed' as const, label: 'Mixed / مشترك' },
                { id: 'en' as const, label: 'English' },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setPreviewScript(s.id)}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all cursor-pointer ${
                    previewScript === s.id
                      ? 'bg-card text-foreground shadow-sm font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* View Mode Switcher */}
          <div className="w-full flex items-center gap-1 p-1 bg-muted/40 rounded-lg mb-3 border border-border">
            <button
              type="button"
              onClick={() => setPreviewViewMode('thermal')}
              className={`flex-1 text-center py-1 px-2 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                previewViewMode === 'thermal'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Thermal View
            </button>
            <button
              type="button"
              onClick={() => setPreviewViewMode('diagnostic')}
              className={`flex-1 text-center py-1 px-2 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                previewViewMode === 'diagnostic'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Diagnostic
            </button>
            <button
              type="button"
              onClick={() => setPreviewViewMode('raster')}
              className={`flex-1 text-center py-1 px-2 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                previewViewMode === 'raster'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Raster Output
            </button>
          </div>

          {/* Authentic Thermal Paper Surface */}
          <div
            ref={receiptPaperRef}
            className="w-full bg-white text-black p-4 rounded-xl border border-gray-300 shadow-md min-h-[440px] flex flex-col justify-start items-stretch overflow-hidden transition-all"
            style={{
              maxWidth: is58mm ? '260px' : '330px',
              fontFamily: activeFontFamilyCss,
            }}
          >
            {previewLoading ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-gray-400 py-20 font-sans">
                <RefreshCw size={24} className="animate-spin text-gray-400" />
                <span className="text-xs">Generating preview...</span>
              </div>
            ) : previewError ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-red-500 py-20 text-center px-4 font-sans">
                <AlertCircle size={24} />
                <span className="text-xs">{previewError}</span>
              </div>
            ) : activeResolvedStyle.renderMode === 'branded_raster' || previewViewMode === 'raster' || (previewViewMode === 'diagnostic' && previewImageUrl) ? (
              /* Canonical Full-Page 1-Bit Rendered Bitmap Preview */
              <div className="w-full flex flex-col items-center font-sans">
                {previewImageUrl ? (
                  <>
                    <img
                      src={previewImageUrl}
                      alt="Canonical Rendered Preview"
                      className="w-full h-auto object-contain border border-gray-200 rounded shadow-xs"
                    />
                    <div className="w-full mt-2 pt-2 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-500 font-mono">
                      <span>{is58mm ? '384 dots' : '576 dots'}</span>
                      {previewPixelHash && (
                        <span className="bg-gray-100 px-1.5 py-0.5 rounded text-[9px] font-mono text-gray-700" title={`SHA-256: ${previewPixelHash}`}>
                          Hash: {previewPixelHash.slice(0, 8)}
                        </span>
                      )}
                      <span>Branded Raster</span>
                    </div>
                  </>
                ) : (
                  <div className="py-16 text-center text-xs text-gray-400">
                    No raster image available
                  </div>
                )}
              </div>
            ) : previewViewMode === 'diagnostic' ? (
              /* Diagnostic View */
              <div className="space-y-2">
                <div className="bg-amber-100 border border-amber-400 text-amber-950 font-bold text-center text-[10px] p-2 rounded leading-tight">
                  FLOCAFE PRINTER DIAGNOSTIC — NOT A SALES RECEIPT
                  <br />
                  اختبار طابعة FloCafe — ليست فاتورة بيع
                </div>

                {activeResolvedStyle.logo.showLogo && logo && (
                  <div className="flex justify-center my-1.5">
                    <img
                      src={logo.dataUrl || `/api/settings/receipt-logo/image?v=${encodeURIComponent(logo.updatedAt || logo.sha256 || logo.id)}`}
                      alt="Store Logo"
                      className="max-h-14 max-w-[160px] object-contain"
                    />
                  </div>
                )}

                <div className="text-center font-bold text-xs text-black">
                  {activeDoc === 'kot' ? (kotData?.station_name || 'Main Kitchen / المطبخ الرئيسي') : (receiptData?.business_name || 'FloCafe Coffee & Bakery')}
                </div>

                <div className="bg-gray-100 p-2 rounded text-[9px] font-mono space-y-0.5 text-gray-800">
                  <div className="flex justify-between">
                    <span>DOCUMENT:</span>
                    <span className="font-bold">{activeDoc.toUpperCase()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>WIDTH:</span>
                    <span>{is58mm ? '384 dots (58mm)' : '576 dots (80mm)'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>FONT:</span>
                    <span className="uppercase">{activeResolvedStyle.typography.fontFamily}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>RENDER:</span>
                    <span>{activeResolvedStyle.renderMode.toUpperCase()}</span>
                  </div>
                </div>

                <div className="border-y border-dashed border-gray-400 my-2 py-1.5 text-[9px] space-y-1">
                  <div className="font-bold text-gray-800 pb-0.5">ALIGNMENT &amp; SCRIPT PROBE:</div>
                  <div className="flex justify-between text-gray-900">
                    <span>قهوة إسبريسو مفردة</span>
                    <span className="font-mono">1 × 12.00</span>
                  </div>
                  <div className="flex justify-between text-gray-900">
                    <span>Caramel Macchiato Large</span>
                    <span className="font-mono">1 × 24.50</span>
                  </div>
                  <div className="flex justify-between text-gray-900">
                    <span>شاي كرك بالحليب / Karak</span>
                    <span className="font-mono">2 × 8.00</span>
                  </div>
                </div>

                <div className="text-center text-[9px] text-gray-500 font-mono py-1">
                  NON-FINANCIAL DOCUMENT · NO CASH DRAWER PULSE
                </div>
              </div>
            ) : activeResolvedStyle.renderMode === 'legacy_text' && sampleText ? (
              /* Honest ESC/POS Legacy Text Mode Preview */
              <div className="font-mono text-[11px] leading-tight text-gray-900 whitespace-pre overflow-x-auto py-2">
                {sampleText}
              </div>
            ) : activeDoc === 'kot' ? (
              /* KITCHEN ORDER TICKET (KOT) THERMAL VIEW */
              <div
                className="space-y-2 transition-all"
                style={{
                  border: activeResolvedStyle.frame.borderStyle !== 'none'
                    ? `${activeResolvedStyle.frame.borderThickness}px ${activeResolvedStyle.frame.borderStyle} #000`
                    : 'none',
                  padding: activeResolvedStyle.frame.borderStyle !== 'none'
                    ? `${activeResolvedStyle.frame.borderPadding}px`
                    : '0px',
                  borderRadius: `${activeResolvedStyle.frame.borderRadius}px`,
                }}
              >
                {/* Logo if enabled */}
                {activeResolvedStyle.logo.showLogo && logo && (
                  <div className="flex justify-center mb-1.5">
                    <img
                      src={logo.dataUrl || `/api/settings/receipt-logo/image?v=${encodeURIComponent(logo.updatedAt || logo.sha256 || logo.id)}`}
                      alt="Store Logo"
                      style={{ maxWidth: `${activeResolvedStyle.logo.maxWidthPercent}%` }}
                      className="max-h-14 object-contain"
                    />
                  </div>
                )}

                {/* Station & Banner Header */}
                <div className="text-center space-y-0.5">
                  <h3
                    className="font-bold text-black tracking-tight"
                    style={{
                      fontSize: activeResolvedStyle.typography.storeNameSize === 'xlarge' ? '18px' : (activeResolvedStyle.typography.storeNameSize === 'large' ? '15px' : '13px'),
                    }}
                  >
                    {kotData?.station_name || (previewScript === 'ar' ? 'المطبخ الرئيسي' : (previewScript === 'en' ? 'Main Kitchen' : 'المطبخ / Main Kitchen'))}
                  </h3>
                  <div className="text-[10px] font-semibold text-gray-700">
                    {previewScript === 'ar' ? 'تذكرة طلب المطبخ' : (previewScript === 'en' ? 'Kitchen Order Ticket' : 'تذكرة طلب المطبخ / Kitchen Ticket')}
                  </div>
                </div>

                <div className={getDividerClass(activeResolvedStyle.frame.dividerStyle)} />

                {/* Metadata */}
                <div
                  className="space-y-0.5 font-mono text-gray-800"
                  style={{
                    fontSize: activeResolvedStyle.typography.headerMetaSize === 'large' ? '12px' : '10px',
                  }}
                >
                  <div className="flex justify-between font-bold">
                    <span>{kotData?.order_number || '#ORD-108'}</span>
                    <span>{kotData?.table_name || (previewScript === 'ar' ? 'طاولة 4' : (previewScript === 'en' ? 'Table 4' : 'طاولة 4 / Table 4'))}</span>
                  </div>
                  <div className="flex justify-between text-gray-600 text-[10px]">
                    <span>{kotData?.timestamp || '12:35 PM'}</span>
                    <span>{kotData?.server_name || (previewScript === 'ar' ? 'سارة' : (previewScript === 'en' ? 'Sara' : 'سارة / Sara'))}</span>
                  </div>
                </div>

                <div className={getDividerClass(activeResolvedStyle.frame.dividerStyle)} />

                {/* KOT Item Lines */}
                <div className="space-y-2 py-0.5">
                  {(kotData?.items || [
                    { name: previewScript === 'ar' ? 'قهوة فلات وايت' : (previewScript === 'en' ? 'Flat White Coffee' : 'قهوة فلات وايت / Flat White'), quantity: 1, unitPrice: 18.0, notes: previewScript === 'ar' ? 'بدون سكر' : (previewScript === 'en' ? 'No sugar' : 'بدون سكر / No sugar') },
                    { name: previewScript === 'ar' ? 'كرواسون زعتر جبن' : (previewScript === 'en' ? 'Zaatar Croissant' : 'كرواسون زعتر / Zaatar Croissant'), quantity: 2, unitPrice: 12.0, notes: previewScript === 'ar' ? 'ساخن جداً' : (previewScript === 'en' ? 'Extra hot' : 'ساخن جداً / Extra hot') },
                    { name: previewScript === 'ar' ? 'كيكة العسل الملكية' : (previewScript === 'en' ? 'Honey Cake' : 'كيكة العسل / Honey Cake'), quantity: 1, unitPrice: 22.0 },
                  ]).map((item, idx) => (
                    <div key={idx} className="space-y-0.5">
                      <div className="flex justify-between items-baseline text-gray-900">
                        <div className="flex items-baseline gap-1.5 flex-1 pe-1">
                          <span className="font-bold text-xs font-mono">{item.quantity}x</span>
                          <span
                            className="font-medium leading-tight"
                            style={{
                              fontSize: activeResolvedStyle.typography.itemNamesSize === 'large' ? '14px' : (activeResolvedStyle.typography.itemNamesSize === 'medium' ? '12px' : '10px'),
                            }}
                          >
                            {item.name}
                          </span>
                        </div>
                        {activeResolvedStyle.operational.showPrices && item.unitPrice !== undefined && (
                          <span className="text-[10px] font-mono text-gray-600 whitespace-nowrap">
                            ({item.unitPrice.toFixed(2)})
                          </span>
                        )}
                      </div>

                      {/* Prominent Notes / Instructions */}
                      {item.notes && (
                        <div
                          className={`ms-5 text-[10px] leading-snug ${
                            activeResolvedStyle.operational.prominentNotes
                              ? 'font-bold bg-gray-100 p-1 rounded border-l-2 border-black text-gray-950'
                              : 'text-gray-600 italic'
                          }`}
                          style={{
                            fontSize: activeResolvedStyle.typography.itemNotesSize === 'large' ? '12px' : (activeResolvedStyle.typography.itemNotesSize === 'medium' ? '10px' : '9px'),
                          }}
                        >
                          {activeResolvedStyle.operational.prominentNotes ? `*** NOTE: ${item.notes} ***` : `>> ${item.notes}`}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Subtotals / Totals if enabled */}
                {activeResolvedStyle.operational.showTotals && (
                  <>
                    <div className={getDividerClass(activeResolvedStyle.frame.dividerStyle)} />
                    <div className="flex justify-between font-bold text-xs text-gray-900 font-mono py-0.5">
                      <span>TOTAL ITEMS: 4</span>
                      <span>SUBTOTAL: 64.00</span>
                    </div>
                  </>
                )}

                <div className={getDividerClass(activeResolvedStyle.frame.dividerStyle)} />

                {/* NON-FINANCIAL Operational Footer */}
                <div className="text-center text-[9px] text-gray-500 font-mono py-1">
                  [ KITCHEN ORDER TICKET · NON-FINANCIAL ]
                </div>
              </div>
            ) : (
              /* CUSTOMER RECEIPT THERMAL VIEW */
              <div
                className="space-y-1.5 transition-all"
                style={{
                  border: activeResolvedStyle.frame.borderStyle !== 'none'
                    ? `${activeResolvedStyle.frame.borderThickness}px ${activeResolvedStyle.frame.borderStyle} #000`
                    : 'none',
                  padding: activeResolvedStyle.frame.borderStyle !== 'none'
                    ? `${activeResolvedStyle.frame.borderPadding}px`
                    : '0px',
                  borderRadius: `${activeResolvedStyle.frame.borderRadius}px`,
                }}
              >
                {/* Store Logo */}
                {activeResolvedStyle.logo.showLogo && logo ? (
                  <div className="flex justify-center mb-1.5">
                    <img
                      src={logo.dataUrl || `/api/settings/receipt-logo/image?v=${encodeURIComponent(logo.updatedAt || logo.sha256 || logo.id)}`}
                      alt="Store Logo"
                      style={{ maxWidth: `${activeResolvedStyle.logo.maxWidthPercent}%` }}
                      className="max-h-16 object-contain"
                    />
                  </div>
                ) : null}

                {/* Business Info */}
                <h3
                  className="font-bold text-center text-black tracking-tight leading-snug"
                  style={{
                    fontSize: activeResolvedStyle.typography.storeNameSize === 'xlarge' ? '18px' : (activeResolvedStyle.typography.storeNameSize === 'large' ? '15px' : '13px'),
                  }}
                >
                  {receiptData?.business_name || 'FloCafe Coffee & Bakery'}
                </h3>
                <p className="text-[10px] text-center text-gray-700 leading-tight">
                  {receiptData?.business_address || (previewScript === 'en' ? 'King Fahd Road, Riyadh' : 'طريق الملك فهد، الرياض')}
                </p>
                <p className="text-[10px] text-center text-gray-700 leading-tight">
                  {previewScript === 'en' ? 'Phone:' : 'هاتف:'} {receiptData?.business_phone || '+966 50 123 4567'}
                </p>
                <p className="text-[10px] text-center text-gray-700 leading-tight font-mono">
                  {previewScript === 'en' ? 'Tax ID:' : 'الرقم الضريبي:'} {receiptData?.tax_registration_number || '300123456700003'}
                </p>

                {/* Banner */}
                <div className="text-center font-bold text-[11px] text-gray-900 border-y border-dashed border-gray-400 py-1 my-2">
                  {previewScript === 'ar' ? 'فاتورة ضريبية مبسطة' : (previewScript === 'en' ? 'Simplified Tax Invoice' : 'فاتورة ضريبية مبسطة / Tax Invoice')}
                </div>

                {/* Metadata */}
                <div
                  className="flex justify-between text-gray-600 font-mono"
                  style={{
                    fontSize: activeResolvedStyle.typography.headerMetaSize === 'large' ? '11px' : '9.5px',
                  }}
                >
                  <span>INV-2026-001</span>
                  <span>#42</span>
                </div>
                <div
                  className="flex justify-between text-gray-600 font-mono"
                  style={{
                    fontSize: activeResolvedStyle.typography.headerMetaSize === 'large' ? '11px' : '9.5px',
                  }}
                >
                  <span>2026-09-28 12:30</span>
                  <span>{previewScript === 'en' ? 'Table 5' : (previewScript === 'ar' ? 'طاولة 5' : 'طاولة 5 / Table 5')}</span>
                </div>

                {/* Table Header */}
                <div className="border-t border-dashed border-gray-400 pt-1 mt-2">
                  <div className="flex justify-between text-[10px] font-bold text-gray-800 pb-1 border-b border-gray-300">
                    <span className="flex-1">{previewScript === 'en' ? 'Item' : (previewScript === 'ar' ? 'الصنف' : 'الصنف / Item')}</span>
                    <span className="text-center w-8">{previewScript === 'en' ? 'Qty' : 'الكمية'}</span>
                    <span className="text-end">{previewScript === 'en' ? 'Price' : 'السعر'}</span>
                  </div>

                  {/* Items */}
                  <div className="divide-y divide-gray-100 py-0.5">
                    {(receiptData?.items || [
                      { name: previewScript === 'en' ? 'Flat White Coffee' : (previewScript === 'ar' ? 'قهوة فلات وايت' : 'قهوة فلات وايت / Flat White'), quantity: 1, price: 18.0 },
                      { name: previewScript === 'en' ? 'Zaatar Croissant' : (previewScript === 'ar' ? 'كرواسون زعتر' : 'كرواسون زعتر / Zaatar Croissant'), quantity: 2, price: 24.0 },
                      { name: previewScript === 'en' ? 'Honey Cake' : (previewScript === 'ar' ? 'كيكة العسل' : 'كيكة العسل / Honey Cake'), quantity: 1, price: 22.0 },
                    ]).map((item, idx) => (
                      <div key={idx} className="flex justify-between text-gray-900 py-1">
                        <span
                          className="flex-1 pe-1 leading-tight"
                          style={{
                            fontSize: activeResolvedStyle.typography.itemNamesSize === 'large' ? '13px' : (activeResolvedStyle.typography.itemNamesSize === 'medium' ? '11px' : '10px'),
                          }}
                        >
                          {item.name}
                        </span>
                        <span className="text-center w-8 font-mono text-[10px]">{item.quantity}</span>
                        <span className="text-end font-mono whitespace-nowrap text-[10px]">
                          {typeof item.price === 'number' ? item.price.toFixed(2) : item.price} {receiptData?.currency || 'SAR'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Totals */}
                <div className="border-t border-dashed border-gray-400 pt-2 mt-2 space-y-0.5 text-[10px]">
                  <div className="flex justify-between text-gray-700">
                    <span>{previewScript === 'en' ? 'Subtotal' : (previewScript === 'ar' ? 'المجموع الفرعي' : 'المجموع الفرعي / Subtotal')}</span>
                    <span className="font-mono">64.00 {receiptData?.currency || 'SAR'}</span>
                  </div>
                  <div className="flex justify-between text-gray-700">
                    <span>{previewScript === 'en' ? 'VAT 15%' : (previewScript === 'ar' ? 'ضريبة القيمة المضافة 15%' : 'ضريبة القيمة المضافة 15% / VAT')}</span>
                    <span className="font-mono">9.60 {receiptData?.currency || 'SAR'}</span>
                  </div>
                  <div
                    className="flex justify-between font-bold text-black pt-1 border-t border-gray-800"
                    style={{
                      fontSize: activeResolvedStyle.typography.totalsSize === 'large' ? '14px' : (activeResolvedStyle.typography.totalsSize === 'medium' ? '12px' : '11px'),
                    }}
                  >
                    <span>{previewScript === 'en' ? 'Total' : (previewScript === 'ar' ? 'الإجمالي' : 'الإجمالي / Total')}</span>
                    <span className="font-mono">73.60 {receiptData?.currency || 'SAR'}</span>
                  </div>
                  <div className="flex justify-between text-gray-700 pt-0.5">
                    <span>{previewScript === 'en' ? 'Payment: Cash' : (previewScript === 'ar' ? 'طريقة الدفع: نقدي' : 'طريقة الدفع: نقدي / Cash')}</span>
                    <span className="font-mono">73.60 {receiptData?.currency || 'SAR'}</span>
                  </div>
                </div>

                {/* Customer Footer */}
                <div
                  className="border-t border-dashed border-gray-400 pt-2 mt-2 text-center text-gray-600 leading-tight"
                  style={{
                    fontSize: activeResolvedStyle.typography.footerSize === 'medium' ? '11px' : '9.5px',
                  }}
                >
                  {previewScript === 'ar'
                    ? 'شكراً لزيارتكم ويسعدنا خدمتكم دائماً'
                    : (previewScript === 'en'
                      ? 'Thank You For Visiting!'
                      : 'شكراً لزيارتكم ويسعدنا خدمتكم دائماً\nThank You For Visiting!')}
                </div>
                <div className="text-center text-[9px] text-gray-400 font-mono pt-1">
                  FloCafe POS · {is58mm ? '58mm' : '80mm'}
                </div>
              </div>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground text-center mt-2 max-w-[300px]">
            {t('receiptPreviewHint')}
          </p>
        </div>
      </div>
    </div>
  );
}
