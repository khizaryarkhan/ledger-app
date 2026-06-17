/**
 * One-shot migration: applies 0006_approver_portal schema changes.
 * Adds approver_email + last_approval_sent_at to ap_bills,
 * creates ap_approval_tokens and ap_bill_comments tables.
 * Safe to run multiple times (all statements use IF NOT EXISTS).
 *
 * POST /api/migrate/apply-0006
 * Authorization: Bearer <CRON_SECRET>
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1. New columns on ap_bills
    await db.execute(sql`
      ALTER TABLE ap_bills
        ADD COLUMN IF NOT EXISTS approver_email       VARCHAR(256),
        ADD COLUMN IF NOT EXISTS last_approval_sent_at TIMESTAMPTZ
    `);

    // 2. ap_approval_tokens
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ap_approval_tokens (
        id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id          UUID        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
        bill_id         UUID        NOT NULL REFERENCES ap_bills(id) ON DELETE CASCADE,
        token           TEXT        NOT NULL UNIQUE,
        approver_email  TEXT        NOT NULL,
        approver_name   TEXT,
        sent_by_user_id UUID        REFERENCES users(id) ON DELETE SET NULL,
        status          VARCHAR(32) NOT NULL DEFAULT 'Pending',
        decision        TEXT,
        submitted_at    TIMESTAMPTZ,
        expires_at      TIMESTAMPTZ NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_ap_approval_tokens_bill ON ap_approval_tokens(bill_id)
    `);

    // 3. ap_bill_comments
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ap_bill_comments (
        id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id       UUID        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
        bill_id      UUID        NOT NULL REFERENCES ap_bills(id) ON DELETE CASCADE,
        body         TEXT        NOT NULL,
        author_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
        author_name  TEXT        NOT NULL,
        channel      VARCHAR(32) NOT NULL DEFAULT 'internal',
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_ap_bill_comments_bill ON ap_bill_comments(bill_id)
    `);

    return NextResponse.json({ ok: true, message: "Migration 0006 applied successfully." });
  } catch (e: any) {
    console.error("Migration 0006 failed:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
