import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  pendingRegistrations,
  organisations,
  users,
  userOrganisations,
  subscriptions,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { stripe } from "@/lib/stripe";
import { sendSystemEmail, renderPasswordResetEmail, getAppUrl } from "@/lib/system-mailer";
import crypto from "crypto";

// Called from /register/success page with the Stripe session_id.
// Verifies payment with Stripe and provisions the org + admin user.
// Idempotent — safe to call multiple times.
export async function POST(req: NextRequest) {
  const { sessionId } = await req.json();
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  // Retrieve the Checkout Session from Stripe
  let session: any;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err: any) {
    return NextResponse.json({ error: "Invalid session" }, { status: 400 });
  }

  // Must be paid
  if (session.payment_status !== "paid") {
    return NextResponse.json({ error: "Payment not completed" }, { status: 402 });
  }

  const pendingId = session.metadata?.pendingId;
  if (!pendingId) {
    return NextResponse.json({ error: "No pendingId in session metadata" }, { status: 400 });
  }

  // Look up pending registration
  const [reg] = await db
    .select()
    .from(pendingRegistrations)
    .where(eq(pendingRegistrations.id, pendingId))
    .limit(1);

  if (!reg) {
    return NextResponse.json({ error: "Registration not found" }, { status: 404 });
  }

  // Already done — return success (idempotent)
  if (reg.status === "completed") {
    return NextResponse.json({ success: true, alreadyProvisioned: true });
  }

  // ── Build unique slug ──────────────────────────────────────────────────────
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

  // ── Create organisation ────────────────────────────────────────────────────
  const [org] = await db
    .insert(organisations)
    .values({ name: reg.companyName, slug: finalSlug })
    .returning();

  // ── Create admin user with reset token ────────────────────────────────────
  const resetToken = crypto.randomBytes(32).toString("hex");
  const resetExpiry = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hrs
  const tempPasswordHash = crypto.randomBytes(32).toString("hex");

  const [admin] = await db
    .insert(users)
    .values({
      orgId: org.id,
      name: reg.adminName,
      email: reg.adminEmail,
      passwordHash: tempPasswordHash,
      role: "company_admin",
      status: "Active",
      resetToken,
      resetTokenExpiry: resetExpiry,
    })
    .returning({ id: users.id, name: users.name, email: users.email });

  await db
    .insert(userOrganisations)
    .values({ userId: admin.id, orgId: org.id, role: "company_admin" })
    .onConflictDoNothing();

  // ── Store subscription ─────────────────────────────────────────────────────
  await db.insert(subscriptions).values({
    orgId: org.id,
    stripeCustomerId: session.customer as string,
    stripeSubscriptionId: (session.subscription as string) ?? undefined,
    stripePriceId: process.env.STRIPE_PRICE_ID ?? null,
    status: "active",
  });

  // ── Mark registration completed ────────────────────────────────────────────
  await db
    .update(pendingRegistrations)
    .set({ status: "completed" })
    .where(eq(pendingRegistrations.id, pendingId));

  // ── Send set-password email ────────────────────────────────────────────────
  const resetUrl = `${getAppUrl()}/reset-password?token=${resetToken}`;
  await sendSystemEmail({
    to: admin.email,
    subject: `Welcome to Prime Accountax — set your password to get started`,
    html: renderPasswordResetEmail({ name: admin.name, resetUrl }),
  });

  console.log(`[register/complete] org created: ${org.slug}, admin: ${admin.email}`);

  return NextResponse.json({
    success: true,
    org: { name: org.name, slug: org.slug },
    admin: { name: admin.name, email: admin.email },
  });
}
