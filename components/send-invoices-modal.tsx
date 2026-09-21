"use client";

import { useState, useEffect, useMemo } from "react";
import { Send, X, AlertTriangle, FileText } from "lucide-react";
import { genEmailRef } from "@/lib/email-ref";
import {
  groupByCustomer, mergeCandidates, applyMerges, splitEmails, uniqEmails,
  type SendGroup,
} from "@/lib/send-grouping";

// Minimal row shape the send modal needs. BoardRow is a structural superset,
// so the Collections Board can pass its rows directly.
export type SendRow = {
  inv: any;
  custId: string;
  custName: string;
  projName: string | null;
  bal: number;
  days: number;
  email: string | null;
};

/**
 * Shared "send invoices" composer — Collections Board (bulk) + invoice detail.
 *
 * Grouped by CUSTOMER. One email per customer, carrying only that customer's
 * invoices and its own reference number. An email never spans two customers
 * unless a human explicitly ticks a merge.
 *
 * It used to group by email DOMAIN, on the reasoning that a shared domain means
 * a shared organisation. See lib/send-grouping.ts for why that is unsafe and
 * what it did on a real board. The merge case it was built for (a novated
 * project, a shared auditor) survives as an explicit, named opt-in.
 */
export function SendInvoicesModal({ rows, ccy, orgName, logoUrl, onClose, onSent, toast }: {
  rows: SendRow[];
  ccy: string;
  orgName?: string;
  logoUrl?: string | null;
  onClose: () => void;
  onSent: () => void;
  toast?: (m: string, t?: string) => void;
}) {
  const { groups: perCustomer, noEmail } = useMemo(() => groupByCustomer(rows), [rows]);
  const candidates = useMemo(() => mergeCandidates(perCustomer), [perCustomer]);
  const [mergedDomains, setMergedDomains] = useState<Set<string>>(new Set());
  const sendable: SendGroup<SendRow>[] = useMemo(
    () => applyMerges(perCustomer, mergedDomains, candidates),
    [perCustomer, mergedDomains, candidates]);

  const multiGroup = sendable.length > 1;
  const [baseRef] = useState(genEmailRef);

  // Email templates
  const [emailTemplates, setEmailTemplates] = useState<{ id: string; name: string; subject: string; body: string; isDefault?: boolean }[]>([]);
  useEffect(() => {
    fetch("/api/email-templates")
      .then(r => r.ok ? r.json() : [])
      .then((tpls: { id: string; name: string; subject: string; body: string; isDefault?: boolean }[]) => {
        setEmailTemplates(tpls);
        const def = tpls.find(t => t.isDefault);
        if (def) { setSubject(def.subject); setBody(def.body); }
      })
      .catch(() => {});
  }, []);                  // ref for the single-email cases
  // Per-group recipient overrides. Keyed by group key; a group with no entry
  // uses its customer's own addresses, which is the correct default.
  const [tos, setTos] = useState<Record<string, string>>({});
  const toFor = (g: SendGroup<SendRow>) => (tos[g.key] ?? g.emails.join(", ")).trim();
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(`Open Invoices — Ref ${baseRef}`);
  const [body, setBody] = useState(
    `Hi,\n\nPlease find attached a statement of your open invoices along with copies of each invoice for your reference.\nCould you please share the expected payment dates at your earliest convenience?\nFeel free to reach out if you have any questions.`
  );
  const [attachPdf, setAttachPdf] = useState(true);
  const [attachStatement, setAttachStatement] = useState(true);
  const [includePortal, setIncludePortal] = useState(true);
  const [sending, setSending] = useState(false);
  const [sentCount, setSentCount] = useState(0);    // progress across a bulk run
  const [totalToSend, setTotalToSend] = useState(0); // as the SERVER grouped it
  const [queuedJobId, setJobId] = useState<string | null>(null);

  const willSplit = multiGroup; // one email per group, distinct refs

  // The browser no longer sends the emails. It hands the selection and the
  // composed message to the server, which decides who gets which email and
  // runs the job on the same durable chunk engine as every other bulk
  // operation. Closing this tab no longer stops the run.
  async function send() {
    if (sendable.length === 0) { toast?.("None of these invoices have an email on file", "error"); return; }
    setSending(true);
    try {
      const res = await fetch("/api/invoices/bulk-send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceIds: sendable.flatMap(g => g.rows.map(r => r.inv.id)),
          subject, body, cc: cc || undefined,
          attachPdf, attachStatement, includePortal,
          mergeDomains: [...mergedDomains],
          toOverrides: tos,
        }),
      });
      const d = await res.json().catch(() => ({}));
      // Don't close on failure — the composed subject and body would be lost.
      if (!res.ok) { toast?.(d?.error || "Couldn't queue the send", "error"); setSending(false); return; }

      const jobId = d.jobId as string;
      setJobId(jobId);
      setTotalToSend(d.emails ?? sendable.length);
      // Best-effort nudge, matching every other chunked start route — the
      // Inngest event is what actually drives the run.
      fetch(`/api/batch/jobs/${jobId}/run-chunk-now`, { method: "POST" }).catch(() => {});

      // Poll for progress. If this tab goes away the job carries on regardless;
      // Job History and the watchdog both pick it up.
      // Bounded: the job outlives this tab by design, so the poll's job is to
      // report progress, not to babysit. If it is still going after ~30 minutes
      // (or the browser cannot reach us), say where to look instead of spinning
      // forever on a loop nobody can see.
      const POLL_MS = 1500;
      const MAX_POLLS = Math.round((30 * 60 * 1000) / POLL_MS);
      let done = false;
      for (let attempt = 0; !done; attempt++) {
        if (attempt >= MAX_POLLS) {
          toast?.("Still sending — it will finish in the background. Open Email History (Receivables) for the result.");
          break;
        }
        await new Promise(r => setTimeout(r, POLL_MS));
        const p = await fetch(`/api/batch/jobs/${jobId}`).then(r => r.ok ? r.json() : null).catch(() => null);
        if (!p?.status) continue;
        setSentCount((p.successCount ?? 0) + (p.errorCount ?? 0));
        if (p.status === "done" || p.status === "failed") {
          done = true;
          const okCount = p.successCount ?? 0;
          const failed = p.errorCount ?? 0;
          const skipped = d.skippedNoEmail ? ` · ${d.skippedNoEmail} skipped (no email)` : "";
          if (okCount > 0) {
            toast?.(`Sent ${okCount} email${okCount !== 1 ? "s" : ""}${failed ? ` · ${failed} failed` : ""}${skipped}`);
            onSent();
          } else {
            toast?.(p.lastChunkError || `No emails sent${failed ? ` · ${failed} failed` : ""}`, "error");
          }
        }
      }
      onClose();
    } catch (e: any) {
      // Leave the modal open so nothing the user typed is lost.
      toast?.(e?.message || "Couldn't queue the send", "error");
    } finally { setSending(false); setSentCount(0); }
  }

  const applyTemplate = (id: string) => {
    const tpl = emailTemplates.find(t => t.id === id);
    if (!tpl) return;
    setSubject(tpl.subject);
    setBody(tpl.body);
  };


  const inputCls = "w-full mt-1 text-[13px] border border-stone-700 rounded-lg px-3 py-2 bg-stone-800 text-stone-200 placeholder-stone-600 outline-none focus:ring-1 focus:ring-emerald-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-stone-900 border border-stone-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-white">
              Send {rows.length} invoice{rows.length !== 1 ? "s" : ""}
              {willSplit && <span className="text-stone-400 font-normal"> · {sendable.length} recipients</span>}
            </h3>
            <div className="text-[11px] text-stone-400 mt-0.5">
              {willSplit
                ? <>Reference: <span className="font-mono text-emerald-400">one per email (auto)</span></>
                : <>Email reference: <span className="font-mono text-emerald-400">{baseRef}</span></>}
            </div>
          </div>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-200"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-3">
          {/* What is about to happen — stated plainly, because the count can
              be large and the old wording ("separate emails per domain") was
              describing something that was not safe. */}
          {multiGroup && (
            <div className="rounded-lg border border-stone-700 bg-stone-800/60 px-3 py-2.5 text-[12px] text-stone-300">
              <strong className="text-stone-100">{sendable.length} separate emails</strong> — one per customer,
              each containing only that customer's invoices and its own reference number.
              No recipient can see another customer's invoices or email address.
            </div>
          )}

          {/* Genuine shared-organisation merges: a CORPORATE domain used by more
              than one customer (a novated project, a shared auditor). Named,
              opt-in, one at a time. Consumer mailbox domains are never offered
              here — see lib/send-grouping.ts. */}
          {candidates.length > 0 && (
            <div className="rounded-lg border border-stone-700 bg-stone-800/40 px-3 py-2.5 text-[12px] space-y-2">
              <div className="text-stone-400">
                Some customers share a company domain. Combine them into one email only if the same
                person handles them:
              </div>
              {candidates.map(c => (
                <label key={c.domain} className="flex items-start gap-2 cursor-pointer text-stone-300 hover:text-white">
                  <input
                    type="checkbox"
                    checked={mergedDomains.has(c.domain)}
                    onChange={e => setMergedDomains(p => {
                      const n = new Set(p);
                      e.target.checked ? n.add(c.domain) : n.delete(c.domain);
                      return n;
                    })}
                    className="mt-0.5 rounded border-stone-600 accent-emerald-600 cursor-pointer" />
                  <span>
                    <span className="font-medium text-stone-200">@{c.domain}</span>
                    <span className="text-stone-500"> — {c.custIds.length} customers: </span>
                    <span className="text-stone-400">{c.custNames.slice(0, 4).join(", ")}{c.custNames.length > 4 ? `, +${c.custNames.length - 4} more` : ""}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {noEmail.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-[12px] text-amber-200">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
              {noEmail.length} invoice{noEmail.length !== 1 ? "s have" : " has"} no email on file and will be skipped.
            </div>
          )}

          {/* Recipients. Addresses come from each customer's own contact record,
              so at bulk scale there is nothing to fill in — rendering 224
              editable To: fields would be unusable, and the reason the old
              screen felt manageable was that it only ever showed one card per
              DOMAIN, which is precisely what made it wrong. Small sends stay
              editable; large ones become a reviewable list. */}
          {sendable.length <= 8 ? (
            sendable.map(g => (
              <div key={g.key} className="rounded-lg border border-stone-800 bg-stone-800/40 p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-stone-200 truncate">{g.label}</span>
                  <span className="text-[11px] text-stone-500 shrink-0">{g.rows.length} inv · {g.rows.map(r => `#${r.inv.invoiceNumber}`).slice(0, 4).join(", ")}{g.rows.length > 4 ? "…" : ""}</span>
                </div>
                <label className="text-[11px] font-medium text-stone-400">To</label>
                <input value={tos[g.key] ?? g.emails.join(", ")}
                  onChange={e => setTos(p => ({ ...p, [g.key]: e.target.value }))}
                  placeholder="email@example.com" className={inputCls} />
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-stone-800 bg-stone-800/40">
              <div className="flex items-center justify-between px-3 py-2 border-b border-stone-800 text-[11px] text-stone-500">
                <span>Recipients — from each customer's contact record</span>
                <span className="tabular-nums">{sendable.length} emails</span>
              </div>
              <div className="max-h-52 overflow-auto divide-y divide-stone-800/70">
                {sendable.map(g => (
                  <div key={g.key} className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-[11px]">
                    <span className="text-stone-300 truncate min-w-0">{g.label}</span>
                    <span className="text-stone-500 truncate min-w-0 flex-1 text-right">{g.emails.join(", ")}</span>
                    <span className="text-stone-600 tabular-nums shrink-0">{g.rows.length} inv</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-[11px] font-medium text-stone-400">CC {willSplit && <span className="text-stone-600">(applied to every email)</span>}</label>
            <input value={cc} onChange={e => setCc(e.target.value)} placeholder="optional" className={inputCls} />
          </div>
          {emailTemplates.length > 0 && (
            <div>
              <label className="text-[11px] font-medium text-stone-400 flex items-center gap-1.5"><FileText size={11} /> Apply template</label>
              <select
                onChange={e => { if (e.target.value) applyTemplate(e.target.value); e.target.value = ""; }}
                defaultValue=""
                className="w-full mt-1 text-[13px] border border-stone-700 rounded-lg px-3 py-2 bg-stone-800 text-stone-200 outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="" disabled>Select a template…</option>
                {emailTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-[11px] font-medium text-stone-400">Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="text-[11px] font-medium text-stone-400">Message</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={8} className={`${inputCls} resize-none`} />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-stone-800 bg-stone-800/40 px-3 py-2.5">
            <div>
              <div className="text-[13px] font-medium text-stone-200">Attach statement of open invoices</div>
              <div className="text-[11px] text-stone-500">{attachStatement ? (willSplit ? "A statement (each domain's invoices only) will be attached." : "The same statement PDF as Export will be attached.") : "No statement attached."}</div>
            </div>
            <button type="button" role="switch" aria-checked={attachStatement} onClick={() => setAttachStatement(v => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${attachStatement ? "bg-emerald-600" : "bg-stone-600"}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${attachStatement ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-stone-800 bg-stone-800/40 px-3 py-2.5">
            <div>
              <div className="text-[13px] font-medium text-stone-200">Attach invoice PDF</div>
              <div className="text-[11px] text-stone-500">{attachPdf ? "Each invoice PDF will be attached." : "No individual invoice PDFs attached."}</div>
            </div>
            <button type="button" role="switch" aria-checked={attachPdf} onClick={() => setAttachPdf(v => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${attachPdf ? "bg-emerald-600" : "bg-stone-600"}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${attachPdf ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-stone-800 bg-stone-800/40 px-3 py-2.5">
            <div>
              <div className="text-[13px] font-medium text-stone-200">Include customer portal link</div>
              <div className="text-[11px] text-stone-500">{includePortal ? "A \"View & Respond\" button will be included." : "No portal link — recipients reply by email only."}</div>
            </div>
            <button type="button" role="switch" aria-checked={includePortal} onClick={() => setIncludePortal(v => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${includePortal ? "bg-emerald-600" : "bg-stone-600"}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${includePortal ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
          <p className="text-[11px] text-stone-500">Sent in the standard branded format with an invoice table. The text above is the intro message.</p>
        </div>

        <div className="px-5 py-3 border-t border-stone-800 flex items-center justify-end gap-2">
          {queuedJobId && (
            // The job is on the server now — this tab is only watching it. Say
            // where the record lives, in case the user closes the tab or the
            // run outlasts their attention.
            <a href={`/batch/history?op=send&job=${queuedJobId}`} target="_blank" rel="noopener"
               className="mr-auto text-[12px] font-medium text-emerald-400 hover:text-emerald-300 underline underline-offset-2">
              View in Email History
            </a>
          )}
          <button onClick={onClose} className="px-4 py-2 text-[13px] font-medium text-stone-400 hover:text-stone-200">Cancel</button>
          <button onClick={send} disabled={sending || sendable.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-[13px] font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50">
            {sending && <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
            <Send size={14} />
            {sending
              // A 224-email run takes minutes; a bare "Sending…" leaves no way
              // to tell progress from a hang.
              ? (multiGroup ? `Sending ${sentCount} of ${totalToSend || sendable.length}…` : "Sending…")
              : multiGroup ? `Send ${sendable.length} emails` : "Send email"}
          </button>
        </div>
      </div>
    </div>
  );
}
