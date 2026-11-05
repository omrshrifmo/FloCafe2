-- =========================================================================
-- FloCafe Database Migration v112: WhatsApp Win-Back & Multi-Branch Sync
-- =========================================================================

-- 1. Customer Win-Back Vouchers & Automation Logs
CREATE TABLE IF NOT EXISTS customer_winback_vouchers (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_name TEXT,
  voucher_code TEXT NOT NULL UNIQUE,
  discount_pct REAL NOT NULL DEFAULT 15,
  status TEXT NOT NULL DEFAULT 'sent', -- 'sent' | 'redeemed' | 'expired'
  inactive_days INTEGER NOT NULL DEFAULT 14,
  whatsapp_sent INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  redeemed_at TEXT,
  redeemed_order_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_customer_winback_vouchers_customer_id ON customer_winback_vouchers(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_winback_vouchers_code ON customer_winback_vouchers(voucher_code);
CREATE INDEX IF NOT EXISTS idx_customer_winback_vouchers_status ON customer_winback_vouchers(status);

-- 2. Multi-Branch EOD Sync Bundles (Z-Report + P&L Summary + Encrypted Backup Metadata)
CREATE TABLE IF NOT EXISTS multibranch_eod_sync_logs (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  closure_id TEXT,
  business_date TEXT NOT NULL,
  z_report_json TEXT NOT NULL,
  pnl_summary_json TEXT NOT NULL,
  drive_file_id TEXT,
  encrypted_payload_sha256 TEXT,
  sync_channel TEXT NOT NULL DEFAULT 'local+drive+sentinel',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_multibranch_eod_sync_date ON multibranch_eod_sync_logs(business_date);
CREATE INDEX IF NOT EXISTS idx_multibranch_eod_sync_branch ON multibranch_eod_sync_logs(branch_id);

-- 3. Supplier Credit Notes
CREATE TABLE IF NOT EXISTS supplier_credit_notes (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  po_id TEXT,
  haccp_log_id TEXT,
  amount REAL NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'applied', -- 'applied' | 'pending' | 'refunded'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_supplier_credit_notes_supplier_id ON supplier_credit_notes(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_credit_notes_po_id ON supplier_credit_notes(po_id);

-- 4. Default Settings for WhatsApp Auto-Receipt, 14-Day Win-Back, Blind Shift Close & Fiscal QR
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('whatsapp_auto_receipt_enabled', 'true'),
  ('whatsapp_winback_enabled', 'true'),
  ('whatsapp_winback_inactive_days', '14'),
  ('whatsapp_winback_discount_pct', '15'),
  ('whatsapp_winback_template', 'Hi {name}! We miss seeing you at {store}. Enjoy {discount}% OFF your next coffee or meal with code {code} (valid for 7 days)!'),
  ('blind_shift_close', 'false'),
  ('fiscal_qr_enabled', 'true'),
  ('fiscal_qr_mode', 'EGYPT_ETA_ZATCA'),
  ('fiscal_seller_name', 'FloCafe'),
  ('fiscal_vat_number', '300000000000003'),
  ('eod_gdrive_sync_enabled', 'true');
