"use client";

import { useEffect, useState, useCallback } from "react";
import { Package, Plus, Loader, X, Trash2, Pencil } from "lucide-react";

type Item = { id: string; name: string; description: string | null; unitAmount: number; currency: string; taxRate: number | null; active: boolean };

function money(cents: number, ccy = "eur") {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy.toUpperCase() }).format((cents || 0) / 100); }
  catch { return `${ccy.toUpperCase()} ${(cents / 100).toFixed(2)}`; }
}

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/items").then(r => r.ok ? r.json() : { items: [] })
      .then(d => { setItems(d.items ?? []); setNeedsSetup(!!d.needsSetup); }).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); } }, [toast]);

  const remove = async (id: string) => {
    if (!confirm("Delete this item?")) return;
    setItems(its => its.filter(i => i.id !== id));
    await fetch(`/api/admin/items/${id}`, { method: "DELETE" }); setToast({ ok: true, msg: "Deleted" });
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Items</h1>
          <p className="text-xs text-stone-500 mt-0.5">Reusable products &amp; services to add to invoices — like a price book.</p>
        </div>
        <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 h-9 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"><Plus size={14} /> New item</button>
      </div>

      {needsSetup && (
        <div className="mb-4 rounded-lg ring-1 ring-amber-500/30 bg-amber-500/5 px-4 py-3 text-[13px] text-amber-300">
          The <span className="font-mono">catalog_items</span> table isn't set up yet — create it in Neon, then items will save here.
        </div>
      )}

      {loading ? (
        <div className="h-48 rounded-xl bg-stone-900/50 border border-stone-800 animate-pulse" />
      ) : items.length === 0 ? (
        <div className="py-16 text-center border border-stone-800 rounded-xl"><Package size={24} className="text-stone-700 mx-auto mb-3" /><p className="text-sm text-stone-500">No items yet — add your first product or service.</p></div>
      ) : (
        <div className="rounded-xl border border-stone-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-stone-800 bg-stone-900/40">
              {["Item", "Unit price", "Tax", "Status", ""].map(h => <th key={h} className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-stone-500 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id} className="border-b border-stone-800/50 hover:bg-stone-800/20 group">
                  <td className="px-4 py-2.5"><p className="text-stone-100 font-medium">{it.name}</p>{it.description && <p className="text-[11px] text-stone-500 truncate max-w-sm">{it.description}</p>}</td>
                  <td className="px-4 py-2.5 text-stone-200 tabular-nums">{money(it.unitAmount, it.currency)}</td>
                  <td className="px-4 py-2.5 text-stone-400">{it.taxRate != null ? `${it.taxRate}%` : "—"}</td>
                  <td className="px-4 py-2.5">{it.active ? <span className="text-[11px] text-emerald-400">Active</span> : <span className="text-[11px] text-stone-500">Inactive</span>}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100">
                      <button onClick={() => setEditing(it)} className="p-1 rounded hover:bg-stone-800 text-stone-500 hover:text-stone-200"><Pencil size={13} /></button>
                      <button onClick={() => remove(it.id)} className="p-1 rounded hover:bg-rose-500/15 text-stone-600 hover:text-rose-400"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <ItemModal item={editing} onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); load(); setToast({ ok: true, msg: "Saved" }); }} onToast={setToast} />
      )}
      {toast && <div className={`fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-lg text-sm font-medium shadow-xl ${toast.ok ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>{toast.msg}</div>}
    </div>
  );
}

function ItemModal({ item, onClose, onSaved, onToast }: { item: Item | null; onClose: () => void; onSaved: () => void; onToast: (t: any) => void }) {
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [price, setPrice] = useState(item ? String((item.unitAmount / 100).toFixed(2)) : "");
  const [currency, setCurrency] = useState(item?.currency ?? "eur");
  const [taxRate, setTaxRate] = useState(item?.taxRate != null ? String(item.taxRate) : "");
  const [active, setActive] = useState(item?.active ?? true);
  const [saving, setSaving] = useState(false);
  const inp = "w-full px-3 py-2 text-[13px] rounded-md bg-stone-800 border border-stone-700 text-stone-200 focus:outline-none focus:border-emerald-500";
  const lbl = "text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1";

  const save = async () => {
    if (!name.trim()) { onToast({ ok: false, msg: "Name required" }); return; }
    setSaving(true);
    const body = { name: name.trim(), description, unitAmount: Math.round((parseFloat(price) || 0) * 100), currency, taxRate: taxRate.trim() === "" ? null : parseInt(taxRate), active };
    const r = await fetch(item ? `/api/admin/items/${item.id}` : "/api/admin/items", { method: item ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({})); setSaving(false);
    if (r.ok) onSaved(); else onToast({ ok: false, msg: d.error ?? "Save failed" });
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-stone-900 rounded-xl w-full max-w-md ring-1 ring-stone-800 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800"><h2 className="text-sm font-semibold text-white">{item ? "Edit item" : "New item"}</h2><button onClick={onClose} className="text-stone-500 hover:text-stone-300"><X size={18} /></button></div>
        <div className="p-5 space-y-3">
          <div><label className={lbl}>Name</label><input className={inp} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. AR Automation — Pro" autoFocus /></div>
          <div><label className={lbl}>Description</label><textarea className={`${inp} resize-none`} rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional — shown on the invoice line" /></div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-1"><label className={lbl}>Unit price</label><input className={inp} type="number" min={0} step="0.01" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" /></div>
            <div><label className={lbl}>Currency</label><select className={inp} value={currency} onChange={e => setCurrency(e.target.value)}>{["eur","usd","gbp","cad","aud"].map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}</select></div>
            <div><label className={lbl}>Tax %</label><input className={inp} type="number" min={0} max={100} value={taxRate} onChange={e => setTaxRate(e.target.value)} placeholder="—" /></div>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-stone-300"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="accent-emerald-500" /> Active (available to add to invoices)</label>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-stone-800">
          <button onClick={onClose} className="h-9 px-4 text-xs font-medium rounded-lg text-stone-400 hover:bg-stone-800">Cancel</button>
          <button onClick={save} disabled={saving} className="h-9 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 text-white flex items-center gap-1.5">{saving && <Loader size={13} className="animate-spin" />} {item ? "Save" : "Create item"}</button>
        </div>
      </div>
    </div>
  );
}
