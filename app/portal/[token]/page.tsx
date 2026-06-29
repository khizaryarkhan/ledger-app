"use client";

import { useState, useEffect, useRef } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

type Invoice = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  balance: number;
  total: number;
  alreadyDisputed: boolean;
  existingPromise: string | null;
  hasPdf: boolean;
};

type PaidInvoice = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  total: number;
  paid: number;
};

type PortalData = {
  org: { name: string; logoUrl: string | null; showPaymentHistory: boolean };
  customer: { name: string };
  invoices: Invoice[];
  paymentHistory: PaidInvoice[];
};

type RowAction = {
  type: "none" | "commit" | "dispute";
  commitDate: string;
  comment: string;
  disputeCategory: string;
};

type SubmittedSummary = {
  commitments: { invoiceNumber: string; date: string }[];
  disputes: { invoiceNumber: string; category: string }[];
  notes: { invoiceNumber: string }[];
};

const DISPUTE_CATEGORIES = [
  "Wrong Amount",
  "Already Paid",
  "Goods / Service Issue",
  "Duplicate Invoice",
  "Other",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function money(n: number, ccy: string) {
  return new Intl.NumberFormat("en-IE", {
    style: "currency", currency: ccy || "EUR", maximumFractionDigits: 2,
  }).format(n);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return d; }
}

function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}

function daysOverdue(dueDate: string): number {
  const diff = new Date(new Date().toDateString()).getTime() - new Date(dueDate).getTime();
  return Math.max(0, Math.ceil(diff / 86400000));
}

const todayStr = () => new Date().toISOString().slice(0, 10);

// ── Main component ────────────────────────────────────────────────────────────

export default function PortalPage({ params }: { params: { token: string } }) {
  const [data, setData]         = useState<PortalData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState<"open" | "history">("open");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]         = useState(false);
  const [summary, setSummary]   = useState<SubmittedSummary>({ commitments: [], disputes: [], notes: [] });

  const [rowActions, setRowActions] = useState<Record<string, RowAction>>({});
  const [selected, setSelected]     = useState<Set<string>>(new Set());

  const [batchDate, setBatchDate]         = useState("");
  const [batchComment, setBatchComment]   = useState("");
  const [batchDispute, setBatchDispute]   = useState("");

  useEffect(() => {
    fetch(`/api/portal/${params.token}`)
      .then(async res => {
        if (res.status === 410) { const d = await res.json(); setErrorMsg(d.error || "expired"); return; }
        if (!res.ok) { setErrorMsg("error"); return; }
        const d: PortalData = await res.json();
        setData(d);
        const init: Record<string, RowAction> = {};
        d.invoices.forEach(i => { init[i.id] = { type: "none", commitDate: "", comment: "", disputeCategory: "" }; });
        setRowActions(init);
      })
      .catch(() => setErrorMsg("error"))
      .finally(() => setLoading(false));
  }, [params.token]);

  const invoices         = data?.invoices ?? [];
  const totalOutstanding = invoices.reduce((s, i) => s + i.balance, 0);
  const overdueInvs      = invoices.filter(i => isOverdue(i.dueDate));
  const totalOverdue     = overdueInvs.reduce((s, i) => s + i.balance, 0);
  const currency         = invoices[0]?.currency || "EUR";

  const actionCount = Object.values(rowActions).filter(a => {
    if (a.type === "commit") return !!a.commitDate;
    if (a.type === "dispute") return !!a.disputeCategory;
    return !!a.comment;
  }).length;

  function patchRow(id: string, patch: Partial<RowAction>) {
    setRowActions(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function handleSelectAll() {
    const eligible = invoices.filter(i => !i.alreadyDisputed).map(i => i.id);
    if (selected.size === eligible.length) setSelected(new Set());
    else setSelected(new Set(eligible));
  }

  function applyBatch() {
    if (selected.size === 0) return;
    setRowActions(prev => {
      const next = { ...prev };
      selected.forEach(id => {
        const cur = next[id] ?? { type: "none" as const, commitDate: "", comment: "", disputeCategory: "" };
        if (batchDate) {
          next[id] = { ...cur, type: "commit", commitDate: batchDate, comment: batchComment || cur.comment };
        } else if (batchDispute) {
          next[id] = { ...cur, type: "dispute", disputeCategory: batchDispute, comment: batchComment || cur.comment };
        } else if (batchComment) {
          next[id] = { ...cur, comment: batchComment };
        }
      });
      return next;
    });
    setBatchDate(""); setBatchComment(""); setBatchDispute(""); setSelected(new Set());
  }

  async function submit() {
    setSubmitting(true);
    const responses: any[] = [];
    const committed: SubmittedSummary["commitments"] = [];
    const disputed:  SubmittedSummary["disputes"]    = [];
    const noted:     SubmittedSummary["notes"]       = [];

    invoices.forEach(inv => {
      const a = rowActions[inv.id];
      if (!a) return;
      if (a.type === "commit" && a.commitDate) {
        responses.push({ invoiceId: inv.id, promise: { date: a.commitDate, note: a.comment || undefined } });
        committed.push({ invoiceNumber: inv.invoiceNumber, date: a.commitDate });
      } else if (a.type === "dispute" && a.disputeCategory) {
        responses.push({ invoiceId: inv.id, dispute: { category: a.disputeCategory, reason: a.comment || undefined } });
        disputed.push({ invoiceNumber: inv.invoiceNumber, category: a.disputeCategory });
      } else if (a.comment) {
        responses.push({ invoiceId: inv.id, note: a.comment });
        noted.push({ invoiceNumber: inv.invoiceNumber });
      }
    });

    if (responses.length === 0) { setSubmitting(false); return; }

    try {
      const res = await fetch(`/api/portal/${params.token}/submit`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses }),
      });
      if (res.ok) { setSummary({ commitments: committed, disputes: disputed, notes: noted }); setDone(true); }
      else { const d = await res.json().catch(() => ({})); setErrorMsg(d.error || "error"); }
    } catch { setErrorMsg("error"); }
    finally  { setSubmitting(false); }
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) return (
    <div style={S.page}>
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:12 }}>
        <div style={S.spinner} />
        <span style={{ fontSize:13, color:"#9CA3AF" }}>Loading your account…</span>
      </div>
    </div>
  );

  // ── Error ─────────────────────────────────────────────────────────────────

  if (errorMsg) {
    const msg = errorMsg === "expired" || errorMsg === "completed"
      ? "This link has already been used or has expired. Please contact your account manager for a new link."
      : errorMsg === "not_found"
      ? "This link is invalid. Please check the URL or contact your account manager."
      : "Something went wrong. Please try again or contact us.";
    return (
      <div style={S.page}>
        <div style={{ maxWidth:340, textAlign:"center" }}>
          <div style={{ width:48, height:48, borderRadius:"50%", background:"#F3F4F6", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px" }}>
            <svg width="20" height="20" fill="none" stroke="#9CA3AF" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>
            </svg>
          </div>
          <p style={{ fontSize:15, fontWeight:600, color:"#111827", marginBottom:6 }}>Link unavailable</p>
          <p style={{ fontSize:13, color:"#6B7280", lineHeight:1.6 }}>{msg}</p>
        </div>
      </div>
    );
  }

  // ── Confirmation ──────────────────────────────────────────────────────────

  if (done) return (
    <div style={{ minHeight:"100vh", background:"#F0F2F5", display:"flex", flexDirection:"column" }}>
      <Header org={data?.org} />
      <div style={{ maxWidth:640, margin:"0 auto", width:"100%", padding:"32px 16px", flex:1 }}>
        <div style={{ background:"#fff", border:"1px solid #E5E7EB", borderRadius:8, padding:"20px 24px", marginBottom:16, display:"flex", gap:14, alignItems:"flex-start" }}>
          <div style={{ width:36, height:36, borderRadius:"50%", background:"#DCFCE7", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <svg width="16" height="16" fill="none" stroke="#16A34A" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/>
            </svg>
          </div>
          <div>
            <p style={{ fontSize:15, fontWeight:600, color:"#111827", marginBottom:4 }}>Response submitted</p>
            <p style={{ fontSize:13, color:"#6B7280" }}>Thank you, <strong style={{ color:"#374151" }}>{data?.customer.name}</strong>. Your account manager has been notified.</p>
          </div>
        </div>

        {summary.commitments.length > 0 && (
          <SummaryBlock title="Payment commitments">
            {summary.commitments.map((c, i) => (
              <SummaryRow key={i} left={`#${c.invoiceNumber}`} right={<>Expected by <strong>{fmtDate(c.date)}</strong></>} />
            ))}
          </SummaryBlock>
        )}
        {summary.disputes.length > 0 && (
          <SummaryBlock title="Queries raised">
            {summary.disputes.map((d, i) => (
              <SummaryRow key={i} left={`#${d.invoiceNumber}`} right={<span style={{ fontSize:11, padding:"2px 8px", background:"#FEF3C7", color:"#92400E", borderRadius:4, fontWeight:600 }}>{d.category}</span>} />
            ))}
          </SummaryBlock>
        )}

        <div style={{ background:"#fff", border:"1px solid #E5E7EB", borderRadius:8, padding:"20px 24px" }}>
          <p style={{ fontSize:11, fontWeight:700, color:"#9CA3AF", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:14 }}>What happens next</p>
          <ol style={{ listStyle:"none", display:"flex", flexDirection:"column", gap:12 }}>
            {summary.commitments.length > 0 && <NextStep n={1}>Your account manager will monitor for receipt by the committed date and follow up if needed.</NextStep>}
            {summary.disputes.length > 0    && <NextStep n={summary.commitments.length > 0 ? 2 : 1}>Your query has been assigned for review. Expect a response within 2 business days.</NextStep>}
            <NextStep n={(summary.commitments.length > 0 ? 1 : 0) + (summary.disputes.length > 0 ? 1 : 0) + 1}>To make changes, reply to the email you received this link from.</NextStep>
          </ol>
        </div>
        <p style={{ textAlign:"center", fontSize:11, color:"#9CA3AF", marginTop:24 }}>You may now close this page.</p>
      </div>
      <Footer />
    </div>
  );

  if (!data) return null;

  const showHistoryTab = data.org.showPaymentHistory && data.paymentHistory.length > 0;
  const eligibleCount  = invoices.filter(i => !i.alreadyDisputed).length;
  const allSelected    = selected.size === eligibleCount && eligibleCount > 0;
  const someSelected   = selected.size > 0;

  // ── Main ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight:"100vh", background:"#F0F2F5", fontFamily:"-apple-system,'Segoe UI',system-ui,sans-serif", display:"flex", flexDirection:"column" }}>
      <Header org={data.org} />

      <div style={{ maxWidth:1100, margin:"0 auto", width:"100%", padding:"24px 16px", flex:1 }}>

        {/* Account heading */}
        <div style={{ marginBottom:20 }}>
          <h1 style={{ fontSize:20, fontWeight:700, color:"#0D1117", marginBottom:2 }}>{data.customer.name}</h1>
          <p style={{ fontSize:13, color:"#6B7280" }}>Account statement · {data.org.name}</p>
        </div>

        {/* KPI strip */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:24 }}>
          <Kpi label="Outstanding"      value={money(totalOutstanding, currency)} />
          <Kpi label="Overdue"          value={overdueInvs.length > 0 ? money(totalOverdue, currency) : "—"} accent={overdueInvs.length > 0 ? "red" : undefined} />
          <Kpi label="Open invoices"    value={String(invoices.length)} />
          <Kpi label="Overdue invoices" value={overdueInvs.length > 0 ? String(overdueInvs.length) : "—"} accent={overdueInvs.length > 0 ? "red" : undefined} />
        </div>

        {/* Table card */}
        <div style={{ background:"#fff", border:"1px solid #E5E7EB", borderRadius:8, overflow:"hidden" }}>

          {/* Tab bar */}
          <div style={{ display:"flex", alignItems:"stretch", borderBottom:"1px solid #E5E7EB", background:"#fff" }}>
            <TabBtn active={tab === "open"} onClick={() => setTab("open")}>Open invoices ({invoices.length})</TabBtn>
            {showHistoryTab && <TabBtn active={tab === "history"} onClick={() => setTab("history")}>Payment history ({data.paymentHistory.length})</TabBtn>}
            <div style={{ flex:1 }} />
            <a
              href={`/api/portal/${params.token}/statement`}
              target="_blank" rel="noopener noreferrer"
              style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, fontWeight:500, color:"#6B7280", padding:"0 16px", textDecoration:"none", borderLeft:"1px solid #E5E7EB" }}
            >
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/>
              </svg>
              Statement PDF
            </a>
          </div>

          {tab === "open" && (
            <>
              {invoices.length === 0 ? (
                <div style={{ padding:"48px 24px", textAlign:"center" }}>
                  <div style={{ width:36, height:36, borderRadius:"50%", background:"#DCFCE7", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 12px" }}>
                    <svg width="16" height="16" fill="none" stroke="#16A34A" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/>
                    </svg>
                  </div>
                  <p style={{ fontSize:14, fontWeight:600, color:"#374151" }}>Your account is up to date</p>
                  <p style={{ fontSize:13, color:"#9CA3AF", marginTop:4 }}>No open invoices at this time.</p>
                </div>
              ) : (
                <>
                  {/* Batch toolbar */}
                  <div style={{ padding:"10px 16px", borderBottom:"1px solid #E5E7EB", background:"#F9FAFB", display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                    <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", flexShrink:0 }}>
                      <Checkbox checked={allSelected} indeterminate={someSelected && !allSelected} onChange={handleSelectAll} />
                      <span style={{ fontSize:12, fontWeight:500, color:"#374151" }}>
                        {someSelected ? `${selected.size} selected` : "Select all"}
                      </span>
                    </label>

                    <div style={{ width:1, height:16, background:"#D1D5DB", flexShrink:0, margin:"0 4px" }} />

                    <input
                      type="date" min={todayStr()} value={batchDate}
                      onChange={e => setBatchDate(e.target.value)}
                      style={S.batchInput}
                      title="Batch pay-by date"
                    />

                    <select
                      value={batchDispute} onChange={e => setBatchDispute(e.target.value)}
                      style={S.batchInput}
                    >
                      <option value="">Query reason…</option>
                      {DISPUTE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>

                    <input
                      type="text" placeholder="Batch comment…"
                      value={batchComment} onChange={e => setBatchComment(e.target.value)}
                      style={{ ...S.batchInput, flex:1, minWidth:120 }}
                    />

                    <button
                      onClick={applyBatch}
                      disabled={!someSelected || (!batchDate && !batchDispute && !batchComment)}
                      style={someSelected && (batchDate || batchDispute || batchComment) ? S.batchBtnActive : S.batchBtnDisabled}
                    >
                      Apply to selected
                    </button>
                  </div>

                  {/* Table */}
                  <div style={{ overflowX:"auto" }}>
                    <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"fixed" }}>
                      <colgroup>
                        <col style={{ width:44 }} />   {/* checkbox */}
                        <col style={{ width:90 }} />   {/* invoice # */}
                        <col style={{ width:104 }} />  {/* date */}
                        <col style={{ width:104 }} />  {/* due */}
                        <col style={{ width:110 }} />  {/* balance */}
                        <col style={{ width:128 }} />  {/* pay by */}
                        <col style={{ width:140 }} />  {/* query */}
                        <col />                         {/* comment — fills remaining */}
                        <col style={{ width:52 }} />   {/* pdf */}
                      </colgroup>
                      <thead>
                        <tr style={{ background:"#F9FAFB", borderBottom:"1px solid #E5E7EB" }}>
                          <th style={S.th} />
                          <Th>Invoice</Th>
                          <Th>Date</Th>
                          <Th>Due date</Th>
                          <Th align="right">Balance</Th>
                          <Th>Pay by</Th>
                          <Th>Query</Th>
                          <Th>Comment</Th>
                          <Th align="center">PDF</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoices.map((inv, idx) => {
                          const overdue    = isOverdue(inv.dueDate);
                          const days       = overdue ? daysOverdue(inv.dueDate) : 0;
                          const isSelected = selected.has(inv.id);
                          const action     = rowActions[inv.id] ?? { type:"none", commitDate:"", comment:"", disputeCategory:"" };
                          const hasCommit  = action.type === "commit" && action.commitDate;
                          const hasDispute = action.type === "dispute" && action.disputeCategory;

                          const rowBg = hasCommit ? "#F0FDF4" : hasDispute ? "#FFFBEB" : isSelected ? "#EFF6FF" : idx % 2 === 1 ? "#FAFAFA" : "#fff";
                          const borderLeft = hasCommit ? "3px solid #16A34A" : hasDispute ? "3px solid #D97706" : "3px solid transparent";

                          return (
                            <tr key={inv.id} style={{ borderBottom:"1px solid #F3F4F6", background:rowBg, borderLeft }}>
                              {/* Checkbox */}
                              <td style={{ ...S.td, paddingLeft:12, width:44 }}>
                                <Checkbox
                                  checked={isSelected}
                                  onChange={() => { if (!inv.alreadyDisputed) toggleSelect(inv.id); }}
                                  disabled={inv.alreadyDisputed}
                                />
                              </td>

                              {/* Invoice # */}
                              <td style={{ ...S.td, paddingLeft:6 }}>
                                <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                                  <span style={{ fontFamily:"'SF Mono','Fira Code','Consolas',monospace", fontSize:13, fontWeight:700, color:"#0D1117", letterSpacing:"-0.01em" }}>#{inv.invoiceNumber}</span>
                                  <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                                    {overdue && (
                                      <span style={{ fontSize:10, fontWeight:700, padding:"1px 5px", background:"#FEE2E2", color:"#B91C1C", borderRadius:3, whiteSpace:"nowrap" }}>{days}d overdue</span>
                                    )}
                                    {inv.alreadyDisputed && <span style={{ fontSize:10, fontWeight:600, padding:"1px 5px", background:"#FEF3C7", color:"#92400E", borderRadius:3 }}>Query open</span>}
                                    {inv.existingPromise && !inv.alreadyDisputed && <span style={{ fontSize:10, fontWeight:600, padding:"1px 5px", background:"#DCFCE7", color:"#166534", borderRadius:3 }}>Committed</span>}
                                  </div>
                                </div>
                              </td>

                              {/* Invoice date */}
                              <td style={S.td}><span style={S.dateCell}>{fmtDate(inv.invoiceDate)}</span></td>

                              {/* Due date */}
                              <td style={S.td}>
                                <span style={{ ...S.dateCell, color: overdue ? "#B91C1C" : "#374151", fontWeight: overdue ? 600 : 400 }}>
                                  {fmtDate(inv.dueDate)}
                                </span>
                              </td>

                              {/* Balance */}
                              <td style={{ ...S.td, textAlign:"right", paddingRight:12 }}>
                                <span style={{ fontSize:13, fontWeight:700, color:"#0D1117", fontVariantNumeric:"tabular-nums" }}>{money(inv.balance, inv.currency)}</span>
                              </td>

                              {/* Pay by date */}
                              <td style={S.td}>
                                {!inv.alreadyDisputed ? (
                                  <input
                                    type="date" min={todayStr()}
                                    value={action.type === "commit" ? action.commitDate : ""}
                                    onChange={e => patchRow(inv.id, { type: e.target.value ? "commit" : "none", commitDate: e.target.value, disputeCategory: "" })}
                                    style={{
                                      width:"100%", fontSize:12, padding:"5px 8px",
                                      border: hasCommit ? "1px solid #86EFAC" : "1px solid #E5E7EB",
                                      borderRadius:5, background: hasCommit ? "#F0FDF4" : "#fff",
                                      color: hasCommit ? "#15803D" : "#374151",
                                      outline:"none", fontFamily:"inherit",
                                    }}
                                  />
                                ) : <span style={{ color:"#D1D5DB", fontSize:12 }}>—</span>}
                              </td>

                              {/* Query */}
                              <td style={S.td}>
                                {!inv.alreadyDisputed ? (
                                  <select
                                    value={action.type === "dispute" ? action.disputeCategory : ""}
                                    onChange={e => patchRow(inv.id, { type: e.target.value ? "dispute" : "none", disputeCategory: e.target.value, commitDate: "" })}
                                    style={{
                                      width:"100%", fontSize:12, padding:"5px 8px",
                                      border: hasDispute ? "1px solid #FCD34D" : "1px solid #E5E7EB",
                                      borderRadius:5, background: hasDispute ? "#FFFBEB" : "#fff",
                                      color: hasDispute ? "#92400E" : "#374151",
                                      outline:"none", fontFamily:"inherit",
                                    }}
                                  >
                                    <option value="">No query</option>
                                    {DISPUTE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                  </select>
                                ) : <span style={{ fontSize:11, padding:"2px 7px", background:"#FEF3C7", color:"#92400E", borderRadius:4, fontWeight:600 }}>Open query</span>}
                              </td>

                              {/* Comment */}
                              <td style={S.td}>
                                <input
                                  type="text"
                                  placeholder="Add a note…"
                                  value={action.comment}
                                  onChange={e => patchRow(inv.id, { comment: e.target.value })}
                                  style={{
                                    width:"100%", fontSize:12, padding:"5px 8px",
                                    border:"1px solid #E5E7EB", borderRadius:5,
                                    background:"#fff", color:"#374151",
                                    outline:"none", fontFamily:"inherit",
                                    boxSizing:"border-box",
                                  }}
                                />
                              </td>

                              {/* PDF */}
                              <td style={{ ...S.td, textAlign:"center" }}>
                                {inv.hasPdf ? (
                                  <a
                                    href={`/api/portal/${params.token}/pdf/${inv.id}`}
                                    target="_blank" rel="noopener noreferrer"
                                    title="Download invoice PDF"
                                    style={{ display:"inline-flex", alignItems:"center", gap:3, fontSize:11, fontWeight:600, color:"#2563EB", textDecoration:"none" }}
                                  >
                                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/>
                                    </svg>
                                    PDF
                                  </a>
                                ) : <span style={{ color:"#D1D5DB", fontSize:12 }}>—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Submit footer */}
                  <div style={{ padding:"12px 16px", borderTop:"1px solid #E5E7EB", background:"#F9FAFB", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
                    <span style={{ fontSize:13, color:"#6B7280" }}>
                      {actionCount > 0
                        ? <><strong style={{ color:"#374151" }}>{actionCount}</strong> invoice{actionCount !== 1 ? "s" : ""} with a response</>
                        : "Set a pay-by date, query, or note on each invoice to respond"
                      }
                    </span>
                    <button
                      onClick={submit}
                      disabled={actionCount === 0 || submitting}
                      style={actionCount > 0 && !submitting ? S.submitActive : S.submitDisabled}
                    >
                      {submitting && <span style={S.btnSpinner} />}
                      {submitting ? "Submitting…" : "Submit response"}
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {tab === "history" && (
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ background:"#F9FAFB", borderBottom:"1px solid #E5E7EB" }}>
                    <Th>Invoice</Th>
                    <Th>Invoiced</Th>
                    <Th>Due date</Th>
                    <Th align="right">Amount paid</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.paymentHistory.map((inv, idx) => (
                    <tr key={inv.id} style={{ borderBottom:"1px solid #F3F4F6", background: idx % 2 === 1 ? "#FAFAFA" : "#fff" }}>
                      <td style={S.td}>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <div style={{ width:20, height:20, borderRadius:"50%", background:"#DCFCE7", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                            <svg width="10" height="10" fill="none" stroke="#16A34A" strokeWidth="3" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/>
                            </svg>
                          </div>
                          <span style={{ fontFamily:"'SF Mono','Fira Code','Consolas',monospace", fontSize:13, fontWeight:700, color:"#374151" }}>#{inv.invoiceNumber}</span>
                        </div>
                      </td>
                      <td style={S.td}><span style={S.dateCell}>{fmtDate(inv.invoiceDate)}</span></td>
                      <td style={S.td}><span style={S.dateCell}>{fmtDate(inv.dueDate)}</span></td>
                      <td style={{ ...S.td, textAlign:"right", paddingRight:16 }}>
                        <span style={{ fontSize:13, fontWeight:700, color:"#15803D", fontVariantNumeric:"tabular-nums" }}>{money(inv.paid, inv.currency)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* How to use */}
        <div style={{ marginTop:24, background:"#fff", border:"1px solid #E5E7EB", borderRadius:8, padding:"20px 24px" }}>
          <p style={{ fontSize:11, fontWeight:700, color:"#9CA3AF", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:16 }}>How to use this portal</p>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:20 }}>
            <HowTo icon={
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/>
              </svg>
            } title="Set a payment date" body="Enter a date in the Pay by column for invoices you plan to pay. Your account manager is notified immediately." />
            <HowTo icon={
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
              </svg>
            } title="Raise a query" body="If an invoice looks incorrect, choose a reason in the Query column. Your query will be investigated within 2 business days." />
            <HowTo icon={
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h7.5M8.25 12h7.5m-7.5 5.25h4.5M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"/>
              </svg>
            } title="Add comments" body="Use the Comment column to leave a note on any invoice. Use batch select to apply a single response to multiple invoices at once." />
          </div>
          <p style={{ fontSize:11, color:"#9CA3AF", marginTop:16, paddingTop:14, borderTop:"1px solid #F3F4F6", lineHeight:1.7 }}>
            This is a secure, single-use link. Once submitted, this link closes. To request a new link or speak with your account manager, reply to the email you received.
          </p>
        </div>

      </div>
      <Footer />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Header({ org }: { org?: { name: string; logoUrl: string | null } | null }) {
  return (
    <header style={{ background:"#0D1117", padding:"0 16px", height:52, display:"flex", alignItems:"center", borderBottom:"1px solid #21262D" }}>
      <div style={{ maxWidth:1100, margin:"0 auto", width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          {org?.logoUrl ? (
            <img src={org.logoUrl} alt="" style={{ height:26, width:"auto", objectFit:"contain", borderRadius:3 }} />
          ) : (
            <div style={{ width:28, height:28, borderRadius:5, background:"#2563EB", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, color:"#fff", fontSize:13, flexShrink:0 }}>
              {org?.name?.charAt(0) ?? "A"}
            </div>
          )}
          <div>
            <div style={{ fontSize:13, fontWeight:600, color:"#F9FAFB", lineHeight:1.2 }}>{org?.name ?? "Account Portal"}</div>
            <div style={{ fontSize:10, color:"#6B7280", fontWeight:500, letterSpacing:"0.06em", textTransform:"uppercase" }}>Accounts Receivable</div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:"#6B7280" }}>
          <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>
          </svg>
          Secure link
        </div>
      </div>
    </header>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: "red" }) {
  return (
    <div style={{
      background: accent === "red" ? "#FFF5F5" : "#fff",
      border: `1px solid ${accent === "red" ? "#FECACA" : "#E5E7EB"}`,
      borderRadius:8, padding:"14px 16px",
    }}>
      <div style={{ fontSize:10, fontWeight:700, color:"#9CA3AF", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:6 }}>{label}</div>
      <div style={{ fontSize:18, fontWeight:800, color: accent === "red" ? "#B91C1C" : "#0D1117", fontVariantNumeric:"tabular-nums" }}>{value}</div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding:"0 18px", height:44, fontSize:13, fontWeight:500, border:"none", cursor:"pointer",
        borderBottom: active ? "2px solid #2563EB" : "2px solid transparent",
        color: active ? "#2563EB" : "#6B7280",
        background:"transparent", fontFamily:"inherit",
      }}
    >{children}</button>
  );
}

function Th({ children, align }: { children?: React.ReactNode; align?: "right" | "center" }) {
  return (
    <th style={{
      ...S.th, textAlign: align ?? "left",
      paddingLeft: align === "center" ? undefined : 8,
      paddingRight: align === "right" ? 12 : undefined,
    }}>{children}</th>
  );
}

function Checkbox({ checked, onChange, disabled, indeterminate }: {
  checked: boolean; onChange: () => void; disabled?: boolean; indeterminate?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (ref.current) (ref.current as any).indeterminate = indeterminate; }, [indeterminate]);
  const active = checked || indeterminate;
  return (
    <button
      ref={ref} role="checkbox" aria-checked={indeterminate ? "mixed" : checked}
      onClick={onChange} disabled={disabled}
      style={{
        width:16, height:16, borderRadius:3, border:"none", padding:0, cursor: disabled ? "not-allowed" : "pointer",
        background: disabled ? "#F3F4F6" : active ? "#2563EB" : "#fff",
        outline: active ? "none" : "1px solid #D1D5DB",
        display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {indeterminate && !checked && (
        <svg width="8" height="8" fill="none" stroke="#fff" strokeWidth="2.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14"/>
        </svg>
      )}
      {checked && (
        <svg width="8" height="8" fill="none" stroke="#fff" strokeWidth="3" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/>
        </svg>
      )}
    </button>
  );
}

function HowTo({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6, color:"#374151" }}>
        {icon}
        <span style={{ fontSize:13, fontWeight:600, color:"#374151" }}>{title}</span>
      </div>
      <p style={{ fontSize:12, color:"#6B7280", lineHeight:1.65, margin:0 }}>{body}</p>
    </div>
  );
}

function SummaryBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background:"#fff", border:"1px solid #E5E7EB", borderRadius:8, padding:"18px 24px", marginBottom:12 }}>
      <p style={{ fontSize:11, fontWeight:700, color:"#9CA3AF", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:12 }}>{title}</p>
      <div style={{ display:"flex", flexDirection:"column", gap:0 }}>{children}</div>
    </div>
  );
}

function SummaryRow({ left, right }: { left: string; right: React.ReactNode }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:"1px solid #F3F4F6" }}>
      <span style={{ fontFamily:"'SF Mono','Fira Code','Consolas',monospace", fontSize:13, fontWeight:700, color:"#374151" }}>{left}</span>
      <span style={{ fontSize:13, color:"#6B7280" }}>{right}</span>
    </div>
  );
}

function NextStep({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
      <span style={{ width:20, height:20, borderRadius:"50%", background:"#F3F4F6", color:"#6B7280", fontSize:11, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>{n}</span>
      <span style={{ fontSize:13, color:"#6B7280", lineHeight:1.6 }}>{children}</span>
    </li>
  );
}

function Footer() {
  return (
    <footer style={{ textAlign:"center", padding:"16px", fontSize:11, color:"#9CA3AF", borderTop:"1px solid #E5E7EB", background:"#fff", marginTop:16 }}>
      Powered by{" "}
      <a href="https://primeaccountax.com" target="_blank" rel="noopener noreferrer" style={{ fontWeight:600, color:"#6B7280", textDecoration:"none" }}>
        Prime Accountax
      </a>
      {" "}· Accounts Receivable Management
    </footer>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const S = {
  page: {
    minHeight:"100vh" as const,
    background:"#F0F2F5",
    fontFamily:"-apple-system,'Segoe UI',system-ui,sans-serif",
    display:"flex" as const,
    alignItems:"center" as const,
    justifyContent:"center" as const,
  },
  spinner: {
    width:28, height:28,
    border:"2px solid #E5E7EB",
    borderTopColor:"#6B7280",
    borderRadius:"50%",
    animation:"spin 0.8s linear infinite",
  } as React.CSSProperties,
  th: {
    fontSize:10, fontWeight:700, color:"#9CA3AF",
    letterSpacing:"0.07em", textTransform:"uppercase" as const,
    padding:"8px 8px", whiteSpace:"nowrap" as const,
  },
  td: {
    fontSize:13, color:"#374151",
    padding:"9px 8px",
    verticalAlign:"middle" as const,
  },
  dateCell: {
    fontSize:12, color:"#374151",
  } as React.CSSProperties,
  batchInput: {
    fontSize:12, padding:"5px 8px",
    border:"1px solid #E5E7EB", borderRadius:5,
    background:"#fff", color:"#374151",
    outline:"none", fontFamily:"inherit",
  } as React.CSSProperties,
  batchBtnActive: {
    fontSize:12, fontWeight:600, padding:"5px 12px",
    background:"#0D1117", color:"#fff", border:"none",
    borderRadius:5, cursor:"pointer", flexShrink:0,
    fontFamily:"inherit",
  } as React.CSSProperties,
  batchBtnDisabled: {
    fontSize:12, fontWeight:600, padding:"5px 12px",
    background:"#E5E7EB", color:"#9CA3AF", border:"none",
    borderRadius:5, cursor:"not-allowed", flexShrink:0,
    fontFamily:"inherit",
  } as React.CSSProperties,
  submitActive: {
    display:"flex", alignItems:"center", gap:8,
    background:"#2563EB", color:"#fff", border:"none",
    fontSize:13, fontWeight:600, padding:"8px 20px",
    borderRadius:6, cursor:"pointer", fontFamily:"inherit",
  } as React.CSSProperties,
  submitDisabled: {
    display:"flex", alignItems:"center", gap:8,
    background:"#E5E7EB", color:"#9CA3AF", border:"none",
    fontSize:13, fontWeight:600, padding:"8px 20px",
    borderRadius:6, cursor:"not-allowed", fontFamily:"inherit",
  } as React.CSSProperties,
  btnSpinner: {
    width:14, height:14,
    border:"2px solid rgba(255,255,255,0.3)",
    borderTopColor:"#fff",
    borderRadius:"50%",
    display:"inline-block",
    animation:"spin 0.7s linear infinite",
  } as React.CSSProperties,
};
