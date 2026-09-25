"use client";

/**
 * Stock Adjustments — counts and write-downs (P-15, P-16).
 * A count sets a lot to what is physically there; the difference moves at that
 * lot's cost against Inventory adjustments. A write-down lowers one lot's cost,
 * with a reason, against Inventory write-downs. Both are one entry, voidable.
 */

import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, TrendingDown, RefreshCw, Trash2 } from "lucide-react";
import { ListPage, ListPageHeader } from "@/components/list-view";
import { Button, Toast } from "@/components/ui";
import { Drawer, DrawerFooter, Field, Section, SelectField, controlInset, cell, th, tableHead, t } from "@/components/form-kit";
import { fmt, localToday } from "@/lib/format";
import { kindOf } from "@/lib/inventory/item-kinds";

const REASONS = [
  ["NRV", "Net realisable value below cost"], ["Expiry", "Expired / near expiry"], ["Damage", "Damaged"], ["Recall", "Recalled"], ["Other", "Other"],
] as const;

export function StockAdjustments() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [open, setOpen] = useState<"count" | "writedown" | null>(null);
  const [toast, setToast] = useState<any>(null);
  async function load() { setRows(await fetch("/api/inventory/adjustments").then(r => r.json()).catch(() => [])); }
  useEffect(() => {
    load();
    fetch("/api/inventory/items").then(r => r.json()).then(d => setItems(Array.isArray(d) ? d.filter((i: any) => kindOf(i.productType).tracked && i.status === "Active") : [])).catch(() => {});
  }, []);
  async function remove(id: string) {
    if (!confirm("Void this adjustment? Its entry is removed and the stock goes back to what it was.")) return;
    const r = await fetch(`/api/inventory/adjustments?entryId=${id}`, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setToast({ message: d?.error || "Could not void.", type: "error" }); return; }
    setToast({ message: "Adjustment voided", type: "success" }); load();
  }

  return (
    <ListPage>
      <ListPageHeader title="Stock Adjustments" subtitle="Counts and write-downs. Each moves stock or its cost lot by lot, and posts one entry.">
        <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={rows === null ? "animate-spin" : ""} /></button>
        <Button variant="secondary" icon={TrendingDown} onClick={() => setOpen("writedown")}>Write down a lot</Button>
        <Button icon={ClipboardCheck} onClick={() => setOpen("count")}>Count stock</Button>
      </ListPageHeader>
      <div className="flex-1 overflow-auto p-6">
        <div className="rounded-lg border border-stone-800 overflow-hidden max-w-5xl">
          <table className="w-full text-[13px]">
            <thead><tr className={tableHead}>
              <th className="text-left px-4 py-2.5">No.</th><th className="text-left px-4 py-2.5">Date</th><th className="text-left px-4 py-2.5">Kind</th>
              <th className="text-left px-4 py-2.5">Memo</th><th className="text-right px-4 py-2.5">Value</th><th className="w-10" />
            </tr></thead>
            <tbody>
              {rows === null && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
              {rows?.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-500">No counts or write-downs yet.</td></tr>}
              {rows?.map(r => (
                <tr key={r.id} className="border-b border-stone-800/60">
                  <td className="px-4 py-2 font-mono text-[12px] text-stone-300">{r.docNumber || "—"}</td>
                  <td className="px-4 py-2 text-stone-400">{r.date}</td>
                  <td className="px-4 py-2 text-stone-200">{r.kind === "WriteDown" ? "Write-down" : "Count"}</td>
                  <td className="px-4 py-2 text-stone-400 truncate max-w-md">{r.memo}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-stone-200">{fmt.num2(r.amount)}</td>
                  <td className="px-2 py-2"><button onClick={() => remove(r.id)} className="p-1 text-stone-600 hover:text-rose-400" title="Void"><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {open === "count" && <CountDrawer items={items} onClose={() => setOpen(null)} onDone={m => { setOpen(null); load(); setToast({ message: m, type: "success" }); }} />}
      {open === "writedown" && <WritedownDrawer items={items} onClose={() => setOpen(null)} onDone={m => { setOpen(null); load(); setToast({ message: m, type: "success" }); }} />}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </ListPage>
  );
}

function useLots(itemId: string) {
  const [lots, setLots] = useState<any[] | null>(null);
  useEffect(() => {
    if (!itemId) { setLots(null); return; }
    setLots(null);
    fetch(`/api/inventory/adjustments?lotsFor=${itemId}`).then(r => r.json()).then(d => setLots(Array.isArray(d) ? d : [])).catch(() => setLots([]));
  }, [itemId]);
  return lots;
}

function ItemPicker({ items, value, onChange }: { items: any[]; value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Item" required>
      <SelectField inset value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Select…</option>
        {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
      </SelectField>
    </Field>
  );
}

function CountDrawer({ items, onClose, onDone }: { items: any[]; onClose: () => void; onDone: (m: string) => void }) {
  const [itemId, setItemId] = useState("");
  const [date, setDate] = useState(localToday());
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [found, setFound] = useState({ qty: "", unitCost: "", lotNo: "" });
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false); const [err, setErr] = useState<string | null>(null);
  const lots = useLots(itemId);
  const item = items.find(i => i.id === itemId);
  const diff = useMemo(() => (lots ?? []).reduce((s, l) => counted[l.id] === undefined || counted[l.id] === "" ? s : s + (Number(counted[l.id]) - l.remaining) * l.unitCost, 0)
    + (Number(found.qty) || 0) * (Number(found.unitCost) || 0), [lots, counted, found]);
  async function save() {
    setSaving(true); setErr(null);
    const lines = Object.entries(counted).filter(([, v]) => v !== "").map(([lotId, v]) => ({ lotId, countedQty: Number(v) || 0 }));
    const body: any = { kind: "count", date, lines, notes };
    if (Number(found.qty) > 0) body.found = [{ itemId, qty: Number(found.qty), unitCost: Number(found.unitCost), lotNo: found.lotNo || null }];
    const r = await fetch("/api/inventory/adjustments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) { setErr(d?.error || "Could not post the count."); return; }
    onDone(`Count posted${d.docNumber ? ` — ${d.docNumber}` : ""}`);
  }
  return (
    <Drawer title="Count stock" subtitle="Enter what is physically there, lot by lot. Leave a lot blank to leave it as it is." onClose={onClose} size="lg"
      footer={<DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel="Post count" err={err} saveDisabled={!itemId} />}>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <ItemPicker items={items} value={itemId} onChange={v => { setItemId(v); setCounted({}); }} />
          <Field label="Count date"><input type="date" className={controlInset} value={date} onChange={e => setDate(e.target.value)} /></Field>
        </div>
        {itemId && (
          <Section title="Lots">
            <div className="rounded-lg border border-stone-800 overflow-hidden">
              <table className="w-full text-[12px]">
                <thead><tr className="border-b border-stone-800"><th className={th}>Lot</th><th className={`${th} text-right`}>System</th><th className={`${th} text-right`}>Unit cost</th><th className={`${th} text-right w-32`}>Counted</th></tr></thead>
                <tbody>
                  {lots === null && <tr><td colSpan={4} className="px-3 py-3 text-center text-stone-500">Loading…</td></tr>}
                  {lots?.length === 0 && <tr><td colSpan={4} className="px-3 py-3 text-center text-stone-500">No open lots — record found stock below.</td></tr>}
                  {lots?.map(l => (
                    <tr key={l.id} className="border-b border-stone-800/50">
                      <td className="px-3 py-1.5 font-mono text-[12px] text-stone-300">{l.lotNo || "—"}{l.allocated > 0 && <span className="block text-[10px] font-sans text-stone-500">{fmt.qty(l.allocated)} allocated to MOs</span>}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-stone-400">{fmt.qty(l.remaining)} {l.baseUom || ""}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-stone-400">{fmt.num2(l.unitCost)}</td>
                      <td className="px-3 py-1"><input type="number" min="0" step="any" className={`${cell} text-right tabular-nums`} value={counted[l.id] ?? ""} placeholder={String(l.remaining)} onChange={e => setCounted(c => ({ ...c, [l.id]: e.target.value }))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}
        {itemId && (
          <Section title="Found stock" desc="Stock that belongs to no lot becomes a new lot at the cost you state.">
            <div className="grid grid-cols-3 gap-3">
              <Field label={`Quantity${item?.baseUom ? ` (${item.baseUom})` : ""}`}><input type="number" min="0" step="any" className={controlInset} value={found.qty} onChange={e => setFound(f => ({ ...f, qty: e.target.value }))} /></Field>
              <Field label="Unit cost"><input type="number" min="0" step="any" className={controlInset} value={found.unitCost} onChange={e => setFound(f => ({ ...f, unitCost: e.target.value }))} /></Field>
              <Field label="Lot no."><input className={controlInset} value={found.lotNo} onChange={e => setFound(f => ({ ...f, lotNo: e.target.value }))} placeholder="optional" /></Field>
            </div>
          </Section>
        )}
        <Field label="Notes"><input className={controlInset} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Month-end count, Store A" /></Field>
        {itemId && Math.abs(diff) >= 0.005 && <p className={t.secondary}>Posts {diff > 0 ? "a gain" : "a loss"} of <b className="text-stone-200">{fmt.num2(Math.abs(diff))}</b> against Inventory adjustments.</p>}
      </div>
    </Drawer>
  );
}

function WritedownDrawer({ items, onClose, onDone }: { items: any[]; onClose: () => void; onDone: (m: string) => void }) {
  const [itemId, setItemId] = useState("");
  const [lotId, setLotId] = useState("");
  const [date, setDate] = useState(localToday());
  const [newCost, setNewCost] = useState("");
  const [reason, setReason] = useState("NRV");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false); const [err, setErr] = useState<string | null>(null);
  const lots = useLots(itemId);
  const lot = lots?.find(l => l.id === lotId);
  const amount = lot && newCost !== "" ? Math.max(0, (lot.unitCost - (Number(newCost) || 0)) * lot.remaining) : 0;
  async function save() {
    setSaving(true); setErr(null);
    const r = await fetch("/api/inventory/adjustments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "writedown", date, lotId, newUnitCost: Number(newCost), reason, notes }) });
    const d = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) { setErr(d?.error || "Could not post the write-down."); return; }
    onDone(`Write-down posted${d.docNumber ? ` — ${d.docNumber}` : ""}`);
  }
  return (
    <Drawer title="Write down a lot" subtitle="Lowers one lot's unit cost. Other lots of the item are unaffected." onClose={onClose}
      footer={<DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel="Post write-down" err={err} saveDisabled={!lotId || newCost === ""} />}>
      <div className="space-y-4">
        <ItemPicker items={items} value={itemId} onChange={v => { setItemId(v); setLotId(""); }} />
        {itemId && (
          <Field label="Lot" required>
            <SelectField inset value={lotId} onChange={e => setLotId(e.target.value)}>
              <option value="">Select…</option>
              {(lots ?? []).map(l => <option key={l.id} value={l.id}>{l.lotNo || "lot"} · {fmt.qty(l.remaining)} {l.baseUom || ""} at {fmt.num2(l.unitCost)}{l.expiryDate ? ` · exp ${l.expiryDate}` : ""}</option>)}
            </SelectField>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field label="New unit cost" required hint={lot ? `Currently ${fmt.num2(lot.unitCost)}` : undefined}><input type="number" min="0" step="any" className={controlInset} value={newCost} onChange={e => setNewCost(e.target.value)} /></Field>
          <Field label="Date"><input type="date" className={controlInset} value={date} onChange={e => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Reason" required>
          <SelectField inset value={reason} onChange={e => setReason(e.target.value)}>{REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SelectField>
        </Field>
        <Field label="Notes"><input className={controlInset} value={notes} onChange={e => setNotes(e.target.value)} /></Field>
        {amount >= 0.005 && <p className={t.secondary}>Writes <b className="text-stone-200">{fmt.num2(amount)}</b> off to Inventory write-downs.</p>}
      </div>
    </Drawer>
  );
}
