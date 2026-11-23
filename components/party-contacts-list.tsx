"use client";

/**
 * A supplier's contacts (0142), inside the supplier drawer: who receives
 * orders, handles invoices, deliveries, quality, EDI. Each contact saves on its
 * own. Not the collections contacts customers have. Rules: lib/party-terms.ts.
 */

import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, UserRound, Loader } from "lucide-react";
import { controlInset, SelectField } from "@/components/form-kit";
import { CONTACT_ROLES, contactRoleLabel } from "@/lib/party-terms";
import { askConfirm } from "@/lib/dialogs";

type Row = { id: string; name: string; role: string; email: string | null; phone: string | null; isPrimary: boolean };
const EMPTY = { name: "", role: "purchasing", email: "", phone: "", isPrimary: false };
type Form = typeof EMPTY;
const label = "block text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-1";

export function PartyContactsList({ supplierId }: { supplierId: string }) {
  const base = `/api/parties/suppliers/${supplierId}/contacts`;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; f: Form } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    const r = await fetch(base).then(x => x.json()).catch(() => null);
    setRows(Array.isArray(r) ? r : []);
  }
  useEffect(() => { load(); }, [supplierId]);

  const open = (row?: Row) => {
    setErr("");
    setEditing(row ? { id: row.id, f: { name: row.name, role: row.role, email: row.email ?? "", phone: row.phone ?? "", isPrimary: row.isPrimary } } : { id: null, f: { ...EMPTY } });
  };
  const set = (k: keyof Form, v: any) => setEditing(e => (e ? { ...e, f: { ...e.f, [k]: v } } : e));

  async function save() {
    if (!editing) return;
    setBusy(true); setErr("");
    const r = await fetch(editing.id ? `${base}/${editing.id}` : base, {
      method: editing.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing.f),
    });
    setBusy(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save the contact."); return; }
    setEditing(null);
    load();
  }

  async function remove(row: Row) {
    if (!await askConfirm(`Remove ${row.name} from this supplier's contacts?`)) return;
    setErr("");
    const r = await fetch(`${base}/${row.id}`, { method: "DELETE" });
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not remove."); return; }
    load();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-semibold text-stone-300 uppercase tracking-wider">Contacts</div>
        {!editing && <button type="button" onClick={() => open()} className="flex items-center gap-1 text-[12px] font-medium text-emerald-400 hover:text-emerald-300"><Plus size={13} /> Add contact</button>}
      </div>
      <p className="text-[11px] text-stone-500">Who handles orders, invoices and deliveries at this supplier. Each contact saves on its own.</p>
      {err && <p className="text-[12px] text-rose-400">{err}</p>}
      {rows === null && <p className="text-[12px] text-stone-500">Loading…</p>}
      {rows !== null && rows.length === 0 && !editing && <p className="text-[12px] text-stone-500">No contacts yet.</p>}
      {(rows ?? []).map(r => (
        <div key={r.id} className="flex items-start justify-between gap-3 rounded-lg border border-stone-800 px-3 py-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[13px] text-stone-200">
              <UserRound size={13} className="text-stone-500 shrink-0" />
              <span className="truncate">{r.name}</span>
              <span className="text-[11px] text-stone-500">{contactRoleLabel(r.role)}</span>
              {r.isPrimary && <span className="text-[11px] text-emerald-400">Primary</span>}
            </div>
            <div className="text-[11px] text-stone-400 mt-0.5">{[r.email, r.phone].filter(Boolean).join(" · ")}</div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button type="button" onClick={() => open(r)} className="p-1 rounded hover:bg-stone-700 text-stone-500 hover:text-stone-200" title="Edit" aria-label={`Edit ${r.name}`}><Pencil size={13} /></button>
            <button type="button" onClick={() => remove(r)} className="p-1 rounded hover:bg-stone-700 text-stone-500 hover:text-rose-400" title="Remove" aria-label={`Remove ${r.name}`}><Trash2 size={13} /></button>
          </div>
        </div>
      ))}
      {editing && (
        <div className="rounded-lg border border-stone-700 p-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Name *</label><input value={editing.f.name} onChange={e => set("name", e.target.value)} className={controlInset} /></div>
            <div>
              <label className={label}>Handles</label>
              <SelectField inset value={editing.f.role} onChange={e => set("role", e.target.value)}>
                {CONTACT_ROLES.map(r => <option key={r.v} value={r.v}>{r.label}</option>)}
              </SelectField>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Email</label><input type="email" value={editing.f.email} onChange={e => set("email", e.target.value)} className={controlInset} /></div>
            <div><label className={label}>Phone</label><input value={editing.f.phone} onChange={e => set("phone", e.target.value)} className={controlInset} /></div>
          </div>
          <label className="flex items-center gap-2 text-[12.5px] text-stone-200 cursor-pointer">
            <input type="checkbox" className="accent-emerald-600" checked={editing.f.isPrimary} onChange={e => set("isPrimary", e.target.checked)} /> Primary contact
          </label>
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => { setEditing(null); setErr(""); }} className="text-[12px] text-stone-400 hover:text-stone-200">Cancel</button>
            <button type="button" onClick={save} disabled={busy} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[12px] font-medium disabled:opacity-50">
              {busy && <Loader size={12} className="animate-spin" />} {editing.id ? "Save contact" : "Add contact"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
