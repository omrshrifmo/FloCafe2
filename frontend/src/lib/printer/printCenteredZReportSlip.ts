import { renderPreBlindSlipHtml, renderFullZReportSlipHtml, PreBlindSlipData, FullZReportSlipData } from '@shared/print/templates/zreport';
import api from '../api';

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
    const snapshot = (closureData.z_report_snapshot && typeof closureData.z_report_snapshot === 'object'
      ? closureData.z_report_snapshot
      : {}) as Record<string, unknown>;

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
      deficitAmount: (closureData.deficit_amount as number) ?? (closureData.deficitAmount as number) ?? (snapshot.deficit_amount as number) ?? undefined,
      surplusAmount: (closureData.surplus_amount as number) ?? (closureData.surplusAmount as number) ?? (snapshot.surplus_amount as number) ?? undefined,
      varianceStatus: (closureData.variance_status as string) ?? (closureData.varianceStatus as string) ?? (snapshot.variance_status as string) ?? undefined,
      soldItemsBreakdown: (closureData.sold_items_breakdown as any) ?? (closureData.soldItemsBreakdown as any) ?? (snapshot.sold_items_breakdown as any) ?? undefined,
      totalSoldItemsQty: (closureData.total_sold_items_qty as number) ?? (closureData.totalSoldItemsQty as number) ?? (snapshot.total_sold_items_qty as number) ?? undefined,
      totalSalesExclTax: (closureData.total_sales_excl_tax as number) ?? (closureData.totalSalesExclTax as number) ?? (snapshot.total_sales_excl_tax as number) ?? undefined,
      totalTaxQuantity: (closureData.total_tax_quantity as number) ?? (closureData.totalTaxQuantity as number) ?? (snapshot.total_tax_quantity as number) ?? undefined,
      totalTaxAmount: (closureData.total_tax_amount as number) ?? (closureData.totalTaxAmount as number) ?? (snapshot.total_tax_amount as number) ?? undefined,
      ordersBreakdown: (closureData.orders_breakdown as any) ?? (closureData.ordersBreakdown as any) ?? (snapshot.orders_breakdown as any) ?? undefined,
      ordersList: (closureData.orders_list as any) ?? (closureData.ordersList as any) ?? (snapshot.orders_list as any) ?? undefined,
      paymentMethodsDetailed: (closureData.payment_methods_detailed as any) ?? (closureData.paymentMethodsDetailed as any) ?? (snapshot.payment_methods_detailed as any) ?? undefined,
      paymentsList: (closureData.payments_list as any) ?? (closureData.paymentsList as any) ?? (snapshot.payments_list as any) ?? undefined,
      cashMovementsSummary: (closureData.cash_movements_summary as any) ?? (closureData.cashMovementsSummary as any) ?? (snapshot.cash_movements_summary as any) ?? undefined,
      cashMovementsDetailed: (closureData.cash_movements_detailed as any) ?? (closureData.cashMovementsDetailed as any) ?? (snapshot.cash_movements_detailed as any) ?? undefined,
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

  // Non-blocking hardware thermal printer dispatch
  try {
    api.post('/cash-closures/print-thermal', { zReport: closureData, language, mode }).catch(() => {});
  } catch {}

  const fullDoc = `<!DOCTYPE html>
<html lang="${language}" dir="${language === 'ar' ? 'rtl' : 'ltr'}">
  <head>
    <meta charset="utf-8">
    <title>${mode === 'pre_blind_cashier' ? 'Pre-Blind Slip' : 'Z-Report'}</title>
    <style>
      @page { size: auto; margin: 4mm; }
      body { margin: 0; padding: 0; background: #fff; color: #000; text-align: center; }
    </style>
  </head>
  <body>${html}</body>
</html>`;

  try {
    const existingFrame = document.getElementById('flocafe-zreport-print-frame');
    if (existingFrame && existingFrame.parentNode) {
      existingFrame.parentNode.removeChild(existingFrame);
    }
    const iframe = document.createElement('iframe');
    iframe.id = 'flocafe-zreport-print-frame';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document || iframe.contentDocument;
    if (doc && iframe.contentWindow) {
      doc.open();
      doc.write(fullDoc);
      doc.close();
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {}
      }, 150);
      return;
    }
  } catch {}

  // Fallback to window.open only if iframe is not supported
  try {
    const printWindow = window.open('', '_blank', 'width=380,height=650');
    if (!printWindow) return;
    printWindow.document.write(fullDoc);
    printWindow.document.close();
    setTimeout(() => {
      try {
        printWindow.focus();
        printWindow.print();
        setTimeout(() => { printWindow.close(); }, 500);
      } catch {}
    }, 200);
  } catch {}
}
