import { db } from "@/db";
import { organisations, customers, invoices } from "@/db/schema";
import { validatePortalToken } from "@/lib/portal";
import { customerPortalTokens } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { fetchQboInvoiceLink } from "@/lib/qbo-token";

/** Give the whole pay-link lookup this long, then render without buttons. */
const PAY_LINK_BUDGET_MS = 4000;

// Headroom so a slow QuickBooks can't take the page down with it.
export const maxDuration = 30;

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

    const open = rows.filter(i => i.paymentStatus !== "Paid");

    // QBO's own "Review and pay" link per invoice, so the customer can pay
    // right here instead of only being able to promise a date. Resolved in
    // parallel and never fatal — a null just hides that row's Pay button.
    // Capped because this is a public endpoint: a token covering a huge set
    // of invoices shouldn't fan out into unbounded QBO calls.
    const payables = open.filter(i => i.qboId && !i.qboId.startsWith("CM-") && !(i.xeroId && !i.xeroId.startsWith("CN-"))).slice(0, 20);
    // Hard overall budget. This is a PUBLIC page a customer's own customers
    // land on from an email, and it must never fail because a third party is
    // slow: each lookup can take seconds, and enough of them together can blow
    // the function's own time limit — which surfaces as "Something went wrong"
    // with no way for them to respond at all. Losing the Pay buttons is a
    // disappointment; losing the page is an outage.
    const payUrls = await Promise.race([
      Promise.all(payables.map(async i => [
        i.id,
        await fetchQboInvoiceLink(row.orgId, { qboId: i.qboId, invoiceNumber: i.invoiceNumber }).catch(() => null),
      ] as const)).then(pairs => new Map<string, string | null>(pairs)),
      new Promise<Map<string, string | null>>(resolve => setTimeout(() => resolve(new Map()), PAY_LINK_BUDGET_MS)),
    ]).catch(() => new Map<string, string | null>());

    invList = open
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
        payUrl: payUrls.get(i.id) ?? null,
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
