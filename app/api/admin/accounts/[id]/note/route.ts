import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { crmAccounts, landingPageRequests, leadNotes } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { logActivity } from "@/lib/admin/activities";

// POST — add a note to an account (works for any company, lead or customer).
// Always lands on the account timeline; mirrors to the lead's notes too if there is one.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { error, userId, userName } = await requirePlatformAdmin();
  if (error) return error;

  const { body } = await req.json().catch(() => ({}));
  if (!body?.trim()) return NextResponse.json({ error: "Note body is required" }, { status: 400 });

  const [account] = await db.select({ id: crmAccounts.id }).from(crmAccounts).where(eq(crmAccounts.id, params.id)).limit(1);
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const [lead] = await db.select({ id: landingPageRequests.id }).from(landingPageRequests)
    .where(eq(landingPageRequests.accountId, params.id)).orderBy(desc(landingPageRequests.createdAt)).limit(1);

  if (lead) {
    await db.insert(leadNotes).values({ leadId: lead.id, authorId: userId ?? null, authorName: userName ?? "Admin", body: body.trim() }).catch(() => {});
  }
  await logActivity({ type: "note_added", title: "Note added", body: body.trim().slice(0, 300), accountId: params.id, leadId: lead?.id ?? null, actorId: userId, actorName: userName });

  return NextResponse.json({ ok: true });
}
