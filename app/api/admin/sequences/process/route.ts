import { db } from "@/db";
import {
  leadSequenceSends,
  leadSequenceEnrollments,
  leadSequenceSteps,
  leadSequences,
  landingPageRequests,
  leadNotes,
} from "@/db/schema";
import { eq, and, lte } from "drizzle-orm";
import { sendSystemEmail } from "@/lib/system-mailer";
import { ok, bad } from "@/lib/api";
import { NextRequest } from "next/server";

// Called by Vercel Cron every hour — also manually callable with the CRON_SECRET
export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) return bad("Unauthorized", 401);
  }

  const now = new Date();

  // Find pending sends that are due
  const pending = await db
    .select({
      sendId:       leadSequenceSends.id,
      enrollmentId: leadSequenceSends.enrollmentId,
      stepId:       leadSequenceSends.stepId,
      scheduledAt:  leadSequenceSends.scheduledAt,
      stepNumber:   leadSequenceSteps.stepNumber,
      stepSubject:  leadSequenceSteps.subject,
      stepBody:     leadSequenceSteps.body,
      sequenceId:   leadSequenceEnrollments.sequenceId,
      leadId:       leadSequenceEnrollments.leadId,
      seqName:      leadSequences.name,
      leadEmail:    landingPageRequests.email,
      leadName:     landingPageRequests.fullName,
      leadCompany:  landingPageRequests.companyName,
    })
    .from(leadSequenceSends)
    .innerJoin(leadSequenceEnrollments, eq(leadSequenceSends.enrollmentId, leadSequenceEnrollments.id))
    .innerJoin(leadSequenceSteps,       eq(leadSequenceSends.stepId,       leadSequenceSteps.id))
    .innerJoin(leadSequences,           eq(leadSequenceEnrollments.sequenceId, leadSequences.id))
    .innerJoin(landingPageRequests,     eq(leadSequenceEnrollments.leadId,  landingPageRequests.id))
    .where(and(
      eq(leadSequenceSends.status,          "pending"),
      lte(leadSequenceSends.scheduledAt,    now),
      eq(leadSequenceEnrollments.status,    "active"),
      eq(leadSequences.isActive,            true),
    ))
    .limit(50);

  let sent = 0; let failed = 0;

  for (const item of pending) {
    try {
      const firstName   = item.leadName?.split(" ")[0] ?? "";
      const companyName = item.leadCompany ?? "";
      const fill = (s: string) =>
        s.replace(/\{\{firstName\}\}/g, firstName).replace(/\{\{companyName\}\}/g, companyName);

      const html = fill(item.stepBody)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");

      await sendSystemEmail({ to: item.leadEmail, subject: fill(item.stepSubject), html });

      // Mark send as sent
      await db.update(leadSequenceSends)
        .set({ status: "sent", sentAt: now })
        .where(eq(leadSequenceSends.id, item.sendId));

      // Log as activity note
      try {
        await db.insert(leadNotes).values({
          leadId:     item.leadId,
          authorId:   null,
          authorName: `Sequence: ${item.seqName}`,
          body: JSON.stringify({
            _type:      "email",
            subject:    fill(item.stepSubject),
            preview:    fill(item.stepBody).slice(0, 400),
            to:         item.leadEmail,
            sequence:   item.seqName,
            stepNumber: item.stepNumber,
          }),
        });
      } catch { /* log failure is non-fatal */ }

      // Schedule next step
      const [nextStep] = await db.select()
        .from(leadSequenceSteps)
        .where(and(
          eq(leadSequenceSteps.sequenceId, item.sequenceId),
          eq(leadSequenceSteps.stepNumber, item.stepNumber + 1),
        ))
        .limit(1);

      if (nextStep) {
        const nextAt = new Date(now);
        nextAt.setDate(nextAt.getDate() + nextStep.delayDays);
        await db.insert(leadSequenceSends).values({
          enrollmentId: item.enrollmentId,
          stepId:       nextStep.id,
          scheduledAt:  nextAt,
          status:       "pending",
        });
      } else {
        // All steps done — complete the enrollment
        await db.update(leadSequenceEnrollments)
          .set({ status: "completed", completedAt: now })
          .where(eq(leadSequenceEnrollments.id, item.enrollmentId));
      }

      sent++;
    } catch (err) {
      await db.update(leadSequenceSends)
        .set({ status: "failed", errorMessage: String(err) })
        .where(eq(leadSequenceSends.id, item.sendId)).catch(() => {});
      failed++;
    }
  }

  return ok({ processed: pending.length, sent, failed });
}

// Vercel also calls crons via GET in some configurations
export { POST as GET };
