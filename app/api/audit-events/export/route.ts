/**
 * GET /api/audit-events/export?customerId=xxx&name=Customer+Name
 * Returns a printable HTML page — user presses Ctrl+P → Save as PDF.
 */
import { db } from "@/db";
import { auditEvents, invoices } from "@/db/schema";
import { requireOrg, bad } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { and, desc, eq, or, SQL } from "drizzle-orm";
import { NextResponse } from "next/server";

const EVENT_LABELS: Record<string, string> = {
  email_sent:        "Automated Reminder Sent",
  email_manual:      "Manual Email Sent",
  note_added:        "Internal Note",
  stage_changed:     "Stage Changed",
  payment_recorded:  "Payment Recorded",
  promise_to_pay:    "Promise to Pay",
  dispute_raised:    "Dispute Raised",
  programme_toggled: "Collection Programme",
  chase_mode_changed:"Chase Mode Changed",
  invoice_synced:    "Invoice Synced (QBO)",
  contact_updated:   "Contact Updated",
  user_login:               "User Login",
  user_deactivated:         "User Deactivated",
  user_role_changed:        "User Role Changed",
  integration_connected:    "Integration Connected",
  integration_disconnected: "Integration Disconnected",
  data_exported:            "Data Exported",
};

function fmt(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function metaLines(meta: any): string {
  if (!meta || typeof meta !== "object") return "";
  const lines: string[] = [];
  if (meta.from)        lines.push(`From: ${meta.from}`);
  if (meta.to)          lines.push(`To: ${meta.to}`);
  if (meta.subject)     lines.push(`Subject: ${meta.subject}`);
  if (meta.invoiceNo)   lines.push(`Invoice: ${meta.invoiceNo}`);
  if (meta.fromStage)   lines.push(`Stage: ${meta.fromStage} → ${meta.toStage ?? "?"}`);
  if (meta.amount != null)    lines.push(`Amount: ${meta.currency ?? ""}${Number(meta.amount).toFixed(2)}`);
  if (meta.promiseDate) lines.push(`Promise date: ${meta.promiseDate}`);
  if (meta.reason)      lines.push(`Reason: ${meta.reason}`);
  if (meta.mode)        lines.push(`Mode: ${meta.mode}`);
  if (meta.enabled != null)   lines.push(`Programme: ${meta.enabled ? "Enabled" : "Disabled"}`);
  if (meta.body) {
    const excerpt = (meta.body as string).slice(0, 200).replace(/</g, "&lt;").replace(/>/g, "&gt;");
    lines.push(`<span class="note">${excerpt}${(meta.body as string).length > 200 ? "…" : ""}</span>`);
  }
  return lines.length ? `<ul>${lines.map(l => `<li>${l}</li>`).join("")}</ul>` : "";
}

export async function GET(req: Request) {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");
  const projectId  = searchParams.get("projectId");
  const name       = decodeURIComponent(searchParams.get("name") ?? "Account");

  if (!customerId && !projectId) {
    return bad("Provide customerId or projectId", 400);
  }

  // Data exports are an exfiltration vector — record who exported what.
  await logEvent({
    orgId: orgId!, eventType: "data_exported",
    customerId: customerId ?? null, projectId: projectId ?? null,
    actorId: (session!.user as any)?.id ?? null, actorName: (session!.user as any)?.name ?? null,
    meta: { kind: "audit_trail", name },
  });

  let entityFilter: SQL | undefined;
  if (projectId && customerId) {
    entityFilter = or(eq(auditEvents.projectId, projectId), eq(auditEvents.customerId, customerId));
  } else if (projectId) {
    entityFilter = eq(auditEvents.projectId, projectId);
  } else if (customerId) {
    entityFilter = eq(auditEvents.customerId, customerId);
  }

  const rows = await db
    .select({
      id: auditEvents.id,
      occurredAt: auditEvents.occurredAt,
      eventType: auditEvents.eventType,
      actorName: auditEvents.actorName,
      meta: auditEvents.meta,
      invoiceNumber: invoices.invoiceNumber,
    })
    .from(auditEvents)
    .leftJoin(invoices, eq(auditEvents.invoiceId, invoices.id))
    .where(and(eq(auditEvents.orgId, orgId!), entityFilter))
    .orderBy(desc(auditEvents.occurredAt))
    .limit(500);

  const rows_html = rows.map(r => {
    // Invoice number: prefer the joined row, fall back to meta.invoiceNo for
    // older events that were logged before invoiceId was stored.
    const invNo = r.invoiceNumber ?? (r.meta as any)?.invoiceNo ?? null;
    return `
    <tr>
      <td class="date">${fmt(r.occurredAt)}</td>
      <td class="type">${EVENT_LABELS[r.eventType] ?? r.eventType}</td>
      <td class="actor">${r.actorName ?? "System"}</td>
      <td class="inv">${invNo ? `<span class="inv-num">${invNo}</span>` : '<span class="na">—</span>'}</td>
      <td class="detail">${metaLines(r.meta)}</td>
    </tr>
  `}).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Audit Trail — ${name}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; font-size: 12px; color: #1c1917; padding: 32px 40px; }
  h1 { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
  .subtitle { font-size: 11px; color: #78716c; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; }
  thead tr { border-bottom: 2px solid #1c1917; }
  th { text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 6px 8px; color: #78716c; }
  td { padding: 8px; vertical-align: top; border-bottom: 1px solid #e7e5e4; }
  td.date { white-space: nowrap; font-size: 11px; color: #44403c; width: 150px; }
  td.type { font-weight: 600; width: 155px; }
  td.actor { width: 110px; color: #44403c; }
  td.inv { width: 100px; }
  .inv-num { font-family: monospace; font-size: 11px; font-weight: 600; color: #1c1917; }
  .na { color: #a8a29e; }
  td.detail ul { padding-left: 14px; }
  td.detail li { margin-bottom: 2px; color: #44403c; }
  .note { font-style: italic; color: #78716c; }
  .footer { margin-top: 24px; font-size: 10px; color: #a8a29e; border-top: 1px solid #e7e5e4; padding-top: 12px; }
  @media print {
    body { padding: 16px; }
    .no-print { display: none; }
    tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="no-print" style="margin-bottom:20px">
    <button onclick="window.print()" style="padding:8px 16px;background:#1c1917;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px">
      Print / Save as PDF
    </button>
  </div>
  <h1>Audit Trail — ${name}</h1>
  <p class="subtitle">Generated ${fmt(new Date())} · ${rows.length} event${rows.length !== 1 ? "s" : ""}</p>
  <table>
    <thead>
      <tr>
        <th>Date / Time</th>
        <th>Event</th>
        <th>Actor</th>
        <th>Invoice #</th>
        <th>Detail</th>
      </tr>
    </thead>
    <tbody>
      ${rows_html || '<tr><td colspan="5" style="color:#a8a29e;padding:16px 8px">No events recorded yet.</td></tr>'}
    </tbody>
  </table>
  <p class="footer">Ledger Collections CRM — Track &amp; Trace export. This document is confidential.</p>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
