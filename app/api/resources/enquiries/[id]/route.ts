/**
 * PATCH /api/resources/enquiries/[id] { response? , close? }
 *   -> answer an enquiry, close it, or both.
 *
 * Only the person it was assigned to, or an org admin, may act. The check is
 * done against the loaded row rather than trusting the client, and the UPDATE
 * carries the org id so a guessed id from another tenant changes nothing.
 *
 * Answering and closing are separate on purpose: an answer is the explanation,
 * closing is someone accepting it. Letting one imply the other would lose the
 * distinction between "explained" and "accepted".
 */

import { db } from "@/db";
import { hoursVarianceEnquiries } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { resolveActor } from "@/lib/resources/access-server";
import { and, eq } from "drizzle-orm";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const body = await req.json().catch(() => ({}));
  const responseRaw = (body as any)?.response;
  const close = (body as any)?.close === true;
  if (responseRaw !== undefined && typeof responseRaw !== "string") return bad("response must be text");
  if (responseRaw === undefined && !close) return bad("Nothing to do: send a response, close, or both");

  const [row] = await db.select().from(hoursVarianceEnquiries)
    .where(and(eq(hoursVarianceEnquiries.id, params.id), eq(hoursVarianceEnquiries.orgId, orgId!))).limit(1);
  if (!row) return bad("Enquiry not found", 404);

  const userId = (session as any)?.user?.id ?? null;
  const { actor } = await resolveActor(orgId!, userId, role);
  const mayAct = actor.isOrgAdmin || (!!actor.resourceId && row.assignedTo === actor.resourceId);
  if (!mayAct) return bad("This enquiry is not yours to answer", 403);

  const patch: Record<string, unknown> = {};
  if (responseRaw !== undefined) {
    const text = String(responseRaw).trim();
    if (!text) return bad("A response cannot be empty");
    patch.response = text.slice(0, 2000);
    patch.respondedBy = userId;
    patch.respondedAt = new Date();
    patch.status = "answered";
  }
  if (close) {
    patch.status = "closed";
    patch.closedBy = userId;
    patch.closedAt = new Date();
  }

  const [updated] = await db.update(hoursVarianceEnquiries).set(patch)
    .where(and(eq(hoursVarianceEnquiries.id, params.id), eq(hoursVarianceEnquiries.orgId, orgId!)))
    .returning();
  return ok(updated);
}
