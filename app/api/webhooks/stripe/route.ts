import { NextRequest } from "next/server";
import { db } from "@/db";
import { pendingRegistrations, organisations, users, userOrganisations, subscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { stripe } from "@/lib/stripe";
import { sendSystemEmail, renderPasswordResetEmail, getAppUrl } from "@/lib/system-mailer";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  const body      = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) return new Response("Missing signature", { status: 400 });

  let event: any;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    console.error("[stripe-webhook] signature verification failed:", err.message);
    return new Response(`Webhook error: ${err.message}`, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const pendingId = session.metadata?.pendingId;
      if (!pendingId) {
        console.warn("[stripe-webhook] no pendingId in session metadata");
        return new Response("OK", { status: 200 });
      }

      const [reg] = await db
        .select()
        .from(pendingRegistrations)
        .where(eq(pendingRegistrations.id, pendingId))
        .limit(1);

      if (!reg || reg.status === "completed") {
        return new Response("OK", { status: 200 }); // idempotent
      }

      // --- Create organisation ---
      const slug = reg.companyName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 64);

      // Ensure slug uniqueness
      let finalSlug = slug;
      let attempt   = 0;
      while (true) {
        const [existing] = await db
          .select({ id: organisations.id })
          .from(organisations)
          .where(eq(organisations.slug, finalSlug))
          .limit(1);
        if (!existing) break;
        attempt++;
        finalSlug = `${slug}-${attempt}`;
      }

      const [org] = await db.insert(organisations).values({
        name: reg.companyName,
        slug: finalSlug,
      }).returning();

      // --- Create admin user (no password yet — will be set via reset link) ---
      // Generate a reset token they'll use to set their initial password
      const resetToken  = crypto.randomBytes(32).toString("hex");
      const resetExpiry = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours

      const tempPasswordHash = crypto.randomBytes(32).toString("hex"); // unusable placeholder

      const [admin] = await db.insert(users).values({
        orgId:            org.id,
        name:             reg.adminName,
        email:            reg.adminEmail,
        passwordHash:     tempPasswordHash,
        role:             "company_admin",
        status:           "Active",
        resetToken,
        resetTokenExpiry: resetExpiry,
      }).returning({ id: users.id, name: users.name, email: users.email });

      // Link to org
      await db.insert(userOrganisations).values({
        userId: admin.id,
        orgId:  org.id,
        role:   "company_admin",
      }).onConflictDoNothing();

      // --- Store subscription ---
      const subscriptionId = session.subscription as string | null;
      await db.insert(subscriptions).values({
        orgId:                org.id,
        stripeCustomerId:     session.customer as string,
        stripeSubscriptionId: subscriptionId ?? undefined,
        stripePriceId:        process.env.STRIPE_PRICE_ID ?? null,
        status:               "active",
      });

      // --- Mark pending registration as completed ---
      await db.update(pendingRegistrations)
        .set({ status: "completed" })
        .where(eq(pendingRegistrations.id, pendingId));

      // --- Send "Set your password" email ---
      const resetUrl = `${getAppUrl()}/reset-password?token=${resetToken}`;
      await sendSystemEmail({
        to:      admin.email,
        subject: `Welcome to Prime Accountax — set your password to get started`,
        html:    renderPasswordResetEmail({ name: admin.name, resetUrl }),
      });

      console.log(`[stripe-webhook] org created: ${org.slug}, admin: ${admin.email}`);
    }

    if (event.type === "checkout.session.expired") {
      const session   = event.data.object;
      const pendingId = session.metadata?.pendingId;
      if (pendingId) {
        await db.delete(pendingRegistrations).where(eq(pendingRegistrations.id, pendingId));
        console.log(`[stripe-webhook] expired session cleaned up: ${pendingId}`);
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      await db
        .update(subscriptions)
        .set({ status: "cancelled" })
        .where(eq(subscriptions.stripeSubscriptionId, sub.id));
      console.log(`[stripe-webhook] subscription cancelled: ${sub.id}`);
    }

  } catch (err: any) {
    console.error("[stripe-webhook] handler error:", err);
    return new Response("Handler error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
