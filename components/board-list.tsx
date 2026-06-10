"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { STAGE_COLOR_CLASSES, Stage } from "@/lib/stages";
import { fmt } from "@/lib/format";
import { Send, X, AlertTriangle, CalendarClock, AlertOctagon, Check, Pencil, Download, MessageSquare, FileText } from "lucide-react";
import { useSession } from "next-auth/react";
import { genEmailRef } from "@/lib/email-ref";
import { renderInvoiceEmail } from "@/lib/ar-email";

export type BoardRow = {
  inv: any;
  custId: string;
  custName: string;
  projName: string | null;
  regionName: string | null;
  repName: string | null;
  stageLabel: string;
  bal: number;
  days: number;
  email: string | null;
  lastSent: string | null; // ISO date of last outbound email, or null
  lastRef: string | null;  // reference number of the last outbound email
};

const DISPUTE_CATEGORIES = ["Wrong Amount", "Already Paid", "Goods/Service", "Duplicate", "Other"];
const todayStr = () => new Date().toISOString().slice(0, 10);
const uniqEmails = (vals: (string | null)[]) => {
  const set = new Set<string>();
  vals.forEach(v => (v || "").split(/[,;]/).map(e => e.trim().toLowerCase()).filter(e => e.includes("@")).forEach(e => set.add(e)));
  return [...set];
};

export function BoardList({ rows, stages, updateInvoice, refresh, toast, ccy, comments = [] }: {
  rows: BoardRow[];
  stages: Stage[];
  updateInvoice: (id: string, patch: any) => Promise<any>;
  refresh: () => Promise<any> | void;
  toast?: (m: string, t?: string) => void;
  ccy: string;
  comments?: any[];
}) {
  const { data: session } = useSession();
  const userName = (session?.user?.name as string) || "User";
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [notesOpenId, setNotesOpenId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  // Notes grouped by invoice, newest first.
  // Includes internal notes (channel="Note") AND inbound customer responses
  // from the portal (channel="Portal") so the team sees what customers said
  // — promise notes and queries — right in the board Notes column.
  const notesByInv = useMemo(() => {
    const m: Record<string, any[]> = {};
    (comments ?? []).forEach((c: any) => {
      if ((c.channel !== "Note" && c.channel !== "Portal") || !c.invoiceId) return;
      (m[c.invoiceId] ??= []).push(c);
    });
    Object.values(m).forEach(list => list.sort((a, b) => new Date(b.sentAt ?? b.createdAt).getTime() - new Date(a.sentAt ?? a.createdAt).getTime()));
    return m;
  }, [comments]);

  async function addNote(row: BoardRow) {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      await fetch("/api/communications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: row.custId, invoiceId: row.inv.id, projectId: row.inv.projectId ?? null,
          direction: "Outbound", channel: "Note", subject: "Internal note",
          body: noteText.trim(), sender: userName, matchedBy: "Manual",
        }),
      });
      setNoteText(""); await refresh();
    } finally { setSavingNote(false); }
  }
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  async function downloadPdfs() {
    if (selected.size === 0) return;
    setDownloadingPdf(true);
    try {
      const res = await fetch("/api/invoices/download-pdfs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds: [...selected] }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast?.(d.error || "Failed to download PDFs", "error");
        return;
      }
      const skipped = Number(res.headers.get("X-Skipped-Count") ?? 0);
      const blob = await res.blob();
      const cd   = res.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? "invoices.zip";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      if (skipped > 0) toast?.(`${skipped} invoice(s) skipped — not found in QuickBooks`, "error");
    } finally { setDownloadingPdf(false); }
  }

  const [busyId, setBusyId] = useState<string | null>(null);
  const [respEdit, setRespEdit] = useState<{ id: string; mode: "promise" | "dispute" } | null>(null);
  // Optimistic response overrides per invoice (instant UI feedback until refetch)
  const [opt, setOpt] = useState<Record<string, { hasOpenDispute?: boolean; promiseDate?: string | null; disputeReason?: string | null }>>({});
  const [rDate, setRDate] = useState(""); const [rCat, setRCat] = useState(DISPUTE_CATEGORIES[0]); const [rReason, setRReason] = useState("");
  const [emailEdit, setEmailEdit] = useState<string | null>(null);
  const [emailVal, setEmailVal] = useState("");
  const [showSend, setShowSend] = useState(false);

  // ── Per-column filters ──────────────────────────────────────────────────
  const [cf, setCf] = useState<Record<string, string>>({});
  const setFilter = (k: string, v: string) => setCf(p => ({ ...p, [k]: v }));
  const distinct = (vals: (string | null)[]) => [...new Set(vals.filter(Boolean) as string[])].sort();
  const regionOpts = useMemo(() => distinct(rows.map(r => r.regionName)), [rows]);
  const repOpts    = useMemo(() => distinct(rows.map(r => r.repName)), [rows]);
  const stageOpts  = useMemo(() => distinct(rows.map(r => r.stageLabel)), [rows]);

  const filteredRows = useMemo(() => {
    const has = (v: string | null, q: string) => (v ?? "").toLowerCase().includes(q.toLowerCase());
    return rows.filter(r => {
      if (overdueOnly && r.days <= 0) return false;
      if (cf.invoice && !has(r.inv.invoiceNumber, cf.invoice)) return false;
      if (cf.customer && !has(r.custName, cf.customer)) return false;
      if (cf.project && !has(r.projName, cf.project)) return false;
      if (cf.region && r.regionName !== cf.region) return false;
      if (cf.rep && r.repName !== cf.rep) return false;
      if (cf.stage && r.stageLabel !== cf.stage) return false;
      if (cf.response) {
        const resp = r.inv.hasOpenDispute ? "Disputed" : r.inv.promiseDate ? "Promised" : "None";
        if (resp !== cf.response) return false;
      }
      if (cf.email === "has" && !r.email) return false;
      if (cf.email === "none" && r.email) return false;
      if (cf.lastSent === "sent" && !r.lastSent) return false;
      if (cf.lastSent === "never" && r.lastSent) return false;
      if (cf.lastRef && !has(r.lastRef, cf.lastRef)) return false;
      if (cf.due && !has(r.inv.dueDate, cf.due)) return false;
      if (cf.minAmount && r.bal < Number(cf.minAmount)) return false;
      return true;
    });
  }, [rows, cf, overdueOnly]);

  const stageLabels = stages.filter(s => s.visible).map(s => s.label);
  const stageColor = (label: string) => STAGE_COLOR_CLASSES[stages.find(s => s.label === label)?.color ?? "stone"]?.badge ?? "bg-stone-100 text-stone-700";
  const fmtSent = (d: string | null) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }) : null;

  const allSelected = filteredRows.length > 0 && filteredRows.every(r => selected.has(r.inv.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(filteredRows.map(r => r.inv.id)));
  const toggleOne = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selectedRows = useMemo(() => rows.filter(r => selected.has(r.inv.id)), [rows, selected]);
  const anyFilter = Object.values(cf).some(Boolean);

  const thCls = "px-3 py-2.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider whitespace-nowrap";
  const inputCls = "w-full text-[11px] border border-stone-700 rounded px-1.5 py-1 bg-stone-800 text-stone-300 outline-none focus:ring-1 focus:ring-emerald-500";
  const selectedCustomers = useMemo(() => new Set(selectedRows.map(r => r.custId)), [selectedRows]);
  const selectedTotal = selectedRows.reduce((s, r) => s + r.bal, 0);

  async function save(id: string, patch: any) {
    setBusyId(id);
    try { await updateInvoice(id, patch); await refresh(); }
    finally { setBusyId(null); }
  }

  async function postResponse(id: string, payload: any) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/invoices/${id}/response`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast?.(d.error || `Update failed (${res.status})`, "error");
        return;
      }
      // Optimistic: reflect the change instantly, then reconcile with the refetch
      const override = payload.type === "clear"
        ? { hasOpenDispute: false, promiseDate: null, disputeReason: null }
        : payload.type === "promise"
        ? { hasOpenDispute: false, promiseDate: payload.promiseDate, disputeReason: null }
        : { hasOpenDispute: true, disputeReason: payload.reason ?? "Disputed" };
      setOpt(prev => ({ ...prev, [id]: override }));
      await refresh();
      setOpt(prev => { const n = { ...prev }; delete n[id]; return n; });
    } catch (e: any) {
      toast?.(e?.message || "Network error", "error");
    } finally { setBusyId(null); }
  }

  async function submitResponse() {
    if (!respEdit) return;
    if (respEdit.mode === "promise") {
      if (!rDate) return;
      await postResponse(respEdit.id, { type: "promise", promiseDate: rDate });
    } else {
      await postResponse(respEdit.id, { type: "dispute", category: rCat, reason: rReason });
    }
    setRespEdit(null); setRDate(""); setRReason("");
  }

  async function clearResponse(id: string) {
    await postResponse(id, { type: "clear" });
    setRespEdit(null);
  }

  // Export selected (or all filtered) rows to an Excel-compatible CSV.
  function exportExcel() {
    const src = selected.size ? rows.filter(r => selected.has(r.inv.id)) : filteredRows;
    const headers = ["Invoice", "Customer", "Project", "Region", "Rep", "Stage", "Response", "Email", "Last sent", "Last ref", "Due", "Days overdue", "Outstanding"];
    const esc = (v: any) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [headers.join(",")];
    src.forEach(r => {
      const resp = r.inv.hasOpenDispute ? `Disputed${r.inv.disputeReason ? ": " + r.inv.disputeReason : ""}`
        : r.inv.promiseDate ? `Promised ${r.inv.promiseDate}` : "";
      lines.push([
        r.inv.invoiceNumber, r.custName, r.projName ?? "", r.regionName ?? "", r.repName ?? "",
        r.stageLabel, resp, r.email ?? "", r.lastSent ? fmtSent(r.lastSent) : "", r.lastRef ?? "",
        r.inv.dueDate, r.days > 0 ? r.days : 0, r.bal,
      ].map(esc).join(","));
    });
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `collections-${todayStr()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Selection action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-stone-900 text-white flex-wrap">
          <span className="text-sm font-medium">{selected.size} selected · {fmt.money(selectedTotal, ccy)}</span>
          {selectedCustomers.size > 1 && (
            <span className="flex items-center gap-1.5 text-[12px] text-amber-300 bg-amber-500/15 px-2 py-1 rounded">
              <AlertTriangle size={13} /> {selectedCustomers.size} different customers selected — a single email would mix them
            </span>
          )}
          <div className="flex-1" />
          <button onClick={() => setSelected(new Set())} className="text-stone-400 hover:text-white p-1"><X size={15} /></button>
          <button onClick={() => setShowSend(true)}
            className="flex items-center gap-1.5 bg-white text-stone-900 text-sm font-semibold px-3 py-1.5 rounded-md hover:bg-stone-100">
            <Send size={14} /> Send
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-stone-800 bg-stone-900 shrink-0">
        <span className="text-[12px] text-stone-400">
          {filteredRows.length} invoice{filteredRows.length !== 1 ? "s" : ""}{anyFilter || overdueOnly ? " (filtered)" : ""}{selected.size ? ` · ${selected.size} selected` : ""}
        </span>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button onClick={downloadPdfs} disabled={downloadingPdf}
              className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-white border border-emerald-700 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-md px-2.5 py-1.5 transition-colors disabled:opacity-50">
              {downloadingPdf
                ? <><span className="inline-block w-3 h-3 border-2 border-emerald-400/40 border-t-emerald-400 rounded-full animate-spin" /> Downloading…</>
                : <><FileText size={13} /> Download PDFs ({selected.size})</>
              }
            </button>
          )}
          <button onClick={() => setOverdueOnly(v => !v)}
            className={`flex items-center gap-1.5 text-xs font-medium rounded-md px-2.5 py-1.5 border transition-colors ${overdueOnly ? "bg-rose-600 text-white border-rose-600" : "text-stone-400 border-stone-700 hover:bg-stone-800"}`}>
            <AlertTriangle size={13} /> Overdue only
          </button>
          <button onClick={exportExcel}
            className="flex items-center gap-1.5 text-xs font-medium text-stone-400 hover:text-white border border-stone-700 rounded-md px-2.5 py-1.5 hover:bg-stone-800">
            <Download size={13} /> Export to Excel{selected.size ? ` (${selected.size})` : ""}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="text-center text-sm text-stone-400 py-16">No open invoices match the current filters.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-stone-900 z-10">
              <tr className="border-b border-stone-800 text-left">
                <th className="px-3 py-2.5 w-10"><input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-stone-300 cursor-pointer" /></th>
                {["Invoice", "Customer", "Project", "Region", "Rep", "Stage", "Response", "Email", "Last sent", "Last ref", "Due"].map(h => (
                  <th key={h} className={thCls}>{h}</th>
                ))}
                <th className="px-3 py-2.5 text-[11px] font-semibold text-stone-500 uppercase tracking-wider text-right">Outstanding</th>
                <th className={`${thCls} text-center`}>Notes</th>
              </tr>
              {/* Per-column filter row */}
              <tr className="border-b border-stone-800 bg-stone-900/60">
                <th className="px-2 py-1.5 align-top">
                  {anyFilter && <button onClick={() => setCf({})} title="Clear filters" className="text-stone-400 hover:text-rose-600"><X size={13} /></button>}
                </th>
                <th className="px-2 py-1.5"><input value={cf.invoice ?? ""} onChange={e => setFilter("invoice", e.target.value)} placeholder="#" className={inputCls} /></th>
                <th className="px-2 py-1.5"><input value={cf.customer ?? ""} onChange={e => setFilter("customer", e.target.value)} placeholder="Filter" className={inputCls} /></th>
                <th className="px-2 py-1.5"><input value={cf.project ?? ""} onChange={e => setFilter("project", e.target.value)} placeholder="Filter" className={inputCls} /></th>
                <th className="px-2 py-1.5">
                  <select value={cf.region ?? ""} onChange={e => setFilter("region", e.target.value)} className={inputCls}>
                    <option value="">All</option>{regionOpts.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </th>
                <th className="px-2 py-1.5">
                  <select value={cf.rep ?? ""} onChange={e => setFilter("rep", e.target.value)} className={inputCls}>
                    <option value="">All</option>{repOpts.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </th>
                <th className="px-2 py-1.5">
                  <select value={cf.stage ?? ""} onChange={e => setFilter("stage", e.target.value)} className={inputCls}>
                    <option value="">All</option>{stageOpts.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </th>
                <th className="px-2 py-1.5">
                  <select value={cf.response ?? ""} onChange={e => setFilter("response", e.target.value)} className={inputCls}>
                    <option value="">All</option><option value="Disputed">Disputed</option><option value="Promised">Promised</option><option value="None">No response</option>
                  </select>
                </th>
                <th className="px-2 py-1.5">
                  <select value={cf.email ?? ""} onChange={e => setFilter("email", e.target.value)} className={inputCls}>
                    <option value="">All</option><option value="has">Has email</option><option value="none">No email</option>
                  </select>
                </th>
                <th className="px-2 py-1.5">
                  <select value={cf.lastSent ?? ""} onChange={e => setFilter("lastSent", e.target.value)} className={inputCls}>
                    <option value="">All</option><option value="sent">Sent</option><option value="never">Never sent</option>
                  </select>
                </th>
                <th className="px-2 py-1.5"><input value={cf.lastRef ?? ""} onChange={e => setFilter("lastRef", e.target.value)} placeholder="Ref" className={inputCls} /></th>
                <th className="px-2 py-1.5"><input value={cf.due ?? ""} onChange={e => setFilter("due", e.target.value)} placeholder="YYYY-MM" className={inputCls} /></th>
                <th className="px-2 py-1.5"><input type="number" value={cf.minAmount ?? ""} onChange={e => setFilter("minAmount", e.target.value)} placeholder="≥ €" className={`${inputCls} text-right`} /></th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(({ inv, custName, projName, regionName, repName, stageLabel, bal, days, email, lastSent, lastRef }) => {
                const isSel = selected.has(inv.id);
                const editingResp = respEdit?.id === inv.id;
                return (
                  <tr key={inv.id} className={`border-b border-stone-800 hover:bg-stone-800/50 ${isSel ? "bg-emerald-500/10" : ""}`}>
                    <td className="px-3 py-2"><input type="checkbox" checked={isSel} onChange={() => toggleOne(inv.id)} className="rounded border-stone-300 cursor-pointer" /></td>
                    <td className="px-3 py-2"><Link href={`/invoices/${inv.id}`} className="font-mono text-[12px] text-stone-300 hover:text-white hover:underline">#{inv.invoiceNumber}</Link></td>
                    <td className="px-3 py-2 text-white max-w-[180px] truncate" title={custName}>{custName}</td>
                    <td className="px-3 py-2 text-stone-400 text-[12px] max-w-[160px] truncate" title={projName ?? ""}>{projName ?? "—"}</td>
                    <td className="px-3 py-2 text-stone-400 text-[12px]">{regionName ?? "—"}</td>
                    <td className="px-3 py-2 text-stone-400 text-[12px]">{repName ?? "—"}</td>

                    {/* Stage dropdown */}
                    <td className="px-3 py-2">
                      <select value={stageLabel} disabled={busyId === inv.id}
                        onChange={e => save(inv.id, { collectionStage: e.target.value })}
                        className={`text-[11px] font-medium rounded px-1.5 py-1 border-0 cursor-pointer focus:ring-2 focus:ring-stone-300 ${stageColor(stageLabel)}`}>
                        {!stageLabels.includes(stageLabel) && <option value={stageLabel}>{stageLabel}</option>}
                        {stageLabels.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>

                    {/* Response (editable) */}
                    <td className="px-3 py-2 min-w-[200px]">
                      {(() => {
                        // Always use effective (optimistic) values so UI is instant
                        const o = opt[inv.id] || {};
                        const effDispute = o.hasOpenDispute ?? inv.hasOpenDispute;
                        const effPromise = "promiseDate" in o ? o.promiseDate : inv.promiseDate;
                        const effReason  = o.disputeReason ?? inv.disputeReason;

                        if (editingResp) return (
                          <div className="flex flex-col gap-1.5 bg-stone-800 border border-stone-700 rounded-lg p-2">
                            <div className="flex gap-1">
                              <button onClick={() => setRespEdit({ id: inv.id, mode: "promise" })} className={`flex-1 text-[10px] py-1 rounded ${respEdit!.mode === "promise" ? "bg-blue-600 text-white" : "bg-stone-700 text-stone-400"}`}>📅 Promise</button>
                              <button onClick={() => setRespEdit({ id: inv.id, mode: "dispute" })} className={`flex-1 text-[10px] py-1 rounded ${respEdit!.mode === "dispute" ? "bg-rose-600 text-white" : "bg-stone-700 text-stone-400"}`}>⚠️ Dispute</button>
                            </div>
                            {respEdit!.mode === "promise" ? (
                              <input type="date" min={todayStr()} value={rDate} onChange={e => setRDate(e.target.value)} className="text-[12px] border border-stone-700 rounded px-1.5 py-1 bg-stone-900 text-stone-300" />
                            ) : (
                              <>
                                <select value={rCat} onChange={e => setRCat(e.target.value)} className="text-[12px] border border-stone-700 rounded px-1.5 py-1 bg-stone-900 text-stone-300">
                                  {DISPUTE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                                <input value={rReason} onChange={e => setRReason(e.target.value)} placeholder="Reason" className="text-[12px] border border-stone-700 rounded px-1.5 py-1 bg-stone-900 text-stone-300 placeholder-stone-600" />
                              </>
                            )}
                            <div className="flex items-center justify-between gap-1">
                              {/* Use effective values — not raw inv — to avoid stale state */}
                              {(effDispute || effPromise) ? (
                                <button onClick={() => clearResponse(inv.id)} disabled={busyId === inv.id}
                                  className="text-[11px] font-medium text-emerald-700 hover:text-emerald-800 disabled:opacity-50">
                                  {effDispute ? "✓ Resolve" : "✕ Clear"}
                                </button>
                              ) : <span />}
                              <div className="flex gap-1">
                                <button onClick={() => setRespEdit(null)} className="text-[11px] text-stone-500 px-2 py-0.5">Cancel</button>
                                <button onClick={submitResponse} disabled={busyId === inv.id} className="text-[11px] font-semibold text-white bg-stone-900 rounded px-2 py-0.5 disabled:opacity-50">Save</button>
                              </div>
                            </div>
                          </div>
                        );

                        // Collapsed view — badge + edit pencil
                        // Disputed badge also shows inline Resolve to avoid the extra click
                        return (
                          <div className="group inline-flex items-center gap-1">
                            {effDispute ? (
                              <>
                                <button onClick={() => clearResponse(inv.id)} disabled={busyId === inv.id}
                                  title={effReason || "Click to resolve"}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 font-semibold inline-flex items-center gap-1 hover:bg-rose-500/25 disabled:opacity-50">
                                  <AlertOctagon size={10} /> Disputed
                                </button>
                                <span className="text-[10px] text-emerald-600 opacity-0 group-hover:opacity-100 font-medium">click to resolve</span>
                              </>
                            ) : effPromise ? (
                              <button onClick={() => { setRespEdit({ id: inv.id, mode: "promise" }); setRDate(effPromise || ""); setRReason(""); }}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 font-semibold inline-flex items-center gap-1 hover:bg-blue-500/25">
                                <CalendarClock size={10} /> Promised {effPromise}
                              </button>
                            ) : (
                              <button onClick={() => { setRespEdit({ id: inv.id, mode: "promise" }); setRDate(""); setRReason(""); }}
                                className="text-stone-300 text-[12px] hover:text-stone-500">—</button>
                            )}
                            {!effDispute && <Pencil size={11} className="text-stone-300 opacity-0 group-hover:opacity-100" onClick={() => { setRespEdit({ id: inv.id, mode: effDispute ? "dispute" : "promise" }); setRDate(effPromise || ""); setRReason(effReason || ""); }} />}
                          </div>
                        );
                      })()}
                    </td>

                    {/* Email (editable inline) */}
                    <td className="px-3 py-2 max-w-[200px]">
                      {emailEdit === inv.id ? (
                        <input
                          autoFocus value={emailVal} onChange={e => setEmailVal(e.target.value)}
                          onBlur={() => { if (emailVal !== (email ?? "")) save(inv.id, { billingEmail: emailVal }); setEmailEdit(null); }}
                          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEmailEdit(null); }}
                          className="w-full text-[12px] border border-stone-700 rounded px-1.5 py-1 bg-stone-800 text-stone-300"
                        />
                      ) : (
                        <button onClick={() => { setEmailEdit(inv.id); setEmailVal(email ?? ""); }}
                          className="group inline-flex items-center gap-1 text-left max-w-full">
                          <span className={`text-[12px] truncate ${email ? "text-stone-300" : "text-stone-600 italic"}`}>{email || "no email"}</span>
                          <Pencil size={11} className="text-stone-300 opacity-0 group-hover:opacity-100 shrink-0" />
                        </button>
                      )}
                    </td>

                    <td className="px-3 py-2 whitespace-nowrap text-[12px]">
                      {lastSent ? <span className="text-stone-400">{fmtSent(lastSent)}</span> : <span className="text-stone-600">Never</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-[12px] font-mono">
                      {lastRef ? <span className="text-stone-400">{lastRef}</span> : <span className="text-stone-600">—</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-stone-400 text-[12px]">{inv.dueDate}{days > 0 && <span className="ml-1 text-rose-400 font-medium">+{days}d</span>}</td>
                    <td className="px-3 py-2 text-right font-semibold text-white tabular-nums">{fmt.money(bal, inv.currency)}</td>

                    {/* Notes / comments */}
                    <td className="px-3 py-2 text-center relative">
                      <button onClick={() => { setNotesOpenId(notesOpenId === inv.id ? null : inv.id); setNoteText(""); }}
                        className="relative inline-flex items-center justify-center p-1 rounded hover:bg-stone-800 text-stone-500 hover:text-stone-200" title="Notes">
                        <MessageSquare size={15} />
                        {(notesByInv[inv.id]?.length ?? 0) > 0 && (
                          <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-semibold">{notesByInv[inv.id].length}</span>
                        )}
                      </button>
                      {notesOpenId === inv.id && (
                        <div className="absolute right-2 top-9 z-30 w-72 bg-stone-900 rounded-xl shadow-2xl ring-1 ring-stone-700 text-left" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-between px-3 py-2 border-b border-stone-800">
                            <span className="text-[12px] font-semibold text-stone-300">Notes · #{inv.invoiceNumber}</span>
                            <button onClick={() => setNotesOpenId(null)} className="text-stone-500 hover:text-stone-200"><X size={14} /></button>
                          </div>
                          <div className="max-h-52 overflow-auto p-3 space-y-2.5">
                            {(notesByInv[inv.id] ?? []).length === 0 ? (
                              <div className="text-[12px] text-stone-500 text-center py-2">No notes yet</div>
                            ) : (notesByInv[inv.id] ?? []).map((n: any) => {
                              const fromCustomer = n.channel === "Portal";
                              return (
                              <div key={n.id} className={`text-[12px] ${fromCustomer ? "border-l-2 border-emerald-500/60 pl-2" : ""}`}>
                                <div className="flex items-center justify-between text-[10px] text-stone-500">
                                  <span className="font-medium text-stone-400 flex items-center gap-1">
                                    {fromCustomer
                                      ? <span className="text-emerald-400">Customer · via portal</span>
                                      : (n.sender || "User")}
                                  </span>
                                  <span>{new Date(n.sentAt ?? n.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}{n.refNumber ? ` · ${n.refNumber}` : ""}</span>
                                </div>
                                <div className="text-stone-200 mt-0.5 whitespace-pre-wrap">{n.body}</div>
                              </div>
                              );
                            })}
                          </div>
                          <div className="p-2 border-t border-stone-800 flex items-center gap-1.5">
                            <input value={noteText} onChange={e => setNoteText(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter") { const r = filteredRows.find(x => x.inv.id === inv.id); if (r) addNote(r); } }}
                              placeholder="Add a note…" className="flex-1 text-[12px] border border-stone-700 rounded-lg px-2 py-1.5 bg-stone-800 text-stone-300 placeholder-stone-600 outline-none focus:ring-1 focus:ring-emerald-500" />
                            <button onClick={() => addNote(filteredRows.find(x => x.inv.id === inv.id)!)} disabled={savingNote || !noteText.trim()}
                              className="text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md px-2 py-1.5 disabled:opacity-40">Add</button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-stone-800 bg-stone-900/60 font-semibold">
                <td colSpan={12} className="px-3 py-2.5 text-[12px] text-stone-400 text-right">
                  Subtotal · {filteredRows.length} invoice{filteredRows.length !== 1 ? "s" : ""}
                </td>
                <td className="px-3 py-2.5 text-right text-white tabular-nums">{fmt.money(filteredRows.reduce((s, r) => s + r.bal, 0), ccy)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {showSend && (
        <SendModal rows={selectedRows} ccy={ccy} multiCustomer={selectedCustomers.size > 1}
          onClose={() => setShowSend(false)}
          onSent={() => { setShowSend(false); setSelected(new Set()); refresh(); }}
          toast={toast} />
      )}
    </div>
  );
}

// ── Send modal — consolidated email to unique recipients with references ──────
function SendModal({ rows, ccy, multiCustomer, onClose, onSent, toast }: {
  rows: BoardRow[]; ccy: string; multiCustomer: boolean;
  onClose: () => void; onSent: () => void; toast?: (m: string, t?: string) => void;
}) {
  const total = rows.reduce((s, r) => s + r.bal, 0);
  // Unique email reference (neutral prefix — not org-specific)
  const [emailRef] = useState(genEmailRef);
  const [to, setTo] = useState(uniqEmails(rows.map(r => r.email)).join(", "));
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(`Open Invoices — Ref ${emailRef}`);
  // Editable intro message; the branded template renders the table/total/portal button.
  const [body, setBody] = useState(
    `Hi,\n\nPlease find attached the statement of open invoices along with the invoice copies for your reference.\nKindly share the tentative payment dates at your earliest convenience.\nFeel free to reach out for any queries.`
  );
  const [sending, setSending] = useState(false);

  async function send() {
    if (!to.trim()) { toast?.("Add at least one recipient", "error"); return; }
    setSending(true);
    try {
      const ids = rows.map(r => r.inv.id);
      // Portal link — only when all invoices belong to one customer (a token is per-customer)
      let portalUrl: string | null = null;
      const custIds = new Set(rows.map(r => r.custId));
      if (custIds.size === 1) {
        try {
          const tk = await fetch("/api/portal/token", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ customerId: rows[0].custId, invoiceIds: ids }),
          });
          if (tk.ok) portalUrl = (await tk.json()).url ?? null;
        } catch {}
      }
      const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
      const html = renderInvoiceEmail({
        subject, dateStr, total, currency: ccy, portalUrl, intro: body,
        rows: rows.map(r => ({
          invoiceNumber: r.inv.invoiceNumber, customerName: r.custName, projectName: r.projName,
          invoiceDate: r.inv.invoiceDate, dueDate: r.inv.dueDate, balance: r.bal, currency: r.inv.currency, daysOverdue: r.days,
        })),
      });
      const res = await fetch("/api/email/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, cc: cc || undefined, subject, body: html, attachInvoiceIds: ids }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Send failed"); }
      // Log a communication per invoice so it shows on each timeline
      await Promise.all(rows.map(r => fetch("/api/communications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: r.custId, invoiceId: r.inv.id, projectId: r.inv.projectId ?? null,
          direction: "Outbound", channel: "Email", subject, recipients: to, body,
          matchedBy: "Manual", isDraft: false, refNumber: emailRef,
        }),
      }).catch(() => {})));
      toast?.(`Sent ${rows.length} invoice(s) to ${to}`);
      onSent();
    } catch (e: any) {
      toast?.(e.message || "Failed to send", "error");
    } finally { setSending(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-stone-900 border border-stone-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-white">Send {rows.length} invoice(s)</h3>
            <div className="text-[11px] text-stone-400 mt-0.5">Email reference: <span className="font-mono text-emerald-400">{emailRef}</span></div>
          </div>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-200"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          {multiCustomer && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-[12px] text-amber-200">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
              You've selected invoices from <strong>different customers</strong> — they'll all go to the recipients below in one email. Send separately per customer to avoid sharing one customer's invoices with another.
            </div>
          )}
          <div>
            <label className="text-[11px] font-medium text-stone-400">To (unique emails from selection — editable)</label>
            <input value={to} onChange={e => setTo(e.target.value)} className="w-full mt-1 text-sm border border-stone-700 rounded-lg px-3 py-2 bg-stone-800 text-stone-200 outline-none focus:ring-1 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="text-[11px] font-medium text-stone-400">CC</label>
            <input value={cc} onChange={e => setCc(e.target.value)} placeholder="optional" className="w-full mt-1 text-sm border border-stone-700 rounded-lg px-3 py-2 bg-stone-800 text-stone-200 placeholder-stone-600 outline-none focus:ring-1 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="text-[11px] font-medium text-stone-400">Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} className="w-full mt-1 text-sm border border-stone-700 rounded-lg px-3 py-2 bg-stone-800 text-stone-200 outline-none focus:ring-1 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="text-[11px] font-medium text-stone-400">Message</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={8} className="w-full mt-1 text-sm border border-stone-700 rounded-lg px-3 py-2 bg-stone-800 text-stone-200 outline-none focus:ring-1 focus:ring-emerald-500 resize-none" />
          </div>
          <p className="text-[11px] text-stone-500">Sent in the standard branded format with an invoice table, the "View &amp; Respond" portal link, and invoice PDFs attached automatically. The text above is the intro message.</p>
        </div>
        <div className="px-5 py-3 border-t border-stone-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-stone-400 hover:text-stone-200">Cancel</button>
          <button onClick={send} disabled={sending} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50">
            {sending && <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
            <Send size={14} /> {sending ? "Sending…" : "Send email"}
          </button>
        </div>
      </div>
    </div>
  );
}
