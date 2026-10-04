/** POST /api/resources/time-entries/:id/reject — Submitted -> Rejected, { reason } required */

import { db } from "@/db";
import { timeEntries } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq } from "drizzle-orm";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const [existing] = await db.select({ id: timeEntries.id, status: timeEntries.status }).from(timeEntries)
    .where(and(eq(timeEntries.id, params.id), eq(timeEntries.orgId, orgId!))).limit(1);
  if (!existing) return bad("Time entry not found", 404);
  if (existing.status !== "submitted") return bad("Only a Submitted entry can be rejected", 409);

  const body = await req.json().catch(() => ({}));
  const reason = String(body?.reason ?? "").trim();
  if (!reason) return bad("A reason is required");

  const [row] = await db.update(timeEntries).set({ status: "rejected", rejectedReason: reason, updatedAt: new Date() })
    .where(and(eq(timeEntries.id, params.id), eq(timeEntries.orgId, orgId!))).returning();
  return ok(row);
}
