import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { opportunities, organisations, landingPageRequests, users, userOrganisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID, randomBytes } from "crypto";

const slugify = (s: string) =>
  (s || "customer").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "customer";

// POST — ensure the opportunity's lead exists as a billing customer (organisation)
// and link it to the deal. With { provision:true } it also creates the app account
// (a company_admin user) and emails a set-password link, tying the account to the
// subscription. The Lead → Customer bridge: a won deal becomes a real, invoiceable
// account in one step. Card data never touches us — Stripe owns billing.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const body = await req.json().catch(() => ({} as any));
  const wantProvision = !!body.provision;

  const [opp] = await db.select().from(opportunities).where(eq(opportunities.id, params.id)).limit(1);
  if (!opp) return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });

  const [lead] = opp.leadId
    ? await db.select({ companyName: landingPageRequests.companyName, fullName: landingPageRequests.fullName, email: landingPageRequests.email, country: landingPageRequests.country })
        .from(landingPageRequests).where(eq(landingPageRequests.id, opp.leadId)).limit(1)
    : [undefined as any];

  // Admin-supplied company name takes priority over the guessed one.
  const overrideName = typeof body.name === "string" ? body.name.trim() : "";
  const name = (overrideName || lead?.companyName || lead?.fullName || opp.title || "Customer").trim();

  // ── ensure the organisation ──
  let orgId = opp.orgId;
  if (!orgId) {
    const slug = `${slugify(name)}-${randomUUID().slice(0, 6)}`;
    // Pending shell: created Inactive. Access is granted only when the invoice
    // is paid (Stripe invoice.paid → activateOrgOnPayment).
    const [org] = await db.insert(organisations).values({
      name, slug, status: "Inactive", currency: (opp.currency || "EUR").toUpperCase().slice(0, 8),
    }).returning({ id: organisations.id });
    orgId = org.id;
    await db.update(opportunities).set({ orgId, updatedAt: new Date() }).where(eq(opportunities.id, params.id));
  } else if (overrideName) {
    // Org already exists — keep its name in sync with what the admin typed.
    await db.update(organisations).set({ name: overrideName, updatedAt: new Date() }).where(eq(organisations.id, orgId));
  }

  // Dual-write (Phase 1): one company = one account. Link org/opp/lead to it.
  try {
    const { ensureAccount } = await import("@/lib/admin/accounts");
    const accountId = await ensureAccount({ name, email: lead?.email, country: lead?.country, organisationId: orgId });
    if (accountId) {
      await db.update(organisations).set({ accountId }).where(eq(organisations.id, orgId!));
      await db.update(opportunities).set({ accountId }).where(eq(opportunities.id, params.id));
      if (opp.leadId) await db.update(landingPageRequests).set({ accountId }).where(eq(landingPageRequests.id, opp.leadId));
    }
  } catch { /* non-fatal */ }

  // ── provision the PENDING shell user (Inactive, no invite email) ──
  // The set-password invite + activation happen on payment, never at creation.
  let provisioned = false;
  if (wantProvision) {
    const accountEmail = String(body.email || lead?.email || "").trim().toLowerCase();
    const accountName  = String(body.name || lead?.fullName || name).trim();
    if (accountEmail) {
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, accountEmail)).limit(1);
      if (existing) {
        await db.insert(userOrganisations).values({ userId: existing.id, orgId: orgId!, role: "company_admin" }).onConflictDoNothing();
        provisioned = true;
      } else {
        const [u] = await db.insert(users).values({
          orgId: orgId!, name: accountName, email: accountEmail,
          passwordHash: randomBytes(32).toString("hex"), // unusable until activation
          role: "company_admin", status: "Inactive", // pending invite — no access yet
        }).returning({ id: users.id });
        await db.insert(userOrganisations).values({ userId: u.id, orgId: orgId!, role: "company_admin" }).onConflictDoNothing();
        provisioned = true;
      }
    }
  }

  return NextResponse.json({
    orgId, billingEmail: lead?.email ?? "", country: lead?.country ?? "", name, provisioned, pending: true,
  });
}
