-- Organisation roles + one person record per member (2026-11-05). Additive only.
--
--   org_roles                    custom roles an organisation's admin defines: which
--                                modules (none/view/edit) and whose people (self/team/
--                                department/all). Built-in roles are code, not rows.
--   user_organisations.role_id   the custom role a member holds. NULL = their built-in
--                                role exactly as before, so nobody's access changes here.
--   resources backfill           every member gets a person record, because every login
--                                may now submit a timesheet. Guarded by the existing
--                                partial unique index (org_id, user_id).
--
-- One command per chunk (neon-http sends each as a prepared statement).

CREATE TABLE IF NOT EXISTS "org_roles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "name" varchar(60) NOT NULL,
  "base_role" varchar(32) NOT NULL,
  "modules" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "people_scope" varchar(16) NOT NULL DEFAULT 'self',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_roles_org_name_unique" ON "org_roles" ("org_id", lower("name"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_roles_org_idx" ON "org_roles" ("org_id");
--> statement-breakpoint
ALTER TABLE "user_organisations" ADD COLUMN IF NOT EXISTS "role_id" uuid REFERENCES "org_roles"("id") ON DELETE SET NULL;
--> statement-breakpoint
INSERT INTO "resources" ("org_id", "type", "name", "user_id", "status")
SELECT uo."org_id", 'person', u."name", u."id", CASE WHEN u."status" = 'Active' THEN 'active' ELSE 'inactive' END
FROM "user_organisations" uo
JOIN "users" u ON u."id" = uo."user_id"
WHERE u."role" <> 'super_admin'
  AND NOT EXISTS (
    SELECT 1 FROM "resources" r WHERE r."org_id" = uo."org_id" AND r."user_id" = uo."user_id"
  );
