import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { crmQuotes } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { logActivity } from "@/lib/admin/activities";

export const quoteRef = (seq: number | null | undefined) => seq ? `Q-${String(seq).padStart(5, "0")}` : "";

type LineItem = { description: string; qty: number; unitPrice: number }; // unitPrice in minor units

function normalizeLines(raw: any): { items: LineItem[]; subtotal: number } {
  const items: LineItem[] = (Array.isArray(raw) ? raw : [])
    .map((l: any) => ({
      description: String(l?.description ?? "").slice(0, 300),
      qty: Math.max(0, Number(l?.qty) || 0),
      unitPrice: Math.max(0, Math.round(Number(l?.unitPrice) || 0)),
    }))
    .filter(l => l.description && l.qty > 0);
  const subtotal = items.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  return { items, subtotal };
}

// GET /api/admin/quotes?accountId=  — quotes for an account (newest first).
export async function GET(req: NextRequest) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  const accountId = new URL(req.url).searchParams.get("accountId");
  if (!accountId) return NextResponse.json({ quotes: [] });
  const rows = await db.select().from(crmQuotes).where(eq(crmQuotes.accountId, accountId)).orderBy(desc(crmQuotes.createdAt));
  return NextResponse.json({ quotes: rows.map(q => ({ ...q, ref: quoteRef(q.refSeq) })) });
}

// POST — create a quote.
export async function POST(req: NextRequest) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;
  const b = await req.json().catch(() => ({} as any));
  if (!b.accountId) return NextResponse.json({ error: "accountId required" }, { status: 400 });
  const { items, subtotal } = normalizeLines(b.lineItems);
  if (!items.length) return NextResponse.json({ error: "At least one line item required" }, { status: 400 });

  const [row] = await db.insert(crmQuotes).values({
    accountId:     b.accountId,
    opportunityId: b.opportunityId || null,
    orgId:         b.orgId || null,
    currency:      (typeof b.currency === "string" && b.currency.length === 3 ? b.currency : "USD").toUpperCase(),
    lineItems:     items,
    subtotal,
    total:         subtotal, // tax/discount can refine later
    validUntil:    b.validUntil || null,
    notes:         b.notes?.slice(0, 1000) || null,
    createdBy:     userId ?? null,
  }).returning();

  await logActivity({
    type: "deal_created", title: `Quote ${quoteRef(row.refSeq)} created · ${(row.total / 100).toFixed(2)} ${row.currency}`.slice(0, 300),
    accountId: b.accountId, opportunityId: b.opportunityId || null, actorId: userId,
    meta: { quoteId: row.id, total: row.total, currency: row.currency },
  });

  return NextResponse.json({ ...row, ref: quoteRef(row.refSeq) }, { status: 201 });
}
