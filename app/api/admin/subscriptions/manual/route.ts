import { NextResponse } from "next/server";
import { db } from "@/db";
import { subscriptions, organisations } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/billing";
import { eq } from "drizzle-orm";
import { z } from "zod";

const schema = z.object({
  orgId:         z.string().uuid(),
  planName:      z.string().min(1).max(128),
  amount:        z.number().int().min(0).optional(),
  currency:      z.string().min(2).max(4).optional(),
  interval:      z.enum(["month", "year", "custom"]).optional(),
  expiresAt:     z.string().datetime().nullable().optional(),
  paymentStatus: z.enum(["paid", "pending", "overdue", "waived"]).default("paid"),
  invoiceRef:    z.string().max(128).optional(),
  notes:         z.string().max(1000).optional(),
  billingEmail:  z.string().email().optional(),
});

export async function POST(req: Request) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const { orgId, planName, amount, currency, interval, expiresAt, paymentStatus, invoiceRef, notes, billingEmail } = parsed.data;

  const [org] = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(eq(organisations.id, orgId))
    .limit(1);

  if (!org) return NextResponse.json({ error: "Organisation not found" }, { status: 404 });

  const patch = {
    source:              "manual" as const,
    status:              "active",
    planName,
    planAmount:          amount ?? null,
    planCurrency:        currency ? currency.toLowerCase() : null,
    planInterval:        interval ?? null,
    manualExpiresAt:     expiresAt ? new Date(expiresAt) : null,
    manualPaymentStatus: paymentStatus,
    manualInvoiceRef:    invoiceRef ?? null,
    manualNotes:         notes ?? null,
    billingEmail:        billingEmail ?? null,
    managedByAdminId:    userId,
    managedAt:           new Date(),
  };

  const [existing] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.orgId, orgId))
    .limit(1);

  let subId: string;
  if (existing) {
    await db.update(subscriptions).set(patch).where(eq(subscriptions.id, existing.id));
    subId = existing.id;
  } else {
    const [created] = await db
      .insert(subscriptions)
      .values({ orgId, stripeCustomerId: null, ...patch })
      .returning({ id: subscriptions.id });
    subId = created.id;
  }

  return NextResponse.json({ id: subId, ok: true });
}
