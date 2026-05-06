-- ============================================================
-- LEDGER APP — FRESH DATABASE
-- Drops everything and recreates from scratch.
-- Run in Neon SQL Editor.
-- ============================================================

-- Drop all tables in reverse dependency order
DROP TABLE IF EXISTS org_smtp_settings      CASCADE;
DROP TABLE IF EXISTS gmail_tokens           CASCADE;
DROP TABLE IF EXISTS qbo_sync_log           CASCADE;
DROP TABLE IF EXISTS qbo_tokens             CASCADE;
DROP TABLE IF EXISTS reminder_schedules     CASCADE;
DROP TABLE IF EXISTS email_templates        CASCADE;
DROP TABLE IF EXISTS tasks                  CASCADE;
DROP TABLE IF EXISTS communications         CASCADE;
DROP TABLE IF EXISTS invoices               CASCADE;
DROP TABLE IF EXISTS projects               CASCADE;
DROP TABLE IF EXISTS contacts               CASCADE;
DROP TABLE IF EXISTS customers              CASCADE;
DROP TABLE IF EXISTS sessions               CASCADE;
DROP TABLE IF EXISTS users                  CASCADE;
DROP TABLE IF EXISTS organisations          CASCADE;

-- ============================================================
-- ORGANISATIONS
-- ============================================================
CREATE TABLE organisations (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  slug        VARCHAR(64)  NOT NULL UNIQUE,
  status      VARCHAR(32)  NOT NULL DEFAULT 'Active',
  created_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT         NOT NULL,
  name          VARCHAR(255) NOT NULL,
  role          VARCHAR(32)  NOT NULL DEFAULT 'company_user',
  org_id        UUID REFERENCES organisations(id) ON DELETE CASCADE,
  status        VARCHAR(32)  NOT NULL DEFAULT 'Active',
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SESSIONS
-- ============================================================
CREATE TABLE sessions (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT      NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CUSTOMERS
-- ============================================================
CREATE TABLE customers (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id              UUID         NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name                VARCHAR(255) NOT NULL,
  code                VARCHAR(64)  NOT NULL UNIQUE,
  country             VARCHAR(64),
  currency            VARCHAR(8)   NOT NULL DEFAULT 'EUR',
  payment_terms       INTEGER      NOT NULL DEFAULT 30,
  tax_number          VARCHAR(64),
  risk_rating         VARCHAR(16)  NOT NULL DEFAULT 'Low',
  status              VARCHAR(32)  NOT NULL DEFAULT 'Active',
  credit_limit        REAL,
  account_owner_id    UUID REFERENCES users(id),
  collection_owner_id UUID REFERENCES users(id),
  notes               TEXT,
  created_at          TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CONTACTS
-- ============================================================
CREATE TABLE contacts (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id         UUID         NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  customer_id    UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name           VARCHAR(255) NOT NULL,
  title          VARCHAR(255),
  email          VARCHAR(255) NOT NULL,
  phone          VARCHAR(64),
  type           VARCHAR(32)  NOT NULL DEFAULT 'Billing',
  is_primary     BOOLEAN      NOT NULL DEFAULT FALSE,
  is_escalation  BOOLEAN      NOT NULL DEFAULT FALSE,
  receives_auto  BOOLEAN      NOT NULL DEFAULT TRUE,
  status         VARCHAR(32)  NOT NULL DEFAULT 'Active',
  created_at     TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PROJECTS
-- ============================================================
CREATE TABLE projects (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id      UUID         NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  customer_id UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  code        VARCHAR(64)  NOT NULL,
  owner_id    UUID REFERENCES users(id),
  status      VARCHAR(32)  NOT NULL DEFAULT 'Active',
  created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INVOICES
-- ============================================================
CREATE TABLE invoices (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id               UUID         NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  invoice_number       VARCHAR(64)  NOT NULL UNIQUE,
  customer_id          UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  project_id           UUID REFERENCES projects(id) ON DELETE SET NULL,
  invoice_date         VARCHAR(16)  NOT NULL,
  due_date             VARCHAR(16)  NOT NULL,
  currency             VARCHAR(8)   NOT NULL DEFAULT 'EUR',
  amount               REAL         NOT NULL,
  tax_amount           REAL         NOT NULL DEFAULT 0,
  total                REAL         NOT NULL,
  paid                 REAL         NOT NULL DEFAULT 0,
  payment_terms        INTEGER      NOT NULL DEFAULT 30,
  payment_status       VARCHAR(32)  NOT NULL DEFAULT 'Unpaid',
  collection_stage     VARCHAR(64)  NOT NULL DEFAULT 'New',
  collection_owner_id  UUID REFERENCES users(id),
  po_number            VARCHAR(64),
  notes                TEXT,
  dispute_reason       TEXT,
  dispute_date         VARCHAR(16),
  promise_date         VARCHAR(16),
  last_followup_date   VARCHAR(16),
  -- QBO reconciliation fields
  qbo_id               VARCHAR(64),
  qbo_balance          REAL,
  qbo_customer_id      VARCHAR(64),
  qbo_synced_at        TIMESTAMP,
  txn_type             VARCHAR(32) DEFAULT 'Invoice',
  created_at           TIMESTAMP   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP   NOT NULL DEFAULT NOW()
);

-- ============================================================
-- COMMUNICATIONS
-- ============================================================
CREATE TABLE communications (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id      UUID         NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  customer_id UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  invoice_id  UUID REFERENCES invoices(id) ON DELETE CASCADE,
  contact_id  UUID REFERENCES contacts(id) ON DELETE SET NULL,
  direction   VARCHAR(16)  NOT NULL,
  channel     VARCHAR(16)  NOT NULL,
  subject     VARCHAR(512),
  sender      VARCHAR(255),
  recipients  TEXT,
  body        TEXT,
  sent_at     TIMESTAMP    NOT NULL DEFAULT NOW(),
  matched_by  VARCHAR(64),
  is_draft    BOOLEAN      NOT NULL DEFAULT FALSE,
  author_id   UUID REFERENCES users(id)
);

-- ============================================================
-- TASKS
-- ============================================================
CREATE TABLE tasks (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id      UUID         NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  invoice_id  UUID REFERENCES invoices(id) ON DELETE CASCADE,
  title       VARCHAR(512) NOT NULL,
  description TEXT,
  assignee_id UUID REFERENCES users(id),
  due_date    VARCHAR(16),
  priority    VARCHAR(16)  NOT NULL DEFAULT 'Medium',
  completed   BOOLEAN      NOT NULL DEFAULT FALSE,
  labels      JSONB        NOT NULL DEFAULT '[]',
  created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ============================================================
-- EMAIL TEMPLATES
-- ============================================================
CREATE TABLE email_templates (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  subject    VARCHAR(512) NOT NULL,
  body       TEXT         NOT NULL,
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ============================================================
-- REMINDER SCHEDULES
-- ============================================================
CREATE TABLE reminder_schedules (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id     UUID        NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  scheduled_for  VARCHAR(16) NOT NULL,
  template_id    UUID REFERENCES email_templates(id),
  status         VARCHAR(32) NOT NULL DEFAULT 'Pending',
  sent_at        TIMESTAMP,
  created_at     TIMESTAMP   NOT NULL DEFAULT NOW()
);

-- ============================================================
-- QBO TOKENS (one per org)
-- ============================================================
CREATE TABLE qbo_tokens (
  id                        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id                    UUID NOT NULL UNIQUE REFERENCES organisations(id) ON DELETE CASCADE,
  user_id                   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connected_by_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  realm_id                  VARCHAR(64)  NOT NULL,
  access_token              TEXT         NOT NULL,
  refresh_token             TEXT         NOT NULL,
  access_token_expires_at   TIMESTAMP    NOT NULL,
  refresh_token_expires_at  TIMESTAMP    NOT NULL,
  company_name              VARCHAR(255),
  created_at                TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ============================================================
-- QBO SYNC LOG
-- ============================================================
CREATE TABLE qbo_sync_log (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id            UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  synced_at         TIMESTAMP   NOT NULL DEFAULT NOW(),
  status            VARCHAR(16) NOT NULL DEFAULT 'success',
  qbo_total_ar      REAL,
  ledger_total_ar   REAL,
  difference        REAL,
  customers_created INTEGER DEFAULT 0,
  invoices_created  INTEGER DEFAULT 0,
  invoices_updated  INTEGER DEFAULT 0,
  invoices_closed   INTEGER DEFAULT 0,
  credits_created   INTEGER DEFAULT 0,
  error_message     TEXT,
  duration_ms       INTEGER
);

-- ============================================================
-- GMAIL TOKENS
-- ============================================================
CREATE TABLE gmail_tokens (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                 UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email                   VARCHAR(255) NOT NULL,
  access_token            TEXT         NOT NULL,
  refresh_token           TEXT         NOT NULL,
  access_token_expires_at TIMESTAMP    NOT NULL,
  created_at              TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ORG SMTP SETTINGS
-- ============================================================
CREATE TABLE org_smtp_settings (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id     UUID         NOT NULL UNIQUE REFERENCES organisations(id) ON DELETE CASCADE,
  host       VARCHAR(255) NOT NULL,
  port       INTEGER      NOT NULL DEFAULT 2525,
  "user"     VARCHAR(255) NOT NULL,
  pass       TEXT         NOT NULL,
  from_email VARCHAR(255) NOT NULL,
  from_name  VARCHAR(255),
  created_at TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX users_org_id_idx          ON users(org_id);
CREATE INDEX customers_org_id_idx      ON customers(org_id);
CREATE INDEX contacts_org_id_idx       ON contacts(org_id);
CREATE INDEX contacts_customer_id_idx  ON contacts(customer_id);
CREATE INDEX projects_org_id_idx       ON projects(org_id);
CREATE INDEX projects_customer_id_idx  ON projects(customer_id);
CREATE INDEX invoices_org_id_idx       ON invoices(org_id);
CREATE INDEX invoices_customer_id_idx  ON invoices(customer_id);
CREATE INDEX invoices_project_id_idx   ON invoices(project_id);
CREATE INDEX invoices_qbo_id_idx       ON invoices(qbo_id);
CREATE INDEX communications_org_id_idx ON communications(org_id);
CREATE INDEX tasks_org_id_idx          ON tasks(org_id);
CREATE INDEX qbo_sync_log_org_id_idx   ON qbo_sync_log(org_id);

-- ============================================================
-- VERIFY
-- ============================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
