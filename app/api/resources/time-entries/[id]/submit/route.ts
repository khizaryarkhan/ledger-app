/** POST /api/resources/time-entries/:id/submit — Draft -> Submitted */

import { db } from "@/db";
import { timeEntries } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq } from "drizzle-orm";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const [existing] = await db.select({ id: timeEntries.id, status: timeEntries.status }).from(timeEntries)
    .where(and(eq(timeEntries.id, params.id), eq(timeEntries.orgId, orgId!))).limit(1);
  if (!existing) return bad("Time entry not found", 404);
  if (existing.status !== "draft") return bad("Only a Draft entry can be submitted", 409);

  const [row] = await db.update(timeEntries).set({ status: "submitted", updatedAt: new Date() })
    .where(and(eq(timeEntries.id, params.id), eq(timeEntries.orgId, orgId!))).returning();
  return ok(row);
}
