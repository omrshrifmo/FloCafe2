-- =========================================================================
-- FloCafe Database Migration v114: Cash Security, Anti-Theft & Safe Vault
-- =========================================================================

-- 1. Track pre-bill printing on orders to detect post-print item removal / manipulation
ALTER TABLE orders ADD COLUMN pre_bill_printed_at TEXT;
ALTER TABLE orders ADD COLUMN pre_bill_print_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN pre_bill_last_total REAL;

-- 2. Cashier Anti-Theft & Operational Anomaly Logs
CREATE TABLE IF NOT EXISTS pos_anomaly_logs (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL, -- 'post_print_item_removed' | 'post_print_order_cancelled' | 'no_sale_drawer_open' | 'excessive_discount' | 'price_override_down' | 'post_checkout_void' | 'pre_blind_shortage'
  severity TEXT NOT NULL DEFAULT 'medium', -- 'low' | 'medium' | 'high' | 'critical'
  risk_points INTEGER NOT NULL DEFAULT 10,
  order_id TEXT,
  order_number TEXT,
  bill_id TEXT,
  shift_id TEXT,
  actor_user_id TEXT,
  actor_user_name TEXT,
  actor_role TEXT,
  item_name TEXT,
  quantity REAL DEFAULT 0,
  amount_impact REAL NOT NULL DEFAULT 0,
  reason TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 3. 3-Tier Cash Control: Main Store Safe Vault Ledger & Mid-Shift Safe Drops
CREATE TABLE IF NOT EXISTS safe_vault_ledger (
  id TEXT PRIMARY KEY,
  tx_type TEXT NOT NULL, -- 'mid_shift_safe_drop' | 'shift_close_transfer' | 'safe_to_drawer_float' | 'safe_expense_payout' | 'bank_deposit' | 'owner_withdrawal' | 'manual_adjustment'
  direction TEXT NOT NULL, -- 'in' | 'out'
  amount REAL NOT NULL,
  balance_after REAL NOT NULL,
  shift_id TEXT,
  closure_id TEXT,
  reference_note TEXT,
  actor_user_id TEXT,
  actor_user_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 4. Track mid-shift safe drops on cash_closures
ALTER TABLE cash_closures ADD COLUMN safe_drops_total REAL NOT NULL DEFAULT 0;
ALTER TABLE cash_closures ADD COLUMN anomaly_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cash_closures ADD COLUMN anomaly_risk_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cash_closures ADD COLUMN post_print_deletions_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cash_closures ADD COLUMN no_sale_drawer_opens_count INTEGER NOT NULL DEFAULT 0;
