"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";

// ── Types ─────────────────────────────────────────────────────────────────────

interface BillLine {
  id: string;
  description?: string;
  accountName?: string;
  itemName?: string;
  quantity: number;
  unitPrice: number;
  lineSubtotal: number;
  lineTax: number;
  lineTotal: number;
}

interface Bill {
  id: string;
  billNumber?: string;
  billDate?: string;
  dueDate?: string;
  currency: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  balance: number;
  privateNote?: string;
  workflowStatus: string;
  supplier: { name: string; email?: string } | null;
  lines: BillLine[];
  notes?: string;
}

interface Comment {
  id: string;
  billId: string;
  body: string;
  authorName: string;
  channel: string;
  createdAt: string;
}

interface PortalData {
  org: { name: string; logoUrl?: string };
  token: { approverEmail: string; approverName?: string };
  bills: Bill[];
  comments: Comment[];
}

interface BillDecision {
  action: "approve" | "reject" | null;
  note: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function money(n: number | null | undefined, ccy: string) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-IE", { style:"currency", currency: ccy || "EUR", maximumFractionDigits:2 }).format(n);
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });
}

function fmtRelative(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function isOverdue(d?: string | null) {
  if (!d) return false;
  return new Date(d + "T00:00:00") < new Date(new Date().toDateString());
}

// Distribute bill-level tax proportionally across lines when per-line tax is missing
function lineTax(line: BillLine, bill: Bill): number {
  if ((line.lineTax ?? 0) > 0) return line.lineTax;
  const totalSub = bill.lines.reduce((s, l) => s + (l.lineSubtotal ?? 0), 0);
  if (!bill.taxTotal || totalSub === 0) return 0;
  return bill.taxTotal * ((line.lineSubtotal ?? 0) / totalSub);
}

// ── Shared sub-components (identical tokens to customer portal) ───────────────

function Header({ orgName, logoUrl, right }: { orgName: string; logoUrl?: string; right?: React.ReactNode }) {
  return (
    <header style={{ background:"#0D1117", height:52, padding:"0 16px", display:"flex", alignItems:"center", borderBottom:"1px solid #21262D", position:"sticky", top:0, zIndex:30, fontFamily:"-apple-system,'Segoe UI',system-ui,sans-serif" }}>
      <div style={{ maxWidth:1100, margin:"0 auto", width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          {logoUrl ? (
            <img src={logoUrl} alt="" style={{ height:26, width:"auto", objectFit:"contain", borderRadius:3 }} />
          ) : (
            <div style={{ width:28, height:28, borderRadius:5, background:"#2563EB", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, color:"#fff", fontSize:13 }}>
              {orgName.charAt(0)}
            </div>
          )}
          <div>
            <div style={{ fontSize:13, fontWeight:600, color:"#F9FAFB", lineHeight:1.2 }}>{orgName}</div>
            <div style={{ fontSize:10, color:"#6B7280", fontWeight:500, letterSpacing:"0.06em", textTransform:"uppercase" as const }}>Bill Approval Portal</div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          {right}
          <div style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:"#6B7280" }}>
            <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/></svg>
            Secure link
          </div>
        </div>
      </div>
    </header>
  );
}

function Footer({ orgName }: { orgName: string }) {
  return (
    <footer style={{ textAlign:"center", padding:"16px", fontSize:11, color:"#9CA3AF", borderTop:"1px solid #E5E7EB", background:"#fff", marginTop:16 }}>
      Powered by <span style={{ fontWeight:600, color:"#6B7280" }}>{orgName}</span> · Bill Approval Portal
    </footer>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: "red" | "green" }) {
  const bg     = accent === "red" ? "#FFF5F5" : accent === "green" ? "#F0FDF4" : "#fff";
  const border = accent === "red" ? "#FECACA" : accent === "green" ? "#BBF7D0" : "#E5E7EB";
  const color  = accent === "red" ? "#B91C1C" : accent === "green" ? "#15803D" : "#0D1117";
  return (
    <div style={{ background:bg, border:`1px solid ${border}`, borderRadius:8, padding:"14px 16px" }}>
      <div style={{ fontSize:10, fontWeight:700, color:"#9CA3AF", letterSpacing:"0.08em", textTransform:"uppercase" as const, marginBottom:6 }}>{label}</div>
      <div style={{ fontSize:18, fontWeight:800, color, fontVariantNumeric:"tabular-nums" }}>{value}</div>
    </div>
  );
}

function Checkbox({ checked, indeterminate, onChange, disabled }: { checked: boolean; indeterminate?: boolean; onChange: () => void; disabled?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (ref.current) (ref.current as any).indeterminate = indeterminate; }, [indeterminate]);
  const active = checked || indeterminate;
  return (
    <button ref={ref} role="checkbox" aria-checked={indeterminate ? "mixed" : checked} onClick={onChange} disabled={disabled}
      style={{ width:16, height:16, borderRadius:3, border:"none", padding:0, cursor: disabled ? "not-allowed" : "pointer", background: active ? "#2563EB" : "#fff", outline: active ? "none" : "1px solid #D1D5DB", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, opacity: disabled ? 0.4 : 1 }}
    >
      {indeterminate && !checked && <svg width="8" height="8" fill="none" stroke="#fff" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14"/></svg>}
      {checked && <svg width="8" height="8" fill="none" stroke="#fff" strokeWidth="3" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>}
    </button>
  );
}

// ── Bulk Reject Modal ─────────────────────────────────────────────────────────

function BulkRejectModal({ count, onClose, onConfirm }: { count: number; onClose: () => void; onConfirm: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <div style={{ position:"fixed", inset:0, zIndex:50, display:"flex", alignItems:"center", justifyContent:"center", padding:16, background:"rgba(0,0,0,0.55)", backdropFilter:"blur(2px)" }}>
      <div style={{ background:"#fff", borderRadius:8, border:"1px solid #E5E7EB", width:"100%", maxWidth:420, boxShadow:"0 20px 40px rgba(0,0,0,0.2)", fontFamily:"-apple-system,'Segoe UI',system-ui,sans-serif" }}>
        <div style={{ padding:"16px 20px", borderBottom:"1px solid #F3F4F6" }}>
          <p style={{ fontSize:15, fontWeight:700, color:"#0D1117", margin:0 }}>Reject {count} bill{count > 1 ? "s" : ""}</p>
          <p style={{ fontSize:12, color:"#9CA3AF", margin:"4px 0 0" }}>This reason will be applied to all selected bills.</p>
        </div>
        <div style={{ padding:"16px 20px" }}>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={4} autoFocus
            placeholder="e.g. Incorrect amount, missing PO reference…"
            style={{ width:"100%", fontSize:13, padding:"8px 10px", border:"1px solid #E5E7EB", borderRadius:5, background:"#F9FAFB", color:"#374151", outline:"none", resize:"none" as const, fontFamily:"inherit", boxSizing:"border-box" as const }}
          />
        </div>
        <div style={{ padding:"12px 20px", borderTop:"1px solid #F3F4F6", display:"flex", justifyContent:"flex-end", gap:8 }}>
          <button onClick={onClose} style={{ height:36, padding:"0 14px", fontSize:13, fontWeight:500, border:"1px solid #E5E7EB", borderRadius:5, background:"#fff", color:"#374151", cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
          <button onClick={() => onConfirm(note)} disabled={!note.trim()}
            style={{ height:36, padding:"0 14px", fontSize:13, fontWeight:600, border:"none", borderRadius:5, fontFamily:"inherit", background: note.trim() ? "#DC2626" : "#E5E7EB", color: note.trim() ? "#fff" : "#9CA3AF", cursor: note.trim() ? "pointer" : "not-allowed" }}
          >Reject selected</button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ApproverPortalPage() {
  const { token } = useParams<{ token: string }>();

  const [data, setData]                   = useState<PortalData | null>(null);
  const [loading, setLoading]             = useState(true);
  const [errorMsg, setErrorMsg]           = useState<string | null>(null);
  const [alreadyDecided, setAlreadyDecided] = useState<{ status: string } | null>(null);
  const [doneResult, setDoneResult]       = useState<{ approved: number; rejected: number } | null>(null);

  const [decisions, setDecisions]         = useState<Record<string, BillDecision>>({});
  const [fieldErrors, setFieldErrors]     = useState<Record<string, string>>({});
  const [selected, setSelected]           = useState<Set<string>>(new Set());
  const [expanded, setExpanded]           = useState<Set<string>>(new Set());
  const [chatOpen, setChatOpen]           = useState<Set<string>>(new Set());
  const [chatInputs, setChatInputs]       = useState<Record<string, string>>({});
  const [chatPosting, setChatPosting]     = useState<Record<string, boolean>>({});
  const [showBulkReject, setShowBulkReject] = useState(false);
  const [submitting, setSubmitting]       = useState(false);
  const [submitError, setSubmitError]     = useState("");

  const [billComments, setBillComments]   = useState<Record<string, Comment[]>>({});
  const [comments, setComments]           = useState<Comment[]>([]);
  const [commentBody, setCommentBody]     = useState("");
  const [posting, setPosting]             = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/approver/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error && !d.alreadyDecided) { setErrorMsg(d.error); return; }
        if (d.alreadyDecided) { setAlreadyDecided({ status: d.status }); setComments(d.comments ?? []); return; }
        setData(d);
        const grouped: Record<string, Comment[]> = {};
        for (const c of (d.comments ?? []) as Comment[]) {
          if (!grouped[c.billId]) grouped[c.billId] = [];
          grouped[c.billId].push(c);
        }
        setBillComments(grouped);
        const init: Record<string, BillDecision> = {};
        for (const b of d.bills ?? []) init[b.id] = { action: null, note: "" };
        setDecisions(init);
      })
      .catch(() => setErrorMsg("Failed to load. Please check your link or try again."))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [comments]);

  function patchDecision(id: string, patch: Partial<BillDecision>) {
    setDecisions(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    if (patch.action !== "reject") setFieldErrors(prev => { const n = { ...prev }; delete n[id]; return n; });
    if (patch.note?.trim()) setFieldErrors(prev => { const n = { ...prev }; delete n[id]; return n; });
  }

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleSelectAll(bills: Bill[]) {
    setSelected(prev => prev.size === bills.length ? new Set() : new Set(bills.map(b => b.id)));
  }

  function toggleExpand(id: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleChat(id: string) {
    setChatOpen(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function applyBulkApprove() {
    setDecisions(prev => { const n = { ...prev }; selected.forEach(id => { n[id] = { action:"approve", note: n[id]?.note ?? "" }; }); return n; });
    setSelected(new Set());
  }

  function applyBulkReject(note: string) {
    setDecisions(prev => { const n = { ...prev }; selected.forEach(id => { n[id] = { action:"reject", note }; }); return n; });
    setFieldErrors(prev => { const n = { ...prev }; selected.forEach(id => { if (note.trim()) delete n[id]; }); return n; });
    setSelected(new Set()); setShowBulkReject(false);
  }

  async function submit() {
    if (!data) return;
    const undecided = data.bills.filter(b => !decisions[b.id]?.action);
    if (undecided.length > 0) { setSubmitError(`${undecided.length} bill${undecided.length > 1 ? "s" : ""} still need a decision.`); return; }
    const errs: Record<string, string> = {};
    for (const b of data.bills) {
      if (decisions[b.id]?.action === "reject" && !decisions[b.id]?.note?.trim())
        errs[b.id] = "A reason is required when rejecting.";
    }
    if (Object.keys(errs).length > 0) { setFieldErrors(errs); setSubmitError("Please add a rejection reason to highlighted bills."); return; }
    setSubmitting(true); setSubmitError("");
    try {
      const billDecisions = data.bills.map(b => ({ billId: b.id, action: decisions[b.id].action, comment: decisions[b.id].note ?? "" }));
      const res = await fetch(`/api/approver/${token}/submit`, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ decisions: billDecisions }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Submission failed");
      setDoneResult({ approved: billDecisions.filter(x => x.action === "approve").length, rejected: billDecisions.filter(x => x.action === "reject").length });
    } catch (e: any) { setSubmitError(e.message); }
    finally { setSubmitting(false); }
  }

  async function postBillComment(billId: string): Promise<void> {
    const body = chatInputs[billId]?.trim();
    if (!body || chatPosting[billId]) return;
    setChatPosting(prev => ({ ...prev, [billId]: true }));
    try {
      const res = await fetch(`/api/approver/${token}/comment`, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ body, billId }) });
      if (res.ok) { const c: Comment = await res.json(); setBillComments(prev => ({ ...prev, [billId]: [...(prev[billId] ?? []), c] })); setChatInputs(prev => ({ ...prev, [billId]: "" })); }
    } finally { setChatPosting(prev => ({ ...prev, [billId]: false })); }
  }

  async function postComment(): Promise<void> {
    if (!commentBody.trim() || posting) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/approver/${token}/comment`, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ body: commentBody.trim() }) });
      if (res.ok) { const c: Comment = await res.json(); setComments(prev => [...prev, c]); setCommentBody(""); }
    } finally { setPosting(false); }
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) return (
    <div style={{ minHeight:"100vh", background:"#F0F2F5", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"-apple-system,'Segoe UI',system-ui,sans-serif" }}>
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:12 }}>
        <div style={{ width:28, height:28, border:"2px solid #E5E7EB", borderTopColor:"#6B7280", borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
        <span style={{ fontSize:13, color:"#9CA3AF" }}>Loading approval request…</span>
      </div>
    </div>
  );

  if (errorMsg) return (
    <div style={{ minHeight:"100vh", background:"#F0F2F5", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"-apple-system,'Segoe UI',system-ui,sans-serif" }}>
      <div style={{ background:"#fff", border:"1px solid #E5E7EB", borderRadius:8, padding:"32px 24px", textAlign:"center", maxWidth:360 }}>
        <div style={{ width:44, height:44, borderRadius:"50%", background:"#FEE2E2", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 14px" }}>
          <svg width="20" height="20" fill="none" stroke="#DC2626" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/></svg>
        </div>
        <p style={{ fontSize:15, fontWeight:700, color:"#0D1117", marginBottom:6 }}>Link Unavailable</p>
        <p style={{ fontSize:13, color:"#6B7280", lineHeight:1.6 }}>{errorMsg}</p>
      </div>
    </div>
  );

  // ── Already decided ───────────────────────────────────────────────────────

  if (alreadyDecided) return (
    <div style={{ minHeight:"100vh", background:"#F0F2F5", fontFamily:"-apple-system,'Segoe UI',system-ui,sans-serif", display:"flex", flexDirection:"column" }}>
      <Header orgName="Approval Portal" />
      <div style={{ maxWidth:640, margin:"0 auto", width:"100%", padding:"24px 16px", flex:1, display:"flex", flexDirection:"column", gap:12 }}>
        <div style={{ background:"#fff", border:"1px solid #E5E7EB", borderRadius:8, padding:"20px 24px", display:"flex", gap:14, alignItems:"flex-start" }}>
          <div style={{ width:36, height:36, borderRadius:"50%", background:"#DCFCE7", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <svg width="16" height="16" fill="none" stroke="#16A34A" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
          </div>
          <div>
            <p style={{ fontSize:15, fontWeight:600, color:"#0D1117", marginBottom:4 }}>Already {alreadyDecided.status}</p>
            <p style={{ fontSize:13, color:"#6B7280" }}>This approval request has already been processed. You can still send messages below.</p>
          </div>
        </div>
        <div style={{ background:"#fff", border:"1px solid #E5E7EB", borderRadius:8, overflow:"hidden" }}>
          <div style={{ padding:"12px 16px", borderBottom:"1px solid #F3F4F6", fontSize:13, fontWeight:600, color:"#374151" }}>Activity</div>
          {comments.length > 0 ? (
            <div style={{ padding:"12px 16px 4px", display:"flex", flexDirection:"column", gap:10, maxHeight:240, overflowY:"auto", borderBottom:"1px solid #F3F4F6" }}>
              {comments.map(c => (
                <div key={c.id} style={{ display:"flex", gap:8 }}>
                  <div style={{ width:6, height:6, borderRadius:"50%", background: c.channel === "approver" ? "#818CF8" : c.channel === "email" ? "#F59E0B" : "#60A5FA", flexShrink:0, marginTop:6 }} />
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex", gap:8, marginBottom:2 }}><span style={{ fontSize:11, fontWeight:600, color:"#374151" }}>{c.authorName}</span><span style={{ fontSize:10, color:"#9CA3AF" }}>{fmtRelative(c.createdAt)}</span></div>
                    <p style={{ fontSize:13, color:"#374151", margin:0, whiteSpace:"pre-wrap" }}>{c.body}</p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          ) : <div style={{ padding:"12px 16px", fontSize:12, color:"#9CA3AF", borderBottom:"1px solid #F3F4F6" }}>No messages yet.</div>}
          <div style={{ padding:"12px 16px", display:"flex", gap:8 }}>
            <input type="text" value={commentBody} onChange={e => setCommentBody(e.target.value)} onKeyDown={e => { if (e.key === "Enter") postComment(); }}
              placeholder="Ask the finance team a question…"
              style={{ flex:1, fontSize:12, padding:"7px 10px", border:"1px solid #E5E7EB", borderRadius:5, background:"#F9FAFB", color:"#374151", outline:"none", fontFamily:"inherit" }}
            />
            <button onClick={postComment} disabled={posting || !commentBody.trim()}
              style={{ width:34, height:34, display:"flex", alignItems:"center", justifyContent:"center", background:"#2563EB", border:"none", borderRadius:5, cursor:"pointer", opacity: posting || !commentBody.trim() ? 0.4 : 1 }}>
              <svg width="13" height="13" fill="none" stroke="#fff" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/></svg>
            </button>
          </div>
        </div>
      </div>
      <Footer orgName="Approval Portal" />
    </div>
  );

  // ── Done ──────────────────────────────────────────────────────────────────

  if (doneResult) {
    const allApproved = doneResult.rejected === 0;
    const allRejected = doneResult.approved === 0;
    return (
      <div style={{ minHeight:"100vh", background:"#F0F2F5", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"-apple-system,'Segoe UI',system-ui,sans-serif" }}>
        <div style={{ background:"#fff", border:"1px solid #E5E7EB", borderRadius:8, padding:"40px 32px", textAlign:"center", maxWidth:380 }}>
          <div style={{ width:52, height:52, borderRadius:"50%", background: allRejected ? "#FEE2E2" : "#DCFCE7", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px" }}>
            {allRejected
              ? <svg width="22" height="22" fill="none" stroke="#DC2626" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
              : <svg width="22" height="22" fill="none" stroke="#16A34A" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
            }
          </div>
          <p style={{ fontSize:18, fontWeight:800, color:"#0D1117", marginBottom:8 }}>
            {allApproved ? "All Bills Approved" : allRejected ? "All Bills Rejected" : "Decisions Submitted"}
          </p>
          {!allApproved && !allRejected && (
            <div style={{ display:"flex", justifyContent:"center", gap:8, margin:"12px 0" }}>
              <span style={{ fontSize:12, fontWeight:700, padding:"4px 10px", background:"#DCFCE7", color:"#166534", borderRadius:5 }}>{doneResult.approved} approved</span>
              <span style={{ fontSize:12, fontWeight:700, padding:"4px 10px", background:"#FEE2E2", color:"#991B1B", borderRadius:5 }}>{doneResult.rejected} rejected</span>
            </div>
          )}
          <p style={{ fontSize:13, color:"#6B7280", lineHeight:1.65 }}>Your decisions have been recorded. The finance team has been notified.</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { org, bills } = data;
  const isBatch      = bills.length > 1;
  const ccy          = bills[0]?.currency ?? "EUR";
  const grandTotal   = bills.reduce((s, b) => s + (b.total ?? 0), 0);
  const decidedCount = bills.filter(b => decisions[b.id]?.action != null).length;
  const allDecided   = decidedCount === bills.length;
  const allSelected  = selected.size === bills.length && bills.length > 0;
  const someSelected = selected.size > 0 && !allSelected;
  const approvedAmt  = bills.filter(b => decisions[b.id]?.action === "approve").reduce((s, b) => s + b.total, 0);
  const rejectedAmt  = bills.filter(b => decisions[b.id]?.action === "reject").reduce((s, b) => s + b.total, 0);

  // ── Main table view ───────────────────────────────────────────────────────

  return (
    <div style={{ minHeight:"100vh", background:"#F0F2F5", fontFamily:"-apple-system,'Segoe UI',system-ui,sans-serif", display:"flex", flexDirection:"column" }}>
      <Header orgName={org.name} logoUrl={org.logoUrl}
        right={isBatch ? (
          <span style={{ fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20, background: allDecided ? "rgba(22,163,74,0.2)" : "rgba(255,255,255,0.1)", color: allDecided ? "#4ADE80" : "#9CA3AF" }}>
            {decidedCount}/{bills.length} decided
          </span>
        ) : undefined}
      />

      <div style={{ maxWidth:1100, margin:"0 auto", width:"100%", padding:"24px 16px", flex:1 }}>

        {/* Heading */}
        <div style={{ marginBottom:20 }}>
          <h1 style={{ fontSize:20, fontWeight:700, color:"#0D1117", marginBottom:2 }}>
            {isBatch ? `${bills.length} Bills for Approval` : "Bill for Approval"}
          </h1>
          <p style={{ fontSize:13, color:"#6B7280" }}>
            Reviewing as <strong style={{ color:"#374151" }}>{data.token.approverName || data.token.approverEmail}</strong> · {org.name}
          </p>
        </div>

        {/* KPI strip */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:24 }}>
          <Kpi label="Total (Inc. VAT)" value={money(grandTotal, ccy)} />
          <Kpi label="Bills"            value={String(bills.length)} />
          <Kpi label="Approved"         value={approvedAmt > 0 ? money(approvedAmt, ccy) : String(bills.filter(b => decisions[b.id]?.action === "approve").length)} accent={approvedAmt > 0 ? "green" : undefined} />
          <Kpi label="Rejected"         value={rejectedAmt > 0 ? money(rejectedAmt, ccy) : String(bills.filter(b => decisions[b.id]?.action === "reject").length)} accent={rejectedAmt > 0 ? "red" : undefined} />
        </div>

        {/* Table card */}
        <div style={{ background:"#fff", border:"1px solid #E5E7EB", borderRadius:8, overflow:"hidden" }}>

          {/* Batch toolbar — same pattern as customer portal */}
          <div style={{ padding:"10px 16px", borderBottom:"1px solid #E5E7EB", background:"#F9FAFB", display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" as const }}>
            <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", flexShrink:0 }}>
              <Checkbox checked={allSelected} indeterminate={someSelected} onChange={() => toggleSelectAll(bills)} />
              <span style={{ fontSize:12, fontWeight:500, color:"#374151" }}>
                {selected.size > 0 ? `${selected.size} selected` : "Select all"}
              </span>
            </label>

            <div style={{ width:1, height:16, background:"#D1D5DB", flexShrink:0, margin:"0 4px" }} />

            <button onClick={applyBulkApprove} disabled={selected.size === 0}
              style={{ display:"flex", alignItems:"center", gap:5, height:30, padding:"0 12px", fontSize:12, fontWeight:600, border:"none", borderRadius:5, fontFamily:"inherit", cursor: selected.size > 0 ? "pointer" : "not-allowed", background: selected.size > 0 ? "#F0FDF4" : "#F9FAFB", color: selected.size > 0 ? "#15803D" : "#9CA3AF", outline: selected.size > 0 ? "1px solid #BBF7D0" : "1px solid #E5E7EB" }}>
              <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
              Approve selected
            </button>

            <button onClick={() => selected.size > 0 && setShowBulkReject(true)} disabled={selected.size === 0}
              style={{ display:"flex", alignItems:"center", gap:5, height:30, padding:"0 12px", fontSize:12, fontWeight:600, border:"none", borderRadius:5, fontFamily:"inherit", cursor: selected.size > 0 ? "pointer" : "not-allowed", background: selected.size > 0 ? "#FFF5F5" : "#F9FAFB", color: selected.size > 0 ? "#B91C1C" : "#9CA3AF", outline: selected.size > 0 ? "1px solid #FECACA" : "1px solid #E5E7EB" }}>
              <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
              Reject selected
            </button>

            {/* Progress bar */}
            <div style={{ flex:1, minWidth:80 }}>
              <div style={{ height:4, background:"#F3F4F6", borderRadius:2, overflow:"hidden" }}>
                <div style={{ height:"100%", background:"#2563EB", borderRadius:2, width:`${bills.length > 0 ? (decidedCount / bills.length) * 100 : 0}%`, transition:"width 0.3s" }} />
              </div>
            </div>
            <span style={{ fontSize:12, color:"#9CA3AF", flexShrink:0 }}>{decidedCount}/{bills.length}</span>
          </div>

          {/* Table */}
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"fixed" }}>
              <colgroup>
                <col style={{ width:44 }} />   {/* checkbox */}
                <col style={{ width:36 }} />   {/* expand arrow */}
                <col style={{ width:110 }} />  {/* bill # */}
                <col />                         {/* supplier — flex */}
                <col style={{ width:104 }} />  {/* bill date */}
                <col style={{ width:104 }} />  {/* due date */}
                <col style={{ width:108 }} />  {/* ex. vat */}
                <col style={{ width:90 }} />   {/* vat */}
                <col style={{ width:112 }} />  {/* inc. vat */}
                <col />                         {/* note — flex */}
                <col style={{ width:190 }} />  {/* approve / reject */}
              </colgroup>
              <thead>
                <tr style={{ background:"#F9FAFB", borderBottom:"1px solid #E5E7EB" }}>
                  <th style={TH} />
                  <th style={TH} />
                  <TH2>Bill #</TH2>
                  <TH2>Supplier</TH2>
                  <TH2>Bill date</TH2>
                  <TH2>Due date</TH2>
                  <TH2 right>Ex. VAT</TH2>
                  <TH2 right>VAT</TH2>
                  <TH2 right>Inc. VAT</TH2>
                  <TH2>Note</TH2>
                  <TH2 center>Decision</TH2>
                </tr>
              </thead>
              <tbody>
                {bills.map((bill, idx) => {
                  const dec      = decisions[bill.id] ?? { action: null, note: "" };
                  const isSelected  = selected.has(bill.id);
                  const isExpanded  = expanded.has(bill.id);
                  const isChatOpen  = chatOpen.has(bill.id);
                  const overdue     = isOverdue(bill.dueDate);
                  const hasLines    = bill.lines.length > 0;
                  const billTotalSub = bill.lines.reduce((s, l) => s + (l.lineSubtotal ?? 0), 0) || (bill.total - (bill.taxTotal ?? 0));
                  const fieldErr = fieldErrors[bill.id];

                  const borderLeft =
                    dec.action === "approve" ? "3px solid #16A34A" :
                    dec.action === "reject"  ? "3px solid #DC2626" :
                    isSelected               ? "3px solid #2563EB" : "3px solid transparent";
                  const rowBg =
                    dec.action === "approve" ? "#F0FDF4" :
                    dec.action === "reject"  ? "#FFF5F5" :
                    isSelected               ? "#EFF6FF" :
                    idx % 2 === 1            ? "#FAFAFA" : "#fff";

                  return (
                    <>
                      {/* ── Main bill row ── */}
                      <tr key={bill.id} style={{ borderBottom: isExpanded ? "none" : "1px solid #F3F4F6", background:rowBg, borderLeft }}>

                        {/* Checkbox */}
                        <td style={{ ...TD, paddingLeft:12 }}>
                          <Checkbox checked={isSelected} onChange={() => toggleSelect(bill.id)} />
                        </td>

                        {/* Expand arrow */}
                        <td style={{ ...TD, paddingLeft:4, paddingRight:0 }}>
                          {hasLines && (
                            <button onClick={() => toggleExpand(bill.id)}
                              title={isExpanded ? "Hide line items" : "Show line items"}
                              style={{ width:24, height:24, display:"flex", alignItems:"center", justifyContent:"center", background:"none", border:"none", cursor:"pointer", borderRadius:4, color:"#9CA3AF" }}>
                              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{ transform: isExpanded ? "rotate(90deg)" : "none", transition:"transform 0.15s" }}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/>
                              </svg>
                            </button>
                          )}
                        </td>

                        {/* Bill # */}
                        <td style={{ ...TD, paddingLeft:6 }}>
                          <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                            <span style={{ fontFamily:"'SF Mono','Fira Code','Consolas',monospace", fontSize:13, fontWeight:700, color:"#0D1117" }}>
                              #{bill.billNumber ?? bill.id.slice(0, 8)}
                            </span>
                            <div style={{ display:"flex", gap:4, flexWrap:"wrap" as const }}>
                              {dec.action === "approve" && <span style={{ fontSize:10, fontWeight:700, padding:"1px 5px", background:"#DCFCE7", color:"#166534", borderRadius:3 }}>Approved</span>}
                              {dec.action === "reject"  && <span style={{ fontSize:10, fontWeight:700, padding:"1px 5px", background:"#FEE2E2", color:"#991B1B", borderRadius:3 }}>Rejected</span>}
                            </div>
                          </div>
                        </td>

                        {/* Supplier */}
                        <td style={TD}>
                          <span style={{ fontSize:13, color:"#374151" }}>{bill.supplier?.name ?? "—"}</span>
                        </td>

                        {/* Bill date */}
                        <td style={TD}><span style={{ fontSize:12, color:"#374151" }}>{fmtDate(bill.billDate)}</span></td>

                        {/* Due date */}
                        <td style={TD}>
                          <span style={{ fontSize:12, color: overdue ? "#B91C1C" : "#374151", fontWeight: overdue ? 600 : 400 }}>
                            {fmtDate(bill.dueDate)}
                            {overdue && <span style={{ display:"block", fontSize:10, fontWeight:700, color:"#B91C1C" }}>Overdue</span>}
                          </span>
                        </td>

                        {/* Ex. VAT */}
                        <td style={{ ...TD, textAlign:"right", paddingRight:8 }}>
                          <span style={{ fontSize:13, color:"#6B7280", fontVariantNumeric:"tabular-nums" }}>{money(billTotalSub, ccy)}</span>
                        </td>

                        {/* VAT */}
                        <td style={{ ...TD, textAlign:"right", paddingRight:8 }}>
                          <span style={{ fontSize:13, color:"#6B7280", fontVariantNumeric:"tabular-nums" }}>{money(bill.taxTotal, ccy)}</span>
                        </td>

                        {/* Inc. VAT */}
                        <td style={{ ...TD, textAlign:"right", paddingRight:12 }}>
                          <span style={{ fontSize:13, fontWeight:800, color:"#0D1117", fontVariantNumeric:"tabular-nums" }}>{money(bill.total, ccy)}</span>
                        </td>

                        {/* Note */}
                        <td style={TD}>
                          <input type="text" value={dec.note}
                            onChange={e => patchDecision(bill.id, { note: e.target.value })}
                            placeholder={dec.action === "reject" ? "Reason (required)…" : "Add a note…"}
                            style={{
                              width:"100%", fontSize:12, padding:"5px 8px",
                              border: fieldErr ? "1px solid #FCA5A5" : "1px solid #E5E7EB",
                              borderRadius:5, background: fieldErr ? "#FFF5F5" : "#fff",
                              color:"#374151", outline:"none", fontFamily:"inherit", boxSizing:"border-box" as const,
                            }}
                          />
                          {fieldErr && <p style={{ fontSize:10, color:"#DC2626", margin:"2px 0 0" }}>{fieldErr}</p>}
                        </td>

                        {/* Approve / Reject */}
                        <td style={{ ...TD, paddingRight:12 }}>
                          <div style={{ display:"flex", gap:6 }}>
                            <button onClick={() => patchDecision(bill.id, { action: dec.action === "approve" ? null : "approve" })}
                              style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:4, height:30, border:"none", borderRadius:5, cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:600, transition:"background 0.12s",
                                background: dec.action === "approve" ? "#16A34A" : "#F0FDF4",
                                color:      dec.action === "approve" ? "#fff"    : "#15803D",
                                outline:    dec.action === "approve" ? "none"    : "1px solid #BBF7D0",
                              }}>
                              <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
                              Approve
                            </button>
                            <button onClick={() => patchDecision(bill.id, { action: dec.action === "reject" ? null : "reject", ...(dec.action === "reject" ? {} : {}) })}
                              style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:4, height:30, border:"none", borderRadius:5, cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:600, transition:"background 0.12s",
                                background: dec.action === "reject" ? "#DC2626" : "#FFF5F5",
                                color:      dec.action === "reject" ? "#fff"    : "#B91C1C",
                                outline:    dec.action === "reject" ? "none"    : "1px solid #FECACA",
                              }}>
                              <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                              Reject
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* ── Drawer: line items ── */}
                      {isExpanded && (
                        <tr style={{ background: rowBg, borderBottom:"1px solid #F3F4F6", borderLeft }}>
                          <td colSpan={11} style={{ padding:0 }}>
                            <div style={{ margin:"0 16px 12px 96px", background:"#F9FAFB", border:"1px solid #E5E7EB", borderRadius:6, overflow:"hidden" }}>

                              {/* Drawer header */}
                              <div style={{ padding:"8px 12px", borderBottom:"1px solid #E5E7EB", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                                <span style={{ fontSize:11, fontWeight:700, color:"#6B7280", letterSpacing:"0.06em", textTransform:"uppercase" as const }}>
                                  Line items
                                </span>
                                <span style={{ fontSize:11, color:"#9CA3AF" }}>All amounts <strong style={{ color:"#6B7280" }}>Ex. VAT</strong> · Total row shows <strong style={{ color:"#6B7280" }}>Inc. VAT</strong></span>
                              </div>

                              {/* Line items table */}
                              <div style={{ overflowX:"auto" }}>
                                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                                  <thead>
                                    <tr style={{ borderBottom:"1px solid #E5E7EB" }}>
                                      {["Description","Account / Item","Qty","Unit price","Ex. VAT","VAT","Inc. VAT"].map((h, i) => (
                                        <th key={h} style={{ fontSize:10, fontWeight:700, color:"#9CA3AF", letterSpacing:"0.07em", textTransform:"uppercase" as const, padding:"7px 10px", textAlign: i >= 2 ? "right" as const : "left" as const, whiteSpace:"nowrap" as const, background:"#F9FAFB" }}>{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {bill.lines.map((line, li) => {
                                      const lt  = lineTax(line, bill);
                                      const inc = (line.lineSubtotal ?? 0) + lt;
                                      return (
                                        <tr key={line.id} style={{ borderBottom:"1px solid #F3F4F6", background: li % 2 === 1 ? "#fff" : "#FAFAFA" }}>
                                          <td style={{ padding:"8px 10px", fontSize:12, color:"#374151", maxWidth:200 }}>{line.description || "—"}</td>
                                          <td style={{ padding:"8px 10px", fontSize:11, color:"#9CA3AF" }}>{line.accountName || line.itemName || "—"}</td>
                                          <td style={{ padding:"8px 10px", fontSize:12, color:"#374151", textAlign:"right", fontVariantNumeric:"tabular-nums" }}>{line.quantity}</td>
                                          <td style={{ padding:"8px 10px", fontSize:12, color:"#374151", textAlign:"right", fontVariantNumeric:"tabular-nums" }}>{money(line.unitPrice, ccy)}</td>
                                          <td style={{ padding:"8px 10px", fontSize:12, color:"#374151", textAlign:"right", fontVariantNumeric:"tabular-nums" }}>{money(line.lineSubtotal, ccy)}</td>
                                          <td style={{ padding:"8px 10px", fontSize:12, color:"#9CA3AF", textAlign:"right", fontVariantNumeric:"tabular-nums" }}>{money(lt, ccy)}</td>
                                          <td style={{ padding:"8px 10px", fontSize:12, fontWeight:700, color:"#0D1117", textAlign:"right", fontVariantNumeric:"tabular-nums" }}>{money(inc, ccy)}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                  {/* Totals row */}
                                  <tfoot>
                                    <tr style={{ borderTop:"2px solid #E5E7EB", background:"#F9FAFB" }}>
                                      <td colSpan={4} style={{ padding:"8px 10px", fontSize:11, fontWeight:700, color:"#9CA3AF", textTransform:"uppercase" as const, letterSpacing:"0.05em" }}>Total</td>
                                      <td style={{ padding:"8px 10px", fontSize:12, fontWeight:700, color:"#374151", textAlign:"right", fontVariantNumeric:"tabular-nums" }}>{money(billTotalSub, ccy)}</td>
                                      <td style={{ padding:"8px 10px", fontSize:12, fontWeight:700, color:"#374151", textAlign:"right", fontVariantNumeric:"tabular-nums" }}>{money(bill.taxTotal, ccy)}</td>
                                      <td style={{ padding:"8px 10px", fontSize:13, fontWeight:800, color:"#0D1117", textAlign:"right", fontVariantNumeric:"tabular-nums" }}>{money(bill.total, ccy)}</td>
                                    </tr>
                                  </tfoot>
                                </table>
                              </div>

                              {/* Private note */}
                              {bill.privateNote && (
                                <div style={{ margin:"0 10px 10px", padding:"10px 12px", background:"#FFFBEB", border:"1px solid #FDE68A", borderRadius:5 }}>
                                  <p style={{ fontSize:10, fontWeight:700, color:"#92400E", letterSpacing:"0.06em", textTransform:"uppercase" as const, margin:"0 0 4px" }}>Note from Finance Team</p>
                                  <p style={{ fontSize:12, color:"#78350F", margin:0, whiteSpace:"pre-wrap" }}>{bill.privateNote}</p>
                                </div>
                              )}

                              {/* Per-bill chat (collapsible) */}
                              <div style={{ borderTop:"1px solid #E5E7EB" }}>
                                <button onClick={() => toggleChat(bill.id)}
                                  style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 12px", background:"none", border:"none", cursor:"pointer", fontSize:11, color:"#9CA3AF", fontFamily:"inherit" }}>
                                  <span style={{ display:"flex", alignItems:"center", gap:5 }}>
                                    <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"/></svg>
                                    {(billComments[bill.id]?.length ?? 0) > 0 ? `Messages (${billComments[bill.id].length})` : "Ask about this bill"}
                                  </span>
                                  <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ transform: isChatOpen ? "rotate(90deg)" : "none", transition:"transform 0.12s" }}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
                                </button>
                                {isChatOpen && (
                                  <div style={{ borderTop:"1px solid #E5E7EB" }}>
                                    {(billComments[bill.id]?.length ?? 0) > 0 && (
                                      <div style={{ padding:"10px 12px 4px", display:"flex", flexDirection:"column", gap:8, maxHeight:160, overflowY:"auto" }}>
                                        {billComments[bill.id].map(c => (
                                          <div key={c.id} style={{ display:"flex", gap:7 }}>
                                            <div style={{ width:5, height:5, borderRadius:"50%", background: c.channel === "approver" ? "#818CF8" : c.channel === "email" ? "#F59E0B" : "#60A5FA", flexShrink:0, marginTop:5 }} />
                                            <div>
                                              <span style={{ fontSize:10, fontWeight:600, color:"#374151", marginRight:6 }}>{c.authorName}</span>
                                              <span style={{ fontSize:10, color:"#9CA3AF" }}>{fmtRelative(c.createdAt)}</span>
                                              <p style={{ fontSize:12, color:"#374151", margin:"2px 0 0", whiteSpace:"pre-wrap" }}>{c.body}</p>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    <div style={{ padding:"8px 12px", display:"flex", gap:6 }}>
                                      <input type="text" value={chatInputs[bill.id] ?? ""}
                                        onChange={e => setChatInputs(prev => ({ ...prev, [bill.id]: e.target.value }))}
                                        onKeyDown={e => { if (e.key === "Enter") postBillComment(bill.id); }}
                                        placeholder="Ask about this bill…"
                                        style={{ flex:1, fontSize:12, padding:"5px 8px", border:"1px solid #E5E7EB", borderRadius:5, background:"#fff", color:"#374151", outline:"none", fontFamily:"inherit" }}
                                      />
                                      <button onClick={() => postBillComment(bill.id)} disabled={chatPosting[bill.id] || !chatInputs[bill.id]?.trim()}
                                        style={{ width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center", background:"#2563EB", border:"none", borderRadius:5, cursor:"pointer", opacity: chatPosting[bill.id] || !chatInputs[bill.id]?.trim() ? 0.4 : 1 }}>
                                        <svg width="12" height="12" fill="none" stroke="#fff" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/></svg>
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>

                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Submit footer — same pattern as customer portal */}
          <div style={{ padding:"12px 16px", borderTop:"1px solid #E5E7EB", background:"#F9FAFB", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
            <span style={{ fontSize:13, color:"#6B7280" }}>
              {decidedCount > 0
                ? <><strong style={{ color:"#374151" }}>{decidedCount}</strong> of {bills.length} bill{bills.length !== 1 ? "s" : ""} decided</>
                : "Approve or reject each bill to submit your response"
              }
            </span>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              {submitError && (
                <span style={{ fontSize:12, color:"#DC2626" }}>{submitError}</span>
              )}
              <button onClick={submit} disabled={submitting || !allDecided}
                style={{ display:"flex", alignItems:"center", gap:7, height:38, padding:"0 20px", fontSize:13, fontWeight:600, border:"none", borderRadius:6, fontFamily:"inherit", cursor: allDecided ? "pointer" : "not-allowed",
                  background: allDecided ? "#2563EB" : "#E5E7EB",
                  color:      allDecided ? "#fff"    : "#9CA3AF",
                }}>
                {submitting && <div style={{ width:13, height:13, border:"2px solid rgba(255,255,255,0.3)", borderTopColor:"#fff", borderRadius:"50%", animation:"spin 0.7s linear infinite" }} />}
                {submitting ? "Submitting…" : allDecided ? `Submit ${bills.length > 1 ? `all ${bills.length} ` : ""}decision${bills.length > 1 ? "s" : ""}` : `${bills.length - decidedCount} bill${bills.length - decidedCount !== 1 ? "s" : ""} remaining`}
              </button>
            </div>
          </div>

        </div>
      </div>

      <Footer orgName={org.name} />

      {showBulkReject && (
        <BulkRejectModal count={selected.size} onClose={() => setShowBulkReject(false)} onConfirm={applyBulkReject} />
      )}
    </div>
  );
}

// ── Table style constants ─────────────────────────────────────────────────────

const TH: React.CSSProperties = {
  fontSize:10, fontWeight:700, color:"#9CA3AF",
  letterSpacing:"0.07em", textTransform:"uppercase",
  padding:"8px 8px", whiteSpace:"nowrap",
};

const TD: React.CSSProperties = {
  fontSize:13, color:"#374151",
  padding:"10px 8px",
  verticalAlign:"middle",
};

function TH2({ children, right, center }: { children?: React.ReactNode; right?: boolean; center?: boolean }) {
  return (
    <th style={{ ...TH, textAlign: center ? "center" : right ? "right" : "left", paddingRight: right ? 12 : undefined }}>
      {children}
    </th>
  );
}
