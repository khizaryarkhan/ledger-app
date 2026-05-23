/**
 * One-shot migration: add txn_source column to deposits table and
 * back-fill existing Purchase rows using the description heuristic.
 *
 * POST /api/admin/migrate-deposits-txn-source
 *
 * SAFE TO CALL MULTIPLE TIMES — uses IF NOT EXISTS / DO UPDATE logic.
 * Delete this file after the migration has been confirmed.
 */

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";

export async function POST(_req: Request) {
  // Require a valid org session so this endpoint isn't publicly callable.
  const { error } = await requireOrg();
  if (error) return error;

  try {
    // 1. Add the column if it doesn't exist yet (idempotent).
    await db.execute(sql`
      ALTER TABLE deposits
      ADD COLUMN IF NOT EXISTS txn_source VARCHAR(32) NOT NULL DEFAULT 'Deposit'
    `);

    // 2. Back-fill rows that were inserted by the Purchase sync before this
    //    column existed. They all have descriptions matching "Purchase AR line".
    const updated = await db.execute(sql`
      UPDATE deposits
      SET txn_source = 'Purchase'
      WHERE txn_source = 'Deposit'
        AND description ILIKE 'Purchase AR line%'
    `);

    return ok({
      message: "Migration complete",
      rowsUpdated: (updated as any).rowCount ?? "unknown",
    });
  } catch (e: any) {
    console.error("Migration error:", e);
    return bad(e.message || "Migration failed", 500);
  }
}
