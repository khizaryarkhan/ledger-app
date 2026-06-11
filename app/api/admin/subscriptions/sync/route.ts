import { NextResponse } from "next/server";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { requirePlatformAdmin, syncSubscriptionFromStripe, syncCustomerBillingEmail } from "@/lib/billing";
import { stripe } from "@/lib/stripe";
import { isNotNull } from "drizzle-orm";

export async function POST() {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  // Fetch all rows that have a stripeSubscriptionId OR stripeCustomerId
  const rows = await db
    .select({
      id:                   subscriptions.id,
      orgId:                subscriptions.orgId,
      stripeCustomerId:     subscriptions.stripeCustomerId,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
    })
    .from(subscriptions);

  const results = { synced: 0, skipped: 0, errors: [] as string[] };

  for (const row of rows) {
    try {
      // If we have a subscription ID, sync full details
      if (row.stripeSubscriptionId) {
        const sub = await stripe.subscriptions.retrieve(row.stripeSubscriptionId, {
          expand: ["default_payment_method", "items.data.price.product"],
        });
        await syncSubscriptionFromStripe(sub);
        await syncCustomerBillingEmail(sub.customer as string);
        results.synced++;
        continue;
      }

      // No sub ID but have customer ID — find their active subscription on Stripe
      if (row.stripeCustomerId) {
        const list = await stripe.subscriptions.list({
          customer: row.stripeCustomerId,
          limit: 1,
          expand: ["data.default_payment_method", "data.items.data.price.product"],
        });
        if (list.data.length) {
          await syncSubscriptionFromStripe(list.data[0]);
          await syncCustomerBillingEmail(row.stripeCustomerId);
          results.synced++;
        } else {
          results.skipped++;
        }
        continue;
      }

      results.skipped++;
    } catch (err: any) {
      console.error(`[sync] row ${row.id}:`, err?.message);
      results.errors.push(`${row.orgId}: ${err?.message ?? "unknown error"}`);
    }
  }

  return NextResponse.json({ success: true, ...results });
}
