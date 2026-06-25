import { ok, bad } from "@/lib/api";
import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { leadSequenceSteps } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; stepId: string } },
) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  await db.delete(leadSequenceSteps).where(
    and(eq(leadSequenceSteps.id, params.stepId), eq(leadSequenceSteps.sequenceId, params.id)),
  );
  return ok({ deleted: true });
}

// Edit a step's subject / body / delay.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; stepId: string } },
) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const { subject, body, delayDays } = await req.json().catch(() => ({}));
  const patch: Record<string, any> = {};
  if (typeof subject === "string") patch.subject = subject.trim();
  if (typeof body === "string") patch.body = body;
  if (delayDays != null && !isNaN(Number(delayDays))) patch.delayDays = Math.max(0, parseInt(String(delayDays)));
  if (Object.keys(patch).length === 0) return bad("Nothing to update");

  await db.update(leadSequenceSteps)
    .set(patch)
    .where(and(eq(leadSequenceSteps.id, params.stepId), eq(leadSequenceSteps.sequenceId, params.id)));
  return ok({ updated: true });
}
