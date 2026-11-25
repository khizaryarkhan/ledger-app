/**
 * Currency Exposure & FX Revaluation → export model. PURE.
 *
 * The screen revalues each balance at the rate typed into its "Rate now" box, so the export is built from the rows
 * AFTER that revaluation, in the order/filter the list is showing, and states the rates used.
 */
import { num, type ExportRow, type ReportExportModel } from "../export-model";

export interface FxInfo {
  entity: string;
  asOf: string;
  asOfLine: string;
  /** Rates currently entered on screen, currency → raw text. */
  rates: Record<string, string>;
}

/** The screen's own revaluation, so screen and export share one definition. */
export function revalueRow(r: any, rates: Record<string, string>) {
  const rate = Number(rates[r.currency]);
  const revalued = rate > 0 ? Math.round(r.foreignBalance * rate * 100) / 100 : r.homeCarrying;
  return { ...r, revalued, gl: Math.round((revalued - r.homeCarrying) * 100) / 100 };
}

/** data = the API response; shown = the revalued rows the list is showing (after its sort and filters). */
export function buildFxModel(data: any, shown: any[], info: FxInfo): ReportExportModel {
  const all: any[] = data?.rows ?? [];
  const home: string = data?.home ?? "";

  const rows: ExportRow[] = shown.map((r): ExportRow => {
    const rate = Number(info.rates[r.currency]);
    return {
      kind: "line",
      cells: [r.accountName ?? null, r.currency ?? null, num(r.foreignBalance), num(r.homeCarrying), rate > 0 ? num(rate) : null, num(r.revalued), num(r.gl)],
    };
  });
  const totalGL = shown.reduce((s, r) => s + (Number(r.gl) || 0), 0);
  if (shown.length > 0) {
    rows.push({ kind: "total", cells: ["Total unrealised FX gain / (loss)", null, null, null, null, null, num(totalGL)] });
  }

  const currencies = Array.from(new Set(shown.map((r) => r.currency as string))).sort();
  const notes: string[] = [
    "Revalued amounts use the rates entered on screen at the time of export; a currency with no rate (or a rate of zero) stays at its booked value. This is a position report, nothing is posted to the ledger.",
  ];
  if (shown.length !== all.length) {
    notes.push(`Filtered view: ${shown.length} of ${all.length} balances are listed, and the total covers only those.`);
  }

  return {
    title: "Currency Exposure & FX Revaluation",
    entity: info.entity,
    currency: home || null,
    periodLine: info.asOfLine,
    params: [
      { label: "As of", value: info.asOf },
      { label: "Home currency", value: home },
      ...currencies.map((c) => ({ label: `Rate now ${c}`, value: info.rates[c] ?? "" })),
    ],
    sections: [{
      columns: [
        { key: "account", label: "Account", kind: "text" },
        { key: "ccy", label: "Ccy", kind: "text" },
        { key: "foreign", label: "Foreign balance", kind: "money" },
        { key: "booked", label: `Booked (${home})`, kind: "money" },
        { key: "rate", label: "Rate now", kind: "qty" },
        { key: "revalued", label: "Revalued", kind: "money" },
        { key: "gl", label: "Unrealised G/(L)", kind: "money" },
      ],
      rows,
    }],
    notes,
    fileBase: "Currency-Exposure",
  };
}
