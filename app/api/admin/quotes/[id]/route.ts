import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { crmQuotes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { logActivity } from "@/lib/admin/activities";
import { quoteRef } from "../route";

const STATUSES = ["draft", "sent", "accepted", "declined", "expired"];

// PATCH — update a quote's status (draft→sent→accepted/declined…).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { error, userId, userName } = await requirePlatformAdmin();
  if (error) return error;
  const b = await req.json().catch(() => ({} as any));
  if (!b.status || !STATUSES.includes(b.status)) return NextResponse.json({ error: "valid status required" }, { status: 400 });

  const [row] = await db.update(crmQuotes).set({ status: b.status, updatedAt: new Date() }).where(eq(crmQuotes.id, params.id)).returning();
  if (!row) return NextResponse.json({ error: "Quote not found" }, { status: 404 });

  const verb = b.status === "accepted" ? "deal_won" : "deal_moved";
  await logActivity({
    type: verb as any, title: `Quote ${quoteRef(row.refSeq)} ${b.status}`.slice(0, 300),
    accountId: row.accountId, opportunityId: row.opportunityId, actorId: userId, actorName: userName,
    meta: { quoteId: row.id, status: b.status },
  });
  return NextResponse.json({ ok: true, status: b.status });
}

// DELETE — remove a draft quote.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  await db.delete(crmQuotes).where(eq(crmQuotes.id, params.id));
  return NextResponse.json({ deleted: true });
}
