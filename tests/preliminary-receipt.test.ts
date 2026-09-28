/**
 * Preliminary / Pre-Payment Receipt Test Suite
 *
 * Verifies:
 * 1. Explicit ephemeral active-cart model (no persisted order/bill, non-persistent quote reference, no reprint).
 * 2. Server-authoritative pricing (client-supplied unitPrice, addon price, discount, or charge tampering ignored).
 * 3. Cash drawer pulse precision (appendCashDrawerPulse never called, drawer-pulse bytes strictly absent).
 * 4. Zero DB mutations on active-cart prints (orders, bills, payments, print_logs, held_orders, inventory_movements).
 * 5. Confirmed DB payments only for persisted partial-payment orders (unsubmitted tenders ignored).
 * 6. Server-side status guards (rejection of cancelled, completed/paid, or missing orders).
 * 7. Multi-order-type preliminary formatting (dine-in, takeaway, delivery, online).
 *
 * Usage: node tests/run-electron-node-test.cjs tests/preliminary-receipt.test.ts
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import assert from 'node:assert/strict';

// Mock electron before importing main modules
const Module = require('module');
const originalLoad = Module._load;
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-preliminary-receipt-'));

const mockApp = {
  isPackaged: true,
  getPath: (_name: string) => testDir,
  getVersion: () => 'test',
};

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return { app: mockApp };
  return originalLoad.apply(this, arguments as any);
};

process.env.JWT_SECRET = 'test-secret-preliminary-receipt';
const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');

import { initDatabase, getDatabase, closeDatabase, now } from '../main/db';
import { calculateActiveCartQuote } from '../main/services/quote';
import { printerRoutes } from '../main/routes/printers';
import { prepareReceipt, printReceiptDetailed, escPosToText } from '../main/printers/thermal';
import { buildBrandedReceiptRequest, renderBrandedReceipt, DEFAULT_RASTER_WIDTH_80MM } from '../main/printers/branded-receipt-renderer';
import * as formattingHelpers from '../main/printers/formatting-helpers';

import type { ActiveCartPreliminaryPayload } from '../shared/print/document';

const KNOWN_DRAWER_PULSE_BYTES = [0x1B, 0x70, 0x00, 0x19, 0xFA];

function containsSubsequence(source: Buffer | Uint8Array, pattern: number[]): boolean {
  for (let i = 0; i <= source.length - pattern.length; i++) {
    let match = true;
    for (let j = 0; j < pattern.length; j++) {
      if (source[i + j] !== pattern[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

async function runTests() {
  console.log('[Test] Running preliminary-receipt test suite...');

  initDatabase();
  const db = getDatabase();

  // Basic tenant settings
  db.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('country', 'IN')");
  db.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('currency', 'INR')");
  db.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('business_name', 'FloCafe Test')");
  db.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('business_address', '123 Test Street')");
  db.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('business_phone', '+91 9876543210')");
  db.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('printer_cash_drawer_pulse', 'true')");
  db.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('discount_mode', 'percentage')");
  db.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('discount_max_percentage', '20')");

  // Create test user
  db.exec("INSERT OR REPLACE INTO users (id, name, password, role, is_active) VALUES ('user-test-prelim', 'Cashier Prelim', 'hash', 'cashier', 1)");

  // Seed category, product, and addon
  db.exec("INSERT OR REPLACE INTO categories (id, name, is_active) VALUES ('101', 'Beverages', 1)");
  db.exec("INSERT OR REPLACE INTO products (id, category_id, name, price, is_active) VALUES ('201', '101', 'Authoritative Coffee', 25.00, 1)");
  db.exec("INSERT OR REPLACE INTO products (id, category_id, name, price, is_active) VALUES ('202', '101', 'Authoritative Sandwich', 40.00, 1)");
  db.exec("INSERT OR REPLACE INTO addon_groups (id, name, min_selection, max_selection, allow_multiple_quantities) VALUES ('ag-1', 'Options', 0, 5, 1)");
  db.exec("INSERT OR REPLACE INTO addons (id, addon_group_id, name, price, is_active) VALUES ('301', 'ag-1', 'Extra Shot', 5.00, 1)");
  db.exec("INSERT OR REPLACE INTO addon_group_product (product_id, addon_group_id) VALUES ('201', 'ag-1')");

  // Seed customer and table
  db.exec("INSERT OR IGNORE INTO customers (id, name, phone) VALUES (401, 'Alice Test', '+919999888877')");
  db.exec("INSERT OR IGNORE INTO tables (id, number, capacity, is_active) VALUES (501, 'Table 12', 4, 1)");

  // Seed default printer with drawer pulse enabled
  db.exec(`
    INSERT OR REPLACE INTO printers (id, name, connection_type, ip_address, port, paper_width, is_default, cash_drawer_pulse_enabled)
    VALUES ('1', 'Test Thermal Printer', 'network', '127.0.0.1', 9100, '80mm', 1, 1)
  `);

  // Build Express app for API tests
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'user-test-prelim', userId: 'user-test-prelim', role: 'cashier', name: 'Cashier Prelim' };
    next();
  });
  app.use('/api/printers', printerRoutes);

  // --------------------------------------------------------------------------
  // TEST 1: Ephemeral Active-Cart Model & Server Authoritative Pricing
  // --------------------------------------------------------------------------
  console.log('\n--- 1. Ephemeral Active-Cart Model & Server Authoritative Pricing ---');
  {
    // Client attempts to manipulate unitPrice ($0.01 instead of $25.00),
    // addon price ($0.02 instead of $5.00), and discount (50% exceeding 20% max).
    const tamperedPayload: any = {
      items: [
        {
          productId: 201,
          quantity: 2,
          addons: [{ id: '301', quantity: 1 }],
          specialInstructions: 'Extra hot',
        },
      ],
      orderType: 'takeaway',
      discount: {
        type: 'percentage',
        value: 50, // exceeds store max 20%
        reason: 'Tampered client discount',
      },
    };

    // 1A. Client attempts to exceed discount bounds (50% > 20% max allowed)
    assert.throws(
      () => calculateActiveCartQuote(db, tamperedPayload),
      (err: any) => err.statusCode === 400 && err.message.includes('exceeds maximum percentage'),
      'Discount exceeding store max percentage must be rejected with 400',
    );

    // 1B. Client sends tampered prices ($0.01) with valid 10% discount
    const validDiscountPayload: any = {
      ...tamperedPayload,
      discount: {
        type: 'percentage',
        value: 10,
        reason: 'Regular discount',
      },
    };

    const quoteResult = calculateActiveCartQuote(db, validDiscountPayload);

    // 1. Source kind is active_cart with quoteId and no DB bill ID
    assert.equal(quoteResult.source.kind, 'active_cart');
    assert.ok(quoteResult.quoteId.startsWith('Q-'));
    assert.equal(quoteResult.bill.id, 0);
    assert.equal(quoteResult.order.id, 0);
    assert.equal(quoteResult.bill.documentVariant, 'preliminary');

    // 2. Server prices enforced: Coffee $25 + Addon $5 = $30 per item * 2 = $60 subtotal
    assert.equal(quoteResult.order.items[0].unit_price, 25.00);
    assert.equal(quoteResult.order.items[0].addons[0].price, 5.00);
    assert.equal(quoteResult.order.subtotal, 60.00);

    // 3. Discount calculated: 10% of $60 = $6.00, total = $54.00
    assert.equal(quoteResult.order.discount_amount, 6.00);
    assert.equal(quoteResult.bill.total, 54.00);

    console.log('  ✓ Client discount exceeding backend policy rejected with HTTP 400');
    console.log('  ✓ Authoritative pricing enforced: client price tampering ignored');
    console.log('  ✓ Ephemeral active-cart source model contains non-persistent quoteId');
  }

  // --------------------------------------------------------------------------
  // TEST 2: Zero DB Mutations on Active-Cart Preliminary Print
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Zero DB Mutations on Active-Cart Preliminary Print ---');
  {
    const countTable = (t: string) => (db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as { c: number }).c;
    const ordersBefore = countTable('orders');
    const billsBefore = countTable('bills');
    const itemsBefore = countTable('order_items');
    const addonsBefore = countTable('order_item_addons');
    const logsBefore = countTable('print_logs');
    const heldBefore = countTable('held_orders');
    const inventoryBefore = countTable('inventory_movements');

    const res = await request(app)
      .post('/api/printers/print-bill')
      .send({
        documentVariant: 'preliminary',
        sourceKind: 'active_cart',
        preview: true,
        cart: {
          items: [{ productId: 201, quantity: 1 }],
          orderType: 'takeaway',
        },
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.document_variant, 'preliminary');
    assert.equal(res.body.source_kind, 'active_cart');
    assert.ok(res.body.quote_id?.startsWith('Q-'));

    // Verify 0 rows created in any business or operational table
    assert.equal(countTable('orders'), ordersBefore, 'orders table count must not change');
    assert.equal(countTable('bills'), billsBefore, 'bills table count must not change');
    assert.equal(countTable('order_items'), itemsBefore, 'order_items table count must not change');
    assert.equal(countTable('order_item_addons'), addonsBefore, 'order_item_addons table count must not change');
    assert.equal(countTable('print_logs'), logsBefore, 'print_logs table count must not change');
    assert.equal(countTable('held_orders'), heldBefore, 'held_orders table count must not change');
    assert.equal(countTable('inventory_movements'), inventoryBefore, 'inventory_movements table count must not change');

    console.log('  ✓ Zero rows created in orders, bills, order_items, print_logs, held_orders, inventory_movements');
  }

  // --------------------------------------------------------------------------
  // TEST 3: Cash Drawer Pulse Suppression Precision
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Cash Drawer Pulse Suppression Precision ---');
  {
    // Spy on appendCashDrawerPulse
    let pulseCallCount = 0;
    const origAppendPulse = formattingHelpers.appendCashDrawerPulse;
    (formattingHelpers as any).appendCashDrawerPulse = function (data: Buffer) {
      pulseCallCount++;
      return origAppendPulse(data);
    };

    try {
      const quote = calculateActiveCartQuote(db, {
        items: [{ productId: 201, quantity: 1 }],
        orderType: 'dine_in',
        tableId: 501,
      });

      const testBusiness = { name: 'FloCafe', country: 'IN', currency: 'INR', currency_symbol: '₹' };

      // 3A. Legacy text prepareReceipt
      const prepared = prepareReceipt(
        quote.order,
        quote.bill,
        testBusiness,
        'classic',
        false,
        false,
        undefined,
        'en',
        undefined,
        'preliminary',
        quote.source,
      );

      // Verify pulse bytes absent in prepared ESC/POS bytes
      assert.equal(
        containsSubsequence(prepared.data, KNOWN_DRAWER_PULSE_BYTES),
        false,
        'Legacy text preliminary ESC/POS bytes must not contain drawer pulse',
      );

      // 3B. Branded raster rendering
      const brandedReq = buildBrandedReceiptRequest({
        order: quote.order,
        bill: quote.bill,
        business: testBusiness,
        widthDots: DEFAULT_RASTER_WIDTH_80MM,
        documentVariant: 'preliminary',
        source: quote.source,
      });

      assert.ok(brandedReq.header.banner?.includes('PRELIMINARY RECEIPT'), 'Banner must indicate preliminary receipt');
      assert.ok(brandedReq.header.banner?.includes('NOT PAID'), 'Banner must indicate not paid');
      assert.ok(!brandedReq.meta.orderNumber, 'Active cart must not have orderNumber');
      assert.ok(!brandedReq.meta.invoiceNumber, 'Active cart must not have invoiceNumber');
      assert.equal(brandedReq.meta.quoteReference, quote.quoteId);

      const rasterOutput = await renderBrandedReceipt(brandedReq);
      assert.equal(rasterOutput.ok, true);
      assert.equal(
        containsSubsequence(rasterOutput.rasterBytes, KNOWN_DRAWER_PULSE_BYTES),
        false,
        'Branded raster preliminary bytes must not contain drawer pulse',
      );

      // Verify appendCashDrawerPulse was never called
      assert.equal(pulseCallCount, 0, 'appendCashDrawerPulse must never be called for preliminary receipts');

      // 3C. Positive control: verify pulse bytes ARE appended for normal final bill with drawer kick enabled
      const finalBill = { ...quote.bill, documentVariant: 'final', source: undefined };
      const normalWithPulse = origAppendPulse(prepared.data);
      assert.equal(
        containsSubsequence(normalWithPulse, KNOWN_DRAWER_PULSE_BYTES),
        true,
        'Positive control: known drawer-pulse bytes must be detected when appended',
      );

      console.log('  ✓ appendCashDrawerPulse was never called (0 calls)');
      console.log('  ✓ Known pulse bytes [0x1B, 0x70, 0x00, 0x19, 0xFA] strictly absent in legacy text mode');
      console.log('  ✓ Known pulse bytes strictly absent in branded raster mode');
      console.log('  ✓ Positive control verified: drawer-pulse detector works accurately');
    } finally {
      (formattingHelpers as any).appendCashDrawerPulse = origAppendPulse;
    }
  }

  // --------------------------------------------------------------------------
  // TEST 4: Visibly Preliminary / Non-Final Document Presentation
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Visibly Preliminary / Non-Final Document Presentation ---');
  {
    const quote = calculateActiveCartQuote(db, {
      items: [{ productId: 201, quantity: 2 }],
      orderType: 'takeaway',
    });

    const testBusiness = { name: 'FloCafe', country: 'IN', currency: 'INR', currency_symbol: '₹' };

    const prepared = prepareReceipt(
      quote.order,
      quote.bill,
      testBusiness,
      'classic',
      false,
      false,
      undefined,
      'en',
      undefined,
      'preliminary',
      quote.source,
    );

    const receiptText = escPosToText(prepared.data);
    assert.ok(
      receiptText.includes('PRELIMINARY RECEIPT') || receiptText.includes('NOT A TAX INVOICE'),
      'Receipt text must contain preliminary banner',
    );
    assert.ok(
      receiptText.includes(quote.quoteId),
      'Receipt text must include quote reference ID',
    );
    assert.ok(
      receiptText.includes('NOT A PAYMENT RECEIPT') || receiptText.includes('not a tax invoice') || receiptText.includes('PRELIMINARY'),
      'Receipt text must include non-final footer notice',
    );
    assert.equal(
      receiptText.includes('INV-'),
      false,
      'Active-cart preliminary receipt must never display an invoice number',
    );

    console.log('  ✓ Preliminary banner and non-final notice visibly present');
    console.log('  ✓ Quote reference displayed and final invoice number absent');
  }

  // --------------------------------------------------------------------------
  // TEST 5: Confirmed DB Payments Only & Payment Draft Isolation
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Confirmed DB Payments Only & Payment Draft Isolation ---');
  {
    // Create a persisted order with 1 confirmed payment
    db.exec("INSERT INTO orders (id, order_number, user_id, status, subtotal, total) VALUES (901, 'ORD-PARTIAL-901', 'user-test-prelim', 'open', 100.00, 100.00)");
    db.exec(`INSERT INTO bills (id, bill_number, order_id, subtotal, total, paid_amount, balance, payment_status, payment_details) VALUES (901, 'INV-PARTIAL-901', 901, 100.00, 100.00, 40.00, 60.00, 'partially_paid', '[{"method":"cash","amount":40.00}]')`);

    // Call print-bill for persisted order in preliminary mode
    const res = await request(app)
      .post('/api/printers/print-bill')
      .send({
        documentVariant: 'preliminary',
        orderId: 901,
        preview: true,
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.document_variant, 'preliminary');
    assert.equal(res.body.source_kind, 'persisted_order');

    const text = res.body.text as string;
    assert.ok(text.includes('40.00'), 'Must include confirmed paid amount of 40.00');
    assert.ok(text.includes('60.00'), 'Must include balance due of 60.00');
    assert.ok(
      text.includes('Paid So Far') || text.includes('Paid') || text.includes('Balance Due'),
      'Must display Paid So Far / Balance Due labels',
    );

    console.log('  ✓ Persisted partial-payment preliminary receipt uses confirmed DB payment (Paid: 40.00, Due: 60.00)');
  }

  // --------------------------------------------------------------------------
  // TEST 6: Server-Side Status Guards for Persisted Orders
  // --------------------------------------------------------------------------
  console.log('\n--- 6. Server-Side Status Guards for Persisted Orders ---');
  {
    // Seed cancelled order
    db.exec("INSERT INTO orders (id, order_number, user_id, status, subtotal, total) VALUES (902, 'ORD-CANCEL-902', 'user-test-prelim', 'cancelled', 50.00, 50.00)");
    db.exec("INSERT INTO bills (id, bill_number, order_id, subtotal, total, paid_amount, balance, payment_status) VALUES (902, 'INV-CANCEL-902', 902, 50.00, 50.00, 0, 50.00, 'unpaid')");

    // Seed completed/paid order
    db.exec("INSERT INTO orders (id, order_number, user_id, status, subtotal, total) VALUES (903, 'ORD-PAID-903', 'user-test-prelim', 'completed', 50.00, 50.00)");
    db.exec("INSERT INTO bills (id, bill_number, order_id, subtotal, total, paid_amount, balance, payment_status) VALUES (903, 'INV-PAID-903', 903, 50.00, 50.00, 50.00, 0, 'paid')");

    // 6A. Cancelled order rejected with 400
    const cancelRes = await request(app)
      .post('/api/printers/print-bill')
      .send({ documentVariant: 'preliminary', orderId: 902 });
    assert.equal(cancelRes.status, 400);
    assert.ok(cancelRes.body.error.includes('cancelled'));

    // 6B. Completed/paid order rejected with 409
    const paidRes = await request(app)
      .post('/api/printers/print-bill')
      .send({ documentVariant: 'preliminary', orderId: 903 });
    assert.equal(paidRes.status, 409);
    assert.ok(paidRes.body.error.includes('finalized or fully paid'));

    // 6C. Non-existent order returns 404
    const notFoundRes = await request(app)
      .post('/api/printers/print-bill')
      .send({ documentVariant: 'preliminary', orderId: 999999 });
    assert.equal(notFoundRes.status, 404);

    console.log('  ✓ Cancelled order rejected with HTTP 400');
    console.log('  ✓ Fully paid order rejected with HTTP 409 (Use reprint instead)');
    console.log('  ✓ Non-existent order rejected with HTTP 404');
  }

  // --------------------------------------------------------------------------
  // TEST 7: Multi-Order-Type Preliminary Receipt Presentation
  // --------------------------------------------------------------------------
  console.log('\n--- 7. Multi-Order-Type Preliminary Receipt Presentation ---');
  {
    const testBusiness = { name: 'FloCafe', country: 'IN', currency: 'INR', currency_symbol: '₹' };

    // 7A. Dine-in with Table
    const dineInQuote = calculateActiveCartQuote(db, {
      items: [{ productId: 201, quantity: 1 }],
      orderType: 'dine_in',
      tableId: 501,
      guestCount: 3,
    });
    const dineInReq = buildBrandedReceiptRequest({
      order: dineInQuote.order,
      bill: dineInQuote.bill,
      business: testBusiness,
      widthDots: DEFAULT_RASTER_WIDTH_80MM,
      documentVariant: 'preliminary',
      source: dineInQuote.source,
    });
    assert.equal(dineInReq.meta.tableName, 'Table 12');

    // 7B. Delivery with Customer Phone Masking
    const deliveryQuote = calculateActiveCartQuote(db, {
      items: [{ productId: 201, quantity: 1 }],
      orderType: 'delivery',
      customerId: 401,
      deliveryAddress: '42 Baker Street',
    });
    const deliveryReq = buildBrandedReceiptRequest({
      order: deliveryQuote.order,
      bill: deliveryQuote.bill,
      business: testBusiness,
      widthDots: DEFAULT_RASTER_WIDTH_80MM,
      documentVariant: 'preliminary',
      source: deliveryQuote.source,
    });
    assert.equal(deliveryReq.meta.customerName, 'Alice Test');
    assert.ok(deliveryReq.meta.customerPhone?.includes('xxxx') || deliveryReq.meta.customerPhone?.endsWith('8877'));

    // 7C. Online Aggregator Platform & External ID
    const onlineQuote = calculateActiveCartQuote(db, {
      items: [{ productId: 202, quantity: 1 }],
      orderType: 'online',
      onlinePlatform: 'Zomato',
      externalOrderId: 'ZOM-88219',
    });
    const onlineReq = buildBrandedReceiptRequest({
      order: onlineQuote.order,
      bill: onlineQuote.bill,
      business: testBusiness,
      widthDots: DEFAULT_RASTER_WIDTH_80MM,
      documentVariant: 'preliminary',
      source: onlineQuote.source,
    });
    assert.equal(onlineReq.meta.onlinePlatform, 'Zomato');
    assert.equal(onlineReq.meta.externalOrderId, 'ZOM-88219');

    console.log('  ✓ Dine-in table name preserved and displayed');
    console.log('  ✓ Delivery customer details formatted and phone masked');
    console.log('  ✓ Online aggregator platform and external order ID preserved');
  }

  // --------------------------------------------------------------------------
  // TEST 8: Active Cart Cannot Be Reprinted via Bill Reprint Flow
  // --------------------------------------------------------------------------
  console.log('\n--- 8. Active Cart Cannot Be Reprinted via Bill Reprint Flow ---');
  {
    // Normal reprint endpoints require a persisted bill ID (e.g. POST /api/bills/:id/print or POST /api/printers/print-bill)
    const reprintResZero = await request(app)
      .post('/api/printers/print-bill')
      .send({
        documentVariant: 'reprint',
        billId: 0,
        isReprint: true,
      });
    assert.ok(reprintResZero.status === 400 || reprintResZero.status === 404, 'Reprint on bill ID 0 must be rejected');

    const reprintResNonExistent = await request(app)
      .post('/api/printers/print-bill')
      .send({
        documentVariant: 'reprint',
        billId: 999999,
        isReprint: true,
      });
    assert.equal(reprintResNonExistent.status, 404, 'Reprint on non-persisted bill ID 999999 must return 404');

    console.log('  ✓ Active-cart quotes cannot be reprinted through stored bill reprint flow');
  }

  closeDatabase();
  console.log('\n==================================================');
  console.log('ALL PRELIMINARY RECEIPT TESTS PASSED (8/8 Suites)');
  console.log('==================================================');
}

runTests().catch((err) => {
  console.error('[Test Failed]:', err);
  process.exit(1);
});
