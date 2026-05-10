-- Per-org disabled automation rules list
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS disabled_rules jsonb NOT NULL DEFAULT '[]';
