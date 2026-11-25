/**
 * Item Ledger → export model. PURE. One block per item (heading row, opening, every movement, closing) inside a
 * single section so a long item list cannot hit the per-file section cap; every row repeats its item name so the
 * Excel sheet can be filtered. The truncation warning, the "ties to the books" banner and a movement that carries
 * value but has no ledger entry (amber on screen) all travel with the file.
 */
import { num, type Cell, type ExportRow, type ReportExportModel } from "../export-model";
import { totalClosingValue, type ItemLedger } from "../../inventory/item-ledger";

export interface ItemLedgerResult {
  from: string | null;
  to: string;
  ledgers: ItemLedger[];
  truncated: boolean;
  itemOptions: { id: string; name: string }[];
  tie: { stockValue: number; glBalance: number; difference: number };
}

export interface ItemLedgerInfo {
  entity: string;
  currency: string | null;
  periodLine: string;
  from: string;
  to: string;
  /** Name of the single item picked, or null for "All items". */
  itemName: string | null;
}

/** Same tolerance as the screen and Stock vs GL. */
export const TIE_TOLERANCE = 0.015;

export function buildItemLedgerModel(d: ItemLedgerResult, info: ItemLedgerInfo): ReportExportModel {
  const rows: ExportRow[] = [];
  const blank = (n: number): Cell[] => Array.from({ length: n }, () => null);

  for (const l of d.ledgers) {
    const name = l.item.name;
    rows.push({ kind: "heading", cells: [`${name} (in ${l.item.uom ?? "units"})`, ...blank(10)] });
    rows.push({ kind: "subtotal", cells: [name, null, "Opening balance", null, null, null, null, null, null, num(l.openingQty), num(l.openingValue)] });
    for (const m of l.lines) {
      const carriesValue = Math.abs(m.totalCost) > 0.005;
      const noEntry = !(m.entryId && m.docNo) && carriesValue;
      const docNo: string | null = m.entryId && m.docNo ? m.docNo : carriesValue ? "No ledger entry" : (m.docNo ?? null);
      rows.push({
        kind: "line",
        cells: [name, m.date, m.label, docNo, m.lotNo ?? null, m.qtyIn ? num(m.qtyIn) : null, m.qtyOut ? num(m.qtyOut) : null, m.unitCost != null ? num(m.unitCost) : null, num(m.totalCost), num(m.balanceQty), num(m.balanceValue)],
        flags: [false, false, false, noEntry, false, false, false, false, false, false, false],
      });
    }
    const closingLabel = l.unposted > 0 ? `Closing · ${l.unposted} movement${l.unposted === 1 ? "" : "s"} with no ledger entry` : "Closing";
    rows.push({
      kind: "total",
      cells: [name, null, closingLabel, null, null, num(l.inQty), num(l.outQty), null, num(l.inValue - l.outValue), num(l.closingQty), num(l.closingValue)],
      flags: [false, false, l.unposted > 0, false, false, false, false, false, false, false, false],
    });
  }

  const sections: ReportExportModel["sections"] = [{
    heading: "Movements",
    columns: [
      { key: "item", label: "Item", kind: "text" },
      { key: "date", label: "Date", kind: "date" },
      { key: "type", label: "Type", kind: "text" },
      { key: "no", label: "No.", kind: "text" },
      { key: "lot", label: "Lot", kind: "text" },
      { key: "in", label: "In", kind: "qty" },
      { key: "out", label: "Out", kind: "qty" },
      { key: "unit", label: "Unit cost", kind: "money" },
      { key: "value", label: "Value", kind: "money" },
      { key: "balqty", label: "Balance qty", kind: "qty" },
      { key: "balval", label: "Balance value", kind: "money" },
    ],
    rows,
  }];

  // The banner that ties all stock to the books.
  const tied = Math.abs(d.tie.difference) < TIE_TOLERANCE;
  sections.push({
    heading: "Tie to the books (all stock at the end date)",
    columns: [{ key: "measure", label: "Measure", kind: "text" }, { key: "amount", label: "Amount", kind: "money" }],
    rows: [
      { kind: "line", cells: ["Stock value (all items)", num(d.tie.stockValue)] },
      { kind: "line", cells: ["Inventory accounts in the ledger", num(d.tie.glBalance)] },
      { kind: "total", cells: [tied ? "Difference (ties to the books)" : "Difference (does not tie to the books)", num(d.tie.difference)], flags: [!tied, !tied] },
    ],
  });
  if (d.ledgers.length > 1 && !d.truncated) {
    sections.push({
      columns: [{ key: "measure", label: "", kind: "text" }, { key: "amount", label: "Amount", kind: "money" }],
      rows: [{ kind: "total", cells: ["Closing value of the items shown", num(totalClosingValue(d.ledgers))] }],
    });
  }

  const notes: string[] = [];
  if (d.truncated) notes.push("This period has more movements than can be shown at once, so the balances are not complete. Narrow the dates or pick one item.");
  if (d.ledgers.length === 0) notes.push("No stock movements in this period.");
  if (!tied) notes.push("The stock value does not tie to the inventory accounts in the ledger.");

  return {
    title: "Item Ledger",
    entity: info.entity,
    currency: info.currency,
    periodLine: info.periodLine,
    params: [
      { label: "Item", value: info.itemName ?? "All items" },
      { label: "From", value: info.from },
      { label: "To", value: info.to },
    ],
    sections,
    notes,
    fileBase: "Item-Ledger",
  };
}
