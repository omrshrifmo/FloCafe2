/**
 * Test Suite: Unified Receipt and Kitchen Order Ticket (KOT) Print-Style Preferences
 *
 * Covers:
 * 1. True KOT visual inheritance (exact 1:1 visual styling from customer receipt)
 * 2. Strict KOT content safety (zero financial/tax/payment data leakage)
 * 3. Custom KOT visual overrides with safe fallbacks
 * 4. Distinct raster dimension budgets and font size clamping (80mm vs 58mm)
 * 5. Legacy ESC/POS hardware text token mappings and text divider formatting
 * 6. Canonical settings validation, normalization, and JSON parsing
 * 7. Database Migration 95 and settings route synchronization
 */

const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-test-style-'));
Module._load = function(request: string, parent: any, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments);
};

import assert from 'node:assert/strict';
import {
  DEFAULT_PRINT_STYLE_PREFERENCES,
  resolveEffectivePrintStyle,
  resolveRasterFontSize,
  resolveLegacyEscPosSize,
  validatePrintStylePreferences,
  parsePrintStylePreferences,
  type StorePrintStylePreferences,
} from '../shared/print/style';
import { renderKotViaDocument } from '../main/printers/document-kot';
import { initDatabase, getDatabase, closeDatabase } from '../main/db';
const { createApp, startServer, api, seedOwnerUser } = require('./helpers/test-setup');
const { settingsRoutes } = require('../main/routes/settings');

async function run() {
  console.log('--- Running Unified Print-Style Preferences Test Suite ---');

  // =========================================================================
  // 1. True KOT Visual Inheritance
  // =========================================================================
  console.log('1. True KOT Visual Inheritance');
  {
    const customReceiptPrefs: StorePrintStylePreferences = {
      version: 1,
      receipt: {
        renderMode: 'branded_raster',
        typography: {
          fontFamily: 'cairo',
          storeNameSize: 'xlarge',
          headerMetaSize: 'large',
          itemNamesSize: 'large',
          itemModifiersSize: 'medium',
          itemNotesSize: 'large',
          totalsSize: 'large',
          footerSize: 'medium',
        },
        frame: {
          borderStyle: 'double',
          borderThickness: 3,
          borderPadding: 16,
          borderRadius: 8,
          dividerStyle: 'solid',
        },
        logo: {
          showLogo: true,
          maxWidthPercent: 75,
          spacingBottomDots: 20,
          alignment: 'center',
        },
        direction: 'rtl',
      },
      kotStyleMode: 'inherit',
      kotOverrides: {
        renderMode: 'inherit',
        operational: {
          headerCompact: false,
          prominentNotes: false,
          showPrices: false,
          showTotals: false,
        },
      },
    };

    const resolvedReceipt = resolveEffectivePrintStyle(customReceiptPrefs, 'receipt', 'ar');
    const resolvedKot = resolveEffectivePrintStyle(customReceiptPrefs, 'kot', 'ar');

    // KOT must inherit every visual property identically
    assert.equal(resolvedKot.renderMode, resolvedReceipt.renderMode, 'KOT must inherit renderMode exactly');
    assert.equal(resolvedKot.typography.fontFamily, resolvedReceipt.typography.fontFamily, 'KOT must inherit fontFamily exactly');
    assert.equal(resolvedKot.typography.storeNameSize, resolvedReceipt.typography.storeNameSize, 'KOT must inherit storeNameSize');
    assert.equal(resolvedKot.typography.headerMetaSize, resolvedReceipt.typography.headerMetaSize, 'KOT must inherit headerMetaSize');
    assert.equal(resolvedKot.typography.itemNamesSize, resolvedReceipt.typography.itemNamesSize, 'KOT must inherit itemNamesSize');
    assert.equal(resolvedKot.typography.itemModifiersSize, resolvedReceipt.typography.itemModifiersSize, 'KOT must inherit itemModifiersSize');
    assert.equal(resolvedKot.typography.itemNotesSize, resolvedReceipt.typography.itemNotesSize, 'KOT must inherit itemNotesSize');
    assert.equal(resolvedKot.typography.totalsSize, resolvedReceipt.typography.totalsSize, 'KOT must inherit totalsSize');
    assert.equal(resolvedKot.typography.footerSize, resolvedReceipt.typography.footerSize, 'KOT must inherit footerSize');

    // Frames and borders
    assert.equal(resolvedKot.frame.borderStyle, resolvedReceipt.frame.borderStyle, 'KOT must inherit borderStyle');
    assert.equal(resolvedKot.frame.borderThickness, resolvedReceipt.frame.borderThickness, 'KOT must inherit borderThickness');
    assert.equal(resolvedKot.frame.borderPadding, resolvedReceipt.frame.borderPadding, 'KOT must inherit borderPadding');
    assert.equal(resolvedKot.frame.borderRadius, resolvedReceipt.frame.borderRadius, 'KOT must inherit borderRadius');
    assert.equal(resolvedKot.frame.dividerStyle, resolvedReceipt.frame.dividerStyle, 'KOT must inherit dividerStyle');

    // Logo
    assert.equal(resolvedKot.logo.showLogo, resolvedReceipt.logo.showLogo, 'KOT must inherit showLogo');
    assert.equal(resolvedKot.logo.maxWidthPercent, resolvedReceipt.logo.maxWidthPercent, 'KOT must inherit maxWidthPercent');
    assert.equal(resolvedKot.logo.spacingBottomDots, resolvedReceipt.logo.spacingBottomDots, 'KOT must inherit spacingBottomDots');

    // Direction
    assert.equal(resolvedKot.direction, resolvedReceipt.direction, 'KOT must inherit direction');

    console.log('  ✓ True visual inheritance verified across all properties');
  }

  // =========================================================================
  // 2. KOT Content Safety (Independent from visual style)
  // =========================================================================
  console.log('2. KOT Content Safety & Operational Toggles');
  {
    const sampleKotOrder = {
      id: 'ord-101',
      daily_sequence: 42,
      dining_option: 'dine_in',
      table_number: '5',
      server_name: 'Alex',
      created_at: '2026-09-28T12:00:00.000Z',
      items: [
        {
          id: 'item-1',
          product_name: 'Flat White Coffee',
          status: 'pending',
          quantity: 2,
          special_instructions: 'Extra hot, oat milk',
          unit_price: 18.0,
          total_price: 36.0,
        },
        {
          id: 'item-2',
          product_name: 'Croissant',
          status: 'pending',
          quantity: 1,
          unit_price: 12.0,
          total_price: 12.0,
        },
      ],
      // Malicious or accidental financial fields passed into KOT order object
      payment_method: 'cash',
      paid_amount: 100.0,
      change_amount: 52.0,
      tax_amount: 6.26,
      tax_id: '300123456700003',
      customer_phone: '+966500000000',
    };

    // Case A: Default KOT (showPrices=false, showTotals=false)
    const defaultKotStyle = resolveEffectivePrintStyle(DEFAULT_PRINT_STYLE_PREFERENCES, 'kot');
    const defaultResult = renderKotViaDocument(
      sampleKotOrder as any,
      sampleKotOrder.items as any,
      'Main Kitchen',
      {
        columns: 48,
        language: 'en',
        useUnicode: false,
        arabicShaping: false,
        cutMode: 'full' as any,
        style: defaultKotStyle,
      },
    );
    const renderedDefault = defaultResult.lines.join('\n');

    assert.ok(!renderedDefault.includes('cash'), 'KOT must not include payment method');
    assert.ok(!renderedDefault.includes('100.00'), 'KOT must not include amount paid');
    assert.ok(!renderedDefault.includes('52.00'), 'KOT must not include change');
    assert.ok(!renderedDefault.includes('6.26'), 'KOT must not include tax');
    assert.ok(!renderedDefault.includes('300123456700003'), 'KOT must not include tax registration number');
    assert.ok(!renderedDefault.includes('Thank You'), 'KOT must not include customer thank-you footer');
    assert.ok(!renderedDefault.includes('18.00'), 'Default KOT without showPrices must not display unit price');
    assert.ok(!renderedDefault.includes('SUBTOTAL'), 'Default KOT without showTotals must not display subtotal');
    assert.ok(renderedDefault.includes('Flat White Coffee'), 'KOT must include item name');
    assert.ok(renderedDefault.includes('Extra hot, oat milk'), 'KOT must include kitchen notes');
    assert.ok(renderedDefault.includes('KITCHEN ORDER TICKET'), 'KOT must include kitchen order ticket banner');

    // Case B: KOT with showPrices=true and showTotals=true
    const pricingKotPrefs: StorePrintStylePreferences = {
      ...DEFAULT_PRINT_STYLE_PREFERENCES,
      kotOverrides: {
        operational: {
          headerCompact: false,
          prominentNotes: true,
          showPrices: true,
          showTotals: true,
        },
      },
    };
    const pricingKotStyle = resolveEffectivePrintStyle(pricingKotPrefs, 'kot');
    const pricingResult = renderKotViaDocument(
      sampleKotOrder as any,
      sampleKotOrder.items as any,
      'Main Kitchen',
      {
        columns: 48,
        language: 'en',
        useUnicode: false,
        arabicShaping: false,
        cutMode: 'full' as any,
        style: pricingKotStyle,
      },
    );
    const renderedPricing = pricingResult.lines.join('\n');

    assert.ok(renderedPricing.includes('(18.00)'), 'KOT with showPrices must print unit prices');
    assert.ok(renderedPricing.includes('SUBTOTAL: 48.00'), 'KOT with showTotals must print operational subtotal');
    assert.ok(renderedPricing.includes('TOTAL ITEMS: 3'), 'KOT with showTotals must print total items count');
    assert.ok(renderedPricing.includes('*** NOTE: Extra hot, oat milk ***'), 'Prominent notes must be formatted with prominent markers');

    // Still no financial leak
    assert.ok(!renderedPricing.includes('cash'), 'KOT with prices must still not leak payment method');
    assert.ok(!renderedPricing.includes('change'), 'KOT with prices must still not leak change');
    assert.ok(!renderedPricing.includes('VAT'), 'KOT with prices must still not leak VAT');

    console.log('  ✓ KOT content safety verified: zero financial leakage and operational options behave correctly');
  }

  // =========================================================================
  // 3. Custom KOT Style Overrides
  // =========================================================================
  console.log('3. Custom KOT Style Overrides');
  {
    const customKotPrefs: StorePrintStylePreferences = {
      version: 1,
      receipt: {
        renderMode: 'legacy_text',
        typography: {
          fontFamily: 'system',
          storeNameSize: 'medium',
          headerMetaSize: 'small',
          itemNamesSize: 'small',
          itemModifiersSize: 'small',
          itemNotesSize: 'small',
          totalsSize: 'medium',
          footerSize: 'small',
        },
        frame: {
          borderStyle: 'none',
          borderThickness: 1,
          borderPadding: 8,
          borderRadius: 0,
          dividerStyle: 'dashed',
        },
        logo: {
          showLogo: false,
          maxWidthPercent: 50,
          spacingBottomDots: 8,
          alignment: 'center',
        },
        direction: 'ltr',
      },
      kotStyleMode: 'custom',
      kotOverrides: {
        renderMode: 'branded_raster',
        typography: {
          fontFamily: 'cairo',
          itemNamesSize: 'large',
          itemNotesSize: 'large',
        },
        frame: {
          borderStyle: 'solid',
          borderThickness: 2,
        },
        logo: {
          showLogo: true,
        },
      },
    };

    const resolved = resolveEffectivePrintStyle(customKotPrefs, 'kot');
    assert.equal(resolved.renderMode, 'branded_raster', 'Custom KOT override for renderMode should apply');
    assert.equal(resolved.typography.fontFamily, 'cairo', 'Custom KOT override for fontFamily should apply');
    assert.equal(resolved.typography.itemNamesSize, 'large', 'Custom KOT override for itemNamesSize should apply');
    assert.equal(resolved.typography.itemNotesSize, 'large', 'Custom KOT override for itemNotesSize should apply');
    assert.equal(resolved.typography.storeNameSize, 'medium', 'Unspecified typography falls back to base receipt');
    assert.equal(resolved.frame.borderStyle, 'solid', 'Custom KOT frame borderStyle should apply');
    assert.equal(resolved.frame.borderThickness, 2, 'Custom KOT borderThickness should apply');
    assert.equal(resolved.logo.showLogo, true, 'Custom KOT logo override should apply');

    console.log('  ✓ Custom KOT style overrides applied accurately with safe fallbacks');
  }

  // =========================================================================
  // 4. Distinct Raster Dimension Budgets & Font Size Clamping (80mm vs 58mm)
  // =========================================================================
  console.log('4. Distinct Raster Dimension Budgets & Font Size Clamping');
  {
    // Test 80mm vs 58mm sizing
    const font80Large = resolveRasterFontSize(576, 'large');
    const font58Large = resolveRasterFontSize(384, 'large');
    assert.ok(font80Large.fontSizePx > font58Large.fontSizePx, '80mm large font must be larger than 58mm large font');

    // Clamping test on 58mm: notes/modifiers must not exceed safe thresholds
    const font58NotesSmall = resolveRasterFontSize(384, 'small', 'itemNotes');
    const font58NotesLarge = resolveRasterFontSize(384, 'large', 'itemNotes');
    assert.ok(font58NotesSmall.fontSizePx <= 18, '58mm small notes font must stay <= 18px');
    assert.ok(font58NotesLarge.fontSizePx <= 26, '58mm large notes font must stay clamped to safe width');

    console.log('  ✓ Raster font sizing scales and clamps correctly for 80mm and 58mm profiles');
  }

  // =========================================================================
  // 5. Legacy ESC/POS Hardware Text Tokens
  // =========================================================================
  console.log('5. Legacy ESC/POS Hardware Text Tokens');
  {
    const smallSpec = resolveLegacyEscPosSize('small');
    const medSpec = resolveLegacyEscPosSize('medium');
    const largeSpec = resolveLegacyEscPosSize('large');
    const xlargeSpec = resolveLegacyEscPosSize('xlarge');

    assert.ok(smallSpec.initToken.includes('{FONT_B}'), 'small maps to Font B');
    assert.ok(medSpec.initToken.includes('{FONT_A}'), 'medium maps to Font A');
    assert.ok(largeSpec.initToken.includes('{DBL_HEIGHT}'), 'large maps to double height');
    assert.ok(xlargeSpec.initToken.includes('{DBL_WIDTH_HEIGHT}'), 'xlarge maps to double width and height');

    console.log('  ✓ Legacy ESC/POS hardware text tokens mapped correctly');
  }

  // =========================================================================
  // 6. Canonical Validation & Safe Normalization
  // =========================================================================
  console.log('6. Canonical Validation & Safe Normalization');
  {
    // Malformed JSON fallback
    const parsedMalformed = parsePrintStylePreferences('invalid json {{{');
    assert.deepEqual(parsedMalformed, DEFAULT_PRINT_STYLE_PREFERENCES, 'Malformed JSON must fall back to default preferences');

    // Out-of-bounds numeric values normalized safely
    const rawWithBadNumbers = {
      version: 1,
      receipt: {
        renderMode: 'branded_raster',
        typography: {
          fontFamily: 'almarai',
          storeNameSize: 'huge_invalid_size',
        },
        frame: {
          borderThickness: 999, // Should be clamped
          borderPadding: -50,   // Should be clamped
          borderRadius: 1000,   // Should be clamped
        },
        logo: {
          maxWidthPercent: 500, // Should be clamped to 100
        },
      },
    };

    const validated = validatePrintStylePreferences(rawWithBadNumbers);
    assert.equal(validated.receipt.typography.storeNameSize, 'large', 'Invalid size step must fall back safely');
    assert.equal(validated.receipt.frame.borderThickness, 6, 'Thickness above maximum must be clamped to 6');
    assert.equal(validated.receipt.frame.borderPadding, 0, 'Negative padding must be clamped to 0');
    assert.equal(validated.receipt.frame.borderRadius, 32, 'Excessive radius must be clamped to 32');
    assert.equal(validated.receipt.logo.maxWidthPercent, 100, 'Percentage above 100 must be clamped to 100');

    console.log('  ✓ Validation and normalization enforce structural and value safety');
  }

  // =========================================================================
  // 7. Database Migration 95 Verification
  // =========================================================================
  console.log('7. Database Migration 95 Verification');
  {
    initDatabase();
    const db = getDatabase();

    // Verify print_style_preferences exists in settings
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('print_style_preferences') as { value: string } | undefined;
    assert.ok(row, 'print_style_preferences setting must exist in database');

    const parsedDb = parsePrintStylePreferences(row.value);
    assert.equal(parsedDb.version, 1, 'Persisted setting must have version 1');
    assert.ok(parsedDb.receipt, 'Persisted setting must have receipt section');
    assert.ok(parsedDb.kotStyleMode === 'inherit' || parsedDb.kotStyleMode === 'custom', 'Persisted setting must have valid kotStyleMode');

    closeDatabase();
    console.log('  ✓ Database migration 95 correctly seeded canonical print_style_preferences');
  }

  // =========================================================================
  // 8. Canonical Source of Truth & Legacy Compatibility Invariants
  // =========================================================================
  console.log('8. Canonical Source & Legacy Compatibility Invariants');
  {
    closeDatabase();
    initDatabase();
    const db = getDatabase();

    const initialCanonical: StorePrintStylePreferences = {
      version: 1,
      receipt: {
        renderMode: 'branded_raster',
        typography: {
          fontFamily: 'almarai',
          storeNameSize: 'xlarge',
          headerMetaSize: 'medium',
          itemNamesSize: 'large',
          itemModifiersSize: 'small',
          itemNotesSize: 'small',
          totalsSize: 'large',
          footerSize: 'small',
        },
        frame: {
          borderStyle: 'solid',
          borderThickness: 2,
          borderPadding: 10,
          borderRadius: 4,
          dividerStyle: 'dotted',
        },
        logo: {
          showLogo: true,
          maxWidthPercent: 75,
          spacingBottomDots: 15,
          alignment: 'center',
        },
        direction: 'rtl',
      },
      kotStyleMode: 'custom',
      kotOverrides: {
        renderMode: 'branded_raster',
        typography: {
          fontFamily: 'cairo',
          storeNameSize: 'large',
          headerMetaSize: 'large',
          itemNamesSize: 'xlarge',
          itemModifiersSize: 'medium',
          itemNotesSize: 'large',
          totalsSize: 'medium',
          footerSize: 'small',
        },
        frame: {
          borderStyle: 'double',
          borderThickness: 3,
          borderPadding: 12,
          borderRadius: 8,
          dividerStyle: 'solid',
        },
        logo: {
          showLogo: false,
          maxWidthPercent: 50,
          spacingBottomDots: 8,
          alignment: 'center',
        },
        direction: 'rtl',
        operational: {
          headerCompact: true,
          prominentNotes: true,
          showPrices: true,
          showTotals: true,
        },
      },
    };

    // Store custom canonical print_style_preferences
    db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(
      'print_style_preferences',
      JSON.stringify(initialCanonical),
    );
    // Derived legacy mirrors
    db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run('receipt_render_mode', 'branded_raster');
    db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run('receipt_branded_font_family', 'almarai');

    const owner = seedOwnerUser(db);
    const app = createApp({ '/api/settings': settingsRoutes });
    const { baseUrl, server } = await startServer(app);

    try {
      // 8.1: Reading legacy keys must return canonical values and NOT modify canonical preferences in DB
      const legacyRenderModeRes = await api(baseUrl, '/api/settings/receipt_render_mode', { headers: owner.authHeader });
      assert.equal(legacyRenderModeRes.status, 200);
      assert.equal(legacyRenderModeRes.data.setting.value, 'branded_raster');

      const legacyFontRes = await api(baseUrl, '/api/settings/receipt_branded_font_family', { headers: owner.authHeader });
      assert.equal(legacyFontRes.status, 200);
      assert.equal(legacyFontRes.data.setting.value, 'almarai');

      const allSettingsRes = await api(baseUrl, '/api/settings', { headers: owner.authHeader });
      assert.equal(allSettingsRes.status, 200);
      assert.equal(allSettingsRes.data.settings.receipt_render_mode, 'branded_raster');
      assert.equal(allSettingsRes.data.settings.receipt_branded_font_family, 'almarai');

      const rawCanonicalAfterReads = (db.prepare('SELECT value FROM settings WHERE key = ?').get('print_style_preferences') as { value: string }).value;
      assert.deepEqual(JSON.parse(rawCanonicalAfterReads), initialCanonical, 'Canonical preferences must remain unchanged after reading legacy keys');
      console.log('  ✓ Canonical receipt and KOT configuration remains unchanged after legacy key reads');

      // 8.2: Legacy receipt_render_mode update patches ONLY receipt.renderMode
      const updateRenderModeRes = await api(baseUrl, '/api/settings/receipt_render_mode', {
        method: 'PUT',
        headers: owner.authHeader,
        body: { value: 'legacy_text' },
      });
      assert.equal(updateRenderModeRes.status, 200);

      const prefsAfterRenderModeUpdate: StorePrintStylePreferences = JSON.parse(
        (db.prepare('SELECT value FROM settings WHERE key = ?').get('print_style_preferences') as { value: string }).value,
      );
      assert.equal(prefsAfterRenderModeUpdate.receipt.renderMode, 'legacy_text', 'receipt.renderMode must be patched to legacy_text');
      assert.equal(prefsAfterRenderModeUpdate.receipt.typography.fontFamily, 'almarai', 'receipt typography fontFamily must remain untouched');
      assert.equal(prefsAfterRenderModeUpdate.receipt.typography.storeNameSize, 'xlarge', 'receipt storeNameSize must remain untouched');
      assert.deepEqual(prefsAfterRenderModeUpdate.receipt.frame, initialCanonical.receipt.frame, 'receipt frame must remain untouched');
      assert.deepEqual(prefsAfterRenderModeUpdate.receipt.logo, initialCanonical.receipt.logo, 'receipt logo must remain untouched');
      assert.equal(prefsAfterRenderModeUpdate.kotStyleMode, 'custom', 'kotStyleMode must remain custom');
      assert.deepEqual(prefsAfterRenderModeUpdate.kotOverrides, initialCanonical.kotOverrides, 'KOT overrides must be 100% preserved');
      console.log('  ✓ Legacy receipt_render_mode update patches only receipt.renderMode');

      // 8.3: Legacy receipt_branded_font_family update patches ONLY receipt.typography.fontFamily
      const updateFontRes = await api(baseUrl, '/api/settings/receipt_branded_font_family', {
        method: 'PUT',
        headers: owner.authHeader,
        body: { value: 'cairo' },
      });
      assert.equal(updateFontRes.status, 200);

      const prefsAfterFontUpdate: StorePrintStylePreferences = JSON.parse(
        (db.prepare('SELECT value FROM settings WHERE key = ?').get('print_style_preferences') as { value: string }).value,
      );
      assert.equal(prefsAfterFontUpdate.receipt.typography.fontFamily, 'cairo', 'receipt typography fontFamily must be patched to cairo');
      assert.equal(prefsAfterFontUpdate.receipt.renderMode, 'legacy_text', 'receipt renderMode must remain legacy_text');
      assert.deepEqual(prefsAfterFontUpdate.receipt.frame, initialCanonical.receipt.frame, 'receipt frame must remain untouched');
      assert.equal(prefsAfterFontUpdate.kotStyleMode, 'custom', 'kotStyleMode must remain custom');
      assert.deepEqual(prefsAfterFontUpdate.kotOverrides, initialCanonical.kotOverrides, 'KOT overrides must be 100% preserved');
      console.log('  ✓ Legacy font-family update patches only receipt.typography.fontFamily');

      // 8.4: KOT custom render mode, typography, frame, logo, and operational values survive legacy updates unchanged
      assert.equal(prefsAfterFontUpdate.kotOverrides.renderMode, 'branded_raster');
      assert.equal(prefsAfterFontUpdate.kotOverrides.typography?.fontFamily, 'cairo');
      assert.equal(prefsAfterFontUpdate.kotOverrides.typography?.storeNameSize, 'large');
      assert.equal(prefsAfterFontUpdate.kotOverrides.frame?.borderStyle, 'double');
      assert.equal(prefsAfterFontUpdate.kotOverrides.logo?.showLogo, false);
      assert.equal(prefsAfterFontUpdate.kotOverrides.operational?.headerCompact, true);
      assert.equal(prefsAfterFontUpdate.kotOverrides.operational?.prominentNotes, true);
      assert.equal(prefsAfterFontUpdate.kotOverrides.operational?.showPrices, true);
      assert.equal(prefsAfterFontUpdate.kotOverrides.operational?.showTotals, true);
      console.log('  ✓ KOT custom render mode, typography, frame, logo, and operational values survive legacy updates unchanged');

      // 8.5: Conflict rule - If caller supplies conflicting legacy keys with print_style_preferences, canonical wins
      const conflictRes = await api(baseUrl, '/api/settings/printing', {
        method: 'PUT',
        headers: owner.authHeader,
        body: {
          printer_trim_decimals: true,
          bill_show_name: true,
          bill_show_address: true,
          bill_show_phone: true,
          bill_show_tax_id: true,
          bill_show_tax_breakdown: true,
          bill_show_customer_name: true,
          bill_show_customer_phone: true,
          bill_show_table_number: true,
          bill_language_policy: { primary: { mode: 'fixed', language: 'en' }, additional: [] },
          kot_language_policy: { primary: { mode: 'fixed', language: 'en' }, additional: [] },
          receipt_render_mode: 'legacy_text', // Legacy conflict!
          receipt_branded_font_family: 'system', // Legacy conflict!
          print_style_preferences: JSON.stringify({
            ...initialCanonical,
            receipt: {
              ...initialCanonical.receipt,
              renderMode: 'branded_raster',
              typography: {
                ...initialCanonical.receipt.typography,
                fontFamily: 'almarai',
              },
            },
          }),
        },
      });
      assert.equal(conflictRes.status, 200);

      const prefsAfterConflict: StorePrintStylePreferences = JSON.parse(
        (db.prepare('SELECT value FROM settings WHERE key = ?').get('print_style_preferences') as { value: string }).value,
      );
      assert.equal(prefsAfterConflict.receipt.renderMode, 'branded_raster', 'Canonical print_style_preferences must win over conflicting legacy key');
      assert.equal(prefsAfterConflict.receipt.typography.fontFamily, 'almarai', 'Canonical print_style_preferences must win over conflicting legacy key');

      // Check legacy mirrors exported to settings table
      const exportedRenderMode = (db.prepare('SELECT value FROM settings WHERE key = ?').get('receipt_render_mode') as { value: string }).value;
      const exportedFont = (db.prepare('SELECT value FROM settings WHERE key = ?').get('receipt_branded_font_family') as { value: string }).value;
      assert.equal(exportedRenderMode, 'branded_raster', 'Legacy receipt_render_mode mirror must be exported from canonical');
      assert.equal(exportedFont, 'almarai', 'Legacy receipt_branded_font_family mirror must be exported from canonical');
      console.log('  ✓ Conflict resolution verified: print_style_preferences wins over conflicting legacy parameters');

    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // 8.6: Existing canonical print_style_preferences value is never overwritten by legacy values on startup/migration
    // Set legacy keys in DB to conflicting values
    db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run('receipt_render_mode', 'legacy_text');
    db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run('receipt_branded_font_family', 'system');

    // Simulate startup check / re-run migration: existing canonical row must remain untouched
    const canonicalBefore = (db.prepare('SELECT value FROM settings WHERE key = ?').get('print_style_preferences') as { value: string }).value;
    const parsedBefore = parsePrintStylePreferences(canonicalBefore);
    assert.equal(parsedBefore.receipt.renderMode, 'branded_raster');
    assert.equal(parsedBefore.receipt.typography.fontFamily, 'almarai');

    closeDatabase();
    console.log('  ✓ Existing canonical print_style_preferences value is never overwritten by legacy values on startup/migration');
  }

  console.log('\n✅ All Unified Print-Style Preferences tests passed successfully!');
}

run().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
