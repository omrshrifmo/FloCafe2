import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { getDatabase, generateOrderNumber, withTxn } from '../db';
import { asyncHandler } from '../middleware/async-handler';
import { verifyHardwareLicense, activateWithKeyFile } from '../services/hardware-license';
import { broadcastWsEvent } from '../services/kds';

export const floadminRoutes = Router();
export const florevRoutes = Router();
export const orderfloRoutes = Router();

// ── FloAdmin Routes (/api/floadmin) ──────────────────────────────────────────

floadminRoutes.get(['/stats', '/overview'], asyncHandler(async (_req: Request, res: Response) => {
  const db = getDatabase();

  // Orders today
  const todayRow = db.prepare(`
    SELECT count(*) as count, coalesce(sum(total), 0) as revenue
    FROM orders
    WHERE date(created_at, 'localtime') = date('now', 'localtime') AND status != 'cancelled'
  `).get() as any;

  // Orders this month
  const monthRow = db.prepare(`
    SELECT count(*) as count, coalesce(sum(total), 0) as revenue
    FROM orders
    WHERE strftime('%Y-%m', created_at, 'localtime') = strftime('%Y-%m', 'now', 'localtime') AND status != 'cancelled'
  `).get() as any;

  // Inventory valuation & low stock
  let invVal = 0;
  let totalProducts = 0;
  let lowStockCount = 0;
  try {
    const invRow = db.prepare(`
      SELECT
        coalesce(sum(quantity * coalesce(cost_price, 0)), 0) as totalValue,
        count(*) as count,
        sum(CASE WHEN quantity <= coalesce(min_quantity, 5) THEN 1 ELSE 0 END) as lowStock
      FROM inventory_items
      WHERE is_active = 1
    `).get() as any;
    invVal = Number(invRow?.totalValue || 0);
    totalProducts = Number(invRow?.count || 0);
    lowStockCount = Number(invRow?.lowStock || 0);
  } catch {}

  // Active staff count
  let staffCount = 0;
  try {
    const staffRow = db.prepare(`SELECT count(*) as count FROM users WHERE is_active = 1`).get() as any;
    staffCount = Number(staffRow?.count || 0);
  } catch {}

  // Operating expenses this month
  let totalExpenses = 0;
  try {
    const expRow = db.prepare(`
      SELECT coalesce(sum(amount), 0) as total
      FROM operating_expenses
      WHERE strftime('%Y-%m', created_at, 'localtime') = strftime('%Y-%m', 'now', 'localtime')
    `).get() as any;
    totalExpenses = Number(expRow?.total || 0);
  } catch {}

  // Low stock items sample
  let lowStockItems: any[] = [];
  try {
    lowStockItems = db.prepare(`
      SELECT id, name, sku, unit, quantity, min_quantity, cost_price
      FROM inventory_items
      WHERE is_active = 1 AND quantity <= coalesce(min_quantity, 5)
      LIMIT 10
    `).all();
  } catch {}

  // Price overrides
  let priceOverrides: any[] = [];
  try {
    priceOverrides = db.prepare(`
      SELECT * FROM price_override_logs ORDER BY id DESC LIMIT 10
    `).all();
  } catch {}

  const revenueToday = Number(todayRow?.revenue || 0);
  const ordersToday = Number(todayRow?.count || 0);
  const revenueMonth = Number(monthRow?.revenue || 0);
  const ordersMonth = Number(monthRow?.count || 0);
  const netProfit = revenueMonth - totalExpenses;
  const marginPct = revenueMonth > 0 ? ((netProfit / revenueMonth) * 100).toFixed(1) : '0.0';

  res.json({
    status: 'ok',
    stats: {
      revenueToday,
      ordersToday,
      revenueMonth,
      ordersMonth,
      inventoryValue: invVal,
      totalProducts,
      lowStockCount,
      activeStaffCount: staffCount,
    },
    revenueToday,
    ordersToday,
    revenueMonth,
    ordersMonth,
    inventoryValue: invVal,
    totalProducts,
    lowStockCount,
    activeStaffCount: staffCount,
    grossSales: revenueMonth,
    netSales: revenueMonth,
    totalExpenses,
    operatingProfit: netProfit,
    pnl: {
      gross_revenue: revenueMonth,
      expenses: totalExpenses,
      net_profit: netProfit,
      margin_pct: Number(marginPct),
    },
    lowStockItems,
    priceOverrides,
    sync_status: {
      status: 'offline_authoritative',
      last_sync: new Date().toISOString(),
    },
  });
}));

floadminRoutes.post('/sync-catalog', asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const { action, catalog } = req.body || {};

  if (action === 'import' && catalog) {
    withTxn(() => {
      if (Array.isArray(catalog.categories)) {
        for (const cat of catalog.categories) {
          db.prepare(`
            INSERT OR REPLACE INTO categories (id, name, is_active, sort_order, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'))
          `).run(cat.id, cat.name, cat.is_active ?? 1, cat.sort_order ?? 0);
        }
      }
      if (Array.isArray(catalog.products)) {
        for (const prod of catalog.products) {
          db.prepare(`
            INSERT OR REPLACE INTO products (id, name, category_id, price, is_active, updated_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
          `).run(prod.id, prod.name, prod.category_id, prod.price, prod.is_active ?? 1);
        }
      }
    });
    return res.json({ success: true, message: 'Catalog imported successfully' });
  }

  // Default: export snapshot
  const categories = db.prepare('SELECT * FROM categories WHERE is_active = 1').all();
  const products = db.prepare('SELECT * FROM products WHERE is_active = 1').all();
  res.json({
    status: 'ok',
    version: '4.4.1',
    exported_at: new Date().toISOString(),
    catalog: { categories, products },
  });
}));

// ── FloRev Routes (/api/florev) ──────────────────────────────────────────────

florevRoutes.get(['/stats', '/live'], asyncHandler(async (_req: Request, res: Response) => {
  const db = getDatabase();
  const todayRow = db.prepare(`
    SELECT count(*) as count, coalesce(sum(total), 0) as total
    FROM orders
    WHERE date(created_at, 'localtime') = date('now', 'localtime') AND status != 'cancelled'
  `).get() as any;

  const todaySales = Number(todayRow?.total || 0);
  const ordersCount = Number(todayRow?.count || 0);
  const avgOrderValue = ordersCount > 0 ? todaySales / ordersCount : 0;

  // Cash session
  let activeSession: any = null;
  try {
    activeSession = db.prepare(`
      SELECT * FROM cash_sessions WHERE status = 'open' ORDER BY id DESC LIMIT 1
    `).get();
  } catch {}

  // Tables
  let occupiedTables = 0;
  let availableTables = 0;
  let totalTables = 0;
  try {
    const tableCounts = db.prepare(`
      SELECT
        sum(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) as occupied,
        sum(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
        count(*) as total
      FROM tables
      WHERE is_active = 1
    `).get() as any;
    occupiedTables = Number(tableCounts?.occupied || 0);
    availableTables = Number(tableCounts?.available || 0);
    totalTables = Number(tableCounts?.total || 0);
  } catch {}

  // KDS tickets
  let kdsCount = 0;
  try {
    const kdsRow = db.prepare(`
      SELECT count(*) as count FROM orders WHERE status IN ('pending', 'preparing')
    `).get() as any;
    kdsCount = Number(kdsRow?.count || 0);
  } catch {}

  // Low stock warnings
  let lowStockList: any[] = [];
  try {
    lowStockList = db.prepare(`
      SELECT id, name, quantity, min_quantity
      FROM inventory_items
      WHERE is_active = 1 AND quantity <= coalesce(min_quantity, 5)
      LIMIT 10
    `).all();
  } catch {}

  // HACCP breaches
  let haccpBreaches = 0;
  try {
    const haccpRow = db.prepare(`
      SELECT count(*) as count FROM haccp_logs
      WHERE status = 'fail' AND date(created_at, 'localtime') = date('now', 'localtime')
    `).get() as any;
    haccpBreaches = Number(haccpRow?.count || 0);
  } catch {}

  // License
  const license = verifyHardwareLicense(db);

  res.json({
    status: 'ok',
    todaySales,
    ordersCount,
    avgOrderValue,
    openTables: occupiedTables,
    availableTables,
    totalTables,
    kdsQueueLength: kdsCount,
    cashDrawerExpected: activeSession ? Number(activeSession.expected_balance || activeSession.opening_balance || 0) : 0,
    opening_float: activeSession ? Number(activeSession.opening_balance || 0) : 0,
    activeShiftOpen: Boolean(activeSession),
    active_session_id: activeSession ? activeSession.id : null,
    lowStockWarnings: lowStockList,
    alertsCount: lowStockList.length + haccpBreaches,
    haccpBreaches,
    license_tier: license.tier || 'unactivated',
    license_valid: Boolean(license.valid),
    license_expires_at: license.expires_at || null,
  });
}));

florevRoutes.post('/quick-action', asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const { action, payload } = req.body || {};

  if (action === 'backup_db') {
    const backupDir = path.resolve(process.cwd(), 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const backupFile = path.join(backupDir, `flo-manual-${Date.now()}.db`);
    await db.backup(backupFile);
    return res.json({ success: true, action: 'backup_db', backup_path: backupFile });
  }

  if (action === 'log_expense') {
    const { category, amount, description } = payload || {};
    if (!amount) return res.status(400).json({ error: 'Missing expense amount' });
    db.prepare(`
      INSERT INTO operating_expenses (category, amount, description, created_at, updated_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(category || 'General', Number(amount), description || 'Mobile quick expense');
    return res.json({ success: true, action: 'log_expense' });
  }

  if (action === 'switch_license') {
    const { tierKeyContent, ownerMasterKeyContent, reactivationPassword } = payload || {};
    const actRes = activateWithKeyFile(db, {
      tierKeyContent,
      ownerMasterKeyContent,
      reactivationPassword,
      forceReplaceActive: true,
    });
    return res.json(actRes);
  }

  res.status(400).json({ error: `Unrecognized quick action: "${action}"` });
}));

// ── OrderFlo Routes (/api/orderflo) ──────────────────────────────────────────

orderfloRoutes.get('/tables', asyncHandler(async (_req: Request, res: Response) => {
  const db = getDatabase();
  const tables = db.prepare('SELECT * FROM tables WHERE is_active = 1 ORDER BY number ASC').all();
  res.json(tables);
}));

orderfloRoutes.get('/menu', asyncHandler(async (_req: Request, res: Response) => {
  const db = getDatabase();
  const categories = db.prepare('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order ASC, name ASC').all();
  const products = db.prepare('SELECT * FROM products WHERE is_active = 1 ORDER BY name ASC').all();
  res.json({ status: 'ok', categories, products });
}));

orderfloRoutes.get('/queue', asyncHandler(async (_req: Request, res: Response) => {
  const db = getDatabase();
  const orders = db.prepare(`
    SELECT * FROM orders
    WHERE status IN ('pending', 'confirmed', 'preparing')
    ORDER BY id DESC
    LIMIT 50
  `).all();
  res.json(orders);
}));

orderfloRoutes.post('/orders', asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const { table_id, order_type, customer_name, items, notes } = req.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Order must contain at least one item.' });
  }

  let total = 0;
  for (const item of items) {
    const qty = Number(item.quantity || 1);
    const unitPrice = Number(item.unit_price || 0);
    total += qty * unitPrice;
  }

  const orderNumber = generateOrderNumber();
  const effectiveType = order_type || (table_id ? 'dine_in' : 'takeaway');

  const createdOrder = withTxn(() => {
    const insertOrderStmt = db.prepare(`
      INSERT INTO orders (
        order_number, type, table_id, status, total, subtotal, special_instructions,
        aggregator_commission_rate, aggregator_commission_amount,
        created_at, updated_at
      )
      VALUES (?, ?, ?, 'pending', ?, ?, ?, 0, 0, datetime('now'), datetime('now'))
    `);
    const orderResult = insertOrderStmt.run(
      orderNumber,
      effectiveType,
      table_id || null,
      total,
      total,
      notes || (customer_name ? `Customer: ${customer_name}` : null),
    );
    const orderId = Number(orderResult.lastInsertRowid);

    const insertItemStmt = db.prepare(`
      INSERT INTO order_items (
        order_id, product_id, product_name, unit_price, quantity,
        inventory_deducted_quantity, subtotal, total, special_instructions,
        status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'pending', datetime('now'), datetime('now'))
    `);

    for (const item of items) {
      const qty = Number(item.quantity || 1);
      const unitPrice = Number(item.unit_price || 0);
      const itemSubtotal = qty * unitPrice;
      const prodName = item.product_name || `Product #${item.product_id}`;
      insertItemStmt.run(
        orderId,
        item.product_id,
        prodName,
        unitPrice,
        qty,
        itemSubtotal,
        itemSubtotal,
        item.notes || item.special_instructions || null,
      );
    }

    if (table_id) {
      db.prepare(`UPDATE tables SET status = 'occupied', updated_at = datetime('now') WHERE id = ?`).run(table_id);
    }

    return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  });

  try {
    broadcastWsEvent('orders_updated', { order: createdOrder });
    broadcastWsEvent('tables:updated', { table_id });
  } catch {}

  res.status(201).json({
    success: true,
    order: createdOrder,
  });
}));
