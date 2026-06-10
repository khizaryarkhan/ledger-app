import { NextRequest } from "next/server";
import { db } from "@/db";
import { pendingRegistrations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ok, bad } from "@/lib/api";
import { stripe, resolveActivePriceId } from "@/lib/stripe";
import { getAppUrl } from "@/lib/system-mailer";
import { z } from "zod";

const Schema = z.object({
  pendingId: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  try {
    const { pendingId } = Schema.parse(await req.json());

    const [reg] = await db
      .select()
      .from(pendingRegistrations)
      .where(eq(pendingRegistrations.id, pendingId))
      .limit(1);

    if (!reg)               return bad("Registration not found", 404);
    if (!reg.emailVerified) return bad("Email not verified", 400);
    if (reg.status === "completed") return bad("Already completed");

    // Resolve the current active price from Stripe (no redeploy needed when the
    // price changes — just update the product's default price in Stripe).
    let priceId: string;
    try {
      priceId = await resolveActivePriceId();
    } catch (e: any) {
      console.error("[register/checkout] price resolution failed:", e?.message || e);
      return bad("Stripe price not configured", 500);
    }

    const appUrl = getAppUrl();

    // Create (or reuse) Stripe customer
    let customerId = reg.stripeCustomerId ?? undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: reg.adminEmail,
        name:  reg.adminName,
        metadata: { pendingId, companyName: reg.companyName },
      });
      customerId = customer.id;
      await db
        .update(pendingRegistrations)
        .set({ stripeCustomerId: customerId })
        .where(eq(pendingRegistrations.id, pendingId));
    }

    // Create Stripe Checkout Session (subscription)
    const session = await stripe.checkout.sessions.create({
      customer:   customerId,
      mode:       "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/register/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${appUrl}/register?step=payment&cancelled=1`,
      metadata: { pendingId },
      subscription_data: {
        metadata: { pendingId, companyName: reg.companyName, adminEmail: reg.adminEmail },
      },
      customer_update: { address: "auto" },
      billing_address_collection: "required",
    });

    await db
      .update(pendingRegistrations)
      .set({ stripeSessionId: session.id, status: "email_verified" })
      .where(eq(pendingRegistrations.id, pendingId));

    return ok({ checkoutUrl: session.url });
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error("[register/checkout]", e);
    return bad("Failed to create checkout session", 500);
  }
}
