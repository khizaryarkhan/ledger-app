import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { pendingRegistrations, organisations, users, userOrganisations, subscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sendSystemEmail, renderPasswordResetEmail, getAppUrl } from "@/lib/system-mailer";
import crypto from "crypto";

// Super-admin only: manually provision an org from a completed-but-unprocessed pending registration.
// POST /api/admin/provision  { pendingId: string }
export async function POST(req: NextRequest) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (!session || role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { pendingId } = await req.json();
  if (!pendingId) return NextResponse.json({ error: "pendingId required" }, { status: 400 });

  const [reg] = await db
    .select()
    .from(pendingRegistrations)
    .where(eq(pendingRegistrations.id, pendingId))
    .limit(1);

  if (!reg) return NextResponse.json({ error: "Pending registration not found" }, { status: 404 });
  if (reg.status === "completed") return NextResponse.json({ error: "Already provisioned" }, { status: 409 });

  // Build unique slug
  const baseSlug = reg.companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);

  let finalSlug = baseSlug;
  let attempt = 0;
  while (true) {
    const [existing] = await db
      .select({ id: organisations.id })
      .from(organisations)
      .where(eq(organisations.slug, finalSlug))
      .limit(1);
    if (!existing) break;
    attempt++;
    finalSlug = `${baseSlug}-${attempt}`;
  }

  // Create org
  const [org] = await db.insert(organisations).values({
    name: reg.companyName,
    slug: finalSlug,
  }).returning();

  // Create admin user with reset token (no password yet)
  const resetToken = crypto.randomBytes(32).toString("hex");
  const resetExpiry = new Date(Date.now() + 72 * 60 * 60 * 1000);
  const tempPasswordHash = crypto.randomBytes(32).toString("hex");

  const [admin] = await db.insert(users).values({
    orgId: org.id,
    name: reg.adminName,
    email: reg.adminEmail,
    passwordHash: tempPasswordHash,
    role: "company_admin",
    status: "Active",
    resetToken,
    resetTokenExpiry: resetExpiry,
  }).returning({ id: users.id, name: users.name, email: users.email });

  await db.insert(userOrganisations).values({
    userId: admin.id,
    orgId: org.id,
    role: "company_admin",
  }).onConflictDoNothing();

  // Store subscription if we have stripe info
  if (reg.stripeCustomerId) {
    await db.insert(subscriptions).values({
      orgId: org.id,
      stripeCustomerId: reg.stripeCustomerId,
      stripeSubscriptionId: reg.stripeSessionId ?? undefined,
      status: "active",
    });
  }

  // Mark as completed
  await db.update(pendingRegistrations)
    .set({ status: "completed" })
    .where(eq(pendingRegistrations.id, pendingId));

  // Send set-password email
  const resetUrl = `${getAppUrl()}/reset-password?token=${resetToken}`;
  await sendSystemEmail({
    to: admin.email,
    subject: `Welcome to Prime Accountax — set your password to get started`,
    html: renderPasswordResetEmail({ name: admin.name, resetUrl }),
  });

  return NextResponse.json({
    success: true,
    org: { id: org.id, name: org.name, slug: org.slug },
    admin: { id: admin.id, name: admin.name, email: admin.email },
    message: `Organisation created and welcome email sent to ${admin.email}`,
  });
}
