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

    const db = getDatabase();
    const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
    const storeSettings: Record<string, string> = {};
    for (const row of rows) storeSettings[row.key] = row.value;

    const renderMode = (req.query.render_mode as string) || storeSettings.receipt_render_mode || 'legacy_text';
    const fontFamily = (req.query.font_family as string) || storeSettings.receipt_branded_font_family || 'almarai';
    const paperWidth = (req.query.paper_width as string) || '80mm';
    const widthDots = paperWidth === '58mm' ? DEFAULT_RASTER_WIDTH_58MM : DEFAULT_RASTER_WIDTH_80MM;

    const activeLogo = getActiveReceiptLogoAsset();
    const currency = storeSettings.currency || 'SAR';
    const businessName = storeSettings.business_name || 'FloCafe Coffee & Bakery';
    const businessAddress = storeSettings.business_address || 'طريق الملك فهد، الرياض';
    const businessPhone = storeSettings.business_phone || '+966 50 123 4567';
    const taxRegNumber = storeSettings.tax_registration_number || '300123456700003';

    const sampleItems = [
      { name: 'قهوة فلات وايت / Flat White', quantity: 1, price: 18.0, unitPrice: 18.0 },
      { name: 'كرواسون زعتر / Zaatar Croissant', quantity: 2, price: 24.0, unitPrice: 12.0 },
      { name: 'كيكة العسل / Honey Cake', quantity: 1, price: 22.0, unitPrice: 22.0 },
    ];

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
      logo_url: activeLogo ? `/api/settings/receipt-logo/image?v=${encodeURIComponent(activeLogo.sha256)}` : null,
      items: sampleItems,
      totals: sampleTotalRows,
    };

    if (renderMode === 'legacy_text') {
      const sampleText = [
        '================================',
        `        ${businessName}        `,
        `      ${businessAddress}       `,
        `      هاتف: ${businessPhone}   `,
        `     الرقم الضريبي: ${taxRegNumber} `,
        '--------------------------------',
        'فاتورة ضريبية مبسطة / Tax Invoice',
        `التاريخ: ${new Date().toLocaleDateString('ar-SA')} 12:30`,
        'رقم الفاتورة: #INV-2026-001',
        '--------------------------------',
        'الصنف            الكمية    السعر',
        '--------------------------------',
        'قهوة فلات وايت      1     18.00',
        'كرواسون زعتر        2     24.00',
        'كيكة العسل          1     22.00',
        '--------------------------------',
        'المجموع الفرعي:           64.00',
        'ضريبة القيمة المضافة 15%:  9.60',
        'الإجمالي شامل الضريبة:    73.60',
        'طريقة الدفع: نقدي         73.60',
        '================================',
        '     شكراً لزيارتكم ويسعدنا خدمتكم    ',
        '       Thank You For Visiting!  ',
        '================================',
      ].join('\n');

      res.json({
        success: true,
        render_mode: 'legacy_text',
        font_family: fontFamily,
        width_dots: widthDots,
        sample_text: sampleText,
        receipt_data: receiptDataPayload,
      });
      return;
    }

    const geometry = computeBrandedGeometry({ widthDots });
    const bundledFonts = resolveBundledFontList(fontFamily);

    let logoPayload: { dataUrl: string; width: number; height: number } | undefined;
    if (activeLogo && activeLogo.data.length > 0) {
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
      fontFamily,
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
      render_mode: 'branded_raster',
      font_family: fontFamily,
      width_dots: brandedOutput.dimensions.widthDots,
      height_dots: brandedOutput.dimensions.heightDots,
      preview_image_url: brandedOutput.previewDataUrl,
      receipt_data: receiptDataPayload,
    });
  }),
);

