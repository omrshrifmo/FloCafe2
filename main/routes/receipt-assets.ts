import { Router, Request, Response } from 'express';
import expressRateLimit from 'express-rate-limit';
import { requirePermission } from '../services/authorization';
import { asyncHandler } from '../middleware/async-handler';
import {
  storeReceiptLogo,
  deleteReceiptLogo,
  getActiveReceiptLogo,
  getActiveReceiptLogoData,
} from '../services/receipt-assets';

export const receiptAssetsRouter = Router();

const assetsRateLimit = expressRateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

/** GET /api/settings/receipt-logo: Retrieve metadata of active receipt logo */
receiptAssetsRouter.get(
  '/receipt-logo',
  requirePermission('settings.view'),
  (_req: Request, res: Response) => {
    const logo = getActiveReceiptLogo();
    res.json({ success: true, logo });
  },
);

/** GET /api/settings/receipt-logo/image: Serve raw bytes of active logo */
receiptAssetsRouter.get(
  '/receipt-logo/image',
  (_req: Request, res: Response) => {
    const active = getActiveReceiptLogoData();
    if (!active) {
      res.status(404).json({ error: 'No active receipt logo configured' });
      return;
    }
    res.setHeader('Content-Type', active.metadata.mimeType);
    res.setHeader('ETag', `"${active.metadata.sha256}"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(active.data);
  },
);

/** POST /api/settings/receipt-logo: Upload and set active receipt logo */
receiptAssetsRouter.post(
  '/receipt-logo',
  assetsRateLimit,
  requirePermission('printers.manage'),
  asyncHandler(async (req: Request, res: Response) => {
    let buffer: Buffer | null = null;
    let filename = 'logo.png';

    if (Buffer.isBuffer(req.body)) {
      buffer = req.body;
      const headerName = req.headers['x-filename'];
      if (typeof headerName === 'string') filename = headerName;
    } else if (req.body && typeof req.body === 'object') {
      const dataUri = typeof req.body.image === 'string' ? req.body.image : typeof req.body.data === 'string' ? req.body.data : null;
      if (dataUri) {
        const matches = dataUri.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
        const base64Data = matches ? matches[2] : dataUri;
        buffer = Buffer.from(base64Data, 'base64');
      }
      if (typeof req.body.filename === 'string') {
        filename = req.body.filename;
      }
    }

    if (!buffer || buffer.length === 0) {
      res.status(400).json({ error: 'No image data provided. Provide base64 image or binary body.' });
      return;
    }

    try {
      const metadata = await storeReceiptLogo(buffer, filename);
      res.status(200).json({ success: true, logo: metadata });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Failed to process and store receipt logo' });
    }
  }),
);

/** DELETE /api/settings/receipt-logo: Remove active receipt logo */
receiptAssetsRouter.delete(
  '/receipt-logo',
  assetsRateLimit,
  requirePermission('printers.manage'),
  asyncHandler(async (_req: Request, res: Response) => {
    await deleteReceiptLogo();
    res.json({ success: true });
  }),
);

/** GET /api/settings/receipt-preview: Live preview of receipt under current or requested settings */
receiptAssetsRouter.get(
  '/receipt-preview',
  requirePermission('settings.view'),
  asyncHandler(async (req: Request, res: Response) => {
    const { getDatabase } = require('../db');
    const {
      renderBrandedReceipt,
      computeBrandedGeometry,
      resolveBundledFontList,
      DEFAULT_RASTER_MAX_BAND_HEIGHT,
      DEFAULT_RASTER_WIDTH_80MM,
      DEFAULT_RASTER_WIDTH_58MM,
    } = require('../printers/branded-receipt-renderer');
    const { getActiveReceiptLogoAsset } = require('../services/receipt-assets');
    const {
      parsePrintStylePreferences,
      resolveEffectivePrintStyle,
    } = require('../../shared/print');

    const db = getDatabase();
    const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
    const storeSettings: Record<string, string> = {};
    for (const row of rows) storeSettings[row.key] = row.value;

    const documentType = (req.query.document_type as string) === 'kot' ? 'kot' : 'receipt';
    const paperWidth = (req.query.paper_width as string) || '80mm';
    const is58mm = paperWidth === '58mm';
    const widthDots = is58mm ? DEFAULT_RASTER_WIDTH_58MM : DEFAULT_RASTER_WIDTH_80MM;
    const language = (req.query.language as string) || 'mixed';

    // Parse base preferences from DB or query override
    let stylePrefs = parsePrintStylePreferences(
      req.query.style_preferences
        ? (typeof req.query.style_preferences === 'string' ? req.query.style_preferences : JSON.stringify(req.query.style_preferences))
        : storeSettings.print_style_preferences,
    );

    // Apply query param overrides if passed directly
    if (req.query.render_mode === 'legacy_text' || req.query.render_mode === 'branded_raster') {
      stylePrefs = {
        ...stylePrefs,
        receipt: { ...stylePrefs.receipt, renderMode: req.query.render_mode as any },
      };
    }
    if (req.query.font_family === 'system' || req.query.font_family === 'cairo' || req.query.font_family === 'almarai') {
      stylePrefs = {
        ...stylePrefs,
        receipt: {
          ...stylePrefs.receipt,
          typography: { ...stylePrefs.receipt.typography, fontFamily: req.query.font_family as any },
        },
      };
    }
    if (req.query.kot_mode === 'inherit' || req.query.kot_mode === 'custom') {
      stylePrefs = {
        ...stylePrefs,
        kotStyleMode: req.query.kot_mode,
      };
    }

    const resolvedStyle = resolveEffectivePrintStyle(stylePrefs, documentType, language);
    const activeLogo = getActiveReceiptLogoAsset();
    const currency = storeSettings.currency || 'SAR';
    const businessName = storeSettings.business_name || 'FloCafe Coffee & Bakery';
    const businessAddress = storeSettings.business_address || 'طريق الملك فهد، الرياض';
    const businessPhone = storeSettings.business_phone || '+966 50 123 4567';
    const taxRegNumber = storeSettings.tax_registration_number || '300123456700003';

    // Sample data according to language
    const sampleItems = language === 'ar'
      ? [
          { name: 'قهوة فلات وايت', quantity: 1, price: 18.0, unitPrice: 18.0, notes: 'بدون سكر' },
          { name: 'كرواسون زعتر جبن', quantity: 2, price: 24.0, unitPrice: 12.0, notes: 'ساخن جداً' },
          { name: 'كيكة العسل الملكية', quantity: 1, price: 22.0, unitPrice: 22.0 },
        ]
      : language === 'en'
        ? [
            { name: 'Flat White Coffee', quantity: 1, price: 18.0, unitPrice: 18.0, notes: 'No sugar' },
            { name: 'Zaatar Croissant', quantity: 2, price: 24.0, unitPrice: 12.0, notes: 'Extra hot' },
            { name: 'Honey Cake', quantity: 1, price: 22.0, unitPrice: 22.0 },
          ]
        : [
            { name: 'قهوة فلات وايت / Flat White', quantity: 1, price: 18.0, unitPrice: 18.0, notes: 'بدون سكر / No sugar' },
            { name: 'كرواسون زعتر / Zaatar Croissant', quantity: 2, price: 24.0, unitPrice: 12.0, notes: 'ساخن جداً / Extra hot' },
            { name: 'كيكة العسل / Honey Cake', quantity: 1, price: 22.0, unitPrice: 22.0 },
          ];

    if (documentType === 'kot') {
      const dividerChar = resolvedStyle.frame.dividerStyle === 'solid'
        ? '='
        : resolvedStyle.frame.dividerStyle === 'dotted'
          ? '. '
          : '- ';
      const dividerLine = resolvedStyle.frame.dividerStyle === 'none'
        ? ''
        : dividerChar.repeat(Math.ceil((is58mm ? 32 : 48) / dividerChar.length)).slice(0, is58mm ? 32 : 48);

      const kotDataPayload = {
        station_name: language === 'ar' ? 'المطبخ الرئيسي' : (language === 'en' ? 'Main Kitchen' : 'المطبخ / Main Kitchen'),
        order_number: '#ORD-108',
        table_name: language === 'ar' ? 'طاولة 4' : (language === 'en' ? 'Table 4' : 'طاولة 4 / Table 4'),
        server_name: language === 'ar' ? 'سارة' : (language === 'en' ? 'Sara' : 'سارة / Sara'),
        timestamp: '12:35 PM',
        items: sampleItems,
        show_prices: resolvedStyle.operational.showPrices,
        show_totals: resolvedStyle.operational.showTotals,
        header_compact: resolvedStyle.operational.headerCompact,
        prominent_notes: resolvedStyle.operational.prominentNotes,
      };

      if (resolvedStyle.renderMode === 'legacy_text') {
        const textLines: string[] = [];
        if (dividerLine) textLines.push(dividerLine);
        textLines.push(`        *** ${kotDataPayload.station_name} ***        `);
        textLines.push(`Order: ${kotDataPayload.order_number}   ${kotDataPayload.table_name}`);
        textLines.push(`Time: ${kotDataPayload.timestamp}   Server: ${kotDataPayload.server_name}`);
        if (dividerLine) textLines.push(dividerLine);
        for (const item of sampleItems) {
          const pricePart = resolvedStyle.operational.showPrices ? ` (${item.unitPrice.toFixed(2)})` : '';
          textLines.push(`${item.quantity}x  ${item.name}${pricePart}`);
          if (item.notes) {
            if (resolvedStyle.operational.prominentNotes) {
              textLines.push(`  *** NOTE: ${item.notes} ***`);
            } else {
              textLines.push(`  >> ${item.notes}`);
            }
          }
        }
        if (resolvedStyle.operational.showTotals) {
          if (dividerLine) textLines.push(dividerLine);
          textLines.push('TOTAL ITEMS: 4  |  SUBTOTAL: 64.00');
        }
        if (dividerLine) textLines.push(dividerLine);
        textLines.push('  [ KITCHEN ORDER TICKET · NON-FINANCIAL ]  ');

        res.json({
          success: true,
          document_type: 'kot',
          render_mode: 'legacy_text',
          resolved_style: resolvedStyle,
          width_dots: widthDots,
          sample_text: textLines.join('\n'),
          kot_data: kotDataPayload,
        });
        return;
      }

      // KOT in Branded Raster mode
      const geometry = computeBrandedGeometry({
        widthDots,
        borderThicknessDots: resolvedStyle.frame.borderStyle !== 'none' ? resolvedStyle.frame.borderThickness : 0,
        borderInsetDots: resolvedStyle.frame.borderPadding,
      });
      const bundledFonts = resolveBundledFontList(resolvedStyle.typography.fontFamily);

      let logoPayload: { dataUrl: string; width: number; height: number } | undefined;
      if (resolvedStyle.logo.showLogo && activeLogo && activeLogo.data.length > 0) {
        logoPayload = {
          dataUrl: `data:${activeLogo.mimeType};base64,${activeLogo.data.toString('base64')}`,
          width: activeLogo.width,
          height: activeLogo.height,
        };
      }

      const kotRasterItems = sampleItems.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        price: resolvedStyle.operational.showPrices ? item.price : 0,
        unitPrice: resolvedStyle.operational.showPrices ? item.unitPrice : undefined,
        notes: item.notes,
      }));

      const kotTotals = resolvedStyle.operational.showTotals
        ? [{ label: 'Items Subtotal / مجموع الأصناف', value: `64.00 ${currency}`, isBold: true }]
        : [];

      const kotRequest = {
        version: 1 as const,
        kind: 'branded-kot' as const,
        requestId: `preview-kot-${Date.now()}`,
        widthDots,
        maxBandHeight: DEFAULT_RASTER_MAX_BAND_HEIGHT,
        fontFamily: resolvedStyle.typography.fontFamily,
        style: resolvedStyle,
        bundledFonts: bundledFonts.length > 0 ? bundledFonts : undefined,
        logo: logoPayload,
        geometry,
        ditheringMode: 'threshold' as const,
        threshold: 128,
        header: {
          businessName: kotDataPayload.station_name,
          banner: 'تذكرة طلب المطبخ / Kitchen Order Ticket',
        },
        meta: {
          orderNumber: kotDataPayload.order_number,
          tableName: kotDataPayload.table_name,
          timestamp: `Time: ${kotDataPayload.timestamp} | Server: ${kotDataPayload.server_name}`,
        },
        items: kotRasterItems,
        totals: kotTotals,
        footer: {
          footerNote: 'تذكرة تشغيلية فقط — ليست مطالبة مالية أو فاتورة بيع\nOperational Ticket · Non-Financial',
        },
      };

      const brandedOutput = await renderBrandedReceipt(kotRequest);
      if (!brandedOutput.ok) {
        res.status(500).json({ error: brandedOutput.error || 'Failed to render KOT raster' });
        return;
      }

      res.json({
        success: true,
        document_type: 'kot',
        render_mode: 'branded_raster',
        resolved_style: resolvedStyle,
        width_dots: brandedOutput.dimensions.widthDots,
        height_dots: brandedOutput.dimensions.heightDots,
        preview_image_url: brandedOutput.previewDataUrl,
        kot_data: kotDataPayload,
      });
      return;
    }

    // Target is Receipt
    const sampleTotalRows = [
      { label: 'المجموع الفرعي / Subtotal', value: `64.00 ${currency}` },
      { label: 'ضريبة القيمة المضافة (15%) / VAT', value: `9.60 ${currency}` },
      { label: 'الإجمالي / Total', value: `73.60 ${currency}`, isBold: true, isLarge: true },
      { label: 'المدفوع نقداً / Cash Paid', value: `73.60 ${currency}` },
    ];

    const receiptDataPayload = {
      business_name: businessName,
      business_address: businessAddress,
      business_phone: businessPhone,
      tax_registration_number: taxRegNumber,
      currency,
      logo_url: resolvedStyle.logo.showLogo && activeLogo ? `/api/settings/receipt-logo/image?v=${encodeURIComponent(activeLogo.sha256)}` : null,
      items: sampleItems,
      totals: sampleTotalRows,
    };

    if (resolvedStyle.renderMode === 'legacy_text') {
      const dividerChar = resolvedStyle.frame.dividerStyle === 'solid' ? '=' : (resolvedStyle.frame.dividerStyle === 'dotted' ? '. ' : '- ');
      const dividerLine = resolvedStyle.frame.dividerStyle === 'none' ? '' : dividerChar.repeat(Math.ceil((is58mm ? 32 : 48) / dividerChar.length)).slice(0, is58mm ? 32 : 48);

      const sampleText = [
        dividerLine,
        `        ${businessName}        `,
        `      ${businessAddress}       `,
        `      هاتف: ${businessPhone}   `,
        `     الرقم الضريبي: ${taxRegNumber} `,
        dividerLine,
        'فاتورة ضريبية مبسطة / Tax Invoice',
        `التاريخ: ${new Date().toLocaleDateString('ar-SA')} 12:30`,
        'رقم الفاتورة: #INV-2026-001',
        dividerLine,
        'الصنف            الكمية    السعر',
        dividerLine,
        'قهوة فلات وايت      1     18.00',
        'كرواسون زعتر        2     24.00',
        'كيكة العسل          1     22.00',
        dividerLine,
        'المجموع الفرعي:           64.00',
        'ضريبة القيمة المضافة 15%:  9.60',
        'الإجمالي شامل الضريبة:    73.60',
        'طريقة الدفع: نقدي         73.60',
        dividerLine,
        '     شكراً لزيارتكم ويسعدنا خدمتكم    ',
        '       Thank You For Visiting!  ',
        dividerLine,
      ].filter(Boolean).join('\n');

      res.json({
        success: true,
        document_type: 'receipt',
        render_mode: 'legacy_text',
        resolved_style: resolvedStyle,
        width_dots: widthDots,
        sample_text: sampleText,
        receipt_data: receiptDataPayload,
      });
      return;
    }

    const geometry = computeBrandedGeometry({
      widthDots,
      borderThicknessDots: resolvedStyle.frame.borderStyle !== 'none' ? resolvedStyle.frame.borderThickness : 0,
      borderInsetDots: resolvedStyle.frame.borderPadding,
    });
    const bundledFonts = resolveBundledFontList(resolvedStyle.typography.fontFamily);

    let logoPayload: { dataUrl: string; width: number; height: number } | undefined;
    if (resolvedStyle.logo.showLogo && activeLogo && activeLogo.data.length > 0) {
      logoPayload = {
        dataUrl: `data:${activeLogo.mimeType};base64,${activeLogo.data.toString('base64')}`,
        width: activeLogo.width,
        height: activeLogo.height,
      };
    }

    const receiptRequest = {
      version: 1 as const,
      kind: 'branded-receipt' as const,
      requestId: `preview-${Date.now()}`,
      widthDots,
      maxBandHeight: DEFAULT_RASTER_MAX_BAND_HEIGHT,
      fontFamily: resolvedStyle.typography.fontFamily,
      style: resolvedStyle,
      bundledFonts: bundledFonts.length > 0 ? bundledFonts : undefined,
      logo: logoPayload,
      geometry,
      ditheringMode: 'threshold' as const,
      threshold: 128,
      header: {
        businessName,
        address: businessAddress,
        phone: businessPhone,
        taxId: taxRegNumber,
        banner: 'فاتورة ضريبية مبسطة / Tax Invoice',
      },
      meta: {
        invoiceNumber: 'INV-2026-001',
        orderNumber: '#42',
        timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
        tableName: 'طاولة / Table 5',
      },
      items: sampleItems,
      totals: sampleTotalRows,
      footer: {
        footerNote: 'شكراً لزيارتكم ويسعدنا خدمتكم دائماً\nThank you for your visit!',
        thankYou: `Width: ${widthDots} dots | FloCafe Branded Receipt`,
      },
    };

    const brandedOutput = await renderBrandedReceipt(receiptRequest);
    if (!brandedOutput.ok) {
      res.status(500).json({ error: brandedOutput.error || 'Failed to render receipt' });
      return;
    }

    res.json({
      success: true,
      document_type: 'receipt',
      render_mode: 'branded_raster',
      resolved_style: resolvedStyle,
      font_family: resolvedStyle.typography.fontFamily,
      width_dots: brandedOutput.dimensions.widthDots,
      height_dots: brandedOutput.dimensions.heightDots,
      preview_image_url: brandedOutput.previewDataUrl,
      receipt_data: receiptDataPayload,
    });
  }),
);

