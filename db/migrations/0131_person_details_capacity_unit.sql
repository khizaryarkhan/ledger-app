-- Person details + capacity unit (2026-11-06). Additive only.
--
--   organisations.capacity_unit   how capacity is ENTERED and SHOWN: day | week | month.
--                                 Storage is unchanged (resources.daily_capacity = hours/day),
--                                 so no engine reads this and no figure moves.
--   person_details                one row per person: personal, employment, emergency contact
--                                 and bank details. `details` holds plain values; `secrets`
--                                 holds ENCRYPTED national id / tax number / bank account /
--                                 sort code (lib/crypto). Rules: lib/resources/personal-details.ts.
--
-- One command per chunk (neon-http sends each as a prepared statement).

ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "capacity_unit" varchar(8) NOT NULL DEFAULT 'day';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "person_details" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "resource_id" uuid NOT NULL REFERENCES "resources"("id") ON DELETE CASCADE,
  "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "secrets" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "person_details_resource_unique" ON "person_details" ("resource_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_details_org_idx" ON "person_details" ("org_id");
