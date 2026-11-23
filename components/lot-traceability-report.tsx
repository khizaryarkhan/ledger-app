"use client";

/**
 * Lot traceability — search a lot code (or arrive with ?lotId= from Stock
 * Valuation Detail) and see its complete audit-style trace: raw materials
 * procured/consumed, every subcontract/internal processing step with its
 * cost, a cost rollup reconciled against the lot's own declared valuation,
 * and outbound distribution to customers. Same data and layout as the
 * printable report (components/lot-trace-print.tsx) — this is that report
 * rendered for the app's dark theme instead of a paper sheet, so the screen
 * and the PDF never disagree. Every document number (PO, GRN, job work
 * order, production run, shipment, invoice) links to its own accounting
 * entry in a new tab when one exists.
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, GitBranch, Truck, ShieldCheck, ShieldAlert, FileDown } from "lucide-react";
import { fmt } from "@/lib/format";
import { ReportShell } from "@/components/ui";
import { controlInset, tableHead, SelectField } from "@/components/form-kit";

const qty = fmt.qty;
const money = fmt.num2;

function SectionCard({ n, title, empty, children }: { n: number; title: string; empty?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-stone-900 border border-stone-800 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-stone-800 flex items-center gap-2">
        <span className="w-5 h-5 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">{n}</span>
        <span className="text-[12.5px] font-semibold text-stone-200">{title}</span>
      </div>
      {empty ? <p className="px-4 py-6 text-[12.5px] text-stone-500 italic">{empty}</p> : <div className="overflow-x-auto">{children}</div>}
    </div>
  );
}

function Th({ children, r }: { children: React.ReactNode; r?: boolean }) {
  return <th className={`px-4 py-2.5 ${r ? "text-right" : "text-left"}`}>{children}</th>;
}

/** A document number that opens its accounting entry in a new tab when an id is available; plain text otherwise. */
function DocLink({ href, mono, children }: { href: string | null | undefined; mono?: boolean; children: React.ReactNode }) {
  const cls = mono ? "font-mono text-[12px]" : "";
  if (!href) return <span className={cls}>{children}</span>;
  return <a href={href} target="_blank" rel="noopener noreferrer" className={`${cls} text-emerald-400 hover:text-emerald-300 hover:underline`}>{children}</a>;
}

export function LotTraceabilityReport() {
  const params = useSearchParams();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searched, setSearched] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(params.get("lotId"));
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Dropdown route to a lot: pick an item, then one of its lots. Typing a code still works.
  const [items, setItems] = useState<{ id: string; name: string; lots: number }[]>([]);
  const [itemId, setItemId] = useState("");
  const [itemLots, setItemLots] = useState<any[]>([]);
  useEffect(() => {
    fetch("/api/inventory/lots?items=1").then(r => r.json()).then(d => setItems(Array.isArray(d) ? d : [])).catch(() => setItems([]));
  }, []);
  useEffect(() => {
    if (!itemId) { setItemLots([]); return; }
    fetch(`/api/inventory/lots?itemId=${encodeURIComponent(itemId)}`).then(r => r.json()).then(d => setItemLots(Array.isArray(d) ? d : [])).catch(() => setItemLots([]));
  }, [itemId]);

  async function search() {
    if (!q.trim()) { setResults([]); setSearched(false); return; }
    const r = await fetch(`/api/inventory/lots?q=${encodeURIComponent(q.trim())}`).then(x => x.json()).catch(() => []);
    setResults(Array.isArray(r) ? r : []);
    setSearched(true);
  }

  async function load(lotId: string) {
    setLoading(true); setData(null);
    const d = await fetch(`/api/inventory/lots/${lotId}/trace-report`).then(r => r.json()).catch(() => null);
    setData(d?.lot ? d : null); setLoading(false);
  }
  useEffect(() => { if (selectedId) load(selectedId); }, [selectedId]);

  const totalCost = data?.costRollup?.find((r: any) => r.label.startsWith("Total"))?.amount ?? 0;
  const declaredValue = data ? Math.round(data.lot.unitCost * data.lot.origQty * 100) / 100 : 0;
  const reconciled = data ? (Math.abs(totalCost - declaredValue) < 0.01 || (data.rawMaterials ?? []).length === 0) : false;
  // Raw-material, processing and cost-rollup sections describe how a lot was MADE. A lot that was
  // bought, counted in or opened has none of that; it has an origin instead.
  const manufactured = data ? data.lot.sourceType === "production" || data.lot.sourceType === "jobwork" : false;
  useEffect(() => { if (data?.lot?.itemId) setItemId(cur => (cur === data.lot.itemId ? cur : data.lot.itemId)); }, [data]);
  const sum = (rows: any[]) => rows.reduce((s, r) => s + r.amount, 0);
  const rawTotal = data ? sum(data.rawMaterials) : 0;
  const processingTotal = data ? sum(data.processing) : 0;
  const distributionTotal = data ? sum(data.distribution) : 0;

  return (
    <ReportShell title="Lot Traceability" sub="A lot's complete history — raw materials, processing, cost rollup and distribution." icon={GitBranch} onRefresh={() => selectedId && load(selectedId)} loading={loading}>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="block w-56">
          <span className="block text-[11px] uppercase tracking-wider text-stone-500 mb-1">Item</span>
          <SelectField inset value={itemId} onChange={e => { setItemId(e.target.value); setSelectedId(null); setData(null); }}>
            <option value="">Choose an item…</option>
            {items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.lots})</option>)}
          </SelectField>
        </label>
        <label className="block w-72">
          <span className="block text-[11px] uppercase tracking-wider text-stone-500 mb-1">Lot</span>
          <SelectField inset value={selectedId ?? ""} disabled={!itemId} onChange={e => e.target.value && setSelectedId(e.target.value)}>
            <option value="">{itemId ? (itemLots.length ? "Choose a lot…" : "No lots for this item") : "Choose an item first"}</option>
            {itemLots.map(l => (
              <option key={l.id} value={l.id}>
                {l.lotNo ?? l.id.slice(0, 8)} · {l.status} · {qty(l.remainingQty)}/{qty(l.origQty)} left{l.receivedDate ? ` · ${fmt.shortDate(l.receivedDate)}` : ""}
              </option>
            ))}
          </SelectField>
        </label>
        <span className="pb-2 text-[12px] text-stone-500">or</span>
        <div className="relative w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-600" />
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} placeholder="Type a lot code, then Enter" className={`${controlInset} pl-9`} />
        </div>
      </div>

      {results.length > 0 && !selectedId && (
        <div className="rounded-lg bg-stone-900 border border-stone-800 divide-y divide-stone-800 mb-4">
          {results.map(r => (
            <button key={r.id} onClick={() => setSelectedId(r.id)} className="w-full text-left px-4 py-2.5 text-[13px] hover:bg-stone-800/60 flex items-center justify-between">
              <span className="text-stone-200">{r.itemName} <span className="font-mono text-stone-400">{r.lotNo}</span></span>
              <span className="text-stone-500">{r.status} · {qty(r.remainingQty)}/{qty(r.origQty)} remaining</span>
            </button>
          ))}
        </div>
      )}
      {results.length === 0 && searched && !selectedId && (
        <p className="text-[12.5px] text-stone-500">No lot matches "{q}" — check the code on Stock Valuation Detail.</p>
      )}

      {selectedId && (
        <div className="space-y-4">
          {loading && <div className="rounded-lg bg-stone-900 border border-stone-800 p-5"><p className="text-stone-500 text-[13px]">Loading…</p></div>}
          {!loading && !data && <div className="rounded-lg bg-stone-900 border border-stone-800 p-5"><p className="text-stone-500 text-[13px]">Lot not found.</p></div>}
          {!loading && data && (
            <>
              <div className="rounded-lg bg-stone-900 border border-stone-800 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-stone-500">Batch Traceability &amp; Cost Reconciliation</div>
                    <div className="text-[18px] font-semibold text-stone-100 mt-0.5">{data.lot.itemName} <span className="font-mono text-emerald-400">{data.lot.lotNo ?? data.lot.id.slice(0, 8)}</span></div>
                  </div>
                  <div className="flex items-center gap-3">
                    <a href={`/print/lot-trace/${selectedId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-emerald-400 hover:underline">
                      <FileDown size={13} /> Print / Download PDF
                    </a>
                    <button onClick={() => { setSelectedId(null); setData(null); setResults([]); setQ(""); setSearched(false); setItemId(""); }} className="text-[12px] text-stone-500 hover:text-stone-300">New search</button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 rounded-lg border border-stone-800 divide-x divide-stone-800 overflow-hidden">
                  <div className="px-3 py-2.5 bg-stone-950/40"><div className="text-[10px] uppercase tracking-wider text-stone-500">Lot / Batch</div><div className="text-[13px] font-semibold text-stone-100 font-mono mt-0.5">{data.lot.lotNo ?? data.lot.id.slice(0, 8)}</div></div>
                  <div className="px-3 py-2.5"><div className="text-[10px] uppercase tracking-wider text-stone-500">Total Quantity</div><div className="text-[13px] font-semibold text-stone-100 tabular-nums mt-0.5">{qty(data.lot.origQty)} {data.lot.baseUom ?? ""}</div>{data.lot.packs && <div className="text-[11px] text-stone-400 mt-0.5">{qty(data.lot.packs.qty)} × {data.lot.packs.label}</div>}</div>
                  <div className="px-3 py-2.5 bg-stone-950/40"><div className="text-[10px] uppercase tracking-wider text-stone-500">Unit Cost</div><div className="text-[13px] font-semibold text-stone-100 tabular-nums mt-0.5">{money(data.lot.unitCost)}</div></div>
                  <div className="px-3 py-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-stone-500">On hand now</div>
                    <div className="text-[15px] font-semibold text-emerald-400 tabular-nums mt-0.5">{qty(data.lot.remainingQty)} {data.lot.baseUom ?? ""}</div>
                    <div className="text-[11px] text-stone-400 mt-0.5">
                      {data.ledger.locations.length === 0 ? (data.lot.remainingQty > 0 ? "location not recorded" : "none left")
                        : data.ledger.locations.map((l: any) => `${qty(l.qty)} in ${l.code}`).join(" · ")}
                    </div>
                  </div>
                  <div className="px-3 py-2.5 bg-stone-950/40"><div className="text-[10px] uppercase tracking-wider text-stone-500">Value on hand</div><div className="text-[13px] font-semibold text-stone-100 tabular-nums mt-0.5">{money(data.lot.remainingQty * data.lot.unitCost)}</div><div className="text-[11px] text-stone-400 mt-0.5">of {money(declaredValue)} received</div></div>
                  <div className="px-3 py-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-stone-500">Reconciliation</div>
                    {manufactured ? (
                      <div className={`text-[13px] font-semibold mt-0.5 flex items-center gap-1 ${reconciled ? "text-emerald-400" : "text-amber-400"}`}>
                        {reconciled ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />} {reconciled ? "PASSED" : `REVIEW · off by ${money(Math.abs(totalCost - declaredValue))}`}
                      </div>
                    ) : (
                      <div className="text-[13px] font-semibold mt-0.5 text-stone-300">
                        {data.lot.sourceType === "purchase" ? "Bought at cost" : data.lot.sourceType === "opening" ? "Opening stock" : data.lot.sourceType === "adjustment" ? "Found in a count" : data.lot.sourceType}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {manufactured ? (<>
              <SectionCard n={1} title="Raw Material Procurement & Consumption" empty={data.rawMaterials.length === 0 ? "No purchased raw materials in this lot's ancestry — it may have been produced entirely from other manufactured/job-worked stock." : undefined}>
                <table className="w-full text-[13px] min-w-[760px]">
                  <thead><tr className={tableHead}>
                    <Th>Item</Th><Th r>Qty</Th><Th>UoM</Th><Th r>Rate</Th><Th r>Amount</Th><Th>Source / Reference</Th>
                  </tr></thead>
                  <tbody>
                    {data.rawMaterials.map((r: any, i: number) => (
                      <tr key={i} className="border-b border-stone-800/60">
                        <td className="px-4 py-2 text-stone-100 font-medium">{r.itemName}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-200">{qty(r.qty)}</td>
                        <td className="px-4 py-2 text-stone-400">{r.uom ?? ""}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-400">{money(r.rate)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-200">{money(r.amount)}</td>
                        <td className="px-4 py-2 text-stone-300">
                          <Truck size={11} className="inline mr-1 -mt-0.5 text-cyan-400" />
                          {r.supplierLabel ?? "—"}
                          {r.poNumber ? <> (<DocLink href={r.poId ? `/print/trade/purchase-orders/${r.poId}` : null}>{r.poNumber}</DocLink>{r.receiptNo ? <> / <DocLink href={r.receiptEntryId ? `/accounting/transactions/${r.receiptEntryId}` : null}>{r.receiptNo}</DocLink></> : null})</> : r.receiptNo ? <> (<DocLink href={r.receiptEntryId ? `/accounting/transactions/${r.receiptEntryId}` : null}>{r.receiptNo}</DocLink>)</> : null}
                          <div className="text-[11px] text-stone-500 mt-0.5">↳ {r.issuedTo}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {data.rawMaterials.length > 0 && (
                    <tfoot><tr className="border-t border-stone-700 bg-stone-950/40 font-semibold">
                      <td colSpan={4} className="px-4 py-2.5 text-stone-200">Total direct materials</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-stone-100">{money(rawTotal)}</td>
                      <td></td>
                    </tr></tfoot>
                  )}
                </table>
              </SectionCard>

              <SectionCard n={2} title="Subcontract Processing (Job Work)" empty={data.processing.length === 0 ? "No job-work processing steps in this lot's ancestry — it may have been produced entirely in-house." : undefined}>
                <table className="w-full text-[13px] min-w-[760px]">
                  <thead><tr className={tableHead}>
                    <Th>Order ID</Th><Th>Activity / Process</Th><Th r>Qty</Th><Th>UoM</Th><Th r>Rate</Th><Th r>Amount</Th><Th>Provider</Th><Th>Date</Th>
                  </tr></thead>
                  <tbody>
                    {data.processing.map((p: any, i: number) => {
                      const sharePct = p.orderTotalQty && p.orderTotalQty > 0 ? (p.qty / p.orderTotalQty) * 100 : null;
                      const shared = sharePct != null && sharePct < 99.95;
                      return (
                      <tr key={i} className="border-b border-stone-800/60">
                        <td className="px-4 py-2">
                          <DocLink mono href={p.entryId ? `/accounting/transactions/${p.entryId}` : null}>{p.orderId}</DocLink>
                          {shared && <div className="text-[10.5px] text-stone-500 mt-0.5">{sharePct!.toFixed(0)}% of order — shared across other builds</div>}
                          {p.orderWastagePct != null && <div className="text-[10.5px] text-amber-500/80 mt-0.5">Order had {Math.abs(p.orderWastagePct).toFixed(1)}% {p.orderWastagePct > 0 ? "wastage" : "yield gain"} written off</div>}
                        </td>
                        <td className="px-4 py-2 text-stone-300">{p.activity}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-200">{qty(p.qty)}</td>
                        <td className="px-4 py-2 text-stone-400">{p.uom ?? ""}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-400">{money(p.rate)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-200">{money(p.amount)}</td>
                        <td className="px-4 py-2 text-stone-300">{p.provider}</td>
                        <td className="px-4 py-2 text-stone-500">{fmt.shortDate(p.date)}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                  {data.processing.length > 0 && (
                    <tfoot><tr className="border-t border-stone-700 bg-stone-950/40 font-semibold">
                      <td colSpan={5} className="px-4 py-2.5 text-stone-200">Total conversion fees</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-stone-100">{money(processingTotal)}</td>
                      <td></td><td></td>
                    </tr></tfoot>
                  )}
                </table>
              </SectionCard>

              <SectionCard n={3} title="Cost Rollup Summary">
                <table className="w-full text-[13px] min-w-[560px]">
                  <thead><tr className={tableHead}>
                    <Th>Cost Element</Th><Th>Detail</Th><Th r>Amount</Th><Th r>Share</Th>
                  </tr></thead>
                  <tbody>
                    {data.costRollup.map((r: any, i: number) => {
                      const isTotal = r.label.startsWith("Total");
                      return (
                        <tr key={i} className={isTotal ? "border-t-2 border-stone-700 bg-stone-950/40 font-semibold" : "border-b border-stone-800/60"}>
                          <td className="px-4 py-2 text-stone-100">{r.label}</td>
                          <td className="px-4 py-2 text-stone-500">{r.detail}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-stone-100">{money(r.amount)}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-stone-400">{r.sharePct.toFixed(2)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </SectionCard>

              </>) : (
              <SectionCard n={1} title="Where this lot came from" empty={!data.lot.origin ? (data.lot.sourceType === "purchase" ? "No goods receipt is linked to this lot." : "This lot was created by a stock count or opening balance, so there is no supplier or purchase order behind it.") : undefined}>
                {data.lot.origin && (
                  <table className="w-full text-[13px] min-w-[560px]">
                    <thead><tr className={tableHead}>
                      <Th>Supplier</Th><Th>Purchase order</Th><Th>Goods receipt</Th><Th>Received</Th><Th r>Qty</Th><Th r>Unit cost</Th><Th r>Value</Th><Th>Received by</Th>
                    </tr></thead>
                    <tbody>
                      <tr className="border-b border-stone-800/60">
                        <td className="px-4 py-2 text-stone-100">{data.lot.origin.supplierLabel ?? "—"}</td>
                        <td className="px-4 py-2"><DocLink mono href={data.lot.origin.poId ? `/print/trade/purchase-orders/${data.lot.origin.poId}` : null}>{data.lot.origin.poNumber ?? "No PO"}</DocLink></td>
                        <td className="px-4 py-2"><DocLink mono href={data.lot.origin.receiptEntryId ? `/accounting/transactions/${data.lot.origin.receiptEntryId}` : null}>{data.lot.origin.receiptNo ?? "—"}</DocLink></td>
                        <td className="px-4 py-2 text-stone-400">{fmt.shortDate(data.lot.origin.date)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-200">{qty(data.lot.origin.qty)} {data.lot.baseUom ?? ""}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-400">{money(data.lot.origin.unitCost)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-100">{money(data.lot.origin.unitCost * data.lot.origin.qty)}</td>
                        <td className="px-4 py-2 text-stone-400">{data.lot.origin.receivedBy ?? "—"}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </SectionCard>
              )}

              <SectionCard n={manufactured ? 4 : 2} title="Stock movement" empty={data.ledger.rows.length === 0 ? "No stock movements are recorded for this lot." : undefined}>
                <table className="w-full text-[13px] min-w-[860px]">
                  <thead><tr className={tableHead}>
                    <Th>Date</Th><Th>Movement</Th><Th>Document</Th><Th r>In</Th><Th r>Out</Th><Th r>Balance</Th><Th r>Unit cost</Th><Th r>Value</Th><Th>By</Th>
                  </tr></thead>
                  <tbody>
                    {data.ledger.rows.map((m: any) => (
                      <tr key={m.id} className="border-b border-stone-800/60">
                        <td className="px-4 py-2 text-stone-500 whitespace-nowrap">{fmt.shortDate(m.date)}</td>
                        <td className="px-4 py-2 text-stone-200">{m.label}{m.note ? <div className="text-[11px] text-stone-500">{m.note}</div> : null}</td>
                        <td className="px-4 py-2"><DocLink mono href={m.entryId ? `/accounting/transactions/${m.entryId}` : null}>{m.docNumber ?? "—"}</DocLink></td>
                        <td className="px-4 py-2 text-right tabular-nums text-emerald-400">{m.qty > 0 ? qty(m.qty) : ""}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-rose-400">{m.qty < 0 ? qty(-m.qty) : ""}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-100 font-medium">{qty(m.balance)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-400">{m.unitCost == null ? "" : money(m.unitCost)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-300">{m.value == null ? "" : money(m.value)}</td>
                        <td className="px-4 py-2 text-stone-400">{m.by ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="border-t border-stone-700 bg-stone-950/40 font-semibold">
                    <td colSpan={5} className="px-4 py-2.5 text-stone-200">On hand now</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-emerald-400">{qty(data.lot.remainingQty)} {data.lot.baseUom ?? ""}</td>
                    <td colSpan={3} className={`px-4 py-2.5 text-[12px] ${Math.abs(data.ledger.difference) < 0.000001 ? "text-emerald-400" : "text-amber-400"}`}>
                      {Math.abs(data.ledger.difference) < 0.000001 ? "Movements add up to the lot's balance"
                        : `REVIEW · movements add up to ${qty(data.ledger.computedOnHand)}, off by ${qty(Math.abs(data.ledger.difference))}`}
                    </td>
                  </tr></tfoot>
                </table>
              </SectionCard>

              <SectionCard n={manufactured ? 5 : 3} title="What it became" empty={(data.usage ?? []).length === 0 ? `Nothing has been issued from this lot yet — all ${qty(data.lot.remainingQty)} ${data.lot.baseUom ?? ""} is still on hand.` : undefined}>
                <table className="w-full text-[13px] min-w-[560px]">
                  <thead><tr className={tableHead}>
                    <Th>What happened</Th><Th>Date</Th><Th r>Qty used</Th><Th>Made</Th><Th>By</Th>
                  </tr></thead>
                  <tbody>
                    {(data.usage ?? []).map((u: any, i: number) => (
                      <tr key={i} className="border-b border-stone-800/60">
                        <td className="px-4 py-2 text-stone-200">{u.label}</td>
                        <td className="px-4 py-2 text-stone-500">{fmt.shortDate(u.date)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-200">{qty(u.qty)} {data.lot.baseUom ?? ""}</td>
                        <td className="px-4 py-2 text-stone-300">
                          {u.producedLots.length === 0 ? "—" : u.producedLots.map((p: any) => (
                            <button key={p.id} onClick={() => setSelectedId(p.id)} className="mr-2 text-emerald-400 hover:underline">{p.itemName} <span className="font-mono">{p.lotNo ?? p.id.slice(0, 8)}</span></button>
                          ))}
                        </td>
                        <td className="px-4 py-2 text-stone-400">{u.by ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </SectionCard>

              <SectionCard n={manufactured ? 6 : 4} title="Outbound Commercial Distribution" empty={data.distribution.length === 0 ? "Not yet shipped/sold — still on hand or consumed internally only." : undefined}>
                <table className="w-full text-[13px] min-w-[760px]">
                  <thead><tr className={tableHead}>
                    <Th>Shipment</Th><Th>Invoice</Th><Th>Sold-To Customer</Th><Th>Item shipped</Th><Th r>Qty</Th><Th>UoM</Th><Th r>Unit Price</Th><Th r>Amount</Th><Th>Date</Th>
                  </tr></thead>
                  <tbody>
                    {data.distribution.map((d: any, i: number) => (
                      <tr key={i} className="border-b border-stone-800/60">
                        <td className="px-4 py-2"><DocLink mono href={d.shipmentEntryId ? `/accounting/transactions/${d.shipmentEntryId}` : null}>{d.shipmentNo ?? "—"}</DocLink></td>
                        <td className="px-4 py-2">{d.invoiceNo ? <DocLink href={d.invoiceEntryId ? `/accounting/transactions/${d.invoiceEntryId}` : null}>{d.invoiceNo}</DocLink> : "Not yet invoiced"}</td>
                        <td className="px-4 py-2 text-stone-200">{d.customerLabel ?? "—"}</td>
                        <td className="px-4 py-2 text-stone-300">
                          {d.itemName ?? "—"}{d.lotNo ? <span className="font-mono text-stone-500"> {d.lotNo}</span> : null}
                          {d.itemId && d.itemId !== data.lot.itemId ? <div className="text-[11px] text-stone-500">made from this lot</div> : null}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-200">{qty(d.qty)}</td>
                        <td className="px-4 py-2 text-stone-400">{d.uom ?? ""}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-400">{money(d.unitPrice)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-stone-100">{money(d.amount)}</td>
                        <td className="px-4 py-2 text-stone-500">{fmt.shortDate(d.date)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {data.distribution.length > 0 && (
                    <tfoot><tr className="border-t border-stone-700 bg-stone-950/40 font-semibold">
                      <td colSpan={7} className="px-4 py-2.5 text-stone-200">Total distributed</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-stone-100">{money(distributionTotal)}</td>
                      <td></td>
                    </tr></tfoot>
                  )}
                </table>
              </SectionCard>

              <div className="flex gap-8 px-1 pt-2 pb-4 text-[12px] text-stone-500">
                <div><span className="block text-stone-600 mb-3">Prepared by</span><span className="text-stone-200 font-medium">{data.operator ?? "—"}</span></div>
                <div><span className="block text-stone-600 mb-3">Reviewed by</span><span className="text-stone-400">—</span></div>
                <div><span className="block text-stone-600 mb-3">Approved by</span><span className="text-stone-400">—</span></div>
              </div>
            </>
          )}
        </div>
      )}
    </ReportShell>
  );
}
