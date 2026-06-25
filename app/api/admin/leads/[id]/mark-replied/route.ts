import { ok } from "@/lib/api";
import { requirePlatformAdmin } from "@/lib/billing";
import { logActivity } from "@/lib/admin/activities";
import { db } from "@/db";
import { landingPageRequests, leadSequenceEnrollments, leadNotes } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { NextRequest } from "next/server";

// Called when a lead replies to any email.
// - Cancels every active sequence enrollment so no more automated emails go out
// - Advances the lead status from "new" → "contacted" (leaves it alone if already further along)
// - Logs a reply event in the activity feed
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error, userId, userName } = await requirePlatformAdmin();
  if (error) return error;

  // 1. Cancel all active enrollments
  const cancelled = await db
    .update(leadSequenceEnrollments)
    .set({ status: "cancelled" })
    .where(and(
      eq(leadSequenceEnrollments.leadId, params.id),
      eq(leadSequenceEnrollments.status, "active"),
    ))
    .returning({ id: leadSequenceEnrollments.id });

  // 2. Advance status to "contacted" only if still "new"
  const [updated] = await db
    .update(landingPageRequests)
    .set({ status: "contacted" })
    .where(and(
      eq(landingPageRequests.id, params.id),
      eq(landingPageRequests.status, "new"),
    ))
    .returning({ status: landingPageRequests.status });

  // 3. Log the reply as an activity note
  const authorName = userName ?? "Admin";
  const authorId   = userId ?? null;

  await db.insert(leadNotes).values({
    leadId:     params.id,
    authorId,
    authorName,
    body: JSON.stringify({
      _type:   "reply",
      preview: cancelled.length > 0
        ? `Lead replied — ${cancelled.length} active sequence${cancelled.length !== 1 ? "s" : ""} automatically stopped`
        : "Lead replied — marked as contacted",
    }),
  }).catch(() => {});

  await logActivity({
    type: "email_received", title: "Lead replied",
    body: cancelled.length > 0 ? `${cancelled.length} active sequence(s) auto-stopped` : undefined,
    leadId: params.id, actorId: authorId, actorName,
  });

  return ok({
    sequencesCancelled: cancelled.length,
    statusAdvanced:     !!updated,
  });
}
