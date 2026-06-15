import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { purchaseRequests, apApprovals } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { logEvent } from "@/lib/audit";

const Schema = z.object({
  comments: z.string().optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  if (role !== "company_admin" && !isSuperAdmin(session)) {
    return bad("Forbidden", 403);
  }

  const [pr] = await db.select().from(purchaseRequests)
    .where(and(eq(purchaseRequests.id, params.id), eq(purchaseRequests.orgId, orgId!)))
    .limit(1);
  if (!pr) return bad("Purchase request not found", 404);

  try {
    const { comments } = Schema.parse(await req.json().catch(() => ({})));
    const actorId   = (session?.user as any)?.id   ?? null;
    const actorName = (session?.user as any)?.name ?? null;

    const [updated] = await db.update(purchaseRequests)
      .set({ status: "Approved", updatedAt: new Date() })
      .where(and(eq(purchaseRequests.id, params.id), eq(purchaseRequests.orgId, orgId!)))
      .returning();

    await db.update(apApprovals)
      .set({
        status:     "Approved",
        decision:   "Approved",
        comments:   comments ?? null,
        approvedAt: new Date(),
        updatedAt:  new Date(),
      })
      .where(and(
        eq(apApprovals.entityId, params.id),
        eq(apApprovals.entityType, "purchase_request"),
        eq(apApprovals.orgId, orgId!),
        eq(apApprovals.status, "Pending"),
      ));

    await logEvent({
      orgId: orgId!,
      eventType: "purchase_request_approved" as any,
      actorId,
      actorName,
      meta: { requestNumber: pr.requestNumber, title: pr.title, comments },
    });

    return ok(updated);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to approve purchase request", 500);
  }
}
