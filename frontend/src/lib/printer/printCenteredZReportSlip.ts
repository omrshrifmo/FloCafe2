import { renderPreBlindSlipHtml, renderFullZReportSlipHtml, PreBlindSlipData, FullZReportSlipData } from '@shared/print/templates/zreport';

interface RawClosurePayload {
  store_name?: string;
  storeName?: string;
  branch_name?: string;
  branchName?: string;
  id?: string | number;
  closureNumber?: string | number;
  business_date?: string;
  date?: string;
  created_at?: string;
  closed_by_name?: string;
  cashierName?: string;
  denominations?: Record<string, number>;
  declared_cash?: number;
  counted_cash_cents?: number;
  declared_card_slips?: number;
  declared_wallet_slips?: number;
  notes?: string;
  tax_number?: string;
  taxNumber?: string;
  z_number?: string | number;
  zNumber?: string | number;
  period_start?: string;
  periodStart?: string;
  period_end?: string;
  periodEnd?: string;
  closedBy?: string;
  closed_by_role?: string;
  closedByRole?: string;
  total_orders_count?: number;
  ordersCount?: number;
  bill_count?: number;
  avg_ticket?: number;
  avgTicket?: number;
  dine_in_orders?: number;
  dine_in_sales?: number;
  takeaway_orders?: number;
  takeaway_sales?: number;
  delivery_orders?: number;
  delivery_sales?: number;
  voided_orders_count?: number;
  carry_over_tables_count?: number;
  gross_sales?: number;
  gross_collected_cents?: number;
  discounts_total?: number;
  discounts?: number;
  tax_total?: number;
  taxes?: number;
  delivery_fees?: number;
  net_sales?: number;
  net_collected_cents?: number;
  cash_sales?: number;
  card_sales?: number;
  wallet_sales?: number;
  custom_payment_sales?: number;
  aggregator_sales?: number;
  opening_cash?: number;
  opening_float_cents?: number;
  cash_in_total?: number;
  cashIn?: number;
  cash_out_total?: number;
  cashOut?: number;
  refunds_total?: number;
  refunds?: number;
  refunded_cents?: number;
  expected_cash?: number;
  expected_cash_cents?: number;
  actual_cash?: number;
  preblind_count?: number;
  preblindCount?: number;
  variance?: number;
  variance_cents?: number;
  sold_items_count?: number;
  soldItemsCount?: number;
  expected_bom_cost?: number;
  expectedBomCost?: number;
  expected_gross_profit?: number;
  expectedGrossProfit?: number;
  authorized_waste_cost?: number;
  authorizedWasteCost?: number;
  operating_expenses?: number;
  operatingExpenses?: number;
  expenses_total?: number;
  expected_net_profit?: number;
  expectedNetProfit?: number;
  profit_margin_pct?: number;
  profitMarginPct?: number;
  [key: string]: unknown;
}

export function printCenteredZReportSlip(
  rawClosureData: unknown,
  language: 'ar' | 'en' = 'ar',
  mode: 'pre_blind_cashier' | 'full_day_close' | string = 'full_day_close'
): void {
  if (typeof window === 'undefined') return;
  const closureData = (rawClosureData && typeof rawClosureData === 'object' ? rawClosureData : {}) as RawClosurePayload;

  let html = '';
  if (mode === 'pre_blind_cashier') {
    const slipData: PreBlindSlipData = {
      storeName: closureData.store_name || closureData.storeName || 'FloCafe',
      branchName: closureData.branch_name || closureData.branchName,
      closureNumber: closureData.id || closureData.closureNumber,
      date: closureData.business_date || closureData.date,
      time: closureData.created_at ? new Date(closureData.created_at).toLocaleTimeString() : undefined,
      cashierName: closureData.closed_by_name || closureData.cashierName,
      denominations: closureData.denominations,
      declaredCash: closureData.declared_cash !== undefined ? closureData.declared_cash : (closureData.counted_cash_cents ? closureData.counted_cash_cents / 100 : 0),
      declaredCardSlips: closureData.declared_card_slips,
      declaredWalletSlips: closureData.declared_wallet_slips,
      notes: closureData.notes,
    };
    html = renderPreBlindSlipHtml(slipData, language);
  } else {
    const slipData: FullZReportSlipData = {
      storeName: closureData.store_name || closureData.storeName || 'FloCafe',
      branchName: closureData.branch_name || closureData.branchName,
      taxNumber: closureData.tax_number || closureData.taxNumber || '300000000000003',
      closureNumber: closureData.id || closureData.closureNumber,
      zNumber: closureData.z_number || closureData.zNumber,
      periodStart: closureData.period_start || closureData.periodStart,
      periodEnd: closureData.period_end || closureData.periodEnd,
      closedBy: closureData.closed_by_name || closureData.closedBy,
      closedByRole: closureData.closed_by_role || closureData.closedByRole,
      ordersCount: closureData.total_orders_count || closureData.ordersCount || closureData.bill_count,
      avgTicket: closureData.avg_ticket || closureData.avgTicket,
      dineInOrders: closureData.dine_in_orders,
      dineInSales: closureData.dine_in_sales,
      takeawayOrders: closureData.takeaway_orders,
      takeawaySales: closureData.takeaway_sales,
      deliveryOrders: closureData.delivery_orders,
      deliverySales: closureData.delivery_sales,
      voidedOrdersCount: closureData.voided_orders_count,
      carryOverTablesCount: closureData.carry_over_tables_count,
      grossSales: closureData.gross_sales !== undefined ? closureData.gross_sales : (closureData.gross_collected_cents ? closureData.gross_collected_cents / 100 : 0),
      discounts: closureData.discounts_total || closureData.discounts || 0,
      taxes: closureData.tax_total || closureData.taxes || 0,
      deliveryFees: closureData.delivery_fees || 0,
      netSales: closureData.net_sales !== undefined ? closureData.net_sales : (closureData.net_collected_cents ? closureData.net_collected_cents / 100 : 0),
      cashSales: closureData.cash_sales,
      cardSales: closureData.card_sales,
      walletSales: closureData.wallet_sales,
      customPaymentSales: closureData.custom_payment_sales,
      aggregatorSales: closureData.aggregator_sales,
      openingCash: closureData.opening_cash !== undefined ? closureData.opening_cash : (closureData.opening_float_cents ? closureData.opening_float_cents / 100 : 0),
      cashIn: closureData.cash_in_total || closureData.cashIn || 0,
      cashOut: closureData.cash_out_total || closureData.cashOut || 0,
      refunds: closureData.refunds_total !== undefined ? closureData.refunds_total : (closureData.refunded_cents ? closureData.refunded_cents / 100 : 0),
      expectedCash: closureData.expected_cash !== undefined ? closureData.expected_cash : (closureData.expected_cash_cents ? closureData.expected_cash_cents / 100 : 0),
      preblindCount: closureData.preblind_count || closureData.preblindCount,
      actualCash: closureData.actual_cash !== undefined ? closureData.actual_cash : (closureData.counted_cash_cents ? closureData.counted_cash_cents / 100 : 0),
      cashVariance: closureData.variance !== undefined ? closureData.variance : (closureData.variance_cents ? closureData.variance_cents / 100 : 0),
      soldItemsCount: closureData.sold_items_count || closureData.soldItemsCount,
      expectedBomCost: closureData.expected_bom_cost || closureData.expectedBomCost || 0,
      expectedGrossProfit: closureData.expected_gross_profit || closureData.expectedGrossProfit || 0,
      authorizedWasteCost: closureData.authorized_waste_cost || closureData.authorizedWasteCost || 0,
      operatingExpenses: closureData.operating_expenses || closureData.expenses_total || 0,
      expectedNetProfit: closureData.expected_net_profit || closureData.expectedNetProfit || 0,
      profitMarginPct: closureData.profit_margin_pct,
      notes: closureData.notes,
    };
    html = renderFullZReportSlipHtml(slipData, language);
  }

  const printWindow = window.open('', '_blank', 'width=380,height=650');
  if (!printWindow) return;

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="${language}" dir="${language === 'ar' ? 'rtl' : 'ltr'}">
      <head>
        <meta charset="utf-8">
        <title>${mode === 'pre_blind_cashier' ? 'Pre-Blind Slip' : 'Z-Report'}</title>
        <style>
          @page { size: auto; margin: 4mm; }
          body { margin: 0; padding: 0; background: #fff; }
        </style>
      </head>
      <body>
        ${html}
        <script>
          window.onload = function() {
            window.focus();
            window.print();
            setTimeout(function() { window.close(); }, 500);
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}
