-- AI connection switches (2026-11-04): an org admin can stop every AI connection
-- from changing or deleting anything, instantly and without a redeploy.
--
-- Additive only. Both default TRUE, so nothing changes for anyone until an admin
-- turns one off; each connection's own grants still apply on top.
--
-- One command per chunk (neon-http sends each as a prepared statement).

ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "ai_writes_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "ai_deletes_enabled" boolean DEFAULT true NOT NULL;
