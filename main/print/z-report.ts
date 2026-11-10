/**
 * FloCafe Backend Thermal ESC/POS Z-Report & Pre-Blind Slip Template
 *
 * 100% pure center-aligned (ESC/POS \x1b\x61\x01 / align: 'center'), high-contrast,
 * bilingual Arabic/English thermal slips for 80mm/58mm receipt printers.
 * All lines are strictly centered within a narrow column (max 26 characters),
 * ensuring wide white safety margins on both left and right sides so text never clips.
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
 * Format a center-aligned text line padded to width (default 26 chars for safe thermal margins)
 */
export function centerText(text: string, width = 26): string {
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
  columns = 26
): { text: string; commands: EscPosLineItem[]; bytes: Buffer } {
  const isAr = language === 'ar';
  const width = Math.min(columns, 26);
  const divider = '='.repeat(width);
  const dashed = '-'.repeat(width);

  const title = isAr
    ? 'تسليم وردية مبدئي أعمى للكاشير'
    : 'PRE-BLIND CASHIER SHIFT SLIP';
  const subtitle = isAr ? 'تسليم نقدية الوردية' : 'CASH DRAWER COUNT HANDOVER';

  const commands: EscPosLineItem[] = [
    { text: String(data.storeName || 'FloCafe'), align: 'center', bold: true, doubleHeight: true },
  ];

  if (data.branchName) {
    commands.push({ text: String(data.branchName), align: 'center', bold: true });
  }

  commands.push(
    { text: divider, align: 'center', bold: true },
    { text: title, align: 'center', bold: true },
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
      { text: isAr ? '--- تفقيط الفئات النقدية ---' : '--- DENOMINATIONS ---', align: 'center', bold: true },
    );
    for (const [denom, count] of Object.entries(data.denominations)) {
      const c = Number(count) || 0;
      if (c > 0) {
        commands.push({ text: `${denom} x ${c} = ${(Number(denom) * c).toFixed(2)}`, align: 'center' });
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
    { text: `${isAr ? 'إيصالات الفيزا' : 'Card Slips'}: ${declaredCard.toFixed(2)}`, align: 'center', bold: true },
    { text: `${isAr ? 'إيصالات المحافظ' : 'Wallet Slips'}: ${declaredWallet.toFixed(2)}`, align: 'center', bold: true },
  );

  if (data.notes) {
    commands.push(
      { text: dashed, align: 'center' },
      { text: `${isAr ? 'ملاحظات' : 'Notes'}: ${data.notes}`, align: 'center' },
    );
  }

  // Stacked Centered Signatures
  commands.push(
    { text: dashed, align: 'center' },
    { text: isAr ? 'توقيع الكاشير' : 'Cashier Signature', align: 'center' },
    { text: '____________________', align: 'center' },
    { text: isAr ? 'توقيع المستلم' : 'Manager Signature', align: 'center' },
    { text: '____________________', align: 'center' },
    { text: divider, align: 'center' },
  );

  // Convert to Buffer bytes with center ESC/POS commands
  let rawText = '';
  const byteChunks: Buffer[] = [Buffer.from(ESC_INIT)];

  for (const item of commands) {
    rawText += centerText(item.text, width) + '\n';
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
  columns = 26
): { text: string; commands: EscPosLineItem[]; bytes: Buffer } {
  const isAr = language === 'ar';
  const width = Math.min(columns, 26);
  const divider = '='.repeat(width);
  const dashed = '-'.repeat(width);

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
    { text: title, align: 'center', bold: true },
    { text: `Z-ID: #${data.zNumber || data.z_number || '0000'} ${data.closureNumber ? `| #${data.closureNumber}` : ''}`.trim(), align: 'center', bold: true },
    { text: divider, align: 'center', bold: true },
  );

  // Period & Staff
  commands.push(
    { text: `${isAr ? 'بداية الفترة' : 'Start'}: ${data.periodStart || data.period_start || '-'}`, align: 'center' },
    { text: `${isAr ? 'نهاية الفترة' : 'End'}: ${data.periodEnd || data.period_end || '-'}`, align: 'center' },
    { text: `${isAr ? 'تم الإغلاق بواسطة' : 'By'}: ${data.closedBy || data.closed_by_name || '-'}`, align: 'center', bold: true },
  );

  // 1. Reconciliation & Explicit Deficit / Surplus
  const expectedCash = Number(data.expectedCash ?? data.expected_cash ?? (data.expected_cash_cents ? data.expected_cash_cents / 100 : 0));
  const actualCash = Number(data.actualCash ?? data.actual_cash ?? data.counted_cash ?? (data.counted_cash_cents ? data.counted_cash_cents / 100 : 0));
  const diff = actualCash - expectedCash;
  const rawDeficit = Number(data.deficitAmount ?? data.deficit_amount ?? (diff < -0.009 ? Math.abs(diff) : 0));
  const rawSurplus = Number(data.surplusAmount ?? data.surplus_amount ?? (diff > 0.009 ? diff : 0));

  let statusLabel = isAr ? 'مطابق (0.00)' : 'Exact (0.00)';
  if (rawDeficit > 0.009) {
    statusLabel = isAr ? `عجز نقدية: -${rawDeficit.toFixed(2)}` : `Deficit: -${rawDeficit.toFixed(2)}`;
  } else if (rawSurplus > 0.009) {
    statusLabel = isAr ? `فائض نقدية: +${rawSurplus.toFixed(2)}` : `Surplus: +${rawSurplus.toFixed(2)}`;
  }

  commands.push(
    { text: divider, align: 'center', bold: true },
    { text: isAr ? '--- تسوية درج النقدية ---' : '--- CASH RECONCILIATION ---', align: 'center', bold: true },
    { text: `${isAr ? 'المتوقع بالدرج' : 'Expected'}: ${expectedCash.toFixed(2)}`, align: 'center' },
    { text: `${isAr ? 'الفعلي المعدود' : 'Counted'}: ${actualCash.toFixed(2)}`, align: 'center', bold: true, doubleHeight: true },
    { text: statusLabel, align: 'center', bold: true },
    { text: `${isAr ? 'العجز' : 'Deficit'}: ${rawDeficit.toFixed(2)} | ${isAr ? 'الفائض' : 'Surplus'}: ${rawSurplus.toFixed(2)}`, align: 'center' },
    { text: divider, align: 'center', bold: true },
  );

  // 2. Cash Movements Details
  const movSummary = data.cashMovementsSummary || data.cash_movements_summary;
  const openingCash = Number(movSummary?.opening_cash ?? data.openingCash ?? data.opening_cash ?? 0);
  const payIn = Number(movSummary?.pay_in_total ?? data.cashIn ?? data.cash_in ?? 0);
  const payOut = Number(movSummary?.pay_out_total ?? data.cashOut ?? data.cash_out ?? 0);
  const expenses = Number(movSummary?.cash_expenses_total ?? data.operatingExpenses ?? data.expenses_total ?? 0);
  const safeDrops = Number(movSummary?.safe_drops_total ?? data.safeDropsTotal ?? data.safe_drops_total ?? 0);
  const refunds = Number(movSummary?.cash_refunds_total ?? data.refunds ?? data.refunds_total ?? 0);
  const detailedMovements = data.cashMovementsDetailed || data.cash_movements_detailed || [];

  commands.push(
    { text: isAr ? '--- حركات درج النقدية ---' : '--- CASH MOVEMENTS ---', align: 'center', bold: true },
    { text: `${isAr ? 'الرصيد الافتتاحي' : 'Opening Float'}: ${openingCash.toFixed(2)}`, align: 'center' },
    { text: `${isAr ? '+ توريد (Pay In)' : '+ Cash In'}: +${payIn.toFixed(2)}`, align: 'center' },
    { text: `${isAr ? '- مسحوبات (Pay Out)' : '- Cash Out'}: -${payOut.toFixed(2)}`, align: 'center' },
  );
  if (expenses > 0) commands.push({ text: `${isAr ? '- مصروفات' : '- Expenses'}: -${expenses.toFixed(2)}`, align: 'center' });
  if (safeDrops > 0) commands.push({ text: `${isAr ? '- توريد خزنة' : '- Safe Drop'}: -${safeDrops.toFixed(2)}`, align: 'center' });
  if (refunds > 0) commands.push({ text: `${isAr ? '- مرتجعات' : '- Refunds'}: -${refunds.toFixed(2)}`, align: 'center' });

  if (detailedMovements.length > 0) {
    for (const m of detailedMovements.slice(0, 6)) {
      commands.push({
        text: `${isAr ? m.label_ar : m.label_en}: ${m.direction === 'in' ? '+' : '-'}${Number(m.amount).toFixed(2)}`,
        align: 'center',
      });
    }
  }

  // 3. Payment Methods Breakdown
  const detailedMethods = data.paymentMethodsDetailed || data.payment_methods_detailed || [];
  const cashSales = Number(data.cashSales ?? data.cash_sales ?? 0);
  const cardSales = Number(data.cardSales ?? data.card_sales ?? 0);
  const walletSales = Number(data.walletSales ?? data.wallet_sales ?? 0);
  const aggregatorSales = Number(data.aggregatorSales ?? data.aggregator_sales ?? 0);

  commands.push(
    { text: dashed, align: 'center' },
    { text: isAr ? '--- تفاصيل طرق الدفع ---' : '--- PAYMENTS BREAKDOWN ---', align: 'center', bold: true },
  );
  if (detailedMethods.length > 0) {
    for (const m of detailedMethods) {
      commands.push({
        text: `${isAr ? m.label_ar : m.label_en} (${m.transactions_count}): ${Number(m.total_amount).toFixed(2)}`,
        align: 'center',
      });
    }
  } else {
    commands.push(
      { text: `${isAr ? 'نقدية (كاش)' : 'Cash'}: ${cashSales.toFixed(2)}`, align: 'center' },
      { text: `${isAr ? 'بطاقات وفيزا' : 'Cards'}: ${cardSales.toFixed(2)}`, align: 'center' },
      { text: `${isAr ? 'محافظ وإنستاباي' : 'Wallets'}: ${walletSales.toFixed(2)}`, align: 'center' },
      { text: `${isAr ? 'تطبيقات توصيل' : 'Aggregators'}: ${aggregatorSales.toFixed(2)}`, align: 'center' },
    );
  }

  // 4. Orders Breakdown
  const ordersCount = Number(data.ordersCount ?? data.total_orders_count ?? 0);
  const avgTicket = Number(data.avgTicket ?? (ordersCount > 0 ? (Number(data.netSales ?? data.net_sales ?? 0) / ordersCount) : 0));
  const dineInSales = Number(data.dineInSales ?? data.dine_in_sales ?? 0);
  const takeawaySales = Number(data.takeawaySales ?? data.takeaway_sales ?? 0);
  const deliverySales = Number(data.deliverySales ?? data.delivery_sales ?? 0);

  commands.push(
    { text: dashed, align: 'center' },
    { text: isAr ? '--- ملخص الطلبات ---' : '--- ORDERS SUMMARY ---', align: 'center', bold: true },
    { text: `${isAr ? 'الطلبات' : 'Orders'}: ${ordersCount} | ${isAr ? 'المتوسط' : 'Avg'}: ${avgTicket.toFixed(2)}`, align: 'center' },
    { text: `${isAr ? 'صالات' : 'Dine-In'}: ${dineInSales.toFixed(2)}`, align: 'center' },
    { text: `${isAr ? 'تيك أواي' : 'Takeaway'}: ${takeawaySales.toFixed(2)}`, align: 'center' },
    { text: `${isAr ? 'توصيل' : 'Delivery'}: ${deliverySales.toFixed(2)}`, align: 'center' },
  );

  // 5. Sold Items Breakdown & Taxes
  const soldItems = data.soldItemsBreakdown || data.sold_items_breakdown || [];
  const totalSoldQty = Number(data.totalSoldItemsQty ?? data.total_sold_items_qty ?? (soldItems.reduce((acc: number, i: any) => acc + (Number(i.bulk_qty) || 0), 0) || data.soldItemsCount || 0));
  const totalSalesExclTax = Number(data.totalSalesExclTax ?? data.total_sales_excl_tax ?? soldItems.reduce((acc: number, i: any) => acc + (Number(i.total_excl_tax) || 0), 0));
  const totalTaxQty = Number(data.totalTaxQuantity ?? data.total_tax_quantity ?? soldItems.filter((i: any) => Number(i.item_tax_amount || 0) > 0).reduce((acc: number, i: any) => acc + (Number(i.bulk_qty) || 0), 0));
  const totalTaxAmt = Number(data.totalTaxAmount ?? data.total_tax_amount ?? (data.taxes || 0));

  commands.push(
    { text: dashed, align: 'center' },
    { text: isAr ? '--- الأصناف والضرائب ---' : '--- SOLD ITEMS & TAXES ---', align: 'center', bold: true },
    { text: `${isAr ? 'إجمالي المباع' : 'Total Items Sold'}: ${totalSoldQty}`, align: 'center', bold: true },
    { text: `${isAr ? 'المبيعات بدون ضريبة' : 'Sales Excl Tax'}: ${totalSalesExclTax.toFixed(2)}`, align: 'center' },
    { text: `${isAr ? 'المباع الخاضع للضريبة' : 'Taxed Items Qty'}: ${totalTaxQty}`, align: 'center' },
    { text: `${isAr ? 'إجمالي الضريبة' : 'Tax Amount'}: ${totalTaxAmt.toFixed(2)}`, align: 'center' },
  );

  if (soldItems.length > 0) {
    commands.push({ text: isAr ? 'قائمة الأصناف المباعة:' : 'Sold Items List:', align: 'center', bold: true });
    for (const item of soldItems.slice(0, 15)) {
      commands.push({
        text: `${item.product_name} (${item.bulk_qty})`,
        align: 'center',
        bold: true,
      });
      commands.push({
        text: `${isAr ? 'سعر بدون ضريبة' : 'Pre-tax'}: ${Number(item.unit_price_excl_tax).toFixed(2)} | ${isAr ? 'إجمالي' : 'Tot'}: ${Number(item.total_excl_tax).toFixed(2)}`,
        align: 'center',
      });
    }
  }

  // 6. BOM Cost & Profits
  const bomCost = Number(data.expectedBomCost ?? data.expected_bom_cost ?? 0);
  const netProfit = Number(data.expectedNetProfit ?? data.expected_net_profit ?? 0);

  commands.push(
    { text: dashed, align: 'center' },
    { text: isAr ? '--- تكلفة الخامات والأرباح ---' : '--- BOM COST & PROFIT ---', align: 'center', bold: true },
    { text: `${isAr ? 'تكلفة خامات الوصفات المتوقعة (BOM)' : 'Expected BOM Materials Cost'}: ${bomCost.toFixed(2)}`, align: 'center' },
    { text: `${isAr ? 'صافي الربح المتوقع' : 'Net Profit'}: ${netProfit.toFixed(2)}`, align: 'center', bold: true, doubleHeight: true },
  );

  // Stacked Centered Signatures
  commands.push(
    { text: dashed, align: 'center' },
    { text: isAr ? 'توقيع المدير' : 'Manager Signature', align: 'center' },
    { text: '____________________', align: 'center' },
    { text: isAr ? 'توقيع المالك' : 'Owner Signature', align: 'center' },
    { text: '____________________', align: 'center' },
    { text: divider, align: 'center' },
  );

  // Convert to Buffer bytes with center ESC/POS commands
  let rawText = '';
  const byteChunks: Buffer[] = [Buffer.from(ESC_INIT)];

  for (const item of commands) {
    rawText += centerText(item.text, width) + '\n';
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
  columns = 26
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
  return renderThermalZReport(data, options?.language || 'ar', options?.columns || 26).bytes;
}
