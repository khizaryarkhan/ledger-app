/**
 * Aged Receivables / Payables → export model: the bucket summary, then the
 * documents the screen is currently showing (after the user's sort and
 * column filters). PURE.
 */
import { num, type ExportRow, type ReportExportModel } from "../export-model";

export const AGING_BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
export const AGING_BUCKET_LABEL: Record<string, string> = { current: "Current", "1-30": "1–30", "31-60": "31–60", "61-90": "61–90", "90+": "90+" };

export interface AgingInfo {
  side: "receivable" | "payable";
  asOf: string;
  entity: string;
  currency: string | null;
  asOfLine: string;
}

export function buildAgingModel(data: any, shownRows: any[], info: AgingInfo): ReportExportModel {
  const isAR = info.side === "receivable";
  const all: any[] = data?.rows ?? [];

  const summary: ExportRow[] = AGING_BUCKETS.map((b): ExportRow => ({
    kind: "line",
    cells: [`${AGING_BUCKET_LABEL[b]}${b === "current" ? "" : " days"}`, num(data?.buckets?.[b])],
  }));
  summary.push({ kind: "total", cells: [`Total ${isAR ? "receivable" : "payable"}`, num(data?.total)] });

  const docs: ExportRow[] = shownRows.map((r): ExportRow => ({
    kind: "line",
    cells: [r.docNumber ?? null, r.party ?? null, r.dueDate ?? null, AGING_BUCKET_LABEL[r.bucket] ?? r.bucket ?? null, num(r.total), num(r.open)],
  }));
  docs.push({ kind: "total", cells: [`Total ${isAR ? "receivable" : "payable"}`, null, null, null, null, num(data?.total)] });

  const notes: string[] = [];
  if (shownRows.length !== all.length) {
    notes.push(`Filtered view: ${shownRows.length} of ${all.length} documents are listed. The totals above are for all ${all.length}.`);
  }

  return {
    title: isAR ? "Aged Receivables" : "Aged Payables",
    formalTitle: isAR ? "Aged Receivables" : "Aged Payables",
    entity: info.entity,
    currency: info.currency,
    periodLine: info.asOfLine,
    params: [{ label: "As of", value: info.asOf }],
    sections: [
      { heading: "Summary", columns: [{ key: "bucket", label: "Age", kind: "text" }, { key: "amount", label: "Amount", kind: "money" }], rows: summary },
      {
        heading: "Documents",
        columns: [
          { key: "doc", label: "Doc", kind: "text" },
          { key: "party", label: isAR ? "Customer" : "Supplier", kind: "text" },
          { key: "due", label: "Due", kind: "date" },
          { key: "age", label: "Age", kind: "text" },
          { key: "total", label: "Total", kind: "money" },
          { key: "open", label: "Open", kind: "money" },
        ],
        rows: docs,
      },
    ],
    notes,
    fileBase: isAR ? "Aged-Receivables" : "Aged-Payables",
  };
}
