/**
 * Center-Aligned, High-Contrast Z-Report and Pre-Blind Slip Templates
 *
 * 100% pure centered column layout with zero side text.
 * Printed in a narrow middle column (max-width: 190px; margin: 0 auto; padding: 10px 28px; text-align: center;)
 * guaranteeing generous safety margins on thermal rolls so text never clips on rollers/margins.
 */

export interface PreBlindSlipData {
  storeName?: string;
  branchName?: string;
  closureNumber?: string | number;
  date?: string;
  time?: string;
  cashierName?: string;
  denominations?: Record<string, number>;
  declaredCash?: number;
  declaredCardSlips?: number;
  declaredWalletSlips?: number;
  notes?: string;
}

export interface SoldItemDetail {
  product_id?: number | string;
  product_name: string;
  variant_name?: string;
  bulk_qty: number;
  unit_price_excl_tax: number;
  total_excl_tax: number;
  item_tax_amount?: number;
  total_incl_tax?: number;
}

export interface OrderItemDetail {
  id?: number | string;
  order_number: string;
  order_type?: string;
  status?: string;
  items_qty?: number;
  subtotal_excl_tax?: number;
  discount_amount?: number;
  tax_amount?: number;
  total_incl_tax: number;
  payment_method?: string;
  created_at?: string;
}

export interface PaymentMethodDetail {
  method: string;
  label_en: string;
  label_ar: string;
  transactions_count: number;
  total_amount: number;
  tendered_amount?: number;
  change_amount?: number;
}

export interface PaymentItemDetail {
  id?: number | string;
  order_number: string;
  method: string;
  amount: number;
  tendered?: number;
  change?: number;
  created_at?: string;
}

export interface CashMovementDetail {
  id?: string;
  movement_type: string;
  label_en: string;
  label_ar: string;
  direction: 'in' | 'out';
  amount: number;
  reason?: string;
  created_by_name?: string;
  created_at?: string;
}

export interface CashMovementsSummary {
  opening_cash: number;
  cash_sales: number;
  pay_in_total: number;
  pay_out_total: number;
  cash_expenses_total: number;
  safe_drops_total: number;
  cash_refunds_total: number;
  expected_cash: number;
}

export interface FullZReportSlipData {
  storeName?: string;
  branchName?: string;
  taxNumber?: string;
  closureNumber?: string | number;
  zNumber?: string | number;
  periodStart?: string;
  periodEnd?: string;
  closedBy?: string;
  closedByRole?: string;

  // 1. Core Cash & Reconciliation with explicit Deficit / Surplus
  openingCash?: number;
  cashIn?: number;
  cashOut?: number;
  refunds?: number;
  expectedCash?: number;
  actualCash?: number;
  cashVariance?: number;
  deficitAmount?: number;
  deficit_amount?: number;
  surplusAmount?: number;
  surplus_amount?: number;
  varianceStatus?: 'deficit' | 'surplus' | 'exact' | string;
  variance_status?: string;
  preblindCount?: number | null;

  // 2. Revenue & Taxes
  grossSales?: number;
  discounts?: number;
  taxes?: number;
  deliveryFees?: number;
  netSales?: number;

  // 3. Granular Sold Items Breakdown & Pre-Tax Totals
  soldItemsBreakdown?: SoldItemDetail[];
  sold_items_breakdown?: SoldItemDetail[];
  totalSoldItemsQty?: number;
  total_sold_items_qty?: number;
  totalSalesExclTax?: number;
  total_sales_excl_tax?: number;
  totalTaxQuantity?: number;
  total_tax_quantity?: number;
  totalTaxAmount?: number;
  total_tax_amount?: number;
  soldItemsCount?: number;

  // 4. Granular Orders Breakdown & List
  ordersCount?: number;
  avgTicket?: number;
  dineInOrders?: number;
  dineInSales?: number;
  takeawayOrders?: number;
  takeawaySales?: number;
  deliveryOrders?: number;
  deliverySales?: number;
  voidedOrdersCount?: number;
  carryOverTablesCount?: number;
  ordersBreakdown?: {
    dine_in?: { count: number; total: number };
    takeaway?: { count: number; total: number };
    delivery?: { count: number; total: number };
    cancelled?: { count: number; total: number };
  };
  orders_breakdown?: {
    dine_in?: { count: number; total: number };
    takeaway?: { count: number; total: number };
    delivery?: { count: number; total: number };
    cancelled?: { count: number; total: number };
  };
  ordersList?: OrderItemDetail[];
  orders_list?: OrderItemDetail[];

  // 5. Granular Payment Methods & Payments List
  cashSales?: number;
  cardSales?: number;
  walletSales?: number;
  customPaymentSales?: number;
  aggregatorSales?: number;
  aggregatorCommissions?: number;
  paymentMethodsDetailed?: PaymentMethodDetail[];
  payment_methods_detailed?: PaymentMethodDetail[];
  paymentsList?: PaymentItemDetail[];
  payments_list?: PaymentItemDetail[];

  // 6. Granular Cash Movements & Summary
  cashMovementsSummary?: CashMovementsSummary;
  cash_movements_summary?: CashMovementsSummary;
  cashMovementsDetailed?: CashMovementDetail[];
  cash_movements_detailed?: CashMovementDetail[];

  // 7. Anti-Theft & Integrity Audit
  safeDropsTotal?: number;
  safeBalance?: number;
  anomalyCount?: number;
  anomalyRiskScore?: number;
  postPrintDeletionsCount?: number;
  noSaleDrawerOpensCount?: number;

  // 8. BOM Cost & Profitability
  expectedBomCost?: number;
  expectedGrossProfit?: number;
  authorizedWasteCost?: number;
  operatingExpenses?: number;
  expectedNetProfit?: number;
  profitMarginPct?: number;

  notes?: string;
  [key: string]: unknown;
}

export function renderPreBlindSlipHtml(data: PreBlindSlipData, language: 'ar' | 'en' = 'ar'): string {
  const isAr = language === 'ar';
  const dir = isAr ? 'rtl' : 'ltr';
  const title = isAr
    ? 'إيصال تسليم مبدئي أعمى للكاشير'
    : 'PRE-BLIND CASHIER SHIFT HANDOVER SLIP';
  const subtitle = isAr ? 'تسليم نقدية الوردية' : 'CASH DRAWER COUNT HANDOVER';

  const denomRows = data.denominations
    ? Object.entries(data.denominations)
        .filter(([, count]) => count > 0)
        .map(([denom, count]) => `<div style="text-align: center;">${denom} x ${count} = ${(Number(denom) * count).toFixed(2)}</div>`)
        .join('')
    : '';

  const declaredCash = Number(data.declaredCash || 0).toFixed(2);

  return `
  <div dir="${dir}" style="text-align: center; font-family: monospace, sans-serif; color: #000; width: 100%; max-width: 190px; margin: 0 auto; padding: 10px 28px; line-height: 1.35; font-size: 11px;">
    <div style="font-size: 16px; font-weight: 900; margin-bottom: 2px; text-align: center;">${data.storeName || 'FloCafe'}</div>
    ${data.branchName ? `<div style="font-size: 12px; font-weight: bold; margin-bottom: 3px; text-align: center;">${data.branchName}</div>` : ''}

    <div style="border-top: 2px dashed #000; border-bottom: 2px dashed #000; padding: 5px 0; margin: 6px 0; text-align: center;">
      <div style="font-size: 13px; font-weight: 900; text-align: center;">${title}</div>
      <div style="font-size: 11px; font-weight: bold; text-align: center;">${subtitle}</div>
    </div>

    <div style="margin-bottom: 6px; text-align: center;">
      ${data.closureNumber ? `<div style="text-align: center;"><strong>${isAr ? 'رقم الإغلاق' : 'Closure #'}:</strong> ${data.closureNumber}</div>` : ''}
      <div style="text-align: center;"><strong>${isAr ? 'التاريخ والوقت' : 'Date/Time'}:</strong> ${data.date || new Date().toISOString().slice(0, 10)} ${data.time || ''}</div>
      <div style="text-align: center;"><strong>${isAr ? 'الكاشير' : 'Cashier'}:</strong> ${data.cashierName || '-'}</div>
    </div>

    ${denomRows ? `
      <div style="border-top: 1px dashed #000; padding: 5px 0; margin-top: 5px; text-align: center;">
        <div style="font-weight: bold; margin-bottom: 3px; text-align: center;">${isAr ? 'تفقيط الفئات النقدية' : 'Denominations Breakdown'}</div>
        ${denomRows}
      </div>
    ` : ''}

    <div style="border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 6px 0; margin: 6px 0; text-align: center;">
      <div style="font-size: 11px; font-weight: bold; text-align: center;">${isAr ? 'النقدية الفعلية المعلنة بالدرج' : 'Declared Physical Cash'}</div>
      <div style="font-size: 18px; font-weight: 900; margin-top: 2px; text-align: center;">${declaredCash}</div>
    </div>

    <div style="margin-bottom: 6px; text-align: center;">
      <div style="text-align: center;"><strong>${isAr ? 'إيصالات الفيزا / البطاقات' : 'Declared Card Slips'}:</strong> ${Number(data.declaredCardSlips || 0).toFixed(2)}</div>
      <div style="text-align: center;"><strong>${isAr ? 'إيصالات المحافظ / إنستاباي' : 'Declared Wallet/InstaPay'}:</strong> ${Number(data.declaredWalletSlips || 0).toFixed(2)}</div>
    </div>

    ${data.notes ? `
      <div style="border-top: 1px dashed #000; padding: 5px 0; text-align: center;">
        <div style="text-align: center;"><strong>${isAr ? 'ملاحظات' : 'Notes'}:</strong> ${data.notes}</div>
      </div>
    ` : ''}

    <div style="border-top: 1px dashed #000; margin-top: 12px; padding-top: 8px; text-align: center;">
      <div style="border-top: 1px solid #000; width: 130px; margin: 8px auto 0 auto; padding-top: 3px; text-align: center;">${isAr ? 'توقيع الكاشير' : 'Cashier Signature'}</div>
      <div style="border-top: 1px solid #000; width: 130px; margin: 12px auto 0 auto; padding-top: 3px; text-align: center;">${isAr ? 'توقيع المستلم' : 'Manager Signature'}</div>
    </div>
  </div>
  `;
}

export function renderFullZReportSlipHtml(data: FullZReportSlipData, language: 'ar' | 'en' = 'ar'): string {
  const isAr = language === 'ar';
  const dir = isAr ? 'rtl' : 'ltr';
  const title = isAr
    ? 'تقرير إغلاق الوردية واليوم الشامل (Z-REPORT)'
    : 'FULL DAY / SHIFT Z-REPORT';

  // 1. Reconciliation & Explicit Deficit / Surplus
  const expectedCash = Number(data.expectedCash ?? data.expected_cash ?? 0);
  const actualCash = Number(data.actualCash ?? data.actual_cash ?? 0);
  const diff = actualCash - expectedCash;
  const rawDeficit = Number(data.deficitAmount ?? data.deficit_amount ?? (diff < -0.009 ? Math.abs(diff) : 0));
  const rawSurplus = Number(data.surplusAmount ?? data.surplus_amount ?? (diff > 0.009 ? diff : 0));

  let statusLabel = isAr ? 'مطابق تماماً (0.00)' : 'Exact (0.00)';
  if (rawDeficit > 0.009) {
    statusLabel = isAr ? `عجز نقدية: -${rawDeficit.toFixed(2)}` : `Cash Deficit: -${rawDeficit.toFixed(2)}`;
  } else if (rawSurplus > 0.009) {
    statusLabel = isAr ? `فائض نقدية: +${rawSurplus.toFixed(2)}` : `Cash Surplus: +${rawSurplus.toFixed(2)}`;
  }

  // 2. Sold Items & Tax Metrics
  const soldItems = data.soldItemsBreakdown || data.sold_items_breakdown || [];
  const totalSoldQty = Number(data.totalSoldItemsQty ?? data.total_sold_items_qty ?? (soldItems.reduce((acc, i) => acc + (Number(i.bulk_qty) || 0), 0) || data.soldItemsCount || 0));
  const totalSalesExclTax = Number(data.totalSalesExclTax ?? data.total_sales_excl_tax ?? soldItems.reduce((acc, i) => acc + (Number(i.total_excl_tax) || 0), 0));
  const totalTaxQty = Number(data.totalTaxQuantity ?? data.total_tax_quantity ?? soldItems.filter(i => Number(i.item_tax_amount || 0) > 0).reduce((acc, i) => acc + (Number(i.bulk_qty) || 0), 0));
  const totalTaxAmt = Number(data.totalTaxAmount ?? data.total_tax_amount ?? (data.taxes || 0));

  // 3. Orders Breakdown
  const ordersCount = Number(data.ordersCount ?? data.total_orders_count ?? 0);
  const avgTicket = Number(data.avgTicket ?? (ordersCount > 0 ? (Number(data.netSales ?? data.net_sales ?? 0) / ordersCount) : 0));
  const dineInSales = Number(data.dineInSales ?? data.dine_in_sales ?? data.ordersBreakdown?.dine_in?.total ?? data.orders_breakdown?.dine_in?.total ?? 0);
  const dineInCount = Number(data.dineInOrders ?? data.ordersBreakdown?.dine_in?.count ?? data.orders_breakdown?.dine_in?.count ?? 0);
  const takeawaySales = Number(data.takeawaySales ?? data.takeaway_sales ?? data.ordersBreakdown?.takeaway?.total ?? data.orders_breakdown?.takeaway?.total ?? 0);
  const takeawayCount = Number(data.takeawayOrders ?? data.ordersBreakdown?.takeaway?.count ?? data.orders_breakdown?.takeaway?.count ?? 0);
  const deliverySales = Number(data.deliverySales ?? data.delivery_sales ?? data.ordersBreakdown?.delivery?.total ?? data.orders_breakdown?.delivery?.total ?? 0);
  const deliveryCount = Number(data.deliveryOrders ?? data.ordersBreakdown?.delivery?.count ?? data.orders_breakdown?.delivery?.count ?? 0);
  const cancelledCount = Number(data.voidedOrdersCount ?? data.ordersBreakdown?.cancelled?.count ?? data.orders_breakdown?.cancelled?.count ?? 0);

  // 4. Payments Detailed
  const detailedMethods = data.paymentMethodsDetailed || data.payment_methods_detailed || [];
  const cashSales = Number(data.cashSales ?? data.cash_sales ?? 0);
  const cardSales = Number(data.cardSales ?? data.card_sales ?? 0);
  const walletSales = Number(data.walletSales ?? data.wallet_sales ?? 0);
  const customSales = Number(data.customPaymentSales ?? 0);
  const aggregatorSales = Number(data.aggregatorSales ?? data.aggregator_sales ?? 0);

  // 5. Cash Movements Summary & Detailed
  const movSummary = data.cashMovementsSummary || data.cash_movements_summary;
  const openingCash = Number(movSummary?.opening_cash ?? data.openingCash ?? data.opening_cash ?? 0);
  const payIn = Number(movSummary?.pay_in_total ?? data.cashIn ?? data.cash_in ?? 0);
  const payOut = Number(movSummary?.pay_out_total ?? data.cashOut ?? data.cash_out ?? 0);
  const expenses = Number(movSummary?.cash_expenses_total ?? data.operatingExpenses ?? data.expenses_total ?? 0);
  const safeDrops = Number(movSummary?.safe_drops_total ?? data.safeDropsTotal ?? data.safe_drops_total ?? 0);
  const refunds = Number(movSummary?.cash_refunds_total ?? data.refunds ?? data.refunds_total ?? 0);
  const detailedMovements = data.cashMovementsDetailed || data.cash_movements_detailed || [];

  return `
  <div dir="${dir}" style="text-align: center; font-family: monospace, sans-serif; color: #000; width: 100%; max-width: 190px; margin: 0 auto; padding: 10px 28px; line-height: 1.35; font-size: 11px;">
    <!-- Section 1: Header & Period -->
    <div style="font-size: 16px; font-weight: 900; margin-bottom: 2px; text-align: center;">${data.storeName || 'FloCafe'}</div>
    ${data.branchName ? `<div style="font-size: 12px; font-weight: bold; margin-bottom: 2px; text-align: center;">${data.branchName}</div>` : ''}
    ${data.taxNumber ? `<div style="font-size: 10px; text-align: center;">${isAr ? 'الرقم الضريبي' : 'Tax Reg #'}: ${data.taxNumber}</div>` : ''}

    <div style="border-top: 2px dashed #000; border-bottom: 2px dashed #000; padding: 5px 0; margin: 6px 0; text-align: center;">
      <div style="font-size: 12px; font-weight: 900; text-align: center;">${title}</div>
      ${data.zNumber ? `<div style="font-size: 11px; font-weight: bold; text-align: center;">Z-ID: #${data.zNumber} ${data.closureNumber ? `| #${data.closureNumber}` : ''}</div>` : ''}
    </div>

    <div style="margin-bottom: 6px; font-size: 10px; text-align: center;">
      <div style="text-align: center;"><strong>${isAr ? 'بداية الفترة' : 'Period Start'}:</strong> ${data.periodStart || data.period_start || '-'}</div>
      <div style="text-align: center;"><strong>${isAr ? 'نهاية الفترة' : 'Period End'}:</strong> ${data.periodEnd || data.period_end || '-'}</div>
      <div style="text-align: center;"><strong>${isAr ? 'تم الإغلاق بواسطة' : 'Closed By'}:</strong> ${data.closedBy || data.closed_by_name || '-'} ${data.closedByRole ? `(${data.closedByRole})` : ''}</div>
    </div>

    <!-- Section 2: Cash Reconciliation & Explicit Deficit / Surplus -->
    <div style="border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 6px 0; margin: 6px 0; text-align: center;">
      <div style="font-weight: 900; font-size: 11px; margin-bottom: 3px; text-align: center;">${isAr ? '--- تسوية درج النقدية ---' : '--- CASH DRAWER RECONCILIATION ---'}</div>
      <div style="text-align: center;">${isAr ? 'النقدية المتوقعة بالدرج' : 'Expected Cash'}: <strong>${expectedCash.toFixed(2)}</strong></div>
      <div style="text-align: center;">${isAr ? 'النقدية الفعلية المعدودة' : 'Counted Physical Cash'}: <strong>${actualCash.toFixed(2)}</strong></div>
      <div style="border-top: 1px dashed #000; margin: 4px 0; padding-top: 4px; text-align: center;">
        <div style="font-weight: 900; font-size: 12px; text-align: center;">${statusLabel}</div>
        <div style="text-align: center;">${isAr ? 'العجز الفعلي' : 'Actual Deficit'}: <strong>${rawDeficit.toFixed(2)}</strong></div>
        <div style="text-align: center;">${isAr ? 'الفائض الفعلي' : 'Actual Surplus'}: <strong>${rawSurplus.toFixed(2)}</strong></div>
      </div>
      ${data.preblindCount !== null && data.preblindCount !== undefined ? `<div style="text-align: center;">${isAr ? 'تسليم الكاشير المبدئي' : 'Cashier Pre-Blind Count'}: ${Number(data.preblindCount).toFixed(2)}</div>` : ''}
    </div>

    <!-- Section 3: Cash Movements Details -->
    <div style="border-top: 1px dashed #000; padding: 5px 0; text-align: center;">
      <div style="font-weight: 900; margin-bottom: 3px; text-align: center;">${isAr ? '--- حركات درج النقدية ---' : '--- CASH MOVEMENTS ---'}</div>
      <div style="text-align: center;">${isAr ? 'الرصيد الافتتاحي' : 'Opening Float'}: ${openingCash.toFixed(2)}</div>
      <div style="text-align: center;">${isAr ? '+ مبيعات نقدية (كاش)' : '+ Cash Sales'}: +${cashSales.toFixed(2)}</div>
      <div style="text-align: center;">${isAr ? '+ توريدات نقدية (Pay In)' : '+ Cash In'}: +${payIn.toFixed(2)}</div>
      <div style="text-align: center;">${isAr ? '- مسحوبات نقدية (Pay Out)' : '- Cash Out'}: -${payOut.toFixed(2)}</div>
      ${expenses > 0 ? `<div style="text-align: center;">${isAr ? '- مصروفات تشغيلية' : '- Operating Expenses'}: -${expenses.toFixed(2)}</div>` : ''}
      ${safeDrops > 0 ? `<div style="text-align: center;">${isAr ? '- توريد الخزنة (Safe Drop)' : '- Safe Drops'}: -${safeDrops.toFixed(2)}</div>` : ''}
      ${refunds > 0 ? `<div style="text-align: center;">${isAr ? '- مرتجعات نقدية' : '- Cash Refunds'}: -${refunds.toFixed(2)}</div>` : ''}

      ${detailedMovements.length > 0 ? `
        <div style="border-top: 1px dotted #000; margin-top: 4px; padding-top: 3px; text-align: center;">
          <div style="font-weight: bold; font-size: 10px; text-align: center;">${isAr ? 'تفاصيل الحركات الفردية' : 'Individual Movement Items'}:</div>
          ${detailedMovements.slice(0, 10).map(m => `
            <div style="font-size: 10px; text-align: center;">
              ${isAr ? m.label_ar : m.label_en}: ${m.direction === 'in' ? '+' : '-'}${Number(m.amount).toFixed(2)} ${m.reason ? `(${m.reason})` : ''}
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>

    <!-- Section 4: Payment Methods Details -->
    <div style="border-top: 1px dashed #000; padding: 5px 0; text-align: center;">
      <div style="font-weight: 900; margin-bottom: 3px; text-align: center;">${isAr ? '--- تفاصيل طرق الدفع ---' : '--- PAYMENT METHODS ---'}</div>
      ${detailedMethods.length > 0 ? detailedMethods.map(m => `
        <div style="text-align: center;">
          ${isAr ? m.label_ar : m.label_en} (${m.transactions_count}): <strong>${Number(m.total_amount).toFixed(2)}</strong>
        </div>
      `).join('') : `
        <div style="text-align: center;">${isAr ? 'كاش ونقدي' : 'Cash'}: ${cashSales.toFixed(2)}</div>
        <div style="text-align: center;">${isAr ? 'بطاقات وفيزا' : 'Cards'}: ${cardSales.toFixed(2)}</div>
        <div style="text-align: center;">${isAr ? 'محافظ وإنستاباي' : 'Wallets'}: ${walletSales.toFixed(2)}</div>
        ${customSales > 0 ? `<div style="text-align: center;">${isAr ? 'طرق أخرى' : 'Other'}: ${customSales.toFixed(2)}</div>` : ''}
        ${aggregatorSales > 0 ? `<div style="text-align: center;">${isAr ? 'تطبيقات التوصيل' : 'Aggregators'}: ${aggregatorSales.toFixed(2)}</div>` : ''}
      `}
    </div>

    <!-- Section 5: Orders Breakdown -->
    <div style="border-top: 1px dashed #000; padding: 5px 0; text-align: center;">
      <div style="font-weight: 900; margin-bottom: 3px; text-align: center;">${isAr ? '--- تفاصيل الطلبات ---' : '--- ORDERS BREAKDOWN ---'}</div>
      <div style="text-align: center;">${isAr ? 'إجمالي الطلبات' : 'Total Orders'}: <strong>${ordersCount}</strong></div>
      <div style="text-align: center;">${isAr ? 'متوسط قيمة الطلب' : 'Avg Ticket'}: <strong>${avgTicket.toFixed(2)}</strong></div>
      <div style="text-align: center;">${isAr ? 'صالات (داخلي)' : 'Dine-In'}: ${dineInCount} (${dineInSales.toFixed(2)})</div>
      <div style="text-align: center;">${isAr ? 'تيك أواي' : 'Takeaway'}: ${takeawayCount} (${takeawaySales.toFixed(2)})</div>
      <div style="text-align: center;">${isAr ? 'توصيل ودليفري' : 'Delivery'}: ${deliveryCount} (${deliverySales.toFixed(2)})</div>
      ${cancelledCount > 0 ? `<div style="text-align: center;">${isAr ? 'طلبات ملغاة' : 'Cancelled Orders'}: ${cancelledCount}</div>` : ''}
    </div>

    <!-- Section 6: Sold Items Bulk Qty & Pre-Tax Price & Taxes -->
    <div style="border-top: 1px dashed #000; padding: 5px 0; text-align: center;">
      <div style="font-weight: 900; margin-bottom: 3px; text-align: center;">${isAr ? '--- الأصناف المباعة والضرائب ---' : '--- SOLD ITEMS & TAXES ---'}</div>
      <div style="text-align: center;">${isAr ? 'إجمالي عدد القطع المباعة' : 'Total Items Sold Qty'}: <strong>${totalSoldQty}</strong></div>
      <div style="text-align: center;">${isAr ? 'إجمالي المبيعات بدون ضريبة' : 'Sales Excl. Tax'}: <strong>${totalSalesExclTax.toFixed(2)}</strong></div>
      <div style="text-align: center;">${isAr ? 'كمية الأصناف الخاضعة للضريبة' : 'Taxed Items Qty'}: <strong>${totalTaxQty}</strong></div>
      <div style="text-align: center;">${isAr ? 'إجمالي قيمة الضريبة المحصلة' : 'Total Tax Collected'}: <strong>${totalTaxAmt.toFixed(2)}</strong></div>

      ${soldItems.length > 0 ? `
        <div style="border-top: 1px dotted #000; margin-top: 4px; padding-top: 3px; text-align: center;">
          <div style="font-weight: bold; font-size: 10px; margin-bottom: 2px; text-align: center;">${isAr ? 'قائمة الأصناف المباعة' : 'Itemized Sold Products'}:</div>
          ${soldItems.map(item => `
            <div style="margin-bottom: 3px; font-size: 10px; text-align: center;">
              <strong>${item.product_name}${item.variant_name ? ` (${item.variant_name})` : ''}</strong><br/>
              ${isAr ? 'الكمية' : 'Qty'}: ${item.bulk_qty} | ${isAr ? 'سعر بدون ضريبة' : 'Pre-tax'}: ${Number(item.unit_price_excl_tax).toFixed(2)}<br/>
              ${isAr ? 'إجمالي بدون ضريبة' : 'Total Excl Tax'}: ${Number(item.total_excl_tax).toFixed(2)}
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>

    <!-- Section 7: Anti-Theft & Integrity Audit -->
    ${(Number(data.anomalyRiskScore || 0) > 0 || Number(data.anomalyCount || 0) > 0) ? `
      <div style="border-top: 1px dashed #000; padding: 5px 0; text-align: center;">
        <div style="font-weight: 900; margin-bottom: 3px; text-align: center;">${isAr ? '--- نزاهة الوردية وكاشف التلاعب ---' : '--- INTEGRITY & ANOMALIES ---'}</div>
        <div style="text-align: center;">${isAr ? 'مؤشر الخطورة الإجمالي' : 'Total Risk Points'}: <strong>${data.anomalyRiskScore || 0}</strong></div>
        <div style="text-align: center;">${isAr ? 'عدد الأنماط المشبوهة' : 'Suspicious Events'}: <strong>${data.anomalyCount || 0}</strong></div>
      </div>
    ` : ''}

    <!-- Section 8: BOM Cost & Net Profit -->
    <div style="border-top: 1px dashed #000; padding: 5px 0; text-align: center;">
      <div style="font-weight: 900; margin-bottom: 3px; text-align: center;">${isAr ? '--- خامات BOM وصافي الأرباح ---' : '--- BOM COST & NET PROFIT ---'}</div>
      <div style="text-align: center;">${isAr ? 'تكلفة خامات الوصفات المتوقعة (BOM)' : 'Expected BOM Materials Cost'}: ${Number(data.expectedBomCost || 0).toFixed(2)}</div>
      <div style="text-align: center;">${isAr ? 'مجمل الربح المتوقع' : 'Expected Gross Profit'}: ${Number(data.expectedGrossProfit || 0).toFixed(2)}</div>
      <div style="font-size: 12px; font-weight: 900; margin-top: 3px; text-align: center;">${isAr ? 'صافي الربح المتوقع' : 'Expected Net Profit'}: ${Number(data.expectedNetProfit || 0).toFixed(2)}</div>
    </div>

    <!-- Section 9: Stacked Centered Signatures -->
    <div style="border-top: 1px dashed #000; margin-top: 12px; padding-top: 8px; text-align: center;">
      <div style="border-top: 1px solid #000; width: 130px; margin: 8px auto 0 auto; padding-top: 3px; text-align: center;">${isAr ? 'توقيع المدير' : 'Manager Signature'}</div>
      <div style="border-top: 1px solid #000; width: 130px; margin: 12px auto 0 auto; padding-top: 3px; text-align: center;">${isAr ? 'توقيع المالك' : 'Owner Signature'}</div>
    </div>
  </div>
  `;
}
