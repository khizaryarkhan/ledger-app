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

// These CRM tables are provisioned manually in Neon — tolerate a missing
// relation OR a missing column (schema drift) so enrolment never hard-500s.
function isSchemaMissingError(e: unknown): boolean {
  const msg = ((e as any)?.message ?? "").toLowerCase();
  return msg.includes("does not exist") && (msg.includes("relation") || msg.includes("column"));
}
function isMissingColumn(e: unknown, col: string): boolean {
  const msg = ((e as any)?.message ?? "").toLowerCase();
  return msg.includes("column") && msg.includes(col.toLowerCase()) && msg.includes("does not exist");
}

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

  try {
  const { sequenceId } = await req.json().catch(() => ({}));
  if (!sequenceId) return bad("sequenceId is required");

  // Verify sequence exists and is active
  const [seq] = await db.select().from(leadSequences)
    .where(and(eq(leadSequences.id, sequenceId), eq(leadSequences.isActive, true))).limit(1);
  if (!seq) return bad("Sequence not found or not active", 404);

  const enrolledBy = (session as any).user?.id ?? null;

  // There is a UNIQUE(lead_id, sequence_id) constraint, so at most one row can
  // exist per lead+sequence. Find ANY existing row (regardless of status): if
  // it's active that's a real conflict; if the lead was previously enrolled and
  // later stopped, the row lingers as 'cancelled' — reactivate it rather than
  // inserting a duplicate (which would violate the unique key).
  const [existing] = await db.select()
    .from(leadSequenceEnrollments)
    .where(and(
      eq(leadSequenceEnrollments.leadId, params.id),
      eq(leadSequenceEnrollments.sequenceId, sequenceId),
    )).limit(1);

  if (existing && existing.status === "active") {
    return bad("Lead is already enrolled in this sequence", 409);
  }

  let enrollment;
  if (existing) {
    // Re-enrol: revive the cancelled/completed row.
    [enrollment] = await db.update(leadSequenceEnrollments)
      .set({ status: "active", enrolledAt: new Date(), enrolledBy, completedAt: null })
      .where(eq(leadSequenceEnrollments.id, existing.id))
      .returning();
  } else {
    try {
      [enrollment] = await db.insert(leadSequenceEnrollments).values({
        leadId:     params.id,
        sequenceId,
        enrolledBy,
        status:     "active",
      }).returning();
    } catch (e) {
      // Older DBs may not have the enrolled_by column — retry without it.
      if (isMissingColumn(e, "enrolled_by")) {
        [enrollment] = await db.insert(leadSequenceEnrollments).values({
          leadId:     params.id,
          sequenceId,
          status:     "active",
        } as any).returning();
      } else if (isSchemaMissingError(e)) {
        return bad("Sequences aren't set up on this database yet. Create the lead_sequence_* tables in Neon, then try again.", 503);
      } else {
        throw e;
      }
    }
  }

  // Schedule the first step — best-effort. A missing sends table or column
  // must not undo a successful enrolment, so swallow schema errors here.
  try {
    // On re-enrolment, drop any leftover pending sends so we don't double-send.
    await db.delete(leadSequenceSends).where(and(
      eq(leadSequenceSends.enrollmentId, enrollment.id),
      eq(leadSequenceSends.status, "pending"),
    ));

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
  } catch (e) {
    if (!isSchemaMissingError(e)) throw e;
    // sends table/column missing — enrolment still stands.
  }

  return ok({ ...enrollment, sequenceName: seq.name });
  } catch (e) {
    if (isSchemaMissingError(e)) {
      return bad("Sequences aren't set up on this database yet. Create the lead_sequence_* tables in Neon, then try again.", 503);
    }
    return bad(`Enrolment failed: ${(e as any)?.message ?? "unknown error"}`, 500);
  }
}
