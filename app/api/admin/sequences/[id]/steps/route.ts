import { requireAuth, isSuperAdmin, ok, bad } from "@/lib/api";
import { db } from "@/db";
import { leadSequenceSteps } from "@/db/schema";
import { eq, asc, count } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  const steps = await db.select().from(leadSequenceSteps)
    .where(eq(leadSequenceSteps.sequenceId, params.id))
    .orderBy(asc(leadSequenceSteps.stepNumber));

  return ok(steps);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  const { delayDays, subject, body } = await req.json().catch(() => ({}));
  if (!subject?.trim()) return bad("Subject is required");
  if (!body?.trim())    return bad("Body is required");

  // Get next step number
  const [{ value: maxStep }] = await db.select({ value: count() })
    .from(leadSequenceSteps).where(eq(leadSequenceSteps.sequenceId, params.id));

  const [step] = await db.insert(leadSequenceSteps).values({
    sequenceId: params.id,
    stepNumber: (maxStep ?? 0) + 1,
    delayDays:  Number(delayDays) >= 0 ? Number(delayDays) : 1,
    subject:    subject.trim(),
    body:       body.trim(),
  }).returning();

  return ok(step);
}
