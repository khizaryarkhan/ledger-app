import { db } from "@/db";
import { organisations, users, userOrganisations, subscriptions, crmAccounts } from "@/db/schema";
import { requireAuth, isSuperAdmin, ok, bad } from "@/lib/api";
import { z } from "zod";
import { eq, desc, sql, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { sendSystemEmail, renderWelcomeEmail, getAppUrl } from "@/lib/system-mailer";

const OrgSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers and hyphens only"),
  adminName: z.string().min(1),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8).optional().or(z.literal("")),
});

export async function GET() {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  const userCounts = await db
    .select({ orgId: userOrganisations.orgId, count: sql<number>`count(*)::int` })
    .from(userOrganisations)
    .groupBy(userOrganisations.orgId);
  const countMap = Object.fromEntries(userCounts.map(r => [r.orgId, r.count]));

  // Left-join subscriptions so every org row carries its billing state
  const rows = await db
    .select({
      id:               organisations.id,
      name:             organisations.name,
      slug:             organisations.slug,
      status:           organisations.status,
      createdAt:        organisations.createdAt,
      updatedAt:        organisations.updatedAt,
      subId:            subscriptions.id,
      subStatus:        subscriptions.status,
      subSource:        subscriptions.source,
      planName:         subscriptions.planName,
      planAmount:       subscriptions.planAmount,
      planCurrency:     subscriptions.planCurrency,
      planInterval:     subscriptions.planInterval,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      cancelAtPeriodEnd:subscriptions.cancelAtPeriodEnd,
      cancelAt:         subscriptions.cancelAt,
      trialEnd:         subscriptions.trialEnd,
      lastPaymentStatus:subscriptions.lastPaymentStatus,
      lastPaymentDate:  subscriptions.lastPaymentDate,
      manualExpiresAt:  subscriptions.manualExpiresAt,
      paymentMethodBrand:subscriptions.paymentMethodBrand,
      paymentMethodLast4:subscriptions.paymentMethodLast4,
      billingEmail:     subscriptions.billingEmail,
    })
    .from(organisations)
    .leftJoin(subscriptions, eq(subscriptions.orgId, organisations.id))
    .orderBy(desc(organisations.createdAt), desc(subscriptions.createdAt));

  // Deduplicate: one row per org (latest subscription wins)
  const seen = new Set<string>();
  const orgs = rows.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });

  return ok(orgs.map(org => ({ ...org, userCount: countMap[org.id] || 0 })));
}

export async function POST(req: Request) {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  try {
    const data = OrgSchema.parse(await req.json());

    // Check slug uniqueness
    const [existingOrg] = await db.select().from(organisations).where(eq(organisations.slug, data.slug)).limit(1);
    if (existingOrg) return bad(`Slug "${data.slug}" is already taken`, 409);

    // Create the org — one company = one account (account_id is NOT NULL).
    const { ensureAccount } = await import("@/lib/admin/accounts");
    const accountId = await ensureAccount({ name: data.name, email: data.adminEmail });
    const [org] = await db.insert(organisations).values({ name: data.name, slug: data.slug, accountId }).returning();
    try { await db.update(crmAccounts).set({ organisationId: org.id, lifecycleStage: "customer", updatedAt: new Date() }).where(eq(crmAccounts.id, accountId)); } catch {}

    // Check if admin email already exists
    const [existingUser] = await db.select().from(users).where(eq(users.email, data.adminEmail.toLowerCase().trim())).limit(1);

    let admin: { id: string; name: string; email: string; role: string };

    if (existingUser) {
      // User already exists — link them to the new org via junction table
      admin = { id: existingUser.id, name: existingUser.name, email: existingUser.email, role: existingUser.role };
    } else {
      // New user — require password
      if (!data.adminPassword) return bad("Password is required for new admin accounts");
      const passwordHash = await bcrypt.hash(data.adminPassword, 12);
      const [created] = await db.insert(users).values({
        orgId: org.id,
        name: data.adminName,
        email: data.adminEmail.toLowerCase().trim(),
        passwordHash,
        role: "company_admin",
      }).returning({ id: users.id, name: users.name, email: users.email, role: users.role });
      admin = created;
    }

    // Add to user_organisations junction table (idempotent)
    await db.insert(userOrganisations)
      .values({ userId: admin.id, orgId: org.id, role: "company_admin" })
      .onConflictDoNothing();

    // Send welcome email (fire-and-forget — don't fail the request if email fails)
    sendSystemEmail({
      to:      admin.email,
      subject: `Welcome to ${org.name} — your account is ready`,
      html:    renderWelcomeEmail({
        name:     admin.name,
        orgName:  org.name,
        email:    admin.email,
        password: !existingUser ? data.adminPassword : undefined,
        loginUrl: `${getAppUrl()}/login`,
      }),
    }).catch(err => console.error("[welcome-email]", err));

    return ok({
      org: { ...org, userCount: 1 },
      admin,
      linked: !!existingUser,
    });
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    return bad("Failed to create organisation", 500);
  }
}

export async function PATCH(req: Request) {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  const { orgId, name, status } = await req.json();
  if (!orgId) return bad("orgId required");

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (name?.trim()) updates.name = name.trim();
  if (status && ["Active", "Inactive"].includes(status)) updates.status = status;

  if (Object.keys(updates).length === 1) return bad("Nothing to update");

  await db.update(organisations).set(updates).where(eq(organisations.id, orgId));
  const [updated] = await db.select().from(organisations).where(eq(organisations.id, orgId)).limit(1);
  return ok(updated);
}

export async function DELETE(req: Request) {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  const url = new URL(req.url);
  const orgId = url.searchParams.get("orgId");
  if (!orgId) return bad("orgId required");

  // Verify org exists
  const [org] = await db.select({ id: organisations.id, name: organisations.name })
    .from(organisations)
    .where(eq(organisations.id, orgId))
    .limit(1);
  if (!org) return bad("Organisation not found", 404);

  // Hard delete — cascade rules in schema handle all related data
  await db.delete(organisations).where(eq(organisations.id, orgId));

  return ok({ deleted: true, orgId, name: org.name });
}
