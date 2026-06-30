/**
 * One-shot migration: adds updated_at column to the contacts table.
 * The initial migration omitted it; qbo-sync writes updatedAt on contact
 * email updates, causing every incremental sync to crash.
 *
 * POST /api/migrate/add-contacts-updated-at
 * Authorization: Bearer <CRON_SECRET>
 *
 * Safe to run multiple times — uses ADD COLUMN IF NOT EXISTS.
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { requireOrg } from "@/lib/api";

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sql = neon(process.env.DATABASE_URL!);
  await sql`ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now()`;
  return NextResponse.json({ ok: true, message: "contacts.updated_at column added (or already existed)" });
}

// GET — callable from a browser while logged in as an org admin.
// Safe to run multiple times (IF NOT EXISTS).
export async function GET() {
  const { error } = await requireOrg();
  if (error) return error;

  const sql = neon(process.env.DATABASE_URL!);
  await sql`ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now()`;
  return NextResponse.json({ ok: true, message: "contacts.updated_at column added (or already existed)" });
}
