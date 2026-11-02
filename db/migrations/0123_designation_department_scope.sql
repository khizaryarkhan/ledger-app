-- Resources Phase E (2026-11-02): a department scope tier.
--
-- WIDENING only: varchar(8) -> varchar(16). "department" is ten characters,
-- so the original width would have refused the value outright. Every existing
-- row ('self' | 'team' | 'all') is well inside the new width, so the ALTER
-- cannot reject anything and no value changes meaning.
--
-- One command per chunk (neon-http sends each as a prepared statement).

ALTER TABLE "resource_designations" ALTER COLUMN "access_level" TYPE varchar(16);
