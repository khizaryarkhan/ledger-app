-- ============================================================
-- LEDGER APP — RECONCILIATION MIGRATION
-- Run this in Neon SQL Editor before deploying the new code
-- console.neon.tech → your project → SQL Editor
-- ============================================================

-- 1. Add QBO reconciliation fields to invoices
ALTER TABLE invoices 
  ADD COLUMN IF NOT EXISTS qbo_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS qbo_balance REAL,
  ADD COLUMN IF NOT EXISTS qbo_customer_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS qbo_synced_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS txn_type VARCHAR(32) DEFAULT 'Invoice';

-- Index for fast QBO ID lookups (used on every sync)
CREATE INDEX IF NOT EXISTS invoices_qbo_id_idx ON invoices(qbo_id);
CREATE INDEX IF NOT EXISTS invoices_txn_type_idx ON invoices(txn_type);

-- 2. Add QBO fields to customers  
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS qbo_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS phone VARCHAR(64),
  ADD COLUMN IF NOT EXISTS email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS address_street VARCHAR(255),
  ADD COLUMN IF NOT EXISTS address_city VARCHAR(64),
  ADD COLUMN IF NOT EXISTS address_postcode VARCHAR(32),
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(64),
  ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);

CREATE INDEX IF NOT EXISTS customers_qbo_id_idx ON customers(qbo_id);

-- 3. Add QBO fields to projects
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS qbo_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS start_date VARCHAR(16),
  ADD COLUMN IF NOT EXISTS end_date VARCHAR(16),
  ADD COLUMN IF NOT EXISTS projected_end_date VARCHAR(16);

-- 4. Create QBO sync log table
CREATE TABLE IF NOT EXISTS qbo_sync_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  synced_at TIMESTAMP NOT NULL DEFAULT NOW(),
  status VARCHAR(16) NOT NULL DEFAULT 'success',
  qbo_total_ar REAL,
  ledger_total_ar REAL,
  difference REAL,
  customers_created INTEGER DEFAULT 0,
  invoices_created INTEGER DEFAULT 0,
  invoices_updated INTEGER DEFAULT 0,
  invoices_closed INTEGER DEFAULT 0,
  credits_created INTEGER DEFAULT 0,
  error_message TEXT,
  duration_ms INTEGER
);

-- 5. Create Gmail tokens table (if not already created)
CREATE TABLE IF NOT EXISTS gmail_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gmail_tokens_user_id_idx ON gmail_tokens(user_id);

-- 6. Create QBO tokens table (if not already created)
CREATE TABLE IF NOT EXISTS qbo_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  realm_id VARCHAR(64) NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMP NOT NULL,
  refresh_token_expires_at TIMESTAMP NOT NULL,
  company_name VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS qbo_tokens_user_id_idx ON qbo_tokens(user_id);

-- Verify migration ran correctly
SELECT 
  'invoices' as table_name,
  COUNT(*) as rows,
  COUNT(qbo_id) as qbo_linked
FROM invoices
UNION ALL
SELECT 'customers', COUNT(*), COUNT(qbo_id) FROM customers
UNION ALL  
SELECT 'qbo_sync_log', COUNT(*), 0 FROM qbo_sync_log;
