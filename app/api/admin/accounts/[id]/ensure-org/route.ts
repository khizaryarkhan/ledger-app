import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { crmAccounts, organisations, landingPageRequests, users, userOrganisations } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID, randomBytes } from "crypto";

const slugify = (s: string) =>
  (s || "customer").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "customer";

// POST — ensure a Won account has a billing organisation (a pending shell) AND
// a pending admin user, so an invoice/subscription can be created for it and
// payment can activate a real login. Body (all optional): { adminEmail, adminName }.
// Returns { orgId, name, billingEmail, userCount, provisionedUser }.
// Idempotent: reuses the existing org/user when present.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const body = await req.json().catch(() => ({} as any));

  const [account] = await db.select().from(crmAccounts).where(eq(crmAccounts.id, params.id)).limit(1);
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const [lead] = await db.select({ email: landingPageRequests.email, fullName: landingPageRequests.fullName, country: landingPageRequests.country })
    .from(landingPageRequests).where(eq(landingPageRequests.accountId, params.id)).orderBy(desc(landingPageRequests.createdAt)).limit(1);

  const billingEmail = account.billingEmail || lead?.email || "";
  const name = account.name || lead?.fullName || "Customer";

  // ── Ensure the org shell ──────────────────────────────────────────────────
  let orgId = account.organisationId;
  if (!orgId) {
    // Pending shell: Inactive until paid (app access stays gated on payment).
    const slug = `${slugify(name)}-${randomUUID().slice(0, 6)}`;
    const [org] = await db.insert(organisations).values({
      name, slug, status: "Inactive", accountId: account.id,
      currency: (account.country ? "EUR" : "USD"),
    }).returning({ id: organisations.id });
    orgId = org.id;
    await db.update(crmAccounts).set({ organisationId: org.id, updatedAt: new Date() }).where(eq(crmAccounts.id, account.id));
  }

  // ── Ensure the pending admin user (the fix for paid-but-nobody-can-log-in) ─
  // Without a user shell, activateOrgOnPayment has nobody to invite and the
  // customer pays for an account with zero logins. Create it here whenever we
  // have an email (explicit from the modal, or fall back to the billing email).
  const adminEmail = String(body.adminEmail || billingEmail || "").trim().toLowerCase();
  const adminName  = String(body.adminName || lead?.fullName || name).trim();
  let provisionedUser: string | null = null;
  if (adminEmail) {
    const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, adminEmail)).limit(1);
    if (existingUser) {
      await db.insert(userOrganisations).values({ userId: existingUser.id, orgId: orgId!, role: "company_admin" }).onConflictDoNothing();
      provisionedUser = adminEmail;
    } else {
      const [u] = await db.insert(users).values({
        orgId: orgId!, name: adminName, email: adminEmail,
        passwordHash: randomBytes(32).toString("hex"), // unusable until activation
        role: "company_admin", status: "Inactive", // invited on payment
      }).returning({ id: users.id });
      await db.insert(userOrganisations).values({ userId: u.id, orgId: orgId!, role: "company_admin" }).onConflictDoNothing();
      provisionedUser = adminEmail;
    }
  }

  const orgUsers = await db.select({ id: users.id }).from(users).where(eq(users.orgId, orgId!));
  return NextResponse.json({ orgId, name, billingEmail, userCount: orgUsers.length, provisionedUser });
}
