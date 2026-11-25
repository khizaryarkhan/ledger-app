/**
 * General Ledger → export model. One section per account: opening balance,
 * every posting with its running balance, closing balance — exactly the rows
 * the screen draws, in the same order. PURE.
 */
import { txnTypeLabel } from "@/lib/accounting/doc-format";
import { num, type Cell, type ExportColumn, type ExportRow, type ExportSection, type ReportExportModel } from "../export-model";

export interface GeneralLedgerInfo {
  title: string;
  periodLine: string;
  params: { label: string; value: string }[];
  /** The screen's "Show foreign currency" toggle (only meaningful if some row has one). */
  showFx: boolean;
}

export function buildGeneralLedgerModel(data: any, info: GeneralLedgerInfo): ReportExportModel {
  const accounts: any[] = data?.accounts ?? [];
  const anyFx = accounts.some((a) => a.rows.some((r: any) => r.currency));
  const fx = info.showFx && anyFx;

  const columns: ExportColumn[] = [
    { key: "date", label: "Date", kind: "date" },
    { key: "type", label: "Type", kind: "text" },
    { key: "no", label: "No.", kind: "text" },
    { key: "memo", label: "Name / Memo", kind: "text" },
    { key: "debit", label: "Debit", kind: "money" },
    { key: "credit", label: "Credit", kind: "money" },
    { key: "balance", label: "Balance", kind: "money" },
    ...(fx ? [
      { key: "fx", label: "Foreign amount", kind: "money" } as ExportColumn,
      { key: "ccy", label: "Ccy", kind: "text" } as ExportColumn,
      { key: "rate", label: "Rate", kind: "qty" } as ExportColumn,
    ] : []),
  ];
  const pad = (cells: Cell[]): Cell[] => (fx ? [...cells, null, null, null] : cells);

  const sections: ExportSection[] = accounts.map((a) => {
    const rows: ExportRow[] = [
      { kind: "line", cells: pad([null, null, null, "Opening balance", null, null, num(a.opening)]) },
      ...a.rows.map((r: any): ExportRow => {
        const memo = [r.name, r.memo].filter(Boolean).join(" · ");
        const base: Cell[] = [
          r.date ?? null, txnTypeLabel(r.sourceType), r.docNumber ?? null, memo || null,
          r.debit ? num(r.debit) : null, r.credit ? num(r.credit) : null, num(r.balance),
        ];
        return {
          kind: "line",
          cells: fx ? [...base, r.currency ? num(r.fxDebit || r.fxCredit || 0) : null, r.currency ?? null, r.currency ? num(r.exchangeRate) : null] : base,
        };
      }),
      { kind: "subtotal", cells: pad([null, null, null, "Closing balance", null, null, num(a.closing)]) },
    ];
    return { heading: `${a.account.code ? `${a.account.code} · ` : ""}${a.account.name}`, columns, rows };
  });

  return {
    title: info.title,
    formalTitle: "General Ledger",
    entity: data?.meta?.entity ?? "",
    currency: data?.meta?.currency ?? null,
    periodLine: info.periodLine,
    params: info.params,
    // A report with no postings still exports a (header-only) section, never an empty workbook.
    sections: sections.length ? sections : [{ columns, rows: [] }],
    notes: sections.length ? [] : ["No postings in this period."],
    fileBase: "General-Ledger",
  };
}
