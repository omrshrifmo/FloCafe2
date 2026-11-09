/**
 * FloCafe Backend Thermal ESC/POS Z-Report & Pre-Blind Slip Template
 *
 * Fully center-aligned (ESC/POS \x1b\x61\x01 / align: 'center'), high-contrast,
 * bilingual Arabic/English thermal slips for 80mm/58mm receipt printers.
 */

import {
  PreBlindSlipData,
  FullZReportSlipData,
  renderPreBlindSlipHtml,
  renderFullZReportSlipHtml,
} from '../../shared/print/templates/zreport';

export {
  PreBlindSlipData,
  FullZReportSlipData,
  renderPreBlindSlipHtml,
  renderFullZReportSlipHtml,
};

// ESC/POS Command Constants
export const ESC_INIT = '\x1b\x40';
export const ESC_ALIGN_CENTER = '\x1b\x61\x01';
export const ESC_ALIGN_LEFT = '\x1b\x61\x00';
export const ESC_ALIGN_RIGHT = '\x1b\x61\x02';
export const ESC_BOLD_ON = '\x1b\x45\x01';
export const ESC_BOLD_OFF = '\x1b\x45\x00';
export const ESC_DOUBLE_ON = '\x1d\x21\x11';
export const ESC_DOUBLE_OFF = '\x1d\x21\x00';
export const ESC_CUT = '\x1d\x56\x41\x03';
export const ESC_FEED = '\n';

export interface EscPosLineItem {
  text: string;
  align: 'center' | 'left' | 'right';
  bold?: boolean;
  doubleHeight?: boolean;
}

/**
 * Format a center-aligned text line padded to width
 */
export function centerText(text: string, width = 42): string {
  if (text.length >= width) return text;
  const totalPad = width - text.length;
  const leftPad = Math.floor(totalPad / 2);
  const rightPad = totalPad - leftPad;
  return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
}

/**
 * Build Raw Center-Aligned ESC/POS Commands & Text for Pre-Blind Cashier Handover Slip
 */
export function buildPreBlindThermalSlip(
  data: any,
  language: 'ar' | 'en' = 'ar',
  columns = 42
): { text: string; commands: EscPosLineItem[]; bytes: Buffer } {
  const isAr = language === 'ar';
  const divider = '='.repeat(columns);
  const dashed = '-'.repeat(columns);

  const title = isAr
    ? 'تسليم وردية مبدئي أعمى للكاشير'
    : 'PRE-BLIND CASHIER SHIFT HANDOVER SLIP';
  const subtitle = isAr ? 'تسليم نقدية الوردية' : 'CASH DRAWER COUNT HANDOVER';

  const commands: EscPosLineItem[] = [
    { text: String(data.storeName || 'FloCafe'), align: 'center', bold: true, doubleHeight: true },
  ];

  if (data.branchName) {
    commands.push({ text: String(data.branchName), align: 'center', bold: true });
  }

  commands.push(
    { text: divider, align: 'center', bold: true },
    { text: title, align: 'center', bold: true, doubleHeight: true },
    { text: subtitle, align: 'center', bold: true },
    { text: divider, align: 'center', bold: true },
  );

  if (data.closureNumber) {
    commands.push({ text: `${isAr ? 'رقم الإغلاق' : 'Closure #'}: ${data.closureNumber}`, align: 'center', bold: true });
  }
  commands.push(
    { text: `${isAr ? 'التاريخ والوقت' : 'Date/Time'}: ${data.date || new Date().toISOString().slice(0, 10)} ${data.time || ''}`.trim(), align: 'center' },
    { text: `${isAr ? 'الكاشير' : 'Cashier'}: ${data.cashierName || data.closed_by_name || '-'}`, align: 'center', bold: true },
  );

  // Denominations Breakdown
  if (data.denominations && typeof data.denominations === 'object') {
    commands.push(
      { text: dashed, align: 'center' },
      { text: isAr ? '--- تفقيط الفئات النقدية ---' : '--- DENOMINATIONS BREAKDOWN ---', align: 'center', bold: true },
    );
    for (const [denom, count] of Object.entries(data.denominations)) {
      const c = Number(count) || 0;
      if (c > 0) {
        const line = `${denom} x ${c} = ${(Number(denom) * c).toFixed(2)}`;
        commands.push({ text: line, align: 'center' });
      }
    }
  }

  // Declared Physical Cash (High-Contrast Center Box)
  const declaredCash = Number(data.declaredCash ?? data.actual_cash ?? data.counted_cash ?? (data.counted_cash_cents ? data.counted_cash_cents / 100 : 0));
  commands.push(
    { text: divider, align: 'center', bold: true },
    { text: isAr ? 'النقدية الفعلية المعلنة بالدرج' : 'Declared Physical Cash', align: 'center', bold: true },
    { text: declaredCash.toFixed(2), align: 'center', bold: true, doubleHeight: true },
    { text: divider, align: 'center', bold: true },
  );

  // Declared Card & Wallet Slips
  const declaredCard = Number(data.declaredCardSlips ?? data.declared_card_slips ?? 0);
  const declaredWallet = Number(data.declaredWalletSlips ?? data.declared_wallet_slips ?? 0);

  commands.push(
    { text: `${isAr ? 'إيصالات الفيزا / البطاقات' : 'Declared Card Slips'}: ${declaredCard.toFixed(2)}`, align: 'center', bold: true },
    { text: `${isAr ? 'إيصالات المحافظ / إنستاباي' : 'Declared Wallet/InstaPay'}: ${declaredWallet.toFixed(2)}`, align: 'center', bold: true },
  );

  if (data.notes) {
    commands.push(
      { text: dashed, align: 'center' },
      { text: `${isAr ? 'ملاحظات' : 'Notes'}: ${data.notes}`, align: 'center' },
    );
  }

  // Signature line
  commands.push(
    { text: dashed, align: 'center' },
    { text: isAr ? 'توقيع الكاشير: ____________________' : 'Cashier Signature: ____________________', align: 'center', bold: true },
    { text: isAr ? 'توقيع المستلم: ____________________' : 'Manager Signature: ____________________', align: 'center', bold: true },
    { text: divider, align: 'center' },
  );

  // Convert to Buffer bytes with center ESC/POS commands
  let rawText = '';
  const byteChunks: Buffer[] = [Buffer.from(ESC_INIT)];

  for (const item of commands) {
    rawText += centerText(item.text, columns) + '\n';
    byteChunks.push(Buffer.from(ESC_ALIGN_CENTER));
    if (item.bold) byteChunks.push(Buffer.from(ESC_BOLD_ON));
    if (item.doubleHeight) byteChunks.push(Buffer.from(ESC_DOUBLE_ON));
    byteChunks.push(Buffer.from(item.text + '\n', 'utf8'));
    if (item.doubleHeight) byteChunks.push(Buffer.from(ESC_DOUBLE_OFF));
    if (item.bold) byteChunks.push(Buffer.from(ESC_BOLD_OFF));
  }
  byteChunks.push(Buffer.from(ESC_FEED + ESC_FEED + ESC_CUT));

  return {
    text: rawText,
    commands,
    bytes: Buffer.concat(byteChunks),
  };
}

/**
 * Build Raw Center-Aligned ESC/POS Commands & Text for Full Day Close (Z-Report)
 */
export function buildFullZReportThermalSlip(
  data: any,
  language: 'ar' | 'en' = 'ar',
  columns = 42
): { text: string; commands: EscPosLineItem[]; bytes: Buffer } {
  const isAr = language === 'ar';
  const divider = '='.repeat(columns);
  const dashed = '-'.repeat(columns);

  const title = isAr
    ? 'تقرير إغلاق الوردية واليوم الشامل (Z-REPORT)'
    : 'FULL DAY / SHIFT Z-REPORT';

  const commands: EscPosLineItem[] = [
    { text: String(data.storeName || 'FloCafe'), align: 'center', bold: true, doubleHeight: true },
  ];

  if (data.branchName) {
    commands.push({ text: String(data.branchName), align: 'center', bold: true });
  }
  if (data.taxNumber) {
    commands.push({ text: `${isAr ? 'الرقم الضريبي' : 'Tax Reg #'}: ${data.taxNumber}`, align: 'center' });
  }

  commands.push(
    { text: divider, align: 'center', bold: true },
    { text: title, align: 'center', bold: true, doubleHeight: true },
    { text: `Z-ID: #${data.zNumber || data.z_number || '0000'} ${data.closureNumber ? `| #${data.closureNumber}` : ''}`.trim(), align: 'center', bold: true },
    { text: divider, align: 'center', bold: true },
  );

  // Period & Staff
  commands.push(
    { text: `${isAr ? 'بداية الفترة' : 'Period Start'}: ${data.periodStart || data.period_start || '-'}`, align: 'center' },
    { text: `${isAr ? 'نهاية الفترة' : 'Period End'}: ${data.periodEnd || data.period_end || '-'}`, align: 'center' },
    { text: `${isAr ? 'تم الإغلاق بواسطة' : 'Closed By'}: ${data.closedBy || data.closed_by_name || '-'}`, align: 'center', bold: true },
  );

  // 1. Orders Summary
  const ordersCount = Number(data.ordersCount ?? data.total_orders_count ?? 0);
  const avgTicket = Number(data.avgTicket ?? (ordersCount > 0 ? (Number(data.netSales ?? data.net_sales ?? 0) / ordersCount) : 0));
  const dineInSales = Number(data.dineInSales ?? data.dine_in_sales ?? 0);
  const takeawaySales = Number(data.takeawaySales ?? data.takeaway_sales ?? 0);
  const deliverySales = Number(data.deliverySales ?? data.delivery_sales ?? 0);

  commands.push(
    { text: dashed, align: 'center' },
    { text: isAr ? '--- ملخص الطلبات والمبيعات ---' : '--- ORDERS SUMMARY ---', align: 'center', bold: true },
    { text: `${isAr ? 'إجمالي الطلبات' : 'Total Orders'}: ${ordersCount} | ${isAr ? 'متوسط الطلب' : 'Avg Ticket'}: ${avgTicket.toFixed(2)}`, align: 'center' },
    { text: `${isAr ? 'صالات (داخلي)' : 'Dine-In'}: ${dineInSales.toFixed(2)}`, align: 'center' },
    { text: `${isAr ? 'تيك أواي' : 'Takeaway'}: ${takeawaySales.toFixed(2)}`, align: 'center' },
    { text: `${isAr ? 'دليفري' : 'Delivery'}: ${deliverySales.toFixed(2)}`, align: 'center' },
  );

  // 2. Revenue Breakdown
  const grossSales = Number(data.grossSales ?? data.gross_sales ?? (data.gross_collected_cents ? data.gross_collected_cents / 100 : 0));
  const discounts = Number(data.discounts ?? data.discounts_total ?? 0);
  const taxes = Number(data.taxes ?? data.tax_total ?? 0);
  const netSales = Number(data.netSales ?? data.net_sales ?? (data.net_collected_cents ? data.net_collected_cents / 100 : grossSales - discounts));

  commands.push(
    { text: dashed, align: 'center' },
    { text: isAr ? '--- الإيرادات والضرائب ---' : '--- REVENUE & TAXES ---', align: 'center', bold: true },
    { text: `${isAr ? 'إجمالي المبيعات (Gross)' : 'Gross Sales'}: ${grossSales.toFixed(2)}`, align: 'center' },
    { text: `${isAr ? 'الخصومات' : 'Discounts'}: -${discounts.toFixed(2)}`, align: 'center' },
    { text: `${isAr ? 'الضرائب المحصلة' : 'Taxes'}: +${taxes.toFixed(2)}`, align: 'center' },
    { text: `${isAr ? 'صافي الإيرادات (Net)' : 'Net Revenue'}: ${netSales.toFixed(2)}`, align: 'center', bold: true, doubleHeight: true },
  );

  // 3. Payment Methods Breakdown
  const cashSales = Number(data.cashSales ?? data.cash_sales ?? 0);
  const cardSales = Number(data.cardSales ?? data.card_sales ?? 0);
  const walletSales = Number(data.walletSales ?? data.wallet_sales ?? 0);
  const aggregatorSales = Number(data.aggregatorSales ?? data.aggregator_sales ?? 0);

  commands.push(
    { text: dashed, align: 'center' },
    { text: isAr ? '--- طرق الدفع والتطبيقات ---' : '--- PAYMENTS & AGGREGATORS ---', align: 'center', bold: true },
    { text: `${isAr ? 'نقدية (كاش)' : 'Cash'}: ${cashSales.toFixed(2)}`, align: 'center', bold: true },
    { text: `${isAr ? 'بطاقات وفيزا' : 'Cards'}: ${cardSales.toFixed(2)}`, align: 'center' },
    { text: `${isAr ? 'محافظ وإنستاباي' : 'Wallets/InstaPay'}: ${walletSales.toFixed(2)}`, align: 'center' },
    { text: `${isAr ? 'تطبيقات التوصيل' : 'Aggregators'}: ${aggregatorSales.toFixed(2)}`, align: 'center' },
  );

  // 4. Cash Drawer Reconciliation (High-Contrast Center Box)
  const openingCash = Number(data.openingCash ?? data.opening_cash ?? (data.opening_float_cents ? data.opening_float_cents / 100 : 0));
  const cashIn = Number(data.cashIn ?? data.cash_in ?? data.cash_in_total ?? (data.pay_in_cents ? data.pay_in_cents / 100 : 0));
  const cashOut = Number(data.cashOut ?? data.cash_out ?? data.cash_out_total ?? ((Number(data.pay_out_cents || 0) + Number(data.safe_drop_cents || 0)) / 100));
  const refunds = Number(data.refunds ?? data.refunds_total ?? (data.refunded_cents ? data.refunded_cents / 100 : 0));
  const expectedCash = Number(data.expectedCash ?? data.expected_cash ?? (data.expected_cash_cents ? data.expected_cash_cents / 100 : openingCash + cashSales + cashIn - cashOut - refunds));
  const actualCash = Number(data.actualCash ?? data.actual_cash ?? data.counted_cash ?? (data.counted_cash_cents ? data.counted_cash_cents / 100 : 0));
  const variance = Number(data.cashVariance ?? data.variance ?? (data.variance_cents ? data.variance_cents / 100 : actualCash - expectedCash));

  const varianceText = Math.abs(variance) < 0.01
    ? (isAr ? 'مطابق (0.00)' : 'Exact (0.00)')
    : (variance > 0
        ? `+${variance.toFixed(2)} (${isAr ? 'زيادة' : 'Overage'})`
        : `${variance.toFixed(2)} (${isAr ? 'عجز' : 'Shortage'})`);

  commands.push(
    { text: divider, align: 'center', bold: true },
    { text: isAr ? '--- تسوية درج النقدية ---' : '--- CASH DRAWER RECONCILIATION ---', align: 'center', bold: true },
    { text: `${isAr ? 'الرصيد الافتتاحي' : 'Opening Float'}: ${openingCash.toFixed(2)}`, align: 'center' },
    { text: `${isAr ? '+ مبيعات الكاش' : '+ Cash Sales'}: +${cashSales.toFixed(2)}`, align: 'center' },
    { text: `${isAr ? '+ توريد نقدية (Cash In)' : '+ Cash In'}: +${cashIn.toFixed(2)}`, align: 'center' },
    { text: `${isAr ? '- مسحوبات ومصروفات (Cash Out)' : '- Cash Out'}: -${cashOut.toFixed(2)}`, align: 'center' },
    { text: `${isAr ? '- مرتجعات نقدية' : '- Cash Refunds'}: -${refunds.toFixed(2)}`, align: 'center' },
    { text: `${isAr ? '= النقدية المتوقعة بالدرج' : '= Expected Cash'}: ${expectedCash.toFixed(2)}`, align: 'center', bold: true },
  );

  if (data.preblindCount !== null && data.preblindCount !== undefined) {
    commands.push({ text: `${isAr ? 'عد الكاشير المبدئي' : 'Cashier Pre-Blind'}: ${Number(data.preblindCount).toFixed(2)}`, align: 'center' });
  }

  commands.push(
    { text: `${isAr ? 'النقدية الفعلية المعدودة' : 'Actual Counted Cash'}: ${actualCash.toFixed(2)}`, align: 'center', bold: true, doubleHeight: true },
    { text: `${isAr ? 'فارق الدرج' : 'Cash Variance'}: ${varianceText}`, align: 'center', bold: true },
  );

  const safeDropsTotal = Number(data.safeDropsTotal ?? data.safe_drops_total ?? 0);
  const safeBalance = Number(data.safeBalance ?? data.safe_balance ?? 0);
  if (safeDropsTotal > 0 || safeBalance > 0) {
    if (safeDropsTotal > 0) {
      commands.push({ text: `${isAr ? 'توريدات الخزنة بالوردية' : 'Mid-Shift Safe Drops'}: ${safeDropsTotal.toFixed(2)}`, align: 'center' });
    }
    if (safeBalance > 0) {
      commands.push({ text: `${isAr ? 'رصيد الخزنة الرئيسية' : 'Main Safe Balance'}: ${safeBalance.toFixed(2)}`, align: 'center', bold: true });
    }
  }

  // 4b. Cashier Anti-Theft & Integrity Summary
  const anomalyRiskScore = Number(data.anomalyRiskScore ?? data.anomaly_risk_score ?? 0);
  const anomalyCount = Number(data.anomalyCount ?? data.anomaly_count ?? 0);
  const postPrintDeletions = Number(data.postPrintDeletionsCount ?? data.post_print_deletions_count ?? 0);
  const noSaleOpens = Number(data.noSaleDrawerOpensCount ?? data.no_sale_drawer_opens_count ?? 0);

  if (anomalyRiskScore > 0 || anomalyCount > 0 || postPrintDeletions > 0 || noSaleOpens > 0) {
    commands.push(
      { text: dashed, align: 'center' },
      { text: isAr ? '--- نزاهة الوردية وكاشف التلاعب ---' : '--- ANTI-THEFT & INTEGRITY AUDIT ---', align: 'center', bold: true },
      { text: `${isAr ? 'مؤشر الخطورة' : 'Risk Score'}: ${anomalyRiskScore} | ${isAr ? 'الأنماط' : 'Anomalies'}: ${anomalyCount}`, align: 'center', bold: true },
      { text: `${isAr ? 'حذف بعد المبدئية' : 'Post-Prebill Deletions'}: ${postPrintDeletions}`, align: 'center' },
      { text: `${isAr ? 'فتح درج بدون بيع' : 'No-Sale Drawer Opens'}: ${noSaleOpens}`, align: 'center' },
    );
  }

  commands.push(
    { text: divider, align: 'center', bold: true },
  );

  // 5. BOM Cost, Waste, Expenses & Net Profit
  const bomCost = Number(data.expectedBomCost ?? data.expected_bom_cost ?? 0);
  const wasteCost = Number(data.authorizedWasteCost ?? data.authorized_waste_cost ?? 0);
  const expenses = Number(data.operatingExpenses ?? data.expenses_total ?? 0);
  const grossProfit = Number(data.expectedGrossProfit ?? data.expected_gross_profit ?? (netSales - bomCost));
  const netProfit = Number(data.expectedNetProfit ?? data.expected_net_profit ?? (grossProfit - wasteCost - expenses));

  commands.push(
    { text: isAr ? '--- تكلفة الخامات BOM والأرباح ---' : '--- BOM COST & EXPECTED PROFIT ---', align: 'center', bold: true },
    { text: `${isAr ? 'تكلفة خامات الوصفات المتوقعة (BOM)' : 'Expected BOM Materials Cost'}: ${bomCost.toFixed(2)}`, align: 'center' },
    { text: `${isAr ? 'مجمل الربح المتوقع' : 'Expected Gross Profit'}: ${grossProfit.toFixed(2)}`, align: 'center', bold: true },
    { text: `${isAr ? 'الهدر المعتمد' : 'Authorized Waste'}: -${wasteCost.toFixed(2)}`, align: 'center' },
    { text: `${isAr ? 'المصروفات التشغيلية' : 'Operating Expenses'}: -${expenses.toFixed(2)}`, align: 'center' },
    { text: `${isAr ? 'صافي الربح المتوقع' : 'Expected Net Profit'}: ${netProfit.toFixed(2)}`, align: 'center', bold: true, doubleHeight: true },
  );

  // Signatures
  commands.push(
    { text: dashed, align: 'center' },
    { text: isAr ? 'توقيع المدير: ____________________' : 'Manager Signature: ____________________', align: 'center', bold: true },
    { text: isAr ? 'توقيع المالك: ____________________' : 'Owner Signature: ____________________', align: 'center', bold: true },
    { text: divider, align: 'center' },
  );

  // Convert to Buffer bytes with center ESC/POS commands
  let rawText = '';
  const byteChunks: Buffer[] = [Buffer.from(ESC_INIT)];

  for (const item of commands) {
    rawText += centerText(item.text, columns) + '\n';
    byteChunks.push(Buffer.from(ESC_ALIGN_CENTER));
    if (item.bold) byteChunks.push(Buffer.from(ESC_BOLD_ON));
    if (item.doubleHeight) byteChunks.push(Buffer.from(ESC_DOUBLE_ON));
    byteChunks.push(Buffer.from(item.text + '\n', 'utf8'));
    if (item.doubleHeight) byteChunks.push(Buffer.from(ESC_DOUBLE_OFF));
    if (item.bold) byteChunks.push(Buffer.from(ESC_BOLD_OFF));
  }
  byteChunks.push(Buffer.from(ESC_FEED + ESC_FEED + ESC_CUT));

  return {
    text: rawText,
    commands,
    bytes: Buffer.concat(byteChunks),
  };
}

/**
 * Main Entry Point: Renders ESC/POS Z-Report or Pre-Blind Slip with Center Alignment
 */
export function renderThermalZReport(
  data: any,
  languageOrClosureType: 'ar' | 'en' | 'pre_blind_cashier' | 'full_day_close' = 'ar',
  languageOrColumns?: 'ar' | 'en' | number,
  columns = 42
): { text: string; commands: EscPosLineItem[]; bytes: Buffer; raw: string } {
  let lang: 'ar' | 'en' = 'ar';
  let closure = data.closure_type || (data.scope === 'session' ? 'pre_blind_cashier' : 'full_day_close');
  let col = columns;

  if (languageOrClosureType === 'pre_blind_cashier' || languageOrClosureType === 'full_day_close') {
    closure = languageOrClosureType;
    if (typeof languageOrColumns === 'string') lang = languageOrColumns as 'ar' | 'en';
  } else {
    lang = languageOrClosureType as 'ar' | 'en';
    if (typeof languageOrColumns === 'number') col = languageOrColumns;
  }

  const slipData = { ...data, closure_type: closure };
  const res = closure === 'pre_blind_cashier'
    ? buildPreBlindThermalSlip(slipData, lang, col)
    : buildFullZReportThermalSlip(slipData, lang, col);

  return { ...res, raw: res.bytes.toString('utf8') };
}

export function buildZReportEscPos(
  data: any,
  options?: { language?: 'ar' | 'en'; columns?: number }
): Buffer {
  return renderThermalZReport(data, options?.language || 'ar', options?.columns || 42).bytes;
}
