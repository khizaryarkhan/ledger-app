import { requireOrg, bad } from "@/lib/api";
import { daysOverdue } from "@/lib/format";
import { db } from "@/db";
import { customers, invoices, organisations } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";
import { buildStatementPdf, type StatementRow } from "@/lib/statement-pdf";

// Headless Chromium (lib/pdf/render-html.ts) cannot run on the Edge runtime.
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [customer] = await db.select().from(customers)
    .where(and(eq(customers.id, params.id), eq(customers.orgId, orgId!))).limit(1);
  if (!customer) return bad("Customer not found", 404);

  const [org] = await db.select({ name: organisations.name, displayName: organisations.displayName, logoUrl: organisations.logoUrl })
    .from(organisations).where(eq(organisations.id, orgId!)).limit(1);

  const allInvoices = await db.select().from(invoices)
    .where(and(eq(invoices.customerId, params.id), eq(invoices.orgId, orgId!)));

  // Authoritative open balance — mirrors the dashboard openBal() helper so
  // the statement total always agrees with the AR Aging reports.
  const openBal = (i: typeof allInvoices[0]): number => {
    if (i.txnType === "CreditMemo") {
      // CMs carry a negative qboBalance (unapplied credit).
      return i.qboBalance != null ? Number(i.qboBalance) : 0;
    }
    if (i.qboBalance != null) return Math.max(0, Number(i.qboBalance));
    return Math.max(0, Number(i.total || 0) - Number(i.paid || 0));
  };

  // Open invoices + unapplied credit memos so the net total matches the AR
  // Aging report. Previously CMs were excluded, causing the statement balance
  // to overstate what the customer actually owes.
  const open = allInvoices.filter(i => {
    if (i.paymentStatus === "Paid" || i.paymentStatus === "Written Off") return false;
    if (i.txnType === "CreditMemo") return openBal(i) < -0.005; // unapplied credit
    return openBal(i) > 0.005;
  }).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  if (open.length === 0) return NextResponse.json({ error: "No outstanding invoices — account is clear" }, { status: 404 });

  const orgName = org?.displayName || org?.name || "Your Company";

  const rows: StatementRow[] = open.map(inv => {
    const isCm = inv.txnType === "CreditMemo";
    return {
      inv: {
        invoiceNumber: inv.invoiceNumber || inv.id.slice(0, 8),
        invoiceDate: inv.invoiceDate,
        dueDate: isCm ? null : inv.dueDate,
        currency: inv.currency || customer.currency || "EUR",
        total: isCm ? null : Number(inv.total || 0),
      },
      custName: customer.name,
      projName: null,
      bal: openBal(inv),
      days: daysOverdue(inv.dueDate),
      isCreditMemo: isCm,
    };
  });

  const pdf = await buildStatementPdf({ orgName, rows, logoUrl: org?.logoUrl ?? null });
  const filename = `Statement-${customer.name.replace(/[^a-zA-Z0-9]/g, "-")}.pdf`;

  return new Response(pdf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
