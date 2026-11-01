"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { ListPage, ListPageHeader, listTable, listCell, listNumCell } from "@/components/list-view";
import { ListSearch, ListExportButton, exportRowsToExcel, type ExportColumn } from "@/components/list-chrome";
import { fmt, localToday } from "@/lib/format";
import { URGENCY_LABEL, type ReorderUrgency } from "@/lib/inventory/reorder";

type Row = {
  id: string; code: string | null; name: string; category: string | null; baseUom: string | null;
  onHand: number; expected: number; committed: number; available: number; minOh: number; shortfall: number;
  suggestedQty: number; moqBase: number | null; unitCostBase: number | null; estimatedCost: number | null;
  urgency: ReorderUrgency; leadTimeDays: number | null; currency: string | null;
};
type Group = {
  supplierId: string | null; supplierName: string; currency: string | null;
  rows: Row[]; totalCost: number; hasUnpriced: boolean;
};
type Data = { groups: Group[]; totals: { items: number; stockedOut: number } };

/** Colour is for the exception only: a stocked-out item. Below-min stays quiet. */
function UrgencyChip({ urgency }: { urgency: ReorderUrgency }) {
  if (urgency === "stocked_out") {
    return <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-medium bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30">{URGENCY_LABEL[urgency]}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-stone-300">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />{URGENCY_LABEL[urgency]}
    </span>
  );
}

export default function ReorderSuggestionsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let live = true;
    fetch("/api/inventory/reorder-suggestions")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || "Could not load reorder suggestions");
        if (live) setData(j);
      })
      .catch((e) => live && setError(e?.message || "Could not load reorder suggestions"));
    return () => { live = false; };
  }, []);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!data) return [];
    return data.groups
      .map((g) => ({
        ...g,
        rows: needle
          ? g.rows.filter((r) => r.name.toLowerCase().includes(needle) || (r.code ?? "").toLowerCase().includes(needle) || (r.category ?? "").toLowerCase().includes(needle))
          : g.rows,
      }))
      .filter((g) => g.rows.length > 0);
  }, [data, q]);

  const flat = useMemo(() => groups.flatMap((g) => g.rows.map((r) => ({ ...r, supplier: g.supplierName }))), [groups]);

  const exportCols: ExportColumn<(typeof flat)[number]>[] = [
    { header: "Supplier", value: (r) => r.supplier, width: 28 },
    { header: "Code", value: (r) => r.code },
    { header: "Item", value: (r) => r.name, width: 32 },
    { header: "Urgency", value: (r) => URGENCY_LABEL[r.urgency] },
    { header: "Unit", value: (r) => r.baseUom },
    { header: "On hand", value: (r) => r.onHand },
    { header: "Expected", value: (r) => r.expected },
    { header: "Committed", value: (r) => r.committed },
    { header: "Available", value: (r) => r.available },
    { header: "Minimum", value: (r) => r.minOh },
    { header: "Shortfall", value: (r) => r.shortfall },
    { header: "Suggested qty", value: (r) => r.suggestedQty },
    { header: "Supplier MOQ (base)", value: (r) => r.moqBase },
    { header: "Unit cost (base)", value: (r) => r.unitCostBase },
    { header: "Estimated cost", value: (r) => r.estimatedCost },
    { header: "Currency", value: (r) => r.currency },
    { header: "Lead time (days)", value: (r) => r.leadTimeDays },
  ];

  const th = "px-2 py-2 text-[11px] font-medium uppercase tracking-wide text-stone-400 text-left whitespace-nowrap";
  const thNum = `${th} text-right`;

  return (
    <ListPage>
      <ListPageHeader
        title="Reorder suggestions"
        subtitle={data ? `${data.totals.items} item${data.totals.items === 1 ? "" : "s"} below minimum${data.totals.stockedOut ? ` · ${data.totals.stockedOut} stocked out` : ""}` : "Items whose available stock is below their minimum"}
      >
        <ListSearch value={q} onChange={setQ} placeholder="Search item, code or category" />
        <ListExportButton
          disabled={!flat.length}
          onClick={() => exportRowsToExcel({ rows: flat, columns: exportCols, sheet: "Reorder", filename: `reorder-suggestions-${localToday()}.xlsx` })}
        />
      </ListPageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {error && <p className="text-sm text-rose-300">{error}</p>}
        {!error && !data && <p className="text-sm text-stone-400">Loading…</p>}
        {data && !groups.length && (
          <p className="text-sm text-stone-400">
            {data.totals.items ? "No items match your search." : "Nothing to reorder: every stocked item is at or above its minimum."}
          </p>
        )}

        {groups.map((g) => (
          <section key={g.supplierId ?? "none"} className="mb-6">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div>
                <h2 className="text-[14px] font-semibold text-white">{g.supplierName}</h2>
                <p className="text-[12px] text-stone-400">
                  {g.rows.length} item{g.rows.length === 1 ? "" : "s"}
                  {g.supplierId && g.totalCost > 0 && <> · estimated {fmt.money(g.totalCost, g.currency ?? undefined)}{g.hasUnpriced ? " + unpriced items" : ""}</>}
                  {!g.supplierId && " · link a supplier on the item to see costs and lead times"}
                </p>
              </div>
              {g.supplierId && (
                // The New Document form has no query prefill, so this opens an empty PO.
                <Link href="/accounting/new/PurchaseOrder"
                  className="flex items-center gap-1.5 text-[12px] font-medium rounded-md px-2.5 py-1.5 border text-stone-200 border-stone-600 bg-stone-800 hover:bg-stone-700 transition-colors">
                  <ShoppingCart size={13} /> Create purchase order
                </Link>
              )}
            </div>
            <div className="border border-stone-800 rounded-lg overflow-x-auto">
              <table className={listTable}>
                <thead className="bg-stone-900">
                  <tr>
                    <th className={th}>Item</th>
                    <th className={th}>Status</th>
                    <th className={thNum}>On hand</th>
                    <th className={thNum}>Expected</th>
                    <th className={thNum}>Committed</th>
                    <th className={thNum}>Available</th>
                    <th className={thNum}>Minimum</th>
                    <th className={thNum}>Suggested qty</th>
                    <th className={thNum}>Est. cost</th>
                    <th className={thNum}>Lead time</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.id} className="border-t border-stone-800 hover:bg-stone-900/60">
                      <td className={listCell}>
                        <div className="text-stone-100">{r.name}</div>
                        {r.code && <div className="text-[11px] text-stone-500">{r.code}</div>}
                      </td>
                      <td className={listCell}><UrgencyChip urgency={r.urgency} /></td>
                      <td className={listNumCell}>{fmt.qty(r.onHand)}</td>
                      <td className={listNumCell}>{fmt.qty(r.expected)}</td>
                      <td className={listNumCell}>{fmt.qty(r.committed)}</td>
                      <td className={listNumCell}>{fmt.qty(r.available)}</td>
                      <td className={listNumCell}>{fmt.qty(r.minOh)}</td>
                      <td className={`${listNumCell} font-medium text-white`}>
                        {fmt.qty(r.suggestedQty)} {r.baseUom ?? ""}
                        {r.moqBase != null && r.suggestedQty === r.moqBase && r.moqBase > r.shortfall && (
                          <span className="block text-[11px] font-normal text-stone-500">supplier minimum</span>
                        )}
                      </td>
                      <td className={listNumCell}>{r.estimatedCost != null ? fmt.money(r.estimatedCost, r.currency ?? undefined) : "—"}</td>
                      <td className={listNumCell}>{r.leadTimeDays != null ? `${r.leadTimeDays} d` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </ListPage>
  );
}
