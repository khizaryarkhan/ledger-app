/**
 * Lot Traceability → export model for the lot on screen: a one-row summary, then the same numbered sections the
 * screen shows (a manufactured lot has materials, processing and cost rollup; any other lot has its origin),
 * the stock movements, what the lot became and where it was distributed. PURE.
 */
import { fmt } from "@/lib/format";
import { num, type ExportRow, type ExportSection, type ReportExportModel } from "../export-model";
import { dateCell, text } from "./ops-common";

const sum = (rows: any[], k: string) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);

export function buildLotTraceabilityModel(data: any, info: { entity: string; currency: string | null }): ReportExportModel {
  const lot = data.lot;
  const uom = text(lot.baseUom) ?? "";
  const lotLabel = lot.lotNo ?? String(lot.id ?? "").slice(0, 8);
  const raw: any[] = data.rawMaterials ?? [];
  const processing: any[] = data.processing ?? [];
  const rollup: any[] = data.costRollup ?? [];
  const movements: any[] = data.ledger?.rows ?? [];
  const usage: any[] = data.usage ?? [];
  const distribution: any[] = data.distribution ?? [];
  const locations: any[] = data.ledger?.locations ?? [];
  const manufactured = lot.sourceType === "production" || lot.sourceType === "jobwork";
  const totalCost = rollup.find((r) => String(r.label).startsWith("Total"))?.amount ?? 0;
  const declared = Math.round(lot.unitCost * lot.origQty * 100) / 100;
  const reconciled = Math.abs(totalCost - declared) < 0.01 || raw.length === 0;

  const notes: string[] = [];
  let status: string;
  let statusFlag = false;
  if (manufactured) {
    status = reconciled ? "PASSED" : `REVIEW · off by ${fmt.num2(Math.abs(totalCost - declared))}`;
    statusFlag = !reconciled;
  } else {
    status = lot.sourceType === "purchase" ? "Bought at cost" : lot.sourceType === "opening" ? "Opening stock" : lot.sourceType === "adjustment" ? "Found in a count" : String(lot.sourceType ?? "");
  }
  const where = locations.length === 0 ? (lot.remainingQty > 0 ? "location not recorded" : "none left") : locations.map((l) => `${fmt.qty(l.qty)} in ${l.code}`).join(" · ");

  const sections: ExportSection[] = [{
    heading: "Lot",
    columns: [
      { key: "item", label: "Item", kind: "text" },
      { key: "lot", label: "Lot / batch", kind: "text" },
      { key: "qty", label: "Total quantity", kind: "qty" },
      { key: "uom", label: "Unit", kind: "text" },
      { key: "unitCost", label: "Unit cost", kind: "money" },
      { key: "onHand", label: "On hand now", kind: "qty" },
      { key: "where", label: "Where", kind: "text" },
      { key: "valueOnHand", label: "Value on hand", kind: "money" },
      { key: "valueReceived", label: "Value received", kind: "money" },
      { key: "recon", label: "Reconciliation", kind: "text" },
    ],
    rows: [{
      kind: "line",
      cells: [text(lot.itemName), lotLabel, num(lot.origQty), uom || null, num(lot.unitCost), num(lot.remainingQty), where, num(lot.remainingQty * lot.unitCost), num(declared), status],
      flags: [false, false, false, false, false, false, false, false, false, statusFlag],
    }],
  }];
  if (lot.packs) notes.push(`Total quantity is ${fmt.qty(lot.packs.qty)} × ${lot.packs.label}.`);

  if (manufactured) {
    if (raw.length === 0) notes.push("Raw material procurement: no purchased raw materials in this lot's ancestry; it may have been produced entirely from other manufactured or job-worked stock.");
    else {
      const rows: ExportRow[] = raw.map((r): ExportRow => {
        const refs = [r.poNumber, r.receiptNo].filter(Boolean).join(" / ");
        return { kind: "line", cells: [text(r.itemName), num(r.qty), text(r.uom), num(r.rate), num(r.amount), text(r.supplierLabel), refs || null, text(r.issuedTo)] };
      });
      rows.push({ kind: "total", cells: ["Total direct materials", null, null, null, num(sum(raw, "amount")), null, null, null] });
      sections.push({
        heading: "1. Raw Material Procurement & Consumption",
        columns: [
          { key: "item", label: "Item", kind: "text" }, { key: "qty", label: "Qty", kind: "qty" }, { key: "uom", label: "UoM", kind: "text" },
          { key: "rate", label: "Rate", kind: "money" }, { key: "amount", label: "Amount", kind: "money" }, { key: "supplier", label: "Supplier", kind: "text" },
          { key: "ref", label: "PO / Receipt", kind: "text" }, { key: "issued", label: "Issued to", kind: "text" },
        ],
        rows,
      });
    }
    if (processing.length === 0) notes.push("Subcontract processing: no job-work processing steps in this lot's ancestry; it may have been produced entirely in-house.");
    else {
      const rows: ExportRow[] = processing.map((p): ExportRow => {
        const sharePct = p.orderTotalQty && p.orderTotalQty > 0 ? (p.qty / p.orderTotalQty) * 100 : null;
        const bits: string[] = [];
        if (sharePct != null && sharePct < 99.95) bits.push(`${sharePct.toFixed(0)}% of order, shared across other builds`);
        if (p.orderWastagePct != null) bits.push(`Order had ${Math.abs(p.orderWastagePct).toFixed(1)}% ${p.orderWastagePct > 0 ? "wastage" : "yield gain"} written off`);
        return {
          kind: "line",
          cells: [text(p.orderId), text(p.activity), num(p.qty), text(p.uom), num(p.rate), num(p.amount), text(p.provider), dateCell(p.date), bits.join("; ") || null],
        };
      });
      rows.push({ kind: "total", cells: ["Total conversion fees", null, null, null, null, num(sum(processing, "amount")), null, null, null] });
      sections.push({
        heading: "2. Subcontract Processing (Job Work)",
        columns: [
          { key: "order", label: "Order ID", kind: "text" }, { key: "activity", label: "Activity / process", kind: "text" }, { key: "qty", label: "Qty", kind: "qty" },
          { key: "uom", label: "UoM", kind: "text" }, { key: "rate", label: "Rate", kind: "money" }, { key: "amount", label: "Amount", kind: "money" },
          { key: "provider", label: "Provider", kind: "text" }, { key: "date", label: "Date", kind: "date" }, { key: "note", label: "Note", kind: "text" },
        ],
        rows,
      });
    }
    sections.push({
      heading: "3. Cost Rollup Summary",
      columns: [
        { key: "element", label: "Cost element", kind: "text" }, { key: "detail", label: "Detail", kind: "text" },
        { key: "amount", label: "Amount", kind: "money" }, { key: "share", label: "Share", kind: "percent" },
      ],
      rows: rollup.map((r): ExportRow => ({ kind: String(r.label).startsWith("Total") ? "total" : "line", cells: [text(r.label), text(r.detail), num(r.amount), num(r.sharePct)] })),
    });
  } else if (lot.origin) {
    const o = lot.origin;
    sections.push({
      heading: "1. Where this lot came from",
      columns: [
        { key: "supplier", label: "Supplier", kind: "text" }, { key: "po", label: "Purchase order", kind: "text" }, { key: "grn", label: "Goods receipt", kind: "text" },
        { key: "date", label: "Received", kind: "date" }, { key: "qty", label: "Qty", kind: "qty" }, { key: "unitCost", label: "Unit cost", kind: "money" },
        { key: "value", label: "Value", kind: "money" }, { key: "by", label: "Received by", kind: "text" },
      ],
      rows: [{ kind: "line", cells: [text(o.supplierLabel), o.poNumber ?? "No PO", text(o.receiptNo), dateCell(o.date), num(o.qty), num(o.unitCost), num(o.unitCost * o.qty), text(o.receivedBy)] }],
    });
  } else {
    notes.push(lot.sourceType === "purchase" ? "No goods receipt is linked to this lot." : "This lot was created by a stock count or opening balance, so there is no supplier or purchase order behind it.");
  }

  if (movements.length === 0) notes.push("No stock movements are recorded for this lot.");
  else {
    const rows: ExportRow[] = movements.map((m): ExportRow => ({
      kind: "line",
      cells: [
        dateCell(m.date), m.note ? `${m.label} (${m.note})` : text(m.label), text(m.docNumber), m.qty > 0 ? num(m.qty) : null, m.qty < 0 ? num(-m.qty) : null,
        num(m.balance), m.unitCost == null ? null : num(m.unitCost), m.value == null ? null : num(m.value), text(m.by),
      ],
    }));
    rows.push({ kind: "total", cells: ["On hand now", null, null, null, null, num(lot.remainingQty), null, null, null] });
    sections.push({
      heading: `${manufactured ? 4 : 2}. Stock movement`,
      columns: [
        { key: "date", label: "Date", kind: "date" }, { key: "movement", label: "Movement", kind: "text" }, { key: "doc", label: "Document", kind: "text" },
        { key: "in", label: "In", kind: "qty" }, { key: "out", label: "Out", kind: "qty" }, { key: "balance", label: "Balance", kind: "qty" },
        { key: "unitCost", label: "Unit cost", kind: "money" }, { key: "value", label: "Value", kind: "money" }, { key: "by", label: "By", kind: "text" },
      ],
      rows,
    });
    const diff = Number(data.ledger?.difference ?? 0);
    notes.push(Math.abs(diff) < 0.000001 ? "Movements add up to the lot's balance." : `REVIEW: movements add up to ${fmt.qty(data.ledger.computedOnHand)}, off by ${fmt.qty(Math.abs(diff))}.`);
  }

  if (usage.length === 0) notes.push(`What it became: nothing has been issued from this lot yet; all ${fmt.qty(lot.remainingQty)} ${uom} is still on hand.`.trim());
  else {
    sections.push({
      heading: `${manufactured ? 5 : 3}. What it became`,
      columns: [
        { key: "what", label: "What happened", kind: "text" }, { key: "date", label: "Date", kind: "date" }, { key: "qty", label: "Qty used", kind: "qty" },
        { key: "uom", label: "Unit", kind: "text" }, { key: "made", label: "Made", kind: "text" }, { key: "by", label: "By", kind: "text" },
      ],
      rows: usage.map((u): ExportRow => ({
        kind: "line",
        cells: [text(u.label), dateCell(u.date), num(u.qty), uom || null, (u.producedLots ?? []).map((p: any) => `${p.itemName} ${p.lotNo ?? String(p.id ?? "").slice(0, 8)}`).join(", ") || null, text(u.by)],
      })),
    });
  }

  if (distribution.length === 0) notes.push("Outbound distribution: not yet shipped or sold; still on hand or consumed internally only.");
  else {
    const rows: ExportRow[] = distribution.map((d): ExportRow => ({
      kind: "line",
      cells: [
        text(d.shipmentNo), d.invoiceNo ?? "Not yet invoiced", text(d.customerLabel), `${d.itemName ?? ""}${d.lotNo ? ` ${d.lotNo}` : ""}`.trim() || null,
        num(d.qty), text(d.uom), num(d.unitPrice), num(d.amount), dateCell(d.date),
      ],
    }));
    rows.push({ kind: "total", cells: ["Total distributed", null, null, null, null, null, null, num(sum(distribution, "amount")), null] });
    sections.push({
      heading: `${manufactured ? 6 : 4}. Outbound Commercial Distribution`,
      columns: [
        { key: "shipment", label: "Shipment", kind: "text" }, { key: "invoice", label: "Invoice", kind: "text" }, { key: "customer", label: "Sold-to customer", kind: "text" },
        { key: "item", label: "Item shipped", kind: "text" }, { key: "qty", label: "Qty", kind: "qty" }, { key: "uom", label: "UoM", kind: "text" },
        { key: "price", label: "Unit price", kind: "money" }, { key: "amount", label: "Amount", kind: "money" }, { key: "date", label: "Date", kind: "date" },
      ],
      rows,
    });
  }

  return {
    title: `Lot Traceability — ${lot.itemName ?? ""} ${lotLabel}`.trim(),
    formalTitle: "Batch Traceability & Cost Reconciliation",
    entity: info.entity,
    currency: info.currency,
    params: [{ label: "Item", value: text(lot.itemName) ?? "" }, { label: "Lot", value: String(lotLabel) }],
    sections,
    notes,
    fileBase: `Lot-Traceability-${lotLabel}`,
  };
}
