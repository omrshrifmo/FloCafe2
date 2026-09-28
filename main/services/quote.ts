/**
 * Ephemeral Active-Cart Quote & Snapshot Service.
 *
 * Implements server-authoritative calculation for preliminary / pre-payment receipts
 * when the cart has no persisted database order or bill.
 *
 * SAFETY INVARIANTS:
 * - ZERO database mutation: never writes to `orders`, `bills`, `payments`, `held_orders`,
 *   `inventory_movements`, or `print_logs`.
 * - SERVER-AUTHORITATIVE: Never trusts client-supplied financial values (unit price, addon
 *   price, discount, taxes, charges). Loads catalog prices from DB and recomputes all totals.
 * - EXPLICIT SOURCE KIND: `source.kind === 'active_cart'`, with ephemeral `quoteId`.
 * - NO INVOICE NUMBER: Active cart quotes have no persisted invoice or bill number.
 */

import { getDatabase } from '../db';
import {
  calculateConfiguredChargeTaxes,
  calculateItemTax,
  getConfiguredChargeTaxCategories,
  normalizeChargeAmount,
  getActiveCountryPack,
  type Customer,
  type TenantInfo,
} from './tax';
import { recomputeOrderTotals, type OrderTotals } from './orders';
import { resolveItemAddons } from '../routes/orders';
import { applyPayableRounding } from './tax-engine';
import {
  getCurrencyFractionDigits,
  getCurrencyMinorUnitFactor,
  resolveTenantCurrency,
} from '../countries';
import type {
  ActiveCartPreliminaryPayload,
  ActiveCartSource,
  CustomerDocumentVariant,
  OrderItemSnapshot,
} from '../../shared/print/document';

type Database = ReturnType<typeof getDatabase>;

export interface ActiveCartQuoteTotals {
  readonly subtotal: number;
  readonly discountAmount: number;
  readonly discountedSubtotal: number;
  readonly taxAmount: number;
  readonly exclusiveTaxAmount: number;
  readonly packagingCharge: number;
  readonly deliveryCharge: number;
  readonly serviceCharge: number;
  readonly roundOff: number;
  readonly total: number;
  readonly balanceDue: number;
}

export interface ActiveCartQuoteResult {
  readonly quoteId: string;
  readonly createdAt: string;
  readonly source: ActiveCartSource;
  readonly order: any;
  readonly bill: any;
  readonly totals: ActiveCartQuoteTotals;
}

/** Generate a non-persistent quote reference ID. */
export function generateQuoteId(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const randomSuffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `Q-${timestamp}-${randomSuffix}`;
}

/**
 * Calculates a server-authoritative quote for an active cart without persisting
 * any records in the database.
 */
export function calculateActiveCartQuote(
  db: Database,
  payload: ActiveCartPreliminaryPayload,
): ActiveCartQuoteResult {
  if (!payload || typeof payload !== 'object') {
    throw Object.assign(new Error('Cart payload is required'), { statusCode: 400 });
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length === 0) {
    throw Object.assign(new Error('At least one item is required'), { statusCode: 400 });
  }

  const MAX_ITEMS = 100;
  if (items.length > MAX_ITEMS) {
    throw Object.assign(new Error(`A maximum of ${MAX_ITEMS} items is allowed per cart`), { statusCode: 400 });
  }

  const orderType = payload.orderType || 'dine_in';
  if (!['dine_in', 'takeaway', 'delivery', 'online'].includes(orderType)) {
    throw Object.assign(new Error('Valid order type is required (dine_in, takeaway, delivery, online)'), { statusCode: 400 });
  }

  // Read authoritative tenant settings
  const settingsRows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const settings: Record<string, string> = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));

  const country = settings.country || '';
  const currency = resolveTenantCurrency(settings.currency, country);
  const decimals = getCurrencyFractionDigits(currency);

  const tenantInfo: TenantInfo = {
    country,
    business_type: settings.business_type || 'restaurant',
    state_code: settings.state_code || '',
    currency,
    taxes_enabled: settings.taxes_enabled === 'true',
  };

  // Authoritative Customer reference
  let customer: Customer | null = null;
  if (payload.customerId) {
    const custRow = db.prepare('SELECT * FROM customers WHERE id = ? OR id = ?').get(String(payload.customerId), Number(payload.customerId) || 0) as any;
    if (custRow) {
      customer = custRow;
    }
  }

  // Authoritative Table reference
  let table: { id: string | number; number: string; name?: string } | null = null;
  if (payload.tableId) {
    const tblRow = db.prepare('SELECT id, number FROM tables WHERE id = ? OR id = ?').get(String(payload.tableId), Number(payload.tableId) || 0) as any;
    if (tblRow) {
      table = { id: tblRow.id, number: String(tblRow.number), name: String(tblRow.number) };
    }
  }

  // Authoritative Items & Addons recomputation
  let subtotal = 0;
  let totalTax = 0;
  let exclusiveTax = 0;
  const allTaxBreakdowns: any[] = [];
  const allTaxSnapshots: (string | null)[] = [];
  const orderItemsForSnapshot: OrderItemSnapshot[] = [];
  const rawItemsForPrinter: any[] = [];

  for (const item of items) {
    if (!item || !item.productId) {
      throw Object.assign(new Error('Item missing productId'), { statusCode: 400 });
    }

    const product = db.prepare('SELECT * FROM products WHERE id = ? OR id = ?').get(String(item.productId), Number(item.productId) || 0) as any;
    if (!product) {
      throw Object.assign(new Error(`Product ${item.productId} not found`), { statusCode: 404 });
    }

    // Authoritative unit price strictly from database
    const unitPrice = parseFloat(product.price);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw Object.assign(new Error(`Invalid price for ${product.name}: must be a non-negative number`), { statusCode: 400 });
    }

    const rawQty = Number(item.quantity);
    if (!Number.isFinite(rawQty) || rawQty <= 0) {
      throw Object.assign(new Error(`Invalid quantity for ${product.name}: must be a positive number`), { statusCode: 400 });
    }
    const quantity = rawQty;

    // Authoritative addons strictly resolved from catalog database
    let resolvedAddons: { id: string; name: string; price: number; quantity: number }[] = [];
    if (item.addons && Array.isArray(item.addons) && item.addons.length > 0) {
      try {
        resolvedAddons = resolveItemAddons(db, String(product.id), item.addons as any);
      } catch (addonErr: any) {
        throw Object.assign(new Error(addonErr.message || 'Invalid add-on'), { statusCode: 400 });
      }
    }

    let itemSubtotal = unitPrice * quantity;
    for (const addon of resolvedAddons) {
      const addonQty = addon.quantity || 1;
      itemSubtotal += (addon.price || 0) * addonQty * quantity;
    }

    const taxResult = calculateItemTax(tenantInfo, product, itemSubtotal, customer);
    totalTax += taxResult.tax_amount;
    if (taxResult.tax_type !== 'inclusive') {
      exclusiveTax += taxResult.tax_amount;
    }
    if (taxResult.tax_breakdown) {
      allTaxBreakdowns.push(taxResult.tax_breakdown);
    }
    const itemTaxSnapshotJson = taxResult.tax_snapshot ? JSON.stringify(taxResult.tax_snapshot) : null;
    allTaxSnapshots.push(itemTaxSnapshotJson);

    const itemTotal = itemSubtotal + (taxResult.tax_type === 'inclusive' ? 0 : taxResult.tax_amount);
    subtotal += itemSubtotal;

    orderItemsForSnapshot.push({
      productName: product.name,
      quantity,
      unitPrice,
      total: itemTotal,
      addons: resolvedAddons.map((a) => ({
        name: a.name,
        price: (a.price || 0) * (a.quantity || 1) * quantity,
        quantity: a.quantity || 1,
      })),
      specialInstructions: item.specialInstructions ? String(item.specialInstructions).slice(0, 200) : '',
    });

    rawItemsForPrinter.push({
      product_id: product.id,
      product_name: product.name,
      name: product.name,
      quantity,
      unit_price: unitPrice,
      price: unitPrice,
      total_price: itemTotal,
      total: itemTotal,
      addons: resolvedAddons.map((a) => ({
        name: a.name,
        price: a.price,
        quantity: a.quantity,
      })),
      special_instructions: item.specialInstructions || '',
      notes: item.specialInstructions || '',
    });
  }

  // Authoritative Charges: normalize requested charge amounts
  const pkgCharge = normalizeChargeAmount(payload.packagingCharge, 'packaging');
  const delCharge = normalizeChargeAmount(payload.deliveryCharge, 'delivery');
  const serviceCharge = normalizeChargeAmount(payload.serviceCharge, 'service_charge');

  const chargeCategories = getConfiguredChargeTaxCategories(tenantInfo.country);
  const chargeContext = {
    packaging_charge: pkgCharge,
    delivery_charge: delCharge,
    service_charge: serviceCharge,
    packaging_tax_category_id: chargeCategories.packaging?.categoryId || null,
    delivery_tax_category_id: chargeCategories.delivery?.categoryId || null,
    service_charge_tax_category_id: chargeCategories.service_charge?.categoryId || null,
  };

  // Authoritative Discount validation
  let discountAmount = 0;
  let discountType: 'percentage' | 'amount' | null = null;
  let discountValue = 0;
  const discountReason = payload.discount?.reason || null;

  if (payload.discount && payload.discount.value > 0) {
    const disc = payload.discount;
    if (!disc.type || !['percentage', 'amount'].includes(disc.type)) {
      throw Object.assign(new Error('discount type must be percentage or amount'), { statusCode: 400 });
    }
    const parsedVal = Number(disc.value);
    if (!Number.isFinite(parsedVal) || parsedVal < 0) {
      throw Object.assign(new Error('discount value must be a non-negative number'), { statusCode: 400 });
    }

    const discountMode = settings.discount_mode || 'percentage';
    if (discountMode === 'none') {
      throw Object.assign(new Error('Discounts are disabled'), { statusCode: 400 });
    }
    if (discountMode === 'flat' && disc.type === 'percentage') {
      throw Object.assign(new Error('Percentage discounts are disabled'), { statusCode: 400 });
    }
    if (discountMode === 'percentage' && disc.type === 'amount') {
      throw Object.assign(new Error('Flat amount discounts are disabled'), { statusCode: 400 });
    }

    if (disc.type === 'percentage') {
      const maxPercentage = parseFloat(settings.discount_max_percentage || '25');
      if (maxPercentage > 0 && parsedVal > maxPercentage) {
        throw Object.assign(new Error(`discount_value exceeds maximum percentage of ${maxPercentage}`), { statusCode: 400 });
      }
      discountAmount = Number(((subtotal * parsedVal) / 100).toFixed(decimals));
      discountType = 'percentage';
      discountValue = parsedVal;
    } else {
      const maxAmount = parseFloat(settings.discount_max_amount || '0');
      if (maxAmount > 0 && parsedVal > maxAmount) {
        throw Object.assign(new Error(`discount_value exceeds maximum amount of ${maxAmount}`), { statusCode: 400 });
      }
      discountAmount = Math.min(parsedVal, subtotal);
      discountAmount = Number(discountAmount.toFixed(decimals));
      discountType = 'amount';
      discountValue = parsedVal;
    }
  }

  // Recompute order totals using the standard shared business calculation
  const totals: OrderTotals = {
    subtotal,
    totalTax,
    exclusiveTax,
    allTaxBreakdowns,
    allTaxSnapshots,
    activeItems: [],
  };

  const recomputed = recomputeOrderTotals({
    tenantInfo,
    chargeContext,
    customer,
    totals,
    discountAmount,
    taxScaling: 'when-discounted',
  });

  const pack = getActiveCountryPack(tenantInfo.country);
  const { total: finalTotal, adjustment: roundOff } = applyPayableRounding(recomputed.total, pack, currency);

  const quoteId = generateQuoteId();
  const createdAt = new Date().toISOString();

  const source: ActiveCartSource = Object.freeze({
    kind: 'active_cart',
    quoteId,
    createdAt,
  });

  const order = {
    id: 0,
    order_number: '',
    created_at: createdAt,
    type: orderType,
    guest_count: payload.guestCount || null,
    table_id: table ? table.id : null,
    table: table ? { id: table.id, name: table.number } : null,
    customer_id: customer ? (customer as any).id : null,
    customer: customer || null,
    special_instructions: payload.orderNotes || null,
    online_platform: payload.onlinePlatform || null,
    external_order_id: payload.externalOrderId || null,
    items: rawItemsForPrinter,
    subtotal: recomputed.subtotal,
    discount_amount: discountAmount,
    discount_type: discountType,
    discount_value: discountValue,
    tax_amount: recomputed.taxRollup.taxAmount,
    tax_breakdown: JSON.stringify(recomputed.taxRollup.breakdowns),
    tax_snapshot: recomputed.taxRollup.snapshotJson,
    packaging_charge: pkgCharge,
    delivery_charge: delCharge,
    service_charge: serviceCharge,
    round_off: roundOff,
    total: finalTotal,
  };

  const bill = {
    id: 0,
    bill_number: '',
    order_id: 0,
    customer_id: customer ? (customer as any).id : null,
    subtotal: recomputed.subtotal,
    discount_amount: discountAmount,
    discount_type: discountType,
    discount_value: discountValue,
    discount_reason: discountReason,
    tax_amount: recomputed.taxRollup.taxAmount,
    tax_breakdown: JSON.stringify(recomputed.taxRollup.breakdowns),
    tax_snapshot: recomputed.taxRollup.snapshotJson,
    service_charge: serviceCharge,
    delivery_charge: delCharge,
    packaging_charge: pkgCharge,
    round_off: roundOff,
    total: finalTotal,
    paid_amount: 0,
    balance: finalTotal,
    payment_status: 'unpaid',
    payment_details: null,
    documentVariant: 'preliminary' as CustomerDocumentVariant,
    source,
    quoteId,
    created_at: createdAt,
  };

  return {
    quoteId,
    createdAt,
    source,
    order,
    bill,
    totals: {
      subtotal: recomputed.subtotal,
      discountAmount,
      discountedSubtotal: recomputed.discountedSubtotal,
      taxAmount: recomputed.taxRollup.taxAmount,
      exclusiveTaxAmount: recomputed.taxRollup.exclusiveTaxAmount,
      packagingCharge: pkgCharge,
      deliveryCharge: delCharge,
      serviceCharge: serviceCharge,
      roundOff,
      total: finalTotal,
      balanceDue: finalTotal,
    },
  };
}
