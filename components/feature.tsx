"use client";

import { useState, useEffect, useRef } from "react";
import { Modal, Button, Input, Select, Card, EmptyState } from "./ui";
import { fmt, daysOverdue, today, daysFromNow, emailTemplates } from "@/lib/format";
import { useData } from "./data-provider";
import { useSession } from "next-auth/react";
import { ArrowDownRight, ArrowUpRight, FileEdit, Link2, Save, Send, Paperclip, MessageSquare, Circle, Check, Download } from "lucide-react";

// =====================
// TIMELINE
// =====================
export function Timeline({ communications, onAddNote }: any) {
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
                    {invoice && (
                      <div className="mt-3 pt-3 border-t border-stone-100 flex items-center gap-2">
                        <Link2 size={12} className="text-stone-400" />
                        <span className="text-[11px] text-stone-500">Linked to</span>
                        <span className="text-[11px] font-mono text-stone-700">{invoice.invoiceNumber}</span>
                      </div>
                    )}
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
  const [toValue, setToValue] = useState(primaryContact?.email || "");
  const [ccValue, setCcValue] = useState("");
  const [subject, setSubject] = useState(() => {
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
  const [submitting, setSubmitting] = useState(false);

  const handle = async () => {
    setSubmitting(true);
    try {
      await recordPayment(invoice.id, parseFloat(String(amount)));
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
    <Modal open onClose={onClose} title="Set promise to pay date" size="sm"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={handle} disabled={submitting}>Set promise date</Button>
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
