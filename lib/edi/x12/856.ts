/**
 * X12 856 Ship Notice/Manifest writer (we are the SELLER advising a customer).
 * Pure. Hierarchy per order, as the common pick-and-pack shape:
 *   S (shipment) → O (order) → T (pallet) → P (carton) → I (item)
 * A package's items hang under it; a carton on a pallet hangs under the pallet;
 * goods not packed hang under the order. Each T/P carries `MAN*GM*<SSCC>`.
 */

import type { ShipNoticeOut, AsnItem, AsnPackage } from "@/lib/edi/build/shipment";
import { seg, ccyymmdd, num, interchange, clean, type Envelope } from "@/lib/edi/x12/envelope";
import { gtinPair } from "@/lib/edi/x12/850";

export function write856(a: ShipNoticeOut, env: Envelope): string {
  const body: string[] = [seg("BSN", a.purpose, clean(a.shipmentId, 30), env.now.date, env.now.time)];
  let hl = 0;
  const next = () => ++hl;
  const open = (id: number, parent: number | null, code: string, hasChildren: boolean, ...rest: string[]) =>
    [seg("HL", id, parent ?? "", code, hasChildren ? "1" : "0"), ...rest];

  const s = next();
  body.push(...open(s, null, "S", true,
    seg("DTM", "011", ccyymmdd(a.shipDate)),
    ...(a.carrier ? [seg("TD5", "", "", "", "M", clean(a.carrier, 35))] : []),
    ...(a.trackingNo ? [seg("REF", "CN", clean(a.trackingNo, 30))] : []),
    seg("N1", "SF", clean(a.shipFrom.name, 60), ...(a.shipFrom.gln ? ["UL", a.shipFrom.gln] : [])),
  ));

  const itemLoop = (it: AsnItem, parent: number) => {
    const id = next();
    const ids: string[] = [];
    if (it.partNumber) ids.push("BP", clean(it.partNumber, 48));
    if (it.gtin) ids.push(...gtinPair(it.gtin));
    if (it.itemCode) ids.push("VP", clean(it.itemCode, 48));
    body.push(...open(id, parent, "I", false, seg("LIN", clean(it.lineNo, 20), ...ids), seg("SN1", "", num(it.qty), it.unit)));
  };

  for (const o of a.orders) {
    const oid = next();
    body.push(...open(oid, s, "O", true,
      seg("PRF", clean(o.poNumber, 22), "", "", ccyymmdd(o.poDate)),
      ...(o.shipTo ? [seg("N1", "ST", clean(o.shipTo.name ?? "", 60), ...(o.shipTo.gln ? ["UL", o.shipTo.gln] : o.shipTo.code ? ["92", clean(o.shipTo.code, 20)] : []))] : []),
    ));
    const pallets = o.packages.filter(p => p.level === "tare");
    const cartonsOn = (sscc: string) => o.packages.filter(p => p.level === "pack" && p.parentSscc === sscc);
    const looseCartons = o.packages.filter(p => p.level === "pack" && !p.parentSscc);
    const pack = (p: AsnPackage, parent: number, code: "T" | "P", children: AsnPackage[]) => {
      const id = next();
      body.push(...open(id, parent, code, p.items.length + children.length > 0, seg("MAN", "GM", p.sscc)));
      for (const c of children) pack(c, id, "P", []);
      for (const it of p.items) itemLoop(it, id);
    };
    for (const p of pallets) pack(p, oid, "T", cartonsOn(p.sscc));
    for (const p of looseCartons) pack(p, oid, "P", []);
    for (const it of o.loose) itemLoop(it, oid);
  }
  body.push(seg("CTT", hl));
  return interchange(env, "SH", "856", body);
}
