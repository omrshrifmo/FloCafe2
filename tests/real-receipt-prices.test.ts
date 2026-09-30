const Module = require('module');
const originalLoad = (Module as any)._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-real-receipt-prices-'));
(Module as any)._load = function (request: string, parent: any, isMain: boolean) {
  if (request === 'electron') {
    return {
      app: {
        isPackaged: true,
        getPath: () => testDir,
        getVersion: () => '3.11.10',
      },
    };
  }
  return originalLoad.apply(this, arguments);
};

import { strict as assert } from 'node:assert';
import {
  buildBrandedReceiptRequest,
  buildBrandedKotRequest,
  renderBrandedReceiptSoftware,
  DEFAULT_RASTER_WIDTH_80MM,
} from '../main/printers/branded-receipt-renderer';
import { buildBillPrintData } from '../main/printers/document-classic';

async function runTests() {
  console.log('--- Running Real Receipt Prices Tests ---');

  const business = {
    name: 'FloCafe Artisan',
    currency_symbol: 'SAR',
    currency: 'SAR',
    address: 'Riyadh, Saudi Arabia',
    phone: '+966 55 123 4567',
  };

  // 1. Real persisted order item schema (SQLite order_items table)
  // Columns: product_name, quantity, unit_price, subtotal, total.
  // Note: NO total_price or price column exists in SQLite order_items.
  const realOrderItems = [
    {
      id: 101,
      order_id: 50,
      product_name: 'V60 Specialty Coffee',
      quantity: 2,
      unit_price: 18.00,
      subtotal: 36.00,
      total: 36.00,
      special_instructions: 'Less ice',
    },
    {
      id: 102,
      order_id: 50,
      product_name: 'Almond Croissant',
      quantity: 1,
      unit_price: 22.50,
      subtotal: 22.50,
      total: 22.50,
      addons: [{ name: 'Extra Butter', price: 3.00 }],
    },
  ];

  const realOrder = {
    id: 50,
    order_number: 'ORD-2026-0050',
    created_at: '2026-09-30 10:00:00',
    total: 61.50,
    items: realOrderItems,
  };

  const realBill = {
    id: 88,
    bill_number: 'INV-2026-0088',
    order_id: 50,
    subtotal: 58.50,
    tax_amount: 3.00,
    total: 61.50,
    paid_amount: 61.50,
    balance: 0.00,
  };

  // Test 1: Real order receipt request extraction
  const req = buildBrandedReceiptRequest({
    order: realOrder,
    bill: realBill,
    business,
    widthDots: DEFAULT_RASTER_WIDTH_80MM,
  });

  assert.equal(req.items.length, 2, 'Must map both items');
  // Item 1: Multi-quantity (2 x 18.00 = 36.00)
  assert.equal(req.items[0].name, 'V60 Specialty Coffee');
  assert.equal(req.items[0].quantity, 2);
  assert.equal(req.items[0].price, 36.00, 'Item line total must NOT be 0.0 or 0.00');
  assert.equal(req.items[0].unitPrice, 18.00, 'Unit price must be 18.00');
  assert.equal(req.items[0].notes, 'Less ice');

  // Item 2: 1 x 22.50
  assert.equal(req.items[1].name, 'Almond Croissant');
  assert.equal(req.items[1].quantity, 1);
  assert.equal(req.items[1].price, 22.50, 'Item price must NOT be 0.0');
  assert.equal(req.items[1].unitPrice, 22.50);
  assert.equal(req.items[1].addons?.[0].price, 3.00);

  // Totals check
  const totalRow = req.totals.find((t) => t.label.includes('Total'));
  assert.ok(totalRow, 'Total row must exist');
  assert.ok(totalRow.value.includes('61.50'), 'Total row must show authoritative 61.50');

  // Test 2: Software render of real receipt
  const rendered = renderBrandedReceiptSoftware(req);
  assert.equal(rendered.ok, true, 'Real receipt must render successfully');
  assert.ok(rendered.rasterBytes.length > 0, 'Raster bytes must be generated');

  // Test 3: Classic document buildBillPrintData parity with real DB item schema
  const classicData = buildBillPrintData(realOrder, realBill, business, false);
  assert.equal(classicData.order.items[0].unitPrice, 18.00);
  assert.equal(classicData.order.items[0].total, 36.00);
  assert.equal(classicData.order.items[1].unitPrice, 22.50);
  assert.equal(classicData.order.items[1].total, 22.50);

  // Test 4: Preliminary receipt variant with active cart quote
  const prelimReq = buildBrandedReceiptRequest({
    order: {
      items: [
        {
          product_name: 'Espresso Double',
          quantity: 3,
          unit_price: 12.00,
          total_price: 36.00,
          total: 36.00,
        },
      ],
      total: 36.00,
    },
    bill: {
      subtotal: 36.00,
      total: 36.00,
      paid_amount: 0,
      balance: 36.00,
    },
    business,
    documentVariant: 'preliminary',
  });
  assert.equal(prelimReq.items[0].price, 36.00);
  assert.equal(prelimReq.items[0].unitPrice, 12.00);
  assert.ok(prelimReq.header.banner?.includes('PRELIMINARY'), 'Banner must indicate preliminary');

  // Test 5: Reprint receipt retains accurate pricing
  const reprintReq = buildBrandedReceiptRequest({
    order: { ...realOrder, isReprint: true },
    bill: realBill,
    business,
    documentVariant: 'reprint',
  });
  assert.equal(reprintReq.items[0].price, 36.00);
  assert.equal(reprintReq.items[0].unitPrice, 18.00);
  assert.ok(reprintReq.header.banner?.includes('REPRINT'), 'Banner must indicate reprint');

  // Test 6: Pre-dispatch validation: throw on missing or NaN monetary values
  assert.throws(
    () => {
      buildBrandedReceiptRequest({
        order: {
          items: [{ product_name: 'Ghost Item', quantity: 1 }],
          total: 10.00,
        },
        bill: { total: 10.00 },
        business,
      });
    },
    /\[Receipt Error\] Required monetary value missing for item "Ghost Item"/,
    'Must fail pre-dispatch when item monetary value is missing',
  );

  assert.throws(
    () => {
      buildBrandedReceiptRequest({
        order: {
          items: [{ product_name: 'Corrupted Item', quantity: 1, unit_price: NaN }],
          total: 10.00,
        },
        bill: { total: 10.00 },
        business,
      });
    },
    /\[Receipt Error\] Required monetary value missing for item "Corrupted Item"/,
    'Must fail pre-dispatch when item monetary value is NaN',
  );

  assert.throws(
    () => {
      buildBrandedReceiptRequest({
        order: {
          order_number: 'ORD-ERR-1',
          items: [],
          total: undefined,
        },
        bill: { total: undefined },
        business,
      });
    },
    /\[Receipt Error\] Required document total missing or invalid/,
    'Must fail pre-dispatch when document total is missing on empty order',
  );

  // Test 7: KOT pricing toggles
  // 7A: showPrices = false -> prices are 0, totals empty
  const kotNoPrices = buildBrandedKotRequest({
    order: realOrder,
    items: realOrderItems,
    stationName: 'Espresso Bar',
    business,
    style: {
      target: 'kot',
      renderMode: 'branded_raster',
      operational: { showPrices: false, showTotals: false, headerCompact: false, prominentNotes: false },
      typography: { fontFamily: 'almarai', storeNameSize: 'medium', headerMetaSize: 'small', itemNamesSize: 'medium', itemModifiersSize: 'small', itemNotesSize: 'small', totalsSize: 'medium', footerSize: 'small' },
      frame: { borderStyle: 'solid', borderThickness: 1, borderRadius: 0, borderPadding: 4, dividerStyle: 'dashed' },
      logo: { showLogo: false, maxWidthPercent: 50, spacingBottomDots: 8, alignment: 'center' },
      direction: 'rtl',
      contrast: { densityPreset: 'dark', threshold: 140, inkGain: 0, ditheringMode: 'threshold' },
    },
  });
  assert.equal(kotNoPrices.items[0].price, 0);
  assert.equal(kotNoPrices.totals.length, 0);

  // 7B: showPrices = true -> prices and unitPrice resolved from real DB schema
  const kotWithPrices = buildBrandedKotRequest({
    order: realOrder,
    items: realOrderItems,
    stationName: 'Espresso Bar',
    business,
    style: {
      target: 'kot',
      renderMode: 'branded_raster',
      operational: { showPrices: true, showTotals: true, headerCompact: false, prominentNotes: false },
      typography: { fontFamily: 'almarai', storeNameSize: 'medium', headerMetaSize: 'small', itemNamesSize: 'medium', itemModifiersSize: 'small', itemNotesSize: 'small', totalsSize: 'medium', footerSize: 'small' },
      frame: { borderStyle: 'solid', borderThickness: 1, borderRadius: 0, borderPadding: 4, dividerStyle: 'dashed' },
      logo: { showLogo: false, maxWidthPercent: 50, spacingBottomDots: 8, alignment: 'center' },
      direction: 'rtl',
      contrast: { densityPreset: 'dark', threshold: 140, inkGain: 0, ditheringMode: 'threshold' },
    },
  });
  assert.equal(kotWithPrices.items[0].price, 36.00, 'KOT line total must be 36.00');
  assert.equal(kotWithPrices.items[0].unitPrice, 18.00, 'KOT unit price must be 18.00');
  assert.equal(kotWithPrices.totals.length, 1);
  assert.ok(kotWithPrices.totals[0].value.includes('58.50'), 'KOT subtotal must reflect sum of item prices');

  console.log('✓ All Real Receipt Prices tests passed successfully!');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
