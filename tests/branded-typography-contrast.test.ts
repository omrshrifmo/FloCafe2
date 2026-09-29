const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-test-typo-contrast-'));
Module._load = function(request: string, parent: any, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments);
};

import assert from 'node:assert/strict';
import {
  DEFAULT_PRINT_STYLE_PREFERENCES,
  resolveEffectivePrintStyle,
  resolveRasterFontSize,
  resolveDensitySettings,
  getHighReadabilityPreset,
  validatePrintStylePreferences,
  type StorePrintStylePreferences,
  type ThermalDensityPreset,
} from '../shared/print/style';
import { applyThermalInkGain } from '../shared/print/raster';
import {
  buildBrandedReceiptRequest,
  buildBrandedKotRequest,
  buildBrandedReportRequest,
  buildBrandedDiagnosticRequest,
  renderBrandedReceipt,
  DEFAULT_RASTER_WIDTH_80MM,
  DEFAULT_RASTER_WIDTH_58MM,
} from '../main/printers/branded-receipt-renderer';
import { initDatabase, getDatabase, closeDatabase } from '../main/db';

async function runTests() {
  console.log('--- Running Branded Typography & Thermal Contrast Test Suite ---');

  const testDbDir = path.join(__dirname, '../dist/test-db-typo-contrast');
  if (fs.existsSync(testDbDir)) fs.rmSync(testDbDir, { recursive: true, force: true });
  fs.mkdirSync(testDbDir, { recursive: true });
  process.env.FLO_DATABASE_PATH = path.join(testDbDir, 'test.db');
  initDatabase();

  // =========================================================================
  // 1. Typography Preset Mapping & Raster Dot Sizes
  // =========================================================================
  console.log('1. Typography Preset Mapping & Raster Dot Sizes');
  {
    // Check 80mm preset sizes
    const small80 = resolveRasterFontSize(576, 'small', 'itemNames');
    const med80 = resolveRasterFontSize(576, 'medium', 'itemNames');
    const large80 = resolveRasterFontSize(576, 'large', 'itemNames');
    const xlarge80 = resolveRasterFontSize(576, 'xlarge', 'itemNames');

    assert(small80.fontSizePx < med80.fontSizePx, 'Small must be strictly smaller than Medium on 80mm');
    assert(med80.fontSizePx < large80.fontSizePx, 'Medium must be strictly smaller than Large on 80mm');
    assert(large80.fontSizePx < xlarge80.fontSizePx, 'Large must be strictly smaller than XLarge on 80mm');

    // Verify Large on 80mm is substantially large (>= 24px) for clear physical readability
    assert(large80.fontSizePx >= 24, 'Large on 80mm must be at least 24px');
    assert(xlarge80.fontSizePx >= 30, 'XLarge on 80mm must be at least 30px');

    // Check 58mm preset sizes and safe bounds
    const small58 = resolveRasterFontSize(384, 'small', 'itemNames');
    const med58 = resolveRasterFontSize(384, 'medium', 'itemNames');
    const large58 = resolveRasterFontSize(384, 'large', 'itemNames');
    const xlarge58 = resolveRasterFontSize(384, 'xlarge', 'itemNames');

    assert(small58.fontSizePx < med58.fontSizePx, 'Small must be smaller than Medium on 58mm');
    assert(med58.fontSizePx < large58.fontSizePx, 'Medium must be smaller than Large on 58mm');
    assert(large58.fontSizePx <= xlarge58.fontSizePx, 'Large must be <= XLarge on 58mm');
    assert(large58.fontSizePx >= 20, 'Large on 58mm must be at least 20px for readability');
    assert(xlarge58.fontSizePx <= 30, 'XLarge on 58mm must stay within safe printable width bounds');

    console.log('  ✓ Typography presets map to distinct, readable raster-dot sizes');
  }

  // =========================================================================
  // 2. High Readability Preset & Scale Defaults
  // =========================================================================
  console.log('2. High Readability Preset & Scale Defaults');
  {
    const preset = getHighReadabilityPreset();
    assert.equal(preset.receipt.typography.receiptScalePercent, 125, 'High readability preset must specify 125% receipt scale');
    assert.equal(preset.receipt.typography.kotScalePercent, 145, 'High readability preset must specify 145% KOT scale');
    assert.equal(preset.receipt.typography.reportScalePercent, 115, 'High readability preset must specify 115% report scale');
    assert.equal(preset.receipt.contrast?.densityPreset, 'dark', 'High readability preset must specify dark thermal density');
    assert.equal(preset.receipt.contrast?.threshold, 160, 'High readability preset must specify threshold 160');
    assert.equal(preset.receipt.contrast?.inkGain, 1, 'High readability preset must specify inkGain 1');
    assert.equal(preset.receipt.typography.itemNamesWeight, 'bold', 'High readability preset must specify bold item names');
    assert.equal(preset.receipt.typography.totalsWeight, 'bold', 'High readability preset must specify bold totals');
    assert.equal(preset.receipt.typography.kotItemWeight, 'bold', 'High readability preset must specify bold KOT item names');
    assert.equal(preset.receipt.typography.kotNotesWeight, 'bold', 'High readability preset must specify bold KOT notes');

    console.log('  ✓ High Readability preset matches XP-K200L 80mm physical specifications');
  }

  // =========================================================================
  // 3. Thermal Density Resolution & Ink Gain Dot Expansion
  // =========================================================================
  console.log('3. Thermal Density Resolution & Ink Gain Dot Expansion');
  {
    const light = resolveDensitySettings('light');
    const normal = resolveDensitySettings('normal');
    const dark = resolveDensitySettings('dark');
    const extraDark = resolveDensitySettings('extra_dark');

    assert.equal(light.threshold, 110);
    assert.equal(light.inkGain, 0);

    assert.equal(normal.threshold, 135);
    assert.equal(normal.inkGain, 0);

    assert.equal(dark.threshold, 160);
    assert.equal(dark.inkGain, 1);

    assert.equal(extraDark.threshold, 185);
    assert.equal(extraDark.inkGain, 1);

    // Custom overrides
    const custom = resolveDensitySettings('custom', 150, 1);
    assert.equal(custom.threshold, 150);
    assert.equal(custom.inkGain, 1);

    // Clamping of custom overrides
    const customClamped = resolveDensitySettings('custom', 300, 10);
    assert.equal(customClamped.threshold, 220, 'Threshold must clamp to 220');
    assert.equal(customClamped.inkGain, 2, 'Ink gain must clamp to 2');

    // Unit test applyThermalInkGain
    const width = 8;
    const height = 2;
    // Row 0: . . X . . . . . (1 black dot at x=2)
    // Row 1: . . . . . . . X (1 black dot at x=7)
    const originalPixels = new Uint8Array([
      0, 0, 1, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 1,
    ]);

    // Ink gain 0 -> identical
    const gain0 = applyThermalInkGain(width, height, originalPixels, 0);
    assert.deepEqual(Array.from(gain0), Array.from(originalPixels), 'gain 0 must not modify pixels');

    // Ink gain 1 -> expands right by 1
    const gain1 = applyThermalInkGain(width, height, originalPixels, 1);
    const expectedGain1 = [
      0, 0, 1, 1, 0, 0, 0, 0, // x=2 and x=3
      0, 0, 0, 0, 0, 0, 0, 1, // x=7 (cannot bleed past right edge)
    ];
    assert.deepEqual(Array.from(gain1), expectedGain1, 'gain 1 must expand right by 1 within row bounds');

    // Ink gain 2 -> expands right by 2
    const gain2 = applyThermalInkGain(width, height, originalPixels, 2);
    const expectedGain2 = [
      0, 0, 1, 1, 1, 0, 0, 0, // x=2, x=3, x=4
      0, 0, 0, 0, 0, 0, 0, 1, // x=7
    ];
    assert.deepEqual(Array.from(gain2), expectedGain2, 'gain 2 must expand right by 2 within row bounds');

    console.log('  ✓ Thermal density resolution and horizontal dot expansion function accurately');
  }

  // =========================================================================
  // 4. End-to-End Render: Typography Scaling & Weight Verification
  // =========================================================================
  console.log('4. End-to-End Render: Typography Scaling & Weight Verification');
  {
    const sampleItems = [
      { name: 'قهوة اسبريسو مزدوجة', quantity: 2, unitPrice: 35, totalPrice: 70 },
      { name: 'Double Espresso Dark Roast', quantity: 1, unitPrice: 40, totalPrice: 40 },
    ];

    // Standard scale (100%) render
    const req100 = buildBrandedReceiptRequest({
      widthDots: 576,
      header: { storeName: 'FloCafe Bistro', storeNameAr: 'فلو كافيه' },
      items: sampleItems,
      totals: { subtotal: 110, total: 110 },
      style: {
        ...DEFAULT_PRINT_STYLE_PREFERENCES.receipt,
        typography: {
          ...DEFAULT_PRINT_STYLE_PREFERENCES.receipt.typography,
          receiptScalePercent: 100,
          itemNamesWeight: 'regular',
        },
        contrast: { densityPreset: 'normal', threshold: 140, inkGain: 0 },
      } as any,
    });

    const res100 = await renderBrandedReceipt(req100);
    assert(res100.ok, '100% scale render must succeed');

    // Large scale (150%) with bold items render
    const req150 = buildBrandedReceiptRequest({
      widthDots: 576,
      header: { storeName: 'FloCafe Bistro', storeNameAr: 'فلو كافيه' },
      items: sampleItems,
      totals: { subtotal: 110, total: 110 },
      style: {
        ...DEFAULT_PRINT_STYLE_PREFERENCES.receipt,
        typography: {
          ...DEFAULT_PRINT_STYLE_PREFERENCES.receipt.typography,
          receiptScalePercent: 150,
          itemNamesWeight: 'bold',
        },
        contrast: { densityPreset: 'normal', threshold: 140, inkGain: 0 },
      } as any,
    });

    const res150 = await renderBrandedReceipt(req150);
    assert(res150.ok, '150% scale render must succeed');

    // 150% scale receipt must have greater vertical height than 100% scale
    assert(
      res150.dimensions.heightDots > res100.dimensions.heightDots,
      `150% scale height (${res150.dimensions.heightDots}) must exceed 100% scale height (${res100.dimensions.heightDots})`
    );

    // Pixel hash must differ due to scale and bold text
    assert.notEqual(res100.pixelHash, res150.pixelHash, 'Scale and weight changes must produce distinct pixel hashes');

    console.log('  ✓ Global scale and font-weight changes visibly transform final bitmap geometry');
  }

  // =========================================================================
  // 5. Thermal Contrast Pixel Density & Preview Parity
  // =========================================================================
  console.log('5. Thermal Contrast Pixel Density & Preview Parity');
  {
    const testItems = [
      { name: 'شاي أخضر بالنعناع Fresh Green Tea', quantity: 1, unitPrice: 25, totalPrice: 25 },
    ];

    // Light render (threshold 115, inkGain 0)
    const reqLight = buildBrandedReceiptRequest({
      widthDots: 576,
      header: { storeName: 'Contrast Test' },
      items: testItems,
      totals: { total: 25 },
      threshold: 115,
      inkGain: 0,
    });
    const resLight = await renderBrandedReceipt(reqLight);
    assert(resLight.ok);

    // Dark render (threshold 165, inkGain 1)
    const reqDark = buildBrandedReceiptRequest({
      widthDots: 576,
      header: { storeName: 'Contrast Test' },
      items: testItems,
      totals: { total: 25 },
      threshold: 165,
      inkGain: 1,
    });
    const resDark = await renderBrandedReceipt(reqDark);
    assert(resDark.ok);

    // Extra dark render (threshold 190, inkGain 2)
    const reqExtraDark = buildBrandedReceiptRequest({
      widthDots: 576,
      header: { storeName: 'Contrast Test' },
      items: testItems,
      totals: { total: 25 },
      threshold: 190,
      inkGain: 2,
    });
    const resExtraDark = await renderBrandedReceipt(reqExtraDark);
    assert(resExtraDark.ok);

    const countBlackPixels = (pixels: Uint8Array) => {
      let count = 0;
      for (let i = 0; i < pixels.length; i++) {
        if (pixels[i] === 1) count++;
      }
      return count;
    };

    const blackLight = countBlackPixels(resLight.document.monochromePixels);
    const blackDark = countBlackPixels(resDark.document.monochromePixels);
    const blackExtraDark = countBlackPixels(resExtraDark.document.monochromePixels);

    assert(
      blackDark > blackLight,
      `Dark (${blackDark}) must have strictly more black pixels than Light (${blackLight})`
    );
    assert(
      blackExtraDark > blackDark,
      `Extra Dark (${blackExtraDark}) must have strictly more black pixels than Dark (${blackDark})`
    );

    // Preview parity: previewDataUrl must exist, be a valid PNG, and pixelHash must match document.pixelHash
    assert(resDark.previewDataUrl, 'previewDataUrl must be present in Dark render');
    assert(resDark.previewDataUrl.startsWith('data:image/png;base64,'), 'previewDataUrl must be PNG base64');
    assert.equal(resDark.pixelHash, resDark.document.pixelHash, 'Pixel hash of render result must match document');

    console.log('  ✓ Thermal contrast presets produce strictly monotonic black dot density with 100% preview parity');
  }

  // =========================================================================
  // 6. KOT Visual Inheritance & Content Safety
  // =========================================================================
  console.log('6. KOT Visual Inheritance & Content Safety');
  {
    const kotReq = buildBrandedKotRequest({
      orderId: 'ORD-999',
      orderNumber: 'KOT-42',
      tableNumber: 'T5',
      orderType: 'dine_in',
      station: 'Kitchen',
      items: [
        { name: 'برجر دجاج حار Spicy Burger', quantity: 2, notes: 'بدون بصل No onion' },
      ],
      createdAt: new Date().toISOString(),
      widthDots: 576,
      threshold: 165,
      inkGain: 1,
    });

    const resKot = await renderBrandedReceipt(kotReq);
    assert(resKot.ok, 'Branded KOT render must succeed');

    // Strict KOT content safety: no financial words or values
    assert.equal((kotReq as any).totals?.length || 0, 0, 'KOT request must not include totals');
    assert.equal((kotReq as any).paymentMethods?.length || 0, 0, 'KOT request must not include payment methods');
    assert(kotReq.items.every(it => (it as any).unitPrice === undefined && (it as any).totalPrice === undefined), 'KOT items must not include prices');

    console.log('  ✓ Branded KOT renders with full typography and contrast while maintaining strict zero-financial leakage');
  }

  // =========================================================================
  // 7. Branded Financial Z-Report Rendering
  // =========================================================================
  console.log('7. Branded Financial Z-Report Rendering');
  {
    const reportReq = buildBrandedReportRequest({
      title: 'Daily Sales Z-Report',
      sections: [
        '{CENTER}{BOLD}FLOCAFE FINANCIAL REPORT{/BOLD}{/CENTER}',
        'Gross Sales / إجمالي المبيعات              1,250.00',
        'Net Sales / صافي المبيعات                1,100.00',
        'Tax / ضريبة القيمة المضافة                 150.00',
        '{BOLD}Total Revenue / الإيراد الإجمالي      1,250.00{/BOLD}',
      ],
      widthDots: 576,
      threshold: 160,
      inkGain: 1,
    });

    const resReport = await renderBrandedReceipt(reportReq);
    assert(resReport.ok, 'Branded report render must succeed');
    assert.equal(resReport.document.widthDots, 576);
    assert(resReport.dimensions.heightDots > 300, 'Report must render with expected height');

    console.log('  ✓ Branded financial Z-reports render with high-contrast thermal settings intact');
  }

  closeDatabase();
  console.log('\n✅ All Branded Typography & Thermal Contrast tests passed successfully!');
}

runTests().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
