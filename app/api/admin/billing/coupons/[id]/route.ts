/**
 * Admin — act on a coupon.
 *
 * POST /api/admin/billing/coupons/:id
 *   { action: "delete" }                        → delete the coupon
 *   { action: "add_code", code }                → add a promotion code to it
 *   { action: "toggle_code", codeId, active }   → activate/deactivate a promo code
 */

import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { requirePlatformAdmin } from "@/lib/billing";

export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const action = body?.action as string;

  try {
    if (action === "delete") {
      await stripe.coupons.del(params.id);
      return NextResponse.json({ ok: true });
    }
    if (action === "add_code") {
      const code = String(body?.code || "").trim().toUpperCase();
      if (!code) return NextResponse.json({ error: "Code is required" }, { status: 400 });
      const promo = await stripe.promotionCodes.create({ coupon: params.id, code } as any);
      return NextResponse.json({ ok: true, code: promo.code, id: promo.id });
    }
    if (action === "toggle_code") {
      const codeId = String(body?.codeId || "");
      if (!codeId) return NextResponse.json({ error: "codeId is required" }, { status: 400 });
      await stripe.promotionCodes.update(codeId, { active: body?.active === true });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Stripe error" }, { status: 502 });
  }
}
