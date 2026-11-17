/**
 * Manufacturing Order report — a printable, insight-first PDF for one order.
 *
 * Rendered through the SAME engine as the Customer Statement (lib/statement-pdf.ts: hand-built HTML ->
 * lib/pdf/render-html.ts's headless Chromium, same masthead, hairline rules, repeating page footer), so the
 * two documents read as one family. SERVER-ONLY at the PDF step; the HTML builder and every rule here are
 * pure so they are testable without a browser or a database.
 *
 * The brief was "an insightful report, not a copy of the sample", so the page leads with the answer to
 * "how did this run go?" (made vs planned, yield, cost per unit, on time) and plain-language findings,
 * then the supporting tables: output, material variance, cost build-up, operations, and the lot-level
 * traceability a recall or audit needs.
 */

import { esc, monogram, safeLogoSrc } from "@/lib/statement-pdf";
import { fmt, formatDateShort } from "@/lib/format";
import { renderHtmlToPdf } from "@/lib/pdf/render-html";

export type MoReportLot = {
  itemName: string; lotNo: string | null; supplierBatchNo: string | null; expiryDate: string | null;
  qty: number; uom: string; unitCost: number; cost: number; standsInFor: string | null; runNo: string | null;
};
export type MoReportOutput = {
  label: string; plannedPacks: number; producedPacks: number; unitContent: number; baseUom: string;
  lotNo: string | null; bestBefore: string | null; expiryDate: string | null; cost: number; unitCost: number;
};
/** `forPack` = the output pack a packaging material is for; null = shared by every pack (all ingredients, shared packaging). */
export type MoReportMaterial = { name: string; kind: "ingredient" | "packaging"; uom: string; planned: number; used: number; cost: number; substitutes: string[]; forPack?: string | null };
export type MoReportOperation = { name: string; plannedHours: number; actualHours: number | null; plannedCost: number };
/** `packs` = what the good output was, in packs ("24 × 4oz, 12 × 8oz"). */
export type MoReportRun = { runNo: string | null; date: string | null; good: number; rejected: number; materialCost: number; labourCost: number; overheadCost: number; scrapCost: number; rejectReason: string | null; packs?: string };

export type MoReportData = {
  orgName: string; logoUrl: string | null;
  mo: {
    moNo: string; status: string; productName: string; bomCode?: string | null; bomName?: string | null; baseUom: string; priority: string;
    scheduledDate: string | null; dueDate: string | null; originalDueDate: string | null; rescheduleCount: number;
    delayReason: string | null; delayNote: string | null;
    startedAt: string | null; completedAt: string | null; createdBy: string | null; notes: string | null; expYield: number | null;
  };
  outputs: MoReportOutput[]; materials: MoReportMaterial[]; lots: MoReportLot[]; operations: MoReportOperation[]; runs: MoReportRun[];
};

// ---- pure rules ----------------------------------------------------------------------------------------------

/** A material that differs from plan by more than this share is called out. */
export const VARIANCE_FLAG_PCT = 5;

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const round = (n: number, dp = 2) => { const f = 10 ** dp; return Math.round((n + Number.EPSILON) * f) / f; };

export type MoInsights = {
  plannedBase: number; goodBase: number; rejectedBase: number;
  /** Good / (good + rejected), as a percentage; null when nothing was produced or rejected. */
  yieldPct: number | null;
  costs: { material: number; labour: number; overhead: number; scrap: number; total: number };
  /** Total cost over good base units; null with no good output. */
  costPerGoodBase: number | null;
  materialVariances: { name: string; uom: string; planned: number; used: number; variance: number; pct: number | null; flagged: boolean }[];
  cycleHours: number | null;
  /** Days finished after the due date (negative = early); null when either date is missing or not finished. */
  daysLate: number | null;
  producedVsPlanPct: number | null;
  findings: { tone: "good" | "watch" | "bad"; text: string }[];
};

/** Whole days from one YYYY-MM-DD to another, with no Date parsing of the local zone ("a date is a date"). */
export function daysBetween(fromYmd: string, toYmd: string): number {
  const a = fromYmd.split("-").map(Number); const b = toYmd.split("-").map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86_400_000);
}

export function computeInsights(d: MoReportData): MoInsights {
  const plannedBase = sum(d.outputs.map(o => o.plannedPacks * o.unitContent));
  const goodBase = sum(d.runs.map(r => r.good));
  const rejectedBase = sum(d.runs.map(r => r.rejected));
  const yieldPct = goodBase + rejectedBase > 0 ? round((goodBase / (goodBase + rejectedBase)) * 100, 1) : null;
  const material = sum(d.runs.map(r => r.materialCost)), labour = sum(d.runs.map(r => r.labourCost));
  const overhead = sum(d.runs.map(r => r.overheadCost)), scrap = sum(d.runs.map(r => r.scrapCost));
  const total = round(material + labour + overhead, 4);
  const costPerGoodBase = goodBase > 0 ? total / goodBase : null;

  const materialVariances = d.materials.map(m => {
    const variance = round(m.used - m.planned, 6);
    const pct = m.planned > 0 ? round((variance / m.planned) * 100, 1) : null;
    return { name: m.name, uom: m.uom, planned: m.planned, used: m.used, variance, pct, flagged: d.runs.length > 0 && pct != null && Math.abs(pct) > VARIANCE_FLAG_PCT };
  });

  const cycleHours = d.mo.startedAt && d.mo.completedAt
    ? round((Date.parse(d.mo.completedAt) - Date.parse(d.mo.startedAt)) / 3_600_000, 2) : null;
  const finishedYmd = d.mo.completedAt ? d.mo.completedAt.slice(0, 10) : null;
  const daysLate = finishedYmd && d.mo.dueDate ? daysBetween(d.mo.dueDate, finishedYmd) : null;
  const producedVsPlanPct = plannedBase > 0 ? round((goodBase / plannedBase) * 100, 1) : null;

  const findings: MoInsights["findings"] = [];
  if (producedVsPlanPct != null && d.runs.length) {
    if (producedVsPlanPct < 95) findings.push({ tone: "bad", text: `Produced ${producedVsPlanPct}% of the planned quantity (${fmt.qty(goodBase)} of ${fmt.qty(plannedBase)} ${d.mo.baseUom}).` });
    else if (producedVsPlanPct > 105) findings.push({ tone: "watch", text: `Produced ${producedVsPlanPct}% of plan, over by ${fmt.qty(goodBase - plannedBase)} ${d.mo.baseUom}.` });
    else findings.push({ tone: "good", text: `Output matched the plan (${producedVsPlanPct}%).` });
  }
  if (yieldPct != null && d.mo.expYield != null) {
    const exp = round(d.mo.expYield <= 1 ? d.mo.expYield * 100 : d.mo.expYield, 1);
    if (yieldPct + 0.05 < exp) findings.push({ tone: "bad", text: `Yield ${yieldPct}% is below the ${exp}% the recipe expects.` });
    else findings.push({ tone: "good", text: `Yield ${yieldPct}% met the ${exp}% the recipe expects.` });
  } else if (yieldPct != null && rejectedBase > 0) {
    findings.push({ tone: "watch", text: `${fmt.qty(rejectedBase)} ${d.mo.baseUom} rejected (yield ${yieldPct}%).` });
  }
  const worst = [...materialVariances].filter(v => v.flagged).sort((a, b) => Math.abs(b.pct ?? 0) - Math.abs(a.pct ?? 0)).slice(0, 3);
  if (worst.length) findings.push({ tone: "watch", text: `Material use differed from plan by more than ${VARIANCE_FLAG_PCT}%: ${worst.map(w => `${w.name} (${(w.pct ?? 0) > 0 ? "+" : ""}${w.pct}%)`).join(", ")}.` });
  else if (d.runs.length && materialVariances.length) findings.push({ tone: "good", text: `Every material was within ${VARIANCE_FLAG_PCT}% of plan.` });
  if (scrap > 0.005) findings.push({ tone: "bad", text: `${fmt.num2(scrap)} of cost was written off as abnormal scrap.` });
  if (daysLate != null) {
    if (daysLate > 0) findings.push({ tone: "bad", text: `Finished ${daysLate} day${daysLate === 1 ? "" : "s"} after the due date${d.mo.delayReason ? ` (${d.mo.delayReason})` : ""}.` });
    else findings.push({ tone: "good", text: daysLate === 0 ? "Finished on the due date." : `Finished ${-daysLate} day${daysLate === -1 ? "" : "s"} early.` });
  }
  if (d.mo.rescheduleCount > 0) findings.push({ tone: "watch", text: `The due date moved ${d.mo.rescheduleCount} time${d.mo.rescheduleCount === 1 ? "" : "s"}${d.mo.originalDueDate ? ` (first promise ${formatDateShort(d.mo.originalDueDate)})` : ""}.` });
  const opsOver = d.operations.filter(o => o.actualHours != null && o.plannedHours > 0 && (o.actualHours as number) > o.plannedHours * 1.1);
  if (opsOver.length) findings.push({ tone: "watch", text: `Labour hours ran over plan on ${opsOver.map(o => o.name).join(", ")}.` });

  return { plannedBase, goodBase, rejectedBase, yieldPct, costs: { material, labour, overhead, scrap, total }, costPerGoodBase, materialVariances, cycleHours, daysLate, producedVsPlanPct, findings };
}

// ---- HTML ----------------------------------------------------------------------------------------------------

const dateOrDash = (d: string | null | undefined) => (d ? formatDateShort(d) : "—");
/** A real instant (not a date-only value), shown in UTC and labelled so, since the server has no viewer. */
function instant(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
    + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}
const STATUS_LABEL: Record<string, string> = { InProgress: "In progress", Draft: "Draft", Scheduled: "Scheduled", Released: "Released", Completed: "Completed", Cancelled: "Cancelled" };
const sign = (n: number) => (n > 0 ? "+" : "");

function css(): string {
  return `
    *{box-sizing:border-box}
    @page{size:A4;margin:20mm 14mm 18mm}
    html,body{margin:0;padding:0;color:#1b1917;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:11px;line-height:1.5}
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .num{font-variant-numeric:tabular-nums}
    .head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}
    .logo{max-height:34px;max-width:200px;object-fit:contain;display:block;margin-bottom:8px}
    .mono{width:30px;height:30px;background:#141414;color:#fff;border-radius:3px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;margin-bottom:8px}
    .org{font-size:16px;font-weight:800}
    .label{margin-top:2px;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#6a6a66}
    .meta-r{text-align:right}
    .accentbar{margin-top:10px;border-top:2px solid #141414}
    .pill{display:inline-block;font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;border:1px solid #141414;border-radius:2px;padding:1px 6px}
    .facts{display:grid;grid-template-columns:repeat(4,1fr);gap:6px 14px;margin-top:10px}
    .facts .k{font-size:8px;letter-spacing:.07em;text-transform:uppercase;color:#8a8f99}
    .facts .v{font-size:10.5px;font-weight:600}
    .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:0;margin-top:14px;border-top:1px solid #d7d7d2;border-bottom:1px solid #d7d7d2}
    .kpi{padding:8px 10px;border-right:1px solid #eceeec}.kpi:last-child{border-right:none}
    .kpi .k{font-size:8px;letter-spacing:.07em;text-transform:uppercase;color:#8a8f99}
    .kpi .v{font-size:17px;font-weight:800;margin-top:2px}
    .kpi .s{font-size:9px;color:#6a6a66}
    h2{font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;margin:16px 0 4px;padding:5px 10px;background:#f4f4f3;border-left:3px solid #141414;font-weight:700}
    .findings{margin:6px 0 0;padding:0;list-style:none}
    .findings li{padding:3px 0 3px 12px;border-bottom:1px solid #eceeec;position:relative;font-size:10.5px}
    .findings li:before{content:"";position:absolute;left:0;top:9px;width:6px;height:6px;border-radius:50%;background:#9ca3af}
    .findings li.good:before{background:#15803d}.findings li.watch:before{background:#b45309}.findings li.bad:before{background:#b91c1c}
    table.lines{width:100%;border-collapse:collapse;margin-top:4px;font-size:10px}
    table.lines th{font-size:8px;letter-spacing:.07em;text-transform:uppercase;color:#8a8f99;text-align:left;padding:5px 8px;border-bottom:1px solid #e3e3e0;white-space:nowrap}
    table.lines td.nw{white-space:nowrap}
    table.lines td{padding:4.5px 8px;border-bottom:1px solid #eceeec}
    table.lines tr{break-inside:avoid;page-break-inside:avoid}
    table.lines th.r,table.lines td.r{text-align:right}
    table.lines tr.tot td{font-weight:800;border-top:1px solid #141414;border-bottom:none}
    .flag{color:#b45309;font-weight:700}.bad{color:#b91c1c;font-weight:700}
    .muted{color:#6a6a66}
    .bar{display:flex;height:9px;border-radius:2px;overflow:hidden;margin:6px 0 4px;background:#eceeec}
    .bar span{display:block;height:100%}
    .legend{display:flex;gap:14px;font-size:9.5px;color:#454540}
    .legend i{display:inline-block;width:8px;height:8px;margin-right:4px;border-radius:1px}
    .sign{display:flex;gap:30px;margin-top:64px;break-inside:avoid;page-break-inside:avoid}.sign div{flex:1;border-top:1px solid #141414;padding-top:4px;font-size:9px;color:#6a6a66}
    .sign .who{flex:none;border-top:none;padding-top:0;margin-top:3px;color:#a3a39e}
  `;
}

const table = (head: [string, boolean?][], rows: string[], foot = "") =>
  `<table class="lines"><thead><tr>${head.map(([h, r]) => `<th${r ? ' class="r"' : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}${foot}</tbody></table>`;

/** The report as HTML — pure, so it can be tested without a browser. */
export function buildMoReportHtml(d: MoReportData, now: Date = new Date()): { html: string; footerTemplate: string } {
  const ins = computeInsights(d);
  const stamp = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) + " · " + now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const logo = safeLogoSrc(d.logoUrl);
  const m = d.mo;

  const kpi = (k: string, v: string, s = "") => `<div class="kpi"><div class="k">${esc(k)}</div><div class="v num">${v}</div><div class="s">${s}</div></div>`;
  const kpis = [
    kpi("Made vs plan", ins.producedVsPlanPct != null ? `${ins.producedVsPlanPct}%` : "—", `${fmt.qty(ins.goodBase)} of ${fmt.qty(ins.plannedBase)} ${esc(m.baseUom)}`),
    kpi("Yield", ins.yieldPct != null ? `${ins.yieldPct}%` : "—", ins.rejectedBase > 0 ? `${fmt.qty(ins.rejectedBase)} ${esc(m.baseUom)} rejected` : "no rejects"),
    kpi("Total cost", fmt.num2(ins.costs.total), ins.costPerGoodBase != null ? `${fmt.num2(ins.costPerGoodBase)} per ${esc(m.baseUom)}` : "per-unit cost needs output"),
    kpi("Cycle time", ins.cycleHours != null ? `${fmt.qty(ins.cycleHours)} h` : "—", ins.daysLate == null ? "no due date or not finished" : ins.daysLate > 0 ? `${ins.daysLate}d after due` : "on time"),
  ].join("");

  const facts: [string, string][] = [
    ["BOM", m.bomCode || m.bomName ? [m.bomCode, m.bomName].filter(Boolean).join(" · ") : m.productName], ["Priority", m.priority], ["Scheduled", dateOrDash(m.scheduledDate)], ["Due", dateOrDash(m.dueDate)],
    ["Started", instant(m.startedAt)], ["Finished", instant(m.completedAt)], ["Created by", m.createdBy ?? "—"], ["Completions", String(d.runs.length)],
  ];

  const findingsHtml = ins.findings.length
    ? `<ul class="findings">${ins.findings.map(f => `<li class="${f.tone}">${esc(f.text)}</li>`).join("")}</ul>`
    : `<div class="muted" style="padding:6px 0">Nothing has been produced on this order yet, so there is nothing to assess.</div>`;

  const outputRows = d.outputs.map(o => {
    const diff = o.producedPacks - o.plannedPacks;
    const perPack = o.producedPacks > 0 ? o.cost / o.producedPacks : o.unitCost * o.unitContent;
    return `<tr><td>${esc(o.label)}</td><td class="nw">Pack of ${fmt.qty(o.unitContent)} ${esc(o.baseUom)}</td><td class="r num">${fmt.qty(o.plannedPacks)}</td><td class="r num">${fmt.qty(o.producedPacks)}</td>
      <td class="r num ${Math.abs(diff) < 1e-6 ? "" : diff < 0 ? "bad" : "flag"}">${Math.abs(diff) < 1e-6 ? "—" : sign(diff) + fmt.qty(diff)}</td>
      <td class="nw">${esc(o.lotNo ?? "—")}</td><td class="nw">${dateOrDash(o.bestBefore ?? o.expiryDate)}</td>
      <td class="r num">${perPack > 0 ? fmt.num2(perPack) : "—"}</td><td class="r num">${o.cost > 0 ? fmt.num2(o.cost) : "—"}</td></tr>`;
  });
  const outputTotal = sum(d.outputs.map(o => o.cost));

  // Materials grouped by what they are for: ingredients (shared by every pack), then packaging per output pack.
  // Each row says what unit its numbers are in and what one unit cost.
  const matRow = (i: number) => {
    const v = ins.materialVariances[i]; const mat = d.materials[i];
    const subs = mat.substitutes.length ? `<div class="muted" style="font-size:9px">Substituted with ${esc(mat.substitutes.join(", "))}</div>` : "";
    const unitCost = v.used > 0 ? mat.cost / v.used : null;
    return `<tr><td>${esc(v.name)}${subs}</td><td>${esc(v.uom || "—")}</td>
      <td class="r num">${fmt.qty(v.planned)}</td><td class="r num">${fmt.qty(v.used)}</td>
      <td class="r num ${v.flagged ? "flag" : ""}">${v.variance === 0 ? "—" : `${sign(v.variance)}${fmt.qty(v.variance)}${v.pct != null ? ` (${sign(v.pct)}${v.pct}%)` : ""}`}</td>
      <td class="r num">${unitCost != null && unitCost > 0 ? `${fmt.num2(unitCost)} / ${esc(v.uom)}` : "—"}</td>
      <td class="r num">${mat.cost > 0 ? fmt.num2(mat.cost) : "—"}</td></tr>`;
  };
  const groupRow = (title: string, cost: number) =>
    `<tr><td colspan="6" style="background:#fafaf9;font-weight:700;font-size:9.5px">${esc(title)}</td><td class="r num" style="background:#fafaf9;font-weight:700">${fmt.num2(cost)}</td></tr>`;
  const idx = d.materials.map((_, i) => i);
  const groups: { title: string; ids: number[] }[] = [];
  const ing = idx.filter(i => d.materials[i].kind === "ingredient");
  if (ing.length) groups.push({ title: "Ingredients (used across every pack)", ids: ing });
  const packLabels = [...new Set(idx.filter(i => d.materials[i].kind === "packaging" && d.materials[i].forPack).map(i => d.materials[i].forPack as string))];
  for (const p of packLabels) groups.push({ title: `Packaging for ${p}`, ids: idx.filter(i => d.materials[i].kind === "packaging" && d.materials[i].forPack === p) });
  const sharedPack = idx.filter(i => d.materials[i].kind === "packaging" && !d.materials[i].forPack);
  if (sharedPack.length) groups.push({ title: "Packaging (shared across packs)", ids: sharedPack });
  const materialRows = groups.flatMap(g => [groupRow(g.title, sum(g.ids.map(i => d.materials[i].cost))), ...g.ids.map(matRow)]);

  const c = ins.costs; const base = Math.max(c.total, 0.0001);
  const seg = (v: number, col: string) => `<span style="width:${Math.max(0, (v / base) * 100).toFixed(2)}%;background:${col}"></span>`;
  const costHtml = `<div class="bar">${seg(c.material, "#141414")}${seg(c.labour, "#6b7280")}${seg(c.overhead, "#c4c4be")}</div>
    <div class="legend"><span><i style="background:#141414"></i>Materials ${fmt.num2(c.material)}</span><span><i style="background:#6b7280"></i>Labour ${fmt.num2(c.labour)}</span><span><i style="background:#c4c4be"></i>Overhead ${fmt.num2(c.overhead)}</span>${c.scrap > 0.005 ? `<span class="bad">Abnormal scrap ${fmt.num2(c.scrap)} (included above)</span>` : ""}</div>`;

  const opRows = d.operations.map(o => {
    const eff = o.actualHours != null && o.actualHours > 0 ? Math.round((o.plannedHours / o.actualHours) * 100) : null;
    return `<tr><td>${esc(o.name)}</td><td class="r num">${fmt.qty(o.plannedHours)} h</td><td class="r num">${o.actualHours != null ? fmt.qty(o.actualHours) + " h" : "<span class='muted'>not recorded</span>"}</td>
      <td class="r num ${eff != null && eff < 90 ? "flag" : ""}">${eff != null ? eff + "%" : "—"}</td></tr>`;
  });

  const lotRows = d.lots.map(l => `<tr><td>${esc(l.itemName)}${l.standsInFor ? `<div class="muted" style="font-size:9px">in place of ${esc(l.standsInFor)}</div>` : ""}</td>
    <td>${esc(l.lotNo ?? "—")}${l.supplierBatchNo ? `<div class="muted" style="font-size:9px">supplier batch ${esc(l.supplierBatchNo)}</div>` : ""}</td>
    <td>${dateOrDash(l.expiryDate)}</td><td class="r num">${fmt.qty(l.qty)} ${esc(l.uom)}</td><td class="r num">${fmt.num2(l.unitCost)}</td><td class="r num">${fmt.num2(l.cost)}</td></tr>`);

  const runRows = d.runs.map(r => `<tr><td>${esc(r.runNo ?? "—")}</td><td>${dateOrDash(r.date)}</td>
    <td class="r num">${fmt.qty(r.good)} ${esc(m.baseUom)}${r.packs ? `<div class="muted" style="font-size:9px">${esc(r.packs)}</div>` : ""}</td>
    <td class="r num ${r.rejected > 0 ? "flag" : ""}">${r.rejected > 0 ? fmt.qty(r.rejected) : "—"}</td><td>${esc(r.rejectReason ?? (r.rejected > 0 ? "Not recorded" : "—"))}</td>
    <td class="r num">${fmt.num2(r.materialCost + r.labourCost + r.overheadCost)}</td></tr>`);

  const section = (title: string, body: string) => `<h2>${esc(title)}</h2>${body}`;
  const html = `<!doctype html><html><head><meta charset="utf-8" /><style>${css()}</style></head><body>
    <div class="head">
      <div>${logo ? `<img class="logo" src="${logo}" alt="" />` : `<div class="mono">${esc(monogram(d.orgName))}</div>`}
        <div class="org">${esc(d.orgName)}</div><div class="label">Manufacturing order report</div></div>
      <div class="meta-r"><div class="label">Order</div><div style="font-weight:800;font-size:14px">${esc(m.moNo)}</div>
        <div style="margin-top:4px"><span class="pill">${esc(STATUS_LABEL[m.status] ?? m.status)}</span></div></div>
    </div>
    <div class="accentbar"></div>
    <div class="facts">${facts.map(([k, v]) => `<div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join("")}</div>
    <div class="kpis">${kpis}</div>
    ${section("What stood out", findingsHtml)}
    ${section("Output", table([["Product"], ["Unit"], ["Planned", true], ["Produced", true], ["Difference", true], ["Lot"], ["Best before"], ["Unit cost", true], ["Cost", true]], outputRows,
      `<tr class="tot"><td colspan="8">Total output cost</td><td class="r num">${fmt.num2(outputTotal)}</td></tr>`))}
    ${section("Materials: planned vs used", table([["Material"], ["Unit"], ["Planned", true], ["Used", true], ["Variance", true], ["Unit cost", true], ["Cost", true]], materialRows,
      `<tr class="tot"><td colspan="6">Total material cost</td><td class="r num">${fmt.num2(c.material)}</td></tr>`))}
    ${section("Cost build-up", costHtml)}
    ${d.operations.length ? section("Operations: planned vs actual hours", table([["Operation"], ["Planned", true], ["Actual", true], ["Efficiency", true]], opRows)) : ""}
    ${d.runs.length ? section("Completions", `<div class="muted" style="padding:2px 2px 0;font-size:9.5px">Each completion is one posting of finished stock against this order. The production run number (BUILD-…) is its reference in the stock and ledger records.</div>`
      + table([["Production run"], ["Date"], ["Good output", true], ["Rejected", true], ["Reject reason"], ["Cost", true]], runRows)) : ""}
    ${d.lots.length ? section("Lot traceability: what went into this order", table([["Item"], ["Lot"], ["Expiry"], ["Quantity", true], ["Unit cost", true], ["Cost", true]], lotRows)) : ""}
    ${m.notes ? section("Notes", `<div style="padding:4px 2px">${esc(m.notes)}</div>`) : ""}
    <div class="sign"><div>Prepared by (signature)<div class="who">Name:</div></div><div>Reviewed by (signature)<div class="who">Name:</div></div><div>Date</div></div>
  </body></html>`;

  const footerTemplate = `<div style="width:100%;font-size:7.5px;color:#8a8f99;padding:0 14mm;display:flex;justify-content:space-between;font-family:Arial,sans-serif">
    <span>${esc(d.orgName)} · MO ${esc(m.moNo)}</span><span class="pageNumber"></span><span>Generated ${esc(stamp)}</span></div>`;
  return { html, footerTemplate };
}

/** SERVER-ONLY: the report PDF through the shared headless-Chromium engine. */
export async function buildMoReportPdf(d: MoReportData): Promise<Buffer> {
  const { html, footerTemplate } = buildMoReportHtml(d);
  return renderHtmlToPdf(html, { footerTemplate });
}
