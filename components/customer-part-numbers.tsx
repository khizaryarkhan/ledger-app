"use client";

/**
 * Customer part numbers on an item (0140): each customer's own code for what we
 * sell them, optionally per sales SKU and pack level. This is what lets an
 * order the customer sends (X12 850, their code in BP) be matched to our item
 * without guessing. Rules: lib/inventory/part-numbers(-server).ts.
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Tags } from "lucide-react";
import { SelectField, controlInset, th } from "@/components/form-kit";
import { customerLevels, partLevelName, PART_NUMBER_MAX } from "@/lib/inventory/part-numbers";
import type { PackLevel } from "@/lib/inventory/identifiers";

type Row = { id: string; customerId: string; customerName: string; itemSkuId: string | null; skuName: string | null; packLevel: string; code: string };

export function CustomerPartNumbers({ item }: { item: { id: string; baseUom?: string | null } }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [skus, setSkus] = useState<any[]>([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ customerId: "", itemSkuId: "", packLevel: "unit", code: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    const r = await fetch(`/api/inventory/customer-part-numbers?itemId=${item.id}`).then(x => x.json()).catch(() => null);
    setRows(Array.isArray(r) ? r : []);
  }
  useEffect(() => { load(); }, [item.id]);
  useEffect(() => {
    if (!adding || customers.length) return;
    fetch(`/api/parties/customers?native=1`).then(x => x.json()).then(r => setCustomers(Array.isArray(r) ? r : [])).catch(() => {});
    fetch(`/api/inventory/items/${item.id}`).then(x => x.json()).then(r => setSkus(r?.skus ?? [])).catch(() => {});
  }, [adding]);

  const sku = skus.find(s => s.id === form.itemSkuId) ?? null;
  const levels = useMemo(() => customerLevels(sku), [sku]);
  const levelLabel = (l: string) => (l === "unit" && !sku ? `Base unit${item.baseUom ? ` (${item.baseUom})` : ""}` : partLevelName(l as PackLevel));

  async function add() {
    if (!form.customerId) { setErr("Choose a customer."); return; }
    if (!form.code.trim()) { setErr("Enter the customer's part number."); return; }
    setBusy(true); setErr("");
    const r = await fetch(`/api/inventory/customer-part-numbers`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: item.id, customerId: form.customerId, itemSkuId: form.itemSkuId || null, packLevel: form.packLevel, code: form.code }),
    });
    setBusy(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save."); return; }
    setForm(f => ({ ...f, code: "" }));
    load();
  }

  async function remove(id: string) {
    setErr("");
    const r = await fetch(`/api/inventory/customer-part-numbers?id=${id}`, { method: "DELETE" });
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not remove."); return; }
    load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-stone-300">
          <Tags size={14} className="text-sky-400" /> Customer part numbers
          <span className="text-stone-500 font-normal">· their code for this item, used to match their orders</span>
        </div>
        {!adding && <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-[12px] font-medium text-emerald-400 hover:text-emerald-300"><Plus size={13} /> Add part number</button>}
      </div>
      {err && <p className="text-[12px] text-rose-400 mb-2">{err}</p>}
      {adding && (
        <div className="grid grid-cols-[1.4fr_1.2fr_1fr_1.2fr_auto] gap-2 items-center mb-2">
          <SelectField inset value={form.customerId} onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))} aria-label="Customer">
            <option value="">Customer…</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </SelectField>
          <SelectField inset value={form.itemSkuId} onChange={e => setForm(f => ({ ...f, itemSkuId: e.target.value, packLevel: "unit" }))} aria-label="Sales SKU">
            <option value="">No SKU (the item)</option>
            {skus.map(s => <option key={s.id} value={s.id}>{s.skuName || s.skuCode || "SKU"}</option>)}
          </SelectField>
          <SelectField inset value={form.packLevel} onChange={e => setForm(f => ({ ...f, packLevel: e.target.value }))} aria-label="Pack level" disabled={levels.length < 2}>
            {levels.map(l => <option key={l} value={l}>{levelLabel(l)}</option>)}
          </SelectField>
          <input className={`${controlInset} font-mono`} value={form.code} maxLength={PART_NUMBER_MAX} placeholder="Their part number"
            onChange={e => setForm(f => ({ ...f, code: e.target.value }))} onKeyDown={e => { if (e.key === "Enter") add(); }} aria-label="Customer part number" />
          <div className="flex items-center gap-2">
            <button onClick={add} disabled={busy} className="h-8 px-3 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[12px] font-medium disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
            <button onClick={() => { setAdding(false); setErr(""); }} className="text-[12px] text-stone-400 hover:text-stone-200">Done</button>
          </div>
        </div>
      )}
      <div className="rounded-lg border border-stone-800 overflow-hidden">
        <table className="w-full text-[12px]">
          <thead><tr className="border-b border-stone-800">
            <th className={th}>Customer</th><th className={th}>Sales SKU</th><th className={th}>Pack level</th><th className={th}>Their part number</th><th className="w-10" />
          </tr></thead>
          <tbody>
            {rows === null && <tr><td colSpan={5} className="px-3 py-4 text-center text-stone-500">Loading…</td></tr>}
            {rows !== null && rows.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-stone-500">None yet. Add the code a customer uses on their orders.</td></tr>}
            {(rows ?? []).map(r => (
              <tr key={r.id} className="border-b border-stone-800/50">
                <td className="px-3 py-2 text-stone-200">{r.customerName}</td>
                <td className="px-3 py-2 text-stone-400">{r.skuName || (r.itemSkuId ? "SKU" : "—")}</td>
                <td className="px-3 py-2 text-stone-400">{r.packLevel === "unit" && !r.itemSkuId ? "Base unit" : partLevelName(r.packLevel as PackLevel)}</td>
                <td className="px-3 py-2 font-mono text-stone-200">{r.code}</td>
                <td className="px-2 py-2 text-right">
                  <button onClick={() => remove(r.id)} className="p-1 rounded hover:bg-stone-700 text-stone-500 hover:text-rose-400" title="Remove" aria-label={`Remove ${r.code}`}><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
