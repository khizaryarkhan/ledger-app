/**
 * Stock vs GL → export model. PURE. Mirrors the screen: the inventory-account table (after the user's sort/filters),
 * the "no account mapped" line, a total over ALL accounts, then the open-orders-vs-WIP table.
 * A difference the screen colours red (anything at or above half a cent) is flagged.
 */
import { num, type Cell, type ExportRow, type ReportExportModel } from "../export-model";

export interface StockVsGlRow { accountId: string; accountName: string; accountCode: string | null; groups: string[]; stockValue: number; glBalance: number; difference: number }
export interface StockVsGlWip { accountId: string; accountName: string; accountCode: string | null; openOrdersValue: number; glBalance: number; difference: number }
export interface StockVsGlData { rows: StockVsGlRow[]; wip: StockVsGlWip[]; unassignedValue: number }

export interface StockVsGlInfo {
  entity: string;
  currency: string | null;
  asAt: string;
  asAtLine: string;
}

const off = (d: number) => Math.abs(d) >= 0.005;
const label = (code: string | null, name: string) => (code ? `${code} ${name}` : name);

export function buildStockVsGlModel(data: StockVsGlData, shownAccounts: StockVsGlRow[], shownWip: StockVsGlWip[], info: StockVsGlInfo): ReportExportModel {
  const notes: string[] = [];

  const acct: ExportRow[] = shownAccounts.map((r): ExportRow => ({
    kind: "line",
    cells: [label(r.accountCode, r.accountName), r.groups.join(", ") || null, num(r.stockValue), num(r.glBalance), num(r.difference)],
    flags: [false, false, false, false, off(r.difference)],
  }));
  if (data.unassignedValue !== 0) {
    acct.push({ kind: "line", cells: ["Stock whose group has no inventory account mapped", null, num(data.unassignedValue), null, null], flags: [true, false, true, false, false] });
  }
  if (shownAccounts.length > 0) {
    const tot = data.rows.reduce((s, r) => ({ stock: s.stock + r.stockValue, gl: s.gl + r.glBalance, diff: s.diff + r.difference }), { stock: 0, gl: 0, diff: 0 });
    acct.push({ kind: "total", cells: ["Total", null, num(tot.stock), num(tot.gl), num(tot.diff)], flags: [false, false, false, false, off(tot.diff)] });
  }
  if (data.rows.length === 0) notes.push("No inventory accounts are mapped yet.");
  if (shownAccounts.length !== data.rows.length) {
    notes.push(`Filtered view: ${shownAccounts.length} of ${data.rows.length} inventory accounts are listed. The total is for all ${data.rows.length}.`);
  }

  const wip: ExportRow[] = shownWip.map((w): ExportRow => {
    const cells: Cell[] = [label(w.accountCode, w.accountName), num(w.openOrdersValue), num(w.glBalance), num(w.difference)];
    return { kind: "line", cells, flags: [false, false, false, off(w.difference)] };
  });
  if (data.wip.length === 0) notes.push("No work-in-progress account is mapped yet.");
  if (shownWip.length !== data.wip.length) {
    notes.push(`Filtered view: ${shownWip.length} of ${data.wip.length} work-in-progress accounts are listed.`);
  }

  return {
    title: "Stock vs GL",
    entity: info.entity,
    currency: info.currency,
    periodLine: info.asAtLine,
    params: [{ label: "As at", value: info.asAt }],
    sections: [
      {
        heading: "Inventory accounts",
        columns: [
          { key: "account", label: "Inventory account", kind: "text" },
          { key: "groups", label: "Posting groups", kind: "text" },
          { key: "stock", label: "Stock value", kind: "money" },
          { key: "gl", label: "GL balance", kind: "money" },
          { key: "diff", label: "Difference", kind: "money" },
        ],
        rows: acct,
      },
      {
        heading: "Open orders vs work in progress",
        columns: [
          { key: "account", label: "WIP account", kind: "text" },
          { key: "open", label: "Open orders", kind: "money" },
          { key: "gl", label: "GL balance", kind: "money" },
          { key: "diff", label: "Difference", kind: "money" },
        ],
        rows: wip,
      },
    ],
    notes,
    fileBase: "Stock-vs-GL",
  };
}
