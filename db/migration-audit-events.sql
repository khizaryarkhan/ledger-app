-- Track & Trace: append-only audit event log
CREATE TABLE IF NOT EXISTS audit_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  customer_id UUID        REFERENCES customers(id) ON DELETE CASCADE,
  project_id  UUID        REFERENCES projects(id) ON DELETE SET NULL,
  invoice_id  UUID        REFERENCES invoices(id) ON DELETE SET NULL,
  event_type  VARCHAR(32) NOT NULL,
  actor_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
  actor_name  VARCHAR(255),
  meta        JSONB       NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMP   NOT NULL DEFAULT NOW()
);

-- Fast lookups by customer, project, or invoice
CREATE INDEX IF NOT EXISTS audit_events_customer_idx ON audit_events(customer_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_project_idx  ON audit_events(project_id,  occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_invoice_idx  ON audit_events(invoice_id,  occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_org_idx      ON audit_events(org_id,      occurred_at DESC);
