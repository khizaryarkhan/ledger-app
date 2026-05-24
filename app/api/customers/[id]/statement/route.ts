import { requireOrg, bad } from "@/lib/api";
import { db } from "@/db";
import { customers, invoices, organisations } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";

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

  const totalBalance = open.reduce((s, i) => s + openBal(i), 0);
  const currency = open[0]?.currency || customer.currency || "EUR";
  const fmt = (n: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency, minimumFractionDigits: 2 }).format(n);
  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const orgName = org?.displayName || org?.name || "Your Company";

  const rows = open.map(inv => {
    const isCm = inv.txnType === "CreditMemo";
    const balance = openBal(inv);
    const daysOv = Math.floor((Date.now() - new Date(inv.dueDate + "T12:00:00Z").getTime()) / 86400000);
    const status = isCm ? "Credit on Account"
      : daysOv > 0 ? `${daysOv} days overdue`
      : daysOv === 0 ? "Due today"
      : `Due in ${Math.abs(daysOv)} days`;
    const statusColor = isCm ? "#16a34a" : daysOv > 30 ? "#dc2626" : daysOv > 0 ? "#d97706" : "#16a34a";
    return `
      <tr${isCm ? ' style="background:#f0fdf4"' : ""}>
        <td>${inv.invoiceNumber}</td>
        <td>${fmtDate(inv.invoiceDate)}</td>
        <td>${isCm ? "—" : fmtDate(inv.dueDate)}</td>
        <td class="amount">${isCm ? "—" : fmt(inv.total)}</td>
        <td class="amount">${isCm ? "—" : fmt(inv.paid || 0)}</td>
        <td class="amount bold" style="color:${isCm ? "#16a34a" : "inherit"}">${fmt(balance)}</td>
        <td style="color:${statusColor};font-size:11px;font-weight:600">${status}</td>
      </tr>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Statement — ${customer.name}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #1c1917; background: #fff; padding: 40px; }
  @media print { body { padding: 20px; } .no-print { display: none; } }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 36px; padding-bottom: 24px; border-bottom: 2px solid #e7e5e4; }
  .org-name { font-size: 20px; font-weight: 700; color: #1c1917; }
  .statement-label { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #78716c; margin-bottom: 6px; }
  .customer-block { margin-bottom: 28px; }
  .customer-name { font-size: 16px; font-weight: 600; color: #1c1917; margin-bottom: 2px; }
  .customer-meta { font-size: 12px; color: #78716c; }
  .meta-grid { display: flex; gap: 40px; margin-bottom: 28px; }
  .meta-item label { display: block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #a8a29e; margin-bottom: 2px; }
  .meta-item span { font-size: 13px; font-weight: 500; color: #1c1917; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th { background: #f5f5f4; padding: 8px 12px; text-align: left; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #78716c; border-bottom: 1px solid #e7e5e4; }
  td { padding: 10px 12px; border-bottom: 1px solid #f5f5f4; font-size: 12px; color: #1c1917; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #fafaf9; }
  .amount { text-align: right; font-variant-numeric: tabular-nums; }
  .bold { font-weight: 600; }
  .total-row { background: #1c1917; }
  .total-row td { color: #fff; font-weight: 600; border-bottom: none; padding: 12px; }
  .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #e7e5e4; font-size: 11px; color: #a8a29e; }
  .print-btn { position: fixed; bottom: 24px; right: 24px; background: #1c1917; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
  .print-btn:hover { background: #292524; }
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="statement-label">Statement of Account</div>
    <div class="org-name">${orgName}</div>
  </div>
  <div style="text-align:right">
    <div class="statement-label">Statement date</div>
    <div style="font-size:14px;font-weight:600">${today}</div>
  </div>
</div>

<div class="customer-block">
  <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#a8a29e;margin-bottom:4px">Prepared for</div>
  <div class="customer-name">${customer.name}</div>
  ${customer.code ? `<div class="customer-meta">Account: ${customer.code}</div>` : ""}
  ${customer.email ? `<div class="customer-meta">${customer.email}</div>` : ""}
</div>

<div class="meta-grid">
  <div class="meta-item"><label>Open invoices</label><span>${open.length}</span></div>
  <div class="meta-item"><label>Total outstanding</label><span style="color:#dc2626;font-size:16px;font-weight:700">${fmt(totalBalance)}</span></div>
</div>

${open.length === 0 ? '<p style="color:#78716c;padding:24px 0">No outstanding invoices — account is clear.</p>' : `
<table>
  <thead>
    <tr>
      <th>Invoice #</th>
      <th>Invoice Date</th>
      <th>Due Date</th>
      <th style="text-align:right">Amount</th>
      <th style="text-align:right">Paid</th>
      <th style="text-align:right">Balance</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
  <tfoot>
    <tr class="total-row">
      <td colspan="5">Total Outstanding</td>
      <td class="amount bold">${fmt(totalBalance)}</td>
      <td></td>
    </tr>
  </tfoot>
</table>`}

<div class="footer">
  <p>This statement was generated on ${today}. Please contact us if you have any queries regarding your account.</p>
</div>

<button class="print-btn no-print" onclick="window.print()">Print / Save as PDF</button>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
