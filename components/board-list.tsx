"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { STAGE_COLOR_CLASSES, Stage } from "@/lib/stages";
import { fmt } from "@/lib/format";
import { Send, X, AlertTriangle, CalendarClock, AlertOctagon, Check, Pencil } from "lucide-react";

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
};

const DISPUTE_CATEGORIES = ["Wrong Amount", "Already Paid", "Goods/Service", "Duplicate", "Other"];
const todayStr = () => new Date().toISOString().slice(0, 10);
const uniqEmails = (vals: (string | null)[]) => {
  const set = new Set<string>();
  vals.forEach(v => (v || "").split(/[,;]/).map(e => e.trim().toLowerCase()).filter(e => e.includes("@")).forEach(e => set.add(e)));
  return [...set];
};

export function BoardList({ rows, stages, updateInvoice, refresh, toast, ccy }: {
  rows: BoardRow[];
  stages: Stage[];
  updateInvoice: (id: string, patch: any) => Promise<any>;
  refresh: () => Promise<any> | void;
  toast?: (m: string, t?: string) => void;
  ccy: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [respEdit, setRespEdit] = useState<{ id: string; mode: "promise" | "dispute" } | null>(null);
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
      if (cf.due && !has(r.inv.dueDate, cf.due)) return false;
      if (cf.minAmount && r.bal < Number(cf.minAmount)) return false;
      return true;
    });
  }, [rows, cf]);

  const stageLabels = stages.filter(s => s.visible).map(s => s.label);
  const stageColor = (label: string) => STAGE_COLOR_CLASSES[stages.find(s => s.label === label)?.color ?? "stone"]?.badge ?? "bg-stone-100 text-stone-700";
  const fmtSent = (d: string | null) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }) : null;

  const allSelected = filteredRows.length > 0 && filteredRows.every(r => selected.has(r.inv.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(filteredRows.map(r => r.inv.id)));
  const toggleOne = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selectedRows = useMemo(() => rows.filter(r => selected.has(r.inv.id)), [rows, selected]);
  const anyFilter = Object.values(cf).some(Boolean);

  const thCls = "px-3 py-2.5 text-[11px] font-semibold text-stone-500 uppercase tracking-wider whitespace-nowrap";
  const inputCls = "w-full text-[11px] border border-stone-200 rounded px-1.5 py-1 bg-white outline-none focus:ring-1 focus:ring-stone-400";
  const selectedCustomers = useMemo(() => new Set(selectedRows.map(r => r.custId)), [selectedRows]);
  const selectedTotal = selectedRows.reduce((s, r) => s + r.bal, 0);

  async function save(id: string, patch: any) {
    setBusyId(id);
    try { await updateInvoice(id, patch); await refresh(); }
    finally { setBusyId(null); }
  }

  async function submitResponse() {
    if (!respEdit) return;
    if (respEdit.mode === "promise") {
      if (!rDate) return;
      await save(respEdit.id, { promiseDate: rDate });
    } else {
      await save(respEdit.id, { disputeReason: rReason || rCat, collectionStage: "Disputed" });
    }
    setRespEdit(null); setRDate(""); setRReason("");
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

      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="text-center text-sm text-stone-400 py-16">No open invoices match the current filters.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-stone-50 z-10">
              <tr className="border-b border-stone-200 text-left">
                <th className="px-3 py-2.5 w-10"><input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-stone-300 cursor-pointer" /></th>
                {["Invoice", "Customer", "Project", "Region", "Rep", "Stage", "Response", "Email", "Last sent", "Due"].map(h => (
                  <th key={h} className={thCls}>{h}</th>
                ))}
                <th className="px-3 py-2.5 text-[11px] font-semibold text-stone-500 uppercase tracking-wider text-right">Outstanding</th>
              </tr>
              {/* Per-column filter row */}
              <tr className="border-b border-stone-200 bg-white">
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
                <th className="px-2 py-1.5"><input value={cf.due ?? ""} onChange={e => setFilter("due", e.target.value)} placeholder="YYYY-MM" className={inputCls} /></th>
                <th className="px-2 py-1.5"><input type="number" value={cf.minAmount ?? ""} onChange={e => setFilter("minAmount", e.target.value)} placeholder="≥ €" className={`${inputCls} text-right`} /></th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(({ inv, custName, projName, regionName, repName, stageLabel, bal, days, email, lastSent }) => {
                const isSel = selected.has(inv.id);
                const editingResp = respEdit?.id === inv.id;
                return (
                  <tr key={inv.id} className={`border-b border-stone-100 hover:bg-stone-50 ${isSel ? "bg-blue-50/40" : ""}`}>
                    <td className="px-3 py-2"><input type="checkbox" checked={isSel} onChange={() => toggleOne(inv.id)} className="rounded border-stone-300 cursor-pointer" /></td>
                    <td className="px-3 py-2"><Link href={`/invoices/${inv.id}`} className="font-mono text-[12px] text-stone-900 hover:underline">#{inv.invoiceNumber}</Link></td>
                    <td className="px-3 py-2 text-stone-800 max-w-[180px] truncate" title={custName}>{custName}</td>
                    <td className="px-3 py-2 text-stone-500 text-[12px] max-w-[160px] truncate" title={projName ?? ""}>{projName ?? "—"}</td>
                    <td className="px-3 py-2 text-stone-500 text-[12px]">{regionName ?? "—"}</td>
                    <td className="px-3 py-2 text-stone-500 text-[12px]">{repName ?? "—"}</td>

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
                    <td className="px-3 py-2 min-w-[180px]">
                      {editingResp ? (
                        <div className="flex flex-col gap-1.5 bg-white ring-1 ring-stone-200 rounded-lg p-2">
                          <div className="flex gap-1">
                            <button onClick={() => setRespEdit({ id: inv.id, mode: "promise" })} className={`flex-1 text-[10px] py-1 rounded ${respEdit!.mode === "promise" ? "bg-blue-600 text-white" : "bg-stone-100 text-stone-600"}`}>📅 Promise</button>
                            <button onClick={() => setRespEdit({ id: inv.id, mode: "dispute" })} className={`flex-1 text-[10px] py-1 rounded ${respEdit!.mode === "dispute" ? "bg-rose-600 text-white" : "bg-stone-100 text-stone-600"}`}>⚠️ Dispute</button>
                          </div>
                          {respEdit!.mode === "promise" ? (
                            <input type="date" min={todayStr()} value={rDate} onChange={e => setRDate(e.target.value)} className="text-[12px] border border-stone-200 rounded px-1.5 py-1" />
                          ) : (
                            <>
                              <select value={rCat} onChange={e => setRCat(e.target.value)} className="text-[12px] border border-stone-200 rounded px-1.5 py-1 bg-white">
                                {DISPUTE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                              <input value={rReason} onChange={e => setRReason(e.target.value)} placeholder="Reason" className="text-[12px] border border-stone-200 rounded px-1.5 py-1" />
                            </>
                          )}
                          <div className="flex justify-end gap-1">
                            <button onClick={() => setRespEdit(null)} className="text-[11px] text-stone-500 px-2 py-0.5">Cancel</button>
                            <button onClick={submitResponse} disabled={busyId === inv.id} className="text-[11px] font-semibold text-white bg-stone-900 rounded px-2 py-0.5 disabled:opacity-50">Save</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => { setRespEdit({ id: inv.id, mode: inv.hasOpenDispute ? "dispute" : "promise" }); setRDate(inv.promiseDate || ""); setRReason(inv.disputeReason || ""); }}
                          className="group inline-flex items-center gap-1">
                          {inv.hasOpenDispute ? (
                            <span title={inv.disputeReason || "Disputed"} className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-semibold inline-flex items-center gap-1"><AlertOctagon size={10} /> Disputed</span>
                          ) : inv.promiseDate ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold inline-flex items-center gap-1"><CalendarClock size={10} /> Promised {inv.promiseDate}</span>
                          ) : (
                            <span className="text-stone-300 text-[12px]">—</span>
                          )}
                          <Pencil size={11} className="text-stone-300 opacity-0 group-hover:opacity-100" />
                        </button>
                      )}
                    </td>

                    {/* Email (editable inline) */}
                    <td className="px-3 py-2 max-w-[200px]">
                      {emailEdit === inv.id ? (
                        <input
                          autoFocus value={emailVal} onChange={e => setEmailVal(e.target.value)}
                          onBlur={() => { if (emailVal !== (email ?? "")) save(inv.id, { billingEmail: emailVal }); setEmailEdit(null); }}
                          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEmailEdit(null); }}
                          className="w-full text-[12px] border border-stone-300 rounded px-1.5 py-1"
                        />
                      ) : (
                        <button onClick={() => { setEmailEdit(inv.id); setEmailVal(email ?? ""); }}
                          className="group inline-flex items-center gap-1 text-left max-w-full">
                          <span className={`text-[12px] truncate ${email ? "text-stone-600" : "text-stone-300 italic"}`}>{email || "no email"}</span>
                          <Pencil size={11} className="text-stone-300 opacity-0 group-hover:opacity-100 shrink-0" />
                        </button>
                      )}
                    </td>

                    <td className="px-3 py-2 whitespace-nowrap text-[12px]">
                      {lastSent ? <span className="text-stone-600">{fmtSent(lastSent)}</span> : <span className="text-stone-300">Never</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-stone-600 text-[12px]">{inv.dueDate}{days > 0 && <span className="ml-1 text-rose-600 font-medium">+{days}d</span>}</td>
                    <td className="px-3 py-2 text-right font-semibold text-stone-900 tabular-nums">{fmt.money(bal, inv.currency)}</td>
                  </tr>
                );
              })}
            </tbody>
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
  const refs = rows.map(r => r.inv.invoiceNumber).join(", ");
  const total = rows.reduce((s, r) => s + r.bal, 0);
  const [to, setTo] = useState(uniqEmails(rows.map(r => r.email)).join(", "));
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(`Outstanding invoices — Ref: ${refs}`);
  const [body, setBody] = useState(
    `Dear Sir/Madam,\n\nPlease find attached the following outstanding invoice(s) for your reference:\n${rows.map(r => `  • ${r.inv.invoiceNumber} — ${fmt.money(r.bal, r.inv.currency)} (due ${r.inv.dueDate})`).join("\n")}\n\nTotal outstanding: ${fmt.money(total, ccy)}\n\nKindly arrange payment or let us know a payment date at your earliest convenience.\n\nKind regards`
  );
  const [sending, setSending] = useState(false);

  async function send() {
    if (!to.trim()) { toast?.("Add at least one recipient", "error"); return; }
    setSending(true);
    try {
      const res = await fetch("/api/email/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, cc: cc || undefined, subject, body, attachInvoiceIds: rows.map(r => r.inv.id) }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Send failed"); }
      // Log a communication per invoice so it shows on each timeline
      await Promise.all(rows.map(r => fetch("/api/communications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: r.custId, invoiceId: r.inv.id, projectId: r.inv.projectId ?? null,
          direction: "Outbound", channel: "Email", subject, recipients: to, body,
          matchedBy: "Manual", isDraft: false,
        }),
      }).catch(() => {})));
      toast?.(`Sent ${rows.length} invoice(s) to ${to}`);
      onSent();
    } catch (e: any) {
      toast?.(e.message || "Failed to send", "error");
    } finally { setSending(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between">
          <h3 className="font-semibold text-stone-900">Send {rows.length} invoice(s)</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          {multiCustomer && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-[12px] text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              You've selected invoices from <strong>different customers</strong> — they'll all go to the recipients below in one email. Send separately per customer to avoid sharing one customer's invoices with another.
            </div>
          )}
          <div>
            <label className="text-[11px] font-medium text-stone-500">To (unique emails from selection — editable)</label>
            <input value={to} onChange={e => setTo(e.target.value)} className="w-full mt-1 text-sm border border-stone-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-stone-300" />
          </div>
          <div>
            <label className="text-[11px] font-medium text-stone-500">CC</label>
            <input value={cc} onChange={e => setCc(e.target.value)} placeholder="optional" className="w-full mt-1 text-sm border border-stone-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-stone-300" />
          </div>
          <div>
            <label className="text-[11px] font-medium text-stone-500">Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} className="w-full mt-1 text-sm border border-stone-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-stone-300" />
          </div>
          <div>
            <label className="text-[11px] font-medium text-stone-500">Message</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={8} className="w-full mt-1 text-sm border border-stone-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-stone-300 resize-none" />
          </div>
          <p className="text-[11px] text-stone-400">Invoice PDFs are attached automatically (where available from QuickBooks).</p>
        </div>
        <div className="px-5 py-3 border-t border-stone-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-stone-600">Cancel</button>
          <button onClick={send} disabled={sending} className="flex items-center gap-2 px-4 py-2 bg-stone-900 text-white text-sm font-semibold rounded-lg hover:bg-stone-800 disabled:opacity-50">
            {sending && <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
            <Send size={14} /> {sending ? "Sending…" : "Send email"}
          </button>
        </div>
      </div>
    </div>
  );
}
