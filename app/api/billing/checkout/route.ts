import { NextResponse } from "next/server";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { requireOrg } from "@/lib/api";
import { stripe } from "@/lib/stripe";
import { getAppUrl } from "@/lib/system-mailer";
import { eq } from "drizzle-orm";
import { z } from "zod";

const schema = z.object({ priceId: z.string().min(1) });

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (role !== "super_admin" && role !== "company_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "priceId is required" }, { status: 400 });
  }

  const [sub] = await db
    .select({ stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.orgId, orgId!))
    .limit(1);

  if (!sub?.stripeCustomerId) {
    return NextResponse.json({ error: "No billing account found" }, { status: 404 });
  }

  const appUrl = getAppUrl();
  try {
    const session = await stripe.checkout.sessions.create({
      customer:   sub.stripeCustomerId,
      mode:       "subscription",
      line_items: [{ price: parsed.data.priceId, quantity: 1 }],
      success_url: `${appUrl}/settings/billing?renewed=1`,
      cancel_url:  `${appUrl}/settings/billing`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    const message = err?.raw?.message ?? err?.message ?? "Failed to create checkout session";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
