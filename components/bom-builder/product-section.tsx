"use client";

/**
 * Product + batch + output packs. The product is picked once; the batch is
 * counted in that item's BASE unit. Output packs are the packaged SKUs of the
 * SAME item the recipe can make (content per pack in base units) — each SKU can
 * appear once, so a used SKU stops being offered.
 */

import { Plus, X } from "lucide-react";
import { kindOf } from "@/lib/inventory/item-kinds";
import { fmt } from "@/lib/format";
import { CalcInput, Field, SelectField, controlInset } from "@/components/form-kit";
import { ItemTypeahead } from "./item-typeahead";
import { newKey, type Draft, type ItemLite } from "./draft";

export interface SkuLite { id: string; skuName?: string | null; skuCode?: string | null; innerUnitPackSize?: number | string | null }
const skuLabel = (s: SkuLite) => s.skuName || s.skuCode || s.id.slice(0, 8);

export function ProductSection({ draft, set, items, item, skus, onPickProduct, onCreateItem, locked }: {
  draft: Draft;
  set: (patch: Partial<Draft>) => void;
  items: ItemLite[];
  item: ItemLite | undefined;
  skus: SkuLite[];
  onPickProduct: (i: ItemLite) => void;
  onCreateItem: (name: string) => void;
  locked: boolean;
}) {
  if (!item) {
    return (
      <section className="px-5 py-5 border-b border-stone-800 space-y-3">
        <div>
          <h3 className="text-[15px] font-semibold text-stone-100">What are you making?</h3>
          <p className="text-[12px] text-stone-400 mt-0.5">Pick a product. If it already has a recipe, its lines, packaging and operations are copied for you.</p>
        </div>
        <ItemTypeahead items={items} mode="search" placeholder="Type a product name or code" exclude={i => !kindOf(i.productType).producible} onPick={onPickProduct} onCreate={onCreateItem} inputId="bom-product" />
        {items.filter(i => kindOf(i.productType).producible).length === 0 && <p className="text-[12px] text-amber-400">No producible items yet. Create a Finished Product or Work-in-Progress item first.</p>}
      </section>
    );
  }

  const used = new Set(draft.outputs.map(o => o.skuId));
  const free = skus.filter(s => !used.has(s.id));
  const skuById = new Map(skus.map(s => [s.id, s]));
  const addSku = (s: SkuLite) => set({ outputs: [...draft.outputs, { key: newKey(), skuId: s.id, qty: s.innerUnitPackSize ? String(Number(s.innerUnitPackSize)) : "" }] });

  return (
    <section className="px-5 py-5 border-b border-stone-800 space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-semibold text-stone-300 border border-stone-700 rounded-lg px-1.5">{kindOf(item.productType).code}</span>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-stone-100 truncate">{item.name}</div>
          <div className="text-[11px] text-stone-500 font-mono">{item.code}</div>
        </div>
        <span className="flex-1" />
        {!locked && <button type="button" onClick={() => set({ outputItemId: "" })} className="text-[13px] font-semibold text-sky-400 hover:underline">Change product</button>}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
        <Field label="BOM ID" hint="Unique in your company. Copies suggest a -V2 style ID.">
          <input className={controlInset} value={draft.code} onChange={e => set({ code: e.target.value })} placeholder="e.g. BOM_HOB-40" />
        </Field>
        <Field label="Status">
          <SelectField inset value={draft.status} onChange={e => set({ status: e.target.value })}><option>Active</option><option>Draft</option><option>Archived</option></SelectField>
        </Field>
        <Field label="BOM name" required className="col-span-2">
          <input className={controlInset} value={draft.name} onChange={e => set({ name: e.target.value })} />
        </Field>
        <Field label={`One batch makes (${item.baseUom || "base unit"})`} required>
          <CalcInput className={`${controlInset} text-right tabular-nums`} value={draft.batchSize} onChange={v => set({ batchSize: v })} placeholder="e.g. 1000" aria-label="Batch size" />
        </Field>
        <Field label="Expected yield %" hint="Loss within it stays in the product's cost; loss beyond it goes to Scrap & yield loss. Blank = 100%.">
          <CalcInput className={`${controlInset} text-right tabular-nums`} value={draft.expYield} onChange={v => set({ expYield: v })} placeholder="e.g. 98" aria-label="Expected yield" />
        </Field>
      </div>

      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-500 mb-1.5">Output packs <span className="normal-case font-normal text-stone-500">· packaged SKUs of this product the recipe makes. Each SKU once.</span></div>
        {draft.outputs.length === 0 && <div className="rounded-lg border border-dashed border-stone-700 px-3 py-3 text-[12px] text-stone-400">None. The recipe makes the base unit ({item.baseUom || "unit"}). Add a pack below if it is also made as a packaged SKU.</div>}
        <div className="space-y-2">
          {draft.outputs.map(o => (
            <div key={o.key} className="flex items-center gap-2 rounded-lg border border-stone-800 bg-stone-950/40 px-3 py-2">
              <span className="text-[13px] text-stone-100 font-medium flex-1 truncate">{skuById.get(o.skuId) ? skuLabel(skuById.get(o.skuId)!) : "SKU"}</span>
              <span className="text-[12px] text-stone-400">content per pack</span>
              <CalcInput className={`${controlInset} !w-24 text-right tabular-nums`} value={o.qty} onChange={v => set({ outputs: draft.outputs.map(x => x.key === o.key ? { ...x, qty: v } : x) })} aria-label="Content per pack" />
              <span className="text-[12px] text-stone-500 w-10">{item.baseUom}</span>
              <button type="button" aria-label="Remove pack" onClick={() => set({ outputs: draft.outputs.filter(x => x.key !== o.key), packs: draft.packs.map(p => p.forSkuId === o.skuId ? { ...p, forSkuId: null } : p) })} className="p-1 text-stone-500 hover:text-rose-400"><X size={15} /></button>
            </div>
          ))}
        </div>
        {free.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className="text-[12px] text-stone-500">Add:</span>
            {free.map(s => <button key={s.id} type="button" onClick={() => addSku(s)} className="flex items-center gap-1 text-[12px] font-semibold text-stone-300 border border-stone-700 rounded-lg px-2.5 py-1 hover:border-stone-500"><Plus size={12} /> {skuLabel(s)}{s.innerUnitPackSize ? ` · ${fmt.qty(Number(s.innerUnitPackSize))}` : ""}</button>)}
          </div>
        )}
        {skus.length === 0 && <p className="text-[12px] text-stone-500 mt-2">This item has no packaging SKUs. Add them under Products &amp; Services if it is sold in packs.</p>}
      </div>
    </section>
  );
}
