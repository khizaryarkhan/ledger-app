import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { crmAccounts, landingPageRequests, organisations, subscriptions, users } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { formatAccountRef } from "@/lib/admin/accounts";
import { billingBucket, isPaymentFailed } from "@/lib/admin/billing-state";

function schemaMissing(e: unknown) {
  return ((e as any)?.message ?? "").toLowerCase().includes("does not exist");
}

// GET — the Accounts ACTION QUEUE (not a directory). Every company lives in one
// place by state: selling → Pipeline, billed → Customers, and here only the ones
// that need a billing action:
//   • won_unbilled  — a Won deal with no invoice/subscription yet → create one
//   • payment_failed — a billed customer whose auto-payment failed → fix it
export async function GET() {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  try {
    const accounts = await db.select({
      id: crmAccounts.id, refSeq: crmAccounts.refSeq, name: crmAccounts.name,
      billingEmail: crmAccounts.billingEmail, organisationId: crmAccounts.organisationId,
      ownerAdminId: crmAccounts.ownerAdminId, lifecycleStage: crmAccounts.lifecycleStage,
      firstInvoicedAt: crmAccounts.firstInvoicedAt,
    }).from(crmAccounts).orderBy(desc(crmAccounts.updatedAt));
    if (accounts.length === 0) return NextResponse.json({ wonUnbilled: [], paymentFailed: [] });

    // Most-recent lead per account (for stage + deal value).
    const leadRows = await db.select({
      accountId: landingPageRequests.accountId, id: landingPageRequests.id, status: landingPageRequests.status,
      fullName: landingPageRequests.fullName, email: landingPageRequests.email,
      value: landingPageRequests.value, dealCurrency: landingPageRequests.dealCurrency,
    }).from(landingPageRequests).orderBy(desc(landingPageRequests.createdAt));
    const leadByAccount = new Map<string, any>();
    for (const l of leadRows) if (l.accountId && !leadByAccount.has(l.accountId)) leadByAccount.set(l.accountId, l);

    // Org + subscription per linked org.
    const orgRows = await db.select({
      id: organisations.id, status: organisations.status,
      subId: subscriptions.id, subStatus: subscriptions.status,
      lastPaymentStatus: subscriptions.lastPaymentStatus, planName: subscriptions.planName,
      planAmount: subscriptions.planAmount, planCurrency: subscriptions.planCurrency, planInterval: subscriptions.planInterval,
    }).from(organisations).leftJoin(subscriptions, eq(subscriptions.orgId, organisations.id)).orderBy(desc(subscriptions.createdAt));
    const orgById = new Map<string, any>();
    for (const o of orgRows) if (!orgById.has(o.id)) orgById.set(o.id, o);

    const adminRows = await db.select({ id: users.id, name: users.name, email: users.email })
      .from(users).where(inArray(users.role, ["super_admin", "platform_admin"]));
    const nameOf = new Map(adminRows.map(u => [u.id, u.name || u.email]));

    const wonUnbilled: any[] = [];
    const paymentFailed: any[] = [];

    for (const a of accounts) {
      const org = a.organisationId ? orgById.get(a.organisationId) : null;
      const lead = leadByAccount.get(a.id);
      const paymentFail = org ? isPaymentFailed(org.subStatus, org.lastPaymentStatus) : false;
      const bucket = billingBucket({
        leadStatus: lead?.status, lifecycleStage: a.lifecycleStage,
        firstInvoicedAt: a.firstInvoicedAt, hasSubscription: !!org?.subId, paymentFailed: paymentFail,
      });
      const base = {
        accountId: a.id, ref: formatAccountRef(a.refSeq), name: a.name,
        email: a.billingEmail || lead?.email || null, organisationId: a.organisationId,
        owner: a.ownerAdminId ? (nameOf.get(a.ownerAdminId) ?? null) : null,
      };
      if (bucket === "won_unbilled") {
        wonUnbilled.push({ ...base, leadId: lead?.id ?? null, value: lead?.value ?? null, currency: lead?.dealCurrency ?? "USD" });
      } else if (bucket === "payment_failed") {
        paymentFailed.push({ ...base, planName: org?.planName ?? null, subStatus: org?.subStatus ?? null, lastPaymentStatus: org?.lastPaymentStatus ?? null });
      }
    }

    return NextResponse.json({ wonUnbilled, paymentFailed, admins: adminRows });
  } catch (e) {
    if (schemaMissing(e)) return NextResponse.json({ wonUnbilled: [], paymentFailed: [], needsSetup: true });
    throw e;
  }
}
