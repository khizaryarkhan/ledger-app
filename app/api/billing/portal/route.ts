import { NextResponse } from "next/server";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { requireOrg } from "@/lib/api";
import { stripe } from "@/lib/stripe";
import { eq } from "drizzle-orm";
import { getAppUrl } from "@/lib/system-mailer";

export async function POST() {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;

  if (role !== "super_admin" && role !== "company_admin") {
    return NextResponse.json({ error: "Only org admins can manage billing" }, { status: 403 });
  }

  const [sub] = await db
    .select({ stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.orgId, orgId!))
    .limit(1);

  if (!sub?.stripeCustomerId) {
    return NextResponse.json({ error: "No billing account found" }, { status: 404 });
  }

  const session = await stripe.billingPortal.sessions.create({
    customer:   sub.stripeCustomerId,
    return_url: `${getAppUrl()}/settings/billing`,
  });

  return NextResponse.json({ url: session.url });
}
