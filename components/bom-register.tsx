"use client";

/**
 * Bill of Materials register — recipes defining which inputs produce which
 * outputs. A row opens the BOM Builder drawer (components/bom-builder), where the
 * whole recipe is edited and saved in one go. A production Manufacturing Order
 * snapshots the BOM when it is planned, so editing a BOM never re-plans an order.
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Search } from "lucide-react";
import { controlInset } from "@/components/form-kit";
import { BomBuilderDrawer } from "@/components/bom-builder";
import type { ItemLite } from "@/components/bom-builder/draft";
import {
  useListView, ListPage, ListPageHeader, ListToolbar, ListChips, ListScroll, ListHead, ListFoot,
  listTable, type ListColumn,
} from "@/components/list-view";

function StatusBadge({ s }: { s: string }) {
  const cls = s === "Active" ? "bg-emerald-500/12 text-emerald-400 border-emerald-800/50" : s === "Draft" ? "bg-amber-500/12 text-amber-400 border-amber-800/50" : "bg-stone-500/12 text-stone-400 border-stone-700";
  return <span className={`text-[10px] font-medium border rounded-full px-2 py-0.5 ${cls}`}>{s}</span>;
}

export function BomRegister() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [items, setItems] = useState<ItemLite[]>([]);
  const [q, setQ] = useState("");
  /** undefined = closed, null = new BOM, string = editing that BOM. */
  const [open, setOpen] = useState<string | null | undefined>(undefined);

  async function load() {
    const r = await fetch(`/api/inventory/boms`).then(x => x.json()).catch(() => []);
    setRows(Array.isArray(r) ? r : []);
  }
  useEffect(() => {
    load();
    fetch(`/api/inventory/items`).then(x => x.json()).then(r => setItems(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1") setOpen(null);
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    let list = rows ?? [];
    if (s) list = list.filter(r => (r.name || "").toLowerCase().includes(s) || (r.code || "").toLowerCase().includes(s) || (r.outputItemName || "").toLowerCase().includes(s));
    return list;
  }, [rows, q]);

  const BOM_COLS = useMemo<ListColumn<any>[]>(() => [
    { key: "code", label: "BOM ID", sort: r => r.code, filter: { kind: "text", value: r => r.code } },
    { key: "output", label: "Output item", sort: r => r.outputItemName || r.name, filter: { kind: "text", value: r => r.outputItemName || r.name } },
    { key: "inputs", label: "Ingredients", align: "right", sort: r => r.inputCount },
    { key: "batchSize", label: "Batch size", align: "right", sort: r => Number(r.batchSize ?? 1) },
    { key: "expYield", label: "Exp. yield", align: "right", sort: r => r.expYield },
    { key: "status", label: "Status", sort: r => r.status, filter: { kind: "multi", value: r => r.status } },
  ], []);
  const lv = useListView(filtered, BOM_COLS, { storageKey: "boms-v2", defaultSort: "code" });

  return (
    <ListPage>
      <ListPageHeader title="Bill of Materials" subtitle="Recipes that define what is consumed to make each product. Click a recipe to edit it; a new one copies the product's existing recipe.">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-600" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search BOM ID, name or output…" className={`${controlInset} pl-9 w-56`} />
        </div>
        <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={rows === null ? "animate-spin" : ""} /></button>
        <button onClick={() => setOpen(null)} className="flex items-center gap-1.5 text-[13px] font-semibold bg-primary text-white rounded-lg px-3.5 py-2 hover:bg-primary-hover"><Plus size={14} /> New BOM</button>
      </ListPageHeader>

      {open !== undefined && (
        <BomBuilderDrawer bomId={open} items={items} onClose={() => setOpen(undefined)}
          onSaved={() => { setOpen(undefined); load(); }} onItemCreated={row => setItems(x => [...x, row])} />
      )}

      {rows === null ? (
        <div className="px-4 py-8 text-center text-stone-500 text-[13px]">Loading…</div>
      ) : (
        <>
          <ListToolbar lv={lv} noun="BOM" plural="BOMs" filtered={!!q.trim()} />
          <ListChips lv={lv} />
          <ListScroll lv={lv} empty="No BOMs yet — create one with the New BOM button.">
            <table className={listTable}>
              <ListHead lv={lv} />
              <tbody>
                {lv.rows.map((r: any) => (
                  <tr key={r.id} className="border-b border-stone-800/60 hover:bg-stone-800/30 cursor-pointer" onClick={() => setOpen(r.id)}>
                    <td className="px-4 py-2.5"><span className="text-stone-200 font-mono text-[12px]">{r.code || r.id.slice(0, 8)}</span></td>
                    <td className="px-4 py-2.5"><span className="text-stone-100 font-medium">{r.outputItemName || r.name}</span></td>
                    <td className="px-4 py-2.5 text-right text-stone-300 tabular-nums">{r.inputCount}</td>
                    <td className="px-4 py-2.5 text-right text-stone-300 tabular-nums">{Number(r.batchSize ?? 1).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-stone-300 tabular-nums">{r.expYield != null ? `${Number(r.expYield)}%` : "—"}</td>
                    <td className="px-4 py-2.5"><StatusBadge s={r.status} /></td>
                  </tr>
                ))}
              </tbody>
              {lv.rows.length > 0 && <ListFoot lv={lv} noun="BOM" plural="BOMs" />}
            </table>
          </ListScroll>
        </>
      )}
    </ListPage>
  );
}
