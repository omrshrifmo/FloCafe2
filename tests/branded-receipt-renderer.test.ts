import assert from 'node:assert/strict';
import {
  computeBrandedGeometry,
  calculateItemTableColumns,
  computeCapabilityDerivedLogoDimensions,
  convertImageBufferToMonochrome,
  buildBrandedReceiptRequest,
  renderBrandedReceiptSoftware,
  renderBrandedReceipt,
  getBundledFontDataUrl,
  DEFAULT_RASTER_WIDTH_80MM,
  DEFAULT_RASTER_WIDTH_58MM,
} from '../main/printers/branded-receipt-renderer';
import { validateRasterBand, encodeGsV0Band } from '../shared/print/raster';

function runTests() {
  console.log('[Test] Running branded-receipt-renderer test suite...');

  // 1. Geometry calculation
  // 80mm standard (XP-K200L): 576 dots
  const geom80 = computeBrandedGeometry({ widthDots: 576, paddingDots: 16 });
  assert.equal(geom80.widthDots, 576);
  assert.equal(geom80.paddingDots, 16);
  assert.equal(geom80.contentLeft, 16);
  assert.equal(geom80.contentWidth, 576 - 32); // 544

  // 58mm standard: 384 dots
  const geom58 = computeBrandedGeometry({ widthDots: 384, paddingDots: 8 });
  assert.equal(geom58.widthDots, 384);
  assert.equal(geom58.paddingDots, 8);
  assert.equal(geom58.contentLeft, 8);
  assert.equal(geom58.contentWidth, 384 - 16); // 368

  // Custom border & inset
  const geomCustom = computeBrandedGeometry({
    widthDots: 576,
    paddingDots: 10,
    borderThicknessDots: 2,
    borderInsetDots: 4,
  });
  assert.equal(geomCustom.contentLeft, 16); // 10 + 2 + 4
  assert.equal(geomCustom.contentWidth, 576 - 32);

  // Boundary validations
  assert.throws(() => computeBrandedGeometry({ widthDots: 50 }), /Invalid raster widthDots/);
  assert.throws(() => computeBrandedGeometry({ widthDots: 10000 }), /Invalid raster widthDots/);
  assert.throws(() => computeBrandedGeometry({ widthDots: 100, paddingDots: 45 }), /Available content width.*too narrow/);

  // 2. Explicit 3-column RTL items table layout
  const cols80 = calculateItemTableColumns(geom80.contentWidth);
  assert.equal(cols80.contentWidth, 544);
  assert(cols80.priceWidth >= 64, 'Price column must have minimum width');
  assert(cols80.qtyWidth >= 40, 'Qty column must have minimum width');
  assert(cols80.itemWidth > 200, 'Item column must take primary width');
  assert.equal(cols80.priceWidth + cols80.qtyWidth + cols80.itemWidth, 544, 'Columns must exactly sum to contentWidth');

  const cols58 = calculateItemTableColumns(geom58.contentWidth);
  assert.equal(cols58.priceWidth + cols58.qtyWidth + cols58.itemWidth, 368);

  // 3. Dynamic capability-derived logo dimension constraints
  // 80mm profile (576 dots, 544 content width): safe 70% = 403 dots
  const logoOversized = { width: 800, height: 400 };
  const logoDims80 = computeCapabilityDerivedLogoDimensions(logoOversized, geom80);
  assert(logoDims80.width <= 403, '80mm logo width must not exceed capability safe width');
  assert(logoDims80.width <= geom80.contentWidth, '80mm logo width must not exceed content width');
  assert.equal(logoDims80.width, 403);
  assert(logoDims80.height <= Math.round(geom80.contentWidth * 0.45));

  // 58mm profile (384 dots, 368 content width): safe 70% = 269 dots
  const logoDims58 = computeCapabilityDerivedLogoDimensions(logoOversized, geom58);
  assert(logoDims58.width <= 269, '58mm logo width must not exceed capability safe width');
  assert(logoDims58.width <= geom58.contentWidth, '58mm logo width must not exceed 58mm content width');
  assert.equal(logoDims58.width, 269);
  assert(logoDims58.width < logoDims80.width, '58mm logo constraint must be narrower than 80mm');

  // Undersized logo (fits without scaling)
  const logoSmall = { width: 120, height: 60 };
  const logoSmallDims = computeCapabilityDerivedLogoDimensions(logoSmall, geom80);
  assert.equal(logoSmallDims.width, 120);
  assert.equal(logoSmallDims.height, 60);
  assert.equal(logoSmallDims.scale, 1);

  // 4. Logo monochrome conversion (Luminance Thresholding & Error-Diffusion)
  // Create 2x2 RGBA test image:
  // (0,0): Pure White (255, 255, 255, 255) -> luminance ~255 -> 0 (white)
  // (1,0): Pure Black (0, 0, 0, 255) -> luminance ~0 -> 1 (black)
  // (0,1): Mid Gray (100, 100, 100, 255) -> luminance ~100 < 128 -> 1 (black)
  // (1,1): Transparent (0, 0, 0, 0) -> alpha 0 -> 0 (white)
  const testPixels = new Uint8Array([
    255, 255, 255, 255,    0,   0,   0, 255,
    100, 100, 100, 255,    0,   0,   0,   0,
  ]);

  const monoThreshold = convertImageBufferToMonochrome(testPixels, 2, 2, { mode: 'threshold', threshold: 128 });
  assert.equal(monoThreshold[0], 0, 'White should be 0');
  assert.equal(monoThreshold[1], 1, 'Black should be 1');
  assert.equal(monoThreshold[2], 1, 'Dark gray (< 128) should be 1');
  assert.equal(monoThreshold[3], 0, 'Transparent pixel should be 0 (white)');

  const monoDither = convertImageBufferToMonochrome(testPixels, 2, 2, { mode: 'error-diffusion', threshold: 128 });
  assert.equal(monoDither.length, 4);

  // 5. Bundled font data URLs
  const almaraiRegular = getBundledFontDataUrl('almarai', 'regular');
  assert(almaraiRegular !== null, 'Almarai-Regular.ttf must be resolved');
  assert(almaraiRegular.startsWith('data:font/truetype;base64,'), 'Font must be data: URL');

  const almaraiBold = getBundledFontDataUrl('almarai', 'bold');
  assert(almaraiBold !== null, 'Almarai-Bold.ttf must be resolved');

  const cairoRegular = getBundledFontDataUrl('cairo', 'regular');
  assert(cairoRegular !== null, 'Cairo-Regular.ttf must be resolved');

  const cairoBold = getBundledFontDataUrl('cairo', 'bold');
  assert(cairoBold !== null, 'Cairo-Bold.ttf must be resolved');

  // 6. Long receipt rendering (50+ items) without arbitrary line capping
  const manyItems: any[] = [];
  for (let i = 1; i <= 60; i++) {
    manyItems.push({
      product_name: `وجبة شاورما رقم ${i} / Shawarma Combo ${i}`,
      quantity: (i % 3) + 1,
      total_price: ((i % 3) + 1) * 25.5,
      addons: i % 2 === 0 ? [{ name: 'إضافة جبنة إضافية / Extra Cheese', price: 5.0 }] : undefined,
    });
  }

  const orderData = {
    order_number: 'ORD-2026-999',
    table: { name: 'طاولة 12' },
    items: manyItems,
  };

  const billData = {
    bill_number: 'INV-2026-999',
    subtotal: 1850.50,
    discount_amount: 50.00,
    tax_amount: 270.00,
    service_charge: 30.00,
    total: 2100.50,
    paid_amount: 2150.00,
    balance: 0.00,
    items: manyItems,
  };

  const businessData = {
    name: 'كافيه مزاج الفاخر / Mazaj Cafe',
    address: 'شارع الملك فهد، الرياض / King Fahd Rd, Riyadh',
    phone: '+966 50 123 4567',
    taxRegistrationNumber: '310123456700003',
    currency_symbol: 'SAR',
  };

  const request = buildBrandedReceiptRequest({
    order: orderData,
    bill: billData,
    business: businessData,
    widthDots: DEFAULT_RASTER_WIDTH_80MM,
    fontFamily: 'almarai',
    logoAsset: {
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      mimeType: 'image/png',
      width: 120,
      height: 60,
    },
  });

  assert.equal(request.widthDots, 576);
  assert.equal(request.items.length, 60);

  const output = renderBrandedReceiptSoftware(request);
  assert.equal(output.ok, true);
  assert(output.dimensions.bandCount > 5, '60-item receipt should produce multiple 200-dot bands');
  assert(output.dimensions.heightDots > 1000, '60-item receipt height must exceed 1000 dots');

  // Verify all bands satisfy GS v 0 constraints
  for (const band of output.unit.bands) {
    validateRasterBand(band, 200);
    assert.equal(band.widthDots, 576);
    assert(band.heightDots <= 200, 'Every band must be <= 200 dots high');
    const encodedBand = encodeGsV0Band(band, 200);
    assert(encodedBand.length > 8, 'Band ESC/POS command must include header + payload');
    // Verify GS v 0 magic header bytes: 1D 76 30 00
    assert.equal(encodedBand[0], 0x1d);
    assert.equal(encodedBand[1], 0x76);
    assert.equal(encodedBand[2], 0x30);
    assert.equal(encodedBand[3], 0x00);
  }

  // 7. Preview generation: valid PNG data URL
  assert(output.previewDataUrl !== undefined, 'Output must include previewDataUrl');
  assert(output.previewDataUrl!.startsWith('data:image/png;base64,'));
  const pngBase64 = output.previewDataUrl!.replace('data:image/png;base64,', '');
  const pngBuf = Buffer.from(pngBase64, 'base64');
  // Check PNG signature: 89 50 4E 47 0D 0A 1A 0A
  assert.equal(pngBuf[0], 0x89);
  assert.equal(pngBuf[1], 0x50);
  assert.equal(pngBuf[2], 0x4e);
  assert.equal(pngBuf[3], 0x47);

  console.log('[Test] branded-receipt-renderer test suite passed!');
}

runTests();
