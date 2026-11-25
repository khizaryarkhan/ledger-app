/**
 * Credits & Adjustments → export model. PURE. Mirrors the screen: key figures (tiles), the three reason breakdowns,
 * the bill-capture sentence, then the document list. Amber/red cells on screen are carried as flags.
 */
import { num, type ExportRow, type ReportExportModel } from "../export-model";

export interface AdjGroup { code: string; label: string; count: number; amount: number }
export interface AdjLine { id: string; type: string; docNumber: string | null; date: string; amount: number; reason: string | null; unrecorded: boolean; memo: string | null; editedAt: string | null }
export interface AdjData {
  empty?: boolean;
  customerCredits: { count: number; amount: number; pctOfSales: number | null; byReason: AdjGroup[] };
  supplierCredits: { count: number; amount: number; pctOfPurchases: number | null; byReason: AdjGroup[] };
  journals: { count: number; amount: number; byReason: AdjGroup[] };
  billCapture: { bills: number; withReceivedDate: number; avgLagDays: number | null; over7Days: number };
  editedAfterPosting: number;
  lines: AdjLine[];
}

export const ADJ_TYPE_LABEL: Record<string, string> = { CreditNote: "Credit note", RefundReceipt: "Refund", VendorCredit: "Supplier credit", Manual: "Journal", Bill: "Bill", Expense: "Expense", Invoice: "Invoice", SalesReceipt: "Sales receipt" };

export interface AdjInfo {
  entity: string;
  currency: string | null;
  periodLine: string;
  from: string;
  to: string;
  /** The screen's own date formatter, used for the "Last edited" timestamp (a real instant, not a calendar date). */
  formatDate: (s: string) => string;
}

const EMPTY_NOTE = "No native credits, journals or bills in this period.";

export function buildCreditsAdjustmentsModel(d: AdjData | null, info: AdjInfo): ReportExportModel {
  const base = {
    title: "Credits & Adjustments",
    entity: info.entity,
    currency: info.currency,
    periodLine: info.periodLine,
    params: [{ label: "From", value: info.from }, { label: "To", value: info.to }],
    fileBase: "Credits-and-Adjustments",
  };
  // The screen's "nothing here" state: no data object with figures.
  if (!d || d.empty || !d.customerCredits) {
    return { ...base, sections: [{ columns: [{ key: "line", label: "", kind: "text" as const }], rows: [] }], notes: [EMPTY_NOTE] };
  }

  const pct = d.customerCredits.pctOfSales;
  const lag = d.billCapture.avgLagDays;
  const figures: ExportRow[] = [
    { kind: "line", cells: ["Customer credits", num(d.customerCredits.amount), num(d.customerCredits.count), num(pct), null], flags: [false, false, false, (pct ?? 0) > 5, false] },
    { kind: "line", cells: ["Supplier credits", num(d.supplierCredits.amount), num(d.supplierCredits.count), null, null] },
    { kind: "line", cells: ["Manual journals", null, num(d.journals.count), null, null] },
    { kind: "line", cells: ["Bill capture lag", null, null, null, num(lag)], flags: [false, false, false, false, (lag ?? 0) > 7] },
    { kind: "line", cells: ["Edited after posting", null, num(d.editedAfterPosting), null, null], flags: [false, false, d.editedAfterPosting > 0, false, false] },
  ];

  const reasons = (heading: string, groups: AdjGroup[]) => ({
    heading,
    columns: [
      { key: "reason", label: "Reason", kind: "text" as const },
      { key: "amount", label: "Amount", kind: "money" as const },
      { key: "count", label: "Count", kind: "int" as const },
    ],
    rows: groups.map((g): ExportRow => ({ kind: "line", cells: [g.label, num(g.amount), num(g.count)], flags: [g.code === "unrecorded", false, false] })),
  });

  const capture: ExportRow[] = [
    { kind: "line", cells: ["Bills and expenses", num(d.billCapture.bills)] },
    { kind: "line", cells: ["Carry a received date", num(d.billCapture.withReceivedDate)] },
  ];
  if (d.billCapture.over7Days) {
    capture.push({ kind: "line", cells: ["Reached you more than 7 days after their date", num(d.billCapture.over7Days)], flags: [true, true] });
  }

  const lines: ExportRow[] = d.lines.map((l): ExportRow => ({
    kind: "line",
    cells: [l.docNumber ?? null, ADJ_TYPE_LABEL[l.type] ?? l.type, l.date ?? null, num(l.amount), l.reason ?? null, l.memo ?? null, l.editedAt ? info.formatDate(l.editedAt) : null],
    flags: [false, false, false, false, !!l.unrecorded, false, false],
  }));

  const notes: string[] = [];
  const empties: [string, AdjGroup[]][] = [["Customer credits by reason", d.customerCredits.byReason], ["Supplier credits by reason", d.supplierCredits.byReason], ["Manual journals by purpose", d.journals.byReason]];
  for (const [name, g] of empties) if (g.length === 0) notes.push(`${name}: none in this period.`);
  if (d.lines.length === 0) notes.push("No documents to list.");

  return {
    ...base,
    sections: [
      {
        heading: "Key figures",
        columns: [
          { key: "measure", label: "Measure", kind: "text" },
          { key: "amount", label: "Amount", kind: "money" },
          { key: "count", label: "Count", kind: "int" },
          { key: "pct", label: "% of sales", kind: "percent" },
          { key: "days", label: "Days", kind: "qty" },
        ],
        rows: figures,
      },
      reasons("Customer credits by reason", d.customerCredits.byReason),
      reasons("Supplier credits by reason", d.supplierCredits.byReason),
      reasons("Manual journals by purpose", d.journals.byReason),
      { heading: "Bill capture", columns: [{ key: "measure", label: "Measure", kind: "text" }, { key: "count", label: "Count", kind: "int" }], rows: capture },
      {
        heading: "Documents",
        columns: [
          { key: "doc", label: "Document", kind: "text" },
          { key: "type", label: "Type", kind: "text" },
          { key: "date", label: "Date", kind: "date" },
          { key: "amount", label: "Amount", kind: "money" },
          { key: "reason", label: "Reason", kind: "text" },
          { key: "memo", label: "Memo", kind: "text" },
          { key: "edited", label: "Last edited", kind: "text" },
        ],
        rows: lines,
      },
    ],
    notes,
  };
}
