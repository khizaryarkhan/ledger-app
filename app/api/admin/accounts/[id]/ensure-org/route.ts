import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { crmAccounts, organisations, landingPageRequests } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

const slugify = (s: string) =>
  (s || "customer").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "customer";

// POST — ensure a Won account has a billing organisation (a pending shell), so an
// invoice/subscription can be created for it. Returns { orgId, name, billingEmail }.
// Idempotent: returns the existing org if there is one.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const [account] = await db.select().from(crmAccounts).where(eq(crmAccounts.id, params.id)).limit(1);
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const [lead] = await db.select({ email: landingPageRequests.email, fullName: landingPageRequests.fullName, country: landingPageRequests.country })
    .from(landingPageRequests).where(eq(landingPageRequests.accountId, params.id)).orderBy(desc(landingPageRequests.createdAt)).limit(1);

  const billingEmail = account.billingEmail || lead?.email || "";
  const name = account.name || lead?.fullName || "Customer";

  if (account.organisationId) {
    return NextResponse.json({ orgId: account.organisationId, name, billingEmail });
  }

  // Pending shell: Inactive until paid (app access stays gated on payment).
  const slug = `${slugify(name)}-${randomUUID().slice(0, 6)}`;
  const [org] = await db.insert(organisations).values({
    name, slug, status: "Inactive", accountId: account.id,
    currency: (account.country ? "EUR" : "USD"),
  }).returning({ id: organisations.id });

  await db.update(crmAccounts).set({ organisationId: org.id, updatedAt: new Date() }).where(eq(crmAccounts.id, account.id));

  return NextResponse.json({ orgId: org.id, name, billingEmail });
}
