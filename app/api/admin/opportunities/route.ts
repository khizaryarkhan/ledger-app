import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { opportunities, landingPageRequests, users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { OPP_STAGE_KEYS, stageStatus, defaultConfidence } from "@/lib/opportunities";

function isSchemaMissing(e: unknown): boolean {
  const m = ((e as any)?.message ?? "").toLowerCase();
  return m.includes("does not exist") && (m.includes("relation") || m.includes("column"));
}

// GET — all opportunities, enriched with lead + owner names.
export async function GET() {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  try {
    const rows = await db
      .select({
        id: opportunities.id,
        leadId: opportunities.leadId,
        orgId: opportunities.orgId,
        title: opportunities.title,
        value: opportunities.value,
        currency: opportunities.currency,
        confidence: opportunities.confidence,
        stage: opportunities.stage,
        status: opportunities.status,
        expectedCloseDate: opportunities.expectedCloseDate,
        wonAt: opportunities.wonAt,
        lostAt: opportunities.lostAt,
        createdAt: opportunities.createdAt,
        updatedAt: opportunities.updatedAt,
        leadName: landingPageRequests.fullName,
        leadCompany: landingPageRequests.companyName,
        ownerName: users.name,
      })
      .from(opportunities)
      .leftJoin(landingPageRequests, eq(landingPageRequests.id, opportunities.leadId))
      .leftJoin(users, eq(users.id, opportunities.ownerId))
      .orderBy(desc(opportunities.updatedAt));
    return NextResponse.json({ opportunities: rows });
  } catch (e) {
    if (isSchemaMissing(e)) return NextResponse.json({ opportunities: [], needsSetup: true });
    throw e;
  }
}

// POST — create an opportunity.
export async function POST(req: NextRequest) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const b = await req.json().catch(() => ({}));
  const title = String(b.title ?? "").trim();
  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

  const stage = OPP_STAGE_KEYS.includes(b.stage) ? b.stage : "discovery";
  const confidence = b.confidence != null && !isNaN(Number(b.confidence))
    ? Math.max(0, Math.min(100, parseInt(String(b.confidence))))
    : defaultConfidence(stage);
  const status = stageStatus(stage);

  try {
    const [row] = await db.insert(opportunities).values({
      title,
      leadId: b.leadId || null,
      orgId: b.orgId || null,
      value: b.value != null && !isNaN(Number(b.value)) ? Math.max(0, parseInt(String(b.value))) : 0,
      currency: typeof b.currency === "string" && b.currency.length === 3 ? b.currency.toUpperCase() : "USD",
      confidence,
      stage,
      status,
      expectedCloseDate: b.expectedCloseDate ? new Date(b.expectedCloseDate) : null,
      wonAt: status === "won" ? new Date() : null,
      lostAt: status === "lost" ? new Date() : null,
      ownerId: b.ownerId || (userId as string) || null,
      createdBy: (userId as string) || null,
    }).returning();
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    if (isSchemaMissing(e)) {
      return NextResponse.json({ error: "The opportunities table isn't set up yet. Create it in Neon, then try again." }, { status: 503 });
    }
    throw e;
  }
}
