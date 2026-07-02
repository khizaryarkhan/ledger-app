"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { STAGE_COLOR_CLASSES, Stage } from "@/lib/stages";
import { fmt } from "@/lib/format";
import { Send, X, AlertTriangle, CalendarClock, AlertOctagon, Check, Pencil, Download, MessageSquare, FileText, Globe, StickyNote, CheckCircle2, XCircle, Clock, Mail, ChevronUp, ChevronDown, ChevronsUpDown, CornerUpLeft, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useSession } from "next-auth/react";
import { SendInvoicesModal } from "@/components/send-invoices-modal";
import { EmailComposer } from "@/components/feature";

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

export function BoardList({ rows, stages, updateInvoice, refresh, toast, comments = [] }: {
  rows: BoardRow[];
  stages: Stage[];
  updateInvoice: (id: string, patch: any) => Promise<any>;
  refresh: () => Promise<any> | void;
  toast?: (m: string, t?: string) => void;
  comments?: any[];
}) {
  const { data: session } = useSession();
  const userName = (session?.user?.name as string) || "User";
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [notesOpenId, setNotesOpenId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [replyContext, setReplyContext] = useState<any>(null);
  const [savingNote, setSavingNote] = useState(false);

  // Activity feed grouped by invoice — includes all human-relevant events:
  // internal notes, customer portal messages, dispute events, promise events.
  const ACTIVITY_CHANNELS = new Set(["Note", "Portal", "Dispute", "Promise", "Email"]);
  const notesByInv = useMemo(() => {
    const m: Record<string, any[]> = {};
    (comments ?? []).forEach((c: any) => {
      if (!ACTIVITY_CHANNELS.has(c.channel) || !c.invoiceId) return;
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
        const resp = r.inv.hasOpenDispute ? "Disputed" : r.inv.promiseDate ? "Committed" : "None";
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

  // ── Column sort ────────────────────────────────────────────────────────────
  const [sortCol, setSortCol] = useState<string>("customer");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const handleSort = (col: string) => {
    setSortDir(prev => sortCol === col ? (prev === "asc" ? "desc" : "asc") : "asc");
    setSortCol(col);
  };

  const sortedRows = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (a: string | number | null | undefined, b: string | number | null | undefined): number => {
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      return a < b ? -1 : a > b ? 1 : 0;
    };
    return [...filteredRows].sort((a, b) => {
      let primary = 0;
      switch (sortCol) {
        case "invoice":     primary = cmp(a.inv.invoiceNumber, b.inv.invoiceNumber); break;
        case "customer":    primary = cmp(a.custName, b.custName); break;
        case "project":     primary = cmp(a.projName, b.projName); break;
        case "region":      primary = cmp(a.regionName, b.regionName); break;
        case "rep":         primary = cmp(a.repName, b.repName); break;
        case "stage":       primary = cmp(a.stageLabel, b.stageLabel); break;
        case "response":    primary = cmp(a.inv.hasOpenDispute ? "Disputed" : a.inv.promiseDate ? "Committed" : "None", b.inv.hasOpenDispute ? "Disputed" : b.inv.promiseDate ? "Committed" : "None"); break;
        case "lastSent":    primary = cmp(a.lastSent, b.lastSent); break;
        case "due":         primary = cmp(a.inv.dueDate, b.inv.dueDate); break;
        case "outstanding": primary = cmp(a.bal, b.bal); break;
        case "days":        primary = cmp(a.days, b.days); break;
      }
      if (primary !== 0) return primary * dir;
      // Secondary: always customer → project → due date for grouping
      const s1 = cmp(a.custName, b.custName); if (s1 !== 0) return s1;
      const s2 = cmp(a.projName, b.projName); if (s2 !== 0) return s2;
      return cmp(a.inv.dueDate, b.inv.dueDate);
    });
  }, [filteredRows, sortCol, sortDir]);

  const stageLabels = stages.filter(s => s.visible).map(s => s.label);
  const stageColor = (label: string) => STAGE_COLOR_CLASSES[stages.find(s => s.label === label)?.color ?? "stone"]?.badge ?? "bg-stone-100 text-stone-700";
  const fmtSent = (d: string | null) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }) : null;

  const allSelected = sortedRows.length > 0 && sortedRows.every(r => selected.has(r.inv.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(sortedRows.map(r => r.inv.id)));
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
    const src = selected.size ? sortedRows.filter(r => selected.has(r.inv.id)) : sortedRows;
    const headers = ["Invoice", "Customer", "Project", "Region", "Rep", "Stage", "Response", "Email", "Last sent", "Last ref", "Due", "Days overdue", "Outstanding"];
    const esc = (v: any) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [headers.join(",")];
    src.forEach(r => {
      const resp = r.inv.hasOpenDispute ? `Disputed${r.inv.disputeReason ? ": " + r.inv.disputeReason : ""}`
        : r.inv.promiseDate ? `Committed ${r.inv.promiseDate}` : "";
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
          <span className="text-sm font-medium">{selected.size} selected · {(() => {
            const m: Record<string,number> = {};
            selectedRows.forEach(r => { const c = r.inv.currency ?? "USD"; m[c] = (m[c]||0) + r.bal; });
            return Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([c,v]) => fmt.money(v,c)).join(" · ");
          })()}</span>
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
          {sortedRows.length} invoice{sortedRows.length !== 1 ? "s" : ""}{anyFilter || overdueOnly ? " (filtered)" : ""}{selected.size ? ` · ${selected.size} selected` : ""}
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
                {([
                  { label: "Invoice",     key: "invoice" },
                  { label: "Customer",    key: "customer" },
                  { label: "Project",     key: "project" },
                  { label: "Region",      key: "region" },
                  { label: "Rep",         key: "rep" },
                  { label: "Stage",       key: "stage" },
                  { label: "Response",    key: "response" },
                  { label: "Email",       key: null },
                  { label: "Last sent",   key: "lastSent" },
                  { label: "Last ref",    key: null },
                  { label: "Due",         key: "due" },
                ] as { label: string; key: string | null }[]).map(({ label, key }) => (
                  <th key={label} className={thCls}>
                    {key ? (
                      <button onClick={() => handleSort(key)} className="inline-flex items-center gap-1 hover:text-stone-200 transition-colors group">
                        {label}
                        {sortCol === key
                          ? sortDir === "asc" ? <ChevronUp size={11} className="text-emerald-400" /> : <ChevronDown size={11} className="text-emerald-400" />
                          : <ChevronsUpDown size={11} className="text-stone-700 group-hover:text-stone-500" />}
                      </button>
                    ) : label}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-[11px] font-semibold text-stone-500 uppercase tracking-wider text-right">
                  <button onClick={() => handleSort("outstanding")} className="inline-flex items-center gap-1 hover:text-stone-200 transition-colors group ml-auto">
                    Outstanding
                    {sortCol === "outstanding"
                      ? sortDir === "asc" ? <ChevronUp size={11} className="text-emerald-400" /> : <ChevronDown size={11} className="text-emerald-400" />
                      : <ChevronsUpDown size={11} className="text-stone-700 group-hover:text-stone-500" />}
                  </button>
                </th>
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
                    <option value="">All</option><option value="Disputed">Disputed</option><option value="Committed">Committed</option><option value="None">No response</option>
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
              {sortedRows.map(({ inv, custName, projName, regionName, repName, stageLabel, bal, days, email, lastSent, lastRef }) => {
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
                              <button onClick={() => setRespEdit({ id: inv.id, mode: "promise" })} className={`flex-1 text-[10px] py-1 rounded ${respEdit!.mode === "promise" ? "bg-blue-600 text-white" : "bg-stone-700 text-stone-400"}`}>📅 Commitment</button>
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
                                <CalendarClock size={10} /> Committed {effPromise}
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
                        <div className="absolute right-2 top-9 z-30 w-96 bg-stone-950 rounded-xl shadow-2xl ring-1 ring-stone-700 text-left flex flex-col" style={{maxHeight:"520px"}} onClick={e => e.stopPropagation()}>
                          {/* Header */}
                          <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-800 flex-shrink-0">
                            <div className="flex items-center gap-2">
                              <MessageSquare size={13} className="text-stone-400" />
                              <span className="text-[12px] font-semibold text-stone-200">Activity · #{inv.invoiceNumber}</span>
                              {(notesByInv[inv.id]?.length ?? 0) > 0 && (
                                <span className="text-[10px] text-stone-500">{notesByInv[inv.id].length} event{notesByInv[inv.id].length !== 1 ? "s" : ""}</span>
                              )}
                            </div>
                            <button onClick={() => setNotesOpenId(null)} className="text-stone-500 hover:text-stone-200"><X size={14} /></button>
                          </div>

                          {/* Feed */}
                          <div className="flex-1 overflow-auto p-3 space-y-2 min-h-0">
                            {(notesByInv[inv.id] ?? []).length === 0 ? (
                              <div className="text-[12px] text-stone-600 text-center py-6">No activity yet</div>
                            ) : [...(notesByInv[inv.id] ?? [])].sort((a: any, b: any) => new Date(a.sentAt ?? a.createdAt).getTime() - new Date(b.sentAt ?? b.createdAt).getTime()).map((n: any) => {
                              const ts = new Date(n.sentAt ?? n.createdAt);
                              const dateStr = ts.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
                              const timeStr = ts.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

                              // Per-channel config
                              type ChanCfg = { icon: React.ReactNode; border: string; label: string; labelCls: string; bg: string };
                              const cfg: ChanCfg = (() => {
                                switch (n.channel) {
                                  case "Portal":   return { icon: <Globe size={11} />,         border: "border-l-2 border-emerald-500", label: "Customer · via portal", labelCls: "text-emerald-400", bg: "bg-emerald-950/30" };
                                  case "Dispute":  return {
                                    icon: n.body?.startsWith("Resolved") || n.subject?.includes("resolved")
                                      ? <CheckCircle2 size={11} />
                                      : n.body?.startsWith("Rejected") || n.subject?.includes("rejected")
                                        ? <XCircle size={11} />
                                        : <AlertOctagon size={11} />,
                                    border: n.subject?.includes("resolved") ? "border-l-2 border-emerald-500" : n.subject?.includes("rejected") ? "border-l-2 border-stone-500" : "border-l-2 border-rose-500",
                                    label: n.sender || "Staff",
                                    labelCls: n.subject?.includes("resolved") ? "text-emerald-400" : n.subject?.includes("rejected") ? "text-stone-400" : "text-rose-400",
                                    bg: n.subject?.includes("resolved") ? "bg-emerald-950/20" : n.subject?.includes("rejected") ? "bg-stone-800/40" : "bg-rose-950/20",
                                  };
                                  case "Promise":  return {
                                    icon: n.subject === "Promise broken" ? <AlertOctagon size={11} /> : n.direction === "Inbound" ? <Clock size={11} /> : <CalendarClock size={11} />,
                                    border: n.subject === "Promise broken" ? "border-l-2 border-amber-500" : "border-l-2 border-sky-500",
                                    label: n.subject === "Promise broken" ? "System" : (n.sender || "Staff"),
                                    labelCls: n.subject === "Promise broken" ? "text-amber-400" : "text-sky-400",
                                    bg: n.subject === "Promise broken" ? "bg-amber-950/20" : "bg-sky-950/20",
                                  };
                                  case "Email":    return { icon: n.direction === "Inbound" ? <ArrowDownRight size={11} /> : <Mail size={11} />, border: n.direction === "Inbound" ? "border-l-2 border-emerald-500" : "border-l-2 border-blue-500", label: n.direction === "Inbound" ? `Reply from ${n.sender || "customer"}` : `Sent to ${n.recipients || "customer"}`, labelCls: n.direction === "Inbound" ? "text-emerald-400" : "text-blue-400", bg: n.direction === "Inbound" ? "bg-emerald-950/20" : "bg-blue-950/20" };
                                  default:         return { icon: <StickyNote size={11} />,     border: "border-l-2 border-stone-600", label: n.sender || "Staff",            labelCls: "text-stone-400",   bg: "" };
                                }
                              })();

                              return (
                                <div key={n.id} className={`rounded-lg px-3 py-2 ${cfg.border} ${cfg.bg}`}>
                                  <div className="flex items-center justify-between gap-2 mb-1">
                                    <div className={`flex items-center gap-1.5 text-[10px] font-semibold ${cfg.labelCls}`}>
                                      {cfg.icon}
                                      <span>{cfg.label}</span>
                                    </div>
                                    <span className="text-[10px] text-stone-600 tabular-nums flex-shrink-0">{dateStr} {timeStr}</span>
                                  </div>
                                  {n.subject && n.channel !== "Note" && n.channel !== "Portal" && (
                                    <div className="text-[11px] font-medium text-stone-300 mb-0.5">{n.subject}</div>
                                  )}
                                  <div className="text-[12px] text-stone-300 whitespace-pre-wrap leading-relaxed">{n.body}</div>
                                  {n.channel === "Email" && (
                                    <button
                                      onClick={() => setReplyContext({
                                        toEmail:    n.direction === "Inbound" ? n.sender : n.recipients,
                                        subject:    n.subject ? (n.subject.startsWith("Re:") ? n.subject : `Re: ${n.subject}`) : "",
                                        messageId:  n.messageId ?? null,
                                        refNumber:  n.refNumber ?? null,
                                        invoiceId:  n.invoiceId,
                                        customerId: n.customerId,
                                        projectId:  n.projectId,
                                      })}
                                      className="mt-1.5 flex items-center gap-1 text-[10px] text-stone-500 hover:text-blue-400 transition-colors"
                                    >
                                      <CornerUpLeft size={10} />
                                      Reply
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {/* Add note input */}
                          <div className="p-2.5 border-t border-stone-800 flex-shrink-0">
                            <div className="text-[10px] text-stone-600 font-medium mb-1.5 px-1">Internal note</div>
                            <div className="flex items-center gap-1.5">
                              <input value={noteText} onChange={e => setNoteText(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const r = sortedRows.find(x => x.inv.id === inv.id); if (r) addNote(r); } }}
                                placeholder="Write a note…" className="flex-1 text-[12px] border border-stone-700 rounded-lg px-2.5 py-1.5 bg-stone-900 text-stone-300 placeholder-stone-600 outline-none focus:ring-1 focus:ring-emerald-500" />
                              <button onClick={() => addNote(sortedRows.find(x => x.inv.id === inv.id)!)} disabled={savingNote || !noteText.trim()}
                                className="text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg px-3 py-1.5 disabled:opacity-40 transition-colors">Add</button>
                            </div>
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
                  {sortedRows.length} invoice{sortedRows.length !== 1 ? "s" : ""}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {(() => {
                    const byCcy: Record<string, number> = {};
                    sortedRows.forEach(r => {
                      const c = r.inv.currency ?? "USD";
                      byCcy[c] = (byCcy[c] || 0) + r.bal;
                    });
                    return Object.entries(byCcy)
                      .filter(([, v]) => v > 0)
                      .sort((a, b) => b[1] - a[1])
                      .map(([c, v]) => (
                        <div key={c} className="text-white">{fmt.money(v, c)}</div>
                      ));
                  })()}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {showSend && (
        <SendInvoicesModal rows={selectedRows} ccy={selectedRows[0]?.inv.currency ?? "USD"} multiCustomer={selectedCustomers.size > 1}
          onClose={() => setShowSend(false)}
          onSent={() => { setShowSend(false); setSelected(new Set()); refresh(); }}
          toast={toast} />
      )}
      {replyContext && (
        <EmailComposer
          context={{ customerId: replyContext.customerId, invoiceId: replyContext.invoiceId, projectId: replyContext.projectId, replyTo: replyContext }}
          onClose={() => setReplyContext(null)}
        />
      )}
    </div>
  );
}
