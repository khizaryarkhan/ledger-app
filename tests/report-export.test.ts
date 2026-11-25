import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ExcelJS from "exceljs";
import {
  EXPORT_LIMITS, exportFileName, num, numOrBlank, safeSheetName, totalRows,
  type ReportExportModel,
} from "@/lib/reports/export-model";
import { parseReportModel } from "@/lib/reports/export-schema";
import { buildReportHtml, esc, formatCell, safeLogo } from "@/lib/reports/export-html";
import { buildReportWorkbook, excelDateSerial } from "@/lib/reports/export-excel";
import {
  buildBalanceSheetModel, buildMultiProfitLossModel, buildProfitLossModel, buildTrialBalanceModel, buildStatementModel,
  type StatementInfo,
} from "@/lib/reports/builders/statements";
import { buildGeneralLedgerModel } from "@/lib/reports/builders/general-ledger";
import { buildAgingModel } from "@/lib/reports/builders/aging";
import { buildCashFlowModel } from "@/lib/reports/builders/cash-flow";
import { buildBudgetModel, groupTotal, varianceOf } from "@/lib/reports/builders/budget";
import { computeVariance, type VarianceRow } from "@/lib/accounting/budgets";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const info: StatementInfo = {
  title: "Profit & Loss", formalTitle: "Statement of Profit or Loss", entity: "Acme Ltd", currency: "EUR",
  periodLine: "For the period 01 Jul 2026 to 20 Nov 2026", params: [], fileBase: "Profit-and-Loss",
};

const PL = {
  sections: [
    { lines: [{ name: "Sales", amount: 1000.5 }, { name: "Cleared account", amount: 0.001 }], total: 1000.5 },
    { lines: [{ name: "COGS", amount: 400 }], total: 400 },
  ],
  grossProfit: 600.5,
  otherIncome: { lines: [], total: 0 },
  operatingExpenses: { lines: [{ name: "Rent", amount: 100.25 }], total: 100.25 },
  financeCosts: { lines: [], total: 0 },
  profitBeforeTax: 500.25,
  taxation: { lines: [], total: 0 },
  netProfit: 500.25,
};

const cellsOf = (m: ReportExportModel, label: string) => m.sections.flatMap((s) => s.rows).find((r) => r.cells[0] === label)?.cells;

async function sheetOf(model: ReportExportModel) {
  const buf = await buildReportWorkbook(model, { orgName: "Acme Ltd", generatedOn: "2026-11-20" });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  return wb.worksheets[0];
}
function rowByFirstCell(ws: ExcelJS.Worksheet, label: string) {
  let found: ExcelJS.Row | undefined;
  ws.eachRow((r) => { if (!found && r.getCell(1).value === label) found = r; });
  return found;
}

describe("export model helpers", () => {
  it("sheet names respect Excel's rules", () => {
    expect(safeSheetName("Profit & Loss")).toBe("Profit & Loss");
    expect(safeSheetName("A/B:C*D?[E]\\F")).not.toMatch(/[\[\]:*?/\\]/);
    expect(safeSheetName("x".repeat(80)).length).toBe(31);
    expect(safeSheetName("   ")).toBe("Report");
  });

  it("file names are safe and carry the run date", () => {
    const m = { fileBase: "Profit & Loss/../x" } as ReportExportModel;
    expect(exportFileName(m, "2026-11-20", "xlsx")).toBe("Profit-Loss-..-x_2026-11-20.xlsx");
    expect(exportFileName(m, "not a date", "pdf")).not.toContain("_");
  });

  it("never lets NaN or Infinity reach a cell, and blanks effectively-zero amounts", () => {
    expect(num(NaN)).toBeNull();
    expect(num(Infinity)).toBeNull();
    expect(num("12.5")).toBe(12.5);
    expect(num(1234.5600000000002)).toBe(1234.56); // float noise from a computed sum never reaches a cell
    expect(num(1.234567)).toBe(1.234567);          // but a 6dp unit cost keeps every digit
    expect(numOrBlank(0.001)).toBeNull();
    expect(numOrBlank(-3)).toBe(-3);
  });
});

describe("the PDF route's validation", () => {
  const good = {
    title: "T", entity: "E", currency: "EUR", params: [], notes: [], fileBase: "T",
    sections: [{ columns: [{ key: "a", label: "A", kind: "text" }, { key: "b", label: "B", kind: "money" }], rows: [{ kind: "line", cells: ["x", 1] }] }],
  };
  it("accepts a well-formed model", () => { expect(parseReportModel(good).ok).toBe(true); });
  it("refuses a row whose cell count does not match its columns", () => {
    const bad = { ...good, sections: [{ ...good.sections[0], rows: [{ kind: "line", cells: ["x"] }] }] };
    expect(parseReportModel(bad).ok).toBe(false);
  });
  it("refuses a report too long for a PDF", () => {
    const rows = Array.from({ length: EXPORT_LIMITS.pdfRows + 1 }, () => ({ kind: "line", cells: ["x", 1] }));
    expect(parseReportModel({ ...good, sections: [{ ...good.sections[0], rows }] }).ok).toBe(false);
  });
  it("refuses unknown cell kinds and non-finite numbers", () => {
    expect(parseReportModel({ ...good, sections: [{ ...good.sections[0], rows: [{ kind: "line", cells: ["x", Infinity] }] }] }).ok).toBe(false);
    expect(parseReportModel({ ...good, sections: [{ columns: [{ key: "a", label: "A", kind: "evil" }], rows: [] }] }).ok).toBe(false);
  });
});

describe("HTML (PDF and Print)", () => {
  it("escapes every dynamic string", () => {
    expect(esc(`<script>alert("x")</script>'&`)).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&#39;&amp;");
    const m: ReportExportModel = {
      title: "<b>T</b>", entity: "<img onerror=x>", currency: null, params: [{ label: "<l>", value: "<v>" }], notes: ["<n>"], fileBase: "T",
      sections: [{ heading: "<h>", columns: [{ key: "a", label: "<c>", kind: "text" }], rows: [{ kind: "line", cells: ["<script>"] }] }],
    };
    const { html } = buildReportHtml(m, { orgName: "<org>", generatedOn: "2026-11-20" });
    expect(html).not.toMatch(/<script|<img onerror|<b>T|<org>|<n>|<v>|<c>|<h>/);
  });

  it("formats numbers by the app's rule and dates literally", () => {
    expect(formatCell("money", 1234.5)).toBe("1,234.50");
    expect(formatCell("money", -100)).toBe("(100.00)");
    expect(formatCell("money", 1.234567)).toBe("1.234567");
    expect(formatCell("variance", 1.5)).toBe("+1.50");
    expect(formatCell("variance", -2)).toBe("−2.00");
    expect(formatCell("date", "2026-09-15")).toBe("15 Sep 2026");
    expect(formatCell("money", null)).toBe("");
    expect(formatCell("money", "—")).toBe("—");
  });

  it("goes landscape only for wide reports", () => {
    const cols = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `c${i}`, label: `C${i}`, kind: "money" as const }));
    const mk = (n: number): ReportExportModel => ({ title: "T", entity: "E", currency: null, params: [], notes: [], fileBase: "T", sections: [{ columns: cols(n), rows: [] }] });
    expect(buildReportHtml(mk(3), { orgName: "O", generatedOn: "2026-11-20" }).html).toContain("size:A4;");
    expect(buildReportHtml(mk(9), { orgName: "O", generatedOn: "2026-11-20" }).html).toContain("A4 landscape");
  });

  it("only accepts https or inline raster logos", () => {
    expect(safeLogo("https://x.test/logo.png")).toBe("https://x.test/logo.png");
    expect(safeLogo("javascript:alert(1)")).toBeNull();
    expect(safeLogo("data:image/svg+xml;base64,AAAA")).toBeNull();
    expect(safeLogo("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
  });
});

describe("Excel", () => {
  it("date serials come from the literal date, with no timezone", () => {
    expect(excelDateSerial("2000-01-01")).toBe(36526);
    expect(excelDateSerial("1900-03-01")).toBe(61);
    expect(excelDateSerial("2026-09-15T00:00:00.000Z")).toBe(excelDateSerial("2026-09-15"));
    expect(excelDateSerial("garbage")).toBeNull();
  });

  it("writes real numbers with the app's number format, and the same totals as the screen", async () => {
    const m = buildProfitLossModel(PL, info);
    const ws = await sheetOf(m);
    const sales = rowByFirstCell(ws, "Sales")!;
    expect(sales.getCell(2).value).toBe(1000.5);
    expect(sales.getCell(2).numFmt).toContain("0.00####");
    expect(rowByFirstCell(ws, "Net Profit for the Period")!.getCell(2).value).toBe(PL.netProfit);
    expect(rowByFirstCell(ws, "Gross Profit")!.getCell(2).value).toBe(PL.grossProfit);
  });

  it("writes dates as date cells and never evaluates text as a formula", async () => {
    const m: ReportExportModel = {
      title: "T", entity: "E", currency: null, params: [], notes: [], fileBase: "T",
      sections: [{ columns: [{ key: "d", label: "Date", kind: "date" }, { key: "n", label: "Name", kind: "text" }], rows: [{ kind: "line", cells: ["2000-01-01", "=1+1"] }] }],
    };
    const ws = await sheetOf(m);
    let dateCell: ExcelJS.Cell | undefined, nameCell: ExcelJS.Cell | undefined;
    // A date-formatted numeric cell reads back as a date; it must be exactly the literal date written.
    ws.eachRow((r) => { const v = r.getCell(1).value; if (v instanceof Date) { dateCell = r.getCell(1); nameCell = r.getCell(2); } });
    expect((dateCell!.value as Date).toISOString().slice(0, 10)).toBe("2000-01-01");
    expect(dateCell!.numFmt).toBe("dd mmm yyyy");
    expect(nameCell!.value).toBe("=1+1");
    expect(typeof nameCell!.value).toBe("string");
  });

  it("refuses to build a workbook beyond the row cap", async () => {
    const rows = Array.from({ length: EXPORT_LIMITS.excelRows + 1 }, () => ({ kind: "line" as const, cells: ["x"] }));
    const m: ReportExportModel = { title: "T", entity: "E", currency: null, params: [], notes: [], fileBase: "T", sections: [{ columns: [{ key: "a", label: "A", kind: "text" }], rows }] };
    await expect(buildReportWorkbook(m, { orgName: "O", generatedOn: "2026-11-20" })).rejects.toThrow(/more than/);
  });
});

describe("statement builders match what the screen shows", () => {
  it("Profit & Loss: hides lines that net to zero, keeps the response's own totals", () => {
    const m = buildProfitLossModel(PL, info);
    expect(m.sections[0].rows.some((r) => r.cells[0] === "Cleared account")).toBe(false);
    expect(cellsOf(m, "Total Revenue")![1]).toBe(1000.5);
    expect(cellsOf(m, "Net Profit for the Period")![1]).toBe(500.25);
    expect(totalRows(m)).toBeGreaterThan(5);
  });

  it("Profit & Loss with nothing posted says so instead of exporting an empty sheet", () => {
    const empty = { ...PL, sections: [{ lines: [], total: 0 }, { lines: [], total: 0 }], operatingExpenses: { lines: [], total: 0 } };
    const m = buildProfitLossModel(empty, info);
    expect(m.sections[0].rows).toEqual([]);
    expect(m.notes.join(" ")).toMatch(/No posted ledger entries/);
  });

  it("Balance Sheet: totals over ALL lines (as the screen does) and flags an imbalance", () => {
    const bs = {
      assets: { nonCurrent: [{ name: "Plant", amount: 500 }, { name: "Zero", amount: 0 }], current: [{ name: "Cash", amount: 250.75 }], total: 750.75 },
      equity: { lines: [{ name: "Capital", amount: 700 }], total: 700 },
      liabilities: { nonCurrent: [], current: [{ name: "Payables", amount: 50.75 }] },
      provisions: { nonCurrent: [], current: [] },
      totalEquityAndLiabilities: 750.75, balanced: true,
    };
    const m = buildBalanceSheetModel(bs, info);
    expect(cellsOf(m, "Total Non-current Assets")![1]).toBe(500);
    expect(cellsOf(m, "Total Assets")![1]).toBe(750.75);
    expect(cellsOf(m, "Total Equity & Liabilities")![1]).toBe(750.75);
    expect(m.notes).toEqual([]);
    expect(buildBalanceSheetModel({ ...bs, balanced: false }, info).notes[0]).toMatch(/Does not balance/);
  });

  it("Trial Balance: debits and credits stay in their own columns", () => {
    const tb = { rows: [{ code: "1000", name: "Cash", debit: 100, credit: 0 }, { code: "2000", name: "Payables", debit: 0, credit: 100 }], totalDebit: 100, totalCredit: 100, balanced: true };
    const m = buildTrialBalanceModel(tb, info);
    expect(m.sections[0].rows[0].cells).toEqual(["1000", "Cash", 100, null]);
    expect(m.sections[0].rows[1].cells).toEqual(["2000", "Payables", null, 100]);
    expect(m.sections[0].rows.at(-1)!.cells).toEqual([null, "Total", 100, 100]);
  });

  it("multi-column: a zero cell is blank, totals are kept, one value per column", () => {
    const blk = (rows: any[], totals: number[]) => ({ rows, totals });
    const t = {
      columns: [{ key: "c0", label: "Jul 2026" }, { key: "c1", label: "Aug 2026" }],
      revenue: blk([{ name: "Sales", values: [100, 0] }], [100, 0]),
      costOfSales: blk([], [0, 0]), grossProfit: [100, 0],
      otherIncome: blk([], [0, 0]), operatingExpenses: blk([], [0, 0]), financeCosts: blk([], [0, 0]),
      profitBeforeTax: [100, 0], taxation: blk([], [0, 0]), netProfit: [100, 0],
    };
    const m = buildMultiProfitLossModel(t, info);
    expect(m.sections[0].columns.map((c) => c.label)).toEqual(["Account", "Jul 2026", "Aug 2026"]);
    expect(cellsOf(m, "Sales")).toEqual(["Sales", 100, null]);
    expect(cellsOf(m, "Total Revenue")).toEqual(["Total Revenue", 100, 0]);
    expect(m.sections[0].rows.every((r) => r.cells.length === 3)).toBe(true);
    expect(buildStatementModel("profit-loss", { table: t }, info, true).sections[0].columns.length).toBe(3);
  });
});

describe("General Ledger builder", () => {
  const data = {
    meta: { entity: "Acme Ltd", currency: "EUR" },
    accounts: [{
      account: { id: "a1", code: "1000", name: "Cash" }, opening: 10, closing: 35,
      rows: [
        { date: "2026-07-01", sourceType: "Invoice", docNumber: "INV-1", name: "Bob", memo: "July", debit: 25, credit: 0, balance: 35, currency: "USD", fxDebit: 27, exchangeRate: 1.08 },
      ],
    }],
  };
  it("emits opening, postings and closing for each account, with literal dates", () => {
    const m = buildGeneralLedgerModel(data, { title: "General Ledger", periodLine: "p", params: [], showFx: false });
    const rows = m.sections[0].rows;
    expect(m.sections[0].heading).toBe("1000 · Cash");
    expect(rows[0].cells[3]).toBe("Opening balance");
    expect(rows[0].cells[6]).toBe(10);
    expect(rows[1].cells[0]).toBe("2026-07-01");
    expect(rows[1].cells[2]).toBe("INV-1");
    expect(rows[1].cells[3]).toBe("Bob · July");
    expect(rows.at(-1)!.cells[6]).toBe(35);
    expect(m.sections[0].columns.length).toBe(7);
  });
  it("adds foreign-currency columns only when asked and present", () => {
    const m = buildGeneralLedgerModel(data, { title: "General Ledger", periodLine: "p", params: [], showFx: true });
    expect(m.sections[0].columns.length).toBe(10);
    expect(m.sections[0].rows[1].cells.slice(7)).toEqual([27, "USD", 1.08]);
    const none = { ...data, accounts: [{ ...data.accounts[0], rows: [{ ...data.accounts[0].rows[0], currency: null }] }] };
    expect(buildGeneralLedgerModel(none, { title: "G", periodLine: "p", params: [], showFx: true }).sections[0].columns.length).toBe(7);
  });
  it("a ledger with no postings still exports a header-only section and says so", () => {
    const m = buildGeneralLedgerModel({ meta: {}, accounts: [] }, { title: "G", periodLine: "p", params: [], showFx: false });
    expect(m.sections.length).toBe(1);
    expect(m.notes[0]).toMatch(/No postings/);
  });
});

describe("Aging, cash flow and budget builders", () => {
  const aging = {
    rows: [{ docNumber: "INV-1", party: "Bob", dueDate: "2026-09-01", bucket: "1-30", total: 100, open: 60 }, { docNumber: "INV-2", party: "Sue", dueDate: "2026-10-01", bucket: "current", total: 40, open: 40 }],
    buckets: { current: 40, "1-30": 60, "31-60": 0, "61-90": 0, "90+": 0 }, total: 100,
  };
  const aInfo = { side: "receivable" as const, asOf: "2026-11-20", entity: "Acme", currency: "EUR", asOfLine: "As at 20 Nov 2026" };

  it("aging: summary total is the response's, and a filtered view is called out", () => {
    const all = buildAgingModel(aging, aging.rows, aInfo);
    expect(all.sections[0].rows.at(-1)!.cells[1]).toBe(100);
    expect(all.notes).toEqual([]);
    const some = buildAgingModel(aging, [aging.rows[0]], aInfo);
    expect(some.notes[0]).toMatch(/1 of 2/);
    expect(some.sections[1].rows[0].cells).toEqual(["INV-1", "Bob", "2026-09-01", "1–30", 100, 60]);
  });

  it("cash flow: ties to the response and warns when it does not reconcile", () => {
    const d = { netIncome: 100, operating: [{ name: "AR", amount: -20 }], operatingTotal: -20, investing: [], investingTotal: 0, financing: [], financingTotal: 0, netChange: 80, openingCash: 10, closingCash: 90, reconciles: false };
    const m = buildCashFlowModel(d, { entity: "Acme", currency: "EUR", periodLine: "p", from: "2026-01-01", to: "2026-11-20" });
    expect(cellsOf(m, "Cash at end")![1]).toBe(90);
    expect(cellsOf(m, "Net cash from operating activities")![1]).toBe(-20);
    expect(m.notes[0]).toMatch(/does not tie/);
  });

  const mk = (id: string, kind: "income" | "expense", b: number, a: number): VarianceRow => ({
    accountId: id, name: id, code: null, kind, months: { 1: computeVariance(b, a, kind) }, total: computeVariance(b, a, kind),
  });
  it("budget: group totals use the shared helper, so screen and export round identically", () => {
    const income = [mk("Sales", "income", 1000, 1200)];
    const expense = [mk("Rent", "expense", 500, 450)];
    expect(groupTotal(income).variance).toBe(200);
    expect(groupTotal(income).pct).toBe(20);
    expect(groupTotal(expense).variance).toBe(-50);
    const profit = varianceOf(500, 750, "profit");
    const m = buildBudgetModel({ rows: [...income, ...expense], profit, months: [{ month: 1, label: "Jan" }] },
      { entity: "Acme", currency: "EUR", budgetName: "FY26", periodLine: "Jan – Jan 2026", byMonth: true });
    expect(cellsOf(m, "Total income")!.slice(1, 5)).toEqual([1000, 1200, 200, 20]);
    expect(cellsOf(m, "Total expenses")!.slice(1, 5)).toEqual([500, 450, -50, -10]);
    expect(cellsOf(m, "Profit")!.slice(1, 5)).toEqual([500, 750, 250, 50]);
    expect(m.sections[0].columns.map((c) => c.label)).toEqual(["Account", "Budget", "Actual", "Variance", "Var %", "Jan"]);
  });

  it("budget: an unfavourable variance is flagged, and Excel and the PDF both show it in red", async () => {
    const over = [mk("Rent", "expense", 500, 600)];   // expense above budget: unfavourable
    const under = [mk("Hosting", "expense", 500, 400)]; // expense below budget: favourable
    const m = buildBudgetModel({ rows: [...over, ...under], profit: varianceOf(-1000, -1000, "profit"), months: [{ month: 1, label: "Jan" }] },
      { entity: "Acme", currency: "EUR", budgetName: "FY26", periodLine: "p", byMonth: false });
    const rent = m.sections[0].rows.find((r) => r.cells[0] === "Rent")!;
    const host = m.sections[0].rows.find((r) => r.cells[0] === "Hosting")!;
    expect(rent.flags).toEqual([false, false, false, true, true]);
    expect(host.flags).toEqual([false, false, false, false, false]);
    expect(parseReportModel({ title: "T", entity: "E", currency: null, params: [], notes: [], fileBase: "T", sections: m.sections }).ok).toBe(true);

    const ws = await sheetOf(m);
    expect((rowByFirstCell(ws, "Rent")!.getCell(4).font as any).color?.argb).toBe("FFB91C1C");
    expect((rowByFirstCell(ws, "Hosting")!.getCell(4).font as any).color).toBeUndefined();
    expect(buildReportHtml(m, { orgName: "Acme", generatedOn: "2026-11-20" }).html).toContain('class="r x"');
  });

  it("the PDF says what it is, and names the org when the entity differs", () => {
    const m: ReportExportModel = { title: "T", entity: "Some Other Ltd", currency: null, params: [], notes: [], fileBase: "T", sections: [{ columns: [{ key: "a", label: "A", kind: "text" }], rows: [] }] };
    const { html } = buildReportHtml(m, { orgName: "Acme", generatedOn: "2026-11-20" });
    expect(html).toContain("not an attested or audited statement");
    expect(html).toContain("Prepared in Acme");
  });
});

describe("report export plumbing", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(f)) out.push(p);
    }
    return out;
  }

  it("nothing in lib/reports builds a Date or reads the clock: a date is a date", () => {
    for (const f of walk(join(ROOT, "lib/reports"))) {
      const src = read(relative(ROOT, f)).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      expect(src, `${relative(ROOT, f)} builds a Date or reads the clock`).not.toMatch(/new Date\(|Date\.now\(|toISOString|toLocaleDateString/);
    }
  });

  it("no report page loads a spreadsheet library itself; exports go through lib/reports", () => {
    const pages = [
      ...walk(join(ROOT, "app/(app)/accounting/reports")),
      join(ROOT, "components/cash-flow-report.tsx"),
      join(ROOT, "components/finance-reports.tsx"),
    ];
    for (const f of pages) expect(readFileSync(f, "utf8"), relative(ROOT, f)).not.toMatch(/from\s+["'](xlsx|exceljs)["']|import\(\s*["'](xlsx|exceljs)["']/);
  });

  it("the shell shows the menu only when a report hands it a model", () => {
    const ui = read("components/ui.tsx");
    expect(ui).toMatch(/exportModel\?: ReportExportModel \| null/);
    expect(ui).toMatch(/exportModel !== undefined && <ReportExportMenu model=\{exportModel\}/);
  });

  it("every Phase 1 report passes its export model to the shell", () => {
    for (const rel of [
      "app/(app)/accounting/reports/[statement]/page.tsx",
      "app/(app)/accounting/reports/general-ledger/page.tsx",
      "app/(app)/accounting/reports/budget-vs-actual/page.tsx",
      "components/cash-flow-report.tsx",
    ]) expect(read(rel), rel).toMatch(/exportModel=\{exportModel\}/);
    expect(read("components/finance-reports.tsx")).toMatch(/loading=\{data === null\} exportModel=\{exportModel\}/);
  });

  it("the PDF route validates the model, takes the org from the record, and is closed to AI connections", () => {
    const src = read("app/api/print/report/route.ts");
    expect(src).toMatch(/parseReportModel\(/);
    expect(src).toMatch(/isAiCall\(session\)/);
    expect(src).toMatch(/sameOrigin\(req\)/);
    expect(src).toMatch(/rateLimit\(/);
    expect(src).toMatch(/from\(organisations\)/);
    expect(src, "the org name or logo must never come from the request body").not.toMatch(/body\??\.(orgName|logoUrl|logo)/);
  });

  it("a report cannot be exported over stale or mismatched data", () => {
    // Cash Flow and Aging clear their data before refetching, so the menu is disabled while a new period loads.
    expect(read("components/cash-flow-report.tsx")).toMatch(/async function load\(\) \{ setD\(null\); setD\(await/);
    expect(read("components/finance-reports.tsx")).toMatch(/async function load\(\) \{ setData\(null\); setData\(await/);
    expect(read("components/finance-reports.tsx")).toMatch(/data\.failed \|\| data\.error/);
    // GL and Budget store the selection their data was fetched with and compare it to the current one.
    expect(read("app/(app)/accounting/reports/general-ledger/page.tsx")).toMatch(/dataKey !== queryString\(\)/);
    expect(read("app/(app)/accounting/reports/budget-vs-actual/page.tsx")).toMatch(/dataKey !== `\$\{budgetId\}\|\$\{fromM\}\|\$\{toM\}`/);
  });

  it("the PDF route bounds the body by declared and real size and records a content hash", () => {
    const src = read("app/api/print/report/route.ts");
    expect(src).toMatch(/content-length/);
    expect(src).toMatch(/Buffer\.byteLength\(text\)/);
    expect(src).toMatch(/sha256/);
    expect(src, "the server clock is UTC; the run date must come from the viewer").not.toMatch(/new Date\(/);
  });

  it("AI connections cannot reach the export routes", () => {
    expect(read("lib/mcp/policy.ts")).toMatch(/path: "\/api\/print\/report", prefix: true/);
  });
});
