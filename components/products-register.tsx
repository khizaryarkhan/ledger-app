"use client";

/**
 * Inventory Products register — Finished Products & Raw Materials.
 *
 *  • Finished Product: a base UoM is set on the item; each SKU defines how it is
 *    packaged for sale (inner unit → inner pack → outer pack), with a live pack
 *    configuration string.
 *  • Raw Material: each supplier link records the supplier's own UoM & packaging.
 *    When the supplier UoM is in a different dimension from the item base UoM
 *    (e.g. item "lt", supplier "lb"), a conversion factor is required.
 *
 * Accounting fields (price, cost, income/expense account, tax) live on the item.
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Search, ChevronRight, ChevronDown, Trash2, X, Loader, Check, Package, Boxes, Layers, Pencil } from "lucide-react";
import { UOMS, PACK_TYPES, needsConversionFactor } from "@/lib/inventory/uom";
import { perSupplierUnit } from "@/lib/inventory/order-options";
import { QuickAdd, type QuickAddKind } from "@/components/quick-add";
import { ITEM_KIND_LIST, ITEM_KINDS, kindOf, type ItemKind } from "@/lib/inventory/item-kinds";
import { allowsPackConfiguration, defaultSourcingPolicy } from "@/lib/inventory/sourcing";
import { classifyBarcode, showBarcode, levelLabel, type PackLevel } from "@/lib/inventory/identifiers";
import { CURRENCIES } from "@/lib/accounting/currencies";
import { fmt } from "@/lib/format";
import { Field, Section, SelectField, CellSelect, cell, controlInset, th } from "@/components/form-kit";

type ProductType = ItemKind;

const inputCls = controlInset;

const UOM_GROUPS: { dim: string; label: string }[] = [
  { dim: "mass", label: "Mass" }, { dim: "volume", label: "Volume" },
  { dim: "count", label: "Count" }, { dim: "length", label: "Length" },
];

function UomSelect({ value, onChange, placeholder = "Select UoM…" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <SelectField inset value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {UOM_GROUPS.map(g => (
        <optgroup key={g.dim} label={g.label}>
          {UOMS.filter(u => u.dimension === g.dim).map(u => <option key={u.code} value={u.code}>{u.name} ({u.code})</option>)}
        </optgroup>
      ))}
    </SelectField>
  );
}

const KIND_BADGE: Record<ItemKind, string> = {
  FinishedProduct: "bg-emerald-500/12 text-emerald-400 border-emerald-800/50",
  StockItem:       "bg-sky-500/12 text-sky-400 border-sky-800/50",
  RawMaterial:     "bg-amber-500/12 text-amber-400 border-amber-800/50",
  WorkInProgress:  "bg-violet-500/12 text-violet-400 border-violet-800/50",
  NonInventory:    "bg-stone-500/12 text-stone-300 border-stone-700",
  Service:         "bg-teal-500/12 text-teal-300 border-teal-800/50",
};
function TypeBadge({ t }: { t: string }) {
  const m = kindOf(t);
  return <span className={`text-[10px] font-medium border rounded-full px-2 py-0.5 ${KIND_BADGE[m.kind]}`}>{m.label}</span>;
}

export function ProductsRegister() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | ProductType>("all");
  const [showNew, setShowNew] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    const r = await fetch(`/api/inventory/items`).then(x => x.json()).catch(() => []);
    setRows(Array.isArray(r) ? r : []);
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1") setShowNew(true);
  }, []);

  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (typeFilter !== "all") list = list.filter(r => r.productType === typeFilter);
    const s = q.trim().toLowerCase();
    if (s) list = list.filter(r => (r.name || "").toLowerCase().includes(s) || (r.code || "").toLowerCase().includes(s) || (r.category || "").toLowerCase().includes(s));
    return list;
  }, [rows, q, typeFilter]);

  const counts = useMemo(() => {
    const l = rows ?? [];
    const by: Record<string, number> = { all: l.length };
    for (const m of ITEM_KIND_LIST) by[m.kind] = l.filter(r => kindOf(r.productType).kind === m.kind).length;
    return by;
  }, [rows]);

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-teal-500/15 flex items-center justify-center"><Boxes size={18} className="text-teal-400" /></div>
          <h1 className="text-[20px] font-semibold text-stone-100">Products &amp; Services</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={rows === null ? "animate-spin" : ""} /></button>
          <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700">
            <Plus size={14} /> New item
          </button>
        </div>
      </div>
      <p className="text-[13px] text-stone-400 mb-5 ml-12">
        Your inventory register. <span className="text-emerald-400">Finished products</span> carry a base UoM and packaging SKUs; <span className="text-amber-400">raw materials</span> link to suppliers with their UoM and a conversion factor when units differ.
      </p>

      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-600" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, code or category…" className={`${inputCls} pl-9`} />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as any)} className={`${inputCls} max-w-[220px]`}>
          <option value="all">All types ({counts.all ?? 0})</option>
          {ITEM_KIND_LIST.map(m => <option key={m.kind} value={m.kind}>{m.label} ({counts[m.kind] ?? 0})</option>)}
        </select>
      </div>

      {showNew && <NewItemDrawer onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}

      <div className="rounded-lg bg-stone-900 border border-stone-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[720px]">
            <thead>
              <tr className="border-b border-stone-800">
                <th className="w-8" />
                <th className={`${th} px-4`}>Item name</th>
                <th className={`${th} px-4`}>Category</th>
                <th className={`${th} px-4`}>Base UoM</th>
                <th className={`${th} px-4`}>Item code</th>
                <th className={`${th} px-4 text-right`}>On hand</th>
                <th className={`${th} px-4`}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows === null && <tr><td colSpan={7} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
              {rows !== null && filtered.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-stone-500">No items yet — add one with the New item button.</td></tr>}
              {filtered.map(r => (
                <RowGroup key={r.id} item={r} open={expanded === r.id} onToggle={() => setExpanded(expanded === r.id ? null : r.id)} onChanged={load} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RowGroup({ item, open, onToggle, onChanged }: { item: any; open: boolean; onToggle: () => void; onChanged: () => void }) {
  const meta = kindOf(item.productType);
  // Sales SKUs describe our own packaging of stock we sell; supplier links
  // describe how a vendor sells it to us. An item can want both, one, or
  // neither — see the note on the expanded panel below.
  const showsSkus = meta.sellable && meta.tracked;
  const showsSuppliers = meta.buyable;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function del() {
    if (!confirm(`Delete "${item.name}"? This can't be undone.`)) return;
    setBusy(true); setErr("");
    const r = await fetch(`/api/inventory/items/${item.id}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not delete."); return; }
    onChanged();
  }

  return (
    <>
      <tr className={`border-b border-stone-800/60 hover:bg-stone-800/30 cursor-pointer ${item.status === "Inactive" ? "opacity-45" : ""}`} onClick={onToggle}>
        <td className="pl-3 text-stone-500">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-stone-100 font-medium">{item.name}</span>
            <TypeBadge t={item.productType} />
          </div>
        </td>
        <td className="px-4 py-2.5 text-stone-400">{item.category || "—"}</td>
        <td className="px-4 py-2.5 text-stone-300 font-mono text-[12px]">{item.baseUom || "—"}</td>
        <td className="px-4 py-2.5 text-stone-400 font-mono text-[12px]">{item.code || "—"}</td>
        <td className="px-4 py-2.5 text-right text-stone-300 tabular-nums">{meta.tracked ? `${Number(item.onHandQty ?? 0).toLocaleString()} ${item.baseUom || ""}` : "—"}</td>
        <td className="px-4 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className={`text-[11px] ${item.status === "Inactive" ? "text-stone-500" : "text-emerald-400"}`}>{item.status || "Active"}</span>
            <span className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
              <button onClick={() => setEditing(true)} className="p-1 rounded hover:bg-stone-700 text-stone-500 hover:text-stone-200" title="Edit item"><Pencil size={13} /></button>
              <button onClick={del} disabled={busy} className="p-1 rounded hover:bg-stone-700 text-stone-500 hover:text-rose-400 disabled:opacity-50" title="Delete item"><Trash2 size={13} /></button>
            </span>
          </div>
        </td>
      </tr>
      {err && <tr><td colSpan={7} className="px-6 pb-2 bg-rose-500/5"><p className="text-[12px] text-rose-400">{err}</p></td></tr>}
      {open && (
        <tr className="border-b border-stone-800/60 bg-stone-950/40">
          <td colSpan={7} className="px-6 py-4">
            {/* Derived from the kind's flags, never enumerated by kind, and
                exhaustive by construction: whatever the flags say, the panel
                says something. The previous version hand-wrote the three
                conditions and Work in Progress (tracked, but neither bought nor
                sold) satisfied none of them — it opened to a blank panel — while
                the "non-inventory" note could never appear at all, because both
                non-tracked kinds are buyable. */}
            <div className="space-y-5">
              {showsSkus && <SkuEditor item={item} onChanged={onChanged} />}
              {showsSuppliers && <SupplierSkuEditor item={item} onChanged={onChanged} />}
              {!showsSkus && !showsSuppliers && (
                <p className="text-[12px] text-stone-500 leading-relaxed">
                  {meta.tracked
                    ? <>A {meta.label.toLowerCase()} is held in stock but is neither bought nor sold — it is produced by a build and consumed by another one, so it has no supplier packaging and no sales SKUs. Its quantity and FIFO cost come from those builds.</>
                    : <>This is a non-inventory {meta.label.toLowerCase()} — no stock, lots or packaging are tracked. It posts directly to its income/expense accounts.</>}
                </p>
              )}
            </div>
          </td>
        </tr>
      )}
      {editing && <EditItemDrawer item={item} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged(); }} />}
    </>
  );
}

/* ----------------------------- Packaging grid ----------------------------- */

// Packaging is edited IN PLACE, one table row per level — the shape of SAP's
// "Units of measure" tab: what the level is, what it contains, what that comes
// to in the base unit, and the level's GTIN. It replaced two rounds of side
// drawers, which hid the hierarchy behind a click and never showed more than
// one level's barcode next to another's. Here every level and every code of a
// link is visible at once, and edited where it is read.

type Codes = Partial<Record<PackLevel, string>>;
const jsonHeaders = { "Content-Type": "application/json" };
/** Stored numerics arrive as "25.0000" — show them as the number they are. */
const numStr = (v: any) => (v == null || v === "" ? "" : isNaN(Number(v)) ? String(v) : String(Number(v)));
/** Stored codes → editable text, a GTIN in its shortest standard form. */
const codesFromRow = (row: any): Codes =>
  Object.fromEntries(Object.entries(row?.identifiers ?? {}).map(([lvl, b]: any) => [lvl, showBarcode(b)]));
/** Every level is sent, "" for the absent ones — so removing a level also removes its barcode. */
const codesPayload = (codes: Codes, levels: PackLevel[]) =>
  Object.fromEntries((["unit", "inner", "addl_inner", "outer"] as PackLevel[]).map(l => [l, levels.includes(l) ? (codes[l] ?? "") : ""]));
const firstInvalid = (codes: Codes, levels: PackLevel[]) =>
  levels.map(l => ({ l, c: classifyBarcode(codes[l]) })).find(x => "error" in x.c);
const qtyLabel = (q: number, uom: string) => (q > 0 ? `${fmt.qty(q)} ${uom}` : "—");

function UomCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <CellSelect value={value} onChange={e => onChange(e.target.value)} aria-label="Unit">
      <option value="">Unit…</option>
      {UOM_GROUPS.map(g => (
        <optgroup key={g.dim} label={g.label}>
          {UOMS.filter(u => u.dimension === g.dim).map(u => <option key={u.code} value={u.code}>{u.name} ({u.code})</option>)}
        </optgroup>
      ))}
    </CellSelect>
  );
}

function PackTypeCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <CellSelect value={value} onChange={e => onChange(e.target.value)} aria-label="Pack type">
      <option value="">Pack type…</option>
      {PACK_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
    </CellSelect>
  );
}

/** "[ 25 ] kg" — a quantity with its unit written after it, so the row reads as a sentence. */
function ContainsCell({ value, onChange, unit }: { value: string; onChange: (v: string) => void; unit: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {/* Width on a wrapper: form-kit's `cell` is w-full by design, so a
          width class on the input itself loses to it. */}
      <div className="w-20 shrink-0"><input type="number" step="any" min="0" className={`${cell} text-right tabular-nums`} value={value} onChange={e => onChange(e.target.value)} placeholder="0" /></div>
      <span className="text-[12px] text-stone-400 whitespace-nowrap">{unit}</span>
    </div>
  );
}

/** GTIN checked as you type, by the same rule the server enforces (classifyBarcode). */
function GtinCell({ value, onChange, editing }: { value: string; onChange: (v: string) => void; editing: boolean }) {
  const c = classifyBarcode(value);
  const kind = !value.trim() ? null : "error" in c ? "bad" : c.barcode?.scheme === "GTIN" ? "gtin" : "other";
  if (!editing) {
    if (!value) return <span className="text-stone-600">—</span>;
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-stone-200">
        {value}{kind === "other" && <span className="font-sans text-[11px] text-amber-400">internal</span>}
      </span>
    );
  }
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <input className={`${cell} font-mono`} value={value} onChange={e => onChange(e.target.value)} inputMode="numeric" placeholder="GTIN or barcode" aria-label="GTIN or barcode" />
        {kind === "gtin" && <span title="Valid GTIN" className="text-emerald-400 shrink-0"><Check size={13} /></span>}
        {kind === "other" && <span title="Not a GS1 GTIN — kept as an internal barcode" className="text-[11px] text-amber-400 shrink-0">internal</span>}
      </div>
      {kind === "bad" && <div className="text-[11px] text-rose-400 px-2 pt-0.5">{(c as any).error}</div>}
    </div>
  );
}

type GridRow = { key: string; level: React.ReactNode; contains: React.ReactNode; base: React.ReactNode; gtin: React.ReactNode; onRemove?: () => void; muted?: boolean };

function PackagingTable({ rows, editing, add }: { rows: GridRow[]; editing: boolean; add?: React.ReactNode }) {
  return (
    <table className="w-full text-[12px]">
      <thead><tr className="border-b border-stone-800">
        <th className={`${th} w-8`}>#</th>
        <th className={th}>Level</th>
        <th className={th}>Contains</th>
        <th className={`${th} text-right`}>= Base qty</th>
        <th className={th}>GTIN / barcode</th>
        {editing && <th className="w-8" />}
      </tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.key} className={`border-b border-stone-800/50 ${r.muted ? "text-stone-500" : ""}`}>
            <td className="px-2.5 py-1.5 text-stone-500 tabular-nums">{i + 1}</td>
            <td className="px-2.5 py-1.5 text-stone-200">{r.level}</td>
            <td className="px-2.5 py-1.5 text-stone-300">{r.contains}</td>
            <td className="px-2.5 py-1.5 text-right tabular-nums text-stone-300 whitespace-nowrap">{r.base}</td>
            <td className="px-2.5 py-1.5">{r.gtin}</td>
            {editing && <td className="px-2 py-1.5">{r.onRemove && <button type="button" onClick={r.onRemove} title="Remove this level" className="text-stone-600 hover:text-rose-400"><X size={13} /></button>}</td>}
          </tr>
        ))}
        {editing && add && <tr><td /><td colSpan={5} className="px-2.5 py-1.5">{add}</td></tr>}
      </tbody>
    </table>
  );
}

const AddLevel = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-400 hover:text-emerald-300 mr-4"><Plus size={12} /> {label}</button>
);

/** Save / Cancel strip for a block in edit mode. */
function BlockActions({ saving, err, onCancel, onSave, saveLabel }: { saving: boolean; err: string; onCancel: () => void; onSave: () => void; saveLabel: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 border-t border-stone-800 bg-stone-900/40">
      {err ? <p className="flex-1 text-[12px] text-rose-400">{err}</p> : <div className="flex-1" />}
      <button type="button" onClick={onCancel} className="text-[12px] text-stone-400 hover:text-stone-200 px-2 py-1">Cancel</button>
      <button type="button" onClick={onSave} disabled={saving}
        className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md px-3 py-1.5 disabled:opacity-50">
        {saving ? <Loader size={12} className="animate-spin" /> : <Check size={12} />} {saveLabel}
      </button>
    </div>
  );
}

const iconBtn = "p-1 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-800";

/* ----------------------------- Finished-product SKUs ----------------------------- */

function SkuEditor({ item, onChanged }: { item: any; onChanged: () => void }) {
  const [skus, setSkus] = useState<any[] | null>(null);
  const [onHand, setOnHand] = useState<Record<string, { packs: number | null; value: number }>>({});
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");
  async function load() {
    const r = await fetch(`/api/inventory/items/${item.id}`).then(x => x.json()).catch(() => null);
    setSkus(r?.skus ?? []);
    const oh: Record<string, { packs: number | null; value: number }> = {};
    for (const e of (r?.onHandBySku ?? [])) if (e.skuId) oh[e.skuId] = { packs: e.packs, value: e.value };
    setOnHand(oh);
  }
  useEffect(() => { load(); }, [item.id]);

  async function remove(id: string) {
    setErr("");
    const r = await fetch(`/api/inventory/skus?id=${id}`, { method: "DELETE" });
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not delete."); return; }
    load(); onChanged();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-stone-300"><Layers size={14} className="text-emerald-400" /> Packaging SKUs <span className="text-stone-500 font-normal">· base UoM {item.baseUom || "—"}</span></div>
        {!adding && <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-[12px] font-medium text-emerald-400 hover:text-emerald-300"><Plus size={13} /> Add SKU</button>}
      </div>
      {!item.baseUom && <p className="text-[12px] text-amber-400 mb-2">Set a base UoM on this item first so packaging can be expressed in it.</p>}
      {err && <p className="text-[12px] text-rose-400 mb-2">{err}</p>}
      <div className="space-y-2">
        {adding && <SkuBlock item={item} onDone={() => { setAdding(false); load(); onChanged(); }} onCancel={() => setAdding(false)} />}
        {skus === null && <div className="rounded-lg border border-stone-800 px-3 py-4 text-center text-[12px] text-stone-500">Loading…</div>}
        {skus !== null && skus.length === 0 && !adding && <div className="rounded-lg border border-stone-800 px-3 py-4 text-center text-[12px] text-stone-500">No SKUs yet.</div>}
        {(skus ?? []).map(s => (
          <SkuBlock key={s.id} item={item} sku={s} onHand={onHand[s.id]} onDone={() => { load(); onChanged(); }} onRemove={() => remove(s.id)} />
        ))}
      </div>
    </div>
  );
}

function SkuBlock({ item, sku, onHand, onDone, onCancel, onRemove }: {
  item: any; sku?: any; onHand?: { packs: number | null; value: number };
  onDone: () => void; onCancel?: () => void; onRemove?: () => void;
}) {
  const fresh = () => ({
    skuName: sku?.skuName ?? "", skuCode: sku?.skuCode ?? "",
    innerUnitPackSize: numStr(sku?.innerUnitPackSize), innerPackType: sku?.innerPackType ?? "",
    unitsInAddlInnerPack: numStr(sku?.unitsInAddlInnerPack), addlInnerPackType: sku?.addlInnerPackType ?? "",
    unitsInOuterPack: numStr(sku?.unitsInOuterPack), outerPackType: sku?.outerPackType ?? "",
  });
  const [editing, setEditing] = useState(!sku);
  const [f, setF] = useState<Record<string, string>>(fresh);
  const [codes, setCodes] = useState<Codes>(codesFromRow(sku));
  const [hasAddl, setHasAddl] = useState(!!(sku?.unitsInAddlInnerPack || sku?.addlInnerPackType));
  const [hasOuter, setHasOuter] = useState(!!(sku?.unitsInOuterPack || sku?.outerPackType));
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const set = (k: string) => (v: string) => setF(p => ({ ...p, [k]: v }));
  const setCode = (l: PackLevel) => (v: string) => setCodes(c => ({ ...c, [l]: v }));
  const base = item.baseUom || "unit";

  // Levels this SKU actually has — same rule as the API (skuValues).
  const levels: PackLevel[] = ["inner", ...(hasAddl ? ["addl_inner" as PackLevel] : []), ...(hasOuter ? ["outer" as PackLevel] : [])];
  const innerQty = Number(f.innerUnitPackSize) || 0;
  const addlQty = hasAddl ? (Number(f.unitsInAddlInnerPack) || 0) * innerQty : 0;
  const outerParent = hasAddl ? { qty: addlQty, label: f.addlInnerPackType || "multipack" } : { qty: innerQty, label: f.innerPackType || "unit" };
  const outerQty = hasOuter ? (Number(f.unitsInOuterPack) || 0) * outerParent.qty : 0;

  function cancel() {
    if (!sku) { onCancel?.(); return; }
    setF(fresh()); setCodes(codesFromRow(sku));
    setHasAddl(!!(sku.unitsInAddlInnerPack || sku.addlInnerPackType)); setHasOuter(!!(sku.unitsInOuterPack || sku.outerPackType));
    setErr(""); setEditing(false);
  }

  async function save() {
    if (!f.skuName.trim()) { setErr("SKU name is required."); return; }
    if (hasAddl && (!f.addlInnerPackType || !(Number(f.unitsInAddlInnerPack) > 0))) { setErr("Multipack: choose its pack type and how many it contains — or remove the row."); return; }
    if (hasOuter && (!f.outerPackType || !(Number(f.unitsInOuterPack) > 0))) { setErr("Outer pack: choose its pack type and how many it contains — or remove the row."); return; }
    const bad = firstInvalid(codes, levels);
    if (bad) { setErr(`${levelLabel(bad.l)} barcode: ${(bad.c as any).error}`); return; }
    setSaving(true); setErr("");
    const body = JSON.stringify({ itemId: item.id, ...f, identifiers: codesPayload(codes, levels) });
    const r = sku
      ? await fetch(`/api/inventory/skus?id=${sku.id}`, { method: "PATCH", headers: jsonHeaders, body })
      : await fetch(`/api/inventory/skus`, { method: "POST", headers: jsonHeaders, body });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save."); return; }
    setEditing(false); onDone();
  }

  const rows: GridRow[] = [
    { key: "base", muted: true, level: <span className="text-stone-500">{base} <span className="text-[11px]">(base unit)</span></span>, contains: "—", base: `1 ${base}`, gtin: <span className="text-stone-600">—</span> },
    {
      key: "inner",
      level: editing ? <PackTypeCell value={f.innerPackType} onChange={set("innerPackType")} /> : <>{f.innerPackType || "Consumer unit"} <span className="text-[11px] text-stone-500">consumer unit</span></>,
      contains: editing ? <ContainsCell value={f.innerUnitPackSize} onChange={set("innerUnitPackSize")} unit={base} /> : (innerQty ? `${fmt.qty(innerQty)} ${base}` : "—"),
      base: qtyLabel(innerQty, base),
      gtin: <GtinCell value={codes.inner ?? ""} onChange={setCode("inner")} editing={editing} />,
    },
    ...(hasAddl ? [{
      key: "addl",
      level: editing ? <PackTypeCell value={f.addlInnerPackType} onChange={set("addlInnerPackType")} /> : <>{f.addlInnerPackType} <span className="text-[11px] text-stone-500">multipack</span></>,
      contains: editing ? <ContainsCell value={f.unitsInAddlInnerPack} onChange={set("unitsInAddlInnerPack")} unit={f.innerPackType || "units"} /> : `${f.unitsInAddlInnerPack} ${f.innerPackType}`,
      base: qtyLabel(addlQty, base),
      gtin: <GtinCell value={codes.addl_inner ?? ""} onChange={setCode("addl_inner")} editing={editing} />,
      onRemove: () => { setHasAddl(false); setF(p => ({ ...p, unitsInAddlInnerPack: "", addlInnerPackType: "" })); setCodes(c => ({ ...c, addl_inner: "" })); },
    }] : []),
    ...(hasOuter ? [{
      key: "outer",
      level: editing ? <PackTypeCell value={f.outerPackType} onChange={set("outerPackType")} /> : <>{f.outerPackType} <span className="text-[11px] text-stone-500">outer pack</span></>,
      contains: editing ? <ContainsCell value={f.unitsInOuterPack} onChange={set("unitsInOuterPack")} unit={outerParent.label} /> : `${f.unitsInOuterPack} ${outerParent.label}`,
      base: qtyLabel(outerQty, base),
      gtin: <GtinCell value={codes.outer ?? ""} onChange={setCode("outer")} editing={editing} />,
      onRemove: () => { setHasOuter(false); setF(p => ({ ...p, unitsInOuterPack: "", outerPackType: "" })); setCodes(c => ({ ...c, outer: "" })); },
    }] : []),
  ];

  return (
    <div className={`rounded-lg border overflow-hidden ${editing ? "border-emerald-800/60" : "border-stone-800"}`}>
      <div className="flex items-center gap-3 px-3 py-2 bg-stone-900/60 border-b border-stone-800">
        {editing ? (
          <div className="flex-1 grid grid-cols-[2fr_1fr] gap-2">
            <input className={cell} value={f.skuName} onChange={e => set("skuName")(e.target.value)} placeholder="SKU name, e.g. 750ml bottle" aria-label="SKU name" autoFocus={!sku} />
            <input className={`${cell} font-mono`} value={f.skuCode} onChange={e => set("skuCode")(e.target.value)} placeholder="SKU code" aria-label="SKU code" />
          </div>
        ) : (
          <>
            <span className="text-[13px] font-medium text-stone-100">{sku?.skuName || "—"}</span>
            {sku?.skuCode && <span className="font-mono text-[11px] text-stone-500">{sku.skuCode}</span>}
            <div className="flex-1" />
            <span className="text-[12px] text-stone-400 tabular-nums">On hand {onHand && onHand.packs != null ? `${fmt.qty(onHand.packs)} ${sku?.innerPackType || "packs"}` : "0"}</span>
            <button onClick={() => setEditing(true)} className={iconBtn} title="Edit SKU"><Pencil size={13} /></button>
            {onRemove && <button onClick={onRemove} className={`${iconBtn} hover:text-rose-400`} title="Delete SKU"><Trash2 size={13} /></button>}
          </>
        )}
      </div>
      <PackagingTable rows={rows} editing={editing}
        add={(!hasAddl || !hasOuter) ? <>
          {!hasOuter && <AddLevel label="Add outer pack" onClick={() => setHasOuter(true)} />}
          {!hasAddl && <AddLevel label={hasOuter ? "Add multipack (between)" : "Add multipack"} onClick={() => setHasAddl(true)} />}
        </> : undefined} />
      {editing && <BlockActions saving={saving} err={err} onCancel={cancel} onSave={save} saveLabel={sku ? "Save" : "Create SKU"} />}
      {editing && sku && <p className="px-3 pb-2 text-[11px] text-stone-500">Once stock or documents use this SKU its pack sizes are fixed — the name, code, pack types and barcodes can still change.</p>}
    </div>
  );
}

/* ----------------------------- Supplier links ----------------------------- */

function SupplierSkuEditor({ item, onChanged }: { item: any; onChanged: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [policy, setPolicy] = useState<string>(item.sourcingPolicy ?? "restricted");
  const open = !allowsPackConfiguration(policy);
  async function load() {
    const r = await fetch(`/api/inventory/items/${item.id}`).then(x => x.json()).catch(() => null);
    setRows(r?.supplierSkus ?? []);
    if (r?.item?.sourcingPolicy) setPolicy(r.item.sourcingPolicy);
  }
  // Re-read when the policy changes from the Edit drawer, so the grid never
  // shows the old levels for the new rule.
  useEffect(() => { load(); }, [item.id, item.sourcingPolicy]);
  useEffect(() => { fetch(`/api/parties/suppliers?native=1`).then(x => x.json()).then(r => setSuppliers(Array.isArray(r) ? r : [])).catch(() => {}); }, []);
  async function remove(id: string) {
    setErr("");
    const r = await fetch(`/api/inventory/supplier-skus?id=${id}`, { method: "DELETE" });
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not remove."); return; }
    load(); onChanged();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-stone-300"><Package size={14} className="text-amber-400" /> Suppliers <span className="text-stone-500 font-normal">· item base UoM {item.baseUom || "—"}</span></div>
        {/* Offered under BOTH policies. On a restricted item a link is the
            permission to buy; on an open item it is only a commercial record
            (price, lead time, preferred, barcode) — optional, never restrictive. */}
        {!adding && <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-[12px] font-medium text-emerald-400 hover:text-emerald-300"><Plus size={13} /> Link supplier</button>}
      </div>
      {/* The policy is set in the item's Edit drawer; this line says which rule applies. */}
      <p className="mb-2 text-[11px] text-stone-500">
        {open
          ? <>Bought from <span className="text-stone-300 font-medium">any supplier</span>, in {item.baseUom || "its base unit"}. Linking one is optional — it records their price, lead time, barcode and whether they are preferred.</>
          : <>Bought only from the <span className="text-stone-300 font-medium">suppliers linked below</span>, in their units and packs.</>}
      </p>
      {err && <p className="text-[12px] text-rose-400 mb-2">{err}</p>}
      <div className="space-y-2">
        {adding && <SupplierLinkBlock item={item} open={open} suppliers={suppliers} setSuppliers={setSuppliers} onDone={() => { setAdding(false); load(); onChanged(); }} onCancel={() => setAdding(false)} />}
        {rows === null && <div className="rounded-lg border border-stone-800 px-3 py-4 text-center text-[12px] text-stone-500">Loading…</div>}
        {rows !== null && rows.length === 0 && !adding && (
          <div className="rounded-lg border border-stone-800 px-3 py-4 text-center text-[12px] text-stone-500">
            {open ? "No suppliers recorded — none needed, anyone may supply this item." : "No suppliers linked yet — link one before raising a purchase order."}
          </div>
        )}
        {(rows ?? []).map(s => (
          <SupplierLinkBlock key={s.id} item={item} open={open} link={s} suppliers={suppliers} setSuppliers={setSuppliers} onDone={() => { load(); onChanged(); }} onRemove={() => remove(s.id)} />
        ))}
      </div>
    </div>
  );
}

function SupplierLinkBlock({ item, open, link, suppliers, setSuppliers, onDone, onCancel, onRemove }: {
  item: any; open: boolean; link?: any; suppliers: any[]; setSuppliers: (fn: (p: any[]) => any[]) => void;
  onDone: () => void; onCancel?: () => void; onRemove?: () => void;
}) {
  const fresh = () => ({
    supplierId: link?.supplierId ?? "",
    // Defaults to the item's own unit: links created from purchase history
    // (0090) carry no supplier UoM, and an empty unit reads as a broken record.
    supplierUom: link?.supplierUom || item.baseUom || "",
    skuName: link?.skuName ?? "", supplierSku: link?.supplierSku ?? "", itemCodeBySupplier: link?.itemCodeBySupplier ?? "",
    innerUnitPackSize: numStr(link?.innerUnitPackSize), innerPackType: link?.innerPackType ?? "",
    unitsInOuterPack: numStr(link?.unitsInOuterPack), outerPackType: link?.outerPackType ?? "",
    conversionFactor: numStr(link?.conversionFactor), unitPrice: numStr(link?.unitPrice), currency: link?.currency ?? "",
    leadTimeDays: numStr(link?.leadTimeDays), minOrderQty: numStr(link?.minOrderQty),
  });
  const [editing, setEditing] = useState(!link);
  const [f, setF] = useState<Record<string, string>>(fresh);
  const [isPreferred, setIsPreferred] = useState<boolean>(!!link?.isPreferred);
  const [codes, setCodes] = useState<Codes>(codesFromRow(link));
  const [hasInner, setHasInner] = useState(!open && !!(link?.innerUnitPackSize || link?.innerPackType));
  const [hasOuter, setHasOuter] = useState(!open && !!(link?.unitsInOuterPack || link?.outerPackType));
  const [quick, setQuick] = useState<QuickAddKind | null>(null);
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const set = (k: string) => (v: string) => setF(p => ({ ...p, [k]: v }));
  const setCode = (l: PackLevel) => (v: string) => setCodes(c => ({ ...c, [l]: v }));

  const base = item.baseUom || "";
  const unit = open ? base : f.supplierUom;
  const crossDim = !open && !!base && !!f.supplierUom && needsConversionFactor(f.supplierUom, base);
  const per = open ? 1 : (perSupplierUnit(f.supplierUom || null, base || null, f.conversionFactor) ?? 0);
  const innerQty = hasInner ? (Number(f.innerUnitPackSize) || 0) * per : 0;
  const outerQty = hasInner && hasOuter ? (Number(f.unitsInOuterPack) || 0) * innerQty : 0;
  // Levels this link actually has — same rule as the API (linkValues).
  const levels: PackLevel[] = ["unit", ...(hasInner ? ["inner" as PackLevel] : []), ...(hasInner && hasOuter ? ["outer" as PackLevel] : [])];
  const supplierName = link?.supplierName || suppliers.find(s => s.id === f.supplierId)?.name || "";

  function cancel() {
    if (!link) { onCancel?.(); return; }
    setF(fresh()); setCodes(codesFromRow(link)); setIsPreferred(!!link.isPreferred);
    setHasInner(!open && !!(link.innerUnitPackSize || link.innerPackType)); setHasOuter(!open && !!(link.unitsInOuterPack || link.outerPackType));
    setErr(""); setEditing(false);
  }

  async function save() {
    if (!f.supplierId) { setErr("Choose a supplier."); return; }
    if (!open && !f.supplierUom) { setErr("Choose the unit this supplier sells in."); return; }
    if (crossDim && !f.conversionFactor) { setErr(`${f.supplierUom} and ${base} are different measures — enter how many ${base} are in one ${f.supplierUom}.`); return; }
    if (hasInner && (!f.innerPackType || !(Number(f.innerUnitPackSize) > 0))) { setErr("Row 2: choose the pack type and how many it contains — or remove the row."); return; }
    if (hasInner && hasOuter && (!f.outerPackType || !(Number(f.unitsInOuterPack) > 0))) { setErr("Row 3: choose the pack type and how many it contains — or remove the row."); return; }
    const bad = firstInvalid(codes, levels);
    if (bad) { setErr(`${levelLabel(bad.l)} barcode: ${(bad.c as any).error}`); return; }
    setSaving(true); setErr("");
    // An "any supplier" item is bought in its own base unit: no packaging
    // (the server refuses it) — only its unit barcode and commercial terms.
    const pack = open
      ? { supplierUom: base, innerUnitPackSize: "", innerPackType: "", unitsInOuterPack: "", outerPackType: "", conversionFactor: "" }
      : { conversionFactor: crossDim ? f.conversionFactor : "" };
    const r = await fetch(link ? `/api/inventory/supplier-skus?id=${link.id}` : `/api/inventory/supplier-skus`, {
      method: link ? "PATCH" : "POST", headers: jsonHeaders,
      body: JSON.stringify({ itemId: item.id, ...f, ...pack, isPreferred, identifiers: codesPayload(codes, levels) }),
    });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save."); return; }
    setEditing(false); onDone();
  }

  const rows: GridRow[] = [
    {
      key: "unit",
      level: editing && !open ? <UomCell value={f.supplierUom} onChange={set("supplierUom")} /> : <>{unit || "—"} <span className="text-[11px] text-stone-500">unit</span></>,
      contains: crossDim
        ? (editing
            ? <div className="flex items-center gap-1.5 text-[12px] text-stone-400"><span className="whitespace-nowrap">1 {f.supplierUom} =</span><div className="w-20 shrink-0"><input type="number" step="any" className={`${cell} text-right`} value={f.conversionFactor} onChange={e => set("conversionFactor")(e.target.value)} placeholder="0.4536" aria-label="Conversion factor" /></div>{base}</div>
            : `1 ${f.supplierUom} = ${f.conversionFactor || "?"} ${base}`)
        : "—",
      base: qtyLabel(per, base),
      gtin: <GtinCell value={codes.unit ?? ""} onChange={setCode("unit")} editing={editing} />,
    },
    ...(hasInner ? [{
      key: "inner",
      level: editing ? <PackTypeCell value={f.innerPackType} onChange={set("innerPackType")} /> : <>{f.innerPackType} <span className="text-[11px] text-stone-500">inner pack</span></>,
      contains: editing ? <ContainsCell value={f.innerUnitPackSize} onChange={set("innerUnitPackSize")} unit={unit || "units"} /> : `${f.innerUnitPackSize} ${unit}`,
      base: qtyLabel(innerQty, base),
      gtin: <GtinCell value={codes.inner ?? ""} onChange={setCode("inner")} editing={editing} />,
      // Levels nest, so only the top one can go: removing the inner pack
      // would leave an outer pack defined in terms of nothing.
      onRemove: hasOuter ? undefined : () => { setHasInner(false); setF(p => ({ ...p, innerUnitPackSize: "", innerPackType: "" })); setCodes(c => ({ ...c, inner: "" })); },
    }] : []),
    ...(hasInner && hasOuter ? [{
      key: "outer",
      level: editing ? <PackTypeCell value={f.outerPackType} onChange={set("outerPackType")} /> : <>{f.outerPackType} <span className="text-[11px] text-stone-500">outer pack</span></>,
      contains: editing ? <ContainsCell value={f.unitsInOuterPack} onChange={set("unitsInOuterPack")} unit={f.innerPackType || "inner packs"} /> : `${f.unitsInOuterPack} ${f.innerPackType}`,
      base: qtyLabel(outerQty, base),
      gtin: <GtinCell value={codes.outer ?? ""} onChange={setCode("outer")} editing={editing} />,
      onRemove: () => { setHasOuter(false); setF(p => ({ ...p, unitsInOuterPack: "", outerPackType: "" })); setCodes(c => ({ ...c, outer: "" })); },
    }] : []),
  ];

  const price = Number(f.unitPrice);
  const termCls = "text-[12px] text-stone-400 whitespace-nowrap";

  return (
    <div className={`rounded-lg border overflow-hidden ${editing ? "border-emerald-800/60" : "border-stone-800"}`}>
      {/* Header: who, and on what terms. */}
      {editing ? (
        <div className="px-3 py-2.5 bg-stone-900/60 border-b border-stone-800 space-y-2">
          <div className="grid grid-cols-[1.4fr_1.6fr_1fr_1fr] gap-2">
            {link ? (
              <div className="flex items-center px-2 text-[13px] font-medium text-stone-100 truncate" title="A link's supplier can't change — link the item to the other supplier instead.">{supplierName || "Supplier"}</div>
            ) : (
              <CellSelect value={f.supplierId} onChange={e => { if (e.target.value === "__add__") { setQuick("supplier"); return; } set("supplierId")(e.target.value); }} aria-label="Supplier" autoFocus>
                <option value="">Supplier…</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                <option value="__add__">+ Add new supplier…</option>
              </CellSelect>
            )}
            <input className={cell} value={f.skuName} onChange={e => set("skuName")(e.target.value)} placeholder="Their product name" aria-label="Their product name" />
            <input className={`${cell} font-mono`} value={f.supplierSku} onChange={e => set("supplierSku")(e.target.value)} placeholder="Their SKU" aria-label="Their SKU" />
            <input className={`${cell} font-mono`} value={f.itemCodeBySupplier} onChange={e => set("itemCodeBySupplier")(e.target.value)} placeholder="Their item code" aria-label="Their item code" />
          </div>
          {/* Price is quoted per the SUPPLIER's unit, as on their price list;
              every pack level's rate is derived from it. */}
          <div className="flex items-center gap-x-5 gap-y-2 flex-wrap text-[12px] text-stone-400">
            <label className="flex items-center gap-1.5 whitespace-nowrap">Price
              <div className="w-24"><input type="number" step="any" className={`${cell} text-right tabular-nums`} value={f.unitPrice} onChange={e => set("unitPrice")(e.target.value)} placeholder="0.00" aria-label="Price" /></div>
              <span>/ {unit || "unit"}</span>
            </label>
            <div className="w-36"><CellSelect value={f.currency} onChange={e => set("currency")(e.target.value)} aria-label="Currency">
              <option value="">Home currency</option>
              {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
            </CellSelect></div>
            <label className="flex items-center gap-1.5 whitespace-nowrap">Lead time
              <div className="w-16"><input type="number" className={`${cell} text-right tabular-nums`} value={f.leadTimeDays} onChange={e => set("leadTimeDays")(e.target.value)} placeholder="0" aria-label="Lead time in days" /></div> days
            </label>
            <label className="flex items-center gap-1.5 whitespace-nowrap">Min. order
              <div className="w-20"><input type="number" step="any" className={`${cell} text-right tabular-nums`} value={f.minOrderQty} onChange={e => set("minOrderQty")(e.target.value)} placeholder="0" aria-label="Minimum order" /></div> {unit || "unit"}
            </label>
            <label className="flex items-center gap-1.5 whitespace-nowrap text-stone-300 cursor-pointer" title="The default for this item, and the price a purchase line starts from. The first supplier linked becomes preferred automatically.">
              <input type="checkbox" checked={isPreferred} onChange={e => setIsPreferred(e.target.checked)} className="accent-emerald-600" /> Preferred supplier
            </label>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4 px-3 py-2 bg-stone-900/60 border-b border-stone-800">
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <span className="text-[13px] font-medium text-stone-100 truncate">{supplierName || "—"}</span>
            {link?.isPreferred && <span title="Preferred source for this item" className="text-[10px] font-medium uppercase tracking-wide text-emerald-400 border border-emerald-800/60 rounded-full px-1.5 py-px">Preferred</span>}
            {(link?.supplierSku || link?.skuName) && <span className="text-[11px] text-stone-500 truncate">{[link.skuName, link.supplierSku].filter(Boolean).join(" · ")}</span>}
          </span>
          <div className="flex-1" />
          <span className={termCls}>{price > 0 ? <><span className="text-stone-200 tabular-nums">{fmt.num2(price)}</span> / {unit || "unit"}{f.currency ? ` ${f.currency}` : ""}</> : "No price"}</span>
          <span className={termCls}>{f.leadTimeDays ? `${f.leadTimeDays}d lead` : "—"}</span>
          {f.minOrderQty && <span className={termCls}>MOQ {fmt.qty(Number(f.minOrderQty))} {unit}</span>}
          <button onClick={() => setEditing(true)} className={iconBtn} title="Edit supplier link"><Pencil size={13} /></button>
          {onRemove && <button onClick={onRemove} className={`${iconBtn} hover:text-rose-400`} title="Remove supplier link"><Trash2 size={13} /></button>}
        </div>
      )}
      <PackagingTable rows={rows} editing={editing}
        add={!open && !(hasInner && hasOuter)
          ? <AddLevel label={hasInner ? "Add outer pack" : "Add inner pack"} onClick={() => (hasInner ? setHasOuter(true) : setHasInner(true))} />
          : undefined} />
      {editing && <BlockActions saving={saving} err={err} onCancel={cancel} onSave={save} saveLabel={link ? "Save" : "Link supplier"} />}
      {editing && link && !open && <p className="px-3 pb-2 text-[11px] text-stone-500">Once a purchase order uses this link its unit and packs are fixed — names, codes, barcodes and terms can still change.</p>}
      {quick && <QuickAdd kind={quick} onClose={() => setQuick(null)} onCreated={(row) => { setSuppliers(p => [...p, row]); set("supplierId")(row.id); setQuick(null); }} />}
    </div>
  );
}

/* ----------------------------- Sourcing policy ----------------------------- */

// "Who may supply this?" is a property of the ITEM (CLAUDE.md, supplier
// sourcing), so it is set with the item's other properties in its drawer.
// The Suppliers panel only reports which rule applies.
function SourcingToggle({ policy, onChange, baseUom }: { policy: string; onChange: (p: string) => void; baseUom?: string | null }) {
  const open = !allowsPackConfiguration(policy);
  return (
    <Section title="Purchasing" className="pt-2 border-t border-stone-800">
      <label className="flex items-start gap-2.5 rounded-lg border border-stone-700 px-3 py-2.5 cursor-pointer">
        <input type="checkbox" checked={open} onChange={e => onChange(e.target.checked ? "open" : "restricted")} className="mt-0.5 accent-emerald-600" />
        <div>
          <div className="text-[12.5px] font-medium text-stone-200">Buy from any supplier</div>
          <p className="text-[11px] text-stone-400 leading-relaxed">
            {open
              ? <>Anyone may supply it, in {baseUom || "its base unit"}, with no pack configuration. Linking a supplier is optional and only records their price and lead time.</>
              : <>Off: it can only be bought from suppliers linked on its Suppliers panel, in their units and packs. A purchase from anyone else is refused.</>}
          </p>
        </div>
      </label>
    </Section>
  );
}

/* ----------------------------- New item drawer ----------------------------- */

function NewItemDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [taxes, setTaxes] = useState<any[]>([]);
  const [quick, setQuick] = useState<QuickAddKind | null>(null);
  const [f, setF] = useState<Record<string, string>>({ name: "", productType: "FinishedProduct", baseUom: "", category: "", code: "", minOhQty: "0", unitPrice: "", unitCost: "", incomeAccountId: "", expenseAccountId: "", assetAccountId: "", cogsAccountId: "", taxRateId: "" });
  const [lotTracked, setLotTracked] = useState(true);
  const [sourcingPolicy, setSourcingPolicy] = useState<string>(defaultSourcingPolicy("FinishedProduct"));
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  useEffect(() => {
    fetch(`/api/accounting/accounts`).then(x => x.json()).then(r => setAccounts(Array.isArray(r) ? r : [])).catch(() => {});
    fetch(`/api/accounting/tax-rates`).then(x => x.json()).then(r => setTaxes(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);

  const meta = kindOf(f.productType);
  // Sync the lot-tracked default when the kind changes.
  useEffect(() => { setLotTracked(meta.lotTrackedDefault); setSourcingPolicy(defaultSourcingPolicy(f.productType)); }, [f.productType]);

  const incomeAccts  = accounts.filter(a => ["Income", "Other Income"].includes(a.type));
  const expenseAccts = accounts.filter(a => ["Expense", "Cost of Goods Sold", "Other Expense"].includes(a.type));
  const cogsAccts    = accounts.filter(a => ["Cost of Goods Sold", "Expense", "Other Expense"].includes(a.type));
  const assetAccts   = accounts.filter(a => ["Other Current Asset", "Fixed Asset", "Other Asset", "Bank"].includes(a.type));

  async function save() {
    if (!f.name.trim()) { setErr("Item name is required."); return; }
    if (meta.tracked && !f.baseUom) { setErr("A base UoM is required for inventory-tracked items."); return; }
    setSaving(true); setErr("");
    const r = await fetch(`/api/inventory/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, lotTracked, ...(meta.buyable ? { sourcingPolicy } : {}) }) });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save."); return; }
    onCreated();
  }

  const KIND_ICON: Record<string, any> = { FinishedProduct: Layers, StockItem: Boxes, RawMaterial: Package, WorkInProgress: Layers, NonInventory: Package, Service: Layers };

  return (
    <Drawer title="New item" onClose={onClose} wide>
      <div className="space-y-6">
        <Section title="Item type">
          <div className="grid grid-cols-2 gap-2">
            {ITEM_KIND_LIST.map(m => {
              const Icon = KIND_ICON[m.kind] || Package;
              const active = f.productType === m.kind;
              return (
                <button key={m.kind} type="button" onClick={() => set("productType", m.kind)}
                  className={`rounded-lg border p-2.5 text-left ${active ? "border-emerald-600 bg-emerald-500/8" : "border-stone-700 hover:border-stone-600"}`}>
                  <div className="flex items-center gap-2 text-[12.5px] font-semibold text-stone-100"><Icon size={14} className="text-emerald-400" /> {m.label} <span className="text-[10px] text-stone-500 font-mono">{m.code}</span></div>
                  <p className="text-[11px] text-stone-400 mt-0.5 leading-snug">{m.blurb}</p>
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="Identity">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Field label="Item name" required className="col-span-2"><input className={controlInset} value={f.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Olive Oil" /></Field>
            <Field label="Base UoM" required={meta.tracked}><UomSelect value={f.baseUom} onChange={v => set("baseUom", v)} /></Field>
            <Field label="Category"><input className={controlInset} value={f.category} onChange={e => set("category", e.target.value)} placeholder="e.g. Oils" /></Field>
            <Field label="Item code"><input className={controlInset} value={f.code} onChange={e => set("code", e.target.value)} /></Field>
            <Field label="Min required on-hand qty"><input type="number" className={controlInset} value={f.minOhQty} onChange={e => set("minOhQty", e.target.value)} /></Field>
          </div>
        </Section>

        {meta.tracked && (
          <label className="flex items-center gap-2.5 rounded-lg border border-stone-700 px-3 py-2.5 cursor-pointer">
            <input type="checkbox" checked={lotTracked} onChange={e => setLotTracked(e.target.checked)} className="accent-emerald-600" />
            <div>
              <div className="text-[12.5px] font-medium text-stone-200">Track by lot / batch number</div>
              <p className="text-[11px] text-stone-400">Each receipt creates a dated FIFO cost lot. Production can pick exact lots for precise cost & traceability.</p>
            </div>
          </label>
        )}

        {meta.buyable && <SourcingToggle policy={sourcingPolicy} onChange={setSourcingPolicy} baseUom={f.baseUom} />}

        <Section title="Accounting" className="pt-2 border-t border-stone-800">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            {meta.sellable && <Field label="Sales price"><input type="number" className={controlInset} value={f.unitPrice} onChange={e => set("unitPrice", e.target.value)} /></Field>}
            {meta.buyable && <Field label="Purchase cost"><input type="number" className={controlInset} value={f.unitCost} onChange={e => set("unitCost", e.target.value)} /></Field>}
            {meta.sellable && (
              <Field label="Income account">
                <SelectField inset value={f.incomeAccountId} onChange={e => { if (e.target.value === "__add__") { setQuick("account-income"); return; } set("incomeAccountId", e.target.value); }}>
                  <option value="">Select…</option>
                  {incomeAccts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  <option value="__add__">+ Add new income account…</option>
                </SelectField>
              </Field>
            )}
            {meta.tracked ? (
              <>
                <Field label="Inventory asset account">
                  <SelectField inset value={f.assetAccountId} onChange={e => set("assetAccountId", e.target.value)}>
                    <option value="">Inventory Asset (system default)</option>
                    {assetAccts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </SelectField>
                </Field>
                <Field label="COGS account">
                  <SelectField inset value={f.cogsAccountId} onChange={e => set("cogsAccountId", e.target.value)}>
                    <option value="">Cost of Goods Sold (system default)</option>
                    {cogsAccts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </SelectField>
                </Field>
              </>
            ) : (
              meta.buyable && (
                <Field label="Expense account">
                  <SelectField inset value={f.expenseAccountId} onChange={e => { if (e.target.value === "__add__") { setQuick("account-expense"); return; } set("expenseAccountId", e.target.value); }}>
                    <option value="">Select…</option>
                    {expenseAccts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    <option value="__add__">+ Add new expense account…</option>
                  </SelectField>
                </Field>
              )
            )}
            <Field label="Tax rate">
              <SelectField inset value={f.taxRateId} onChange={e => { if (e.target.value === "__add__") { setQuick("tax"); return; } set("taxRateId", e.target.value); }}>
                <option value="">Select…</option>
                {taxes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                <option value="__add__">+ Add new tax rate…</option>
              </SelectField>
            </Field>
          </div>
          {meta.tracked && <p className="text-[11px] text-stone-500">Purchases capitalise to the inventory asset; sales & production relieve it to COGS at exact FIFO lot cost. Leave blank to use the org's system Inventory Asset / COGS accounts.</p>}
        </Section>
        {err && <p className="text-[12px] text-rose-400">{err}</p>}
      </div>
      <DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel="Create item" />
      {quick && <QuickAdd kind={quick} accounts={accounts} taxes={taxes}
        onClose={() => setQuick(null)}
        onCreated={(row) => {
          if (quick === "account-income") { setAccounts(p => [...p, row]); set("incomeAccountId", row.id); }
          else if (quick === "account-expense") { setAccounts(p => [...p, row]); set("expenseAccountId", row.id); }
          else if (quick === "tax") { setTaxes(p => [...p, row]); set("taxRateId", row.id); }
          setQuick(null);
        }} />}
    </Drawer>
  );
}

/* ----------------------------- Edit item drawer ----------------------------- */

function EditItemDrawer({ item, onClose, onSaved }: { item: any; onClose: () => void; onSaved: () => void }) {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [taxes, setTaxes] = useState<any[]>([]);
  const meta = kindOf(item.productType);
  const [f, setF] = useState<Record<string, string>>({
    name: item.name ?? "", category: item.category ?? "", code: item.code ?? "", status: item.status ?? "Active",
    minOhQty: String(item.minOhQty ?? "0"), unitPrice: item.unitPrice != null ? String(item.unitPrice) : "", unitCost: item.unitCost != null ? String(item.unitCost) : "",
    incomeAccountId: item.incomeAccountId ?? "", expenseAccountId: item.expenseAccountId ?? "", assetAccountId: item.assetAccountId ?? "", cogsAccountId: item.cogsAccountId ?? "", taxRateId: item.taxRateId ?? "",
  });
  const originalPolicy = item.sourcingPolicy ?? "restricted";
  const [sourcingPolicy, setSourcingPolicy] = useState<string>(originalPolicy);
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));
  useEffect(() => {
    fetch(`/api/accounting/accounts`).then(x => x.json()).then(r => setAccounts(Array.isArray(r) ? r : [])).catch(() => {});
    fetch(`/api/accounting/tax-rates`).then(x => x.json()).then(r => setTaxes(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);
  const incomeAccts = accounts.filter(a => ["Income", "Other Income"].includes(a.type));
  const expenseAccts = accounts.filter(a => ["Expense", "Cost of Goods Sold", "Other Expense"].includes(a.type));
  const cogsAccts = accounts.filter(a => ["Cost of Goods Sold", "Expense", "Other Expense"].includes(a.type));
  const assetAccts = accounts.filter(a => ["Other Current Asset", "Fixed Asset", "Other Asset", "Bank"].includes(a.type));

  async function save() {
    if (!f.name.trim()) { setErr("Item name is required."); return; }
    setSaving(true); setErr("");
    // The policy is sent only when it changed: the server refuses a switch to
    // "any supplier" while pack configurations exist, and an unrelated rename
    // must never trip over that check.
    const body = sourcingPolicy !== originalPolicy ? { ...f, sourcingPolicy } : f;
    const r = await fetch(`/api/inventory/items/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save."); return; }
    onSaved();
  }

  return (
    <Drawer title={`Edit ${item.name}`} onClose={onClose} wide>
      <div className="space-y-6">
        <div className="flex items-center gap-2"><TypeBadge t={item.productType} /><span className="text-[11px] text-stone-500">Base UoM {item.baseUom || "—"} · type &amp; base UoM lock once the item has stock</span></div>
        <Section title="Identity">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Field label="Item name" required><input className={controlInset} value={f.name} onChange={e => set("name", e.target.value)} /></Field>
            <Field label="Category"><input className={controlInset} value={f.category} onChange={e => set("category", e.target.value)} /></Field>
            <Field label="Item code"><input className={controlInset} value={f.code} onChange={e => set("code", e.target.value)} /></Field>
            <Field label="Min on-hand"><input type="number" className={controlInset} value={f.minOhQty} onChange={e => set("minOhQty", e.target.value)} /></Field>
            <Field label="Status" className="col-span-2"><SelectField inset value={f.status} onChange={e => set("status", e.target.value)}><option>Active</option><option>Inactive</option></SelectField></Field>
          </div>
        </Section>
        {meta.buyable && <SourcingToggle policy={sourcingPolicy} onChange={setSourcingPolicy} baseUom={item.baseUom} />}
        <Section title="Accounting" className="pt-2 border-t border-stone-800">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            {meta.sellable && <Field label="Sales price"><input type="number" className={controlInset} value={f.unitPrice} onChange={e => set("unitPrice", e.target.value)} /></Field>}
            {meta.buyable && <Field label="Purchase cost"><input type="number" className={controlInset} value={f.unitCost} onChange={e => set("unitCost", e.target.value)} /></Field>}
            {meta.sellable && <Field label="Income account"><SelectField inset value={f.incomeAccountId} onChange={e => set("incomeAccountId", e.target.value)}><option value="">Select…</option>{incomeAccts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</SelectField></Field>}
            {meta.tracked ? (<>
              <Field label="Inventory asset account"><SelectField inset value={f.assetAccountId} onChange={e => set("assetAccountId", e.target.value)}><option value="">Inventory Asset (system default)</option>{assetAccts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</SelectField></Field>
              <Field label="COGS account"><SelectField inset value={f.cogsAccountId} onChange={e => set("cogsAccountId", e.target.value)}><option value="">Cost of Goods Sold (system default)</option>{cogsAccts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</SelectField></Field>
            </>) : (meta.buyable && <Field label="Expense account"><SelectField inset value={f.expenseAccountId} onChange={e => set("expenseAccountId", e.target.value)}><option value="">Select…</option>{expenseAccts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</SelectField></Field>)}
            <Field label="Tax rate"><SelectField inset value={f.taxRateId} onChange={e => set("taxRateId", e.target.value)}><option value="">Select…</option>{taxes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</SelectField></Field>
          </div>
        </Section>
        {err && <p className="text-[12px] text-rose-400">{err}</p>}
      </div>
      <DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel="Save changes" />
    </Drawer>
  );
}

/* ----------------------------- Drawer shell ----------------------------- */

function Drawer({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", on); return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className={`relative bg-stone-900 border-l border-stone-800 h-full overflow-y-auto shadow-2xl ${wide ? "w-full max-w-lg" : "w-full max-w-md"}`} onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800 sticky top-0 bg-stone-900 z-10">
          <h2 className="text-[15px] font-semibold text-stone-100">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-stone-800 text-stone-500"><X size={17} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function DrawerFooter({ saving, onClose, onSave, saveLabel = "Save" }: { saving: boolean; onClose: () => void; onSave: () => void; saveLabel?: string }) {
  return (
    <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-stone-800">
      <button onClick={onClose} className="text-[13px] font-medium text-stone-300 px-3.5 py-2 rounded-lg hover:bg-stone-800">Cancel</button>
      <button onClick={onSave} disabled={saving} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">
        {saving ? <Loader size={14} className="animate-spin" /> : <Check size={14} />} {saveLabel}
      </button>
    </div>
  );
}
