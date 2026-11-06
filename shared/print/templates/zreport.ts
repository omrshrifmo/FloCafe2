/**
 * Center-Aligned, High-Contrast Z-Report and Pre-Blind Slip Templates
 * Supports English & Arabic with 100% center alignment, bold headers,
 * and high-contrast styling for thermal slips & web printing.
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
  grossSales?: number;
  discounts?: number;
  taxes?: number;
  deliveryFees?: number;
  netSales?: number;
  cashSales?: number;
  cardSales?: number;
  walletSales?: number;
  customPaymentSales?: number;
  aggregatorSales?: number;
  aggregatorCommissions?: number;
  openingCash?: number;
  cashIn?: number;
  cashOut?: number;
  refunds?: number;
  expectedCash?: number;
  preblindCount?: number | null;
  actualCash?: number;
  cashVariance?: number;
  soldItemsCount?: number;
  expectedBomCost?: number;
  expectedGrossProfit?: number;
  authorizedWasteCost?: number;
  operatingExpenses?: number;
  expectedNetProfit?: number;
  profitMarginPct?: number;
  notes?: string;
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
        .map(([denom, count]) => `<div>${denom} x ${count} = ${(Number(denom) * count).toFixed(2)}</div>`)
        .join('')
    : '';

  return `
  <div dir="${dir}" style="text-align: center; font-family: monospace, sans-serif; color: #000; width: 100%; max-width: 320px; margin: 0 auto; padding: 12px 6px; line-height: 1.4; font-size: 13px;">
    <div style="font-size: 18px; font-weight: 900; margin-bottom: 2px;">${data.storeName || 'FloCafe'}</div>
    ${data.branchName ? `<div style="font-size: 14px; font-weight: bold; margin-bottom: 4px;">${data.branchName}</div>` : ''}
    <div style="border-top: 2px dashed #000; border-bottom: 2px dashed #000; padding: 6px 0; margin: 8px 0;">
      <div style="font-size: 15px; font-weight: 900;">${title}</div>
      <div style="font-size: 12px; font-weight: bold;">${subtitle}</div>
    </div>

    <div style="margin-bottom: 6px;">
      ${data.closureNumber ? `<div><strong>${isAr ? 'رقم الإغلاق' : 'Closure #'}:</strong> ${data.closureNumber}</div>` : ''}
      <div><strong>${isAr ? 'التاريخ والوقت' : 'Date/Time'}:</strong> ${data.date || new Date().toISOString().slice(0, 10)} ${data.time || ''}</div>
      <div><strong>${isAr ? 'الكاشير' : 'Cashier'}:</strong> ${data.cashierName || '-'}</div>
    </div>

    ${denomRows ? `
      <div style="border-top: 1px dashed #000; padding-top: 6px; margin-top: 6px;">
        <div style="font-weight: bold; margin-bottom: 4px;">${isAr ? 'تفقيط الفئات النقدية' : 'Denominations Breakdown'}</div>
        ${denomRows}
      </div>
    ` : ''}

    <div style="border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 8px 0; margin: 8px 0;">
      <div style="font-size: 12px; font-weight: bold;">${isAr ? 'النقدية الفعلية المعلنة بالدرج' : 'Declared Physical Cash'}</div>
      <div style="font-size: 20px; font-weight: 900;">${Number(data.declaredCash || 0).toFixed(2)}</div>
    </div>

    <div style="margin-bottom: 8px;">
      <div><strong>${isAr ? 'إيصالات الفيزا / البطاقات' : 'Declared Card Slips'}:</strong> ${Number(data.declaredCardSlips || 0).toFixed(2)}</div>
      <div><strong>${isAr ? 'إيصالات المحافظ / إنستاباي' : 'Declared Wallet/InstaPay'}:</strong> ${Number(data.declaredWalletSlips || 0).toFixed(2)}</div>
    </div>

    ${data.notes ? `
      <div style="border-top: 1px dashed #000; padding: 6px 0;">
        <div><strong>${isAr ? 'ملاحظات' : 'Notes'}:</strong> ${data.notes}</div>
      </div>
    ` : ''}

    <div style="border-top: 1px dashed #000; margin-top: 16px; padding-top: 18px;">
      <div style="display: flex; justify-content: space-between; text-align: center;">
        <div style="flex: 1; border-top: 1px solid #000; margin: 0 8px; padding-top: 4px;">${isAr ? 'توقيع الكاشير' : 'Cashier Signature'}</div>
        <div style="flex: 1; border-top: 1px solid #000; margin: 0 8px; padding-top: 4px;">${isAr ? 'توقيع المستلم' : 'Manager Signature'}</div>
      </div>
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

  const variance = Number(data.cashVariance || 0);
  const varianceText = Math.abs(variance) < 0.01
    ? (isAr ? 'مطابق (0.00)' : 'Exact (0.00)')
    : (variance > 0
        ? `+${variance.toFixed(2)} (${isAr ? 'زيادة' : 'Overage'})`
        : `${variance.toFixed(2)} (${isAr ? 'عجز' : 'Shortage'})`);

  return `
  <div dir="${dir}" style="text-align: center; font-family: monospace, sans-serif; color: #000; width: 100%; max-width: 320px; margin: 0 auto; padding: 12px 6px; line-height: 1.4; font-size: 13px;">
    <div style="font-size: 19px; font-weight: 900; margin-bottom: 2px;">${data.storeName || 'FloCafe'}</div>
    ${data.branchName ? `<div style="font-size: 14px; font-weight: bold; margin-bottom: 2px;">${data.branchName}</div>` : ''}
    ${data.taxNumber ? `<div style="font-size: 12px;">${isAr ? 'الرقم الضريبي' : 'Tax Reg #'}: ${data.taxNumber}</div>` : ''}

    <div style="border-top: 2px dashed #000; border-bottom: 2px dashed #000; padding: 6px 0; margin: 8px 0;">
      <div style="font-size: 14px; font-weight: 900;">${title}</div>
      ${data.zNumber ? `<div style="font-size: 13px; font-weight: bold;">Z-ID: #${data.zNumber} ${data.closureNumber ? `| Closure #${data.closureNumber}` : ''}</div>` : ''}
    </div>

    <div style="margin-bottom: 8px; font-size: 12px;">
      <div><strong>${isAr ? 'بداية الفترة' : 'Period Start'}:</strong> ${data.periodStart || '-'}</div>
      <div><strong>${isAr ? 'نهاية الفترة' : 'Period End'}:</strong> ${data.periodEnd || '-'}</div>
      <div><strong>${isAr ? 'تم الإغلاق بواسطة' : 'Closed By'}:</strong> ${data.closedBy || '-'} ${data.closedByRole ? `(${data.closedByRole})` : ''}</div>
    </div>

    <!-- Orders Summary -->
    <div style="border-top: 1px dashed #000; padding: 6px 0;">
      <div style="font-weight: 900; margin-bottom: 4px;">${isAr ? '--- ملخص الطلبات والمبيعات ---' : '--- ORDERS SUMMARY ---'}</div>
      <div>${isAr ? 'إجمالي الطلبات المكتملة' : 'Completed Orders'}: <strong>${data.ordersCount || 0}</strong></div>
      <div>${isAr ? 'متوسط قيمة الطلب' : 'Avg Ticket'}: <strong>${Number(data.avgTicket || 0).toFixed(2)}</strong></div>
      <div>${isAr ? 'صالات (داخلي)' : 'Dine-In'}: ${data.dineInOrders || 0} | ${Number(data.dineInSales || 0).toFixed(2)}</div>
      <div>${isAr ? 'تيك أواي' : 'Takeaway'}: ${data.takeawayOrders || 0} | ${Number(data.takeawaySales || 0).toFixed(2)}</div>
      <div>${isAr ? 'دليفري' : 'Delivery'}: ${data.deliveryOrders || 0} | ${Number(data.deliverySales || 0).toFixed(2)}</div>
      ${Number(data.voidedOrdersCount || 0) > 0 ? `<div>${isAr ? 'طلبات ملغاة / مرتجعة' : 'Voided Orders'}: ${data.voidedOrdersCount}</div>` : ''}
    </div>

    <!-- Revenue Summary -->
    <div style="border-top: 1px dashed #000; padding: 6px 0;">
      <div style="font-weight: 900; margin-bottom: 4px;">${isAr ? '--- الإيرادات والضرائب ---' : '--- REVENUE & TAXES ---'}</div>
      <div>${isAr ? 'إجمالي المبيعات (Gross)' : 'Gross Sales'}: ${Number(data.grossSales || 0).toFixed(2)}</div>
      <div>${isAr ? 'الخصومات' : 'Discounts'}: -${Number(data.discounts || 0).toFixed(2)}</div>
      <div>${isAr ? 'الضرائب المحصلة' : 'Taxes'}: +${Number(data.taxes || 0).toFixed(2)}</div>
      ${Number(data.deliveryFees || 0) > 0 ? `<div>${isAr ? 'رسوم التوصيل' : 'Delivery Fees'}: +${Number(data.deliveryFees).toFixed(2)}</div>` : ''}
      <div style="font-size: 15px; font-weight: 900; margin-top: 4px;">${isAr ? 'صافي الإيرادات' : 'Net Sales'}: ${Number(data.netSales || 0).toFixed(2)}</div>
    </div>

    <!-- Payment Methods -->
    <div style="border-top: 1px dashed #000; padding: 6px 0;">
      <div style="font-weight: 900; margin-bottom: 4px;">${isAr ? '--- طرق الدفع والتطبيقات ---' : '--- PAYMENT BREAKDOWN ---'}</div>
      <div>${isAr ? 'نقدية (كاش)' : 'Cash'}: ${Number(data.cashSales || 0).toFixed(2)}</div>
      <div>${isAr ? 'بطاقات وفيزا' : 'Cards'}: ${Number(data.cardSales || 0).toFixed(2)}</div>
      <div>${isAr ? 'محافظ إلكترونية وإنستاباي' : 'Wallets / InstaPay'}: ${Number(data.walletSales || 0).toFixed(2)}</div>
      ${Number(data.customPaymentSales || 0) > 0 ? `<div>${isAr ? 'طرق أخرى' : 'Other'}: ${Number(data.customPaymentSales).toFixed(2)}</div>` : ''}
      ${Number(data.aggregatorSales || 0) > 0 ? `<div>${isAr ? 'تطبيقات التوصيل' : 'Aggregators'}: ${Number(data.aggregatorSales).toFixed(2)}</div>` : ''}
    </div>

    <!-- Cash Drawer Reconciliation -->
    <div style="border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 8px 0; margin: 8px 0;">
      <div style="font-weight: 900; margin-bottom: 4px;">${isAr ? '--- تسوية درج النقدية ---' : '--- CASH DRAWER RECONCILIATION ---'}</div>
      <div>${isAr ? 'الرصيد الافتتاحي' : 'Opening Float'}: ${Number(data.openingCash || 0).toFixed(2)}</div>
      <div>${isAr ? '+ مبيعات النقدية' : '+ Cash Sales'}: +${Number(data.cashSales || 0).toFixed(2)}</div>
      <div>${isAr ? '+ توريد نقدية (Cash In)' : '+ Cash In'}: +${Number(data.cashIn || 0).toFixed(2)}</div>
      <div>${isAr ? '- مسحوبات ومصروفات (Cash Out)' : '- Cash Out'}: -${Number(data.cashOut || 0).toFixed(2)}</div>
      <div>${isAr ? '- مرتجعات نقدية' : '- Cash Refunds'}: -${Number(data.refunds || 0).toFixed(2)}</div>
      <div style="margin: 4px 0; font-weight: bold;">${isAr ? '= النقدية المتوقعة بالدرج' : '= Expected Cash'}: ${Number(data.expectedCash || 0).toFixed(2)}</div>
      ${data.preblindCount !== null && data.preblindCount !== undefined ? `<div>${isAr ? 'عد الكاشير المبدئي' : 'Cashier Pre-Blind Count'}: ${Number(data.preblindCount).toFixed(2)}</div>` : ''}
      <div style="font-size: 15px; font-weight: 900;">${isAr ? 'النقدية الفعلية المعدودة' : 'Actual Counted Cash'}: ${Number(data.actualCash || 0).toFixed(2)}</div>
      <div style="font-size: 14px; font-weight: 900; margin-top: 2px;">${isAr ? 'فارق الدرج' : 'Cash Variance'}: ${varianceText}</div>
    </div>

    <!-- BOM Cost & Profit Summary -->
    <div style="border-top: 1px dashed #000; padding: 6px 0;">
      <div style="font-weight: 900; margin-bottom: 4px;">${isAr ? '--- تكلفة الخامات BOM والأرباح ---' : '--- BOM COST & EXPECTED PROFIT ---'}</div>
      <div>${isAr ? 'عدد الوحدات المباعة' : 'Sold Items Qty'}: ${data.soldItemsCount || 0}</div>
      <div>${isAr ? 'تكلفة خامات الوصفات المتوقعة (BOM)' : 'Expected BOM Materials Cost'}: ${Number(data.expectedBomCost || 0).toFixed(2)}</div>
      <div style="font-weight: bold;">${isAr ? 'مجمل الربح المتوقع' : 'Expected Gross Profit'}: ${Number(data.expectedGrossProfit || 0).toFixed(2)}</div>
      ${Number(data.authorizedWasteCost || 0) > 0 ? `<div>${isAr ? 'تكلفة الهدر المعتمد' : 'Authorized Waste'}: -${Number(data.authorizedWasteCost).toFixed(2)}</div>` : ''}
      ${Number(data.operatingExpenses || 0) > 0 ? `<div>${isAr ? 'المصروفات التشغيلية' : 'Operating Expenses'}: -${Number(data.operatingExpenses).toFixed(2)}</div>` : ''}
      <div style="font-size: 15px; font-weight: 900; margin-top: 4px;">${isAr ? 'صافي الربح المتوقع' : 'Expected Net Profit'}: ${Number(data.expectedNetProfit || 0).toFixed(2)} ${data.profitMarginPct !== undefined ? `(${data.profitMarginPct.toFixed(1)}%)` : ''}</div>
    </div>

    <div style="border-top: 1px dashed #000; margin-top: 16px; padding-top: 18px;">
      <div style="display: flex; justify-content: space-between; text-align: center;">
        <div style="flex: 1; border-top: 1px solid #000; margin: 0 8px; padding-top: 4px;">${isAr ? 'توقيع المدير' : 'Manager Signature'}</div>
        <div style="flex: 1; border-top: 1px solid #000; margin: 0 8px; padding-top: 4px;">${isAr ? 'توقيع المالك' : 'Owner Signature'}</div>
      </div>
    </div>
  </div>
  `;
}
