import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { opportunities } from "@/db/schema";
import { eq } from "drizzle-orm";
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

  try {
    const [row] = await db.update(opportunities).set(updates).where(eq(opportunities.id, params.id)).returning();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
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
