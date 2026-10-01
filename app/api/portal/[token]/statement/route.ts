import { validatePortalToken } from "@/lib/portal";
import { db } from "@/db";
import { invoices, customers, organisations } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { buildStatementPdf, type StatementRow } from "@/lib/statement-pdf";
import { daysOverdue } from "@/lib/format";

/**
 * This used to carry its own PDF builder (pdf-lib, drawn by hand) with three
 * real bugs: the row loop "paginated" by printing "(continued on next page)"
 * and breaking — never calling doc.addPage() — so anything past ~25 rows was
 * silently dropped while the TOTAL DUE footer still summed every row; the
 * total was single-currency (invs[0]?.currency), so a second currency's
 * balance vanished into the first's; and its date helpers built `new
 * Date(dateOnlyString)`, the exact UTC-midnight-vs-local-midnight bug
 * CLAUDE.md documents as fixed elsewhere ("A date is a date") but never
 * applied here. `logoUrl` was also accepted and never drawn.
 *
 * lib/statement-pdf.ts's buildStatementPdf is the org-level "Statement of
 * Open Invoices" generator and already gets all four of these right (real
 * ensure()/newPage() pagination, per-currency fmtCcyMap totals, formatDateShort
 * for every date cell, and a real logo embed with a text-monogram fallback).
 * Delegating avoids maintaining a second, buggier implementation of the same
 * "this customer's open invoices" document.
 */
export async function GET(req: Request, { params }: { params: { token: string } }) {
  const rl = await rateLimit(`portal-stmt:${clientIp(req)}`, 10, 60);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const v = await validatePortalToken(params.token);
  if (!v.ok) return NextResponse.json({ error: "Invalid or expired link" }, { status: 410 });
  const { row } = v;

  const [org] = await db.select({ name: organisations.name, displayName: organisations.displayName, logoUrl: organisations.logoUrl, currency: organisations.currency })
    .from(organisations).where(eq(organisations.id, row.orgId)).limit(1);
  const [cust] = await db.select({ name: customers.name })
    .from(customers).where(eq(customers.id, row.customerId)).limit(1);

  const ids = (row.invoiceIds as string[]) ?? [];
  const invRows = ids.length > 0
    ? await db.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, invoiceDate: invoices.invoiceDate, dueDate: invoices.dueDate, currency: invoices.currency, total: invoices.total, paid: invoices.paid, qboBalance: invoices.qboBalance, paymentStatus: invoices.paymentStatus })
        .from(invoices).where(and(eq(invoices.orgId, row.orgId), eq(invoices.customerId, row.customerId), inArray(invoices.id, ids)))
    : [];

  // "Written Off" debt is no longer pursued — app/api/customers/[id]/statement
  // already excludes it alongside "Paid"; this route only ever excluded
  // "Paid", so a written-off balance could still print here as outstanding.
  const open = invRows.filter(i => i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off");

  if (open.length === 0) return NextResponse.json({ error: "No open invoices" }, { status: 404 });

  const orgName      = org?.displayName || org?.name || "Accounts";
  const customerName = cust?.name ?? "Customer";

  const statementRows: StatementRow[] = open.map(i => ({
    inv: {
      invoiceNumber: i.invoiceNumber || i.id.slice(0, 8),
      invoiceDate:   i.invoiceDate || "",
      dueDate:       i.dueDate || "",
      currency:      i.currency || org?.currency || "EUR",
      total:         i.total ?? 0,
    },
    custName: customerName,
    projName: null,
    bal: i.qboBalance != null ? Math.max(0, i.qboBalance) : Math.max(0, (i.total ?? 0) - (i.paid ?? 0)),
    days: daysOverdue(i.dueDate),
  }));

  const pdf = await buildStatementPdf({ orgName, rows: statementRows, logoUrl: org?.logoUrl ?? null });
  const filename = `Statement-${customerName.replace(/[^a-zA-Z0-9]/g, "-")}.pdf`;

  return new Response(pdf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
