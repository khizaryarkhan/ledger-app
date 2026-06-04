import { db } from "@/db";
import { organisations } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { eq, sql } from "drizzle-orm";

export async function POST() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  // Atomically increment and return the new sequence number
  const [updated] = await db
    .update(organisations)
    .set({ colRefSeq: sql`col_ref_seq + 1`, updatedAt: new Date() })
    .where(eq(organisations.id, orgId!))
    .returning({ colRefSeq: organisations.colRefSeq });

  const year = new Date().getFullYear();
  const seq = String(updated?.colRefSeq ?? 1).padStart(5, "0");
  // Neutral, sequential collection reference (never org-specific).
  const refNumber = `AR-${year}-${seq}`;

  return ok({ refNumber, seq: updated?.colRefSeq ?? 1 });
}
