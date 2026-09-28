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
} from 'lucide-react';
import { useTranslations } from 'use-intl';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import type { PrintingForm, HwPrinter } from './PrintersSettingsTab';

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

  const [logo, setLogo] = useState<ReceiptLogoMetadata | null>(null);
  const [loadingLogo, setLoadingLogo] = useState<boolean>(true);
  const [uploadingLogo, setUploadingLogo] = useState<boolean>(false);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [receiptData, setReceiptData] = useState<ReceiptPreviewData | null>(null);
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
  const activeFontFamilyCss =
    printingForm.receiptBrandedFontFamily === 'cairo'
      ? "'Cairo', 'Segoe UI', Tahoma, sans-serif"
      : printingForm.receiptBrandedFontFamily === 'system'
        ? "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
        : "'Almarai', 'Segoe UI', Tahoma, sans-serif";

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
    <title>Receipt Preview</title>
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

  const handlePrintDiagnostic = async () => {
    if (effectivePrinter?.connection_type === 'webusb') {
      toast.error(
        'WebUSB printers are managed in the browser (via POS toolbar). For desktop print tests, click "Print / Save as PDF" or configure a USB or Network printer in Settings > Printers.',
        { duration: 7000 }
      );
      return;
    }

    try {
      setDiagnosticPrinting(true);
      const res = await api.post('/printers/diagnostic-branded', {
        printer_id: effectivePrinter?.id,
        font_family: printingForm.receiptBrandedFontFamily || 'almarai',
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

  // Load active logo metadata on mount
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
    }, 0);

    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, []);

  // Fetch live preview whenever font family, paper width, or logo changes
  useEffect(() => {
    let ignore = false;
    const timer = setTimeout(async () => {
      try {
        setPreviewLoading(true);
        setPreviewError(null);
        const res = await api.get('/settings/receipt-preview', {
          params: {
            render_mode: 'branded_raster',
            font_family: printingForm.receiptBrandedFontFamily || 'almarai',
            paper_width: printingForm.printerPaperSize === 'thermal58' ? '58mm' : '80mm',
          },
        });

        if (ignore) return;
        if (res.data?.success) {
          if (res.data.preview_image_url) {
            setPreviewImageUrl(res.data.preview_image_url);
          }
          if (res.data.receipt_data) {
            setReceiptData(res.data.receipt_data);
          }
        } else {
          setPreviewError('Failed to generate preview');
        }
      } catch (err: unknown) {
        if (ignore) return;
        const e = err as { response?: { data?: { error?: string } }; message?: string };
        setPreviewError(e?.response?.data?.error || e?.message || 'Error generating receipt preview');
      } finally {
        if (!ignore) {
          setPreviewLoading(false);
        }
      }
    }, 0);

    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [
    printingForm.receiptBrandedFontFamily,
    printingForm.printerPaperSize,
    logo,
    refreshCount,
  ]);

  // Handle Logo Upload
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

  // Handle Logo Deletion
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

  return (
    <div className="bg-card rounded-xl border border-border p-6 space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles size={20} className="text-brand" />
            <h2 className="font-semibold text-foreground text-base">{t('receiptBranding')}</h2>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{t('receiptBrandingDesc')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Controls Column (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Logo Management */}
          <div className="space-y-3">
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

            {loadingLogo ? (
              <div className="p-4 border border-border rounded-xl text-center text-xs text-muted-foreground animate-pulse">
                Loading logo...
              </div>
            ) : logo ? (
              <div className="p-4 border border-border rounded-xl bg-muted/20 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-16 h-16 rounded-lg border border-border bg-white dark:bg-card flex items-center justify-center overflow-hidden p-1">
                    <img
                      src={logo.dataUrl || `/api/settings/receipt-logo/image?v=${encodeURIComponent(logo.updatedAt || logo.sha256 || logo.id)}`}
                      alt="Store Logo"
                      className="max-w-full max-h-full object-contain"
                      onError={(e) => {
                        if (logo.dataUrl) {
                          (e.target as HTMLImageElement).src = logo.dataUrl;
                        }
                      }}
                    />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground truncate max-w-[200px]">{logo.filename}</p>
                    <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                      {logo.mimeType} · {logo.width}×{logo.height}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={uploadingLogo}
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1.5 rounded-lg border border-border hover:bg-muted text-xs font-medium text-foreground transition-colors disabled:opacity-50"
                  >
                    {t('replaceLogo')}
                  </button>
                  <button
                    type="button"
                    disabled={uploadingLogo}
                    onClick={handleRemoveLogo}
                    className="p-1.5 rounded-lg border border-red-200 dark:border-red-900/50 hover:bg-red-50 dark:hover:bg-red-950/30 text-red-600 dark:text-red-400 transition-colors disabled:opacity-50"
                    title={t('removeLogo')}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={uploadingLogo}
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-border hover:border-brand/50 hover:bg-muted/20 rounded-xl p-6 flex flex-col items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
              >
                <div className="w-10 h-10 rounded-full bg-brand/10 text-brand flex items-center justify-center">
                  <Upload size={18} />
                </div>
                <div className="text-center">
                  <span className="text-xs font-medium text-foreground">{t('uploadLogo')}</span>
                  <p className="text-[11px] text-muted-foreground mt-0.5">PNG, JPEG, WebP · Max 2 MB</p>
                </div>
              </button>
            )}
          </div>

          {/* Render Mode Selection */}
          <div className="space-y-3 pt-4 border-t border-border">
            <label className="text-sm font-semibold text-foreground block">{t('receiptRenderMode')}</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  markHydrationTouched('receiptRenderMode');
                  setPrintingForm((p) => ({ ...p, receiptRenderMode: 'legacy_text' }));
                }}
                className={`p-3 rounded-xl border text-start transition-all ${
                  printingForm.receiptRenderMode === 'legacy_text'
                    ? 'border-brand bg-brand/10 font-semibold text-foreground shadow-sm'
                    : 'border-border hover:bg-muted/30 text-muted-foreground'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">{t('renderModeLegacyText')}</span>
                  {printingForm.receiptRenderMode === 'legacy_text' && (
                    <span className="text-[10px] bg-brand text-white px-1.5 py-0.5 rounded font-mono">
                      Default
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                  {t('renderModeLegacyTextDesc')}
                </p>
              </button>

              <button
                type="button"
                onClick={() => {
                  markHydrationTouched('receiptRenderMode');
                  setPrintingForm((p) => ({ ...p, receiptRenderMode: 'branded_raster' }));
                }}
                className={`p-3 rounded-xl border text-start transition-all ${
                  printingForm.receiptRenderMode === 'branded_raster'
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
          </div>

          {/* Font Family Selection */}
          <div className="space-y-3 pt-4 border-t border-border">
            <label className="text-sm font-semibold text-foreground block">{t('brandedFontFamily')}</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {[
                { id: 'almarai', label: t('fontFamilyAlmarai'), sample: 'المراعي ١٢٣', font: "'Almarai', sans-serif" },
                { id: 'cairo', label: t('fontFamilyCairo'), sample: 'القاهرة ١٢٣', font: "'Cairo', sans-serif" },
                { id: 'system', label: t('fontFamilySystem'), sample: 'System 123', font: 'system-ui, sans-serif' },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    markHydrationTouched('receiptBrandedFontFamily');
                    setPrintingForm((p) => ({
                      ...p,
                      receiptBrandedFontFamily: f.id as 'system' | 'cairo' | 'almarai',
                    }));
                  }}
                  className={`p-2.5 rounded-xl border text-start transition-all ${
                    printingForm.receiptBrandedFontFamily === f.id
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

          {/* Diagnostic Test Print Action */}
          <div className="pt-4 border-t border-border space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-0.5">
                <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Printer size={14} className="text-brand" />
                  {t('printBrandedDiagnostic')}
                </label>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {t('printBrandedDiagnosticDesc')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={handlePrintBrowser}
                  className="px-3.5 py-2 rounded-xl bg-card hover:bg-muted text-foreground font-medium text-xs flex items-center gap-2 border border-border shadow-sm transition-all whitespace-nowrap cursor-pointer"
                  title="Open system print dialog to preview, print, or save as PDF"
                >
                  <FileDown size={14} className="text-muted-foreground" />
                  <span>Print / Save as PDF</span>
                </button>
                <button
                  type="button"
                  disabled={diagnosticPrinting}
                  onClick={handlePrintDiagnostic}
                  className="px-3.5 py-2 rounded-xl bg-secondary hover:bg-secondary/80 text-foreground font-medium text-xs flex items-center gap-2 border border-border shadow-sm transition-all disabled:opacity-50 whitespace-nowrap cursor-pointer"
                >
                  <Printer size={14} className={diagnosticPrinting ? 'animate-pulse' : ''} />
                  <span>{diagnosticPrinting ? t('printBrandedDiagnosticPrinting') : t('printBrandedDiagnostic')}</span>
                </button>
              </div>
            </div>

            {/* Target Printer selector / info badge */}
            <div className="flex flex-wrap items-center gap-2 text-[11px] bg-muted/30 p-2.5 rounded-lg border border-border/60">
              <span className="text-muted-foreground font-medium">Target Printer:</span>
              {hwPrinters && hwPrinters.length > 1 ? (
                <select
                  value={selectedPrinterId || defaultPrinter?.id || ''}
                  onChange={(e) => setSelectedPrinterId(e.target.value)}
                  className="bg-card text-foreground px-2 py-0.5 rounded border border-border text-[11px] font-mono"
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

            {effectivePrinter?.connection_type === 'webusb' && (
              <div className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-lg p-2.5 leading-relaxed">
                💡 <strong>WebUSB Printer Notice:</strong> WebUSB communicates directly with browser sessions (via the POS toolbar Connect button). For desktop test prints, use <strong>Print / Save as PDF</strong> above, or configure a <strong>USB</strong> / <strong>Network</strong> printer in Settings &gt; Printers.
              </div>
            )}
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
                  printingForm.receiptRenderMode === 'branded_raster'
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30'
                }`}
              >
                {printingForm.receiptRenderMode === 'branded_raster' ? 'Branded Raster' : 'Legacy Text'}
              </span>
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
              {t('receiptPreview') || 'Thermal View'}
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
              {t('printBrandedDiagnostic') || 'Diagnostic'}
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

          {/* Authentic Receipt Surface */}
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
                <span className="text-xs">Generating receipt preview...</span>
              </div>
            ) : previewError ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-red-500 py-20 text-center px-4 font-sans">
                <AlertCircle size={24} />
                <span className="text-xs">{previewError}</span>
              </div>
            ) : previewViewMode === 'raster' ? (
              <div className="w-full flex flex-col items-center font-sans">
                {previewImageUrl ? (
                  <>
                    <img
                      src={previewImageUrl}
                      alt="Raster Preview"
                      className="w-full h-auto object-contain border border-gray-200 rounded"
                    />
                    <p className="text-[10px] text-gray-500 text-center mt-2 font-mono">
                      1-bit monochrome ESC/POS raster output
                    </p>
                  </>
                ) : (
                  <div className="py-16 text-center text-xs text-gray-400">
                    No raster image available
                  </div>
                )}
              </div>
            ) : previewViewMode === 'diagnostic' ? (
              /* Diagnostic Receipt View */
              <div className="space-y-2">
                <div className="bg-amber-100 border border-amber-400 text-amber-950 font-bold text-center text-[10px] p-2 rounded leading-tight">
                  FLOCAFE PRINTER DIAGNOSTIC — NOT A SALES RECEIPT
                  <br />
                  اختبار طابعة FloCafe — ليست فاتورة بيع
                </div>

                {logo && (
                  <div className="flex justify-center my-1.5">
                    <img
                      src={logo.dataUrl || `/api/settings/receipt-logo/image?v=${encodeURIComponent(logo.updatedAt || logo.sha256 || logo.id)}`}
                      alt="Store Logo"
                      className="max-h-14 max-w-[160px] object-contain"
                    />
                  </div>
                )}

                <div className="text-center font-bold text-xs text-black">
                  {receiptData?.business_name || 'FloCafe Coffee & Bakery'}
                </div>

                <div className="bg-gray-100 p-2 rounded text-[9px] font-mono space-y-0.5 text-gray-800">
                  <div className="flex justify-between">
                    <span>ORDER:</span>
                    <span className="font-bold">DIAG-RASTER-PROBE</span>
                  </div>
                  <div className="flex justify-between">
                    <span>WIDTH:</span>
                    <span>{is58mm ? '384 dots (58mm)' : '576 dots (80mm)'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>FONT:</span>
                    <span className="uppercase">{printingForm.receiptBrandedFontFamily}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>RENDER:</span>
                    <span>BRANDED_RASTER</span>
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
                  <div className="flex justify-between text-gray-900">
                    <span>Croissant au Beurre (Français)</span>
                    <span className="font-mono">1 × 16.00</span>
                  </div>
                  <div className="flex justify-between text-gray-900">
                    <span>عصير برتقال 100% Fresh</span>
                    <span className="font-mono">1 × 18.00</span>
                  </div>
                </div>

                <div className="text-center text-[9px] text-gray-500 font-mono py-1">
                  NON-FINANCIAL DOCUMENT · NO CASH DRAWER PULSE
                </div>
                <div className="text-center text-[9px] font-bold text-gray-700">
                  اختبار جودة الطباعة والخطوط واللغات
                </div>
              </div>
            ) : (
              /* Thermal Customer Receipt View */
              <div className="space-y-1.5">
                {/* Store Logo */}
                {logo ? (
                  <div className="flex justify-center mb-2">
                    <img
                      src={logo.dataUrl || `/api/settings/receipt-logo/image?v=${encodeURIComponent(logo.updatedAt || logo.sha256 || logo.id)}`}
                      alt="Store Logo"
                      className="max-h-16 max-w-[180px] object-contain"
                    />
                  </div>
                ) : (
                  <div className="border border-dashed border-gray-300 rounded p-2 text-center text-[10px] text-gray-400 mb-2 font-sans">
                    + No store logo uploaded
                  </div>
                )}

                {/* Business Info */}
                <h3 className="font-bold text-center text-sm text-black tracking-tight leading-snug">
                  {receiptData?.business_name || 'FloCafe Coffee & Bakery'}
                </h3>
                <p className="text-[10px] text-center text-gray-700 leading-tight">
                  {receiptData?.business_address || 'طريق الملك فهد، الرياض'}
                </p>
                <p className="text-[10px] text-center text-gray-700 leading-tight">
                  هاتف: {receiptData?.business_phone || '+966 50 123 4567'}
                </p>
                <p className="text-[10px] text-center text-gray-700 leading-tight font-mono">
                  الرقم الضريبي: {receiptData?.tax_registration_number || '300123456700003'}
                </p>

                {/* Banner */}
                <div className="text-center font-bold text-[11px] text-gray-900 border-y border-dashed border-gray-400 py-1 my-2">
                  فاتورة ضريبية مبسطة / Tax Invoice
                </div>

                {/* Metadata */}
                <div className="flex justify-between text-[10px] text-gray-600 font-mono">
                  <span>INV-2026-001</span>
                  <span>#42</span>
                </div>
                <div className="flex justify-between text-[10px] text-gray-600 font-mono">
                  <span>2026-09-28 12:30</span>
                  <span>طاولة 5 / Table 5</span>
                </div>

                {/* Table Header */}
                <div className="border-t border-dashed border-gray-400 pt-1 mt-2">
                  <div className="flex justify-between text-[10px] font-bold text-gray-800 pb-1 border-b border-gray-300">
                    <span className="flex-1">الصنف / Item</span>
                    <span className="text-center w-8">الكمية</span>
                    <span className="text-end">السعر</span>
                  </div>

                  {/* Items */}
                  <div className="divide-y divide-gray-100 py-0.5">
                    {(receiptData?.items || [
                      { name: 'قهوة فلات وايت / Flat White', quantity: 1, price: 18.0 },
                      { name: 'كرواسون زعتر / Zaatar Croissant', quantity: 2, price: 24.0 },
                      { name: 'كيكة العسل / Honey Cake', quantity: 1, price: 22.0 },
                    ]).map((item, idx) => (
                      <div key={idx} className="flex justify-between text-[10px] text-gray-900 py-1">
                        <span className="flex-1 pe-1 leading-tight">{item.name}</span>
                        <span className="text-center w-8 font-mono">{item.quantity}</span>
                        <span className="text-end font-mono whitespace-nowrap">
                          {typeof item.price === 'number' ? item.price.toFixed(2) : item.price} {receiptData?.currency || 'SAR'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Totals */}
                <div className="border-t border-dashed border-gray-400 pt-2 mt-2 space-y-0.5 text-[10px]">
                  <div className="flex justify-between text-gray-700">
                    <span>المجموع الفرعي / Subtotal</span>
                    <span className="font-mono">64.00 {receiptData?.currency || 'SAR'}</span>
                  </div>
                  <div className="flex justify-between text-gray-700">
                    <span>ضريبة القيمة المضافة 15% / VAT</span>
                    <span className="font-mono">9.60 {receiptData?.currency || 'SAR'}</span>
                  </div>
                  <div className="flex justify-between font-bold text-xs text-black pt-1 border-t border-gray-800">
                    <span>الإجمالي / Total</span>
                    <span className="font-mono">73.60 {receiptData?.currency || 'SAR'}</span>
                  </div>
                  <div className="flex justify-between text-gray-700 pt-0.5">
                    <span>طريقة الدفع: نقدي / Cash</span>
                    <span className="font-mono">73.60 {receiptData?.currency || 'SAR'}</span>
                  </div>
                </div>

                {/* Footer */}
                <div className="border-t border-dashed border-gray-400 pt-2 mt-2 text-center text-[10px] text-gray-600 leading-tight">
                  شكراً لزيارتكم ويسعدنا خدمتكم دائماً
                  <br />
                  Thank You For Visiting!
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
