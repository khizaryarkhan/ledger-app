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

import { ItemAccountingSection } from "@/components/item-accounting";
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
import { Field, Section, SelectField, QtyUnitField, controlInset, th, Drawer, DrawerFooter } from "@/components/form-kit";

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

/* ----------------------------- Packaging: list + drawer ----------------------------- */

// The list shows each supplier link / SKU on ONE line, with its packaging
// read back in words and its barcodes counted; the row opens a side drawer.
// The drawer follows the product owner's layout: foldable sections for
// Packaging (unit | inner pack | outer pack side by side, read back as a
// configuration line), Barcodes (one GTIN per level) and Commercial terms
// (a price quoted AT a level, in the supplier's currency).

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

/** One-line packaging read-back for the list: "Bag = 25 kg · Carton = 12 Bag". */
function packLine(levels: { type?: string | null; n?: any; of: string }[]): string {
  return levels.filter(l => l.type && Number(l.n) > 0).map(l => `${l.type} = ${fmt.qty(Number(l.n))} ${l.of}`).join(" · ");
}

/** Barcode count for the list, every code on hover. */
function BarcodeSummary({ row }: { row: any }) {
  const list = Object.entries(row?.identifiers ?? {}) as [string, any][];
  if (!list.length) return <span className="text-stone-600">—</span>;
  const title = list.map(([lvl, b]) => `${lvl}: ${showBarcode(b)}${b.scheme === "OTHER" ? " (internal)" : ""}`).join("\n");
  return <span className="font-mono text-stone-300" title={title}>{showBarcode(list[0][1])}{list.length > 1 && <span className="text-stone-500"> +{list.length - 1}</span>}</span>;
}

/** "1 Carton = 12 Bag = 300 kg" — the ladder read back from the top. */
function ladderTotal(steps: { label: string; qty: number }[], base: string): string | undefined {
  if (!steps.length || !base) return undefined;
  const rev = [...steps].reverse();
  const top = rev[0];
  return [`1 ${top.label}`, ...rev.slice(1).map(s => `${fmt.qty(top.qty / s.qty)} ${s.label}`), `${fmt.qty(top.qty)} ${base}`].join(" = ");
}

const iconBtn = "p-1 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-800";

/* ----------------------------- Finished-product SKUs ----------------------------- */

function SkuEditor({ item, onChanged }: { item: any; onChanged: () => void }) {
  const [skus, setSkus] = useState<any[] | null>(null);
  const [onHand, setOnHand] = useState<Record<string, { packs: number | null; value: number }>>({});
  const [drawer, setDrawer] = useState<{ sku?: any } | null>(null);
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
  const base = item.baseUom || "";

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-stone-300"><Layers size={14} className="text-emerald-400" /> Packaging SKUs <span className="text-stone-500 font-normal">· base UoM {base || "—"}</span></div>
        <button onClick={() => setDrawer({})} className="flex items-center gap-1 text-[12px] font-medium text-emerald-400 hover:text-emerald-300"><Plus size={13} /> Add SKU</button>
      </div>
      {!item.baseUom && <p className="text-[12px] text-amber-400 mb-2">Set a base UoM on this item first so packaging can be expressed in it.</p>}
      {err && <p className="text-[12px] text-rose-400 mb-2">{err}</p>}
      <div className="rounded-lg border border-stone-800 overflow-hidden">
        <table className="w-full text-[12px]">
          <thead><tr className="border-b border-stone-800">
            <th className={th}>SKU</th><th className={th}>Packaging</th>
            <th className={`${th} text-right`}>On hand</th><th className={th}>Barcodes</th><th className="w-14" />
          </tr></thead>
          <tbody>
            {skus === null && <tr><td colSpan={5} className="px-3 py-4 text-center text-stone-500">Loading…</td></tr>}
            {skus !== null && skus.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-stone-500">No SKUs yet.</td></tr>}
            {(skus ?? []).map(s => {
              const oh = onHand[s.id];
              const inner = s.innerPackType || "unit";
              return (
                <tr key={s.id} className="border-b border-stone-800/50 hover:bg-stone-800/30 cursor-pointer" onClick={() => setDrawer({ sku: s })}>
                  <td className="px-3 py-2">
                    <div className="text-stone-200">{s.skuName || "—"}</div>
                    {s.skuCode && <div className="font-mono text-[11px] text-stone-500">{s.skuCode}</div>}
                  </td>
                  <td className="px-3 py-2 text-stone-300">{packLine([
                    { type: s.innerPackType, n: s.innerUnitPackSize, of: base },
                    { type: s.addlInnerPackType, n: s.unitsInAddlInnerPack, of: inner },
                    { type: s.outerPackType, n: s.unitsInOuterPack, of: s.addlInnerPackType || inner },
                  ]) || <span className="text-stone-600">—</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-stone-300">{oh && oh.packs != null ? `${fmt.qty(oh.packs)} ${s.innerPackType || "packs"}` : <span className="text-stone-600">0</span>}</td>
                  <td className="px-3 py-2"><BarcodeSummary row={s} /></td>
                  <td className="px-3 py-2 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                    <button onClick={() => setDrawer({ sku: s })} className={iconBtn} title="Edit SKU"><Pencil size={13} /></button>
                    <button onClick={() => remove(s.id)} className={`${iconBtn} hover:text-rose-400`} title="Delete SKU"><Trash2 size={13} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {drawer && <SkuDrawer item={item} sku={drawer.sku} onClose={() => setDrawer(null)} onSaved={() => { setDrawer(null); load(); onChanged(); }} />}
    </div>
  );
}

/* ----------------------------- Supplier links ----------------------------- */

function SupplierSkuEditor({ item, onChanged }: { item: any; onChanged: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [drawer, setDrawer] = useState<{ link?: any } | null>(null);
  const [err, setErr] = useState("");
  const [policy, setPolicy] = useState<string>(item.sourcingPolicy ?? "restricted");
  const open = !allowsPackConfiguration(policy);
  async function load() {
    const r = await fetch(`/api/inventory/items/${item.id}`).then(x => x.json()).catch(() => null);
    setRows(r?.supplierSkus ?? []);
    if (r?.item?.sourcingPolicy) setPolicy(r.item.sourcingPolicy);
  }
  // Re-read when the policy changes from the Edit drawer, so the list never
  // shows the old packaging for the new rule.
  useEffect(() => { load(); }, [item.id, item.sourcingPolicy]);
  async function remove(id: string) {
    setErr("");
    const r = await fetch(`/api/inventory/supplier-skus?id=${id}`, { method: "DELETE" });
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not remove."); return; }
    load(); onChanged();
  }
  const base = item.baseUom || "";

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-stone-300"><Package size={14} className="text-amber-400" /> Suppliers <span className="text-stone-500 font-normal">· item base UoM {base || "—"}</span></div>
        {/* Offered under BOTH policies. On a restricted item a link is the
            permission to buy; on an open item it is only a commercial record
            (price, lead time, preferred, barcode) — optional, never restrictive. */}
        <button onClick={() => setDrawer({})} className="flex items-center gap-1 text-[12px] font-medium text-emerald-400 hover:text-emerald-300"><Plus size={13} /> Link supplier</button>
      </div>
      {/* The policy is set in the item's Edit drawer; this line says which rule applies. */}
      <p className="mb-2 text-[11px] text-stone-500">
        {open
          ? <>Bought from <span className="text-stone-300 font-medium">any supplier</span>, in {base || "its base unit"}. Linking one is optional — it records their price, lead time, barcode and whether they are preferred.</>
          : <>Bought only from the <span className="text-stone-300 font-medium">suppliers linked below</span>, in their units and packs.</>}
      </p>
      {err && <p className="text-[12px] text-rose-400 mb-2">{err}</p>}
      <div className="rounded-lg border border-stone-800 overflow-hidden">
        <table className="w-full text-[12px]">
          <thead><tr className="border-b border-stone-800">
            <th className={th}>Supplier</th>
            {!open && <th className={th}>Unit & packaging</th>}
            <th className={`${th} text-right`}>Price</th><th className={`${th} text-right`}>Lead time</th>
            <th className={th}>Barcodes</th><th className="w-14" />
          </tr></thead>
          <tbody>
            {rows === null && <tr><td colSpan={6} className="px-3 py-4 text-center text-stone-500">Loading…</td></tr>}
            {rows !== null && rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-stone-500">
                {open ? "No suppliers recorded — none needed, anyone may supply this item." : "No suppliers linked yet — link one before raising a purchase order."}
              </td></tr>
            )}
            {(rows ?? []).map(s => {
              const unit = s.supplierUom || base;
              const cross = base && s.supplierUom && needsConversionFactor(s.supplierUom, base);
              return (
                <tr key={s.id} className="border-b border-stone-800/50 hover:bg-stone-800/30 cursor-pointer" onClick={() => setDrawer({ link: s })}>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-stone-200">{s.supplierName || "—"}</span>
                      {s.isPreferred && <span title="Preferred source for this item" className="text-[10px] font-medium uppercase tracking-wide text-emerald-400 border border-emerald-800/60 rounded-full px-1.5 py-px">Preferred</span>}
                    </span>
                    {(s.skuName || s.supplierProductName || s.supplierSku) && <div className="text-[11px] text-stone-500">{[s.skuName, s.supplierProductName, s.supplierSku].filter(Boolean).join(" · ")}</div>}
                  </td>
                  {!open && (
                    <td className="px-3 py-2 text-stone-300">
                      <span className="font-mono">{unit || "—"}</span>
                      {cross && (s.conversionFactor
                        ? <span className="text-amber-300"> (1 = {numStr(s.conversionFactor)} {base})</span>
                        : <span className="text-rose-400"> (conversion missing)</span>)}
                      {packLine([{ type: s.innerPackType, n: s.innerUnitPackSize, of: unit }, { type: s.outerPackType, n: s.unitsInOuterPack, of: s.innerPackType || "" }]) &&
                        <span className="text-stone-400"> · {packLine([{ type: s.innerPackType, n: s.innerUnitPackSize, of: unit }, { type: s.outerPackType, n: s.unitsInOuterPack, of: s.innerPackType || "" }])}</span>}
                    </td>
                  )}
                  {/* As quoted, at the level quoted — the shape of the vendor's own price list. */}
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {(s.quotedPrice ?? s.unitPrice) != null
                      ? <span className="text-stone-200">{fmt.num2(Number(s.quotedPrice ?? s.unitPrice))}<span className="text-stone-600">/{s.priceBasis === "inner" ? (s.innerPackType || "pack") : s.priceBasis === "outer" ? (s.outerPackType || "case") : (unit || "unit")}{s.currency ? ` ${s.currency}` : ""}</span></span>
                      : <span className="text-stone-600">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.leadTimeDays != null ? <span className="text-stone-300">{s.leadTimeDays}d</span> : <span className="text-stone-600">—</span>}</td>
                  <td className="px-3 py-2"><BarcodeSummary row={s} /></td>
                  <td className="px-3 py-2 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                    <button onClick={() => setDrawer({ link: s })} className={iconBtn} title="Edit supplier link"><Pencil size={13} /></button>
                    <button onClick={() => remove(s.id)} className={`${iconBtn} hover:text-rose-400`} title="Remove supplier link"><Trash2 size={13} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {drawer && <SupplierSkuDrawer item={item} open={open} link={drawer.link} onClose={() => setDrawer(null)} onSaved={() => { setDrawer(null); load(); onChanged(); }} />}
    </div>
  );
}

/* ----------------------------- Drawer building blocks ----------------------------- */

/**
 * A drawer section that folds away to a one-line summary. Everything starts
 * open; folding is for the user who has finished one part and wants the next
 * in view, and the summary means a folded section still says what it holds.
 */
function Fold({ title, summary, children, defaultOpen = true }: { title: string; summary?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-stone-800">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-stone-800/40 rounded-lg">
        <ChevronRight size={14} className={`text-stone-500 transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-300">{title}</span>
        {summary && <span className="ml-auto text-[12px] text-stone-500 truncate max-w-[60%] text-right">{summary}</span>}
      </button>
      {open && <div className="px-3 pb-3 pt-1 space-y-3">{children}</div>}
    </div>
  );
}

/**
 * A pack level as ONE full-width cell — "[ 500 | bucket ▾ ]": how many of the
 * level below it holds, and what the pack is. It was a narrow number box and
 * a narrow dropdown side by side in a third of the drawer, which cut both off.
 */
function PackField({ label, count, type, onCount, onType, of, disabled, disabledHint }: {
  label: string; count: string; type: string; onCount: (v: string) => void; onType: (v: string) => void; of: string; disabled?: boolean; disabledHint?: string;
}) {
  const hint = disabled ? disabledHint
    : type && Number(count) > 0 ? `1 ${type} holds ${fmt.qty(Number(count))} ${of}`
    : type || count ? `Enter how many ${of} one pack holds, and the pack type`
    : "Optional";
  return (
    <Field label={label} hint={hint}>
      <QtyUnitField qty={count} onQty={onCount} unit={type} onUnit={onType} options={PACK_TYPES} unitPlaceholder="Pack type…"
        disabled={disabled} qtyLabel={`${label} — how many ${of}`} unitLabel={`${label} — pack type`} />
    </Field>
  );
}

/** A GTIN field checked as you type, by the same rule the server enforces (classifyBarcode). */
function GtinField({ label, value, onChange, disabled, disabledHint }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean; disabledHint?: string }) {
  const c = classifyBarcode(value);
  const hint = disabled ? disabledHint
    : !value.trim() ? "EAN-13, UPC-A, EAN-8, ITF-14 — or any other barcode"
    : "error" in c ? <span className="text-rose-400">{c.error}</span>
    : c.barcode?.scheme === "GTIN" ? <span className="text-emerald-400">Valid GTIN</span>
    : <span className="text-amber-400">Not a GS1 GTIN — kept as an internal barcode</span>;
  return (
    <Field label={label} hint={hint}>
      <input className={`${controlInset} font-mono`} value={value} onChange={e => onChange(e.target.value)} inputMode="numeric" placeholder={disabled ? "" : "e.g. 9501101530003"} disabled={disabled} />
    </Field>
  );
}

/** "1 carton = 12 bag = 300 kg" — the configuration read back from the top level down. */
function ConfigLine({ text, empty }: { text?: string; empty: string }) {
  return (
    <div className={`rounded-md px-3 py-2 text-[12px] ${text ? "bg-emerald-500/8 border border-emerald-800/40 text-emerald-300" : "border border-dashed border-stone-700 text-stone-500"}`}>
      <span className="text-[11px] uppercase tracking-wider text-stone-500 mr-2">Packaging configuration</span>{text || empty}
    </div>
  );
}

const codesSet = (codes: Codes, levels: PackLevel[]) => levels.filter(l => (codes[l] ?? "").trim()).length;

/* ----------------------------- SKU drawer ----------------------------- */

function SkuDrawer({ item, sku, onClose, onSaved }: { item: any; sku?: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Record<string, string>>({
    skuName: sku?.skuName ?? "", skuCode: sku?.skuCode ?? "",
    innerUnitPackSize: numStr(sku?.innerUnitPackSize), innerPackType: sku?.innerPackType ?? "",
    unitsInAddlInnerPack: numStr(sku?.unitsInAddlInnerPack), addlInnerPackType: sku?.addlInnerPackType ?? "",
    unitsInOuterPack: numStr(sku?.unitsInOuterPack), outerPackType: sku?.outerPackType ?? "",
  });
  const [codes, setCodes] = useState<Codes>(codesFromRow(sku));
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const set = (k: string) => (v: string) => setF(p => ({ ...p, [k]: v }));
  const setCode = (l: PackLevel) => (v: string) => setCodes(c => ({ ...c, [l]: v }));
  const base = item.baseUom || "unit";

  // A level exists once either half of it is filled; the save check asks for both.
  const hasAddl = !!(f.unitsInAddlInnerPack || f.addlInnerPackType);
  const hasOuter = !!(f.unitsInOuterPack || f.outerPackType);
  const levels: PackLevel[] = ["inner", ...(hasAddl ? ["addl_inner" as PackLevel] : []), ...(hasOuter ? ["outer" as PackLevel] : [])];
  const innerQty = Number(f.innerUnitPackSize) || 0;
  const addlQty = hasAddl ? (Number(f.unitsInAddlInnerPack) || 0) * innerQty : 0;
  const outerParent = hasAddl ? { qty: addlQty, label: f.addlInnerPackType || "multipack" } : { qty: innerQty, label: f.innerPackType || "unit" };
  const outerQty = hasOuter ? (Number(f.unitsInOuterPack) || 0) * outerParent.qty : 0;
  const config = ladderTotal([
    ...(f.innerPackType && innerQty > 0 ? [{ label: f.innerPackType, qty: innerQty }] : []),
    ...(hasAddl && f.addlInnerPackType && addlQty > 0 ? [{ label: f.addlInnerPackType, qty: addlQty }] : []),
    ...(hasOuter && f.outerPackType && outerQty > 0 ? [{ label: f.outerPackType, qty: outerQty }] : []),
  ], base);

  async function save() {
    if (!f.skuName.trim()) { setErr("SKU name is required."); return; }
    if (hasAddl && (!f.addlInnerPackType || !(Number(f.unitsInAddlInnerPack) > 0))) { setErr("Multipack: enter how many it holds and choose its pack type — or clear both."); return; }
    if (hasOuter && (!f.outerPackType || !(Number(f.unitsInOuterPack) > 0))) { setErr("Outer pack: enter how many it holds and choose its pack type — or clear both."); return; }
    const bad = firstInvalid(codes, levels);
    if (bad) { setErr(`${levelLabel(bad.l)} barcode: ${(bad.c as any).error}`); return; }
    setSaving(true); setErr("");
    const body = JSON.stringify({ itemId: item.id, ...f, identifiers: codesPayload(codes, levels) });
    const r = sku
      ? await fetch(`/api/inventory/skus?id=${sku.id}`, { method: "PATCH", headers: jsonHeaders, body })
      : await fetch(`/api/inventory/skus`, { method: "POST", headers: jsonHeaders, body });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save."); return; }
    onSaved();
  }

  return (
    <Drawer title={sku ? `Edit ${sku.skuName || "SKU"}` : "New packaging SKU"} subtitle={`${item.name} · stocked in ${item.baseUom || "no base UoM"}`} onClose={onClose} wide
      footer={<DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel={sku ? "Save changes" : "Create SKU"} err={err} />}>
      <div className="space-y-3">
        <Fold title="SKU" summary={[f.skuName, f.skuCode].filter(Boolean).join(" · ")}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="SKU name" required><input className={controlInset} value={f.skuName} onChange={e => set("skuName")(e.target.value)} placeholder="e.g. 750ml bottle" autoFocus={!sku} /></Field>
            <Field label="SKU code"><input className={`${controlInset} font-mono`} value={f.skuCode} onChange={e => set("skuCode")(e.target.value)} /></Field>
          </div>
        </Fold>

        {/* The consumer unit is the SKU itself; the multipack and outer pack
            are optional levels above it, each a separate GS1 trade item. */}
        <Fold title="Packaging" summary={config}>
          <PackField label="Consumer unit" count={f.innerUnitPackSize} type={f.innerPackType} onCount={set("innerUnitPackSize")} onType={set("innerPackType")} of={base} />
          <PackField label="Multipack" count={f.unitsInAddlInnerPack} type={f.addlInnerPackType} onCount={set("unitsInAddlInnerPack")} onType={set("addlInnerPackType")} of={f.innerPackType || "consumer units"} />
          <PackField label="Outer pack" count={f.unitsInOuterPack} type={f.outerPackType} onCount={set("unitsInOuterPack")} onType={set("outerPackType")} of={outerParent.label} />
          <ConfigLine text={config} empty="Enter the consumer unit to describe the packaging." />
          {sku && <p className="text-[11px] text-stone-500">Once stock or documents use this SKU its pack sizes are fixed — the name, code, pack types and barcodes can still change.</p>}
        </Fold>

        <Fold title="Barcodes" summary={`${codesSet(codes, levels)} of ${levels.length} set`}>
          <GtinField label={`Consumer unit GTIN${f.innerPackType ? ` — ${f.innerPackType}` : ""}`} value={codes.inner ?? ""} onChange={setCode("inner")} />
          <GtinField label={`Multipack GTIN${f.addlInnerPackType ? ` — ${f.addlInnerPackType}` : ""}`} value={codes.addl_inner ?? ""} onChange={setCode("addl_inner")} disabled={!hasAddl} disabledHint="Define a multipack under Packaging first." />
          <GtinField label={`Outer pack GTIN${f.outerPackType ? ` — ${f.outerPackType}` : ""}`} value={codes.outer ?? ""} onChange={setCode("outer")} disabled={!hasOuter} disabledHint="Define an outer pack under Packaging first." />
        </Fold>
      </div>
    </Drawer>
  );
}

/* ----------------------------- Supplier-link drawer ----------------------------- */

function SupplierSkuDrawer({ item, open, link, onClose, onSaved }: { item: any; open: boolean; link?: any; onClose: () => void; onSaved: () => void }) {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [quick, setQuick] = useState<QuickAddKind | null>(null);
  const [f, setF] = useState<Record<string, string>>({
    supplierId: link?.supplierId ?? "",
    // Defaults to the item's own unit: links created from purchase history
    // (0090) carry no supplier UoM, and an empty unit reads as a broken record.
    supplierUom: link?.supplierUom || item.baseUom || "",
    skuName: link?.skuName ?? "", supplierProductName: link?.supplierProductName ?? "",
    supplierSku: link?.supplierSku ?? "", itemCodeBySupplier: link?.itemCodeBySupplier ?? "",
    innerUnitPackSize: numStr(link?.innerUnitPackSize), innerPackType: link?.innerPackType ?? "",
    unitsInOuterPack: numStr(link?.unitsInOuterPack), outerPackType: link?.outerPackType ?? "",
    conversionFactor: numStr(link?.conversionFactor),
    quotedPrice: numStr(link?.quotedPrice ?? link?.unitPrice), priceBasis: link?.priceBasis || "unit",
    leadTimeDays: numStr(link?.leadTimeDays), minOrderQty: numStr(link?.minOrderQty),
  });
  const [isPreferred, setIsPreferred] = useState<boolean>(!!link?.isPreferred);
  const [codes, setCodes] = useState<Codes>(codesFromRow(link));
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  const set = (k: string) => (v: string) => setF(p => ({ ...p, [k]: v }));
  const setCode = (l: PackLevel) => (v: string) => setCodes(c => ({ ...c, [l]: v }));

  useEffect(() => { fetch(`/api/parties/suppliers?native=1`).then(x => x.json()).then(r => setSuppliers(Array.isArray(r) ? r : [])).catch(() => {}); }, []);

  const base = item.baseUom || "";
  const unit = open ? base : f.supplierUom;
  // A level exists once either half of it is filled; the save check asks for both.
  const hasInner = !open && !!(f.innerUnitPackSize || f.innerPackType);
  const hasOuter = hasInner && !!(f.unitsInOuterPack || f.outerPackType);
  const crossDim = !open && !!base && !!f.supplierUom && needsConversionFactor(f.supplierUom, base);
  const per = open ? 1 : (perSupplierUnit(f.supplierUom || null, base || null, f.conversionFactor) ?? 0);
  const innerN = Number(f.innerUnitPackSize) || 0, outerN = Number(f.unitsInOuterPack) || 0;
  const levels: PackLevel[] = ["unit", ...(hasInner ? ["inner" as PackLevel] : []), ...(hasOuter ? ["outer" as PackLevel] : [])];
  // Counted in SUPPLIER units, then converted to the base unit when that is
  // known. Without the conversion it still reads "1 bucket = 500 cup" — it
  // used to go blank and say "add an inner pack" while one was right there.
  const supplierSteps = [
    ...(hasInner && f.innerPackType && innerN > 0 ? [{ label: f.innerPackType, qty: innerN }] : []),
    ...(hasOuter && f.outerPackType && outerN > 0 && innerN > 0 ? [{ label: f.outerPackType, qty: outerN * innerN }] : []),
  ];
  const config = !supplierSteps.length ? undefined
    : per > 0 ? ladderTotal(supplierSteps.map(x => ({ ...x, qty: x.qty * per })), base)
    : `${ladderTotal(supplierSteps, unit || "unit")}${crossDim ? ` — enter what 1 ${f.supplierUom} is in ${base} to convert` : ""}`;

  // Currency is the SUPPLIER's, set on the supplier and fixed there.
  const supplier = suppliers.find(s => s.id === f.supplierId);
  const currency = (supplier?.currency || link?.currency || "").trim();

  // Price levels on offer: the ones this link actually has.
  const basisOpts: { v: string; label: string; units: number }[] = [
    { v: "unit", label: unit || "unit", units: 1 },
    ...(hasInner && innerN > 0 ? [{ v: "inner", label: f.innerPackType || "inner pack", units: innerN }] : []),
    ...(hasOuter && innerN > 0 && outerN > 0 ? [{ v: "outer", label: f.outerPackType || "outer pack", units: innerN * outerN }] : []),
  ];
  const basis = basisOpts.find(o => o.v === f.priceBasis) ?? basisOpts[0];
  const quoted = Number(f.quotedPrice);
  // The same arithmetic a PO line uses (unitPriceFromQuote / basePriceOf):
  // every level priced from the one figure the supplier quoted.
  const perSupplierUnitPrice = quoted > 0 ? quoted / basis.units : 0;
  const derived = perSupplierUnitPrice > 0 ? [
    ...basisOpts.filter(o => o.v !== basis.v).map(o => `${fmt.num2(perSupplierUnitPrice * o.units)} / ${o.label}`),
    ...(base && unit !== base && per > 0 ? [`${fmt.num2(perSupplierUnitPrice / per)} / ${base}`] : []),
  ] : [];

  async function save() {
    if (!f.supplierId) { setErr("Choose a supplier."); return; }
    if (!open && !f.supplierUom) { setErr("Packaging: choose the unit this supplier sells in."); return; }
    if (crossDim && !f.conversionFactor) { setErr(`Packaging: ${f.supplierUom} and ${base} are different measures — enter how many ${base} are in one ${f.supplierUom}.`); return; }
    if (hasInner && (!f.innerPackType || !(innerN > 0))) { setErr("Inner pack: enter how many it holds and choose its pack type — or clear both."); return; }
    if (hasOuter && (!f.outerPackType || !(outerN > 0))) { setErr("Outer pack: enter how many inner packs it holds and choose its pack type — or clear both."); return; }
    // The price was quoted per a level that is no longer defined: sending it
    // as-is would silently re-read "300 per bottle" as "300 per litre".
    if (quoted > 0 && !basisOpts.some(o => o.v === f.priceBasis)) { setErr("Commercial terms: the price was per a pack level that no longer exists — choose what it is per."); return; }
    const bad = firstInvalid(codes, levels);
    if (bad) { setErr(`${levelLabel(bad.l)} barcode: ${(bad.c as any).error}`); return; }
    setSaving(true); setErr("");
    // An "any supplier" item is bought in its own base unit: no packaging (the
    // server refuses it) — only its barcode and terms. An outer pack is only
    // meaningful on top of an inner one, so it is not sent without one.
    const pack = open
      ? { supplierUom: base, innerUnitPackSize: "", innerPackType: "", unitsInOuterPack: "", outerPackType: "", conversionFactor: "" }
      : { conversionFactor: crossDim ? f.conversionFactor : "", ...(hasOuter ? {} : { unitsInOuterPack: "", outerPackType: "" }) };
    const r = await fetch(link ? `/api/inventory/supplier-skus?id=${link.id}` : `/api/inventory/supplier-skus`, {
      method: link ? "PATCH" : "POST", headers: jsonHeaders,
      body: JSON.stringify({ itemId: item.id, ...f, ...pack, priceBasis: basis.v, isPreferred, identifiers: codesPayload(codes, levels) }),
    });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save."); return; }
    onSaved();
  }

  return (
    <Drawer title={link ? `Edit ${link.supplierName || "supplier link"}` : "Link supplier"}
      subtitle={`${item.name} · stocked in ${base || "no base UoM"}${open ? " · any supplier may supply it" : ""}`}
      onClose={onClose} wide
      footer={<DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel={link ? "Save changes" : "Link supplier"} err={err} />}>
      <div className="space-y-3">
        <Fold title="Supplier" summary={link?.supplierName || supplier?.name}>
          <Field label="Supplier" required>
            <SelectField inset value={f.supplierId} disabled={!!link} title={link ? "A link's supplier can't change — link the item to the other supplier instead." : undefined}
              onChange={e => { if (e.target.value === "__add__") { setQuick("supplier"); return; } set("supplierId")(e.target.value); }}>
              <option value="">Select supplier…</option>
              {link && !suppliers.some(s => s.id === link.supplierId) && <option value={link.supplierId}>{link.supplierName || "Current supplier"}</option>}
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              <option value="__add__">+ Add new supplier…</option>
            </SelectField>
          </Field>
          {/* Two names, two readers: ours is what buyers search and pick; the
              supplier's is what appears on their invoice, so a bill line can
              be matched back to this link. */}
          <Field label="SKU name (internal)" hint="What your team calls it — shown in pickers and on POs">
            <input className={controlInset} value={f.skuName} onChange={e => set("skuName")(e.target.value)} placeholder="e.g. Cotton yarn 24s — 25 kg bag" />
          </Field>
          <Field label="Supplier's product name" hint="As it appears on their invoice and price list">
            <input className={controlInset} value={f.supplierProductName} onChange={e => set("supplierProductName")(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Supplier's SKU"><input className={`${controlInset} font-mono`} value={f.supplierSku} onChange={e => set("supplierSku")(e.target.value)} /></Field>
            <Field label="Supplier's item code"><input className={`${controlInset} font-mono`} value={f.itemCodeBySupplier} onChange={e => set("itemCodeBySupplier")(e.target.value)} /></Field>
          </div>
        </Fold>

        <Fold title="Packaging" summary={open ? `Bought in ${base || "its base unit"}` : (config || unit)}>
          {open ? (
            <p className="text-[12px] text-stone-400">Any supplier may supply this item, so it is bought in its own unit, <span className="font-mono text-stone-200">{base || "—"}</span>, with no pack configuration.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Supplier UoM" required hint="What they count and price in"><UomSelect value={f.supplierUom} onChange={set("supplierUom")} placeholder="Select…" /></Field>
                {/* Only when the two units are different MEASURES (cup vs each,
                    lb vs kg) — then no ratio can be known without being told. */}
                {crossDim && (
                  <Field label={`1 ${f.supplierUom} equals`} required hint={`How many ${base} are in one ${f.supplierUom}`}>
                    <div className="flex items-center gap-2">
                      <input type="number" step="any" className={`${controlInset} tabular-nums`} value={f.conversionFactor} onChange={e => set("conversionFactor")(e.target.value)} placeholder="0" aria-label="Conversion factor" />
                      <span className="text-[12px] text-stone-400 font-mono shrink-0">{base}</span>
                    </div>
                  </Field>
                )}
              </div>
              <PackField label="Inner pack" count={f.innerUnitPackSize} type={f.innerPackType} onCount={set("innerUnitPackSize")} onType={set("innerPackType")} of={unit || "units"} />
              <PackField label="Outer pack" count={f.unitsInOuterPack} type={f.outerPackType} onCount={set("unitsInOuterPack")} onType={set("outerPackType")}
                of={f.innerPackType || "inner packs"} disabled={!hasInner} disabledHint="Define the inner pack first" />
              <ConfigLine text={config} empty={`Bought in ${unit || "units"} — add an inner pack if they sell it packed.`} />
              {link && <p className="text-[11px] text-stone-500">Once a purchase order uses this link its unit and packs are fixed — names, codes, barcodes and terms can still change.</p>}
            </>
          )}
        </Fold>

        <Fold title="Barcodes" summary={`${codesSet(codes, levels)} of ${levels.length} set`}>
          <GtinField label={`Product level GTIN${unit ? ` — per ${unit}` : ""}`} value={codes.unit ?? ""} onChange={setCode("unit")} />
          {!open && <>
            <GtinField label={`Inner pack GTIN${f.innerPackType ? ` — ${f.innerPackType}` : ""}`} value={codes.inner ?? ""} onChange={setCode("inner")} disabled={!hasInner} disabledHint="Define an inner pack under Packaging first." />
            <GtinField label={`Outer pack GTIN${f.outerPackType ? ` — ${f.outerPackType}` : ""}`} value={codes.outer ?? ""} onChange={setCode("outer")} disabled={!hasOuter} disabledHint="Define an outer pack under Packaging first." />
          </>}
        </Fold>

        {/* Priced AT A LEVEL, exactly as the supplier quotes it (a 30-litre
            bottle at 300), in the supplier's own currency. Every other level —
            and ordering by the litre on a PO — is worked out from that one
            figure (lib/inventory/order-options.ts). */}
        <Fold title="Commercial terms" summary={quoted > 0 ? `${fmt.num2(quoted)} / ${basis.label}${currency ? ` ${currency}` : ""}${f.leadTimeDays ? ` · ${f.leadTimeDays}d lead` : ""}` : "No price"}>
          <div className="grid grid-cols-[1fr_1fr_auto] gap-3 items-start">
            <Field label="Price"><input type="number" step="any" className={`${controlInset} tabular-nums`} value={f.quotedPrice} onChange={e => set("quotedPrice")(e.target.value)} placeholder="0.00" /></Field>
            <Field label="Per">
              <SelectField inset value={basis.v} onChange={e => set("priceBasis")(e.target.value)} aria-label="Price is per">
                {basisOpts.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
              </SelectField>
            </Field>
            <Field label="Currency" hint="From the supplier">
              <div className={`${controlInset} flex items-center text-stone-300 font-mono`}>{currency || "Home"}</div>
            </Field>
          </div>
          {derived.length > 0 && <p className="text-[12px] text-stone-400">= {derived.join(" · ")}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lead time (days)"><input type="number" className={`${controlInset} tabular-nums`} value={f.leadTimeDays} onChange={e => set("leadTimeDays")(e.target.value)} placeholder="0" /></Field>
            <Field label={`Minimum order (${unit || "unit"})`}><input type="number" step="any" className={`${controlInset} tabular-nums`} value={f.minOrderQty} onChange={e => set("minOrderQty")(e.target.value)} placeholder="0" /></Field>
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={isPreferred} onChange={e => setIsPreferred(e.target.checked)} className="accent-emerald-600" />
            <span className="text-[12.5px] text-stone-200">Preferred supplier</span>
            <span className="text-[11px] text-stone-500">— the default for this item, and the price a purchase line starts from</span>
          </label>
        </Fold>
      </div>
      {quick && <QuickAdd kind={quick} onClose={() => setQuick(null)} onCreated={(row) => { setSuppliers(p => [...p, row]); set("supplierId")(row.id); setQuick(null); }} />}
    </Drawer>
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
  const [f, setF] = useState<Record<string, string>>({ name: "", productType: "FinishedProduct", baseUom: "", category: "", code: "", minOhQty: "0", unitPrice: "", unitCost: "", incomeAccountId: "", expenseAccountId: "", assetAccountId: "", cogsAccountId: "", taxRateId: "", postingGroupId: "" });
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
    <Drawer title="New item" onClose={onClose} wide footer={<DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel="Create item" err={err} />}>
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

        <Section title={meta.tracked ? "Pricing & tax" : "Accounting"} className="pt-2 border-t border-stone-800">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            {meta.sellable && <Field label="Default sales price"><input type="number" className={controlInset} value={f.unitPrice} onChange={e => set("unitPrice", e.target.value)} /></Field>}
            {meta.buyable && <Field label="Default purchase price" hint="Pre-fills purchase orders. Stock is valued at what was actually paid."><input type="number" className={controlInset} value={f.unitCost} onChange={e => set("unitCost", e.target.value)} /></Field>}
            {meta.sellable && !meta.tracked && (
              <Field label="Income account">
                <SelectField inset value={f.incomeAccountId} onChange={e => { if (e.target.value === "__add__") { setQuick("account-income"); return; } set("incomeAccountId", e.target.value); }}>
                  <option value="">Select…</option>
                  {incomeAccts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  <option value="__add__">+ Add new income account…</option>
                </SelectField>
              </Field>
            )}
            {!meta.tracked && (
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
        </Section>
        {meta.tracked && (
          <ItemAccountingSection productType={f.productType}
            value={{ postingGroupId: f.postingGroupId, assetAccountId: f.assetAccountId, cogsAccountId: f.cogsAccountId, incomeAccountId: f.incomeAccountId }}
            onChange={p => setF(prev => ({ ...prev, ...p }))} />
        )}
      </div>
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
    postingGroupId: item.postingGroupId ?? "",
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
    <Drawer title={`Edit ${item.name}`} onClose={onClose} wide footer={<DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel="Save changes" err={err} />}>
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
        <Section title={meta.tracked ? "Pricing & tax" : "Accounting"} className="pt-2 border-t border-stone-800">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            {meta.sellable && <Field label="Default sales price"><input type="number" className={controlInset} value={f.unitPrice} onChange={e => set("unitPrice", e.target.value)} /></Field>}
            {meta.buyable && <Field label="Default purchase price" hint="Pre-fills purchase orders. Stock is valued at what was actually paid."><input type="number" className={controlInset} value={f.unitCost} onChange={e => set("unitCost", e.target.value)} /></Field>}
            {meta.sellable && !meta.tracked && <Field label="Income account"><SelectField inset value={f.incomeAccountId} onChange={e => set("incomeAccountId", e.target.value)}><option value="">Select…</option>{incomeAccts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</SelectField></Field>}
            {!meta.tracked && (meta.buyable && <Field label="Expense account"><SelectField inset value={f.expenseAccountId} onChange={e => set("expenseAccountId", e.target.value)}><option value="">Select…</option>{expenseAccts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</SelectField></Field>)}
            <Field label="Tax rate"><SelectField inset value={f.taxRateId} onChange={e => set("taxRateId", e.target.value)}><option value="">Select…</option>{taxes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</SelectField></Field>
          </div>
        </Section>
        {meta.tracked && (
          <ItemAccountingSection productType={item.productType}
            value={{ postingGroupId: f.postingGroupId, assetAccountId: f.assetAccountId, cogsAccountId: f.cogsAccountId, incomeAccountId: f.incomeAccountId }}
            onChange={p => setF(prev => ({ ...prev, ...p }))} />
        )}
      </div>
    </Drawer>
  );
}

/* ----------------------------- Drawer shell ----------------------------- */


