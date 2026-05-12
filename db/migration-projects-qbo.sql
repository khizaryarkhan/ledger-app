-- Add qbo_id and updated_at to projects table
-- qbo_id: QBO sub-customer Id for project-level sync lookups
-- updated_at: tracks when project records were last modified

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS qbo_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
