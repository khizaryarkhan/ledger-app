-- ============================================================================
-- 0005_payables_module.sql
-- Procurement & Payables module — all new AP tables
-- ============================================================================

-- AP Suppliers
CREATE TABLE IF NOT EXISTS ap_suppliers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  display_name    VARCHAR(255),
  code            VARCHAR(64),
  email           VARCHAR(255),
  phone           VARCHAR(64),
  address         TEXT,
  country         VARCHAR(64),
  currency        VARCHAR(8) NOT NULL DEFAULT 'EUR',
  payment_terms   INTEGER NOT NULL DEFAULT 30,
  tax_number      VARCHAR(64),
  status          VARCHAR(32) NOT NULL DEFAULT 'Active',
  risk_rating     VARCHAR(16) NOT NULL DEFAULT 'Low',
  notes           TEXT,
  qbo_id          VARCHAR(64),
  xero_id         VARCHAR(64),
  source          VARCHAR(16),
  last_synced_at  TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ap_suppliers_org_id ON ap_suppliers(org_id);

-- AP Supplier Contacts
CREATE TABLE IF NOT EXISTS ap_supplier_contacts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  supplier_id  UUID NOT NULL REFERENCES ap_suppliers(id) ON DELETE CASCADE,
  name         VARCHAR(255) NOT NULL,
  title        VARCHAR(255),
  email        VARCHAR(255),
  phone        VARCHAR(64),
  type         VARCHAR(32) NOT NULL DEFAULT 'Primary',
  is_primary   BOOLEAN NOT NULL DEFAULT FALSE,
  status       VARCHAR(32) NOT NULL DEFAULT 'Active',
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

-- AP Chart of Accounts (synced)
CREATE TABLE IF NOT EXISTS ap_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  external_id   VARCHAR(64) NOT NULL,
  source        VARCHAR(16) NOT NULL,
  code          VARCHAR(64),
  name          VARCHAR(255) NOT NULL,
  type          VARCHAR(64),
  subtype       VARCHAR(64),
  status        VARCHAR(32) NOT NULL DEFAULT 'Active',
  raw           JSONB,
  last_synced_at TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT ap_accounts_org_ext_unique UNIQUE (org_id, external_id, source)
);

-- AP Items / Products / Services (synced)
CREATE TABLE IF NOT EXISTS ap_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  external_id         VARCHAR(64) NOT NULL,
  source              VARCHAR(16) NOT NULL,
  code                VARCHAR(64),
  name                VARCHAR(255) NOT NULL,
  description         TEXT,
  purchase_account_id VARCHAR(64),
  expense_account_id  VARCHAR(64),
  unit_cost           REAL,
  tax_rate_id         VARCHAR(64),
  status              VARCHAR(32) NOT NULL DEFAULT 'Active',
  raw                 JSONB,
  last_synced_at      TIMESTAMP,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT ap_items_org_ext_unique UNIQUE (org_id, external_id, source)
);

-- AP Tax Rates (synced)
CREATE TABLE IF NOT EXISTS ap_tax_rates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  external_id   VARCHAR(64) NOT NULL,
  source        VARCHAR(16) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  rate          REAL,
  tax_type      VARCHAR(64),
  status        VARCHAR(32) NOT NULL DEFAULT 'Active',
  raw           JSONB,
  last_synced_at TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT ap_tax_rates_org_ext_unique UNIQUE (org_id, external_id, source)
);

-- AP Dimensions (projects, classes, depts, tracking categories, cost centres…)
CREATE TABLE IF NOT EXISTS ap_dimensions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  external_id     VARCHAR(64) NOT NULL,
  source          VARCHAR(16) NOT NULL,
  dimension_type  VARCHAR(64) NOT NULL,
  name            VARCHAR(255) NOT NULL,
  code            VARCHAR(64),
  parent_id       VARCHAR(64),
  status          VARCHAR(32) NOT NULL DEFAULT 'Active',
  raw             JSONB,
  last_synced_at  TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT ap_dimensions_org_ext_type_unique UNIQUE (org_id, external_id, source, dimension_type)
);

-- Purchase Requests
CREATE TABLE IF NOT EXISTS purchase_requests (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  request_number          VARCHAR(64) NOT NULL,
  requester_id            UUID REFERENCES users(id) ON DELETE SET NULL,
  supplier_id             UUID REFERENCES ap_suppliers(id) ON DELETE SET NULL,
  title                   VARCHAR(500) NOT NULL,
  description             TEXT,
  business_justification  TEXT,
  required_by_date        VARCHAR(16),
  currency                VARCHAR(8) NOT NULL DEFAULT 'EUR',
  estimated_total         REAL,
  status                  VARCHAR(32) NOT NULL DEFAULT 'Draft',
  workflow_stage          VARCHAR(64),
  assigned_approver_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  department_id           VARCHAR(64),
  project_id              VARCHAR(64),
  customer_id_ref         VARCHAR(64),
  cost_centre_id          VARCHAR(64),
  notes                   TEXT,
  created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_org_id ON purchase_requests(org_id);

-- Purchase Orders
CREATE TABLE IF NOT EXISTS purchase_orders (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  po_number               VARCHAR(64) NOT NULL,
  request_id              UUID REFERENCES purchase_requests(id) ON DELETE SET NULL,
  supplier_id             UUID REFERENCES ap_suppliers(id) ON DELETE SET NULL,
  po_date                 VARCHAR(16),
  expected_delivery_date  VARCHAR(16),
  currency                VARCHAR(8) NOT NULL DEFAULT 'EUR',
  subtotal                REAL NOT NULL DEFAULT 0,
  tax_total               REAL NOT NULL DEFAULT 0,
  total                   REAL NOT NULL DEFAULT 0,
  status                  VARCHAR(32) NOT NULL DEFAULT 'Draft',
  approval_status         VARCHAR(32) NOT NULL DEFAULT 'Pending',
  workflow_stage          VARCHAR(64),
  assigned_approver_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  notes                   TEXT,
  qbo_id                  VARCHAR(64),
  xero_id                 VARCHAR(64),
  external_doc_number     VARCHAR(64),
  pushed_at               TIMESTAMP,
  push_status             VARCHAR(32),
  last_push_error         TEXT,
  created_by_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by_user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at             TIMESTAMP,
  created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_org_id ON purchase_orders(org_id);

-- Purchase Order Lines
CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  purchase_order_id     UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_number           INTEGER NOT NULL DEFAULT 1,
  item_id               VARCHAR(64),
  description           TEXT,
  quantity              REAL NOT NULL DEFAULT 1,
  unit_price            REAL NOT NULL DEFAULT 0,
  account_id            VARCHAR(64),
  tax_rate_id           VARCHAR(64),
  project_id            VARCHAR(64),
  customer_id_ref       VARCHAR(64),
  cost_centre_id        VARCHAR(64),
  tracking_category_id  VARCHAR(64),
  class_id              VARCHAR(64),
  department_id         VARCHAR(64),
  line_subtotal         REAL NOT NULL DEFAULT 0,
  line_tax              REAL NOT NULL DEFAULT 0,
  line_total            REAL NOT NULL DEFAULT 0,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

-- AP Bills (synced from QBO/Xero)
CREATE TABLE IF NOT EXISTS ap_bills (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                      UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  supplier_id                 UUID REFERENCES ap_suppliers(id) ON DELETE SET NULL,
  bill_number                 VARCHAR(64),
  reference                   VARCHAR(128),
  bill_date                   VARCHAR(16),
  due_date                    VARCHAR(16),
  currency                    VARCHAR(8) NOT NULL DEFAULT 'EUR',
  subtotal                    REAL NOT NULL DEFAULT 0,
  tax_total                   REAL NOT NULL DEFAULT 0,
  total                       REAL NOT NULL DEFAULT 0,
  amount_paid                 REAL NOT NULL DEFAULT 0,
  balance                     REAL NOT NULL DEFAULT 0,
  accounting_payment_status   VARCHAR(32) NOT NULL DEFAULT 'Unpaid',
  workflow_status             VARCHAR(64) NOT NULL DEFAULT 'Synced from Accounting',
  approval_status             VARCHAR(32),
  purchase_order_id           UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  external_purchase_order_ref VARCHAR(128),
  qbo_purchase_order_id       VARCHAR(64),
  xero_purchase_order_id      VARCHAR(64),
  qbo_id                      VARCHAR(64),
  xero_id                     VARCHAR(64),
  source                      VARCHAR(16),
  assigned_approver_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by_user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at                 TIMESTAMP,
  approval_note_pushed_at     TIMESTAMP,
  private_note                TEXT,
  last_sync_at                TIMESTAMP,
  created_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ap_bills_org_id ON ap_bills(org_id);
CREATE UNIQUE INDEX IF NOT EXISTS ap_bills_org_qbo_unique ON ap_bills(org_id, qbo_id) WHERE qbo_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ap_bills_org_xero_unique ON ap_bills(org_id, xero_id) WHERE xero_id IS NOT NULL;

-- AP Bill Lines
CREATE TABLE IF NOT EXISTS ap_bill_lines (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  bill_id               UUID NOT NULL REFERENCES ap_bills(id) ON DELETE CASCADE,
  line_number           INTEGER NOT NULL DEFAULT 1,
  item_id               VARCHAR(64),
  description           TEXT,
  quantity              REAL NOT NULL DEFAULT 1,
  unit_price            REAL NOT NULL DEFAULT 0,
  account_id            VARCHAR(64),
  tax_rate_id           VARCHAR(64),
  project_id            VARCHAR(64),
  customer_id_ref       VARCHAR(64),
  cost_centre_id        VARCHAR(64),
  tracking_category_id  VARCHAR(64),
  class_id              VARCHAR(64),
  department_id         VARCHAR(64),
  line_subtotal         REAL NOT NULL DEFAULT 0,
  line_tax              REAL NOT NULL DEFAULT 0,
  line_total            REAL NOT NULL DEFAULT 0,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

-- AP Approvals
CREATE TABLE IF NOT EXISTS ap_approvals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  entity_type           VARCHAR(32) NOT NULL,
  entity_id             UUID NOT NULL,
  workflow_id           UUID,
  step_number           INTEGER NOT NULL DEFAULT 1,
  approver_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  approver_role         VARCHAR(64),
  status                VARCHAR(32) NOT NULL DEFAULT 'Pending',
  decision              VARCHAR(32),
  comments              TEXT,
  approved_at           TIMESTAMP,
  rejected_at           TIMESTAMP,
  delegated_to_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ap_approvals_org_entity ON ap_approvals(org_id, entity_type, entity_id);

-- AP Workflow Rules
CREATE TABLE IF NOT EXISTS ap_workflow_rules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name             VARCHAR(255) NOT NULL,
  entity_type      VARCHAR(32) NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  conditions_json  JSONB NOT NULL DEFAULT '{}',
  steps_json       JSONB NOT NULL DEFAULT '[]',
  priority         INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

-- AP Supplier Queries
CREATE TABLE IF NOT EXISTS ap_supplier_queries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  supplier_id           UUID REFERENCES ap_suppliers(id) ON DELETE SET NULL,
  bill_id               UUID REFERENCES ap_bills(id) ON DELETE SET NULL,
  purchase_order_id     UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  category              VARCHAR(64) NOT NULL,
  reason                TEXT,
  source                VARCHAR(32),
  assigned_to_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  status                VARCHAR(32) NOT NULL DEFAULT 'Open',
  resolution            TEXT,
  resolved_by_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at           TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ap_supplier_queries_org_id ON ap_supplier_queries(org_id);

-- Payment Runs
CREATE TABLE IF NOT EXISTS payment_runs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  run_number              VARCHAR(64) NOT NULL,
  currency                VARCHAR(8) NOT NULL DEFAULT 'EUR',
  scheduled_payment_date  VARCHAR(16),
  status                  VARCHAR(32) NOT NULL DEFAULT 'Draft',
  total_amount            REAL NOT NULL DEFAULT 0,
  bill_count              INTEGER NOT NULL DEFAULT 0,
  notes                   TEXT,
  created_by_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by_user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at             TIMESTAMP,
  posted_at               TIMESTAMP,
  created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_runs_org_id ON payment_runs(org_id);

-- Payment Run Items
CREATE TABLE IF NOT EXISTS payment_run_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  payment_run_id  UUID NOT NULL REFERENCES payment_runs(id) ON DELETE CASCADE,
  bill_id         UUID NOT NULL REFERENCES ap_bills(id) ON DELETE CASCADE,
  supplier_id     UUID REFERENCES ap_suppliers(id) ON DELETE SET NULL,
  amount          REAL NOT NULL,
  currency        VARCHAR(8) NOT NULL DEFAULT 'EUR',
  due_date        VARCHAR(16),
  status          VARCHAR(32) NOT NULL DEFAULT 'Pending',
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
