import { db } from "@/db";
import { organisations, customers, invoices } from "@/db/schema";
import { validatePortalToken } from "@/lib/portal";
import { customerPortalTokens } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rate-limit";

/**
 * GET /api/portal/[token]
 * Public, token-authenticated. Returns org branding, customer name, open invoices
 * covered by this request, and (if org enabled) the full paid invoice history.
 */
export async function GET(req: Request, { params }: { params: { token: string } }) {
  const rl = await rateLimit(`portal-get:${clientIp(req)}`, 60, 60);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const v = await validatePortalToken(params.token);
  if (!v.ok) {
    const reason = "reason" in v ? v.reason : "error";
    return NextResponse.json({ error: reason }, { status: 410 });
  }
  const { row } = v;

  // Touch last-viewed (fire-and-forget)
  await db.update(customerPortalTokens)
    .set({ lastViewedAt: new Date() })
    .where(eq(customerPortalTokens.id, row.id))
    .catch(() => {});

  const [org] = await db
    .select({
      name: organisations.name,
      displayName: organisations.displayName,
      logoUrl: organisations.logoUrl,
      currency: organisations.currency,
      showPaymentHistory: organisations.showPaymentHistory,
    })
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
        qboId: invoices.qboId,
        xeroId: invoices.xeroId,
      })
      .from(invoices)
      .where(and(
        eq(invoices.orgId, row.orgId),
        eq(invoices.customerId, row.customerId),
        inArray(invoices.id, ids),
      ));

    invList = rows
      .filter(i => i.paymentStatus !== "Paid")
      .map(i => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        invoiceDate: i.invoiceDate,
        dueDate: i.dueDate,
        currency: i.currency || org?.currency || "EUR",
        balance: i.qboBalance != null ? Math.max(0, i.qboBalance) : Math.max(0, (i.total ?? 0) - (i.paid ?? 0)),
        total: i.total ?? 0,
        alreadyDisputed: i.hasOpenDispute,
        existingPromise: i.promiseDate,
        hasPdf: !!(i.qboId && !i.qboId.startsWith("CM-")) || !!(i.xeroId && !i.xeroId.startsWith("CN-")),
      }));
  }

  // Payment history — all paid invoices for this customer (only if org opted in)
  let paymentHistory: any[] = [];
  if (org?.showPaymentHistory) {
    const paidRows = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        invoiceDate: invoices.invoiceDate,
        dueDate: invoices.dueDate,
        currency: invoices.currency,
        total: invoices.total,
        paid: invoices.paid,
      })
      .from(invoices)
      .where(and(
        eq(invoices.orgId, row.orgId),
        eq(invoices.customerId, row.customerId),
        eq(invoices.paymentStatus, "Paid"),
      ));

    paymentHistory = paidRows.map(i => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      invoiceDate: i.invoiceDate,
      dueDate: i.dueDate,
      currency: i.currency || org?.currency || "EUR",
      total: i.total ?? 0,
      paid: i.paid ?? 0,
    }));
  }

  return NextResponse.json({
    org: {
      name: org?.displayName || org?.name || "Accounts Receivable",
      logoUrl: org?.logoUrl ?? null,
      showPaymentHistory: org?.showPaymentHistory ?? false,
    },
    customer: { name: cust?.name ?? "Customer" },
    invoices: invList,
    paymentHistory,
  });
}
