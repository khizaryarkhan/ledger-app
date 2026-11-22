"use client";

/**
 * Outputs: the packaged SKUs this recipe can make, as a grid. No quantity here: the batch size is the
 * potential output, and how it splits between SKUs is decided on each manufacturing order. A SKU is
 * picked by typing; once one is chosen only SKUs of that same product are offered. Each SKU once.
 */

import { Plus, X } from "lucide-react";
import { fmt } from "@/lib/format";
import { ItemTypeahead } from "./item-typeahead";
import { blankOutput, isBlankOutput, type Draft, type ItemLite, type SkuInfo } from "./draft";

export function OutputSection({ draft, skus, itemId, byId, batchBase, baseUom, onChange }: {
  draft: Draft;
  skus: SkuInfo[];
  /** The product once an output SKU is chosen; blank = every producible SKU is offered. */
  itemId: string;
  byId: Map<string, ItemLite>;
  batchBase: number;
  baseUom: string | null;
  onChange: (outputs: Draft["outputs"]) => void;
}) {
  const used = new Set(draft.outputs.filter(o => !isBlankOutput(o)).map(o => o.skuId));
  const skuById = new Map(skus.map(s => [s.id, s]));
  const pickable: ItemLite[] = skus.filter(s => !itemId || s.itemId === itemId).map(s => ({ id: s.id, name: s.name, code: s.code, productType: byId.get(s.itemId)?.productType, baseUom: byId.get(s.itemId)?.baseUom }));
  const rm = (key: string) => { const next = draft.outputs.filter(o => o.key !== key); onChange(next.length ? next : [blankOutput()]); };
  const pick = (key: string, id: string) => {
    const next = draft.outputs.map(o => (o.key === key ? { ...o, skuId: id } : o));
    onChange(next.some(isBlankOutput) ? next : [...next, blankOutput()]);
  };
  const cols = "grid grid-cols-[28px_minmax(0,1fr)_auto_28px] items-center gap-x-3";

  return (
    <section className="px-5 py-5 border-b border-stone-800 space-y-3">
      <div>
        <h3 className="text-[15px] font-semibold text-stone-100">Output</h3>
        <p className="text-[12px] text-stone-400 mt-0.5">The batch size above is the potential output. How it splits between these SKUs is decided on each manufacturing order.</p>
      </div>
      {pickable.length === 0 && (
        <p className="text-[12px] text-amber-300 rounded-lg border border-amber-800/40 bg-amber-500/5 px-3 py-2">No output SKUs exist yet. Open the finished product in Products & Services, add a packaged SKU (for example a box of 12), then come back to pick it here.</p>
      )}
      <div className="rounded-lg border border-stone-800 bg-stone-950/40">
        <div className={`${cols} px-3 py-1.5 border-b border-stone-800 text-[11px] font-semibold uppercase tracking-wide text-stone-500`}>
          <span>#</span><span>Output SKU</span><span className="text-right">Per unit · batch could make</span><span />
        </div>
        {draft.outputs.map((o, ix) => {
          const s = skuById.get(o.skuId);
          const upTo = s && s.content > 0 && batchBase > 0 ? Math.floor(batchBase / s.content) : null;
          return (
            <div key={o.key} className={`${cols} px-3 py-2 border-b border-stone-800/60 last:border-b-0`}>
              <span className="text-[12px] text-stone-500 tabular-nums">{ix + 1}</span>
              {s ? (
                <div className="min-w-0"><span className="text-[13px] text-stone-100 font-medium">{s.name}</span> <span className="text-[11px] text-stone-500 font-mono">{s.code}</span>
                  <div className="text-[11px] text-stone-500 truncate">{byId.get(s.itemId)?.name}</div></div>
              ) : (
                <ItemTypeahead items={pickable} mode="search" placeholder="Type a SKU name or code" exclude={i => used.has(i.id)} onPick={i => pick(o.key, i.id)} />
              )}
              <div className="text-right text-[12px] text-stone-400 tabular-nums">
                {s ? (s.content > 0 ? <>{fmt.qty(s.content)} {baseUom}{upTo != null ? <> · up to {fmt.qty(upTo)}</> : null}</> : "No content set") : ""}
              </div>
              <button type="button" aria-label="Remove line" onClick={() => rm(o.key)} className="p-1 text-stone-500 hover:text-rose-400"><X size={15} /></button>
            </div>
          );
        })}
      </div>
      <button type="button" onClick={() => onChange([...draft.outputs, blankOutput()])} className="flex items-center gap-1 text-[13px] font-semibold text-sky-400 hover:underline"><Plus size={13} /> Add line</button>
    </section>
  );
}
