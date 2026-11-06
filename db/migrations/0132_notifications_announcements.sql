-- Notifications and announcements (2026-11-06). Additive only.
--
--   notifications        one row per person per event (time returned to you, a reply to a
--                        return you opened, an enquiry assigned to you). Idempotent: the
--                        partial unique index on (user_id, kind, source_id) means a retried
--                        producer never notifies twice.
--   announcements        company news an org admin posts to everyone in the organisation.
--   announcement_reads   who has read which announcement (one row each).
--
-- "Needs your attention" counts (approvals waiting, open returns, open enquiries) are NOT
-- stored: they are worked out live, so they can never go stale.
--
-- One command per chunk (neon-http sends each as a prepared statement).

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" varchar(32) NOT NULL,
  "title" varchar(200) NOT NULL,
  "body" text,
  "href" varchar(300),
  "source_type" varchar(32),
  "source_id" uuid,
  "read_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_idx" ON "notifications" ("org_id", "user_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_once_unique" ON "notifications" ("user_id", "kind", "source_id") WHERE "source_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "announcements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "title" varchar(200) NOT NULL,
  "body" text NOT NULL,
  "pinned" boolean NOT NULL DEFAULT false,
  "published_at" timestamp NOT NULL DEFAULT now(),
  "expires_at" timestamp,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "announcements_org_idx" ON "announcements" ("org_id", "published_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "announcement_reads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "announcement_id" uuid NOT NULL REFERENCES "announcements"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "read_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "announcement_reads_unique" ON "announcement_reads" ("announcement_id", "user_id");
