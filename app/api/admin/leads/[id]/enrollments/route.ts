import { requireAuth, isSuperAdmin, ok, bad } from "@/lib/api";
import { db } from "@/db";
import {
  leadSequenceEnrollments,
  leadSequences,
  leadSequenceSteps,
  leadSequenceSends,
} from "@/db/schema";
import { eq, and, asc, desc } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  const enrollments = await db
    .select({
      id:           leadSequenceEnrollments.id,
      sequenceId:   leadSequenceEnrollments.sequenceId,
      sequenceName: leadSequences.name,
      status:       leadSequenceEnrollments.status,
      enrolledAt:   leadSequenceEnrollments.enrolledAt,
      completedAt:  leadSequenceEnrollments.completedAt,
    })
    .from(leadSequenceEnrollments)
    .innerJoin(leadSequences, eq(leadSequenceEnrollments.sequenceId, leadSequences.id))
    .where(eq(leadSequenceEnrollments.leadId, params.id))
    .orderBy(desc(leadSequenceEnrollments.enrolledAt));

  return ok(enrollments);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  const { sequenceId } = await req.json().catch(() => ({}));
  if (!sequenceId) return bad("sequenceId is required");

  // Verify sequence exists and is active
  const [seq] = await db.select().from(leadSequences)
    .where(and(eq(leadSequences.id, sequenceId), eq(leadSequences.isActive, true))).limit(1);
  if (!seq) return bad("Sequence not found or not active", 404);

  // Check not already actively enrolled
  const [existing] = await db.select({ id: leadSequenceEnrollments.id })
    .from(leadSequenceEnrollments)
    .where(and(
      eq(leadSequenceEnrollments.leadId, params.id),
      eq(leadSequenceEnrollments.sequenceId, sequenceId),
      eq(leadSequenceEnrollments.status, "active"),
    )).limit(1);
  if (existing) return bad("Lead is already enrolled in this sequence", 409);

  const enrolledBy = (session as any).user?.id ?? null;
  const [enrollment] = await db.insert(leadSequenceEnrollments).values({
    leadId:     params.id,
    sequenceId,
    enrolledBy,
    status:     "active",
  }).returning();

  // Schedule the first step
  const [firstStep] = await db.select().from(leadSequenceSteps)
    .where(eq(leadSequenceSteps.sequenceId, sequenceId))
    .orderBy(asc(leadSequenceSteps.stepNumber))
    .limit(1);

  if (firstStep) {
    const scheduledAt = new Date();
    if (firstStep.delayDays > 0) scheduledAt.setDate(scheduledAt.getDate() + firstStep.delayDays);
    await db.insert(leadSequenceSends).values({
      enrollmentId: enrollment.id,
      stepId:       firstStep.id,
      scheduledAt,
      status:       "pending",
    });
  }

  return ok({ ...enrollment, sequenceName: seq.name });
}
