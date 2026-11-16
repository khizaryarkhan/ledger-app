"use client";

/**
 * Packaging, as a grid. Each line says which output SKU it packs and how much goes on ONE sold unit of
 * it. A line can carry ordered substitutes: their quantity is a ratio per ONE unit of the main
 * packaging item (1 = one-for-one), and because one packaging item can serve several SKUs, its
 * substitutes are edited in one place and copied onto every line that uses the item.
 */

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { kindOf } from "@/lib/inventory/item-kinds";
import { suggestPackQty } from "@/lib/inventory/bom-rules";
import { fmt } from "@/lib/format";
import { CalcInput, SelectField, controlInset } from "@/components/form-kit";
import { ItemTypeahead } from "./item-typeahead";
import { entryToBase, usable } from "./lines-section";
import { blankPack, isBlankLine, newKey, parseNum, unitCostOf, type Draft, type DraftPack, type DraftPackSub, type ItemLite, type SkuInfo } from "./draft";

export function PackagingSection({ draft, set, items, byId, skuById, batchBase, contentOf, outputItemId, onCreateItem }: {
  draft: Draft;
  set: (patch: Partial<Draft>) => void;
  items: ItemLite[];
  byId: Map<string, ItemLite>;
  skuById: Map<string, SkuInfo>;
  batchBase: number;
  contentOf: (skuId: string) => number;
  outputItemId: string;
  onCreateItem: (name: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const outs = draft.outputs.filter(o => o.skuId);
  const packItems = new Set(draft.packs.filter(p => p.itemId).map(p => p.itemId));
  const ingredientItems = new Set(draft.inputs.filter(l => l.itemId).map(l => l.itemId));
  const skuName = (id: string | null) => skuById.get(id ?? "")?.name ?? "SKU";
  const withBlank = (list: DraftPack[]) => (list.some(isBlankLine) ? list : [...list, blankPack()]);
  const update = (key: string, patch: Partial<DraftPack>) => set({ packs: draft.packs.map(p => (p.key === key ? { ...p, ...patch } : p)) });
  /** One packaging item, one set of substitutes: write it onto every line of that item. */
  const setItemSubs = (itemId: string, subs: DraftPackSub[]) => set({ packs: draft.packs.map(p => (p.itemId === itemId ? { ...p, subs } : p)) });
  const toggle = (key: string) => setOpen(s => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  function fillRow(key: string, it: ItemLite, e: { qty: number | null; unit: string }) {
    const { qty, note } = entryToBase(it, e);
    const subs = draft.packs.find(p => p.itemId === it.id)?.subs ?? [];
    const tag = outs.length === 1 ? outs[0].skuId : null;
    set({ packs: withBlank(draft.packs.map(p => (p.key === key ? { ...p, itemId: it.id, qty: qty || "1", forSkuId: tag, subs: subs.map(s => ({ ...s, key: newKey() })) } : p))) });
    if (note) setNotes(n => ({ ...n, [key]: note }));
  }
  function removeRow(key: string) {
    const next = draft.packs.filter(p => p.key !== key);
    set({ packs: next.length ? next : [blankPack()] });
  }

  const cols = "grid grid-cols-[28px_minmax(0,1fr)_170px_auto_72px_28px] items-center gap-x-3 gap-y-1";
  const filled = draft.packs.filter(p => !isBlankLine(p)).length;

  return (
    <section className="px-5 py-5 border-b border-stone-800 space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-[15px] font-semibold text-stone-100">Packaging</h3>
        <span className="text-[11px] text-stone-400 bg-stone-800 rounded-lg px-1.5">{filled}</span>
        <span className="text-[12px] text-stone-500">per one sold unit of the SKU it packs</span>
      </div>
      <div className="rounded-lg border border-stone-800 bg-stone-950/40">
        <div className={`${cols} px-3 py-1.5 border-b border-stone-800 text-[11px] font-semibold uppercase tracking-wide text-stone-500`}>
          <span>#</span><span>Packaging item</span><span>Packs which SKU</span><span className="text-right w-[148px]">Qty per unit</span><span className="text-right">Cost</span><span />
        </div>
        {draft.packs.map((p, ix) => {
          if (isBlankLine(p)) {
            return (
              <div key={p.key} className="grid grid-cols-[28px_minmax(0,1fr)_28px] items-center gap-x-3 px-3 py-2 border-b border-stone-800/60 last:border-b-0">
                <span className="text-[12px] text-stone-500 tabular-nums">{ix + 1}</span>
                <ItemTypeahead items={items} mode="add" placeholder="Add packaging, like wrapper film 1, then Enter" exclude={i => !usable(i) || i.id === outputItemId || ingredientItems.has(i.id)} onPick={(i, e) => fillRow(p.key, i, e)} onCreate={onCreateItem} />
                <button type="button" aria-label="Remove line" onClick={() => removeRow(p.key)} className="p-1 text-stone-500 hover:text-rose-400"><X size={15} /></button>
              </div>
            );
          }
          const it = byId.get(p.itemId), uc = unitCostOf(it);
          const total = p.forSkuId ? suggestPackQty({ batchBase, contentPerPack: contentOf(p.forSkuId), perPack: parseNum(p.qty) }) : null;
          const isOpen = open.has(p.key);
          return (
            <div key={p.key} className={`${cols} px-3 py-2 border-b border-stone-800/60 last:border-b-0`}>
              <span className="text-[12px] text-stone-500 tabular-nums">{ix + 1}</span>
              <div className="min-w-0"><span className="text-[13px] text-stone-100 font-medium">{it?.name ?? "Item"}</span> <span className="text-[11px] text-stone-500 font-mono">{it?.code}</span>
                <div className="text-[11px] text-stone-500">{total != null ? `≈ ${fmt.qty(total)} per batch` : ""}{notes[p.key] ? ` ${notes[p.key]}` : ""}</div></div>
              <SelectField inset value={p.forSkuId ?? ""} onChange={e => update(p.key, { forSkuId: e.target.value || null })} aria-label="Packs which SKU">
                <option value="">{outs.length ? "Choose SKU" : "Add an output SKU first"}</option>
                {outs.map(o => <option key={o.skuId} value={o.skuId}>{skuName(o.skuId)}</option>)}
              </SelectField>
              <div className="flex items-center gap-1.5"><CalcInput className={`${controlInset} !w-28 text-right tabular-nums`} value={p.qty} onChange={v => update(p.key, { qty: v })} aria-label={`Amount of ${it?.name} per unit`} /><span className="text-[12px] text-stone-500 w-8">{it?.baseUom}</span></div>
              <div className="text-right text-[12px] text-stone-400 tabular-nums">{uc != null && total != null ? fmt.num2(total * uc) : "—"}</div>
              <button type="button" aria-label={`Remove ${it?.name}`} onClick={() => removeRow(p.key)} className="p-1 text-stone-500 hover:text-rose-400"><X size={15} /></button>
              <div className="col-span-full">
                <button type="button" onClick={() => toggle(p.key)} className="text-[12px] font-semibold text-sky-400 hover:underline">{p.subs.length ? `${p.subs.length} substitute${p.subs.length === 1 ? "" : "s"}` : "+ Substitutes"}</button>
              </div>
              {isOpen && it && (
                <div className="col-span-full rounded-lg border-l-[3px] border-sky-800 bg-stone-950/60 px-3 py-2.5 space-y-2">
                  <div><b className="text-[13px] text-stone-100">If {it.name} is not available</b><div className="text-[12px] text-stone-400">Offered in this order. The quantity is per ONE {it.name}; 1 means one-for-one. The same list applies wherever {it.name} is used in this BOM.</div></div>
                  {p.subs.map((s, k) => {
                    const si = byId.get(s.itemId), move = (d: -1 | 1) => { const j = k + d; if (j < 0 || j >= p.subs.length) return; const n = [...p.subs]; [n[k], n[j]] = [n[j], n[k]]; setItemSubs(p.itemId, n); };
                    return (
                      <div key={s.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="w-5 h-5 rounded-full bg-sky-500/15 text-sky-300 grid place-items-center text-[11px] font-semibold">{k + 2}</span>
                        <div className="min-w-0 flex-1"><span className="text-[13px] text-stone-100 font-medium">{si?.name}</span> <span className="text-[11px] text-stone-500 font-mono">{si?.code}</span></div>
                        <div className="flex items-center gap-1.5"><CalcInput className={`${controlInset} !w-24 text-right tabular-nums`} value={s.qty} onChange={v => setItemSubs(p.itemId, p.subs.map(x => (x.key === s.key ? { ...x, qty: v } : x)))} aria-label={`Amount of ${si?.name} per ${it.name}`} /><span className="text-[12px] text-stone-500">per 1 {it.name}</span></div>
                        <div className="flex">
                          <button type="button" aria-label="Move up" disabled={k === 0} onClick={() => move(-1)} className="p-1 text-stone-500 hover:text-stone-200 disabled:opacity-30"><ArrowUp size={14} /></button>
                          <button type="button" aria-label="Move down" disabled={k === p.subs.length - 1} onClick={() => move(1)} className="p-1 text-stone-500 hover:text-stone-200 disabled:opacity-30"><ArrowDown size={14} /></button>
                          <button type="button" aria-label={`Remove ${si?.name}`} onClick={() => setItemSubs(p.itemId, p.subs.filter(x => x.key !== s.key))} className="p-1 text-stone-500 hover:text-rose-400"><X size={14} /></button>
                        </div>
                      </div>
                    );
                  })}
                  <ItemTypeahead items={items} mode="search" placeholder={`Add a choice for ${it.name}`}
                    exclude={i => !(kindOf(i.productType).consumable && kindOf(i.productType).tracked) || i.id === it.id || packItems.has(i.id) || ingredientItems.has(i.id) || p.subs.some(s => s.itemId === i.id)}
                    onPick={i => setItemSubs(p.itemId, [...p.subs, { key: newKey(), itemId: i.id, qty: "1" }])} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button type="button" onClick={() => set({ packs: [...draft.packs, blankPack()] })} className="flex items-center gap-1 text-[13px] font-semibold text-sky-400 hover:underline"><Plus size={13} /> Add line</button>
    </section>
  );
}
