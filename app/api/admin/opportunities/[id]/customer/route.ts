import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { opportunities, organisations, landingPageRequests, users, userOrganisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID, randomBytes } from "crypto";
import { sendSystemEmail, renderPasswordResetEmail, getAppUrl } from "@/lib/system-mailer";

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

  const name = (lead?.companyName || lead?.fullName || opp.title || "Customer").trim();

  // ── ensure the organisation ──
  let orgId = opp.orgId;
  if (!orgId) {
    const slug = `${slugify(name)}-${randomUUID().slice(0, 6)}`;
    const [org] = await db.insert(organisations).values({
      name, slug, status: "Active", currency: (opp.currency || "EUR").toUpperCase().slice(0, 8),
    }).returning({ id: organisations.id });
    orgId = org.id;
    await db.update(opportunities).set({ orgId, updatedAt: new Date() }).where(eq(opportunities.id, params.id));
  }

  // ── optionally provision the app account + set-password email ──
  let provisioned = false, emailed = false;
  if (wantProvision) {
    const accountEmail = String(body.email || lead?.email || "").trim().toLowerCase();
    const accountName  = String(body.name || lead?.fullName || name).trim();
    if (accountEmail) {
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, accountEmail)).limit(1);
      if (existing) {
        // Link the existing user to this org; don't re-send a welcome.
        await db.insert(userOrganisations).values({ userId: existing.id, orgId: orgId!, role: "company_admin" }).onConflictDoNothing();
        provisioned = true;
      } else {
        const resetToken = randomBytes(32).toString("hex");
        const [u] = await db.insert(users).values({
          orgId: orgId!, name: accountName, email: accountEmail,
          passwordHash: randomBytes(32).toString("hex"), // unusable until they set one
          role: "company_admin", status: "Active",
          resetToken, resetTokenExpiry: new Date(Date.now() + 72 * 60 * 60 * 1000),
        }).returning({ id: users.id, name: users.name, email: users.email });
        await db.insert(userOrganisations).values({ userId: u.id, orgId: orgId!, role: "company_admin" }).onConflictDoNothing();
        try {
          await sendSystemEmail({
            to: u.email,
            subject: "Welcome to Prime Accountax — set your password to get started",
            html: renderPasswordResetEmail({ name: u.name, resetUrl: `${getAppUrl()}/reset-password?token=${resetToken}` }),
          });
          emailed = true;
        } catch { /* account still created; email is best-effort */ }
        provisioned = true;
      }
    }
  }

  return NextResponse.json({
    orgId, billingEmail: lead?.email ?? "", country: lead?.country ?? "", name, provisioned, emailed,
  });
}
