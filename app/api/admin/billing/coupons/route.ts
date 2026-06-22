/**
 * Admin — Stripe coupons & promotion (discount) codes.
 *
 * GET  /api/admin/billing/coupons   → list coupons, each with its promo codes
 * POST /api/admin/billing/coupons   → create a coupon (+ optional promo code)
 *
 * Coupon = the discount rule (e.g. 20% off, 3 months). Promotion code = the
 * customer-facing code (e.g. LAUNCH20) that applies a coupon. Stripe is the
 * source of truth.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { stripe } from "@/lib/stripe";
import { requirePlatformAdmin } from "@/lib/billing";

export const maxDuration = 60;

export async function GET() {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  try {
    const [coupons, promos] = await Promise.all([
      stripe.coupons.list({ limit: 100 }),
      stripe.promotionCodes.list({ limit: 100 }),
    ]);
    const codesByCoupon = new Map<string, any[]>();
    for (const p of promos.data) {
      const pc = (p as any).coupon;
      const cid = typeof pc === "string" ? pc : pc?.id;
      if (!cid) continue;
      const arr = codesByCoupon.get(cid) ?? [];
      arr.push({ id: p.id, code: p.code, active: p.active, timesRedeemed: p.times_redeemed, maxRedemptions: p.max_redemptions });
      codesByCoupon.set(cid, arr);
    }
    const out = coupons.data.map((c: any) => ({
      id: c.id, name: c.name ?? c.id,
      percentOff: c.percent_off ?? null,
      amountOff: c.amount_off ?? null,
      currency: (c.currency ?? "").toUpperCase() || null,
      duration: c.duration,                       // once | repeating | forever
      durationInMonths: c.duration_in_months ?? null,
      timesRedeemed: c.times_redeemed, maxRedemptions: c.max_redemptions ?? null,
      valid: c.valid, created: c.created ? c.created * 1000 : null,
      promotionCodes: codesByCoupon.get(c.id) ?? [],
    }));
    return NextResponse.json({ coupons: out });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to load coupons" }, { status: 502 });
  }
}

const schema = z.object({
  name:             z.string().min(1).max(120),
  type:             z.enum(["percent", "amount"]),
  value:            z.number().positive(),         // percent (1-100) or amount in smallest unit
  currency:         z.string().min(3).max(4).optional(),
  duration:         z.enum(["once", "repeating", "forever"]),
  durationInMonths: z.number().int().positive().optional(),
  promoCode:        z.string().trim().max(40).optional(),
  maxRedemptions:   z.number().int().positive().optional(),
});

export async function POST(req: Request) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  const d = parsed.data;

  if (d.type === "percent" && (d.value <= 0 || d.value > 100)) {
    return NextResponse.json({ error: "Percentage must be 1–100" }, { status: 400 });
  }
  if (d.type === "amount" && !d.currency) {
    return NextResponse.json({ error: "Currency is required for an amount discount" }, { status: 400 });
  }
  if (d.duration === "repeating" && !d.durationInMonths) {
    return NextResponse.json({ error: "Number of months is required for a repeating discount" }, { status: 400 });
  }

  try {
    const coupon = await stripe.coupons.create({
      name:     d.name,
      duration: d.duration,
      ...(d.duration === "repeating" ? { duration_in_months: d.durationInMonths } : {}),
      ...(d.type === "percent"
        ? { percent_off: d.value }
        : { amount_off: Math.round(d.value), currency: d.currency!.toLowerCase() }),
      ...(d.maxRedemptions ? { max_redemptions: d.maxRedemptions } : {}),
    });

    let promo: any = null;
    if (d.promoCode) {
      promo = await stripe.promotionCodes.create({ coupon: coupon.id, code: d.promoCode.toUpperCase() } as any);
    }
    return NextResponse.json({ ok: true, couponId: coupon.id, promotionCode: promo?.code ?? null });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to create coupon" }, { status: 502 });
  }
}
