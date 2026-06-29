"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";

// ── Types ─────────────────────────────────────────────────────────────────────

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
  lines: {
    id: string;
    description?: string;
    accountName?: string;
    itemName?: string;
    quantity: number;
    unitPrice: number;
    lineSubtotal: number;
    lineTax: number;
    lineTotal: number;
  }[];
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

function money(amount: number | null | undefined, currency: string) {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-IE", {
    style: "currency", currency: currency || "EUR", maximumFractionDigits: 2,
  }).format(Math.abs(amount));
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
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

// ── Shared Header (same as customer portal) ───────────────────────────────────

function Header({ orgName, logoUrl, right }: { orgName: string; logoUrl?: string; right?: React.ReactNode }) {
  return (
    <header style={{ background:"#0D1117", height:52, padding:"0 16px", display:"flex", alignItems:"center", borderBottom:"1px solid #21262D", position:"sticky", top:0, zIndex:30 }}>
      <div style={{ maxWidth:860, margin:"0 auto", width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
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
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {right}
          <div style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:"#6B7280" }}>
            <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>
            </svg>
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

// ── Checkbox ──────────────────────────────────────────────────────────────────

function Checkbox({ checked, indeterminate, onChange }: { checked: boolean; indeterminate?: boolean; onChange: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (ref.current) (ref.current as any).indeterminate = indeterminate; }, [indeterminate]);
  const active = checked || indeterminate;
  return (
    <button
      ref={ref} role="checkbox" aria-checked={indeterminate ? "mixed" : checked}
      onClick={onChange}
      style={{
        width:16, height:16, borderRadius:3, border:"none", padding:0, cursor:"pointer",
        background: active ? "#2563EB" : "#fff",
        outline: active ? "none" : "1px solid #D1D5DB",
        display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
      }}
    >
      {indeterminate && !checked && (
        <svg width="8" height="8" fill="none" stroke="#fff" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14"/></svg>
      )}
      {checked && (
        <svg width="8" height="8" fill="none" stroke="#fff" strokeWidth="3" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
      )}
    </button>
  );
}

// ── Bill Card ─────────────────────────────────────────────────────────────────

function BillCard({
  bill, decision, selected, fieldError, comments,
  onToggleSelect, onSetDecision, onSetNote, onPostComment,
}: {
  bill: Bill; decision: BillDecision; selected: boolean; fieldError?: string;
  comments: Comment[];
  onToggleSelect: () => void;
  onSetDecision: (a: "approve" | "reject" | null) => void;
  onSetNote: (n: string) => void;
  onPostComment: (body: string) => Promise<void>;
}) {
  const [expanded, setExpanded]     = useState(false);
  const [chatOpen, setChatOpen]     = useState(false);
  const [chatInput, setChatInput]   = useState("");
  const [chatPosting, setChatPosting] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [comments]);

  async function postMsg() {
    if (!chatInput.trim() || chatPosting) return;
    setChatPosting(true);
    try { await onPostComment(chatInput.trim()); setChatInput(""); }
    finally { setChatPosting(false); }
  }

  const ccy = bill.currency;
  const totalSub = bill.lines.reduce((s, l) => s + (l.lineSubtotal ?? 0), 0);
  const getLineTax = (l: Bill["lines"][0]) => {
    if ((l.lineTax ?? 0) > 0) return l.lineTax;
    if (!bill.taxTotal || totalSub === 0) return 0;
    return bill.taxTotal * ((l.lineSubtotal ?? 0) / totalSub);
  };

  const borderLeft =
    decision.action === "approve" ? "3px solid #16A34A" :
    decision.action === "reject"  ? "3px solid #DC2626" :
    selected ? "3px solid #2563EB" : "3px solid transparent";

  const bg =
    decision.action === "approve" ? "#F0FDF4" :
    decision.action === "reject"  ? "#FFF5F5" : "#fff";

  return (
    <div style={{ background:bg, border:"1px solid #E5E7EB", borderLeft, borderRadius:8, overflow:"hidden", transition:"background 0.15s" }}>

      {/* Row: checkbox + bill summary */}
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 16px" }}>
        <Checkbox checked={selected} onChange={onToggleSelect} />

        <button
          onClick={() => setExpanded(v => !v)}
          style={{ flex:1, display:"flex", alignItems:"center", gap:12, textAlign:"left", background:"none", border:"none", cursor:"pointer", padding:0, minWidth:0 }}
        >
          <div style={{ width:36, height:36, borderRadius:6, background:"#EFF6FF", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <span style={{ fontSize:10, fontWeight:900, color:"#2563EB" }}>#</span>
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#0D1117", fontFamily:"'SF Mono','Fira Code','Consolas',monospace" }}>
              {bill.billNumber ?? bill.id.slice(0, 8)}
            </div>
            <div style={{ fontSize:11, color:"#9CA3AF", marginTop:2, display:"flex", gap:12, flexWrap:"wrap" as const }}>
              {bill.supplier && <span style={{ display:"flex", alignItems:"center", gap:4 }}>
                <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"/></svg>
                {bill.supplier.name}
              </span>}
              {bill.dueDate && <span style={{ display:"flex", alignItems:"center", gap:4 }}>
                <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/></svg>
                Due {fmtDate(bill.dueDate)}
              </span>}
              {bill.billDate && <span>Issued {fmtDate(bill.billDate)}</span>}
            </div>
          </div>

          {/* Amount + status + chevron */}
          <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
            <span style={{ fontSize:15, fontWeight:800, color:"#0D1117", fontVariantNumeric:"tabular-nums" }}>{money(bill.total, ccy)}</span>
            {decision.action === "approve" && (
              <span style={{ fontSize:10, fontWeight:700, padding:"2px 7px", background:"#DCFCE7", color:"#166534", borderRadius:4 }}>Approved</span>
            )}
            {decision.action === "reject" && (
              <span style={{ fontSize:10, fontWeight:700, padding:"2px 7px", background:"#FEE2E2", color:"#991B1B", borderRadius:4 }}>Rejected</span>
            )}
            <svg width="14" height="14" fill="none" stroke="#9CA3AF" strokeWidth="2" viewBox="0 0 24 24" style={{ transform: expanded ? "rotate(90deg)" : "none", transition:"transform 0.15s" }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/>
            </svg>
          </div>
        </button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ borderTop:"1px solid #F3F4F6" }}>
          {/* Subtotal / Tax / Total */}
          <div style={{ padding:"12px 16px", display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16, background:"#F9FAFB", borderBottom:"1px solid #F3F4F6" }}>
            {[
              { label:"Subtotal", val: totalSub || (bill.total - (bill.taxTotal ?? 0)) },
              { label:"Tax",      val: bill.taxTotal },
              { label:"Total",    val: bill.total },
            ].map(({ label, val }) => (
              <div key={label}>
                <div style={{ fontSize:10, fontWeight:600, color:"#9CA3AF", letterSpacing:"0.06em", textTransform:"uppercase" as const, marginBottom:4 }}>{label}</div>
                <div style={{ fontSize:14, fontWeight: label === "Total" ? 800 : 600, color:"#0D1117", fontVariantNumeric:"tabular-nums" }}>{money(val, ccy)}</div>
              </div>
            ))}
          </div>

          {/* Line items table */}
          {bill.lines.length > 0 && (
            <div style={{ overflowX:"auto", borderBottom:"1px solid #F3F4F6" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", minWidth:560 }}>
                <thead>
                  <tr style={{ background:"#F9FAFB", borderBottom:"1px solid #E5E7EB" }}>
                    {["Description","Account / Item","Qty","Unit Price","Ex. Tax","Tax","Inc. Tax"].map((h, i) => (
                      <th key={h} style={{
                        fontSize:10, fontWeight:700, color:"#9CA3AF", letterSpacing:"0.07em", textTransform:"uppercase" as const,
                        padding:"8px 12px", textAlign: i >= 2 ? "right" as const : "left" as const, whiteSpace:"nowrap" as const,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bill.lines.map((line, idx) => {
                    const lt = getLineTax(line);
                    return (
                      <tr key={line.id} style={{ borderBottom:"1px solid #F3F4F6", background: idx % 2 === 1 ? "#FAFAFA" : "#fff" }}>
                        <td style={{ padding:"9px 12px", fontSize:13, color:"#374151", maxWidth:180 }}>{line.description || "—"}</td>
                        <td style={{ padding:"9px 12px", fontSize:12, color:"#9CA3AF" }}>{line.accountName || line.itemName || "—"}</td>
                        <td style={{ padding:"9px 12px", fontSize:13, color:"#374151", textAlign:"right", fontVariantNumeric:"tabular-nums" }}>{line.quantity}</td>
                        <td style={{ padding:"9px 12px", fontSize:13, color:"#374151", textAlign:"right", fontVariantNumeric:"tabular-nums" }}>{money(line.unitPrice, ccy)}</td>
                        <td style={{ padding:"9px 12px", fontSize:13, color:"#374151", textAlign:"right", fontVariantNumeric:"tabular-nums" }}>{money(line.lineSubtotal, ccy)}</td>
                        <td style={{ padding:"9px 12px", fontSize:13, color:"#9CA3AF", textAlign:"right", fontVariantNumeric:"tabular-nums" }}>{money(lt, ccy)}</td>
                        <td style={{ padding:"9px 12px", fontSize:13, fontWeight:700, color:"#0D1117", textAlign:"right", fontVariantNumeric:"tabular-nums" }}>{money((line.lineSubtotal ?? 0) + lt, ccy)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Private note from finance */}
          {bill.privateNote && (
            <div style={{ padding:"12px 16px", borderBottom:"1px solid #F3F4F6" }}>
              <div style={{ background:"#FFFBEB", border:"1px solid #FDE68A", borderRadius:6, padding:"10px 14px" }}>
                <div style={{ fontSize:10, fontWeight:700, color:"#92400E", letterSpacing:"0.06em", textTransform:"uppercase" as const, marginBottom:4 }}>Note from Finance Team</div>
                <p style={{ fontSize:13, color:"#78350F", margin:0, whiteSpace:"pre-wrap" }}>{bill.privateNote}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Decision area */}
      <div style={{ padding:"12px 16px 14px", borderTop:"1px solid #F3F4F6" }}>
        <input
          type="text"
          value={decision.note}
          onChange={e => onSetNote(e.target.value)}
          placeholder={decision.action === "reject" ? "Reason for rejection (required)…" : "Add a note (optional)…"}
          style={{
            width:"100%", fontSize:12, padding:"7px 10px",
            border: fieldError ? "1px solid #FCA5A5" : "1px solid #E5E7EB",
            borderRadius:5, background: fieldError ? "#FFF5F5" : "#F9FAFB",
            color:"#374151", outline:"none", fontFamily:"inherit",
            marginBottom: fieldError ? 6 : 10, boxSizing:"border-box" as const,
          }}
        />
        {fieldError && (
          <p style={{ fontSize:11, color:"#DC2626", margin:"0 0 8px", display:"flex", alignItems:"center", gap:4 }}>
            <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/></svg>
            {fieldError}
          </p>
        )}
        <div style={{ display:"flex", gap:8 }}>
          <button
            onClick={() => onSetDecision(decision.action === "approve" ? null : "approve")}
            style={{
              flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:6,
              height:38, border:"none", borderRadius:6, cursor:"pointer", fontFamily:"inherit",
              fontSize:13, fontWeight:600, transition:"background 0.12s",
              background: decision.action === "approve" ? "#16A34A" : "#F0FDF4",
              color:       decision.action === "approve" ? "#fff"    : "#15803D",
              outline:     decision.action === "approve" ? "none"    : "1px solid #BBF7D0",
            }}
          >
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
            Approve
          </button>
          <button
            onClick={() => onSetDecision(decision.action === "reject" ? null : "reject")}
            style={{
              flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:6,
              height:38, border:"none", borderRadius:6, cursor:"pointer", fontFamily:"inherit",
              fontSize:13, fontWeight:600, transition:"background 0.12s",
              background: decision.action === "reject" ? "#DC2626" : "#FFF5F5",
              color:       decision.action === "reject" ? "#fff"    : "#B91C1C",
              outline:     decision.action === "reject" ? "none"    : "1px solid #FECACA",
            }}
          >
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
            Reject
          </button>
        </div>
      </div>

      {/* Per-bill chat */}
      <div style={{ borderTop:"1px solid #F3F4F6" }}>
        <button
          onClick={() => setChatOpen(v => !v)}
          style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 16px", background:"none", border:"none", cursor:"pointer", fontSize:12, color:"#9CA3AF", fontFamily:"inherit" }}
        >
          <span style={{ display:"flex", alignItems:"center", gap:6 }}>
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"/></svg>
            {comments.length > 0 ? `Messages (${comments.length})` : "Ask the finance team a question"}
          </span>
          <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ transform: chatOpen ? "rotate(90deg)" : "none", transition:"transform 0.12s" }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/>
          </svg>
        </button>
        {chatOpen && (
          <div style={{ borderTop:"1px solid #F3F4F6" }}>
            {comments.length > 0 && (
              <div style={{ padding:"12px 16px 4px", display:"flex", flexDirection:"column", gap:10, maxHeight:176, overflowY:"auto" }}>
                {comments.map(c => (
                  <div key={c.id} style={{ display:"flex", gap:8 }}>
                    <div style={{ width:6, height:6, borderRadius:"50%", background: c.channel === "approver" ? "#818CF8" : c.channel === "email" ? "#F59E0B" : "#60A5FA", flexShrink:0, marginTop:6 }} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:2 }}>
                        <span style={{ fontSize:11, fontWeight:600, color:"#374151" }}>{c.authorName}</span>
                        <span style={{ fontSize:10, color:"#9CA3AF" }}>{fmtRelative(c.createdAt)}</span>
                      </div>
                      <p style={{ fontSize:12, color:"#374151", margin:0, whiteSpace:"pre-wrap" }}>{c.body}</p>
                    </div>
                  </div>
                ))}
                <div ref={chatBottomRef} />
              </div>
            )}
            <div style={{ padding:"10px 16px", display:"flex", gap:8 }}>
              <input
                type="text" value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); postMsg(); } }}
                placeholder="Ask about this bill…"
                style={{ flex:1, fontSize:12, padding:"6px 10px", border:"1px solid #E5E7EB", borderRadius:5, background:"#F9FAFB", color:"#374151", outline:"none", fontFamily:"inherit" }}
              />
              <button
                onClick={postMsg} disabled={chatPosting || !chatInput.trim()}
                style={{ width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center", background:"#2563EB", border:"none", borderRadius:5, cursor:"pointer", opacity: chatPosting || !chatInput.trim() ? 0.4 : 1 }}
              >
                {chatPosting
                  ? <div style={{ width:12, height:12, border:"2px solid rgba(255,255,255,0.3)", borderTopColor:"#fff", borderRadius:"50%", animation:"spin 0.7s linear infinite" }} />
                  : <svg width="13" height="13" fill="none" stroke="#fff" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/></svg>
                }
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Bulk Reject Modal ─────────────────────────────────────────────────────────

function BulkRejectModal({ count, onClose, onConfirm }: { count: number; onClose: () => void; onConfirm: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <div style={{ position:"fixed", inset:0, zIndex:50, display:"flex", alignItems:"center", justifyContent:"center", padding:16, background:"rgba(0,0,0,0.55)", backdropFilter:"blur(2px)" }}>
      <div style={{ background:"#fff", borderRadius:8, border:"1px solid #E5E7EB", width:"100%", maxWidth:420, boxShadow:"0 20px 40px rgba(0,0,0,0.2)" }}>
        <div style={{ padding:"16px 20px", borderBottom:"1px solid #F3F4F6" }}>
          <p style={{ fontSize:15, fontWeight:700, color:"#0D1117", margin:0 }}>Reject {count} Bill{count > 1 ? "s" : ""}</p>
          <p style={{ fontSize:12, color:"#9CA3AF", margin:"4px 0 0" }}>This reason will be applied to all selected bills.</p>
        </div>
        <div style={{ padding:"16px 20px" }}>
          <textarea
            value={note} onChange={e => setNote(e.target.value)}
            rows={4} autoFocus
            placeholder="e.g. Incorrect amount, missing PO reference…"
            style={{ width:"100%", fontSize:13, padding:"8px 10px", border:"1px solid #E5E7EB", borderRadius:5, background:"#F9FAFB", color:"#374151", outline:"none", resize:"none" as const, fontFamily:"inherit", boxSizing:"border-box" as const }}
          />
        </div>
        <div style={{ padding:"12px 20px", borderTop:"1px solid #F3F4F6", display:"flex", justifyContent:"flex-end", gap:8 }}>
          <button onClick={onClose} style={{ height:36, padding:"0 14px", fontSize:13, fontWeight:500, border:"1px solid #E5E7EB", borderRadius:5, background:"#fff", color:"#374151", cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
          <button
            onClick={() => onConfirm(note)} disabled={!note.trim()}
            style={{ height:36, padding:"0 14px", fontSize:13, fontWeight:600, border:"none", borderRadius:5, background: note.trim() ? "#DC2626" : "#E5E7EB", color: note.trim() ? "#fff" : "#9CA3AF", cursor: note.trim() ? "pointer" : "not-allowed", fontFamily:"inherit" }}
          >Reject Selected</button>
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function ApproverPortalPage() {
  const { token } = useParams<{ token: string }>();

  const [data, setData]             = useState<PortalData | null>(null);
  const [loading, setLoading]       = useState(true);
  const [errorMsg, setErrorMsg]     = useState<string | null>(null);
  const [alreadyDecided, setAlreadyDecided] = useState<{ status: string } | null>(null);
  const [doneResult, setDoneResult] = useState<{ approved: number; rejected: number } | null>(null);

  const [decisions, setDecisions]     = useState<Record<string, BillDecision>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [selected, setSelected]       = useState<Set<string>>(new Set());
  const [showBulkReject, setShowBulkReject] = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [submitError, setSubmitError] = useState("");

  const [billComments, setBillComments] = useState<Record<string, Comment[]>>({});
  const [comments, setComments]         = useState<Comment[]>([]);
  const [commentBody, setCommentBody]   = useState("");
  const [posting, setPosting]           = useState(false);
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

  function setDecision(billId: string, action: "approve" | "reject" | null) {
    setDecisions(prev => ({ ...prev, [billId]: { ...prev[billId], action } }));
    if (action !== "reject") setFieldErrors(prev => { const n = { ...prev }; delete n[billId]; return n; });
  }

  function setNote(billId: string, note: string) {
    setDecisions(prev => ({ ...prev, [billId]: { ...prev[billId], note } }));
    if (note.trim()) setFieldErrors(prev => { const n = { ...prev }; delete n[billId]; return n; });
  }

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleSelectAll() {
    if (!data) return;
    setSelected(prev => prev.size === data.bills.length ? new Set() : new Set(data.bills.map(b => b.id)));
  }

  function applyBulkApprove() {
    setDecisions(prev => {
      const n = { ...prev };
      selected.forEach(id => { n[id] = { action:"approve", note: n[id]?.note ?? "" }; });
      return n;
    });
    setSelected(new Set());
  }

  function applyBulkReject(note: string) {
    setDecisions(prev => {
      const n = { ...prev };
      selected.forEach(id => { n[id] = { action:"reject", note }; });
      return n;
    });
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
      const res = await fetch(`/api/approver/${token}/submit`, { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ decisions: billDecisions }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Submission failed");
      setDoneResult({ approved: billDecisions.filter(x => x.action === "approve").length, rejected: billDecisions.filter(x => x.action === "reject").length });
    } catch (e: any) { setSubmitError(e.message); }
    finally { setSubmitting(false); }
  }

  async function postBillComment(billId: string, body: string): Promise<void> {
    const res = await fetch(`/api/approver/${token}/comment`, { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ body, billId }) });
    if (res.ok) { const c: Comment = await res.json(); setBillComments(prev => ({ ...prev, [billId]: [...(prev[billId] ?? []), c] })); }
  }

  async function postComment(): Promise<void> {
    if (!commentBody.trim() || posting) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/approver/${token}/comment`, { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ body: commentBody.trim() }) });
      if (res.ok) { const c: Comment = await res.json(); setComments(prev => [...prev, c]); setCommentBody(""); }
    } finally { setPosting(false); }
  }

  // ── States ────────────────────────────────────────────────────────────────

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

  if (alreadyDecided) return (
    <div style={{ minHeight:"100vh", background:"#F0F2F5", fontFamily:"-apple-system,'Segoe UI',system-ui,sans-serif", display:"flex", flexDirection:"column" }}>
      <Header orgName="Approval Portal" />
      <div style={{ maxWidth:600, margin:"0 auto", width:"100%", padding:"24px 16px", flex:1, display:"flex", flexDirection:"column", gap:12 }}>
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
          <div style={{ padding:"12px 16px", borderBottom:"1px solid #F3F4F6", display:"flex", alignItems:"center", gap:8 }}>
            <svg width="13" height="13" fill="none" stroke="#9CA3AF" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"/></svg>
            <span style={{ fontSize:13, fontWeight:600, color:"#374151" }}>Activity</span>
          </div>
          {comments.length > 0 ? (
            <div style={{ padding:"12px 16px 4px", display:"flex", flexDirection:"column", gap:10, maxHeight:240, overflowY:"auto", borderBottom:"1px solid #F3F4F6" }}>
              {comments.map(c => (
                <div key={c.id} style={{ display:"flex", gap:10 }}>
                  <div style={{ width:6, height:6, borderRadius:"50%", background: c.channel === "approver" ? "#818CF8" : c.channel === "email" ? "#F59E0B" : "#60A5FA", flexShrink:0, marginTop:6 }} />
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex", gap:8, marginBottom:2 }}>
                      <span style={{ fontSize:11, fontWeight:600, color:"#374151" }}>{c.authorName}</span>
                      <span style={{ fontSize:10, color:"#9CA3AF" }}>{fmtRelative(c.createdAt)}</span>
                    </div>
                    <p style={{ fontSize:13, color:"#374151", margin:0, whiteSpace:"pre-wrap" }}>{c.body}</p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          ) : (
            <div style={{ padding:"12px 16px", fontSize:12, color:"#9CA3AF", borderBottom:"1px solid #F3F4F6" }}>No messages yet.</div>
          )}
          <div style={{ padding:"12px 16px", display:"flex", gap:8 }}>
            <input
              type="text" value={commentBody} onChange={e => setCommentBody(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") postComment(); }}
              placeholder="Ask the finance team a question…"
              style={{ flex:1, fontSize:12, padding:"7px 10px", border:"1px solid #E5E7EB", borderRadius:5, background:"#F9FAFB", color:"#374151", outline:"none", fontFamily:"inherit" }}
            />
            <button
              onClick={postComment} disabled={posting || !commentBody.trim()}
              style={{ width:34, height:34, display:"flex", alignItems:"center", justifyContent:"center", background:"#2563EB", border:"none", borderRadius:5, cursor:"pointer", opacity: posting || !commentBody.trim() ? 0.4 : 1 }}
            >
              <svg width="13" height="13" fill="none" stroke="#fff" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/></svg>
            </button>
          </div>
        </div>
      </div>
      <Footer orgName="Approval Portal" />
    </div>
  );

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
  const isBatch    = bills.length > 1;
  const ccy        = bills[0]?.currency ?? "EUR";
  const grandTotal = bills.reduce((s, b) => s + (b.total ?? 0), 0);
  const decidedCount = bills.filter(b => decisions[b.id]?.action != null).length;
  const allDecided   = decidedCount === bills.length;
  const allSelected  = selected.size === bills.length;
  const someSelected = selected.size > 0 && !allSelected;

  const approvedTotal = bills.filter(b => decisions[b.id]?.action === "approve").reduce((s, b) => s + b.total, 0);
  const rejectedTotal = bills.filter(b => decisions[b.id]?.action === "reject").reduce((s, b) => s + b.total, 0);

  return (
    <div style={{ minHeight:"100vh", background:"#F0F2F5", fontFamily:"-apple-system,'Segoe UI',system-ui,sans-serif", display:"flex", flexDirection:"column" }}>
      <Header
        orgName={org.name}
        logoUrl={org.logoUrl}
        right={isBatch ? (
          <span style={{
            fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20,
            background: allDecided ? "rgba(22,163,74,0.2)" : "rgba(255,255,255,0.1)",
            color: allDecided ? "#4ADE80" : "#9CA3AF",
          }}>{decidedCount}/{bills.length} decided</span>
        ) : undefined}
      />

      <div style={{ maxWidth:860, margin:"0 auto", width:"100%", padding:"24px 16px", flex:1 }}>

        {/* Page heading */}
        <div style={{ marginBottom:20 }}>
          <h1 style={{ fontSize:20, fontWeight:700, color:"#0D1117", marginBottom:2 }}>
            {isBatch ? `${bills.length} Bills for Approval` : "Bill for Approval"}
          </h1>
          <p style={{ fontSize:13, color:"#6B7280" }}>Reviewing as <strong style={{ color:"#374151" }}>{data.token.approverName || data.token.approverEmail}</strong> · {org.name}</p>
        </div>

        {/* KPI strip */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:24 }}>
          <Kpi label="Total value"    value={money(grandTotal, ccy)} />
          <Kpi label="Bills"          value={String(bills.length)} />
          <Kpi label="Approved"       value={approvedTotal > 0 ? money(approvedTotal, ccy) : String(bills.filter(b => decisions[b.id]?.action === "approve").length)} accent={approvedTotal > 0 ? "green" : undefined} />
          <Kpi label="Rejected"       value={rejectedTotal > 0 ? money(rejectedTotal, ccy) : String(bills.filter(b => decisions[b.id]?.action === "reject").length)} accent={rejectedTotal > 0 ? "red" : undefined} />
        </div>

        {/* Batch toolbar */}
        {isBatch && (
          <div style={{ background:"#fff", border:"1px solid #E5E7EB", borderRadius:8, padding:"10px 16px", marginBottom:12, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" as const }}>
            <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer" }}>
              <Checkbox checked={allSelected} indeterminate={someSelected} onChange={toggleSelectAll} />
              <span style={{ fontSize:12, fontWeight:500, color:"#374151" }}>
                {selected.size > 0 ? `${selected.size} selected` : "Select all"}
              </span>
            </label>

            <div style={{ width:1, height:16, background:"#E5E7EB", flexShrink:0, margin:"0 4px" }} />

            <button
              onClick={applyBulkApprove}
              disabled={selected.size === 0}
              style={{ display:"flex", alignItems:"center", gap:5, height:30, padding:"0 12px", fontSize:12, fontWeight:600, border:"none", borderRadius:5, cursor: selected.size > 0 ? "pointer" : "not-allowed", fontFamily:"inherit", background: selected.size > 0 ? "#F0FDF4" : "#F9FAFB", color: selected.size > 0 ? "#15803D" : "#9CA3AF", outline: selected.size > 0 ? "1px solid #BBF7D0" : "1px solid #E5E7EB" }}
            >
              <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
              Approve selected
            </button>

            <button
              onClick={() => selected.size > 0 && setShowBulkReject(true)}
              disabled={selected.size === 0}
              style={{ display:"flex", alignItems:"center", gap:5, height:30, padding:"0 12px", fontSize:12, fontWeight:600, border:"none", borderRadius:5, cursor: selected.size > 0 ? "pointer" : "not-allowed", fontFamily:"inherit", background: selected.size > 0 ? "#FFF5F5" : "#F9FAFB", color: selected.size > 0 ? "#B91C1C" : "#9CA3AF", outline: selected.size > 0 ? "1px solid #FECACA" : "1px solid #E5E7EB" }}
            >
              <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
              Reject selected
            </button>

            {/* Progress bar */}
            <div style={{ flex:1, minWidth:80 }}>
              <div style={{ height:4, background:"#F3F4F6", borderRadius:2, overflow:"hidden" }}>
                <div style={{ height:"100%", background:"#2563EB", borderRadius:2, width:`${(decidedCount / bills.length) * 100}%`, transition:"width 0.3s" }} />
              </div>
            </div>

            <span style={{ fontSize:12, color:"#9CA3AF", flexShrink:0 }}>{decidedCount}/{bills.length}</span>
          </div>
        )}

        {/* Bill cards */}
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {bills.map(bill => (
            <BillCard
              key={bill.id}
              bill={bill}
              decision={decisions[bill.id] ?? { action: null, note: "" }}
              selected={selected.has(bill.id)}
              fieldError={fieldErrors[bill.id]}
              comments={billComments[bill.id] ?? []}
              onToggleSelect={() => toggleSelect(bill.id)}
              onSetDecision={action => setDecision(bill.id, action)}
              onSetNote={note => setNote(bill.id, note)}
              onPostComment={body => postBillComment(bill.id, body)}
            />
          ))}
        </div>

        {/* Submit panel */}
        <div style={{ background:"#fff", border:"1px solid #E5E7EB", borderRadius:8, padding:"16px 20px", marginTop:12 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: submitError ? 12 : 0 }}>
            <div>
              <p style={{ fontSize:13, fontWeight:600, color:"#0D1117", margin:"0 0 2px" }}>Submit decisions</p>
              <p style={{ fontSize:11, color:"#9CA3AF", margin:0 }}>Reviewing as <strong>{data.token.approverEmail}</strong> · Decisions are final and logged.</p>
            </div>
            <button
              onClick={submit}
              disabled={submitting || !allDecided}
              style={{
                display:"flex", alignItems:"center", gap:7, height:38, padding:"0 20px",
                fontSize:13, fontWeight:600, border:"none", borderRadius:6, cursor: allDecided ? "pointer" : "not-allowed", fontFamily:"inherit",
                background: allDecided ? "#2563EB" : "#E5E7EB",
                color:      allDecided ? "#fff"    : "#9CA3AF",
              }}
            >
              {submitting && <div style={{ width:13, height:13, border:"2px solid rgba(255,255,255,0.3)", borderTopColor:"#fff", borderRadius:"50%", animation:"spin 0.7s linear infinite" }} />}
              {submitting ? "Submitting…" : allDecided ? `Submit ${bills.length > 1 ? `all ${bills.length} ` : ""}decision${bills.length > 1 ? "s" : ""}` : `Decide ${bills.length - decidedCount} more bill${bills.length - decidedCount > 1 ? "s" : ""} to continue`}
            </button>
          </div>
          {submitError && (
            <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 12px", background:"#FFF5F5", border:"1px solid #FECACA", borderRadius:5, fontSize:13, color:"#DC2626" }}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/></svg>
              {submitError}
            </div>
          )}
        </div>

      </div>

      <Footer orgName={org.name} />

      {showBulkReject && (
        <BulkRejectModal count={selected.size} onClose={() => setShowBulkReject(false)} onConfirm={applyBulkReject} />
      )}
    </div>
  );
}

// ── Kpi card ──────────────────────────────────────────────────────────────────

function Kpi({ label, value, accent }: { label: string; value: string; accent?: "red" | "green" }) {
  const bg      = accent === "red" ? "#FFF5F5" : accent === "green" ? "#F0FDF4" : "#fff";
  const border  = accent === "red" ? "#FECACA" : accent === "green" ? "#BBF7D0" : "#E5E7EB";
  const valColor = accent === "red" ? "#B91C1C" : accent === "green" ? "#15803D" : "#0D1117";
  return (
    <div style={{ background:bg, border:`1px solid ${border}`, borderRadius:8, padding:"14px 16px" }}>
      <div style={{ fontSize:10, fontWeight:700, color:"#9CA3AF", letterSpacing:"0.08em", textTransform:"uppercase" as const, marginBottom:6 }}>{label}</div>
      <div style={{ fontSize:18, fontWeight:800, color:valColor, fontVariantNumeric:"tabular-nums" }}>{value}</div>
    </div>
  );
}
