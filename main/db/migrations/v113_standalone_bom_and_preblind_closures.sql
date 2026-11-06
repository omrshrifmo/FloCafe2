-- =========================================================================
-- FloCafe Database Migration v113: Standalone BOM & Pre-Blind Closures
-- =========================================================================

-- 1. Allow BOM components to work WITH OR WITHOUT Inventory / Purchasing
-- Supports inline custom material names, units, and unit costs directly on bom_components
ALTER TABLE bom_components ADD COLUMN custom_material_name TEXT;
ALTER TABLE bom_components ADD COLUMN custom_unit TEXT DEFAULT 'g';
ALTER TABLE bom_components ADD COLUMN custom_unit_cost REAL DEFAULT 0;
ALTER TABLE bom_components ADD COLUMN cost_source TEXT DEFAULT 'auto'; -- 'auto' | 'manual' | 'inventory'

-- 2. Enhance cash_closures to support separated Pre-Blind Cashier Close vs Full Owner/Manager Day Close
-- plus detailed Z-report metrics and BOM expected cost/profit snapshots
ALTER TABLE cash_closures ADD COLUMN closure_type TEXT NOT NULL DEFAULT 'full_day_close'; -- 'pre_blind_cashier' | 'full_day_close'
ALTER TABLE cash_closures ADD COLUMN closed_by_name TEXT;
ALTER TABLE cash_closures ADD COLUMN closed_by_role TEXT;
ALTER TABLE cash_closures ADD COLUMN shift_opened_at TEXT;
ALTER TABLE cash_closures ADD COLUMN total_orders_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cash_closures ADD COLUMN dine_in_sales REAL NOT NULL DEFAULT 0;
ALTER TABLE cash_closures ADD COLUMN takeaway_sales REAL NOT NULL DEFAULT 0;
ALTER TABLE cash_closures ADD COLUMN delivery_sales REAL NOT NULL DEFAULT 0;
ALTER TABLE cash_closures ADD COLUMN wallet_sales REAL NOT NULL DEFAULT 0;
ALTER TABLE cash_closures ADD COLUMN aggregator_sales REAL NOT NULL DEFAULT 0;
ALTER TABLE cash_closures ADD COLUMN cash_in_total REAL NOT NULL DEFAULT 0;
ALTER TABLE cash_closures ADD COLUMN cash_out_total REAL NOT NULL DEFAULT 0;
ALTER TABLE cash_closures ADD COLUMN expenses_total REAL NOT NULL DEFAULT 0;
ALTER TABLE cash_closures ADD COLUMN expected_bom_cost REAL NOT NULL DEFAULT 0;
ALTER TABLE cash_closures ADD COLUMN authorized_waste_cost REAL NOT NULL DEFAULT 0;
ALTER TABLE cash_closures ADD COLUMN expected_gross_profit REAL NOT NULL DEFAULT 0;
ALTER TABLE cash_closures ADD COLUMN expected_net_profit REAL NOT NULL DEFAULT 0;
ALTER TABLE cash_closures ADD COLUMN declared_card_slips REAL NOT NULL DEFAULT 0;
ALTER TABLE cash_closures ADD COLUMN declared_wallet_slips REAL NOT NULL DEFAULT 0;
ALTER TABLE cash_closures ADD COLUMN denominations_json TEXT;
ALTER TABLE cash_closures ADD COLUMN linked_preblind_id TEXT;
ALTER TABLE cash_closures ADD COLUMN z_report_snapshot_json TEXT;

-- 3. Default settings for Standalone BOM Mode & Pre-Blind Cashier Close
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('bom_work_without_inventory', 'true'),
  ('bom_costing_mode', 'hybrid');
