"use client";

/**
 * Expected deliveries (0144): what suppliers say is on its way, from an ASN or
 * typed by hand from their dispatch note. A claim, never stock — Receiving
 * fills a receipt from it, a person counts, and the receipt posts as always.
 * Rules: lib/inventory/expected-delivery.ts.
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Truck, ChevronLeft, Copy } from "lucide-react";
import { Drawer, DrawerFooter, Field, SelectField, controlInset } from "@/components/form-kit";
import { fmt, localToday } from "@/lib/format";
import { showSscc } from "@/lib/inventory/sscc";
import { askConfirm } from "@/lib/dialogs";

type Tab = "expected" | "received" | "cancelled";
const TABS: { key: Tab; label: string }[] = [
  { key: "expected", label: "On the way" }, { key: "received", label: "Received" }, { key: "cancelled", label: "Cancelled" },
];

type Row = { key: string; poLineId: string; qty: string; batch: string; bestBefore: string; expiry: string; sscc: string };
let rowSeq = 0;
const newRow = (poLineId: string): Row => ({ key: `r${rowSeq++}`, poLineId, qty: "", batch: "", bestBefore: "", expiry: "", sscc: "" });

export function ExpectedDeliveriesDrawer({ onClose }: { items?: any[]; onClose: () => void }) {
  const [mode, setMode] = useState<"list" | "new">("list");
  const [tab, setTab] = useState<Tab>("expected");
  const [list, setList] = useState<any[] | null>(null);
  const [err, setErr] = useState("");

  async function load(t: Tab = tab) {
    setList(null);
    const r = await fetch(`/api/inventory/expected-deliveries?state=${t}`);
    const d = await r.json().catch(() => null);
    if (!r.ok) { setErr(d?.error || "Could not load deliveries."); setList([]); return; }
    setList(Array.isArray(d) ? d : []);
  }
  useEffect(() => { load(tab); }, [tab]);

  async function act(d: any, action: "cancel" | "reopen" | "delete") {
    if (action === "delete" && !await askConfirm(`Delete delivery ${d.reference || ""}? Use this only for one recorded by mistake.`)) return;
    setErr("");
    const r = action === "delete"
      ? await fetch(`/api/inventory/expected-deliveries/${d.id}`, { method: "DELETE" })
      : await fetch(`/api/inventory/expected-deliveries/${d.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not change the delivery."); return; }
    load();
  }

  if (mode === "new") return <NewDelivery onBack={() => { setMode("list"); setTab("expected"); load("expected"); }} onClose={onClose} />;

  return (
    <Drawer title="Expected deliveries" subtitle="What suppliers say is on its way. Receiving fills a receipt from it; nothing is in stock until the goods are counted." onClose={onClose} size="xl">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-1">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`h-8 px-3 rounded-md ring-1 text-[12px] ${tab === t.key ? "ring-stone-600 bg-stone-700 text-stone-100" : "ring-stone-700 bg-stone-800 text-stone-400 hover:text-stone-200"}`}>{t.label}</button>
            ))}
          </div>
          <button onClick={() => setMode("new")} className="flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary hover:bg-primary-hover text-white text-[12px] font-medium"><Plus size={13} /> Record a delivery</button>
        </div>
        {err && <p className="text-[12px] text-rose-400">{err}</p>}
        {list === null && <p className="text-[12px] text-stone-500">Loading…</p>}
        {list?.length === 0 && <p className="text-[13px] text-stone-500 py-8 text-center">{tab === "expected" ? "Nothing announced yet." : "None."}</p>}
        <div className="space-y-2">
          {(list ?? []).map(d => (
            <article key={d.id} className="rounded-lg border border-stone-800 px-3.5 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] text-stone-100 font-medium truncate">
                    {d.supplierName || "Supplier"} · <span className="font-mono">{d.reference || "no reference"}</span>{d.source === "asn" && <span className="ml-1.5 text-[11px] text-cyan-400">ASN</span>}
                  </div>
                  <div className="text-[12px] text-stone-400 mt-0.5">
                    {d.poNumber ? `${d.poNumber} · ` : ""}{d.expectedDate ? `due ${fmt.shortDate(d.expectedDate)}` : d.shipDate ? `shipped ${fmt.shortDate(d.shipDate)}` : "no date"}
                    {d.carrier ? ` · ${d.carrier}${d.trackingNo ? ` ${d.trackingNo}` : ""}` : ""}
                    {d.state === "received" && d.receiptNo ? ` · received as ${d.receiptNo}` : ""}
                  </div>
                  <div className="text-[12px] text-stone-300 mt-1.5">
                    {d.lines.map((l: any) => `${fmt.qty(l.qtyBase)} ${l.baseUom || ""} ${l.itemName || "item"}${l.supplierBatchNo ? ` (batch ${l.supplierBatchNo})` : ""}`).join(" · ")}
                  </div>
                  {d.packages.length > 0 && <div className="text-[11px] text-stone-500 mt-1 font-mono">{d.packages.map((p: any) => showSscc(p.sscc)).join(" · ")}</div>}
                </div>
                <div className="flex gap-1 shrink-0">
                  {d.state === "expected" && <button onClick={() => act(d, "cancel")} className="h-7 px-2.5 rounded-md border border-stone-700 text-[11.5px] text-stone-300 hover:bg-stone-800">Cancel</button>}
                  {d.state === "cancelled" && <button onClick={() => act(d, "reopen")} className="h-7 px-2.5 rounded-md border border-stone-700 text-[11.5px] text-stone-300 hover:bg-stone-800">Reopen</button>}
                  {d.state !== "received" && <button onClick={() => act(d, "delete")} className="p-1.5 rounded hover:bg-stone-700 text-stone-500 hover:text-rose-400" title="Delete" aria-label="Delete delivery"><Trash2 size={13} /></button>}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </Drawer>
  );
}

/** Record one delivery against an open purchase order: the supplier's reference, dates, and what is on it. */
function NewDelivery({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const [pos, setPos] = useState<any[] | null>(null);
  const [poId, setPoId] = useState("");
  const [reference, setReference] = useState("");
  const [shipDate, setShipDate] = useState(localToday());
  const [expectedDate, setExpectedDate] = useState("");
  const [carrier, setCarrier] = useState("");
  const [trackingNo, setTrackingNo] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`/api/inventory/po-open`).then(x => x.json()).then(r => setPos(Array.isArray(r) ? r : [])).catch(() => setPos([]));
  }, []);
  const po = useMemo(() => (pos ?? []).find(p => p.id === poId) ?? null, [pos, poId]);
  const lineById = useMemo(() => new Map((po?.lines ?? []).map((l: any) => [l.lineId, l])), [po]);

  function pickPo(id: string) {
    setPoId(id); setErr("");
    const p = (pos ?? []).find(x => x.id === id);
    setRows((p?.lines ?? []).map((l: any) => newRow(l.lineId)));
    if (p?.expiryDate && !expectedDate) setExpectedDate(p.expiryDate);
  }
  const update = (key: string, patch: Partial<Row>) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));
  const addBatch = (after: Row) => setRows(rs => { const i = rs.findIndex(r => r.key === after.key); const n = [...rs]; n.splice(i + 1, 0, newRow(after.poLineId)); return n; });
  const remove = (key: string) => setRows(rs => rs.filter(r => r.key !== key));

  async function save() {
    const lines = rows.filter(r => r.qty.trim() !== "").map(r => ({
      poLineId: r.poLineId, qtyBase: r.qty, supplierBatchNo: r.batch || null,
      bestBeforeDate: r.bestBefore || null, expiryDate: r.expiry || null, sscc: r.sscc || null,
    }));
    if (!poId) { setErr("Choose the purchase order this delivery is for."); return; }
    if (!lines.length) { setErr("Enter the quantity of at least one item the supplier says is coming."); return; }
    setSaving(true); setErr("");
    const r = await fetch(`/api/inventory/expected-deliveries`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      poId, reference, shipDate: shipDate || null, expectedDate: expectedDate || null, carrier, trackingNo, lines,
    }) });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not record the delivery."); return; }
    onBack();
  }

  return (
    <Drawer title="Record an expected delivery" subtitle="From the supplier's dispatch note or advance ship notice." onClose={onClose} size="xl"
      footer={<DrawerFooter saving={saving} onClose={onBack} onSave={save} saveLabel="Record delivery" err={err} icon={<Truck size={14} />} />}>
      <div className="space-y-4">
        <button onClick={onBack} className="flex items-center gap-0.5 text-[13px] font-medium text-cyan-400 hover:text-cyan-300 -ml-1"><ChevronLeft size={16} /> Expected deliveries</button>
        <Field label="Purchase order">
          <SelectField inset value={poId} onChange={e => pickPo(e.target.value)} aria-label="Purchase order">
            <option value="">{pos === null ? "Loading…" : pos.length ? "Choose an open order" : "No open purchase orders"}</option>
            {(pos ?? []).map(p => <option key={p.id} value={p.id}>{p.docNumber || p.id.slice(0, 8)} · {p.partyLabel || "Supplier"}</option>)}
          </SelectField>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Supplier's reference" hint="Their ASN or delivery note number."><input value={reference} onChange={e => setReference(e.target.value)} maxLength={64} className={controlInset} placeholder="e.g. ASN-50421" /></Field>
          <Field label="Shipped on"><input type="date" value={shipDate} onChange={e => setShipDate(e.target.value)} className={controlInset} /></Field>
          <Field label="Expected on"><input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} className={controlInset} /></Field>
          <Field label="Carrier"><input value={carrier} onChange={e => setCarrier(e.target.value)} maxLength={64} className={controlInset} placeholder="Optional" /></Field>
          <Field label="Tracking no."><input value={trackingNo} onChange={e => setTrackingNo(e.target.value)} maxLength={64} className={controlInset} placeholder="Optional" /></Field>
        </div>

        {po && (
          <div className="space-y-2">
            <h3 className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider">What is on it</h3>
            <p className="text-[12px] text-stone-500">Leave a quantity blank for anything not on this delivery. Quantities are in each item's base unit.</p>
            {rows.map(r => {
              const l: any = lineById.get(r.poLineId);
              return (
                <div key={r.key} className="rounded-lg border border-stone-800 px-3 py-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2 text-[12.5px]">
                    <span className="text-stone-200 truncate">{l?.itemName}{l ? <span className="text-stone-500"> · {fmt.qty(l.remainingQty)} {l.baseUom || ""} still expected</span> : null}</span>
                    <span className="flex gap-1 shrink-0">
                      <button onClick={() => addBatch(r)} className="p-1 rounded hover:bg-stone-700 text-stone-500 hover:text-stone-200" title="Another batch of this item" aria-label="Add another batch"><Copy size={13} /></button>
                      <button onClick={() => remove(r.key)} className="p-1 rounded hover:bg-stone-700 text-stone-500 hover:text-rose-400" title="Remove" aria-label="Remove row"><Trash2 size={13} /></button>
                    </span>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    <input type="number" min="0" step="any" value={r.qty} onChange={e => update(r.key, { qty: e.target.value })} className={`${controlInset} text-right tabular-nums`} placeholder={`Qty ${l?.baseUom || ""}`} aria-label="Quantity" />
                    <input value={r.batch} onChange={e => update(r.key, { batch: e.target.value })} maxLength={64} className={controlInset} placeholder="Their batch" aria-label="Supplier batch" />
                    <input type="date" value={r.bestBefore} onChange={e => update(r.key, { bestBefore: e.target.value })} className={controlInset} aria-label="Best before" title="Best before" />
                    <input type="date" value={r.expiry} onChange={e => update(r.key, { expiry: e.target.value })} className={controlInset} aria-label="Expiry" title="Expiry" />
                    <input value={r.sscc} onChange={e => update(r.key, { sscc: e.target.value })} className={`${controlInset} font-mono`} placeholder="Pallet SSCC" aria-label="Pallet SSCC" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Drawer>
  );
}
