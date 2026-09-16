"use client";

import { useState, useEffect, useMemo } from "react";
import { Send, X, AlertTriangle, FileText } from "lucide-react";
import { genEmailRef } from "@/lib/email-ref";
import { renderInvoiceEmail } from "@/lib/ar-email";
import { buildStatementPdf } from "@/lib/statement-pdf";
import {
  groupByCustomer, mergeCandidates, applyMerges, splitEmails, uniqEmails,
  type SendGroup,
} from "@/lib/send-grouping";

// Uint8Array → base64 (chunked to avoid call-stack limits on large PDFs).
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) binary += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(binary);
}

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
  const [sentCount, setSentCount] = useState(0);   // progress across a bulk run

  const willSplit = multiGroup; // one email per group, distinct refs

  // Send one email covering `rowsList` to `toStr`, tagged with `ref`.
  async function sendEmail(rowsList: SendRow[], toStr: string, ref: string): Promise<{ ok: boolean; error?: string }> {
    const ids = rowsList.map(r => r.inv.id);
    const filledSubject = fillTemplate(subject, rowsList, ref);
    const filledBody = fillTemplate(body, rowsList, ref);
    const total = rowsList.reduce((s, r) => s + r.bal, 0);
    const emailCurrency = rowsList[0]?.inv?.currency || ccy;
    let portalUrl: string | null = null;
    const custIds = new Set(rowsList.map(r => r.custId));
    if (includePortal && custIds.size === 1) {
      try {
        const tk = await fetch("/api/portal/token", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerId: rowsList[0].custId, invoiceIds: ids }),
        });
        if (tk.ok) portalUrl = (await tk.json()).url ?? null;
      } catch {}
    }
    // QBO "Pay now" links — resolved server-side (no QBO token in the browser),
    // same pre-render fetch as the portal token above. Failure just means no
    // pay buttons; the email still goes.
    let payLinks: Record<string, string | null> = {};
    try {
      const pl = await fetch("/api/invoices/pay-links", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds: ids }),
      });
      if (pl.ok) payLinks = (await pl.json())?.links ?? {};
    } catch {}

    const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const html = renderInvoiceEmail({
      subject: filledSubject, dateStr, total, currency: emailCurrency, portalUrl, intro: filledBody,
      rows: rowsList.map(r => ({
        invoiceNumber: r.inv.invoiceNumber, customerName: r.custName, projectName: r.projName,
        invoiceDate: r.inv.invoiceDate, dueDate: r.inv.dueDate, balance: r.bal, currency: r.inv.currency, daysOverdue: r.days,
        payUrl: payLinks[r.inv.id] ?? null,
      })),
    });
    // Build the Statement of Open Invoices PDF for THIS email's rows — the
    // exact same document as the Export › Statement, so each recipient gets a
    // statement of only the invoices they can see.
    let extraAttachments: { filename: string; contentBase64: string; contentType: string }[] | undefined;
    if (attachStatement) {
      try {
        const bytes = await buildStatementPdf({
          orgName: orgName || "Statement of Open Invoices",
          rows: rowsList.map(r => ({ inv: r.inv, custName: r.custName, projName: r.projName, bal: r.bal, days: r.days })),
          logoUrl: logoUrl ?? null,
        });
        extraAttachments = [{ filename: "Statement-of-Open-Invoices.pdf", contentBase64: bytesToBase64(bytes), contentType: "application/pdf" }];
      } catch (e: any) {
        return { ok: false, error: `Couldn't build the statement PDF: ${e?.message || "unknown error"}` };
      }
    }
    try {
      const res = await fetch("/api/email/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: toStr, cc: cc || undefined, subject: filledSubject, body: html, invoiceId: rowsList[0]?.inv.id, attachInvoiceIds: attachPdf ? ids : undefined, extraAttachments }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); return { ok: false, error: d.error || "Send failed" }; }
      const sentMessageId = (await res.json()).messageId ?? null;
      await Promise.all(rowsList.map(r => fetch("/api/communications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: r.custId, invoiceId: r.inv.id, projectId: r.inv.projectId ?? null,
          direction: "Outbound", channel: "Email", subject: filledSubject, recipients: toStr, body: filledBody,
          matchedBy: "Manual", isDraft: false, refNumber: ref, messageId: sentMessageId,
        }),
      }).catch(() => {})));
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || "Send failed" };
    }
  }

  async function send() {
    if (sendable.length === 0) { toast?.("None of these invoices have an email on file", "error"); return; }
    setSending(true);
    let ok = 0; let failed = 0;
    try {
      // One email per group — each gets its OWN reference number. A group is a
      // customer, or a merge the user explicitly ticked.
      for (const g of sendable) {
        const toStr = toFor(g);
        if (!toStr) { failed++; toast?.(`${g.label}: add a recipient`, "error"); continue; }
        // Belt and braces: nothing should ever reach here carrying two
        // customers unless a merge was ticked for it.
        if (g.custIds.length > 1 && !g.key.startsWith("merge:")) {
          failed++; toast?.(`${g.label}: refused — would mix customers`, "error"); continue;
        }
        setSentCount(c => c + 1);
        const r = await sendEmail(g.rows, toStr, sendable.length === 1 ? baseRef : genEmailRef());
        if (r.ok) ok++; else { failed++; toast?.(`${g.label}: ${r.error}`, "error"); }
      }
    } finally { setSending(false); setSentCount(0); }
    if (ok > 0) {
      const skipped = noEmail.length ? ` · ${noEmail.length} skipped (no email)` : "";
      toast?.(`Sent ${ok} email${ok !== 1 ? "s" : ""}${failed ? ` · ${failed} failed` : ""}${skipped}`);
      onSent();
    }
  }

  const applyTemplate = (id: string) => {
    const tpl = emailTemplates.find(t => t.id === id);
    if (!tpl) return;
    setSubject(tpl.subject);
    setBody(tpl.body);
  };

  /**
   * Fill the template placeholders. This modal used to drop the raw template
   * straight into the fields and send it as-is, so students received emails
   * reading "Hi{name}" / "New Payment Request From {ref}" — reported by a
   * customer. Substituted at SEND time (not on template selection) because one
   * modal can fan out to several recipients, each with its own name and ref.
   *
   * Same vocabulary and semantics as the chase paths' fillTemplate: {name},
   * {ref}, {invoicelines} — case-insensitive. {invoicelines} resolves to an
   * empty string here for the same reason it does there: the branded table
   * below the intro already lists every invoice, so filling it would print the
   * list twice.
   */
  const fillTemplate = (text: string, rowsList: SendRow[], ref: string) =>
    text
      .replace(/\{name\}/gi, rowsList[0]?.custName?.split(" ")[0] ?? "there")
      .replace(/\{invoice ?lines\}/gi, "")
      .replace(/\{ref\}/gi, ref);

  const inputCls = "w-full mt-1 text-sm border border-stone-700 rounded-lg px-3 py-2 bg-stone-800 text-stone-200 placeholder-stone-600 outline-none focus:ring-1 focus:ring-emerald-500";

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
                className="w-full mt-1 text-sm border border-stone-700 rounded-lg px-3 py-2 bg-stone-800 text-stone-200 outline-none focus:ring-1 focus:ring-emerald-500"
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

        <div className="px-5 py-3 border-t border-stone-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-stone-400 hover:text-stone-200">Cancel</button>
          <button onClick={send} disabled={sending || sendable.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50">
            {sending && <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
            <Send size={14} />
            {sending
              // A 224-email run takes minutes; a bare "Sending…" leaves no way
              // to tell progress from a hang.
              ? (multiGroup ? `Sending ${sentCount} of ${sendable.length}…` : "Sending…")
              : multiGroup ? `Send ${sendable.length} emails` : "Send email"}
          </button>
        </div>
      </div>
    </div>
  );
}
