/**
 * Statement of Account — professional PDF, rendered through the one shared
 * HTML/Chromium engine (lib/pdf/render-html.ts), SERVER-ONLY — never import
 * this from a "use client" file. For the browser-side "download" button see
 * lib/statement-export-client.ts, which fetches the PDF from
 * app/api/statements/export-pdf/route.ts instead of building it locally.
 *
 * Produces a clean, printable statement grouped Customer → Project with
 * per-level subtotals and a grand total, a repeating page footer (page
 * number + generated timestamp), and multi-currency-safe subtotals.
 *
 * Design: Swiss-minimalist — whitespace, hairline rules (no heavy filled
 * blocks), black used only for lines/borders/totals, and a small monogram
 * for identity when no logo is set. Aims to read "considered", not
 * "template".
 */

import { formatDateShort } from "./format";
import { renderHtmlToPdf } from "./pdf/render-html";

export type StatementRow = {
  inv: {
    invoiceNumber: string;
    invoiceDate?: string | null;
    dueDate?: string | null;
    currency?: string | null;
    total?: number | null;
  };
  custName: string;
  projName: string | null;
  bal: number;
  days: number;
  /** An unapplied credit memo — rendered as a credit (green, "Credit on
   *  Account"), never as debt with a due date. */
  isCreditMemo?: boolean;
};

const num2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtCcyMap(map: Record<string, number>): string {
  const parts = Object.entries(map).filter(([, v]) => Math.abs(v) > 0.005).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  if (!parts.length) return num2(0);
  return parts.map(([c, v]) => `${c} ${num2(v)}`).join("  ·  ");
}

/**
 * Invoice and due dates on a customer statement.
 *
 * This is a document a debtor receives, so a date that is off by a day is the
 * most damaging version of that bug — it is evidence in a payment dispute.
 * formatDateShort never builds a Date for a date-only string, so correctness
 * doesn't depend on where this runs. A missing date (credit memos have none)
 * reads as "—", never as "Invalid Date".
 */
const fmtDate = (iso: string | null | undefined) => (iso ? formatDateShort(iso) : "—");

function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? "";
  if (first.length >= 2 && first.length <= 4 && first === first.toUpperCase()) return first.slice(0, 2);
  return words.slice(0, 2).map(w => (w[0] ?? "").toUpperCase()).join("") || "•";
}

function css(): string {
  return `
    *{box-sizing:border-box}
    @page{size:A4;margin:20mm 14mm 18mm}
    html,body{margin:0;padding:0;color:#1b1917;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
      font-size:11px;line-height:1.5}
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .num{font-variant-numeric:tabular-nums}
    .muted{color:#6a706a69}
    .faint{color:#8a8f99}

    .head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}
    .logo{max-height:34px;max-width:200px;object-fit:contain;display:block;margin-bottom:8px}
    .mono{width:30px;height:30px;background:#141414;color:#fff;border-radius:3px;
      display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;margin-bottom:8px}
    .org{font-size:16px;font-weight:800}
    .label{margin-top:2px;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#6a6a66}
    .meta-r{text-align:right}
    .accentbar{margin-top:10px;border-top:2px solid #141414}

    .focal{margin-top:14px;display:flex;justify-content:space-between;align-items:flex-end}
    .focal .lab{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#6a6a66}
    .focal .val{font-size:18px;font-weight:800;margin-top:3px}

    .grp-cust{background:#f4f4f3;border-left:3px solid #141414;padding:5px 10px;
      font-weight:700;font-size:11px;margin-top:14px;display:flex;justify-content:space-between}
    .grp-proj{padding:5px 2px 2px 10px;font-weight:700;font-size:9.5px;color:#454540}
    table.lines{width:100%;border-collapse:collapse;margin-top:4px;font-size:10px}
    table.lines th{font-size:8px;letter-spacing:.07em;text-transform:uppercase;color:#8a8f99;
      text-align:left;padding:5px 8px;border-bottom:1px solid #e3e3e0}
    table.lines td{padding:4.5px 8px;border-bottom:1px solid #eceeec}
    table.lines tr{break-inside:avoid;page-break-inside:avoid}
    th.r,td.r{text-align:right}
    .cm-row td{color:#15803d}
    .sub-row td{font-weight:700;border-top:1px solid #d7d7d2;border-bottom:none;background:#fafaf9}
    .cust-total{display:flex;justify-content:space-between;border-top:1px solid #141414;
      margin-top:2px;padding-top:4px;font-weight:800;font-size:10.5px}

    .grand{margin-top:16px;padding-top:9px;border-top:2.5px solid #141414;
      display:flex;justify-content:space-between;align-items:baseline}
    .grand .lab{font-weight:700;font-size:10.5px;letter-spacing:.04em}
    .grand .val{font-weight:800;font-size:14px}
  `;
}

/**
 * Build one customer's/org's Statement of Open Invoices PDF through the
 * shared headless-Chromium engine. SERVER-ONLY (see this file's header
 * comment) — the caller is always an API route, never a client component.
 */
export async function buildStatementPdf({ orgName, rows, logoUrl }: { orgName: string; rows: StatementRow[]; logoUrl?: string | null }): Promise<Buffer> {
  const now = new Date();
  const stamp =
    now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
    " · " +
    now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  // Group Customer → Project.
  type Grp = { total: Record<string, number>; rows: StatementRow[] };
  const byCust = new Map<string, { total: Record<string, number>; projects: Map<string, Grp> }>();
  for (const r of rows) {
    const ccy = r.inv.currency || "EUR";
    const cKey = r.custName || "—";
    if (!byCust.has(cKey)) byCust.set(cKey, { total: {}, projects: new Map() });
    const cg = byCust.get(cKey)!;
    cg.total[ccy] = (cg.total[ccy] ?? 0) + r.bal;
    const pKey = r.projName || "No project";
    if (!cg.projects.has(pKey)) cg.projects.set(pKey, { total: {}, rows: [] });
    const pg = cg.projects.get(pKey)!;
    pg.total[ccy] = (pg.total[ccy] ?? 0) + r.bal;
    pg.rows.push(r);
  }
  const sumT = (t: Record<string, number>) => Object.values(t).reduce((s, v) => s + v, 0);
  const customers = [...byCust.entries()].sort((a, b) => sumT(b[1].total) - sumT(a[1].total));
  const grand: Record<string, number> = {};
  rows.forEach(r => { const c = r.inv.currency || "EUR"; grand[c] = (grand[c] ?? 0) + r.bal; });

  // Logo must be a real URL (http/https) — never attacker-controlled markup;
  // a missing/invalid one falls back to the monogram, same as the old
  // pdf-lib version's "never fail to generate because of a bad logo" rule.
  const safeLogo = logoUrl && /^https?:\/\//i.test(logoUrl) ? esc(logoUrl) : null;
  const mark = monogram(orgName);

  const groupsHtml = customers.map(([custName, cg]) => {
    const projects = [...cg.projects.entries()].sort((a, b) => sumT(b[1].total) - sumT(a[1].total));
    const projectsHtml = projects.map(([projName, pg]) => {
      const showProj = projName !== "No project" || projects.length > 1;
      const invRows = [...pg.rows].sort((a, b) => String(a.inv.dueDate ?? "").localeCompare(String(b.inv.dueDate ?? "")));
      const rowsHtml = invRows.map(r => {
        const inv = r.inv;
        const ccy = inv.currency || "EUR";
        if (r.isCreditMemo) {
          return `<tr class="cm-row">
            <td>#${esc(inv.invoiceNumber)}</td><td>${fmtDate(inv.invoiceDate)}</td><td>—</td>
            <td class="r">—</td><td class="r">Credit on Account</td>
            <td class="r num">${esc(ccy)} ${num2(r.bal)}</td></tr>`;
        }
        const overdue = r.days > 0
          ? `<span${r.days > 90 ? ' style="color:#b91c1c"' : ""}>${r.days}d overdue</span>`
          : "current";
        return `<tr>
          <td>#${esc(inv.invoiceNumber)}</td><td>${fmtDate(inv.invoiceDate)}</td><td>${fmtDate(inv.dueDate)}</td>
          <td class="r num">${esc(ccy)} ${num2(Number(inv.total || 0))}</td>
          <td class="r">${overdue}</td>
          <td class="r num">${esc(ccy)} ${num2(r.bal)}</td></tr>`;
      }).join("");
      const subRow = showProj
        ? `<tr class="sub-row"><td colspan="5">Subtotal</td><td class="r num">${esc(fmtCcyMap(pg.total))}</td></tr>`
        : "";
      return (showProj ? `<div class="grp-proj">${esc(projName)}</div>` : "") +
        `<table class="lines"><thead><tr><th>Invoice</th><th>Inv. date</th><th>Due</th>
          <th class="r">Amount</th><th class="r">Status</th><th class="r">Outstanding</th></tr></thead>
         <tbody>${rowsHtml}${subRow}</tbody></table>`;
    }).join("");
    return `<div class="grp-cust"><span>${esc(custName)}</span><span class="num">${esc(fmtCcyMap(cg.total))}</span></div>${projectsHtml}`;
  }).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8" /><style>${css()}</style></head><body>
    <div class="head">
      <div>
        ${safeLogo ? `<img class="logo" src="${safeLogo}" alt="" />` : `<div class="mono">${esc(mark)}</div>`}
        <div class="org">${esc(orgName)}</div>
        <div class="label">Statement of open invoices</div>
      </div>
      <div class="meta-r">
        <div class="label">Statement date</div>
        <div style="font-weight:700;font-size:12px">${esc(stamp)}</div>
        <div class="label" style="margin-top:4px">${rows.length} invoice${rows.length !== 1 ? "s" : ""} · ${customers.length} customer${customers.length !== 1 ? "s" : ""}</div>
      </div>
    </div>
    <div class="accentbar"></div>
    <div class="focal">
      <div><div class="lab">Outstanding balances as at the statement date</div></div>
      <div class="meta-r"><div class="lab">Total outstanding</div><div class="val num">${esc(fmtCcyMap(grand))}</div></div>
    </div>
    ${groupsHtml}
    <div class="grand"><span class="lab">GRAND TOTAL</span><span class="val num">${esc(fmtCcyMap(grand))}</span></div>
  </body></html>`;

  const footerTemplate = `
    <div style="width:100%;font-size:7.5px;color:#8a8f99;padding:0 14mm;
      display:flex;justify-content:space-between;font-family:Arial,sans-serif">
      <span>${esc(orgName)} · Statement of Open Invoices</span>
      <span class="pageNumber"></span>
      <span>Generated ${esc(stamp)}</span>
    </div>`;

  return renderHtmlToPdf(html, { footerTemplate });
}
