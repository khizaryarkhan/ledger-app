import { db } from "@/db";
import { organisations, customers, invoices } from "@/db/schema";
import { validatePortalToken } from "@/lib/portal";
import { customerPortalTokens } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * GET /api/portal/[token]
 * Public, token-authenticated. Returns org branding, customer name, and the
 * open invoices covered by this request. No login required.
 */
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const v = await validatePortalToken(params.token);
  if (!v.ok) {
    const reason = "reason" in v ? v.reason : "error";
    return NextResponse.json({ error: reason }, { status: 410 }); // 410 Gone — expired/used
  }
  const { row } = v;

  // Touch last-viewed (fire-and-forget — don't block the response on it)
  await db.update(customerPortalTokens)
    .set({ lastViewedAt: new Date() })
    .where(eq(customerPortalTokens.id, row.id))
    .catch(() => {});

  const [org] = await db
    .select({ name: organisations.name, displayName: organisations.displayName, logoUrl: organisations.logoUrl, currency: organisations.currency })
    .from(organisations).where(eq(organisations.id, row.orgId)).limit(1);

  const [cust] = await db
    .select({ name: customers.name })
    .from(customers).where(eq(customers.id, row.customerId)).limit(1);

  const ids = (row.invoiceIds as string[]) ?? [];
  let invList: any[] = [];
  if (ids.length > 0) {
    const rows = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        invoiceDate: invoices.invoiceDate,
        dueDate: invoices.dueDate,
        currency: invoices.currency,
        total: invoices.total,
        paid: invoices.paid,
        qboBalance: invoices.qboBalance,
        paymentStatus: invoices.paymentStatus,
        hasOpenDispute: invoices.hasOpenDispute,
        promiseDate: invoices.promiseDate,
      })
      .from(invoices)
      .where(and(
        eq(invoices.orgId, row.orgId),
        eq(invoices.customerId, row.customerId),
        inArray(invoices.id, ids),
      ));

    // Only show still-open invoices; compute the open balance
    invList = rows
      .filter(i => i.paymentStatus !== "Paid")
      .map(i => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        invoiceDate: i.invoiceDate,
        dueDate: i.dueDate,
        currency: i.currency || org?.currency || "EUR",
        balance: i.qboBalance != null ? Math.max(0, i.qboBalance) : Math.max(0, (i.total ?? 0) - (i.paid ?? 0)),
        alreadyDisputed: i.hasOpenDispute,
        existingPromise: i.promiseDate,
      }));
  }

  return NextResponse.json({
    org: { name: org?.displayName || org?.name || "Accounts Receivable", logoUrl: org?.logoUrl ?? null },
    customer: { name: cust?.name ?? "Customer" },
    invoices: invList,
  });
}
