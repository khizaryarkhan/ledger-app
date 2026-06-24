import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { opportunities, organisations, landingPageRequests } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

const slugify = (s: string) =>
  (s || "customer").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "customer";

// POST — ensure the opportunity's lead exists as a billing customer (organisation)
// and link it to the deal. Returns the orgId + sensible invoice defaults. This is
// the Lead → Customer bridge: a won deal becomes invoiceable without a separate
// signup. Card data never touches us — Stripe owns billing.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const [opp] = await db.select().from(opportunities).where(eq(opportunities.id, params.id)).limit(1);
  if (!opp) return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });

  // Lead (for name/email/country defaults).
  const [lead] = opp.leadId
    ? await db.select({ companyName: landingPageRequests.companyName, fullName: landingPageRequests.fullName, email: landingPageRequests.email, country: landingPageRequests.country })
        .from(landingPageRequests).where(eq(landingPageRequests.id, opp.leadId)).limit(1)
    : [undefined as any];

  // Already linked → return it.
  if (opp.orgId) {
    return NextResponse.json({ orgId: opp.orgId, billingEmail: lead?.email ?? "", country: lead?.country ?? "", name: lead?.companyName || lead?.fullName || "" });
  }

  const name = (lead?.companyName || lead?.fullName || opp.title || "Customer").trim();
  const slug = `${slugify(name)}-${randomUUID().slice(0, 6)}`;

  const [org] = await db.insert(organisations).values({
    name, slug, status: "Active",
    currency: (opp.currency || "EUR").toUpperCase().slice(0, 8),
  }).returning({ id: organisations.id });

  await db.update(opportunities).set({ orgId: org.id, updatedAt: new Date() }).where(eq(opportunities.id, params.id));

  return NextResponse.json({ orgId: org.id, billingEmail: lead?.email ?? "", country: lead?.country ?? "", name });
}
