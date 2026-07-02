"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Modal, Button, Input, Select, Card, EmptyState } from "./ui";
import { fmt, daysOverdue, today, daysFromNow } from "@/lib/format";
import { genEmailRef } from "@/lib/email-ref";
import { renderInvoiceEmail } from "@/lib/ar-email";
import { useData } from "./data-provider";
import { useSession } from "next-auth/react";
import {
  ArrowDownRight, ArrowUpRight, FileEdit, Link2, Save, Send, Paperclip,
  MessageSquare, Circle, Check, Download, AlertTriangle, CheckCircle, XCircle,
  Mail, Calendar, Zap, ArrowRightLeft, CreditCard, Users, RefreshCw, FileDown,
  Clock, Layers, StickyNote, CornerUpLeft,
} from "lucide-react";

// =====================
// TIMELINE
// =====================
export function Timeline({ communications, onAddNote, onReply }: any) {
  const { contacts, invoices } = useData();
  const [noteDraft, setNoteDraft] = useState("");

  return (
    <div className="max-w-3xl">
      {onAddNote && (
        <div className="bg-white ring-1 ring-stone-200 rounded-lg p-3 mb-4">
          <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Add an internal note..."
            className="w-full text-sm resize-none focus:outline-none placeholder-stone-400" rows={2} />
          {noteDraft && (
            <div className="flex justify-end pt-2 border-t border-stone-100">
              <Button size="sm" onClick={() => { onAddNote(noteDraft); setNoteDraft(""); }}>Save note</Button>
            </div>
          )}
        </div>
      )}

      {communications.length === 0 ? (
        <EmptyState icon={MessageSquare} title="No communications yet" description="Emails, notes and replies will appear here." />
      ) : (
        <div className="space-y-3">
          {communications.map((c: any) => {
            const contact = contacts.find((x: any) => x.id === c.contactId);
            const invoice = invoices.find((x: any) => x.id === c.invoiceId);
            const isInbound = c.direction === "Inbound";
            const isNote = c.channel === "Note";
            return (
              <div key={c.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    isNote ? "bg-amber-50 text-amber-700" : isInbound ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"
                  }`}>
                    {isNote ? <FileEdit size={14} /> : isInbound ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
                  </div>
                  <div className="w-px flex-1 bg-stone-200 mt-1" />
                </div>
                <div className="flex-1 pb-3">
                  <div className="bg-white ring-1 ring-stone-200 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="text-sm font-medium text-stone-900">
                          {isNote ? `Note by ${c.sender || "User"}` : isInbound ? `From ${contact?.name || c.sender}` : `To ${contact?.name || c.recipients}`}
                        </div>
                        {!isNote && <div className="text-[11px] text-stone-500 mt-0.5">{isInbound ? c.sender : c.recipients}</div>}
                      </div>
                      <div className="text-[11px] text-stone-500">{fmt.relative(c.sentAt)}</div>
                    </div>
                    {!isNote && c.subject && <div className="text-sm font-semibold text-stone-900 mb-2">{c.subject}</div>}
                    <div className="text-sm text-stone-700 whitespace-pre-wrap leading-relaxed">{c.body}</div>
                    <div className={`mt-3 pt-3 border-t border-stone-100 flex items-center ${invoice ? "justify-between" : "justify-end"}`}>
                      {invoice && (
                        <div className="flex items-center gap-2">
                          <Link2 size={12} className="text-stone-400" />
                          <span className="text-[11px] text-stone-500">Linked to</span>
                          <span className="text-[11px] font-mono text-stone-700">{invoice.invoiceNumber}</span>
                        </div>
                      )}
                      {!isNote && c.channel === "Email" && onReply && (
                        <button
                          onClick={() => onReply({
                            toEmail:    isInbound ? c.sender : c.recipients,
                            subject:    c.subject ? (c.subject.startsWith("Re:") ? c.subject : `Re: ${c.subject}`) : "",
                            messageId:  c.messageId ?? null,
                            invoiceId:  c.invoiceId,
                            customerId: c.customerId,
                            projectId:  c.projectId,
                          })}
                          className="flex items-center gap-1.5 text-[11px] text-stone-500 hover:text-blue-600 transition-colors"
                        >
                          <CornerUpLeft size={12} />
                          Reply
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// =====================
// EMAIL COMPOSER
// =====================
export function EmailComposer({ context, onClose }: any) {
  const { customers, contacts, invoices, projects, sendEmail } = useData();
  const { data: session } = useSession();

  // Fetch email templates for the template selector
  const [emailTemplates, setEmailTemplates] = useState<any[]>([]);
  useEffect(() => {
    fetch("/api/email-templates")
      .then(r => r.ok ? r.json() : [])
      .then(setEmailTemplates)
      .catch(() => {});
  }, []);

  const customer = customers.find((c: any) => c.id === context.customerId);
  const invoice = context.invoiceId ? invoices.find((i: any) => i.id === context.invoiceId) : null;
  const contextProject = context.projectId ? projects.find((p: any) => p.id === context.projectId) : null;
  // Project contacts first (if projectId context), then customer-level contacts as fallback
  const projectContacts = context.projectId
    ? contacts.filter((c: any) => c.projectId === context.projectId)
    : [];
  const customerContacts = contacts.filter((c: any) => c.customerId === context.customerId && !c.projectId);
  const allContacts = context.projectId
    ? [...projectContacts, ...customerContacts]
    : customerContacts;
  const primaryContact = projectContacts.find((c: any) => c.isPrimary) || customerContacts.find((c: any) => c.isPrimary) || allContacts[0];

  // All open invoices for this customer (for attachment selection)
  const customerOpenInvoices = invoices.filter((i: any) =>
    i.customerId === context.customerId &&
    i.paymentStatus !== "Paid" &&
    i.collectionStage !== "Closed" &&
    i.qboId && !i.qboId.startsWith("CM-")
  );

  // Pre-select current invoice if in single-invoice context
  const [selectedInvIds, setSelectedInvIds] = useState<Set<string>>(
    new Set(context.invoiceId ? [context.invoiceId] : [])
  );
  const [toValue, setToValue] = useState(context.replyTo?.toEmail || primaryContact?.email || "");
  const [ccValue, setCcValue] = useState("");
  const [subject, setSubject] = useState(() => {
    if (context.replyTo?.subject) return context.replyTo.subject;
    const base = invoice
      ? `Outstanding Invoice ${invoice.invoiceNumber} — ${customer?.name}`
      : `Outstanding Invoices — ${customer?.name}`;
    const proj = context.projectId ? projects.find((p: any) => p.id === context.projectId) : null;
    return proj ? `${base} — ${proj.name}` : base;
  });
  const [body, setBody] = useState(() => {
    const senderName = session?.user?.name || "";
    const contactName = primaryContact?.name?.split(" ")[0] || "there";
    if (invoice) {
      const out = invoice.total - (invoice.paid || 0);
      return `Dear ${contactName},

I hope this message finds you well. I am writing to follow up on the outstanding invoice below:

Invoice No: ${invoice.invoiceNumber}
Amount Due: ${fmt.money(out, invoice.currency)}
Due Date: ${invoice.dueDate}

Please arrange payment at your earliest convenience.

Kind regards,
${senderName}`;
    }
    return `Dear ${contactName},

I hope this message finds you well. I am writing to follow up on the outstanding balance on your account.

Kind regards,
${senderName}`;
  });
  const [submitting, setSubmitting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Collections reference number — generated once when the composer opens
  const [refNumber, setRefNumber] = useState<string | null>(null);
  const refFetched = useRef(false);
  useEffect(() => {
    if (refFetched.current) return;
    refFetched.current = true;
    fetch("/api/org/colref", { method: "POST" })
      .then(r => r.json())
      .then(d => {
        if (d.refNumber) {
          setRefNumber(d.refNumber);
          setSubject(prev => `${prev} [${d.refNumber}]`);
          setBody(prev =>
            `${prev}\n\nPlease quote reference ${d.refNumber} in all future correspondence regarding this matter.`
          );
        }
      })
      .catch(console.error);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addEmailToTo = (email: string) => {
    const emails = toValue.split(",").map(e => e.trim()).filter(Boolean);
    if (!emails.includes(email)) setToValue([...emails, email].join(", "));
  };

  const addEmailToCc = (email: string) => {
    const emails = ccValue.split(",").map(e => e.trim()).filter(Boolean);
    if (!emails.includes(email)) setCcValue([...emails, email].join(", "));
  };

  const toggleInv = (id: string) => setSelectedInvIds(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const handleDownloadPdf = async (inv: any) => {
    setDownloadingId(inv.id);
    try {
      const res = await fetch(`/api/invoices/${inv.id}/pdf`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `Invoice-${inv.invoiceNumber}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } finally { setDownloadingId(null); }
  };

  const renderTemplate = (tpl: string) => {
    const senderName = session?.user?.name || "";
    const contactName = primaryContact?.name?.split(" ")[0] || "there";
    const vars: Record<string, string> = {
      contactName, customerName: customer?.name || "",
      invoiceNumber: invoice?.invoiceNumber || "",
      amount: invoice ? fmt.money(invoice.total - (invoice.paid || 0), invoice.currency) : "",
      dueDate: invoice?.dueDate || "",
      daysOverdue: invoice ? String(Math.max(0, daysOverdue(invoice.dueDate))) : "0",
      senderName,
      referenceNumber: refNumber || "",
    };
    return Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), tpl);
  };

  const applyTemplate = (id: string) => {
    const tpl = emailTemplates.find(t => t.id === id);
    if (!tpl) return;
    setSubject(renderTemplate(tpl.subject));
    setBody(renderTemplate(tpl.body));
  };

  const handleSend = async (asDraft = false) => {
    if (!toValue.trim()) return;
    setSubmitting(true);
    let sentMessageId: string | undefined;
    try {
      // Actually send via SMTP with PDF attachments
      if (!asDraft) {
        const res = await fetch("/api/email/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: toValue,
            cc: ccValue || undefined,
            subject,
            body,
            invoiceId: context.invoiceId || undefined,
            // If replying to a specific message, override the server's thread
            // lookup with the exact messageId the user chose to reply to.
            ...(context.replyTo?.messageId ? { inReplyToOverride: context.replyTo.messageId } : {}),
            attachInvoiceIds: selectedInvIds.size > 0 ? Array.from(selectedInvIds) : undefined,
          }),
        });
        if (!res.ok) {
          const d = await res.json();
          alert(d.error || "Failed to send email. Check SMTP settings.");
          setSubmitting(false);
          return;
        }
        const result = await res.json();
        if (result.attachments?.length > 0) {
          console.log(`Sent with ${result.attachments.length} PDF attachment(s)`);
        }
        sentMessageId = result.messageId || undefined;
      }
      // Log to timeline (includes ref number + stage-at-send)
      await sendEmail({
        customerId: context.customerId,
        projectId: context.projectId || null,
        invoiceId: context.invoiceId || null,
        contactId: primaryContact?.id || null,
        subject, body,
        sender: session?.user?.email || "",
        recipients: toValue,
        matchedBy: "Manual",
        isDraft: asDraft,
        refNumber: refNumber || undefined,
        stageAtSend: invoice?.collectionStage || undefined,
        messageId: sentMessageId,
      });
      onClose();
    } catch (e) { console.error(e); }
    finally { setSubmitting(false); }
  };

  const selectedInvoices = customerOpenInvoices.filter((i: any) => selectedInvIds.has(i.id));

  return (
    <Modal open onClose={onClose} title={invoice ? `Email · ${invoice.invoiceNumber}` : "New email"} size="xl"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="secondary" icon={Save} onClick={() => handleSend(true)} disabled={!subject || !body || !toValue || submitting}>Save draft</Button>
        <Button icon={Send} onClick={() => handleSend(false)} disabled={!subject || !body || !toValue || submitting}>{submitting ? "Sending…" : "Send now"}</Button>
      </>}>
      <div className="p-5 space-y-3">

        {/* Reference number badge */}
        {refNumber ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-stone-50 border border-stone-200 rounded-md">
            <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">Ref</span>
            <span className="font-mono text-[12px] font-semibold text-stone-700">{refNumber}</span>
            <span className="text-[11px] text-stone-400 ml-1">· auto-injected into subject & body</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 bg-stone-50 border border-stone-200 rounded-md">
            <span className="text-[11px] text-stone-400">Generating reference number…</span>
          </div>
        )}

        {/* TO field */}
        <div>
          <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">To</label>
          <input value={toValue} onChange={e => setToValue(e.target.value)}
            placeholder="email@example.com, another@example.com"
            className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
          {allContacts.length > 0 && (
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span className="text-[10px] text-stone-400 font-medium uppercase tracking-wider">Quick add:</span>
              {allContacts.map((c: any) => (
                <button key={c.id} onClick={() => addEmailToTo(c.email)}
                  className="text-[11px] px-2 py-0.5 bg-stone-100 hover:bg-stone-200 rounded text-stone-700 transition-colors flex items-center gap-1">
                  {c.isPrimary && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />}
                  {c.projectId && <span className="w-1.5 h-1.5 rounded-full bg-violet-500 flex-shrink-0" title="Project contact" />}
                  {c.name} &lt;{c.email}&gt;
                </button>
              ))}
            </div>
          )}
        </div>

        {/* CC field */}
        <div>
          <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">CC</label>
          <input value={ccValue} onChange={e => setCcValue(e.target.value)}
            placeholder="Optional"
            className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
          {allContacts.filter((c: any) => c.isEscalation).length > 0 && (
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span className="text-[10px] text-stone-400 font-medium uppercase tracking-wider">Escalation:</span>
              {allContacts.filter((c: any) => c.isEscalation).map((c: any) => (
                <button key={c.id} onClick={() => addEmailToCc(c.email)}
                  className="text-[11px] px-2 py-0.5 bg-rose-50 hover:bg-rose-100 rounded text-rose-700 transition-colors">
                  {c.name} &lt;{c.email}&gt;
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Subject + Template */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Subject</label>
            <Input value={subject} onChange={(e: any) => setSubject(e.target.value)} placeholder="Subject..." />
          </div>
          <div>
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Template</label>
            <Select onChange={(e: any) => applyTemplate(e.target.value)} placeholder="Apply template..."
              options={emailTemplates.map(t => ({ value: t.id, label: t.name }))} className="w-full" />
          </div>
        </div>

        {/* Invoice attachments */}
        {customerOpenInvoices.length > 0 && (
          <div>
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1.5">
              Attach invoices ({selectedInvIds.size} selected)
            </label>
            <div className="max-h-32 overflow-y-auto ring-1 ring-stone-200 rounded-md divide-y divide-stone-100">
              {customerOpenInvoices.map((inv: any) => {
                const proj = projects.find((p: any) => p.id === inv.projectId);
                const out = inv.total - (inv.paid || 0);
                return (
                  <div key={inv.id} className={`flex items-center gap-3 px-3 py-2 ${selectedInvIds.has(inv.id) ? "bg-blue-50" : "hover:bg-stone-50"}`}>
                    <input type="checkbox" checked={selectedInvIds.has(inv.id)} onChange={() => toggleInv(inv.id)}
                      className="rounded border-stone-300 cursor-pointer flex-shrink-0" />
                    <span className="font-mono text-[12px] text-stone-700 flex-shrink-0">{inv.invoiceNumber}</span>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {proj && <span className="text-[11px] text-stone-400 truncate">{proj.name}</span>}
                      <span className="text-[11px] text-stone-400 flex-shrink-0">Inv: {fmt.shortDate(inv.invoiceDate)}</span>
                      <span className={`text-[11px] flex-shrink-0 ${daysOverdue(inv.dueDate) > 0 ? "text-rose-500 font-medium" : "text-stone-400"}`}>Due: {fmt.shortDate(inv.dueDate)}</span>
                    </div>
                    <span className="text-[12px] font-medium tabular-nums text-stone-700 flex-shrink-0">{fmt.money(out, inv.currency)}</span>
                    <button onClick={() => handleDownloadPdf(inv)}
                      className="p-1 rounded hover:bg-stone-200 text-stone-400 hover:text-stone-700 flex-shrink-0"
                      title="Download PDF">
                      {downloadingId === inv.id
                        ? <span className="animate-spin inline-block w-3 h-3 border border-stone-400 border-t-transparent rounded-full" />
                        : <Download size={12} />}
                    </button>
                  </div>
                );
              })}
            </div>
            {selectedInvoices.length > 0 && (
              <div className="mt-1.5 text-[11px] text-stone-500 flex items-center gap-1">
                <Paperclip size={11} />
                {selectedInvoices.length} PDF{selectedInvoices.length !== 1 ? "s" : ""} will be attached · Total: {fmt.money(selectedInvoices.reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0))}
              </div>
            )}
          </div>
        )}

        {/* Body */}
        <div>
          <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Message</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10}
            className="w-full text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none p-3 font-mono leading-relaxed"
            placeholder="Write your message..." />
        </div>
      </div>
    </Modal>
  );
}

// =====================
// PAYMENT MODAL
// =====================
export function PaymentModal({ invoice, onClose }: any) {
  const { recordPayment } = useData();
  const out = invoice.total - (invoice.paid || 0);
  const [amount, setAmount] = useState(out);
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);

  const handle = async () => {
    setSubmitting(true);
    try {
      await recordPayment(invoice.id, parseFloat(String(amount)), paidDate);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Record payment" size="sm"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={handle} disabled={!amount || amount <= 0 || submitting}>{submitting ? "Saving…" : "Record"}</Button>
      </>}>
      <div className="p-5 space-y-3">
        <div className="bg-stone-50 rounded-md p-3 text-sm">
          <div className="text-xs text-stone-500 mb-1">Outstanding</div>
          <div className="text-lg font-semibold text-stone-900 tabular-nums">{fmt.money(out, invoice.currency)}</div>
        </div>
        <div>
          <label className="text-xs font-medium text-stone-700 block mb-1">Payment amount ({invoice.currency})</label>
          <Input type="number" value={amount} onChange={(e: any) => setAmount(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-stone-700 block mb-1">Payment date</label>
          <input type="date" value={paidDate} max={new Date().toISOString().slice(0, 10)}
            onChange={e => setPaidDate(e.target.value)}
            className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
        </div>
      </div>
    </Modal>
  );
}

// =====================
// DISPUTE MODAL
// =====================
export function DisputeModal({ invoice, onClose }: any) {
  const { updateInvoice } = useData();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handle = async () => {
    setSubmitting(true);
    try {
      await updateInvoice(invoice.id, { collectionStage: "Disputed", disputeReason: reason, disputeDate: today() });
      onClose();
    } finally { setSubmitting(false); }
  };

  return (
    <Modal open onClose={onClose} title="Mark as disputed" size="sm"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={handle} disabled={!reason.trim() || submitting}>{submitting ? "Saving…" : "Mark disputed"}</Button>
      </>}>
      <div className="p-5">
        <div className="mb-3 text-sm text-stone-600">Marking this invoice as disputed will pause automated reminders.</div>
        <label className="text-xs font-medium text-stone-700 block mb-1">Dispute reason *</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
          className="w-full text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none p-2.5"
          placeholder="Describe the dispute..." />
      </div>
    </Modal>
  );
}

// =====================
// PROMISE MODAL
// =====================
export function PromiseModal({ invoice, onClose }: any) {
  const { updateInvoice } = useData();
  const [date, setDate] = useState(daysFromNow(7));
  const [submitting, setSubmitting] = useState(false);

  const handle = async () => {
    setSubmitting(true);
    try {
      await updateInvoice(invoice.id, { collectionStage: "Promised", promiseDate: date });
      onClose();
    } finally { setSubmitting(false); }
  };

  return (
    <Modal open onClose={onClose} title="Set commitment date" size="sm"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={handle} disabled={submitting}>Set commitment date</Button>
      </>}>
      <div className="p-5">
        <div className="mb-3 text-sm text-stone-600">Reminders will pause until this date.</div>
        <label className="text-xs font-medium text-stone-700 block mb-1">Expected payment date</label>
        <Input type="date" value={date} onChange={(e: any) => setDate(e.target.value)} />
      </div>
    </Modal>
  );
}

// =====================
// TASK MODAL
// =====================
export function TaskModal({ invoiceId, customerId, onClose }: any) {
  const { addTask } = useData();
  const [form, setForm] = useState<any>({ title: "", description: "", dueDate: daysFromNow(3), priority: "Medium" });
  const [submitting, setSubmitting] = useState(false);

  const handle = async () => {
    setSubmitting(true);
    try {
      await addTask({ ...form, invoiceId, customerId, labels: [] });
      onClose();
    } finally { setSubmitting(false); }
  };

  return (
    <Modal open onClose={onClose} title="Add task" size="sm"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={handle} disabled={!form.title || submitting}>Add task</Button>
      </>}>
      <div className="p-5 space-y-3">
        <div><label className="text-xs font-medium text-stone-700 block mb-1">Title *</label><Input value={form.title} onChange={(e: any) => setForm({ ...form, title: e.target.value })} /></div>
        <div><label className="text-xs font-medium text-stone-700 block mb-1">Description</label>
          <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none p-2.5" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs font-medium text-stone-700 block mb-1">Due date</label><Input type="date" value={form.dueDate} onChange={(e: any) => setForm({ ...form, dueDate: e.target.value })} /></div>
          <div><label className="text-xs font-medium text-stone-700 block mb-1">Priority</label><Select value={form.priority} onChange={(e: any) => setForm({ ...form, priority: e.target.value })} options={["Low", "Medium", "High", "Urgent"]} className="w-full" /></div>
        </div>
      </div>
    </Modal>
  );
}

// =====================
// ADD CONTACT MODAL
// =====================
export function AddContactModal({ customerId, projectId, onClose }: any) {
  const { addContact } = useData();
  const [form, setForm] = useState<any>({ name: "", title: "", email: "", phone: "", type: "Billing", isPrimary: false, isEscalation: false, receivesAuto: true });
  const [submitting, setSubmitting] = useState(false);

  const handle = async () => {
    setSubmitting(true);
    try {
      await addContact({ ...form, customerId, projectId: projectId || null });
      onClose();
    } finally { setSubmitting(false); }
  };

  return (
    <Modal open onClose={onClose} title="Add contact" size="md"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={handle} disabled={!form.name || !form.email || submitting}>Add contact</Button>
      </>}>
      <div className="p-5 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs font-medium text-stone-700 block mb-1">Name *</label><Input value={form.name} onChange={(e: any) => setForm({ ...form, name: e.target.value })} placeholder="Full name" /></div>
          <div><label className="text-xs font-medium text-stone-700 block mb-1">Job title</label><Input value={form.title} onChange={(e: any) => setForm({ ...form, title: e.target.value })} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs font-medium text-stone-700 block mb-1">Email *</label><Input type="email" value={form.email} onChange={(e: any) => setForm({ ...form, email: e.target.value })} /></div>
          <div><label className="text-xs font-medium text-stone-700 block mb-1">Phone</label><Input value={form.phone} onChange={(e: any) => setForm({ ...form, phone: e.target.value })} /></div>
        </div>
        <div><label className="text-xs font-medium text-stone-700 block mb-1">Contact type</label>
          <Select value={form.type} onChange={(e: any) => setForm({ ...form, type: e.target.value })} options={["Billing", "Finance", "Project", "Escalation", "Legal", "Other"]} className="w-full" />
        </div>
        <div className="space-y-1.5 pt-1">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} className="rounded" /> Primary billing contact</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isEscalation} onChange={(e) => setForm({ ...form, isEscalation: e.target.checked })} className="rounded" /> Escalation contact</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.receivesAuto} onChange={(e) => setForm({ ...form, receivesAuto: e.target.checked })} className="rounded" /> Receives automated emails</label>
        </div>
      </div>
    </Modal>
  );
}

// =====================
// TASKS LIST
// =====================
export function TasksList({ tasks, showAssignee = true }: any) {
  const { toggleTask } = useData();
  if (tasks.length === 0) return <EmptyState icon={Circle} title="No tasks" description="Tasks created here will appear in this list." />;
  return (
    <Card padding="none">
      {tasks.map((t: any) => (
        <div key={t.id} className="flex items-center gap-3 px-4 py-3 border-b border-stone-100 last:border-0 hover:bg-stone-50">
          <button onClick={() => toggleTask(t.id, !t.completed)} className="flex-shrink-0">
            {t.completed ? <Check size={16} className="text-emerald-600" /> : <Circle size={16} className="text-stone-300 hover:text-stone-500" />}
          </button>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-medium ${t.completed ? "text-stone-400 line-through" : "text-stone-900"}`}>{t.title}</div>
            {t.description && <div className="text-[12px] text-stone-500 mt-0.5">{t.description}</div>}
          </div>
          {t.priority === "Urgent" && <span className="text-[11px] px-2 py-0.5 rounded-md ring-1 ring-inset bg-rose-50 text-rose-700 ring-rose-200 font-medium">Urgent</span>}
          {t.priority === "High" && <span className="text-[11px] px-2 py-0.5 rounded-md ring-1 ring-inset bg-orange-50 text-orange-700 ring-orange-200 font-medium">High</span>}
          {(t.labels || []).map((l: string) => <span key={l} className="text-[11px] px-2 py-0.5 rounded-md ring-1 ring-inset bg-stone-100 text-stone-700 ring-stone-200 font-medium">{l}</span>)}
          <div className="text-[11px] text-stone-500 whitespace-nowrap">{fmt.relative(t.dueDate)}</div>
        </div>
      ))}
    </Card>
  );
}

// =====================
// AUDIT TIMELINE
// =====================
const EVENT_META: Record<string, {
  label: string;
  Icon: React.ComponentType<any>;
  color: string;   // tailwind ring/bg colour token
  dot: string;     // dot bg class
}> = {
  email_sent:        { label: "Automated Reminder Sent",  Icon: Send,             color: "blue",   dot: "bg-blue-500" },
  email_manual:      { label: "Manual Email Sent",        Icon: Mail,             color: "blue",   dot: "bg-blue-400" },
  note_added:        { label: "Internal Note",            Icon: StickyNote,       color: "stone",  dot: "bg-stone-400" },
  stage_changed:     { label: "Stage Changed",            Icon: Layers,           color: "violet", dot: "bg-violet-500" },
  payment_recorded:  { label: "Payment Recorded",         Icon: CreditCard,       color: "emerald",dot: "bg-emerald-500" },
  promise_to_pay:    { label: "Promise to Pay",           Icon: Calendar,         color: "amber",  dot: "bg-amber-500" },
  dispute_raised:    { label: "Dispute Raised",           Icon: AlertTriangle,    color: "rose",   dot: "bg-rose-500" },
  programme_toggled: { label: "Collection Programme",     Icon: Zap,              color: "orange", dot: "bg-orange-500" },
  chase_mode_changed:{ label: "Chase Mode Changed",       Icon: ArrowRightLeft,   color: "violet", dot: "bg-violet-400" },
  invoice_synced:    { label: "Invoice Synced (QBO)",     Icon: RefreshCw,        color: "stone",  dot: "bg-stone-300" },
  contact_updated:   { label: "Contact Updated",          Icon: Users,            color: "stone",  dot: "bg-stone-400" },
};

const COLOR_CLASSES: Record<string, string> = {
  blue:    "bg-blue-50 text-blue-700 ring-blue-200",
  violet:  "bg-violet-50 text-violet-700 ring-violet-200",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber:   "bg-amber-50 text-amber-700 ring-amber-200",
  rose:    "bg-rose-50 text-rose-700 ring-rose-200",
  orange:  "bg-orange-50 text-orange-700 ring-orange-200",
  stone:   "bg-stone-100 text-stone-600 ring-stone-200",
};

function EventDetail({ meta, eventType }: { meta: any; eventType: string }) {
  if (!meta || typeof meta !== "object") return null;
  const parts: React.ReactNode[] = [];

  if (eventType === "stage_changed" && meta.fromStage) {
    parts.push(
      <span key="stage" className="flex items-center gap-1.5">
        <span className="font-mono text-[11px] px-1.5 py-0.5 bg-stone-100 rounded">{meta.fromStage}</span>
        <ArrowRightLeft size={11} className="text-stone-400 flex-shrink-0" />
        <span className="font-mono text-[11px] px-1.5 py-0.5 bg-stone-900 text-white rounded">{meta.toStage}</span>
        {meta.invoiceNo && <span className="text-stone-400 text-[11px]">· {meta.invoiceNo}</span>}
      </span>
    );
  }

  if (eventType === "payment_recorded" && meta.amount != null) {
    const isPaid = meta.isPaid;
    parts.push(
      <span key="pay" className="flex items-center gap-1.5">
        <span className={`font-semibold ${isPaid ? "text-emerald-700" : "text-stone-700"}`}>
          {meta.currency}{Number(meta.amount).toFixed(2)}
        </span>
        {meta.invoiceNo && <span className="text-stone-400 text-[11px]">· {meta.invoiceNo}</span>}
        {isPaid && <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 font-medium">Fully Paid</span>}
        {!isPaid && <span className="text-[11px] text-stone-400">({meta.currency}{Number(meta.totalPaid).toFixed(2)} of {meta.currency}{Number(meta.invoiceTotal).toFixed(2)})</span>}
      </span>
    );
  }

  if (eventType === "promise_to_pay" && meta.promiseDate) {
    parts.push(
      <span key="promise" className="text-[12px]">
        Commitment date: <strong>{meta.promiseDate}</strong>
        {meta.invoiceNo && <span className="text-stone-400 ml-1.5">· {meta.invoiceNo}</span>}
      </span>
    );
  }

  if (eventType === "dispute_raised" && meta.reason) {
    parts.push(
      <span key="dispute" className="text-[12px] text-rose-700">
        {meta.reason}
        {meta.invoiceNo && <span className="text-stone-400 ml-1.5">· {meta.invoiceNo}</span>}
      </span>
    );
  }

  if ((eventType === "email_sent" || eventType === "email_manual") && meta.subject) {
    parts.push(
      <span key="email" className="flex flex-col gap-0.5">
        <span className="text-[12px] font-medium text-stone-800">{meta.subject}</span>
        {meta.to && <span className="text-[11px] text-stone-400">To: {meta.to}</span>}
      </span>
    );
  }

  if (eventType === "note_added" && meta.body) {
    const excerpt = (meta.body as string).slice(0, 160);
    parts.push(
      <span key="note" className="text-[12px] text-stone-600 italic">
        {excerpt}{(meta.body as string).length > 160 ? "…" : ""}
      </span>
    );
  }

  if (eventType === "programme_toggled") {
    parts.push(
      <span key="prog" className={`text-[12px] font-medium ${meta.enabled ? "text-emerald-700" : "text-stone-500"}`}>
        {meta.enabled ? "Programme enabled" : "Programme disabled"}
        {meta.customerName && <span className="text-stone-400 font-normal ml-1.5">· {meta.customerName}</span>}
      </span>
    );
  }

  if (eventType === "chase_mode_changed") {
    parts.push(
      <span key="chase" className="text-[12px]">
        Switched to <strong>{meta.mode}</strong>
        {meta.customerName && <span className="text-stone-400 ml-1.5">· {meta.customerName}</span>}
      </span>
    );
  }

  return parts.length > 0 ? <div className="mt-1 flex flex-col gap-1">{parts}</div> : null;
}

export function AuditTimeline({ customerId, projectId, label }: {
  customerId?: string;
  projectId?: string;
  label?: string;
}) {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!customerId && !projectId) return;
    setLoading(true);
    setError(false);
    const params = new URLSearchParams();
    if (customerId) params.set("customerId", customerId);
    if (projectId)  params.set("projectId",  projectId);
    fetch(`/api/audit-events?${params}`)
      .then(r => { if (!r.ok) throw new Error("Failed"); return r.json(); })
      .then(data => { setEvents(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [customerId, projectId]);

  const exportUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (customerId) params.set("customerId", customerId);
    if (projectId)  params.set("projectId",  projectId);
    if (label)      params.set("name", label);
    return `/api/audit-events/export?${params}`;
  }, [customerId, projectId, label]);

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-[11px] text-stone-400 font-medium uppercase tracking-wider">
          {loading ? "Loading…" : `${events.length} event${events.length !== 1 ? "s" : ""} · immutable audit trail`}
        </div>
        <a
          href={exportUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-stone-50 ring-1 ring-stone-200 text-stone-600 hover:bg-stone-100 hover:text-stone-900 transition-colors"
        >
          <FileDown size={13} />
          Export PDF
        </a>
      </div>

      {/* Timeline */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-stone-400">
          <Clock size={20} className="animate-spin mr-2" />
          Loading audit trail…
        </div>
      ) : error ? (
        <div className="text-center py-12 text-rose-500 text-sm">Failed to load audit events.</div>
      ) : events.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-3">
            <Clock size={18} className="text-stone-400" />
          </div>
          <div className="text-sm font-medium text-stone-600">No events recorded yet</div>
          <div className="text-[12px] text-stone-400 mt-1">Activity will appear here as actions are taken.</div>
        </div>
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[17px] top-4 bottom-4 w-px bg-stone-200" />

          <div className="space-y-0">
            {events.map((ev: any, i: number) => {
              const cfg = EVENT_META[ev.eventType] ?? {
                label: ev.eventType,
                Icon: Circle,
                color: "stone",
                dot: "bg-stone-300",
              };
              const { Icon, dot, color, label: evLabel } = cfg;
              const colorCls = COLOR_CLASSES[color] ?? COLOR_CLASSES.stone;
              const isLast = i === events.length - 1;

              return (
                <div key={ev.id} className={`relative flex gap-4 ${isLast ? "pb-0" : "pb-5"}`}>
                  {/* Dot */}
                  <div className={`relative z-10 w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ring-2 ring-white ${dot}`}>
                    <Icon size={14} className="text-white" strokeWidth={2.5} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 pt-1.5">
                    <div className="flex items-start gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ring-1 ${colorCls}`}>
                        {evLabel}
                      </span>
                      {ev.actorName && (
                        <span className="text-[11px] text-stone-500">by {ev.actorName}</span>
                      )}
                    </div>

                    <EventDetail meta={ev.meta} eventType={ev.eventType} />

                    <div className="text-[11px] text-stone-400 mt-1.5">
                      {new Date(ev.occurredAt).toLocaleString("en-GB", {
                        day: "numeric", month: "short", year: "numeric",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// =====================
// BATCH EMAIL MODAL
// =====================
const BATCH_PLACEHOLDERS = [
  { key: "{name}",          desc: "Contact's first name (e.g. John, or Sir/Madam)" },
  { key: "{invoiceNumber}", desc: "Invoice number (e.g. INV-1042)" },
  { key: "{amount}",        desc: "Outstanding balance for this invoice" },
  { key: "{dueDate}",       desc: "Invoice due date" },
  { key: "{ref}",           desc: "Customer code or project name" },
];

export function BatchEmailModal({ invoiceIds, onClose }: { invoiceIds: string[]; onClose: () => void }) {
  const { invoices, customers, projects, contacts, toast, orgSettings } = useData();
  const { data: session } = useSession();

  const senderName = (session?.user?.name as string | undefined)
    || (orgSettings as any)?.displayName
    || (orgSettings as any)?.name
    || "Accounts Receivable";

  const defaultSubject = "Invoice {invoiceNumber} — {ref}";
  const defaultBody =
`Dear {name},

Please find attached invoice {invoiceNumber} for the amount of {amount}.

Due date: {dueDate}

Please don't hesitate to get in touch if you have any questions.

Kind regards,
${senderName}`;

  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody]       = useState(defaultBody);
  const [attachPdf, setAttachPdf]   = useState(true);
  const [sending, setSending]       = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showPlaceholders, setShowPlaceholders] = useState(false);
  const [results, setResults] = useState<{
    sent: number; skipped: string[]; failed: string[]; pdfErrors: string[];
  } | null>(null);

  // Fetch org's saved templates so users can optionally load one
  const [orgTemplates, setOrgTemplates] = useState<any[]>([]);
  useEffect(() => {
    fetch("/api/email-templates")
      .then(r => r.ok ? r.json() : [])
      .then(setOrgTemplates)
      .catch(() => {});
  }, []);

  // ── helpers ──────────────────────────────────────────────────────────────────

  function resolveEmail(inv: any): string | null {
    if (inv.billingEmail) return inv.billingEmail;
    const primary = (contacts as any[]).find(
      (c: any) => c.customerId === inv.customerId && c.isPrimary && c.email
    );
    if (primary) return primary.email;
    const cust = (customers as any[]).find((c: any) => c.id === inv.customerId);
    return cust?.email || null;
  }

  function resolveContactFirstName(inv: any): string {
    const primary = (contacts as any[]).find((c: any) => c.customerId === inv.customerId && c.isPrimary);
    const fullName = primary?.name || (customers as any[]).find((c: any) => c.id === inv.customerId)?.name || "";
    return fullName.split(" ")[0] || "Sir/Madam";
  }

  function resolveRef(inv: any): string {
    if (inv.projectId) {
      const proj = (projects as any[]).find((p: any) => p.id === inv.projectId);
      return proj?.name || proj?.code || "";
    }
    const cust = (customers as any[]).find((c: any) => c.id === inv.customerId);
    return cust?.code || cust?.name || "";
  }

  function fillVars(template: string, inv: any): string {
    const isPaidOrClosed =
      ["Paid", "Written Off"].includes(inv.paymentStatus) || inv.collectionStage === "Closed";
    const outstanding = isPaidOrClosed ? 0 : inv.total - (inv.paid || 0);
    const vars: Record<string, string> = {
      name:          resolveContactFirstName(inv),
      invoiceNumber: inv.invoiceNumber,
      amount:        fmt.money(outstanding, inv.currency),
      dueDate:       fmt.date(inv.dueDate),
      ref:           resolveRef(inv),
    };
    return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
  }

  function countEmails(emailStr: string | null): number {
    if (!emailStr) return 0;
    return emailStr.split(",").map(e => e.trim()).filter(e => e.includes("@")).length;
  }

  // ── derived data ──────────────────────────────────────────────────────────────

  const selectedInvoices = (invoices as any[]).filter((i: any) => invoiceIds.includes(i.id));

  const rows = selectedInvoices.map((inv: any) => {
    const email = resolveEmail(inv);
    const cust  = (customers as any[]).find((c: any) => c.id === inv.customerId);
    return { inv, email, customerName: cust?.name || inv.invoiceNumber };
  });

  const withEmail    = rows.filter(r => r.email);
  const withoutEmail = rows.filter(r => !r.email);

  // Preview uses the first invoice that has an email
  const previewRow = withEmail[0] ?? rows[0];
  const previewSubject = previewRow ? fillVars(subject, previewRow.inv) : subject;
  const previewBody    = previewRow ? fillVars(body, previewRow.inv) : body;

  // ── send ──────────────────────────────────────────────────────────────────────

  const handleSend = async () => {
    if (!subject.trim()) { toast("Subject is required", "error"); return; }
    if (!body.trim())    { toast("Message body is required", "error"); return; }

    setSending(true);
    const sent: string[]      = [];
    const failed: string[]    = [];
    const pdfErrors: string[] = [];
    const skipped = withoutEmail.map(r => r.customerName);
    const emailRef = genEmailRef();

    for (const { inv, email } of withEmail) {
      if (!email) continue;
      const filledSubject = `${fillVars(subject, inv)} — Ref ${emailRef}`;
      const filledBody    = fillVars(body, inv);
      try {
        const isClosedOrPaid =
          ["Paid", "Written Off"].includes(inv.paymentStatus) || inv.collectionStage === "Closed";
        const canAttach = attachPdf && inv.qboId && !inv.qboId.startsWith("CM-") && !isClosedOrPaid;

        // Branded email (same template as every channel) + portal link
        let portalUrl: string | null = null;
        try {
          const tk = await fetch("/api/portal/token", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ customerId: inv.customerId, invoiceIds: [inv.id] }),
          });
          if (tk.ok) portalUrl = (await tk.json()).url ?? null;
        } catch {}
        const cust = (customers as any[]).find((c: any) => c.id === inv.customerId);
        const proj = (projects as any[]).find((p: any) => p.id === inv.projectId);
        const outstanding = isClosedOrPaid ? 0 : inv.total - (inv.paid || 0);
        const html = renderInvoiceEmail({
          subject: filledSubject,
          dateStr: fmt.date(new Date()),
          total: outstanding, currency: inv.currency, portalUrl, intro: filledBody,
          rows: [{
            invoiceNumber: inv.invoiceNumber, customerName: cust?.name ?? null, projectName: proj?.name ?? null,
            invoiceDate: inv.invoiceDate, dueDate: inv.dueDate, balance: outstanding,
            currency: inv.currency, daysOverdue: daysOverdue(inv.dueDate),
          }],
        });

        const res = await fetch("/api/email/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to:        email,
            subject:   filledSubject,
            body:      html,
            invoiceId: inv.id,
            ...(canAttach ? { attachInvoiceIds: [inv.id] } : {}),
          }),
        });
        if (!res.ok) throw new Error("Send failed");

        const result = await res.json();
        if (result.attachmentErrors?.length > 0) {
          pdfErrors.push(...result.attachmentErrors.map((e: string) => `${inv.invoiceNumber}: ${e}`));
        }

        // Log to communications timeline
        await fetch("/api/communications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerId: inv.customerId,
            invoiceId:  inv.id,
            direction:  "Outbound",
            channel:    "Email",
            subject:    filledSubject,
            recipients: email,
            body:       filledBody,
            matchedBy:  "Manual",
            refNumber:  emailRef,
            messageId:  result.messageId || undefined,
          }),
        });

        sent.push(inv.invoiceNumber);
      } catch {
        failed.push(inv.invoiceNumber);
      }
    }

    setResults({ sent: sent.length, skipped, failed, pdfErrors });
    setSending(false);
    if (sent.length > 0) toast(`Sent ${sent.length} email${sent.length > 1 ? "s" : ""}`);
  };

  // ── render ────────────────────────────────────────────────────────────────────

  return (
    <Modal
      open
      title={`Send invoices — ${selectedInvoices.length} selected`}
      onClose={onClose}
      size="xl"
    >
      {results ? (
        /* ── Results screen ── */
        <div className="p-5 space-y-4">
          <div className={`flex items-start gap-3 p-4 ring-1 rounded-xl ${
            results.sent > 0 ? "bg-emerald-50 ring-emerald-200" : "bg-rose-50 ring-rose-200"
          }`}>
            <CheckCircle size={20} className={`flex-shrink-0 mt-0.5 ${results.sent > 0 ? "text-emerald-600" : "text-rose-500"}`} />
            <div className="space-y-1 text-sm">
              <div className={`font-semibold ${results.sent > 0 ? "text-emerald-900" : "text-rose-800"}`}>
                {results.sent} email{results.sent !== 1 ? "s" : ""} sent successfully
              </div>
              {results.skipped.length > 0 && (
                <div className="text-xs text-stone-600">
                  {results.skipped.length} skipped (no email): {results.skipped.join(", ")}
                </div>
              )}
              {results.failed.length > 0 && (
                <div className="text-xs text-rose-700">
                  {results.failed.length} failed to send: {results.failed.join(", ")}
                </div>
              )}
              {results.pdfErrors.length > 0 && (
                <div className="mt-2 pt-2 border-t border-amber-200">
                  <div className="text-xs font-semibold text-amber-700 mb-1">
                    ⚠ PDF attachment issues ({results.pdfErrors.length}):
                  </div>
                  {results.pdfErrors.map((e, i) => (
                    <div key={i} className="text-xs text-amber-700">{e}</div>
                  ))}
                  <div className="text-xs text-amber-600 mt-1">
                    Emails were delivered but without PDF attachments.
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        /* ── Composer screen ── */
        <div className="flex gap-0 h-[600px] overflow-hidden">

          {/* Left pane — compose */}
          <div className="flex-1 flex flex-col min-w-0 border-r border-stone-100">
            <div className="flex-1 overflow-y-auto p-5 space-y-4">

              {/* Load from template (optional) */}
              {orgTemplates.length > 0 && (
                <div>
                  <label className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider block mb-1">
                    Load from saved template (optional)
                  </label>
                  <select
                    defaultValue=""
                    onChange={e => {
                      const t = orgTemplates.find(t => t.id === e.target.value);
                      if (t) { setSubject(t.subject); setBody(t.body); }
                      e.target.value = "";
                    }}
                    className="w-full h-9 px-3 text-sm rounded-lg ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none bg-white"
                  >
                    <option value="">— Pick a template to pre-fill —</option>
                    {orgTemplates.map((t: any) => (
                      <option key={t.id} value={t.id}>{t.name}{t.collectionStage ? ` (${t.collectionStage})` : ""}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Subject */}
              <div>
                <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">
                  Subject
                </label>
                <input
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  placeholder="e.g. Invoice {invoiceNumber} — {ref}"
                  className="w-full h-9 px-3 text-sm rounded-lg ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none bg-white"
                />
              </div>

              {/* Body */}
              <div className="flex-1 flex flex-col">
                <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">
                  Message
                  <span className="ml-1.5 font-normal text-stone-400 normal-case tracking-normal">
                    — one email per invoice, placeholders filled automatically
                  </span>
                </label>
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  rows={12}
                  className="w-full flex-1 px-3 py-2.5 text-sm rounded-lg ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none bg-white font-mono leading-relaxed resize-none"
                  placeholder="Write your message here…"
                />
              </div>

              {/* Placeholder reference */}
              <div className="rounded-lg ring-1 ring-stone-200 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowPlaceholders(v => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-medium text-stone-500 hover:bg-stone-50 transition-colors"
                >
                  <span>Placeholder reference</span>
                  <span className={`transition-transform ${showPlaceholders ? "rotate-180" : ""}`}>▾</span>
                </button>
                {showPlaceholders && (
                  <div className="px-3 pb-3 border-t border-stone-100 space-y-1.5 pt-2">
                    {BATCH_PLACEHOLDERS.map(({ key, desc }) => (
                      <div key={key} className="flex items-start gap-2">
                        <code className="text-[11px] font-mono bg-stone-100 px-1.5 py-0.5 rounded text-stone-700 shrink-0">{key}</code>
                        <span className="text-[11px] text-stone-500">{desc}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Attach PDF toggle */}
              <label className="flex items-center gap-3 cursor-pointer select-none py-1">
                <div
                  onClick={() => setAttachPdf(p => !p)}
                  className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5 shrink-0 ${attachPdf ? "bg-stone-900" : "bg-stone-200"}`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${attachPdf ? "translate-x-4" : "translate-x-0"}`} />
                </div>
                <div>
                  <div className="text-sm font-medium text-stone-800">Attach invoice PDF</div>
                  <div className="text-[11px] text-stone-400">Fetches each PDF from QuickBooks and attaches to the email</div>
                </div>
              </label>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-stone-100 flex items-center justify-between gap-3 shrink-0 bg-white">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowPreview(v => !v)}
                  className={`h-9 px-3 text-[12px] font-medium rounded-lg ring-1 transition-colors ${
                    showPreview ? "bg-stone-900 text-white ring-stone-900" : "ring-stone-200 text-stone-600 hover:ring-stone-400"
                  }`}
                >
                  {showPreview ? "Hide preview" : "Preview"}
                </button>
                <Button
                  icon={Send}
                  disabled={sending || withEmail.length === 0}
                  onClick={handleSend}
                >
                  {sending
                    ? "Sending…"
                    : `Send to ${withEmail.length} invoice${withEmail.length !== 1 ? "s" : ""}`}
                </Button>
              </div>
            </div>
          </div>

          {/* Right pane — recipients + preview */}
          <div className="w-72 shrink-0 flex flex-col overflow-hidden bg-stone-50/60">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">

              {/* Recipient list */}
              <div>
                <div className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-2">
                  Recipients
                  <span className="ml-1.5 font-normal normal-case">
                    {withEmail.length} ready
                    {withoutEmail.length > 0 && ` · ${withoutEmail.length} skipped`}
                  </span>
                </div>
                <div className="space-y-1">
                  {rows.map(({ inv, email, customerName }) => {
                    const emailCount = countEmails(email);
                    return (
                      <div key={inv.id} className={`rounded-lg px-2.5 py-2 text-[12px] ${email ? "bg-white ring-1 ring-stone-200" : "bg-rose-50 ring-1 ring-rose-100"}`}>
                        <div className="flex items-center gap-1.5">
                          {email
                            ? <CheckCircle size={11} className="text-emerald-500 shrink-0" />
                            : <XCircle size={11} className="text-rose-400 shrink-0" />}
                          <span className="font-mono text-[11px] text-stone-400 shrink-0">{inv.invoiceNumber}</span>
                          <span className="font-medium text-stone-800 truncate">{customerName}</span>
                        </div>
                        {email ? (
                          <div className="mt-0.5 ml-4 text-[11px] text-stone-400 truncate">
                            {email.split(",")[0].trim()}
                            {emailCount > 1 && <span className="ml-1 text-blue-500">+{emailCount - 1}</span>}
                          </div>
                        ) : (
                          <div className="mt-0.5 ml-4 text-[11px] text-rose-400 italic">No email — skipped</div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {withoutEmail.length > 0 && (
                  <div className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 ring-1 ring-amber-200 rounded-lg p-2.5">
                    <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                    <span>
                      {withoutEmail.length} invoice{withoutEmail.length > 1 ? "s" : ""} have no billing email. Add an email in QBO or to the customer contact.
                    </span>
                  </div>
                )}
              </div>

              {/* Live preview */}
              {showPreview && previewRow && (
                <div>
                  <div className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-2">
                    Preview — {previewRow.inv.invoiceNumber}
                  </div>
                  <div className="bg-white ring-1 ring-stone-200 rounded-lg p-3 space-y-2">
                    <div>
                      <div className="text-[10px] text-stone-400 font-medium">Subject</div>
                      <div className="text-[12px] font-semibold text-stone-800 break-words">{previewSubject}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-stone-400 font-medium mb-0.5">Body</div>
                      <div className="text-[11px] text-stone-700 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                        {previewBody}
                      </div>
                    </div>
                  </div>
                  <div className="text-[10px] text-stone-400 mt-1.5 text-center">
                    Each invoice gets its own copy with values filled in
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
