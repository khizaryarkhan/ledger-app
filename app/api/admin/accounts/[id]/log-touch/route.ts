import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { crmAccounts, landingPageRequests, leadTasks } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { logActivity, type ActivityType } from "@/lib/admin/activities";

// POST — log a manual touch (call / whatsapp / meeting) on an account, with an
// optional outcome note and a follow-up task. Feeds the activity timeline.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { error, userId, userName } = await requirePlatformAdmin();
  if (error) return error;

  const b = await req.json().catch(() => ({} as any));
  const kind: string = b.type;
  const MAP: Record<string, { type: ActivityType; label: string }> = {
    call:     { type: "call_logged",   label: "Call logged" },
    whatsapp: { type: "whatsapp_sent", label: "WhatsApp message" },
    meeting:  { type: "meeting_booked", label: "Meeting booked" },
  };
  const m = MAP[kind];
  if (!m) return NextResponse.json({ error: "type must be call | whatsapp | meeting" }, { status: 400 });

  const [account] = await db.select({ id: crmAccounts.id }).from(crmAccounts).where(eq(crmAccounts.id, params.id)).limit(1);
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const [lead] = await db.select({ id: landingPageRequests.id }).from(landingPageRequests)
    .where(eq(landingPageRequests.accountId, params.id)).orderBy(desc(landingPageRequests.createdAt)).limit(1);

  const outcome = typeof b.outcome === "string" && b.outcome.trim() ? b.outcome.trim() : null;
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 300) : "";

  await logActivity({
    type: m.type, title: `${m.label}${outcome ? ` — ${outcome}` : ""}`.slice(0, 300),
    body: note || undefined, accountId: params.id, leadId: lead?.id ?? null,
    actorId: userId, actorName: userName,
  });

  // Optional follow-up task (only if the account has a lead to hang it on).
  if (b.followupTitle && typeof b.followupTitle === "string" && lead) {
    await db.insert(leadTasks).values({
      leadId: lead.id, title: b.followupTitle.trim().slice(0, 500),
      dueDate: b.followupDue ? new Date(b.followupDue) : null,
      type: kind === "call" ? "call" : "follow_up", priority: "normal", createdBy: userId ?? null,
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
