/**
 * POST /api/board/notify-owners
 *
 * Sends each owner of escalated invoices ONE digest email containing:
 *   - an action table (Invoice / Customer / Project / Outstanding / Overdue /
 *     Status / Last chased / Last comment)
 *   - the invoice PDFs attached (so owners can forward them to their contact)
 *   - optionally a personal owner-portal link where they can comment on each
 *     line item without logging in
 *
 * Body: {
 *   invoiceIds:    string[]   // escalated invoices to include
 *   includePortal: boolean    // append the owner portal link
 *   message?:      string     // optional intro paragraph from the sender
 * }
 *
 * Every send is logged as an Outbound Email communication on each included
 * invoice, so the activity feed shows exactly when the owner was notified.
 */

import { db } from "@/db";
import { invoices, customers, projects, communications } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, inArray, desc } from "drizzle-orm";
import { z } from "zod";
import { sendEmail } from "@/lib/mailer";
import { createOwnerPortalToken } from "@/lib/portal";
import { fetchQboInvoicePdf } from "@/lib/qbo-token";
import { getOrgXeroToken } from "@/lib/xero-token";

// PDF fetching + per-owner sends are sequential and can take minutes for
// large batches — raise the function timeout above Vercel's default.
export const maxDuration = 300;

const XERO_API = "https://api.xero.com/api.xro/2.0";
// Attachment budget per email. Providers reject ~25MB; 18MB leaves headroom
// for MIME base64 overhead (~33%). QBO invoice PDFs are typically <100KB,
// so even 100+ invoices fit comfortably.
const MAX_ATTACH_BYTES = 18 * 1024 * 1024;

const Schema = z.object({
  invoiceIds:    z.array(z.string().uuid()).min(1).max(200),
  includePortal: z.boolean().default(true),
  message:       z.string().max(2000).optional(),
});

const esc = (s: any) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const money = (n: number, ccy: string) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: ccy || "EUR" }).format(n);

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await req.json());
  } catch (e: any) {
    return bad(e?.issues?.[0]?.message ?? "Invalid request");
  }

  const actorId   = (session?.user as any)?.id   ?? null;
  const actorName = (session?.user as any)?.name ?? "Accounts";

  // ── Load escalated invoices with an owner email, org-scoped ──────────────
  const rows = await db
    .select({
      inv:      invoices,
      custName: customers.name,
      projName: projects.name,
    })
    .from(invoices)
    .leftJoin(customers, eq(customers.id, invoices.customerId))
    .leftJoin(projects, eq(projects.id, invoices.projectId))
    .where(and(eq(invoices.orgId, orgId!), inArray(invoices.id, body.invoiceIds)));

  const escalated = rows.filter(r =>
    r.inv.collectionStage === "Escalated" && r.inv.escalatedToEmail
  );
  if (escalated.length === 0) {
    return bad("None of the selected invoices are escalated with an assigned owner", 400);
  }

  // ── Latest comment per invoice (for the action table) ────────────────────
  const invIds = escalated.map(r => r.inv.id);
  const comms = await db
    .select()
    .from(communications)
    .where(and(eq(communications.orgId, orgId!), inArray(communications.invoiceId, invIds)))
    .orderBy(desc(communications.sentAt));
  const COMMENT_CHANNELS = new Set(["Note", "Portal", "Dispute", "Promise", "Chase"]);
  const lastComment = new Map<string, any>();
  const lastChase = new Map<string, string>();
  for (const c of comms) {
    if (!c.invoiceId) continue;
    if (!lastComment.has(c.invoiceId) && COMMENT_CHANNELS.has(c.channel) && c.body) {
      lastComment.set(c.invoiceId, c);
    }
    if (!lastChase.has(c.invoiceId) && c.direction === "Outbound" && (c.channel === "Email" || c.channel === "Chase")) {
      lastChase.set(c.invoiceId, new Date(c.sentAt).toISOString().slice(0, 10));
    }
  }

  // ── Group by owner ────────────────────────────────────────────────────────
  const byOwner = new Map<string, { name: string; userId: string | null; items: typeof escalated }>();
  for (const r of escalated) {
    const email = r.inv.escalatedToEmail!.toLowerCase();
    if (!byOwner.has(email)) {
      byOwner.set(email, { name: r.inv.escalatedToName ?? email, userId: r.inv.escalatedToUserId ?? null, items: [] as any });
    }
    byOwner.get(email)!.items.push(r);
  }

  // ── Provider-aware PDF fetch (same pattern as download-pdfs) ─────────────
  const needsXero = escalated.some(r => r.inv.xeroId && !r.inv.xeroId.startsWith("CN-"));
  let xeroToken: Awaited<ReturnType<typeof getOrgXeroToken>> | null = null;
  if (needsXero) {
    try { xeroToken = await getOrgXeroToken(orgId!); } catch { xeroToken = null; }
  }
  async function fetchPdf(inv: any): Promise<Buffer | null> {
    if (inv.xeroId && !inv.xeroId.startsWith("CN-")) {
      if (!xeroToken) return null;
      try {
        const res = await fetch(`${XERO_API}/Invoices/${inv.xeroId}`, {
          headers: { Authorization: `Bearer ${xeroToken.accessToken}`, "Xero-Tenant-Id": xeroToken.tenantId, Accept: "application/pdf" },
        });
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        return buf.byteLength > 0 ? buf : null;
      } catch { return null; }
    }
    return await fetchQboInvoicePdf(orgId!, { qboId: inv.qboId, invoiceNumber: inv.invoiceNumber });
  }

  const openBal = (inv: any) =>
    inv.qboBalance != null ? Number(inv.qboBalance)
    : inv.xeroBalance != null ? Math.max(0, Number(inv.xeroBalance))
    : Math.max(0, Number(inv.total || 0) - Number(inv.paid || 0));

  const daysOverdue = (due: string) =>
    Math.max(0, Math.floor((Date.now() - new Date(due).getTime()) / 86400000));

  // ── Send one digest per owner ─────────────────────────────────────────────
  const results: { owner: string; email: string; invoices: number; sent: boolean; error?: string }[] = [];

  for (const [email, group] of byOwner) {
    try {
      // Portal link (optional)
      let portalUrl: string | null = null;
      if (body.includePortal) {
        const tk = await createOwnerPortalToken(
          orgId!,
          { userId: group.userId, name: group.name, email },
          group.items.map(r => r.inv.id),
          actorId,
        );
        portalUrl = tk.url;
      }

      // ── Group Customer → Project, both sorted by outstanding desc, so the
      //    owner sees at a glance which customer (and which project inside it)
      //    to chase first — no mental math needed.
      const totalOut: Record<string, number> = {};
      type ProjGroup = { name: string; total: number; ccy: string; items: typeof group.items };
      type CustGroup = { name: string; total: number; ccy: string; projects: Map<string, ProjGroup> };
      const custMap = new Map<string, CustGroup>();
      for (const r of group.items) {
        const bal = openBal(r.inv);
        const ccy = r.inv.currency || "EUR";
        totalOut[ccy] = (totalOut[ccy] ?? 0) + bal;
        const cKey = r.custName ?? "—";
        if (!custMap.has(cKey)) custMap.set(cKey, { name: cKey, total: 0, ccy, projects: new Map() });
        const cg = custMap.get(cKey)!;
        cg.total += bal;
        const pKey = r.projName ?? "";
        if (!cg.projects.has(pKey)) cg.projects.set(pKey, { name: r.projName ?? "No project", total: 0, ccy, items: [] as any });
        const pg = cg.projects.get(pKey)!;
        pg.total += bal;
        pg.items.push(r);
      }
      const custGroups = [...custMap.values()].sort((a, b) => b.total - a.total);

      const NCOLS = 7;
      let tableRows = "";
      for (const cg of custGroups) {
        const nInv = [...cg.projects.values()].reduce((s, p) => s + p.items.length, 0);
        tableRows += `<tr>
          <td colspan="${NCOLS}" style="padding:9px 10px;background:#292524;color:#ffffff;font-weight:700;font-size:13px;">
            ${esc(cg.name)}
            <span style="float:right;">${money(cg.total, cg.ccy)} · ${nInv} invoice${nInv !== 1 ? "s" : ""}</span>
          </td>
        </tr>`;
        const projGroups = [...cg.projects.values()].sort((a, b) => b.total - a.total);
        for (const pg of projGroups) {
          if (pg.name !== "No project" || projGroups.length > 1) {
            tableRows += `<tr>
              <td colspan="${NCOLS}" style="padding:6px 10px 6px 22px;background:#f5f5f4;color:#44403c;font-weight:600;font-size:12px;border-bottom:1px solid #e7e5e4;">
                ${esc(pg.name)}
                <span style="float:right;">${money(pg.total, pg.ccy)}</span>
              </td>
            </tr>`;
          }
          const items = [...pg.items].sort((a, b) => openBal(b.inv) - openBal(a.inv));
          for (const r of items) {
            const bal = openBal(r.inv);
            const ccy = r.inv.currency || "EUR";
            const cm = lastComment.get(r.inv.id);
            const status = r.inv.hasOpenDispute
              ? `Disputed${r.inv.disputeReason ? ": " + esc(r.inv.disputeReason) : ""}`
              : r.inv.promiseDate ? `Committed ${esc(r.inv.promiseDate)}` : "No response";
            const escInfo = r.inv.escalationType
              ? `<span style="font-weight:600;color:#be123c;">${esc(r.inv.escalationType)}</span>${r.inv.escalationNote ? `<br/><span style="color:#57534e;font-size:11px;font-style:italic;">${esc(String(r.inv.escalationNote).slice(0, 200))}</span>` : ""}`
              : "—";
            tableRows += `<tr>
              <td style="padding:7px 10px 7px 34px;border-bottom:1px solid #e7e5e4;font-family:monospace;">#${esc(r.inv.invoiceNumber)}</td>
              <td style="padding:7px 10px;border-bottom:1px solid #e7e5e4;font-size:12px;">${escInfo}</td>
              <td style="padding:7px 10px;border-bottom:1px solid #e7e5e4;text-align:right;font-weight:600;white-space:nowrap;">${money(bal, ccy)}</td>
              <td style="padding:7px 10px;border-bottom:1px solid #e7e5e4;text-align:right;color:${daysOverdue(r.inv.dueDate) > 60 ? "#dc2626" : "#a16207"};">${daysOverdue(r.inv.dueDate)}d</td>
              <td style="padding:7px 10px;border-bottom:1px solid #e7e5e4;">${status}</td>
              <td style="padding:7px 10px;border-bottom:1px solid #e7e5e4;white-space:nowrap;">${lastChase.get(r.inv.id) ?? "Never"}</td>
              <td style="padding:7px 10px;border-bottom:1px solid #e7e5e4;color:#57534e;font-size:12px;">${cm ? esc(String(cm.body).slice(0, 160)) : "—"}</td>
            </tr>`;
          }
        }
      }

      const totalStr = Object.entries(totalOut).map(([c, v]) => money(v, c)).join(" · ");

      const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1917;max-width:860px;">
  <p>Hi ${esc(group.name.split(" ")[0])},</p>
  <p>The following <strong>${group.items.length} invoice${group.items.length !== 1 ? "s" : ""}</strong> (${totalStr} outstanding) ${group.items.length !== 1 ? "have" : "has"} been escalated to you. The invoice PDFs are attached so you can share them directly with your contact.</p>
  <p style="color:#57534e;font-size:13px;">Grouped by customer, then project — largest balances first, so start from the top.</p>
  ${body.message ? `<p style="background:#fef9c3;border-left:3px solid #eab308;padding:8px 12px;">${esc(body.message)}</p>` : ""}
  <table style="border-collapse:collapse;width:100%;font-size:13px;margin:16px 0;">
    <thead>
      <tr style="background:#e7e5e4;text-align:left;">
        <th style="padding:8px 10px;">Invoice</th>
        <th style="padding:8px 10px;">Reason</th>
        <th style="padding:8px 10px;text-align:right;">Outstanding</th>
        <th style="padding:8px 10px;text-align:right;">Overdue</th>
        <th style="padding:8px 10px;">Status</th>
        <th style="padding:8px 10px;">Last chased</th>
        <th style="padding:8px 10px;">Latest note</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  <p><strong>Action needed:</strong> please review each invoice and share an update on every line item${portalUrl ? " using your portal below" : " by replying to this email"}.</p>
  ${portalUrl ? `
  <p style="margin:22px 0;">
    <a href="${portalUrl}" style="background:#059669;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:600;display:inline-block;">Open your escalation portal →</a>
  </p>
  <p style="color:#78716c;font-size:12px;">No login needed — the portal lists your escalated invoices and lets you comment on each one. Your updates appear instantly in our collections system.</p>
  ` : ""}
  <p style="color:#78716c;font-size:12px;">Sent by ${esc(actorName)} via the collections board.</p>
</div>`;

      // PDFs — attach everything within the size budget (never silently drop).
      const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
      const skippedPdfs: string[] = []; // over budget
      const missingPdfs: string[] = []; // provider had no PDF
      let attachedBytes = 0;
      for (let i = 0; i < group.items.length; i += 5) {
        const chunk = group.items.slice(i, i + 5);
        const bufs = await Promise.all(chunk.map(async r => ({ r, pdf: await fetchPdf(r.inv) })));
        for (const { r, pdf } of bufs) {
          if (!pdf) { missingPdfs.push(`#${r.inv.invoiceNumber}`); continue; }
          if (attachedBytes + pdf.byteLength > MAX_ATTACH_BYTES) { skippedPdfs.push(`#${r.inv.invoiceNumber}`); continue; }
          attachedBytes += pdf.byteLength;
          attachments.push({ filename: `Invoice-${r.inv.invoiceNumber}.pdf`, content: pdf, contentType: "application/pdf" });
        }
      }

      // Be explicit in the email about anything not attached.
      let finalHtml = html;
      if (skippedPdfs.length || missingPdfs.length) {
        const notes: string[] = [];
        if (skippedPdfs.length) notes.push(`${skippedPdfs.length} PDF(s) exceeded the email size limit and were not attached: ${skippedPdfs.join(", ")}${portalUrl ? " — available via your portal" : ""}.`);
        if (missingPdfs.length) notes.push(`No PDF was available from the accounting system for: ${missingPdfs.join(", ")}.`);
        finalHtml = html.replace(
          "</div>",
          `<p style="color:#a16207;font-size:12px;background:#fefce8;border:1px solid #fde68a;border-radius:6px;padding:8px 12px;">${notes.join("<br/>")}</p></div>`
        );
      }

      const subject = `Escalated invoices assigned to you — ${group.items.length} invoice${group.items.length !== 1 ? "s" : ""} · ${totalStr}`;
      await sendEmail(orgId!, { to: email, subject, body: finalHtml, attachments });

      // Log one Outbound Email communication per invoice.
      await db.insert(communications).values(
        group.items.map(r => ({
          orgId:      orgId!,
          customerId: r.inv.customerId,
          projectId:  r.inv.projectId ?? null,
          invoiceId:  r.inv.id,
          direction:  "Outbound" as const,
          channel:    "Email" as const,
          subject:    `Escalation digest → ${group.name}`,
          body:       `Escalation digest sent to ${group.name} (${email}) covering ${group.items.length} invoice(s). ${attachments.length} PDF(s) attached.${portalUrl ? " Portal link included." : ""}`,
          sender:     actorName,
          recipients: email,
          matchedBy:  "EscalationDigest",
          isDraft:    false,
          ...(actorId ? { authorId: actorId } : {}),
        }))
      );

      results.push({ owner: group.name, email, invoices: group.items.length, sent: true });
    } catch (e: any) {
      console.error(`[notify-owners] Failed for ${email}:`, e);
      results.push({ owner: group.name, email, invoices: group.items.length, sent: false, error: e?.message ?? "Send failed" });
    }
  }

  return ok({ results, sent: results.filter(r => r.sent).length, failed: results.filter(r => !r.sent).length });
}
