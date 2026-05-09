/**
 * One-shot migration: adds the `currency` column to the `organisations` table.
 *
 * POST /api/migrate/add-org-currency
 * Authorization: Bearer <CRON_SECRET>
 *
 * Safe to run multiple times — uses IF NOT EXISTS / DO NOTHING.
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
    // Add currency column with a safe default — no-op if column already exists
    await db.execute(sql`
      ALTER TABLE organisations
        ADD COLUMN IF NOT EXISTS currency VARCHAR(8) NOT NULL DEFAULT 'EUR'
    `);

    return NextResponse.json({ ok: true, message: "organisations.currency column ensured" });
  } catch (e: any) {
    console.error("Migration failed:", e.message);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
