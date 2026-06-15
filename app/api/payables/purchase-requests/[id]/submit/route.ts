import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { purchaseRequests, apApprovals } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { logEvent } from "@/lib/audit";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  const [pr] = await db.select().from(purchaseRequests)
    .where(and(eq(purchaseRequests.id, params.id), eq(purchaseRequests.orgId, orgId!)))
    .limit(1);
  if (!pr) return bad("Purchase request not found", 404);

  if (pr.status !== "Draft" && pr.status !== "Pending Review") {
    return bad("Only Draft or Pending Review purchase requests can be submitted", 400);
  }

  const [updated] = await db.update(purchaseRequests)
    .set({ status: "Pending Approval", updatedAt: new Date() })
    .where(and(eq(purchaseRequests.id, params.id), eq(purchaseRequests.orgId, orgId!)))
    .returning();

  await db.insert(apApprovals).values({
    orgId:      orgId!,
    entityType: "purchase_request",
    entityId:   params.id,
    stepNumber: 1,
    status:     "Pending",
  });

  const actorId   = (session?.user as any)?.id   ?? null;
  const actorName = (session?.user as any)?.name ?? null;

  await logEvent({
    orgId: orgId!,
    eventType: "purchase_request_submitted" as any,
    actorId,
    actorName,
    meta: { requestNumber: pr.requestNumber, title: pr.title },
  });

  return ok(updated);
}
