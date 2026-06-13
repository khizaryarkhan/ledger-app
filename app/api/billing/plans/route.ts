import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/api";
import { stripe } from "@/lib/stripe";

export async function GET() {
  const { error, role } = await requireOrg();
  if (error) return error;
  if (role !== "super_admin" && role !== "company_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch all active recurring prices with their product expanded
  const prices = await stripe.prices.list({
    active: true,
    type: "recurring",
    expand: ["data.product"],
    limit: 20,
  });

  const plans = prices.data
    .filter(p => {
      const product = p.product as any;
      return product && !product.deleted && product.active !== false;
    })
    .map(p => {
      const product = p.product as any;
      return {
        priceId:     p.id,
        productName: product?.name ?? "Subscription",
        description: product?.description ?? p.nickname ?? null,
        amount:      p.unit_amount,
        currency:    p.currency,
        interval:    p.recurring?.interval,          // 'month' | 'year'
        intervalCount: p.recurring?.interval_count,  // 1, 3, 6, etc.
        trialDays:   p.recurring?.trial_period_days ?? null,
      };
    })
    // Sort: monthly first, then annual
    .sort((a, b) => {
      const order = { month: 0, year: 1 } as Record<string, number>;
      return (order[a.interval ?? ""] ?? 2) - (order[b.interval ?? ""] ?? 2);
    });

  return NextResponse.json({ plans });
}
