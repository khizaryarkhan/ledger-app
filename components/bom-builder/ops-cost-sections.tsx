"use client";

/** Operations (time per batch at a work centre) and the live cost estimate. */

import { X } from "lucide-react";
import { costRollup, suggestPackQty } from "@/lib/inventory/bom-rules";
import { fmt } from "@/lib/format";
import { CalcInput, controlInset } from "@/components/form-kit";
import { newKey, parseNum, unitCostOf, type Draft, type ItemLite } from "./draft";

export interface WorkCentreLite { id: string; name: string; labourRate: number | string; overheadRate: number | string; status?: string }

export function OperationsSection({ draft, set, centres }: { draft: Draft; set: (p: Partial<Draft>) => void; centres: WorkCentreLite[] | null }) {
  const byId = new Map((centres ?? []).map(c => [c.id, c]));
  const free = (centres ?? []).filter(c => c.status !== "Archived" && !draft.ops.some(o => o.workCentreId === c.id));
  return (
    <section className="px-5 py-5 border-b border-stone-800 space-y-3">
      <div><h3 className="text-[15px] font-semibold text-stone-100">Operations</h3><p className="text-[12px] text-stone-400 mt-0.5">Time per batch at a work centre. Its rates charge labour and overhead.</p></div>
      {draft.ops.length === 0
        ? <div className="rounded-lg border border-dashed border-stone-700 px-3 py-3 text-[12px] text-stone-400">No operations. The output is costed at materials only.</div>
        : <div className="rounded-lg border border-stone-800 bg-stone-950/40">
          {draft.ops.map(o => {
            const c = byId.get(o.workCentreId), h = parseNum(o.hours);
            return (
              <div key={o.key} className="grid grid-cols-[minmax(0,1fr)_auto_72px_28px] items-center gap-x-3 px-3 py-2 border-b border-stone-800/60 last:border-b-0">
                <div className="min-w-0"><div className="text-[13px] text-stone-100 font-medium">{c?.name ?? "Work centre"}</div><div className="text-[11px] text-stone-500">{fmt.num2(Number(c?.labourRate ?? 0))} labour + {fmt.num2(Number(c?.overheadRate ?? 0))} overhead per hour</div></div>
                <div className="flex items-center gap-1.5"><CalcInput className={`${controlInset} !w-24 text-right tabular-nums`} value={o.hours} onChange={v => set({ ops: draft.ops.map(x => x.key === o.key ? { ...x, hours: v } : x) })} aria-label={`Hours at ${c?.name}`} /><span className="text-[12px] text-stone-500 w-10">hours</span></div>
                <div className="text-right text-[12px] text-stone-400 tabular-nums">{h > 0 && c ? fmt.num2(h * (Number(c.labourRate) + Number(c.overheadRate))) : "—"}</div>
                <button type="button" aria-label="Remove operation" onClick={() => set({ ops: draft.ops.filter(x => x.key !== o.key) })} className="p-1 text-stone-500 hover:text-rose-400"><X size={15} /></button>
              </div>
            );
          })}
        </div>}
      {centres && centres.length === 0 && <p className="text-[12px] text-amber-400">No work centres yet. Add one under Supply Chain → Work Centres to cost labour.</p>}
      {free.length > 0 && <div className="flex flex-wrap items-center gap-2"><span className="text-[12px] text-stone-500">Add:</span>{free.map(c => <button key={c.id} type="button" onClick={() => set({ ops: [...draft.ops, { key: newKey(), workCentreId: c.id, hours: "1", description: "" }] })} className="text-[12px] font-semibold text-stone-300 border border-stone-700 rounded-lg px-2.5 py-1 hover:border-stone-500">+ {c.name}</button>)}</div>}
    </section>
  );
}

export function CostSection({ draft, byId, centres, unit }: { draft: Draft; byId: Map<string, ItemLite>; centres: WorkCentreLite[] | null; unit: string }) {
  const batch = parseNum(draft.batchSize), cmap = new Map((centres ?? []).map(c => [c.id, c]));
  const lines = [
    ...draft.inputs.map(l => ({ qty: parseNum(l.qty) || 0, unitCost: unitCostOf(byId.get(l.itemId)), isPack: false })),
    ...draft.packs.map(p => {
      const content = p.forSkuId ? parseNum(draft.outputs.find(o => o.skuId === p.forSkuId)?.qty) : 1;
      return { qty: suggestPackQty({ batchBase: batch, contentPerPack: content, perPack: parseNum(p.qty) }) ?? 0, unitCost: unitCostOf(byId.get(p.itemId)), isPack: true };
    }),
  ];
  const ops = draft.ops.map(o => ({ hours: parseNum(o.hours) || 0, labourRate: Number(cmap.get(o.workCentreId)?.labourRate ?? 0), overheadRate: Number(cmap.get(o.workCentreId)?.overheadRate ?? 0) }));
  const c = costRollup({ batch: batch > 0 ? batch : 0, lines, ops });
  const cell = (label: string, v: number, strong = false) => (
    <div className={`rounded-lg border px-3 py-2 ${strong ? "border-primary/60 bg-stone-950/40" : "border-stone-800 bg-stone-950/40"}`}>
      <div className="text-[11px] text-stone-400">{label}</div><div className="text-[15px] font-semibold text-stone-100 tabular-nums">{fmt.num2(v)}</div>
    </div>
  );
  return (
    <section className="px-5 py-5 space-y-3">
      <h3 className="text-[15px] font-semibold text-stone-100">Cost per batch</h3>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {cell("Materials", c.materials)}{cell("Packaging", c.packaging)}{cell("Labour", c.labour)}{cell("Overhead", c.overhead)}{cell(`Per ${unit || "unit"}`, c.perUnit, true)}
      </div>
      <p className="text-[12px] text-stone-500">An estimate from today's item costs and work-centre rates{c.unpriced > 0 ? `; ${c.unpriced} line${c.unpriced === 1 ? " has" : "s have"} no cost yet and count as zero` : ""}. The real cost comes from the lots consumed when an order completes. Total {fmt.num2(c.total)} per batch.</p>
    </section>
  );
}
