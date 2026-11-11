"use client";

/**
 * Ingredients and packaging. One-line entry ("honey 7", "salt 200g") adds a line
 * with the amount converted to the item's base unit; "Paste a list" adds many.
 * An item already in the recipe is not offered again — a BOM lists each once.
 */

import { useState } from "react";
import { X, ClipboardPaste } from "lucide-react";
import { kindOf } from "@/lib/inventory/item-kinds";
import { convert, uom as uomOf } from "@/lib/inventory/uom";
import { parseEntry, quantityCheck, suggestPackQty } from "@/lib/inventory/bom-rules";
import { fmt } from "@/lib/format";
import { CalcInput, SelectField, controlInset } from "@/components/form-kit";
import { ItemTypeahead, type PickedEntry } from "./item-typeahead";
import { newKey, newLine, normUnit, parseNum, unitCostOf, type Draft, type ItemLite } from "./draft";
import { LineExtras, type SupplierSkuLite } from "./line-extras";
import type { SkuLite } from "./product-section";

export interface UnknownLine { text: string; qty: number | null; unit: string }
export interface Reference { batch: number; qtyByItem: Map<string, number> }

/** "200 g" typed against a kg item becomes 0.2; an unconvertible unit leaves the amount blank and says why. */
function entryToBase(it: ItemLite, e: PickedEntry): { qty: string; note: string | null } {
  if (e.qty == null) return { qty: "", note: null };
  const from = e.unit ? normUnit(e.unit) : "", base = it.baseUom || "";
  if (!from || from === base.toLowerCase()) return { qty: String(e.qty), note: null };
  if (uomOf(from) && uomOf(base)) {
    const r = convert(e.qty, from, base);
    if (r.ok) { const q = Math.round(r.qty * 1e6) / 1e6; return { qty: String(q), note: `Converted ${e.qty} ${e.unit} to ${q} ${base}` }; }
  }
  return { qty: "", note: `${it.name} is kept in ${base}; ${e.unit} can't be converted to it. Enter the amount in ${base}.` };
}

const usable = (i: ItemLite) => kindOf(i.productType).consumable;

export function LinesSection({ draft, set, items, byId, reference, unknown, setUnknown, outputItemId, skus, onCreateItem, skusByItem, ensureSkus, onItemPatched }: {
  skusByItem: Record<string, SupplierSkuLite[] | undefined>;
  ensureSkus: (itemId: string) => void;
  onItemPatched: (itemId: string, patch: Partial<ItemLite>) => void;
  draft: Draft;
  set: (patch: Partial<Draft>) => void;
  items: ItemLite[];
  byId: Map<string, ItemLite>;
  reference: Reference | null;
  unknown: UnknownLine[];
  setUnknown: (u: UnknownLine[]) => void;
  outputItemId: string;
  skus: SkuLite[];
  onCreateItem: (name: string) => void;
}) {
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const batch = parseNum(draft.batchSize);
  const inIds = new Set(draft.inputs.map(l => l.itemId));
  const skuName = (id: string | null) => { const s = skus.find(x => x.id === id); return s ? (s.skuName || s.skuCode || "Pack") : "base unit"; };

  function addIngredient(it: ItemLite, e: PickedEntry) {
    const { qty, note } = entryToBase(it, e), line = newLine(it.id, qty);
    set({ inputs: [...draft.inputs, line] });
    if (note) setNotes(n => ({ ...n, [line.key]: note }));
  }
  function addPack(it: ItemLite, e: PickedEntry) {
    const { qty, note } = entryToBase(it, e), key = newKey();
    set({ packs: [...draft.packs, { key, itemId: it.id, qty: qty || "1", forSkuId: draft.outputs[0]?.skuId || null }] });
    if (note) setNotes(n => ({ ...n, [key]: note }));
  }
  function addMany() {
    const add: Draft["inputs"] = [], unk: UnknownLine[] = [], seen = new Set(inIds), nn: Record<string, string> = {};
    for (const raw of text.split(/\n/).map(s => s.trim()).filter(Boolean)) {
      const cols = raw.split(/\t|;/);
      const e = cols.length >= 2 ? { query: cols[0].trim(), qty: parseNum(cols[1]), unit: (cols[2] || "").trim() } : parseEntry(raw);
      const words = e.query.toLowerCase().split(/\s+/).filter(Boolean);
      const hit = words.length ? items.find(i => usable(i) && i.id !== outputItemId && words.every(w => `${i.name} ${i.code ?? ""}`.toLowerCase().includes(w))) : undefined;
      const qty = e.qty != null && Number.isFinite(e.qty) ? e.qty : null;
      if (!hit) { unk.push({ text: e.query, qty, unit: e.unit }); continue; }
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      const c = entryToBase(hit, { qty, unit: e.unit }), line = newLine(hit.id, c.qty);
      add.push(line);
      if (c.note) nn[line.key] = c.note;
    }
    set({ inputs: [...draft.inputs, ...add] });
    setNotes(n => ({ ...n, ...nn }));
    setUnknown([...unknown, ...unk]);
    setPaste(false); setText("");
  }

  const rowCls = "grid grid-cols-[minmax(0,1fr)_auto_72px_28px] items-center gap-x-3 gap-y-1 px-3 py-2 border-b border-stone-800/60 last:border-b-0";
  const qtyCls = `${controlInset} !w-28 text-right tabular-nums`;

  return (
    <section className="px-5 py-5 border-b border-stone-800 space-y-4">
      <h3 className="text-[15px] font-semibold text-stone-100">Ingredients &amp; packaging</h3>

      {unknown.map((u, ix) => (
        <div key={ix} className="rounded-lg border border-amber-800/50 bg-amber-500/10 px-3 py-2.5 flex flex-wrap items-center gap-2 text-[12px]">
          <div className="flex-1 min-w-[200px]"><b className="text-amber-300">We could not find “{u.text}”</b><div className="text-stone-400">{u.qty != null ? `${u.qty} ${u.unit} from your list. ` : ""}Create it as a new item, or leave it out.</div></div>
          <button type="button" onClick={() => { onCreateItem(u.text); setUnknown(unknown.filter((_, k) => k !== ix)); }} className="font-semibold text-stone-200 border border-stone-700 rounded-lg px-2.5 py-1 hover:border-stone-500">Add as new item</button>
          <button type="button" onClick={() => setUnknown(unknown.filter((_, k) => k !== ix))} className="font-semibold text-sky-400 hover:underline">Leave it out</button>
        </div>
      ))}

      <div>
        <div className="flex items-center gap-2 mb-1.5"><span className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">Ingredients</span><span className="text-[11px] text-stone-400 bg-stone-800 rounded-lg px-1.5">{draft.inputs.length}</span><span className="flex-1" /><span className="text-[11px] text-stone-500">Cost</span></div>
        {draft.inputs.length === 0 ? <div className="rounded-lg border border-dashed border-stone-700 px-3 py-3 text-[12px] text-stone-400">Nothing yet. Type a name and an amount below, like <b className="text-stone-200">honey 7</b>, and press Enter.</div> : (
          <div className="rounded-lg border border-stone-800 bg-stone-950/40">
            {draft.inputs.map(l => {
              const it = byId.get(l.itemId), q = parseNum(l.qty), uc = unitCostOf(it);
              const ref = reference?.qtyByItem.get(l.itemId);
              const chk = ref && reference ? quantityCheck({ qty: q, referenceQty: ref, referenceBatch: reference.batch, batch }) : null;
              return (
                <div key={l.key} className={rowCls}>
                  <div className="min-w-0"><span className="text-[13px] text-stone-100 font-medium">{it?.name ?? "Item"}</span> <span className="text-[11px] text-stone-500 font-mono">{it?.code}</span>
                    {notes[l.key] && <div className="text-[11px] text-stone-500">{notes[l.key]}</div>}</div>
                  <div className="flex items-center gap-1.5"><CalcInput className={qtyCls} value={l.qty} onChange={v => set({ inputs: draft.inputs.map(x => x.key === l.key ? { ...x, qty: v } : x) })} aria-label={`Amount of ${it?.name}`} /><span className="text-[12px] text-stone-500 w-8">{it?.baseUom}</span></div>
                  <div className="text-right text-[12px] text-stone-400 tabular-nums">{uc != null && q > 0 ? fmt.num2(q * uc) : "—"}</div>
                  <button type="button" aria-label={`Remove ${it?.name}`} onClick={() => set({ inputs: draft.inputs.filter(x => x.key !== l.key) })} className="p-1 text-stone-500 hover:text-rose-400"><X size={15} /></button>
                  {it && <LineExtras line={l} item={it} items={items} byId={byId} primaries={inIds} skusByItem={skusByItem} ensureSkus={ensureSkus}
                    onChange={patch => set({ inputs: draft.inputs.map(x => x.key === l.key ? { ...x, ...patch } : x) })} onItemPatched={onItemPatched} />}
                  {chk?.flagged && (
                    <div className="col-span-full rounded-lg bg-amber-500/10 border border-amber-800/50 px-2.5 py-1.5 text-[12px] text-amber-300 flex flex-wrap items-center gap-2">
                      <span className="flex-1">Your other recipe for this product uses about {fmt.qty(chk.expected)} {it?.baseUom} for a batch of {fmt.qty(batch)}.</span>
                      <button type="button" className="font-semibold text-stone-100 hover:underline" onClick={() => set({ inputs: draft.inputs.map(x => x.key === l.key ? { ...x, qty: String(chk.expected) } : x) })}>Use {fmt.qty(chk.expected)}</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="flex gap-2 mt-2">
          <div className="flex-1">
            <ItemTypeahead items={items} mode="add" inputId="bom-add-ingredient" placeholder="Add an ingredient, like honey 7, then Enter"
              exclude={i => !usable(i) || i.id === outputItemId || inIds.has(i.id)}
              rank={i => (reference?.qtyByItem.has(i.id) ? 1 : 0)} onPick={addIngredient} onCreate={onCreateItem} />
          </div>
          <button type="button" onClick={() => setPaste(p => !p)} className="flex items-center gap-1.5 text-[13px] font-semibold text-stone-200 border border-stone-700 rounded-lg px-3 hover:border-stone-500"><ClipboardPaste size={14} /> Paste a list</button>
        </div>
        {paste && (
          <div className="mt-2 rounded-lg border border-stone-800 bg-stone-950/40 p-3 space-y-2">
            <textarea value={text} onChange={e => setText(e.target.value)} rows={6} className={controlInset} placeholder={"Rolled oats\t18\tkg\nHoney\t7\tkg\nSea salt\t200\tg"} aria-label="Lines to paste" />
            <div className="flex items-center gap-3"><button type="button" onClick={addMany} disabled={!text.trim()} className="text-[13px] font-semibold bg-primary text-white rounded-lg px-3 py-1.5 disabled:opacity-50">Add these lines</button><button type="button" onClick={() => setPaste(false)} className="text-[13px] text-sky-400 font-semibold hover:underline">Close</button><span className="text-[12px] text-stone-500">Name, amount, unit — a spreadsheet selection or one per line.</span></div>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1.5"><span className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">Packaging <span className="normal-case font-normal">· per one pack</span></span><span className="text-[11px] text-stone-400 bg-stone-800 rounded-lg px-1.5">{draft.packs.length}</span></div>
        {draft.packs.length > 0 && (
          <div className="rounded-lg border border-stone-800 bg-stone-950/40 mb-2">
            {draft.packs.map(p => {
              const it = byId.get(p.itemId), uc = unitCostOf(it);
              const content = p.forSkuId ? parseNum(draft.outputs.find(o => o.skuId === p.forSkuId)?.qty) : 1;
              const total = suggestPackQty({ batchBase: batch, contentPerPack: content, perPack: parseNum(p.qty) });
              return (
                <div key={p.key} className={rowCls}>
                  <div className="min-w-0"><span className="text-[13px] text-stone-100 font-medium">{it?.name ?? "Item"}</span> <span className="text-[11px] text-stone-500 font-mono">{it?.code}</span>
                    <div className="text-[11px] text-stone-500 flex flex-wrap items-center gap-x-2">
                      {draft.outputs.length > 1
                        ? <SelectField inset value={p.forSkuId ?? ""} onChange={e => set({ packs: draft.packs.map(x => x.key === p.key ? { ...x, forSkuId: e.target.value || null } : x) })} aria-label="Packaging is for"><option value="">Which pack?</option>{draft.outputs.map(o => <option key={o.skuId} value={o.skuId}>{skuName(o.skuId)}</option>)}</SelectField>
                        : <span>for {skuName(p.forSkuId)}</span>}
                      {total != null && <span>≈ {fmt.qty(total)} per batch</span>}
                      {notes[p.key] && <span>{notes[p.key]}</span>}
                    </div></div>
                  <div className="flex items-center gap-1.5"><CalcInput className={qtyCls} value={p.qty} onChange={v => set({ packs: draft.packs.map(x => x.key === p.key ? { ...x, qty: v } : x) })} aria-label={`Amount of ${it?.name} per pack`} /><span className="text-[12px] text-stone-500 w-8">{it?.baseUom}</span></div>
                  <div className="text-right text-[12px] text-stone-400 tabular-nums">{uc != null && total != null ? fmt.num2(total * uc) : "—"}</div>
                  <button type="button" aria-label={`Remove ${it?.name}`} onClick={() => set({ packs: draft.packs.filter(x => x.key !== p.key) })} className="p-1 text-stone-500 hover:text-rose-400"><X size={15} /></button>
                </div>
              );
            })}
          </div>
        )}
        <ItemTypeahead items={items} mode="add" inputId="bom-add-packaging" placeholder="Add packaging, like wrapper film 1, then Enter"
          exclude={i => !usable(i) || i.id === outputItemId || draft.packs.some(p => p.itemId === i.id && (p.forSkuId ?? "") === (draft.outputs[0]?.skuId ?? ""))}
          onPick={addPack} onCreate={onCreateItem} />
        {skus.length > 0 && draft.outputs.length === 0 && <p className="text-[12px] text-stone-500 mt-1.5">Packaging is linked to the base unit. Add an output pack above to link it to a packaged SKU.</p>}
      </div>
    </section>
  );
}
