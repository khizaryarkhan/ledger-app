import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { paymentRuns } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { logEvent } from "@/lib/audit";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  if (role !== "company_admin" && !isSuperAdmin(session)) {
    return bad("Forbidden", 403);
  }

  const [run] = await db.select().from(paymentRuns)
    .where(and(eq(paymentRuns.id, params.id), eq(paymentRuns.orgId, orgId!)))
    .limit(1);
  if (!run) return bad("Payment run not found", 404);

  const actorId   = (session?.user as any)?.id   ?? null;
  const actorName = (session?.user as any)?.name ?? null;

  const [updated] = await db.update(paymentRuns)
    .set({
      status:           "Approved",
      approvedByUserId: actorId,
      approvedAt:       new Date(),
      updatedAt:        new Date(),
    })
    .where(and(eq(paymentRuns.id, params.id), eq(paymentRuns.orgId, orgId!)))
    .returning();

  await logEvent({
    orgId: orgId!,
    eventType: "payment_run_approved" as any,
    actorId,
    actorName,
    meta: { runNumber: run.runNumber, totalAmount: run.totalAmount },
  });

  return ok(updated);
}
