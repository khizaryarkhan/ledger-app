import { requireAuth, isSuperAdmin, ok, bad } from "@/lib/api";
import { db } from "@/db";
import { leadSequenceSteps } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; stepId: string } },
) {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  await db.delete(leadSequenceSteps).where(
    and(eq(leadSequenceSteps.id, params.stepId), eq(leadSequenceSteps.sequenceId, params.id)),
  );
  return ok({ deleted: true });
}
