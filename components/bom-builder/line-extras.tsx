"use client";

/**
 * What hangs off one ingredient: ordered substitutes, a supplier-SKU limit, and the
 * item facts they lean on (weight per unit, allergens). Everything here is SAVED with
 * the recipe, and manufacturing orders planned afterwards follow them (an order keeps
 * the copy it was planned with, so a later edit never re-plans it).
 */

import { useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { kindOf } from "@/lib/inventory/item-kinds";
import { ALLERGENS, allergenAdds, followQty } from "@/lib/inventory/bom-rules";
import { fmt } from "@/lib/format";
import { CalcInput, controlInset } from "@/components/form-kit";
import { ItemTypeahead } from "./item-typeahead";
import { kgPerUnit, newKey, parseNum, type DraftLine, type ItemLite } from "./draft";
import { uom as uomOf } from "@/lib/inventory/uom";

export interface SupplierSkuLite { id: string; label: string; supplier: string | null; code: string | null }

const NOT_YET = "Manufacturing orders planned from now on follow this; orders already planned keep their old plan.";
const chip = "text-[12px] font-semibold rounded-lg border px-2.5 py-1";

/** Weight per unit and allergens for one item. Saved straight to the item, so every recipe sees it. */
function ItemAttributesPanel({ item, onSaved, onClose }: { item: ItemLite; onSaved: (patch: Partial<ItemLite>) => void; onClose: () => void }) {
  const massUnit = uomOf(item.baseUom)?.dimension === "mass";
  const [w, setW] = useState(item.weightPerUnitKg ? String(item.weightPerUnitKg) : "");
  const [al, setAl] = useState<string[]>(item.allergens ?? []);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setSaving(true); setErr(null);
    const body: Record<string, unknown> = { allergens: al };
    if (!massUnit) body.weightPerUnitKg = w.trim() === "" ? null : parseNum(w);
    const r = await fetch(`/api/inventory/items/${item.id}/attributes`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) { setErr(d?.error || "Could not save."); return; }
    onSaved({ weightPerUnitKg: d.weightPerUnitKg, allergens: d.allergens }); onClose();
  }
  return (
    <div className="rounded-lg border border-stone-800 bg-stone-950/60 p-3 space-y-3">
      <div className="text-[12px] text-stone-400">Facts about <b className="text-stone-200">{item.name}</b>, kept on the item so every recipe uses them.</div>
      {!massUnit && (
        <div className="flex items-center gap-2 text-[12px] text-stone-300">
          <span>1 {item.baseUom || "unit"} weighs</span>
          <CalcInput className={`${controlInset} !w-24 text-right tabular-nums`} value={w} onChange={setW} aria-label={`Kilograms in one ${item.baseUom}`} />
          <span>kg</span>
          <span className="text-stone-500">Lets the weight check count it.</span>
        </div>
      )}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-500 mb-1.5">Allergens</div>
        <div className="flex flex-wrap gap-1.5">
          {ALLERGENS.map(a => {
            const on = al.includes(a);
            return <button key={a} type="button" aria-pressed={on} onClick={() => setAl(on ? al.filter(x => x !== a) : [...al, a])}
              className={`${chip} ${on ? "bg-sky-500/20 text-sky-200 border-sky-700" : "text-stone-300 border-stone-700 hover:border-stone-500"}`}>{a}</button>;
          })}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving} className="text-[13px] font-semibold bg-primary text-white rounded-lg px-3 py-1.5 disabled:opacity-50">Save to item</button>
        <button type="button" onClick={onClose} className="text-[13px] font-semibold text-sky-400 hover:underline">Cancel</button>
        {err && <span className="text-[12px] text-rose-400">{err}</span>}
      </div>
    </div>
  );
}

/** Pick which supplier SKUs may be used. Nothing ticked = any. */
function SkuPanel({ item, skus, selected, onChange, onClose }: { item: ItemLite; skus: SupplierSkuLite[]; selected: string[]; onChange: (ids: string[]) => void; onClose: () => void }) {
  const groups = new Map<string, SupplierSkuLite[]>();
  for (const s of skus) { const g = s.supplier || "Supplier not set"; (groups.get(g) ?? groups.set(g, []).get(g)!).push(s); }
  return (
    <div className="rounded-lg border border-stone-800 bg-stone-950/60 p-3 space-y-2">
      <div><b className="text-[13px] text-stone-100">Which {item.name} SKUs may production use?</b><div className="text-[12px] text-stone-400">Optional. Leave on “any” if all are fine. A lot with no supplier SKU on record is refused under a limit. {NOT_YET}</div></div>
      {[...groups.entries()].map(([g, list]) => (
        <div key={g}>
          <div className="text-[11px] text-stone-500 mt-1">{g}</div>
          {list.map(s => (
            <label key={s.id} className="flex items-center gap-2 px-1.5 py-1 rounded-lg cursor-pointer hover:bg-stone-900">
              <input type="checkbox" className="accent-blue-600" checked={selected.includes(s.id)} onChange={() => onChange(selected.includes(s.id) ? selected.filter(x => x !== s.id) : [...selected, s.id])} />
              <span className="text-[13px] text-stone-200 flex-1">{s.label}</span><span className="text-[11px] text-stone-500 font-mono">{s.code}</span>
            </label>
          ))}
        </div>
      ))}
      <div className="flex gap-2"><button type="button" onClick={() => onChange([])} className={`${chip} text-stone-300 border-stone-700 hover:border-stone-500`}>Allow any SKU</button><button type="button" onClick={onClose} className={`${chip} bg-primary text-white border-transparent`}>Done</button></div>
    </div>
  );
}

export function LineExtras({ line, item, items, byId, primaries, skusByItem, ensureSkus, onChange, onItemPatched }: {
  line: DraftLine;
  item: ItemLite;
  items: ItemLite[];
  byId: Map<string, ItemLite>;
  /** Items that are ingredients of this recipe — they cannot also be substitutes. */
  primaries: Set<string>;
  skusByItem: Record<string, SupplierSkuLite[] | undefined>;
  ensureSkus: (itemId: string) => void;
  onChange: (patch: Partial<DraftLine>) => void;
  onItemPatched: (itemId: string, patch: Partial<ItemLite>) => void;
}) {
  const [panel, setPanel] = useState<null | "attrs" | "subs" | "sku" | { sub: string }>(null);
  const [attrsFor, setAttrsFor] = useState<string>(item.id);
  const kg = kgPerUnit(item), q = parseNum(line.qty);
  const skuLabel = (it: ItemLite, ids: string[]) => {
    if (it.sourcingPolicy === "open") return null;
    const list = skusByItem[it.id];
    if (list && list.length < 2) return null;
    return <button type="button" onMouseEnter={() => ensureSkus(it.id)} onClick={() => { ensureSkus(it.id); setPanel(it.id === item.id ? "sku" : { sub: it.id }); }}
      className={`${chip} ${ids.length ? "border-sky-700 text-sky-300 bg-sky-500/10" : "border-stone-700 text-stone-400 hover:border-stone-500"}`}>SKUs: {ids.length ? `only ${ids.length}` : "any"} ▾</button>;
  };

  const move = (ix: number, d: -1 | 1) => { const j = ix + d; if (j < 0 || j >= line.subs.length) return; const s = [...line.subs]; [s[ix], s[j]] = [s[j], s[ix]]; onChange({ subs: s }); };
  const setSub = (key: string, patch: Partial<DraftLine["subs"][number]>) => onChange({ subs: line.subs.map(s => s.key === key ? { ...s, ...patch } : s) });
  const subOpen = panel === "subs" || line.subs.length > 0;

  return (
    <div className="col-span-full space-y-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {skuLabel(item, line.allowedSkuIds)}
        {kg == null && <button type="button" onClick={() => { setAttrsFor(item.id); setPanel("attrs"); }} className="text-[12px] text-amber-400 hover:underline">Set weight per {item.baseUom}</button>}
        <button type="button" onClick={() => { setAttrsFor(item.id); setPanel(panel === "attrs" ? null : "attrs"); }} className="text-[12px] text-stone-400 hover:text-stone-200">{item.allergens?.length ? `Allergens: ${item.allergens.join(", ")}` : "Allergens"}</button>
        <button type="button" onClick={() => setPanel(panel === "subs" ? null : "subs")} className="text-[12px] font-semibold text-sky-400 hover:underline">{line.subs.length ? `${line.subs.length} substitute${line.subs.length === 1 ? "" : "s"}` : "+ Substitute"}</button>
      </div>

      {panel === "attrs" && byId.get(attrsFor) && <ItemAttributesPanel item={byId.get(attrsFor)!} onSaved={p => onItemPatched(attrsFor, p)} onClose={() => setPanel(null)} />}
      {panel === "sku" && <SkuPanel item={item} skus={skusByItem[item.id] ?? []} selected={line.allowedSkuIds} onChange={ids => onChange({ allowedSkuIds: ids })} onClose={() => setPanel(null)} />}
      {typeof panel === "object" && panel && byId.get(panel.sub) && (
        <SkuPanel item={byId.get(panel.sub)!} skus={skusByItem[panel.sub] ?? []} selected={line.subs.find(s => s.itemId === panel.sub)?.allowedSkuIds ?? []}
          onChange={ids => setSub(line.subs.find(s => s.itemId === panel.sub)!.key, { allowedSkuIds: ids })} onClose={() => setPanel(null)} />
      )}

      {subOpen && (
        <div className="rounded-lg border-l-[3px] border-sky-800 bg-stone-950/60 px-3 py-2.5 space-y-2">
          <div><b className="text-[13px] text-stone-100">If {item.name} is not available</b><div className="text-[12px] text-stone-400">Offered, in this order, when the main item cannot cover an order; a planner confirms before it is used. {NOT_YET}</div></div>
          <div className="flex items-center gap-2 text-[12px]"><span className="w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-400 grid place-items-center text-[11px] font-semibold">1</span><span className="text-stone-300"><b>{item.name}</b> is used whenever stock covers the order</span></div>
          {line.subs.map((s, ix) => {
            const si = byId.get(s.itemId), adds = allergenAdds(item.allergens, si?.allergens), same = followQty({ primaryQty: q, primaryKgPerUnit: kg, subKgPerUnit: kgPerUnit(si) });
            return (
              <div key={s.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="w-5 h-5 rounded-full bg-sky-500/15 text-sky-300 grid place-items-center text-[11px] font-semibold">{ix + 2}</span>
                <div className="min-w-0 flex-1"><span className="text-[13px] text-stone-100 font-medium">{si?.name}</span> <span className="text-[11px] text-stone-500 font-mono">{si?.code}</span>
                  <div className="flex flex-wrap items-center gap-2 mt-0.5">{si && skuLabel(si, s.allowedSkuIds)}{adds.length > 0 && <span className="text-[11px] font-semibold text-amber-300 bg-amber-500/10 rounded-lg px-1.5">Adds {adds.join(", ")}</span>}
                    {same != null && fmt.qty(same) !== fmt.qty(parseNum(s.qty)) && <button type="button" onClick={() => setSub(s.key, { qty: String(same) })} className="text-[12px] text-sky-400 hover:underline">Same weight: {fmt.qty(same)}</button>}</div></div>
                <div className="flex items-center gap-1.5"><CalcInput className={`${controlInset} !w-24 text-right tabular-nums`} value={s.qty} onChange={v => setSub(s.key, { qty: v })} aria-label={`Amount of ${si?.name} as substitute`} /><span className="text-[12px] text-stone-500 w-8">{si?.baseUom}</span></div>
                <div className="flex"><button type="button" aria-label="Move up" disabled={ix === 0} onClick={() => move(ix, -1)} className="p-1 text-stone-500 hover:text-stone-200 disabled:opacity-30"><ArrowUp size={14} /></button>
                  <button type="button" aria-label="Move down" disabled={ix === line.subs.length - 1} onClick={() => move(ix, 1)} className="p-1 text-stone-500 hover:text-stone-200 disabled:opacity-30"><ArrowDown size={14} /></button>
                  <button type="button" aria-label={`Remove ${si?.name}`} onClick={() => onChange({ subs: line.subs.filter(x => x.key !== s.key) })} className="p-1 text-stone-500 hover:text-rose-400"><X size={14} /></button></div>
              </div>
            );
          })}
          <ItemTypeahead items={items} mode="search" placeholder={`Add a ${line.subs.length + 2}${line.subs.length === 0 ? "nd" : line.subs.length === 1 ? "rd" : "th"} choice for ${item.name}`}
            exclude={i => !(kindOf(i.productType).consumable && kindOf(i.productType).tracked) || i.id === item.id || primaries.has(i.id) || line.subs.some(s => s.itemId === i.id)}
            onPick={i => { const f = followQty({ primaryQty: q, primaryKgPerUnit: kg, subKgPerUnit: kgPerUnit(i) }); onChange({ subs: [...line.subs, { key: newKey(), itemId: i.id, qty: f != null ? String(f) : "", allowedSkuIds: [] }] }); }} />
        </div>
      )}
    </div>
  );
}
