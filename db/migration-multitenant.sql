-- ============================================================
-- LEDGER MULTI-TENANT MIGRATION
-- Run in Neon SQL Editor BEFORE deploying the new code
-- ============================================================

-- 1. Create organisations table
CREATE TABLE IF NOT EXISTS organisations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(64) NOT NULL UNIQUE,
  status VARCHAR(32) NOT NULL DEFAULT 'Active',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 2. Add org_id to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organisations(id) ON DELETE CASCADE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'Active';

-- Update role column to support new roles
-- super_admin | company_admin | company_user
-- (existing Admin -> company_admin, FinanceUser -> company_user)
UPDATE users SET role = 'company_admin' WHERE role = 'Admin';
UPDATE users SET role = 'company_user' WHERE role IN ('FinanceUser', 'User');

-- 3. Add org_id to all data tables
ALTER TABLE customers    ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organisations(id) ON DELETE CASCADE;
ALTER TABLE projects     ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organisations(id) ON DELETE CASCADE;
ALTER TABLE invoices     ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organisations(id) ON DELETE CASCADE;
ALTER TABLE contacts     ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organisations(id) ON DELETE CASCADE;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organisations(id) ON DELETE CASCADE;
ALTER TABLE tasks        ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organisations(id) ON DELETE CASCADE;
ALTER TABLE qbo_tokens   ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organisations(id) ON DELETE CASCADE;
ALTER TABLE qbo_sync_log ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organisations(id) ON DELETE CASCADE;

-- 4. Create the default organisation for existing EDC data
INSERT INTO organisations (id, name, slug, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'EDC - Engineering Design Consultants Limited', 'edc', 'Active')
ON CONFLICT (slug) DO NOTHING;

-- 5. Assign all existing users to EDC org
UPDATE users SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;

-- 6. Assign all existing data to EDC org
UPDATE customers     SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE projects      SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE invoices      SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE contacts      SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE communications SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE tasks         SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE qbo_tokens    SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE qbo_sync_log  SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;

-- 7. Add your super admin account
-- Replace the email below with your actual email
UPDATE users SET role = 'super_admin', org_id = '00000000-0000-0000-0000-000000000001'
WHERE email = 'wajahat.khan86@yahoo.com';

-- 8. Add indexes for performance
CREATE INDEX IF NOT EXISTS customers_org_id_idx      ON customers(org_id);
CREATE INDEX IF NOT EXISTS projects_org_id_idx       ON projects(org_id);
CREATE INDEX IF NOT EXISTS invoices_org_id_idx       ON invoices(org_id);
CREATE INDEX IF NOT EXISTS contacts_org_id_idx       ON contacts(org_id);
CREATE INDEX IF NOT EXISTS communications_org_id_idx ON communications(org_id);
CREATE INDEX IF NOT EXISTS tasks_org_id_idx          ON tasks(org_id);
CREATE INDEX IF NOT EXISTS users_org_id_idx          ON users(org_id);

-- Verify
SELECT 'organisations' as tbl, COUNT(*) FROM organisations
UNION ALL SELECT 'users with org', COUNT(*) FROM users WHERE org_id IS NOT NULL
UNION ALL SELECT 'customers with org', COUNT(*) FROM customers WHERE org_id IS NOT NULL
UNION ALL SELECT 'invoices with org', COUNT(*) FROM invoices WHERE org_id IS NOT NULL;
