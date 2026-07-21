/**
 * Statement of Account — professional PDF.
 *
 * Runs client-side (pdf-lib, already a dependency). Produces a clean,
 * printable statement grouped Customer → Project with per-level subtotals
 * and a grand total. Company name sits in the header band; the run
 * timestamp (date + time) is stamped in the header and repeated in the
 * page footer. Multi-currency safe — subtotals render per currency.
 */

import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "pdf-lib";

export type StatementRow = {
  inv: any;
  custName: string;
  projName: string | null;
  bal: number;
  days: number;
};

// ── Page geometry (A4 portrait, points) ──────────────────────────────────────
const PAGE_W = 595.28, PAGE_H = 841.89;
const M = 42;                    // outer margin
const CONTENT_W = PAGE_W - M * 2;
const BOTTOM = 64;               // reserve for footer

// ── Palette (light, document-appropriate) ────────────────────────────────────
const NAVY   = rgb(0.035, 0.153, 0.349); // brand navy #092759 — header band
const INK    = rgb(0.11, 0.10, 0.09);
const MUTED  = rgb(0.45, 0.43, 0.40);
const RULE   = rgb(0.83, 0.82, 0.81);
const BAND   = rgb(0.945, 0.94, 0.93);    // customer row background
const WHITE  = rgb(1, 1, 1);

// ── Column x-positions (numbers are right-aligned to their x) ─────────────────
const COL = {
  label:   M,           // Invoice # / customer / project (indented)
  invDate: M + 168,
  dueDate: M + 232,
  overdue: M + 300,     // right-aligned
  cur:     M + 312,
  amount:  M + 442,     // right-aligned
  out:     M + CONTENT_W, // right-aligned (page right edge)
};

const num2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtCcyMap(map: Record<string, number>): string {
  const parts = Object.entries(map).filter(([, v]) => Math.abs(v) > 0.005).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  if (!parts.length) return num2(0);
  return parts.map(([c, v]) => `${c} ${num2(v)}`).join("  ·  ");
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** Build the statement PDF bytes (no DOM) — reusable server-side too. */
export async function buildStatementPdf({ orgName, rows }: { orgName: string; rows: StatementRow[] }): Promise<Uint8Array> {
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

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page!: PDFPage;
  let y = 0;

  const tW = (t: string, size: number, f: PDFFont) => f.widthOfTextAtSize(t, size);
  const clip = (t: string, maxW: number, size: number, f: PDFFont) => {
    if (tW(t, size, f) <= maxW) return t;
    let s = t;
    while (s.length > 1 && tW(s + "…", size, f) > maxW) s = s.slice(0, -1);
    return s + "…";
  };
  const right = (t: string, xR: number, yy: number, size: number, f: PDFFont, color = INK) =>
    page.drawText(t, { x: xR - tW(t, size, f), y: yy, size, font: f, color });

  function header() {
    // Navy band
    page.drawRectangle({ x: 0, y: PAGE_H - 92, width: PAGE_W, height: 92, color: NAVY });
    // Auto-fit the company name (shrink 20→13 before clipping) so a long
    // name isn't truncated on the customer's own statement.
    const nameMaxW = CONTENT_W - 170;
    let nameSize = 20;
    while (nameSize > 13 && tW(orgName, nameSize, bold) > nameMaxW) nameSize -= 0.5;
    page.drawText(clip(orgName, nameMaxW, nameSize, bold), { x: M, y: PAGE_H - 44, size: nameSize, font: bold, color: WHITE });
    page.drawText("STATEMENT OF ACCOUNT", { x: M, y: PAGE_H - 66, size: 10, font, color: rgb(0.75, 0.82, 0.92) });
    // Right-aligned run stamp
    const gen = `Generated ${stamp}`;
    page.drawText(gen, { x: PAGE_W - M - tW(gen, 9, font), y: PAGE_H - 44, size: 9, font, color: rgb(0.82, 0.87, 0.95) });
    const tot = `Total outstanding  ${fmtCcyMap(grand)}`;
    page.drawText(tot, { x: PAGE_W - M - tW(tot, 10, bold), y: PAGE_H - 62, size: 10, font: bold, color: WHITE });
    const meta = `${rows.length} invoice${rows.length !== 1 ? "s" : ""} · ${customers.length} customer${customers.length !== 1 ? "s" : ""}`;
    page.drawText(meta, { x: PAGE_W - M - tW(meta, 8, font), y: PAGE_H - 78, size: 8, font, color: rgb(0.75, 0.82, 0.92) });
    y = PAGE_H - 116;
  }

  function columnHeads() {
    page.drawText("INVOICE", { x: COL.label, y, size: 7.5, font: bold, color: MUTED });
    page.drawText("INV DATE", { x: COL.invDate, y, size: 7.5, font: bold, color: MUTED });
    page.drawText("DUE", { x: COL.dueDate, y, size: 7.5, font: bold, color: MUTED });
    right("OVERDUE", COL.overdue, y, 7.5, bold, MUTED);
    page.drawText("CUR", { x: COL.cur, y, size: 7.5, font: bold, color: MUTED });
    right("AMOUNT", COL.amount, y, 7.5, bold, MUTED);
    right("OUTSTANDING", COL.out, y, 7.5, bold, MUTED);
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: PAGE_W - M, y }, thickness: 0.75, color: RULE });
    y -= 14;
  }

  function newPage() {
    page = doc.addPage([PAGE_W, PAGE_H]);
    header();
    columnHeads();
  }

  function ensure(space: number) {
    if (y - space < BOTTOM) newPage();
  }

  newPage();

  for (const [custName, cg] of customers) {
    ensure(40);
    // Customer band
    page.drawRectangle({ x: M - 6, y: y - 5, width: CONTENT_W + 12, height: 20, color: BAND });
    page.drawText(clip(custName, CONTENT_W - 170, 11, bold), { x: COL.label, y, size: 11, font: bold, color: INK });
    right(fmtCcyMap(cg.total), COL.out, y, 10, bold, INK);
    y -= 24;

    const projects = [...cg.projects.entries()].sort((a, b) => sumT(b[1].total) - sumT(a[1].total));
    for (const [projName, pg] of projects) {
      const showProj = projName !== "No project" || projects.length > 1;
      if (showProj) {
        ensure(24);
        page.drawText(clip(projName, CONTENT_W - 170, 9.5, bold), { x: COL.label + 10, y, size: 9.5, font: bold, color: rgb(0.30, 0.28, 0.26) });
        right(fmtCcyMap(pg.total), COL.out, y, 9, font, MUTED);
        y -= 16;
      }

      const invRows = [...pg.rows].sort((a, b) => String(a.inv.dueDate).localeCompare(String(b.inv.dueDate)));
      for (const r of invRows) {
        ensure(16);
        const inv = r.inv;
        const total = Number(inv.total || 0);
        page.drawText(clip(`#${inv.invoiceNumber}`, 150, 9, font), { x: COL.label + 20, y, size: 9, font, color: INK });
        page.drawText(fmtDate(inv.invoiceDate), { x: COL.invDate, y, size: 8.5, font, color: MUTED });
        page.drawText(fmtDate(inv.dueDate), { x: COL.dueDate, y, size: 8.5, font, color: MUTED });
        right(r.days > 0 ? `${r.days}d` : "—", COL.overdue, y, 8.5, font, r.days > 90 ? rgb(0.72, 0.11, 0.20) : r.days > 0 ? rgb(0.70, 0.42, 0.05) : MUTED);
        page.drawText(inv.currency || "EUR", { x: COL.cur, y, size: 8, font, color: MUTED });
        right(num2(total), COL.amount, y, 9, font, INK);
        right(num2(r.bal), COL.out, y, 9, bold, INK);
        y -= 14;
      }
      if (showProj) {
        ensure(16);
        page.drawLine({ start: { x: COL.amount - 40, y: y + 8 }, end: { x: PAGE_W - M, y: y + 8 }, thickness: 0.5, color: RULE });
        right("Subtotal", COL.amount, y, 8, bold, MUTED);
        right(fmtCcyMap(pg.total), COL.out, y, 8.5, bold, INK);
        y -= 16;
      }
    }
    // Customer total
    ensure(20);
    page.drawLine({ start: { x: M, y: y + 9 }, end: { x: PAGE_W - M, y: y + 9 }, thickness: 0.75, color: RULE });
    page.drawText(`Total — ${clip(custName, 220, 9.5, bold)}`, { x: COL.label, y, size: 9.5, font: bold, color: INK });
    right(fmtCcyMap(cg.total), COL.out, y, 10, bold, NAVY);
    y -= 26;
  }

  // Grand total block
  ensure(40);
  page.drawRectangle({ x: M - 6, y: y - 6, width: CONTENT_W + 12, height: 26, color: NAVY });
  page.drawText("GRAND TOTAL", { x: COL.label, y: y + 2, size: 11, font: bold, color: WHITE });
  right(fmtCcyMap(grand), COL.out, y + 2, 12, bold, WHITE);

  // Footers: page x of y + run stamp, on every page.
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 46 }, end: { x: PAGE_W - M, y: 46 }, thickness: 0.5, color: RULE });
    p.drawText(`${orgName} · Statement of Account`, { x: M, y: 34, size: 7.5, font, color: MUTED });
    const pg = `Page ${i + 1} of ${pages.length}`;
    p.drawText(pg, { x: (PAGE_W - font.widthOfTextAtSize(pg, 7.5)) / 2, y: 34, size: 7.5, font, color: MUTED });
    const gen = `Generated ${stamp}`;
    p.drawText(gen, { x: PAGE_W - M - font.widthOfTextAtSize(gen, 7.5), y: 34, size: 7.5, font, color: MUTED });
  });

  return await doc.save();
}

/** Client-side: build + trigger a download. */
export async function exportStatementPdf({ orgName, rows }: { orgName: string; rows: StatementRow[] }) {
  const bytes = await buildStatementPdf({ orgName, rows });
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Statement_${new Date().toISOString().slice(0, 10)}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
