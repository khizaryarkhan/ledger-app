/**
 * A report model as one printable HTML document — PURE, so it runs in the
 * browser (Print, via a hidden frame) and on the server (PDF, through the one
 * shared engine lib/pdf/render-html.ts) with identical output, and is testable
 * without a browser.
 *
 * Deliberately NOT built on lib/statement-pdf.ts: that file imports the
 * server-only PDF engine, which must never reach a client bundle.
 *
 * Every dynamic string goes through esc(). Numbers are formatted by lib/format
 * (the one decimal rule); dates by formatDateShort, which reads YYYY-MM-DD
 * literally and never builds a Date.
 */
import { fmt, formatDateShort } from "@/lib/format";
import type { Cell, ColumnKind, ExportColumn, ExportRow, ExportSection, ReportExportModel } from "./export-model";

export interface ReportHtmlContext {
  orgName: string;
  /** YYYY-MM-DD the report was run. */
  generatedOn: string;
  generatedBy?: string | null;
  /** An https or inline-image logo URL (re-validated here). */
  logoUrl?: string | null;
}

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** https or inline raster/svg image only — never attacker-controlled markup. */
export function safeLogo(logoUrl: string | null | undefined): string | null {
  const u = (logoUrl ?? "").trim();
  if (!u) return null;
  if (/^https:\/\//i.test(u) && u.length <= 2048) return esc(u);
  if (/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]+=*$/i.test(u) && u.length <= 700_000) return u;
  return null;
}

function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => (w[0] ?? "").toUpperCase()).join("") || "•";
}

const isRight = (k: ColumnKind) => k !== "text" && k !== "date";

/** One cell as display text (already HTML-escaped). */
export function formatCell(kind: ColumnKind, v: Cell): string {
  if (v == null || v === "") return "";
  // A date arrives as the literal "YYYY-MM-DD"; format it before the string short-circuit below.
  if (kind === "date" && typeof v === "string") return /^\d{4}-\d{2}-\d{2}/.test(v) ? esc(formatDateShort(v)) : esc(v);
  if (typeof v === "string") return esc(v);
  if (!Number.isFinite(v)) return "";
  switch (kind) {
    case "money": {
      const t = fmt.num2(Math.abs(v));
      return v < 0 ? `(${t})` : t;
    }
    case "variance": {
      if (v === 0) return fmt.num2(0);
      return `${v > 0 ? "+" : "−"}${fmt.num2(Math.abs(v))}`;
    }
    case "qty":
      return esc(fmt.qty(v));
    case "percent":
      return `${v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
    case "int":
      return Math.round(v).toLocaleString();
    case "date":
      return esc(formatDateShort(String(v)));
    default:
      return esc(String(v));
  }
}

function rowHtml(row: ExportRow, cols: ExportColumn[]): string {
  if (row.kind === "heading") {
    return `<tr class="h"><td colspan="${cols.length}">${esc(row.cells[0] ?? "")}</td></tr>`;
  }
  const cls = row.kind === "line" ? "" : ` class="${row.kind === "subtotal" ? "sub" : "tot"}"`;
  const tds = cols
    .map((c, i) => {
      const classes = [isRight(c.kind) ? "r" : "", row.flags?.[i] ? "x" : ""].filter(Boolean).join(" ");
      const right = classes ? ` class="${classes}"` : "";
      const indent = i === 0 && row.indent ? ` style="padding-left:${row.indent * 14 + 6}px"` : "";
      return `<td${right}${indent}>${formatCell(c.kind, row.cells[i] ?? null)}</td>`;
    })
    .join("");
  return `<tr${cls}>${tds}</tr>`;
}

function sectionHtml(s: ExportSection): string {
  const head = s.columns
    .map((c) => `<th${isRight(c.kind) ? ' class="r"' : ""}>${esc(c.label)}</th>`)
    .join("");
  return `${s.heading ? `<h3>${esc(s.heading)}</h3>` : ""}
    <table><thead><tr>${head}</tr></thead><tbody>${s.rows.map((r) => rowHtml(r, s.columns)).join("")}</tbody></table>`;
}

export function reportFooterTemplate(ctx: ReportHtmlContext): string {
  const who = ctx.generatedBy ? ` by ${esc(ctx.generatedBy)}` : "";
  return `<div style="width:100%;font-size:8px;color:#8a8f99;padding:0 14mm;display:flex;justify-content:space-between;font-family:Helvetica,Arial,sans-serif">
    <span>${esc(ctx.orgName)} · generated ${esc(formatDateShort(ctx.generatedOn))}${who}</span>
    <span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
}

export function buildReportHtml(model: ReportExportModel, ctx: ReportHtmlContext): { html: string; footerTemplate: string } {
  const widest = model.sections.reduce((m, s) => Math.max(m, s.columns.length), 0);
  const page = widest > 6 ? "A4 landscape" : "A4";
  const logo = safeLogo(ctx.logoUrl);
  const mark = logo
    ? `<img class="logo" src="${logo}" alt="">`
    : `<div class="mono">${esc(monogram(ctx.orgName))}</div>`;

  const params = model.params.length
    ? `<div class="params">${model.params.map((p) => `<span><b>${esc(p.label)}:</b> ${esc(p.value)}</span>`).join("")}</div>`
    : "";
  const notes = model.notes.length
    ? `<div class="notes">${model.notes.map((n) => `<p>${esc(n)}</p>`).join("")}</div>`
    : "";

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(model.title)}</title>
<style>
*{box-sizing:border-box}
@page{size:${page};margin:18mm 14mm 18mm}
html,body{margin:0;padding:0;color:#1b1917;background:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:11px;line-height:1.45}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:1.5px solid #1b1917;padding-bottom:10px;margin-bottom:12px}
.logo{max-height:40px;max-width:160px}
.mono{width:34px;height:34px;border:1.5px solid #1b1917;border-radius:6px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px}
.ttl{text-align:right}
.ttl .e{font-size:14px;font-weight:700}
.ttl .f{font-size:12px;font-weight:600;margin-top:2px}
.ttl .p{font-size:11px;color:#57534e;margin-top:2px}
.ttl .c{font-size:10px;color:#78716c;margin-top:2px}
.params{display:flex;flex-wrap:wrap;gap:4px 18px;font-size:10px;color:#57534e;margin-bottom:10px}
h3{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#57534e;margin:16px 0 4px}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
thead th{text-align:left;font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;color:#57534e;border-bottom:1px solid #1b1917;padding:4px 6px}
td{padding:3px 6px;border-bottom:.5px solid #e7e5e4;vertical-align:top}
.r{text-align:right;white-space:nowrap}
.x{color:#b91c1c}
.disc{margin-top:18px;font-size:9px;color:#8a8f99}
tr.h td{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#57534e;font-weight:700;padding-top:10px;border-bottom:none}
tr.sub td{font-weight:700;border-top:.75px solid #1b1917}
tr.tot td{font-weight:700;border-top:.75px solid #1b1917;border-bottom:2px double #1b1917}
tr{page-break-inside:avoid}
thead{display:table-header-group}
.notes{margin-top:14px;font-size:10px;color:#92400e}
.notes p{margin:2px 0}
</style></head><body>
<div class="head">${mark}<div class="ttl">
<div class="e">${esc(model.entity || ctx.orgName)}</div>
<div class="f">${esc(model.formalTitle || model.title)}</div>
${model.periodLine ? `<div class="p">${esc(model.periodLine)}</div>` : ""}
${model.currency ? `<div class="c">All amounts in ${esc(model.currency)}</div>` : ""}
${model.entity && model.entity !== ctx.orgName ? `<div class="c">Prepared in ${esc(ctx.orgName)}</div>` : ""}
</div></div>
${params}
${model.sections.map(sectionHtml).join("")}
${notes}
<p class="disc">Rendered from the on-screen report on ${esc(formatDateShort(ctx.generatedOn))}; not an attested or audited statement.</p>
</body></html>`;

  return { html, footerTemplate: reportFooterTemplate(ctx) };
}
