"use client";

/**
 * A customer's delivery addresses (0141), inside the customer drawer. Each
 * address saves on its own (its own Save), apart from the drawer's Save: an
 * address is its own record, and losing a typed address because the customer
 * form had an unrelated error would be worse than two buttons.
 * Rules: lib/customer-ship-to(-server).ts.
 */

import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, MapPin, Loader } from "lucide-react";
import { controlInset } from "@/components/form-kit";
import { CountrySelect } from "@/components/country-select";
import { shipToOneLine } from "@/lib/customer-ship-to";
import { askConfirm } from "@/lib/dialogs";

type Row = {
  id: string; name: string; code: string | null; addressStreet: string | null; addressLine2: string | null; addressCity: string | null;
  addressState: string | null; addressPostcode: string | null; countryCode: string | null; gln: string | null;
  contactName: string | null; contactPhone: string | null; isDefault: boolean; status: string;
};
const EMPTY = { name: "", code: "", addressStreet: "", addressLine2: "", addressCity: "", addressState: "", addressPostcode: "", countryCode: "", gln: "", contactName: "", contactPhone: "", isDefault: false, status: "Active" };
type Form = typeof EMPTY;

const label = "block text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-1";

export function CustomerShipToList({ customerId }: { customerId: string }) {
  const base = `/api/parties/customers/${customerId}/ship-to`;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; f: Form } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    const r = await fetch(base).then(x => x.json()).catch(() => null);
    setRows(Array.isArray(r) ? r : []);
  }
  useEffect(() => { load(); }, [customerId]);

  const open = (row?: Row) => {
    setErr("");
    setEditing(row
      ? { id: row.id, f: Object.fromEntries(Object.keys(EMPTY).map(k => [k, (row as any)[k] ?? (EMPTY as any)[k]])) as Form }
      : { id: null, f: { ...EMPTY } });
  };
  const set = (k: keyof Form, v: any) => setEditing(e => (e ? { ...e, f: { ...e.f, [k]: v } } : e));

  async function save() {
    if (!editing) return;
    if (!editing.f.name.trim()) { setErr("Give the delivery address a name."); return; }
    setBusy(true); setErr("");
    const r = await fetch(editing.id ? `${base}/${editing.id}` : base, {
      method: editing.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing.f),
    });
    setBusy(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save the delivery address."); return; }
    setEditing(null);
    load();
  }

  async function remove(row: Row) {
    if (!await askConfirm(`Delete the delivery address "${row.name}"?`)) return;
    setErr("");
    const r = await fetch(`${base}/${row.id}`, { method: "DELETE" });
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not delete."); return; }
    load();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-semibold text-stone-300 uppercase tracking-wider">Delivery addresses</div>
        {!editing && <button type="button" onClick={() => open()} className="flex items-center gap-1 text-[12px] font-medium text-emerald-400 hover:text-emerald-300"><Plus size={13} /> Add address</button>}
      </div>
      <p className="text-[11px] text-stone-500">Where this customer takes delivery: stores, distribution centres. A sales order picks one; the default is used when none is chosen. Each address saves on its own.</p>
      {err && <p className="text-[12px] text-rose-400">{err}</p>}

      {rows === null && <p className="text-[12px] text-stone-500">Loading…</p>}
      {rows !== null && rows.length === 0 && !editing && <p className="text-[12px] text-stone-500">No delivery addresses yet.</p>}
      {(rows ?? []).map(r => (
        <div key={r.id} className={`flex items-start justify-between gap-3 rounded-lg border border-stone-800 px-3 py-2 ${r.status === "Inactive" ? "opacity-50" : ""}`}>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[13px] text-stone-200">
              <MapPin size={13} className="text-stone-500 shrink-0" />
              <span className="truncate">{shipToOneLine(r)}</span>
              {r.isDefault && <span className="text-[11px] text-emerald-400">Default</span>}
              {r.status === "Inactive" && <span className="text-[11px] text-stone-500">Inactive</span>}
            </div>
            {(r.code || r.gln) && <div className="text-[11px] text-stone-500 font-mono mt-0.5">{[r.code && `Their code ${r.code}`, r.gln && `GLN ${r.gln}`].filter(Boolean).join(" · ")}</div>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button type="button" onClick={() => open(r)} className="p-1 rounded hover:bg-stone-700 text-stone-500 hover:text-stone-200" title="Edit" aria-label={`Edit ${r.name}`}><Pencil size={13} /></button>
            <button type="button" onClick={() => remove(r)} className="p-1 rounded hover:bg-stone-700 text-stone-500 hover:text-rose-400" title="Delete" aria-label={`Delete ${r.name}`}><Trash2 size={13} /></button>
          </div>
        </div>
      ))}

      {editing && (
        <div className="rounded-lg border border-stone-700 p-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Name *</label><input value={editing.f.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Dublin DC" className={controlInset} /></div>
            <div><label className={label}>Their location code</label><input value={editing.f.code} onChange={e => set("code", e.target.value)} placeholder="Store / DC number, optional" className={`${controlInset} font-mono`} /></div>
          </div>
          <div><label className={label}>Street address</label><input value={editing.f.addressStreet} onChange={e => set("addressStreet", e.target.value)} className={controlInset} /></div>
          <div><label className={label}>Address line 2</label><input value={editing.f.addressLine2} onChange={e => set("addressLine2", e.target.value)} className={controlInset} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>City / Town</label><input value={editing.f.addressCity} onChange={e => set("addressCity", e.target.value)} className={controlInset} /></div>
            <div><label className={label}>State / Province / County</label><input value={editing.f.addressState} onChange={e => set("addressState", e.target.value)} className={controlInset} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Postal / ZIP code</label><input value={editing.f.addressPostcode} onChange={e => set("addressPostcode", e.target.value)} className={controlInset} /></div>
            <div><label className={label}>Country</label><CountrySelect inset code={editing.f.countryCode} onChange={code => set("countryCode", code)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>GLN</label><input value={editing.f.gln} onChange={e => set("gln", e.target.value)} inputMode="numeric" placeholder="13 digits, optional" className={`${controlInset} font-mono`} /></div>
            <div><label className={label}>Contact</label><input value={editing.f.contactName} onChange={e => set("contactName", e.target.value)} placeholder="Name, optional" className={controlInset} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Contact phone</label><input value={editing.f.contactPhone} onChange={e => set("contactPhone", e.target.value)} className={controlInset} /></div>
            <div className="flex flex-col justify-end gap-2 pb-1">
              <label className="flex items-center gap-2 text-[12.5px] text-stone-200 cursor-pointer">
                <input type="checkbox" className="accent-emerald-600" checked={editing.f.isDefault} disabled={editing.f.status === "Inactive"} onChange={e => set("isDefault", e.target.checked)} /> Default delivery address
              </label>
              {editing.id && (
                <label className="flex items-center gap-2 text-[12.5px] text-stone-200 cursor-pointer">
                  <input type="checkbox" className="accent-emerald-600" checked={editing.f.status === "Inactive"}
                    onChange={e => setEditing(x => (x ? { ...x, f: { ...x.f, status: e.target.checked ? "Inactive" : "Active", isDefault: e.target.checked ? false : x.f.isDefault } } : x))} /> Inactive
                </label>
              )}
            </div>
          </div>
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => { setEditing(null); setErr(""); }} className="text-[12px] text-stone-400 hover:text-stone-200">Cancel</button>
            <button type="button" onClick={save} disabled={busy} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[12px] font-medium disabled:opacity-50">
              {busy && <Loader size={12} className="animate-spin" />} {editing.id ? "Save address" : "Add address"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
