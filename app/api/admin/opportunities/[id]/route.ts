import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { opportunities, landingPageRequests } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { OPP_STAGE_KEYS, stageStatus, defaultConfidence } from "@/lib/opportunities";

// PATCH — update a deal (stage move, value, confidence, etc.). Moving to a
// terminal stage (won/lost) sets status + the won/lost timestamp.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const b = await req.json().catch(() => ({}));
  const updates: Record<string, any> = { updatedAt: new Date() };

  if (b.stage !== undefined) {
    if (!OPP_STAGE_KEYS.includes(b.stage)) return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
    updates.stage = b.stage;
    const status = stageStatus(b.stage);
    updates.status = status;
    updates.wonAt = status === "won" ? new Date() : null;
    updates.lostAt = status === "lost" ? new Date() : null;
    // Snap confidence to the stage default unless the caller also sets it explicitly.
    if (b.confidence === undefined) updates.confidence = defaultConfidence(b.stage);
  }
  if (typeof b.title === "string" && b.title.trim()) updates.title = b.title.trim();
  if (b.value != null && !isNaN(Number(b.value))) updates.value = Math.max(0, parseInt(String(b.value)));
  if (typeof b.currency === "string" && b.currency.length === 3) updates.currency = b.currency.toUpperCase();
  if (b.confidence != null && !isNaN(Number(b.confidence))) updates.confidence = Math.max(0, Math.min(100, parseInt(String(b.confidence))));
  if (b.expectedCloseDate !== undefined) updates.expectedCloseDate = b.expectedCloseDate ? new Date(b.expectedCloseDate) : null;
  if (b.leadId !== undefined) updates.leadId = b.leadId || null;
  if (b.orgId !== undefined) updates.orgId = b.orgId || null;
  if (b.ownerId !== undefined) updates.ownerId = b.ownerId || null;
  if (typeof b.lostReason === "string") updates.lostReason = b.lostReason.slice(0, 2000);
  // Billing link (set after an invoice is created from the deal).
  if (typeof b.stripeInvoiceId === "string") updates.stripeInvoiceId = b.stripeInvoiceId;
  if (typeof b.invoiceUrl === "string") updates.invoiceUrl = b.invoiceUrl;
  if (b.invoiceTotal != null && !isNaN(Number(b.invoiceTotal))) updates.invoiceTotal = parseInt(String(b.invoiceTotal));
  if (typeof b.invoiceCurrency === "string") updates.invoiceCurrency = b.invoiceCurrency.toLowerCase().slice(0, 3);
  if (typeof b.invoiceStatus === "string") updates.invoiceStatus = b.invoiceStatus.slice(0, 20);
  if (b.invoicedAt !== undefined) updates.invoicedAt = b.invoicedAt ? new Date(b.invoicedAt) : null;

  try {
    const [row] = await db.update(opportunities).set(updates).where(eq(opportunities.id, params.id)).returning();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Relational lifecycle: winning a deal converts its lead to a customer so
    // the company graduates out of the active leads pipeline (one place only).
    if (updates.status === "won" && row.leadId) {
      await db.update(landingPageRequests)
        .set({ status: "converted", updatedAt: new Date() })
        .where(and(eq(landingPageRequests.id, row.leadId), inArray(landingPageRequests.status, ["new", "contacted", "qualified"])));
    }

    // Log a stage move (won/lost/other) to the activity timeline.
    if (updates.stage !== undefined) {
      const { logActivity } = await import("@/lib/admin/activities");
      const t = updates.status === "won" ? "deal_won" : updates.status === "lost" ? "deal_lost" : "deal_moved";
      await logActivity({
        type: t as any, title: `Deal ${updates.status === "won" ? "won" : updates.status === "lost" ? "lost" : `moved to ${updates.stage}`}: ${row.title}`.slice(0, 300),
        accountId: row.accountId, leadId: row.leadId, orgId: row.orgId, opportunityId: row.id,
        meta: { stage: updates.stage, value: row.value, currency: row.currency },
      });
    }
    return NextResponse.json(row);
  } catch (e) {
    const m = ((e as any)?.message ?? "").toLowerCase();
    if (m.includes("does not exist")) return NextResponse.json({ error: "Opportunities table not set up." }, { status: 503 });
    throw e;
  }
}

// DELETE — remove a deal.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  await db.delete(opportunities).where(eq(opportunities.id, params.id));
  return NextResponse.json({ deleted: true });
}
