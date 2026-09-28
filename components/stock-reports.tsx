"use client";

/** Stock reports — valuation (summary + by-lot detail) and stock status. */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { RefreshCw, Search, Boxes, ClipboardList, ArrowLeft } from "lucide-react";
import { fmt } from "@/lib/format";
import { ReportShell } from "@/components/ui";
import { controlInset } from "@/components/form-kit";
import { useListView, ListHead, listTable, listRow, listCell, listNumCell, listMoneyCell, type ListColumn } from "@/components/list-view";

const money = fmt.num2;
const qty = fmt.qty;

// Money/quantity totals here are home-currency GL figures (no per-row
// currency), so they're rendered with fmt.num2/fmt.qty exactly as before —
// NOT via ListFoot/ListColumn's `money`/`sum` typing, which format through
// fmt.money (adds a currency symbol, defaulting to EUR when none is given)
// and fmt.qty respectively. Adopting those here would silently mislabel a
// non-EUR org's stock value. The canonical row/header chrome (sort, filter
// popovers, hover rows, sticky header) is adopted; totals keep their exact
// prior computation and format.
const footCls = "border-t-2 border-stone-800 bg-stone-900/60 font-semibold";

export function StockValuationReport() {
  const params = useSearchParams();
  const initialLots = params.get("view") === "lots";
  const [view, setView] = useState<"summary" | "lots">(initialLots ? "lots" : "summary");
  const [summary, setSummary] = useState<{ rows: any[]; total: number } | null>(null);
  const [lots, setLots] = useState<any[] | null>(null);
  const [q, setQ] = useState("");

  async function load() {
    setSummary(null); setLots(null);
    if (view === "summary") setSummary(await fetch(`/api/inventory/reports?type=valuation`).then(r => r.json()).catch(() => ({ rows: [], total: 0 })));
    else setLots(await fetch(`/api/inventory/reports?type=lots`).then(r => r.json()).catch(() => []));
  }
  useEffect(() => { load(); }, [view]);

  const filteredRows = useMemo(() => {
    const s = q.trim().toLowerCase(); const rows = summary?.rows ?? [];
    return s ? rows.filter(r => (r.name || "").toLowerCase().includes(s) || (r.code || "").toLowerCase().includes(s)) : rows;
  }, [summary, q]);
  const filteredLots = useMemo(() => {
    const s = q.trim().toLowerCase(); const rows = lots ?? [];
    return s ? rows.filter(r => (r.itemName || "").toLowerCase().includes(s) || (r.lotNo || "").toLowerCase().includes(s)) : rows;
  }, [lots, q]);
  const lotsTotal = useMemo(() => (filteredLots).reduce((s, l) => s + Number(l.value || 0), 0), [filteredLots]);
  const loading = view === "summary" ? summary === null : lots === null;

  const SUMMARY_COLS = useMemo<ListColumn<any>[]>(() => [
    { key: "item",     label: "Item",     sort: r => r.name },
    { key: "code",     label: "Code",     sort: r => r.code },
    { key: "category", label: "Category", sort: r => r.category, filter: { kind: "multi", value: r => r.category } },
    { key: "onHand",   label: "On hand",  align: "right", sort: r => Number(r.onHandQty) || 0, descFirst: true },
    { key: "avgCost",  label: "Avg cost", align: "right", sort: r => Number(r.avgCost) || 0, descFirst: true },
    { key: "value",    label: "Value",    align: "right", sort: r => Number(r.value) || 0, descFirst: true },
  ], []);
  // No defaultSort: rows render in the API's own order until a header is
  // clicked, exactly as before this refactor.
  const lvSummary = useListView(filteredRows, SUMMARY_COLS, { storageKey: "stock-valuation-summary" });

  const LOTS_COLS = useMemo<ListColumn<any>[]>(() => [
    { key: "item",     label: "Item",       sort: r => r.itemName },
    { key: "sku",      label: "SKU",        sort: r => r.skuName },
    { key: "lotNo",    label: "Lot #",      sort: r => r.lotNo },
    { key: "expiry",   label: "Expiry",     sort: r => r.expiryDate },
    { key: "where",    label: "Where" },
    { key: "remaining", label: "Remaining", align: "right", sort: r => Number(r.packs ?? r.remainingQty) || 0, descFirst: true },
    { key: "unitCost", label: "Unit cost",  align: "right", sort: r => Number(r.unitCost) || 0, descFirst: true },
    { key: "value",    label: "Value",      align: "right", sort: r => Number(r.value) || 0, descFirst: true },
  ], []);
  const lvLots = useListView(filteredLots, LOTS_COLS, { storageKey: "stock-valuation-lots" });

  return (
    <ReportShell title="Stock Valuation" sub="Value of inventory on hand, at FIFO cost." icon={Boxes} onRefresh={load} loading={loading}>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-1 bg-stone-900 border border-stone-800 rounded-lg p-1">
          {(["summary", "lots"] as const).map(v => (
            <button key={v} onClick={() => setView(v)} className={`text-[12px] font-medium rounded-md px-2.5 py-1 ${view === v ? "bg-stone-700 text-stone-100" : "text-stone-400 hover:text-stone-200"}`}>{v === "summary" ? "Summary" : "Detail (by lot)"}</button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-600" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" className={`${controlInset} pl-9`} />
        </div>
      </div>

      <div className="rounded-lg bg-stone-900 border border-stone-800 overflow-hidden">
        <div className="overflow-x-auto">
          {view === "summary" ? (
            <table className={`${listTable} min-w-[640px]`}>
              <ListHead lv={lvSummary} />
              <tbody>
                {loading && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
                {!loading && lvSummary.rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-500">No inventory items with stock.</td></tr>}
                {lvSummary.rows.map(r => (
                  <tr key={r.id} className={listRow()}>
                    <td className={`${listCell} text-stone-100 font-medium`}>{r.name}</td>
                    <td className={`${listCell} text-stone-400 font-mono text-[12px]`}>{r.code || "—"}</td>
                    <td className={`${listCell} text-stone-400`}>{r.category || "—"}</td>
                    <td className={`${listNumCell} text-stone-300`}>{qty(r.onHandQty)} {r.baseUom || ""}</td>
                    <td className={`${listNumCell} text-stone-300 font-mono`}>{money(r.avgCost)}</td>
                    <td className={`${listMoneyCell} text-stone-200`}>{money(r.value)}</td>
                  </tr>
                ))}
              </tbody>
              {!loading && lvSummary.rows.length > 0 && (
                <tfoot><tr className={footCls}>
                  <td className="px-2 py-2.5 text-stone-200" colSpan={5}>Total inventory value</td>
                  <td className={listMoneyCell}><span className="text-white">{money(summary?.total)}</span></td>
                </tr></tfoot>
              )}
            </table>
          ) : (
            <table className={`${listTable} min-w-[720px]`}>
              <ListHead lv={lvLots} />
              <tbody>
                {loading && <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
                {!loading && lvLots.rows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-500">No open cost lots.</td></tr>}
                {lvLots.rows.map(l => (
                  <tr key={l.id} className={listRow()}>
                    <td className={`${listCell} text-stone-100`}>{l.itemName}</td>
                    <td className={`${listCell} text-stone-300`}>{l.skuName || <span className="text-stone-600">base</span>}</td>
                    <td className={`${listCell} text-stone-300 font-mono`}>
                      <Link href={`/accounting/reports/lot-traceability?lotId=${l.id}`} className="hover:text-emerald-400 hover:underline" title="Trace this lot's full history">
                        {l.lotNo || l.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className={`${listCell} text-stone-400`}>{l.expiryDate || "—"}</td>
                    <td className={`${listCell} text-[12px] text-stone-400`}>
                      {!l.locations?.length ? <span className="text-stone-600">—</span>
                        : l.locations.length === 1 ? <span title={l.locations[0].name}>{l.locations[0].code}</span>
                        : l.locations.map((x: any) => `${x.code} ${qty(x.qty)}`).join(" · ")}
                    </td>
                    <td className={`${listNumCell} text-stone-300`}>{l.packs != null ? `${qty(l.packs)} ${l.packType || "packs"}` : `${qty(l.remainingQty)} ${l.baseUom || ""}`}</td>
                    <td className={`${listNumCell} text-stone-300 font-mono`}>{money(l.unitCost)}</td>
                    <td className={`${listMoneyCell} text-stone-200`}>{money(l.value)}</td>
                  </tr>
                ))}
              </tbody>
              {!loading && lvLots.rows.length > 0 && (
                <tfoot><tr className={footCls}>
                  <td className="px-2 py-2.5 text-stone-200" colSpan={7}>Total</td>
                  <td className={listMoneyCell}><span className="text-white">{money(lotsTotal)}</span></td>
                </tr></tfoot>
              )}
            </table>
          )}
        </div>
      </div>
    </ReportShell>
  );
}

export function StockStatusReport() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [q, setQ] = useState("");
  const [only, setOnly] = useState(false);
  async function load() { setRows(await fetch(`/api/inventory/reports?type=status`).then(r => r.json()).catch(() => [])); }
  useEffect(() => { load(); }, []);
  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (only) list = list.filter(r => r.belowMin || r.out);
    const s = q.trim().toLowerCase();
    if (s) list = list.filter(r => (r.name || "").toLowerCase().includes(s) || (r.code || "").toLowerCase().includes(s));
    return list;
  }, [rows, q, only]);

  const COLS = useMemo<ListColumn<any>[]>(() => [
    { key: "item",      label: "Item",      sort: r => r.name },
    { key: "code",      label: "Code",      sort: r => r.code },
    { key: "onHand",    label: "On hand",   align: "right", sort: r => Number(r.onHandQty) || 0, descFirst: true },
    { key: "where",     label: "Where" },
    { key: "expected",  label: "Expected (PO / MO)", align: "right", sort: r => Number(r.expectedQty) || 0, descFirst: true },
    { key: "committed", label: "Committed (SO)",     align: "right", sort: r => Number(r.committedQty) || 0, descFirst: true },
    { key: "allocated", label: "Allocated (MO)",     align: "right", sort: r => Number(r.allocatedQty) || 0, descFirst: true },
    { key: "available", label: "Available", align: "right", sort: r => Number(r.availableQty) || 0, descFirst: true },
    { key: "min",       label: "Min.",      align: "right", sort: r => Number(r.minOhQty) || 0 },
    { key: "status",    label: "Status",    sort: r => r.out ? 2 : r.belowMin ? 1 : 0,
      filter: { kind: "multi", value: r => r.out ? "Out of stock" : r.belowMin ? "Below minimum" : "OK" } },
  ], []);

  const lv = useListView(filtered, COLS, { storageKey: "stock-status" });

  return (
    <ReportShell title="Stock Status" sub="On-hand quantity against each item's minimum reorder level." icon={ClipboardList} onRefresh={load} loading={rows === null}>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-600" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" className={`${controlInset} pl-9`} />
        </div>
        <label className="flex items-center gap-2 text-[12px] text-stone-400"><input type="checkbox" checked={only} onChange={e => setOnly(e.target.checked)} className="accent-emerald-600" /> Only items needing attention</label>
      </div>
      <div className="rounded-lg bg-stone-900 border border-stone-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className={`${listTable} min-w-[620px]`}>
            <ListHead lv={lv} />
            <tbody>
              {rows === null && <tr><td colSpan={10} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
              {rows !== null && lv.rows.length === 0 && <tr><td colSpan={10} className="px-4 py-8 text-center text-stone-500">Nothing to show.</td></tr>}
              {lv.rows.map(r => (
                <tr key={r.id} className={listRow()}>
                  <td className={`${listCell} text-stone-100 font-medium`}>{r.name}</td>
                  <td className={`${listCell} text-stone-400 font-mono text-[12px]`}>{r.code || "—"}</td>
                  <td className={`${listNumCell} text-stone-300`}>{qty(r.onHandQty)} {r.baseUom || ""}</td>
                  {/* One location is not a split worth spelling out — show the
                      breakdown only when the stock is genuinely in more than
                      one place, and the single-location name otherwise. */}
                  <td className={`${listCell} text-[12px] text-stone-400`}>
                    {!r.byLocation?.length ? <span className="text-stone-600">—</span>
                      : r.byLocation.length === 1 ? <span title={r.byLocation[0].name}>{r.byLocation[0].code}</span>
                      : (
                        <span className="inline-flex flex-wrap gap-x-2 gap-y-0.5">
                          {r.byLocation.map((l: any) => (
                            <span key={l.locationId} title={l.name} className="whitespace-nowrap">
                              <span className="text-stone-500">{l.code}</span>{" "}
                              <span className="tabular-nums text-stone-300">{qty(l.qty)}</span>
                            </span>
                          ))}
                        </span>
                      )}
                  </td>
                  <td className={listNumCell}>{Number(r.expectedQty) > 0 ? <span className="text-cyan-400">+{qty(r.expectedQty)}</span> : <span className="text-stone-600">—</span>}</td>
                  <td className={listNumCell}>{Number(r.committedQty) > 0 ? <span className="text-amber-400">−{qty(r.committedQty)}</span> : <span className="text-stone-600">—</span>}</td>
                  <td className={listNumCell}>{Number(r.allocatedQty) > 0 ? <span className="text-amber-400">−{qty(r.allocatedQty)}</span> : <span className="text-stone-600">—</span>}</td>
                  <td className={`${listNumCell} text-stone-200`}>{qty(r.availableQty)}</td>
                  <td className={`${listNumCell} text-stone-400`}>{qty(r.minOhQty)}</td>
                  <td className={listCell}>
                    {r.out ? <span className="text-[11px] font-medium text-rose-400">Out of stock</span>
                      : r.belowMin ? <span className="text-[11px] font-medium text-amber-400">Below minimum</span>
                      : <span className="text-[11px] text-emerald-400">OK</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </ReportShell>
  );
}
