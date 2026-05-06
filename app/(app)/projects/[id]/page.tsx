"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { Card, Badge, Button, EmptyState, stageBadge, dueStatusBadge } from "@/components/ui";
import { fmt, daysOverdue, getDueStatus } from "@/lib/format";
import { ArrowLeft, FileText, Mail, Download, Loader } from "lucide-react";
import { getProjectRegion } from "@/lib/regions";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { projects, customers, invoices, contacts, updateInvoice } = useData();
  const [tab, setTab] = useState<"invoices" | "compose">("invoices");
  const [selectedInvIds, setSelectedInvIds] = useState<Set<string>>(new Set());
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [composeTo, setComposeTo] = useState("");
  const [composeCc, setComposeCc] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [sending, setSending] = useState(false);
  const [attachingPdfs, setAttachingPdfs] = useState(false);

  const project = projects.find(p => p.id === id);
  const customer = project ? customers.find(c => c.id === project.customerId) : null;
  const custContacts = customer ? contacts.filter(c => c.customerId === customer.id) : [];

  if (!project || !customer) {
    return (
      <div className="p-6">
        <EmptyState icon={FileText} title="Project not found"
          action={<Button onClick={() => router.push("/projects")}>Back to projects</Button>} />
      </div>
    );
  }

  const projInvoices = useMemo(() =>
    invoices.filter(i => i.projectId === id)
      .sort((a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime()),
    [invoices, id]
  );

  const open = projInvoices.filter(i => i.paymentStatus !== "Paid" && i.collectionStage !== "Closed");
  const outstanding = open.reduce((s, i) => s + (i.total - (i.paid || 0)), 0);
  const overdue = open.filter(i => daysOverdue(i.dueDate) > 0).reduce((s, i) => s + (i.total - (i.paid || 0)), 0);
  const region = getProjectRegion(project);

  const toggleInv = (invId: string) => setSelectedInvIds(prev => {
    const n = new Set(prev);
    n.has(invId) ? n.delete(invId) : n.add(invId);
    return n;
  });

  const handleDownloadPdf = async (e: React.MouseEvent, inv: any) => {
    e.preventDefault();
    if (!inv.qboId || inv.qboId.startsWith("CM-")) return;
    setDownloadingId(inv.id);
    try {
      const res = await fetch(`/api/invoices/${inv.id}/pdf`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `Invoice-${inv.invoiceNumber}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } finally { setDownloadingId(null); }
  };

  const startCompose = () => {
    const primaryContact = custContacts.find(c => c.isPrimary) || custContacts[0];
    setComposeTo(primaryContact?.email || "");
    setComposeSubject(`Outstanding Invoices — ${project.name}`);
    const selectedInvs = open.filter(i => selectedInvIds.has(i.id));
    const invList = (selectedInvs.length > 0 ? selectedInvs : open)
      .map(i => `• Invoice ${i.invoiceNumber} — ${fmt.money(i.total - (i.paid || 0), customer.currency)} — Due ${i.dueDate}`)
      .join("\n");
    setComposeBody(
      `Dear ${primaryContact?.name || customer.name},\n\nPlease find below a summary of outstanding invoices for ${project.name}:\n\n${invList}\n\nTotal outstanding: ${fmt.money(outstanding, customer.currency)}\n\nKind regards`
    );
    setTab("compose");
  };

  const handleSend = async () => {
    setSending(true);
    try {
      const selectedIds = selectedInvIds.size > 0 ? Array.from(selectedInvIds) : open.map(i => i.id);
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: composeTo,
          cc: composeCc || undefined,
          subject: composeSubject,
          body: composeBody,
          attachInvoiceIds: selectedIds,
        }),
      });
      if (res.ok) {
        alert("Email sent successfully!");
        setTab("invoices");
      } else {
        const d = await res.json();
        alert(d.error || "Failed to send");
      }
    } finally { setSending(false); }
  };

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <Link href={`/customers/${customer.id}`} className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-900 mb-4">
        <ArrowLeft size={14} /> Back to {customer.name}
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">{project.name}</h1>
          <div className="flex items-center gap-2 text-sm text-stone-500 mt-1">
            <span className="font-mono text-xs">{project.code}</span>
            <span>·</span>
            <Link href={`/customers/${customer.id}`} className="hover:text-stone-900">{customer.name}</Link>
            <span>·</span>
            <span>{region}</span>
          </div>
        </div>
        <Button icon={Mail} onClick={startCompose}>Send email</Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Outstanding</div>
          <div className="text-xl font-semibold text-stone-900 tabular-nums">{fmt.money(outstanding, customer.currency)}</div>
        </Card>
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Overdue</div>
          <div className={`text-xl font-semibold tabular-nums ${overdue > 0 ? "text-rose-600" : "text-stone-900"}`}>{fmt.money(overdue, customer.currency)}</div>
        </Card>
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Open invoices</div>
          <div className="text-xl font-semibold text-stone-900">{open.length}</div>
        </Card>
      </div>

      {/* Tabs */}
      <div className="border-b border-stone-200 mb-5 flex items-center gap-1">
        {[
          { id: "invoices", label: `Invoices (${projInvoices.length})` },
          { id: "compose", label: "Compose email" },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.id ? "border-stone-900 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-900"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Invoices tab */}
      {tab === "invoices" && (
        <Card padding="none">
          {selectedInvIds.size > 0 && (
            <div className="px-4 py-2.5 bg-stone-900 text-white flex items-center gap-3">
              <span className="text-sm font-medium">{selectedInvIds.size} selected</span>
              <div className="flex-1" />
              <Button size="sm" icon={Mail} onClick={startCompose}>Compose email with selected</Button>
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-200">
                <th className="w-10 px-4 py-2.5">
                  <input type="checkbox"
                    checked={open.length > 0 && open.every(i => selectedInvIds.has(i.id))}
                    onChange={() => {
                      if (open.every(i => selectedInvIds.has(i.id))) setSelectedInvIds(new Set());
                      else setSelectedInvIds(new Set(open.map(i => i.id)));
                    }}
                    className="rounded border-stone-300 cursor-pointer" />
                </th>
                <th className="text-left font-semibold px-4 py-2.5">Invoice</th>
                <th className="text-left font-semibold px-4 py-2.5">Due date</th>
                <th className="text-left font-semibold px-4 py-2.5">Status</th>
                <th className="text-left font-semibold px-4 py-2.5">Stage</th>
                <th className="text-right font-semibold px-4 py-2.5">Outstanding</th>
                <th className="w-10 px-2 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {projInvoices.map(inv => {
                const out = inv.total - (inv.paid || 0);
                const dueStatus = getDueStatus(inv);
                const isPaid = inv.paymentStatus === "Paid" || inv.collectionStage === "Closed";
                return (
                  <tr key={inv.id} className={`border-b border-stone-100 hover:bg-stone-50 ${selectedInvIds.has(inv.id) ? "bg-blue-50/50" : ""}`}>
                    <td className="px-4 py-3 w-10">
                      {!isPaid && (
                        <input type="checkbox" checked={selectedInvIds.has(inv.id)} onChange={() => toggleInv(inv.id)}
                          className="rounded border-stone-300 cursor-pointer" />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/invoices/${inv.id}`} className="font-mono text-[12px] text-blue-600 hover:underline">{inv.invoiceNumber}</Link>
                    </td>
                    <td className="px-4 py-3 text-stone-600 text-[12px]">
                      {fmt.shortDate(inv.dueDate)}
                      {daysOverdue(inv.dueDate) > 0 && !isPaid && (
                        <span className="ml-1.5 text-[11px] text-rose-600 font-medium">+{daysOverdue(inv.dueDate)}d</span>
                      )}
                    </td>
                    <td className="px-4 py-3"><Badge variant={dueStatusBadge(dueStatus)}>{dueStatus}</Badge></td>
                    <td className="px-4 py-3"><Badge variant={stageBadge(inv.collectionStage)}>{inv.collectionStage}</Badge></td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{fmt.money(out, customer.currency)}</td>
                    <td className="px-2 py-3 w-10">
                      {inv.qboId && !inv.qboId.startsWith("CM-") && (
                        <button onClick={(e) => handleDownloadPdf(e, inv)}
                          className="p-1.5 rounded hover:bg-stone-100 text-stone-400 hover:text-stone-700"
                          title="Download PDF">
                          {downloadingId === inv.id
                            ? <span className="animate-spin inline-block w-3.5 h-3.5 border border-stone-400 border-t-transparent rounded-full" />
                            : <Download size={14} />}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {projInvoices.length === 0 && (
            <div className="p-8 text-center text-sm text-stone-500">No invoices for this project</div>
          )}
        </Card>
      )}

      {/* Compose email tab */}
      {tab === "compose" && (
        <Card>
          <div className="space-y-3">
            {/* To field */}
            <div>
              <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">To</label>
              <input value={composeTo} onChange={e => setComposeTo(e.target.value)}
                placeholder="email@example.com, another@example.com"
                className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
              {custContacts.length > 0 && (
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <span className="text-[11px] text-stone-400">Quick add:</span>
                  {custContacts.map(c => (
                    <button key={c.id} onClick={() => {
                      const emails = composeTo.split(",").map(e => e.trim()).filter(Boolean);
                      if (!emails.includes(c.email)) setComposeTo([...emails, c.email].join(", "));
                    }} className="text-[11px] px-2 py-0.5 bg-stone-100 hover:bg-stone-200 rounded text-stone-700 transition-colors">
                      {c.name} &lt;{c.email}&gt;
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* CC field */}
            <div>
              <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">CC</label>
              <input value={composeCc} onChange={e => setComposeCc(e.target.value)}
                placeholder="Optional — cc@example.com"
                className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
            </div>

            {/* Subject */}
            <div>
              <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Subject</label>
              <input value={composeSubject} onChange={e => setComposeSubject(e.target.value)}
                className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
            </div>

            {/* Selected invoices as attachments */}
            {selectedInvIds.size > 0 && (
              <div className="bg-blue-50 ring-1 ring-blue-200 rounded-md p-3">
                <div className="text-[11px] font-semibold text-blue-700 uppercase tracking-wider mb-2">Invoice attachments ({selectedInvIds.size})</div>
                <div className="space-y-1">
                  {projInvoices.filter(i => selectedInvIds.has(i.id)).map(inv => (
                    <div key={inv.id} className="flex items-center justify-between text-[12px] text-blue-800">
                      <span className="font-mono">{inv.invoiceNumber}</span>
                      <span>{fmt.money(inv.total - (inv.paid || 0), customer.currency)}</span>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-blue-600 mt-2">PDF links will be included in the email body. Direct attachment coming soon.</div>
              </div>
            )}

            {/* Body */}
            <div>
              <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Message</label>
              <textarea value={composeBody} onChange={e => setComposeBody(e.target.value)}
                rows={12} className="w-full px-3 py-2 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none resize-none font-mono" />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button onClick={handleSend} disabled={sending || !composeTo}>
                {sending ? <span className="flex items-center gap-2"><Loader size={14} className="animate-spin" />Sending…</span> : <span className="flex items-center gap-2"><Mail size={14} />Send email</span>}
              </Button>
              <Button variant="secondary" onClick={() => setTab("invoices")}>Cancel</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
