import { NextResponse } from "next/server";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/billing";
import { eq } from "drizzle-orm";
import { z } from "zod";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("extend"),
    days:   z.number().int().min(1).max(365),
  }),
  z.object({
    action:        z.literal("update"),
    planName:      z.string().max(128).optional(),
    amount:        z.number().int().min(0).optional(),
    currency:      z.string().max(4).optional(),
    interval:      z.enum(["month", "year", "custom"]).optional(),
    expiresAt:     z.string().datetime().nullable().optional(),
    paymentStatus: z.enum(["paid", "pending", "overdue", "waived"]).optional(),
    invoiceRef:    z.string().max(128).optional(),
    notes:         z.string().max(1000).optional(),
    billingEmail:  z.string().email().optional(),
  }),
  z.object({ action: z.literal("mark_paid") }),
  z.object({ action: z.literal("mark_overdue") }),
  z.object({ action: z.literal("suspend") }),
  z.object({ action: z.literal("reactivate") }),
]);

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const [sub] = await db
    .select({ id: subscriptions.id, source: subscriptions.source, manualExpiresAt: subscriptions.manualExpiresAt })
    .from(subscriptions)
    .where(eq(subscriptions.id, params.id))
    .limit(1);

  if (!sub) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (sub.source !== "manual") {
    return NextResponse.json({ error: "Only manual subscriptions can be modified here" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const now = new Date();
  const patch: Record<string, any> = { managedByAdminId: userId, managedAt: now };

  switch (parsed.data.action) {
    case "extend": {
      const base = sub.manualExpiresAt && sub.manualExpiresAt > now ? sub.manualExpiresAt : now;
      patch.manualExpiresAt = new Date(base.getTime() + parsed.data.days * 86_400_000);
      patch.status = "active";
      break;
    }
    case "mark_paid":
      patch.manualPaymentStatus = "paid";
      break;
    case "mark_overdue":
      patch.manualPaymentStatus = "overdue";
      break;
    case "suspend":
      patch.manualExpiresAt = now;
      patch.status = "canceled";
      break;
    case "reactivate":
      patch.manualExpiresAt = null;
      patch.status = "active";
      break;
    case "update": {
      const d = parsed.data;
      if (d.planName)               patch.planName           = d.planName;
      if (d.amount != null)         patch.planAmount         = d.amount;
      if (d.currency)               patch.planCurrency       = d.currency.toLowerCase();
      if (d.interval)               patch.planInterval       = d.interval;
      if ("expiresAt" in d)         patch.manualExpiresAt    = d.expiresAt ? new Date(d.expiresAt) : null;
      if (d.paymentStatus)          patch.manualPaymentStatus = d.paymentStatus;
      if (d.invoiceRef !== undefined) patch.manualInvoiceRef = d.invoiceRef;
      if (d.notes !== undefined)    patch.manualNotes        = d.notes;
      if (d.billingEmail)           patch.billingEmail       = d.billingEmail;
      break;
    }
  }

  await db.update(subscriptions).set(patch).where(eq(subscriptions.id, params.id));
  return NextResponse.json({ ok: true });
}
