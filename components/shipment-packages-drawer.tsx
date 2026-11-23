"use client";

/**
 * Pack a shipment (0143): pallets and cartons, each given an SSCC from the
 * org's GS1 Company Prefix, with what each one holds. This is the packing
 * structure a ship notice (X12 856 / DESADV) lists. Packing moves no stock and
 * posts nothing. Rules: lib/inventory/sscc(-server).ts.
 */

import { useEffect, useMemo, useState } from "react";
import { Package, Trash2, Loader } from "lucide-react";
import { Drawer, SelectField, controlInset, th } from "@/components/form-kit";
import { PACK_TYPES } from "@/lib/inventory/uom";
import { showSscc } from "@/lib/inventory/sscc";
import { fmt } from "@/lib/format";
import { askConfirm } from "@/lib/dialogs";

type Line = { id: string; description: string | null; qtyBase: number; packed: number; left: number };
type Pkg = { id: string; parentId: string | null; sscc: string; packType: string; grossWeightKg: string | null; contents: { shipmentLineId: string; qtyBase: number }[] };

export function ShipmentPackagesDrawer({ shipment, onClose }: { shipment: { id: string; shipmentNo?: string | null; customerLabel?: string | null }; onClose: () => void }) {
  const base = `/api/inventory/shipping/${shipment.id}/packages`;
  const [data, setData] = useState<{ lines: Line[]; packages: Pkg[]; fullyPacked: boolean } | null>(null);
  const [packType, setPackType] = useState("carton");
  const [parentId, setParentId] = useState("");
  const [weight, setWeight] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    const r = await fetch(base);
    const d = await r.json().catch(() => null);
    if (!r.ok) { setErr(d?.error || "Could not load the packing."); setData({ lines: [], packages: [], fullyPacked: false }); return; }
    setData(d);
  }
  useEffect(() => { load(); }, [shipment.id]);

  const lineName = useMemo(() => new Map((data?.lines ?? []).map(l => [l.id, l.description || "Line"])), [data]);
  const pallets = (data?.packages ?? []).filter(p => !p.parentId);
  const childrenOf = (id: string) => (data?.packages ?? []).filter(p => p.parentId === id);

  async function add() {
    setBusy(true); setErr("");
    const contents = Object.entries(qty).filter(([, v]) => v.trim() !== "").map(([shipmentLineId, v]) => ({ shipmentLineId, qtyBase: v }));
    const r = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packType, parentId: parentId || null, grossWeightKg: weight, contents }) });
    setBusy(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not add the package."); return; }
    setQty({}); setWeight("");
    load();
  }

  async function remove(p: Pkg) {
    if (!await askConfirm(`Remove ${p.packType} ${showSscc(p.sscc)}? Its SSCC will not be used again.`)) return;
    setErr("");
    const r = await fetch(`${base}?packageId=${p.id}`, { method: "DELETE" });
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not remove."); return; }
    load();
  }

  const pkgRow = (p: Pkg, nested = false) => (
    <div key={p.id} className={`flex items-start justify-between gap-3 rounded-lg border border-stone-800 px-3 py-2 ${nested ? "ml-6" : ""}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[13px] text-stone-200">
          <Package size={13} className="text-stone-500 shrink-0" />
          <span className="capitalize">{p.packType}</span>
          <span className="font-mono text-[12px] text-stone-300">{showSscc(p.sscc)}</span>
          {p.grossWeightKg && <span className="text-[11px] text-stone-500">{fmt.qty(Number(p.grossWeightKg))} kg</span>}
        </div>
        <div className="text-[11px] text-stone-400 mt-0.5">
          {p.contents.length ? p.contents.map(c => `${fmt.qty(c.qtyBase)} × ${lineName.get(c.shipmentLineId) ?? "line"}`).join(" · ") : (childrenOf(p.id).length ? `${childrenOf(p.id).length} package(s) on it` : "Empty")}
        </div>
      </div>
      <button type="button" onClick={() => remove(p)} className="p-1 rounded hover:bg-stone-700 text-stone-500 hover:text-rose-400 shrink-0" title="Remove" aria-label={`Remove ${p.sscc}`}><Trash2 size={13} /></button>
    </div>
  );

  return (
    <Drawer title={`Pack ${shipment.shipmentNo || "shipment"}`} subtitle={`${shipment.customerLabel ?? ""}${data ? ` · ${data.fullyPacked ? "fully packed" : "not fully packed"}` : ""}`} onClose={onClose} wide>
      <div className="space-y-4">
        {err && <p className="text-[12px] text-rose-400">{err}</p>}
        {data === null && <p className="text-[12px] text-stone-500">Loading…</p>}

        {data && (
          <>
            <div className="rounded-lg border border-stone-800 overflow-hidden">
              <table className="w-full text-[12px]">
                <thead><tr className="border-b border-stone-800">
                  <th className={th}>Line</th><th className={`${th} text-right`}>Shipped</th><th className={`${th} text-right`}>Packed</th><th className={`${th} text-right`}>Put in this package</th>
                </tr></thead>
                <tbody>
                  {data.lines.map(l => (
                    <tr key={l.id} className="border-b border-stone-800/50">
                      <td className="px-3 py-2 text-stone-200">{l.description || "Line"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-stone-300">{fmt.qty(l.qtyBase)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${l.left > 1e-6 ? "text-amber-400" : "text-stone-500"}`}>{fmt.qty(l.packed)}</td>
                      <td className="px-3 py-1.5 text-right">
                        <input type="number" min="0" step="any" disabled={l.left <= 1e-6} value={qty[l.id] ?? ""} placeholder={l.left > 1e-6 ? fmt.qty(l.left) : "—"}
                          onChange={e => setQty(q => ({ ...q, [l.id]: e.target.value }))} className={`${controlInset} !h-7 w-28 text-right tabular-nums`} aria-label={`Quantity of ${l.description || "line"}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-[1fr_1.2fr_1fr_auto] gap-2 items-end">
              <div><div className="text-[11px] text-stone-500 mb-1">Package</div>
                <SelectField inset value={packType} onChange={e => setPackType(e.target.value)} aria-label="Package type">
                  {PACK_TYPES.filter(t => t !== "each").map(t => <option key={t} value={t}>{t}</option>)}
                </SelectField>
              </div>
              <div><div className="text-[11px] text-stone-500 mb-1">On pallet</div>
                <SelectField inset value={parentId} onChange={e => setParentId(e.target.value)} aria-label="On pallet" disabled={!pallets.length}>
                  <option value="">Not on a pallet</option>
                  {pallets.map(p => <option key={p.id} value={p.id}>{p.packType} …{p.sscc.slice(-6)}</option>)}
                </SelectField>
              </div>
              <div><div className="text-[11px] text-stone-500 mb-1">Gross weight (kg)</div>
                <input type="number" min="0" step="any" value={weight} onChange={e => setWeight(e.target.value)} className={controlInset} placeholder="Optional" />
              </div>
              <button type="button" onClick={add} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[12px] font-medium disabled:opacity-50">
                {busy && <Loader size={12} className="animate-spin" />} Add package
              </button>
            </div>
            <p className="text-[11px] text-stone-500">Each package gets the next SSCC from your GS1 Company Prefix (Settings → Company). A pallet can be added empty and cartons put on it. A removed package's SSCC is never re-used.</p>

            <div className="space-y-2">
              {data.packages.length === 0 && <p className="text-[12px] text-stone-500">Nothing packed yet.</p>}
              {pallets.map(p => (
                <div key={p.id} className="space-y-2">
                  {pkgRow(p)}
                  {childrenOf(p.id).map(c => pkgRow(c, true))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}
