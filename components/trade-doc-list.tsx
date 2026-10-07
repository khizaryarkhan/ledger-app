"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, RefreshCw, Check, ChevronDown, ChevronRight, Layers, Loader, Trash2, Printer, Download, Route } from "lucide-react";
import { controlCompact, tableHead, Drawer } from "@/components/form-kit";
import { fmt, formatDate } from "@/lib/format";
import {
  useListView, ListPage, ListPageHeader, ListToolbar, ListChips, ListScroll, ListHead, ListFoot,
  listTable, listRow, listMoneyCell, type ListColumn,
} from "@/components/list-view";

type Kind = "estimates" | "purchase-orders" | "sales-orders";
// `icon` was dropped: the shared ListPageHeader (unlike this file's old
// hand-rolled header) has no leading-icon slot — neither reference page
// (invoices, payables/purchase-orders) shows one either, so this isn't a
// regression, it's the same header shape every other converted list uses.
const META: Record<Kind, { title: string; singular: string; newType: string; convertTo: string; invoiceVerb: string; fulfil?: string }> = {
  "estimates":       { title: "Estimates",       singular: "estimate",       newType: "Estimate",     convertTo: "invoice", invoiceVerb: "Invoice" },
  "purchase-orders": { title: "Purchase Orders", singular: "purchase order", newType: "PurchaseOrder", convertTo: "bill",    invoiceVerb: "Bill" },
  // Sales Orders are fulfilled via Shipping (not converted directly), so the
  // convert action is hidden — see `canConvert` below.
  "sales-orders":    { title: "Sales Orders",    singular: "sales order",    newType: "SalesOrder",   convertTo: "",        invoiceVerb: "", fulfil: "/supply-chain/shipping" },
};
const linkType = (k: Kind) => k === "estimates" ? "Estimate" : k === "purchase-orders" ? "PurchaseOrder" : "SalesOrder";

/** Kept for the modal's own internal figures (running total, remaining-amount
 *  messages) — those aren't part of the shared list table, so they keep the
 *  plain 2dp display this file always used rather than adopting fmt.money
 *  everywhere. The list table itself (below) uses fmt.money, to read
 *  consistently with the toolbar/footer totals the shared list shell draws
 *  from the same `money` column definition. */
const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface DocRow {
  id: string;
  docNumber: string | null;
  partyLabel: string | null;
  issueDate: string;
  expiryDate: string | null;
  currency: string | null;
  total: number;
  status: "Open" | "Partial" | "Closed";
  invoicedNet: number;
  netTotal: number;
  remainingNet: number;
  pct: number;
  salesOrderId: string | null;
}

function buildColumns(kind: Kind): ListColumn<DocRow>[] {
  const meta = META[kind];
  const partyLabel = kind === "purchase-orders" ? "Supplier" : "Customer";
  return [
    { key: "docNumber", label: "Number", sort: r => r.docNumber ?? "" },
    { key: "party", label: partyLabel, sort: r => r.partyLabel ?? "", filter: { kind: "multi", value: r => r.partyLabel } },
    { key: "issueDate", label: "Date", sort: r => r.issueDate },
    { key: "total", label: "Total", sort: r => Number(r.total ?? 0), descFirst: true, align: "right",
      money: r => ({ amount: Number(r.total ?? 0), currency: r.currency }) },
    // The one visible column doubles as the status filter — Open/Partial/Closed
    // isn't shown as its own badge column (the progress bar + remaining-amount
    // line already carries that information visually, as it always has), but
    // filtering by the underlying status is still useful, so it hangs off this
    // column rather than adding a column the table never used to have.
    { key: "progress", label: meta.fulfil ? "Fulfilment" : `${meta.invoiceVerb}d`, sort: r => r.pct,
      filter: { kind: "multi", value: r => r.status } },
  ];
}

export function TradeDocList({ kind }: { kind: Kind }) {
  const meta = META[kind];
  const [rows, setRows] = useState<DocRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, any[]>>({});
  const [modal, setModal] = useState<any | null>(null);

  async function load() {
    const r = await fetch(`/api/trade-documents/${kind}`).then(x => x.json()).catch(() => []);
    setRows(Array.isArray(r) ? r : []);
  }
  useEffect(() => { setRows(null); setMsg(""); setExpanded(null); setLinks({}); load(); }, [kind]);

  async function invoiceFull(id: string) {
    if (!confirm(`Create a ${meta.convertTo} for the full remaining amount?`)) return;
    setBusyId(id); setMsg("");
    try {
      const res = await fetch(`/api/trade-documents/${kind}/${id}/convert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Failed"); return; }
      setMsg(`Created ${meta.convertTo} ${d.docNumber ?? ""} · TXN-${String(d.txnNo ?? 0).padStart(6, "0")}${d.status === "Closed" ? " — fully invoiced." : ` — ${money(d.remainingNet)} still remaining.`}`);
      await load(); if (expanded === id) openLinks(id, true);
    } finally { setBusyId(null); }
  }

  async function del(id: string, no: string) {
    if (!confirm(`Delete ${meta.singular} ${no || ""}? This can't be undone.`)) return;
    setBusyId(id); setMsg("");
    try {
      const res = await fetch(`/api/trade-documents/${kind}/${id}`, { method: "DELETE" });
      if (!res.ok) { setMsg((await res.json().catch(() => ({})))?.error || "Could not delete."); return; }
      await load();
    } finally { setBusyId(null); }
  }

  async function openLinks(id: string, force = false) {
    if (!force && expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    const l = await fetch(`/api/transactions/links?type=${linkType(kind)}&id=${id}`).then(r => r.json()).catch(() => []);
    setLinks(m => ({ ...m, [id]: Array.isArray(l) ? l : [] }));
  }

  const columns = buildColumns(kind);
  const lv = useListView(rows ?? [], columns, { storageKey: `trade-docs-${kind}`, summary: "total" });

  const titleLower = meta.title.toLowerCase();
  return (
    <ListPage>
      <ListPageHeader title={meta.title}
        subtitle={rows === null ? "Loading…" : `${lv.rows.length} ${lv.rows.length === 1 ? meta.singular : `${meta.singular}s`}`}>
        <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh">
          <RefreshCw size={15} className={rows === null ? "animate-spin" : ""} />
        </button>
        <Link href={`/accounting/new/${meta.newType}`} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700">
          <Plus size={14} /> New {meta.singular}
        </Link>
      </ListPageHeader>

      {msg && (
        <div className="mx-4 mt-3 text-[12px] text-emerald-400 inline-flex items-center gap-1.5 bg-emerald-950/30 border border-emerald-900 rounded-lg px-3 py-2 w-fit shrink-0">
          <Check size={13} /> {msg}
        </div>
      )}

      <ListToolbar lv={lv} noun={meta.singular} />
      <ListChips lv={lv} />

      {rows === null ? (
        <div className="flex-1 overflow-auto p-5 space-y-2">
          {[...Array(6)].map((_, i) => <div key={i} className="animate-pulse bg-stone-800 rounded h-10 w-full" />)}
        </div>
      ) : (
        <ListScroll lv={lv} empty={rows.length === 0
          ? `No ${titleLower} yet — create one with the New button.`
          : `No ${titleLower} match the current filters.`}>
          <table className={listTable}>
            <ListHead lv={lv} trailing={1} />
            <tbody>
              {lv.rows.map(r => (
                <Fragment key={r.id}>
                  <tr className={listRow(false)}>
                    <td className="px-2 py-2">
                      <button onClick={() => openLinks(r.id)} className="inline-flex items-center gap-1.5 text-stone-300 hover:text-white">
                        {expanded === r.id ? <ChevronDown size={13} className="text-stone-600 shrink-0" /> : <ChevronRight size={13} className="text-stone-600 shrink-0" />}
                        <span className="font-mono text-[12px]">{r.docNumber}</span>
                      </button>
                    </td>
                    <td className="px-2 py-2 text-stone-200">{r.partyLabel || "—"}</td>
                    <td className="px-2 py-2 text-stone-400">{formatDate(r.issueDate)}</td>
                    <td className={listMoneyCell}><span className="text-stone-200 text-[13px] font-medium">{fmt.money(r.total, r.currency ?? undefined)}</span></td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-stone-800 overflow-hidden min-w-[60px]">
                          <div className={`h-full ${r.pct >= 100 ? "bg-emerald-500" : "bg-teal-500"}`} style={{ width: `${Math.min(100, r.pct)}%` }} />
                        </div>
                        <span className="text-[11px] text-stone-500 tabular-nums w-9 text-right">{r.pct}%</span>
                      </div>
                      {r.remainingNet > 0.005 && <div className="text-[10px] text-stone-600 mt-0.5">{money(r.remainingNet)} remaining</div>}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        {kind === "sales-orders" && (
                          <Link href={`/accounting/trade/sales-orders/${r.id}`} className="text-[11px] font-medium text-sky-400 hover:text-sky-300 inline-flex items-center gap-1" title="Track this order's progress"><Route size={12} /> Track</Link>
                        )}
                        {meta.fulfil ? (
                          <Link href={meta.fulfil} className="text-[11px] font-medium text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1">Fulfil in Shipping →</Link>
                        ) : r.status !== "Closed" ? (
                          <>
                            <button onClick={() => setModal(r)} disabled={busyId === r.id} className="text-[11px] font-medium text-teal-400 hover:text-teal-300 inline-flex items-center gap-1 disabled:opacity-50"><Layers size={12} /> Partial…</button>
                            <button onClick={() => invoiceFull(r.id)} disabled={busyId === r.id} className="text-[11px] font-medium bg-stone-800 hover:bg-stone-700 text-stone-200 rounded px-2 py-1 disabled:opacity-50">{meta.invoiceVerb} remaining</button>
                          </>
                        ) : (
                          <span className="text-[10px] font-medium border rounded-full px-2 py-0.5 bg-emerald-500/12 text-emerald-400 border-emerald-800/50">Fully {meta.invoiceVerb.toLowerCase()}d</span>
                        )}
                        <a href={`/api/print/pdf?kind=trade&id=${r.id}`}
                          className="p-1 rounded hover:bg-stone-700 text-stone-600 hover:text-stone-200" title={`Download ${meta.singular} PDF`}><Download size={12} /></a>
                        <a href={`/print/trade/${kind}/${r.id}`} target="_blank" rel="noopener noreferrer"
                          className="p-1 rounded hover:bg-stone-700 text-stone-600 hover:text-stone-200" title={`Print ${meta.singular} (browser print dialog)`}><Printer size={12} /></a>
                        <button onClick={() => del(r.id, r.docNumber ?? "")} disabled={busyId === r.id} className="p-1 rounded hover:bg-stone-700 text-stone-600 hover:text-rose-400 disabled:opacity-50" title={`Delete ${meta.singular}`}><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr className="bg-stone-950/40 border-b border-stone-800/60">
                      <td colSpan={lv.columns.length + 1} className="px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wider text-stone-600 mb-1">Related transactions</div>
                        {!links[r.id] ? <div className="text-[12px] text-stone-500 inline-flex items-center gap-1"><Loader size={11} className="animate-spin" /> Loading…</div>
                          : links[r.id].length === 0 ? <div className="text-[12px] text-stone-600">No linked documents yet.</div>
                          : (
                            <div className="space-y-1">
                              {links[r.id].map((lk, i) => (
                                <div key={i} className="flex items-center gap-3 text-[12px]">
                                  <span className="text-stone-500 w-24">{lk.relation === "progress_invoice" ? "Invoiced" : lk.relation === "po_bill" ? "Billed" : lk.relation === "po_receipt" ? "Received" : lk.relation}</span>
                                  <span className="font-mono text-stone-300">{lk.docNumber}</span>
                                  <span className="text-stone-500">{lk.type}</span>
                                  <span className="text-stone-400">{lk.date}</span>
                                  <span className="tabular-nums text-stone-300 ml-auto">{money(lk.linkedAmount)}</span>
                                  <Link href="/accounting/journal" className="text-teal-400 hover:text-teal-300">view</Link>
                                </div>
                              ))}
                            </div>
                          )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
            {lv.rows.length > 0 && <ListFoot lv={lv} noun={meta.singular} trailing={1} />}
          </table>
        </ListScroll>
      )}

      {modal && <ProgressModal kind={kind} meta={meta} doc={modal} onClose={() => setModal(null)} onDone={(m: string) => { setModal(null); setMsg(m); load(); if (expanded === modal.id) openLinks(modal.id, true); }} />}
    </ListPage>
  );
}

function ProgressModal({ kind, meta, doc, onClose, onDone }: any) {
  const [lines, setLines] = useState<any[] | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [pct, setPct] = useState("100");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`/api/trade-documents/${kind}/${doc.id}/lines`).then(r => r.json()).then((ls: any[]) => {
      setLines(ls);
      const init: Record<string, string> = {};
      ls.forEach(l => { init[l.id] = l.remaining > 0 ? String(l.remaining) : "0"; });
      setAmounts(init);
    }).catch(() => setLines([]));
  }, [kind, doc.id]);

  function applyPct(p: string) {
    setPct(p);
    const f = Math.max(0, Math.min(100, Number(p) || 0)) / 100;
    const next: Record<string, string> = {};
    (lines ?? []).forEach(l => { next[l.id] = (Math.round(l.remaining * f * 100) / 100).toString(); });
    setAmounts(next);
  }

  const total = (lines ?? []).reduce((s, l) => s + (Number(amounts[l.id]) || 0), 0);

  async function submit() {
    setBusy(true); setErr("");
    try {
      const payload = { lines: (lines ?? []).map(l => ({ lineId: l.id, amount: Number(amounts[l.id]) || 0 })).filter(x => x.amount > 0) };
      if (payload.lines.length === 0) { setErr("Enter an amount to invoice."); return; }
      const res = await fetch(`/api/trade-documents/${kind}/${doc.id}/convert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || "Failed"); return; }
      onDone(`Created ${meta.convertTo} ${d.docNumber ?? ""} · TXN-${String(d.txnNo ?? 0).padStart(6, "0")}${d.status === "Closed" ? " — fully invoiced." : ` — ${money(d.remainingNet)} still remaining.`}`);
    } finally { setBusy(false); }
  }

  const input = controlCompact + " text-right tabular-nums";
  return (
    <Drawer
      size="xl"
      onClose={onClose}
      title={`${meta.invoiceVerb} ${doc.docNumber}`}
      subtitle={`Choose how much of each line to ${meta.convertTo === "invoice" ? "invoice" : "bill"} now — the rest stays open for later.`}
      // The running total belongs beside the action, not under the last line:
      // on a document with many lines it is the figure you are deciding on, so
      // it stays in view while the table scrolls.
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-[13px] text-stone-300">This {meta.convertTo}: <span className="font-semibold text-white tabular-nums">{money(total)}</span> <span className="text-stone-600 text-[11px]">(before tax)</span></div>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="text-[13px] text-stone-500 hover:text-stone-300">Cancel</button>
            <button onClick={submit} disabled={busy} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold disabled:opacity-50 inline-flex items-center gap-2">
              {busy ? <Loader size={14} className="animate-spin" /> : <Check size={15} />} Create {meta.convertTo}
            </button>
          </div>
        </div>
      }
    >
          {err && <div className="mb-3 text-[12px] text-rose-400">{err}</div>}
          <div className="flex items-center gap-2 mb-3 text-[12px] text-stone-400">
            Quick fill:
            <input type="number" min="0" max="100" value={pct} onChange={e => applyPct(e.target.value)} className={`${controlCompact} w-16 text-right tabular-nums`} />% of remaining
            <button onClick={() => applyPct("100")} className="text-teal-400 hover:text-teal-300 ml-1">all</button>
          </div>
          {!lines ? <div className="text-[12px] text-stone-500 inline-flex items-center gap-1"><Loader size={12} className="animate-spin" /> Loading…</div> : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className={tableHead}>
                  <th className="text-left py-2">Line</th>
                  <th className="text-right py-2 w-28">Remaining</th>
                  <th className="text-right py-2 w-32">{meta.invoiceVerb} now</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(l => (
                  <tr key={l.id} className="border-b border-stone-800/50">
                    <td className="py-2 text-stone-200">{l.description || <span className="text-stone-600">(no description)</span>}</td>
                    <td className="py-2 text-right tabular-nums text-stone-400">{money(l.remaining)}</td>
                    <td className="py-2 text-right"><input type="number" step="0.01" min="0" max={l.remaining} value={amounts[l.id] ?? ""} onChange={e => setAmounts(a => ({ ...a, [l.id]: e.target.value }))} className={`${input} w-28`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
    </Drawer>
  );
}
