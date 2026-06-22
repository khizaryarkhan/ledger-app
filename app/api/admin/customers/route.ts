/**
 * Admin — customers (organisations) list with billing summary.
 *
 * GET /api/admin/customers   (platform/super admin)
 *
 * One row per organisation with its subscription state and a billing contact.
 * Lightweight (no per-org Stripe calls) — detail/Stripe data loads on the
 * customer page. MRR is derived from the synced subscription.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { organisations, subscriptions, users, userOrganisations } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requirePlatformAdmin } from "@/lib/billing";

function toMonthly(amount: number | null, interval: string | null): number {
  if (!amount) return 0;
  return interval === "year" ? Math.round(amount / 12) : amount;
}

export async function GET() {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const orgs = await db.select({ id: organisations.id, name: organisations.name }).from(organisations);

  const subs = await db.select().from(subscriptions);
  const subByOrg = new Map(subs.map(s => [s.orgId, s]));

  // One billing-contact email per org (first company_admin).
  const adminRows = await db
    .select({ orgId: userOrganisations.orgId, email: users.email })
    .from(userOrganisations)
    .innerJoin(users, eq(users.id, userOrganisations.userId))
    .where(eq(userOrganisations.role, "company_admin"));
  const emailByOrg = new Map<string, string>();
  for (const r of adminRows) if (!emailByOrg.has(r.orgId)) emailByOrg.set(r.orgId, r.email);

  const now = Date.now();
  const customers = orgs.map(o => {
    const s = subByOrg.get(o.id);
    const isActive = s
      ? (s.source === "manual"
          ? (!s.manualExpiresAt || new Date(s.manualExpiresAt).getTime() > now)
          : (s.status === "active" || s.status === "trialing"))
      : false;
    const interval = s?.planInterval ?? null;
    const renewsAt = s ? (s.source === "manual" ? s.manualExpiresAt : s.currentPeriodEnd) : null;
    return {
      orgId:        o.id,
      name:         o.name,
      email:        emailByOrg.get(o.id) ?? s?.billingEmail ?? null,
      hasSub:       !!s,
      source:       s?.source ?? null,                       // 'stripe' | 'manual' | null
      status:       s ? (isActive ? "active" : s.status) : "none",
      isActive,
      planName:     s?.planName ?? null,
      planAmount:   s?.planAmount ?? null,
      planCurrency: (s?.planCurrency ?? "gbp").toUpperCase(),
      planInterval: interval,
      billing:      interval === "year" ? "Annual" : interval === "month" ? "Monthly" : (interval ? "Custom" : "—"),
      mrr:          isActive ? toMonthly(s?.planAmount ?? null, interval) : 0,
      lastPayment:  s?.lastPaymentDate ? new Date(s.lastPaymentDate).getTime() : null,
      lastPaymentStatus: s?.lastPaymentStatus ?? s?.manualPaymentStatus ?? null,
      lastPaymentAmount: s?.lastPaymentAmount ?? null,
      renewsAt:     renewsAt ? new Date(renewsAt).getTime() : null,
    };
  });

  // Active customers first, then by name.
  customers.sort((a, b) => (Number(b.isActive) - Number(a.isActive)) || a.name.localeCompare(b.name));

  const totalMrr = customers.reduce((sum, c) => sum + c.mrr, 0);
  return NextResponse.json({
    customers,
    summary: {
      total:     customers.length,
      active:    customers.filter(c => c.isActive).length,
      totalMrr,
      currency:  customers.find(c => c.mrr > 0)?.planCurrency ?? "GBP",
    },
  });
}
