"use client";

/**
 * Printable pallet / carton labels for one shipment, one 4 x 6 inch label per package, each with its GS1-128 SSCC barcode
 * (AI 00). Opened from Shipping; "Print" uses the browser's print dialog (set the page size to 4 x 6 in, no margins, or
 * "Save as PDF"). The barcode is drawn by lib/barcode/code128.ts: a label should be checked with a scanner before a
 * customer relies on it.
 */

import { barcodeSvg, ssccBarcodeValues } from "@/lib/barcode/code128";
import { formatDate } from "@/lib/format";

export type LabelData = {
  shipmentNo: string | null; shipDate: string | null; customer: string | null;
  shipFrom: { name: string; lines: string[] }; shipTo: { name: string; lines: string[] } | null; orderRefs: string[];
  labels: { sscc: string; packType: string; parentSscc: string | null; contents: { item: string; qty: number; uom: string | null }[] }[];
};

const css = `
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#eceded;color:#000;font-family:Arial,Helvetica,sans-serif}
  .bar{position:sticky;top:0;z-index:5;display:flex;gap:12px;align-items:center;padding:10px 16px;background:#1b1f24;color:#fff;font-size:13px}
  .bar button{padding:6px 14px;border-radius:6px;border:0;background:#2563eb;color:#fff;font-weight:600;cursor:pointer}
  .label{width:101.6mm;height:152.4mm;margin:14px auto;background:#fff;padding:5mm;display:flex;flex-direction:column;gap:3mm;
    box-shadow:0 1px 3px rgba(0,0,0,.2);page-break-after:always;break-after:page;overflow:hidden}
  .row{display:flex;gap:4mm}.row>div{flex:1;min-width:0}
  .cap{font-size:7pt;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:#444}
  .name{font-size:11pt;font-weight:700}.small{font-size:8.5pt;line-height:1.25}
  .kind{font-size:20pt;font-weight:800;border:2px solid #000;padding:1mm 3mm;text-align:center}
  .bc{text-align:center;margin-top:auto}
  .hr{font-size:12pt;font-family:"Courier New",monospace;letter-spacing:.04em;margin-top:1mm}
  ul{margin:0;padding-left:4mm}li{font-size:8.5pt}
  @page{size:4in 6in;margin:0}
  @media print{html,body{background:#fff}.bar{display:none}.label{margin:0;box-shadow:none}}
`;

const kindOf = (t: string) => (t === "pallet" ? "PALLET" : "CARTON");
const qty = (n: number) => String(Math.round(n * 1e4) / 1e4);

export function SsccLabelSheet({ data }: { data: LabelData }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="bar">
        <button onClick={() => window.print()}>Print {data.labels.length} label{data.labels.length === 1 ? "" : "s"}</button>
        <span>{data.shipmentNo ?? "Shipment"}{data.customer ? ` · ${data.customer}` : ""} · 4 × 6 in, one per pallet or carton</span>
      </div>
      {data.labels.length === 0 && <div style={{ padding: 40 }}>This shipment has no pallets or cartons yet. Pack it first (the package icon in Shipping).</div>}
      {data.labels.map(l => (
        <div className="label" key={l.sscc}>
          <div className="row">
            <div><div className="cap">From</div><div className="name">{data.shipFrom.name}</div><div className="small">{data.shipFrom.lines.join(", ")}</div></div>
            <div className="kind" style={{ flex: "0 0 auto" }}>{kindOf(l.packType)}</div>
          </div>
          <div>
            <div className="cap">Ship to</div>
            <div className="name">{data.shipTo?.name ?? data.customer ?? "—"}</div>
            {data.shipTo && <div className="small">{data.shipTo.lines.map((x, i) => <div key={i}>{x}</div>)}</div>}
          </div>
          <div className="small">
            {data.orderRefs.length > 0 && <div><b>PO</b> {data.orderRefs.join(", ")}</div>}
            <div><b>Shipment</b> {data.shipmentNo ?? "—"}{data.shipDate ? ` · ${formatDate(data.shipDate)}` : ""}</div>
            {l.parentSscc && <div><b>On pallet</b> {l.parentSscc}</div>}
          </div>
          {l.contents.length > 0 && (
            <div><div className="cap">Contents</div>
              <ul>{l.contents.slice(0, 8).map((c, i) => <li key={i}>{c.item} — {qty(c.qty)}{c.uom ? ` ${c.uom}` : ""}</li>)}{l.contents.length > 8 && <li>+ {l.contents.length - 8} more</li>}</ul>
            </div>
          )}
          <div className="bc">
            <div className="cap">SSCC</div>
            <div dangerouslySetInnerHTML={{ __html: barcodeSvg(ssccBarcodeValues(l.sscc), { moduleMm: 0.36, heightMm: 24 }) }} />
            <div className="hr">(00) {l.sscc}</div>
          </div>
        </div>
      ))}
    </>
  );
}
