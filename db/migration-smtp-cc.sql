-- Default CC address on every outgoing email
ALTER TABLE org_smtp_settings ADD COLUMN IF NOT EXISTS cc_email  VARCHAR(255);
ALTER TABLE org_smtp_settings ADD COLUMN IF NOT EXISTS cc_enabled BOOLEAN NOT NULL DEFAULT false;
