/**
 * One-shot migration: adds message_id and in_reply_to columns to the
 * communications table. Required for email thread continuity.
 *
 * GET /api/migrate/add-comms-message-id  (browser-accessible while logged in)
 * POST /api/migrate/add-comms-message-id  (Authorization: Bearer <CRON_SECRET>)
 *
 * Safe to run multiple times — uses ADD COLUMN IF NOT EXISTS.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { requireOrg } from "@/lib/api";

async function runMigration() {
  const sql = neon(process.env.DATABASE_URL!);
  await sql`ALTER TABLE "communications" ADD COLUMN IF NOT EXISTS "message_id" text`;
  await sql`ALTER TABLE "communications" ADD COLUMN IF NOT EXISTS "in_reply_to" text`;
}

export async function GET() {
  const { error } = await requireOrg();
  if (error) return error;
  await runMigration();
  return NextResponse.json({ ok: true, message: "communications.message_id and in_reply_to columns added (or already existed)" });
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await runMigration();
  return NextResponse.json({ ok: true, message: "communications.message_id and in_reply_to columns added (or already existed)" });
}
