"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { Card, Badge, Button, EmptyState, stageBadge, dueStatusBadge } from "@/components/ui";
import { EmailComposer, AddContactModal, AuditTimeline } from "@/components/feature";
import { fmt, daysOverdue, getDueStatus } from "@/lib/format";
import { ArrowLeft, FileText, Mail, Download, ArrowUpRight, FileEdit, Link2, MessageSquare, Users, Plus, Phone } from "lucide-react";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { projects, customers, invoices, contacts, communications, regions } = useData() as any;
  const [tab, setTab] = useState<"invoices" | "timeline" | "audit" | "contacts">("invoices");
  const [showCompose, setShowCompose] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const project = projects.find((p: any) => p.id === id);
  const customer = project ? customers.find((c: any) => c.id === project.customerId) : null;

  if (!project || !customer) {
    return (
      <div className="p-6">
        <EmptyState icon={FileText} title="Project not found"
          action={<Button onClick={() => router.push("/projects")}>Back to projects</Button>} />
      </div>
    );
  }

  const projInvoices = useMemo(() =>
    invoices.filter((i: any) => i.projectId === id)
      .sort((a: any, b: any) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime()),
    [invoices, id]
  );

  const projInvoiceIds = useMemo(() => new Set(projInvoices.map((i: any) => i.id)), [projInvoices]);

  // Communications: anything with this projectId OR linked to one of this project's invoices
  const projComms = useMemo(() =>
    (communications as any[])
      .filter(c => c.projectId === id || (c.invoiceId && projInvoiceIds.has(c.invoiceId)))
      .sort((a: any, b: any) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()),
    [communications, id, projInvoiceIds]
  );

  // Project-specific contacts + customer-level contacts as fallback
  const projectContacts = useMemo(() =>
    contacts.filter((c: any) => c.projectId === id),
    [contacts, id]
  );
  const customerContacts = useMemo(() =>
    contacts.filter((c: any) => c.customerId === customer.id && !c.projectId),
    [contacts, customer.id]
  );

  const open = projInvoices.filter((i: any) => i.paymentStatus !== "Paid" && i.collectionStage !== "Closed" && i.txnType !== "CreditMemo");
  const outstanding = open.reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
  const overdue = open.filter((i: any) => daysOverdue(i.dueDate) > 0).reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
  const region = (regions ?? []).find((r: any) => r.id === project?.regionId)?.name || null;
  // Same rule as projects list — computed from AR, not DB status field
  const effectiveStatus = project.status === "On Hold" ? "On Hold" : outstanding > 0 ? "Active" : "Inactive";

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

  const totalContacts = projectContacts.length + customerContacts.length;

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <Link href={`/customers/${customer.id}`} className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-900 mb-4">
        <ArrowLeft size={14} /> Back to {customer.name}
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">{project.name}</h1>
            <Badge variant={effectiveStatus === "Active" ? "green" : effectiveStatus === "On Hold" ? "orange" : "neutral"}>
              {effectiveStatus}
            </Badge>
            {outstanding > 0 && (
              <span className="text-sm font-semibold tabular-nums text-stone-700">
                {fmt.money(outstanding, customer.currency)} outstanding
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-stone-500">
            <span className="font-mono text-xs">{project.code}</span>
            <span>·</span>
            <Link href={`/customers/${customer.id}`} className="hover:text-stone-900">{customer.name}</Link>
            {region && <><span>·</span><span>{region}</span></>}
          </div>
        </div>
        <Button icon={Mail} onClick={() => setShowCompose(true)}>Send email</Button>
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
          { id: "timeline", label: `Communications (${projComms.length})` },
          { id: "audit", label: "Audit Trail" },
          { id: "contacts", label: `Contacts (${totalContacts})` },
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
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-200">
                <th className="text-left font-semibold px-4 py-2.5">Invoice</th>
                <th className="text-left font-semibold px-4 py-2.5">Due date</th>
                <th className="text-left font-semibold px-4 py-2.5">Status</th>
                <th className="text-left font-semibold px-4 py-2.5">Stage</th>
                <th className="text-right font-semibold px-4 py-2.5">Outstanding</th>
                <th className="w-10 px-2 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {projInvoices.map((inv: any) => {
                const out = inv.total - (inv.paid || 0);
                const dueStatus = getDueStatus(inv);
                const isPaid = inv.paymentStatus === "Paid" || inv.collectionStage === "Closed";
                return (
                  <tr key={inv.id} className="border-b border-stone-100 hover:bg-stone-50">
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

      {/* Timeline tab */}
      {tab === "timeline" && (
        projComms.length === 0 ? (
          <Card>
            <EmptyState icon={MessageSquare} title="No activity yet"
              description="Emails sent for this project will appear here with their reference numbers."
              action={<Button icon={Mail} onClick={() => setShowCompose(true)}>Send first email</Button>} />
          </Card>
        ) : (
          <div className="space-y-2">
            {projComms.map((c: any) => {
              const isNote = c.channel === "Note";
              const inv = c.invoiceId ? projInvoices.find((i: any) => i.id === c.invoiceId) : null;
              return (
                <div key={c.id} className="bg-white ring-1 ring-stone-200 rounded-lg px-4 py-3.5 flex items-start gap-3">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${isNote ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"}`}>
                    {isNote ? <FileEdit size={13} /> : <ArrowUpRight size={13} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    {!isNote && c.refNumber && (
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="font-mono text-[11px] font-semibold bg-stone-900 text-white px-2 py-0.5 rounded">
                          {c.refNumber}
                        </span>
                        {c.stageAtSend && (
                          <span className="text-[11px] text-stone-400">
                            stage: <span className="font-medium text-stone-600">{c.stageAtSend}</span>
                          </span>
                        )}
                      </div>
                    )}
                    <div className="text-sm font-medium text-stone-900 truncate">
                      {isNote ? "Internal note" : (c.subject || "Email")}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {!isNote && c.recipients && (
                        <span className="text-[11px] text-stone-500">To: {c.recipients}</span>
                      )}
                      {inv && (
                        <span className="flex items-center gap-1 text-[11px] text-stone-500">
                          <Link2 size={10} />
                          <Link href={`/invoices/${inv.id}`} className="font-mono text-blue-600 hover:underline">{inv.invoiceNumber}</Link>
                        </span>
                      )}
                      {isNote && c.body && <span className="text-[12px] text-stone-600">{c.body}</span>}
                    </div>
                  </div>
                  <div className="text-[11px] text-stone-400 whitespace-nowrap flex-shrink-0 mt-0.5">
                    {fmt.relative(c.sentAt)}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Audit Trail tab */}
      {tab === "audit" && (
        <AuditTimeline
          customerId={project.customerId}
          projectId={id}
          label={`${project.name} (${customer.name})`}
        />
      )}

      {/* Contacts tab */}
      {tab === "contacts" && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-stone-500">Project-specific contacts appear first; customer contacts shown as fallback.</p>
            <Button size="sm" icon={Plus} onClick={() => setShowAddContact(true)}>Add project contact</Button>
          </div>

          {totalContacts === 0 ? (
            <Card><EmptyState icon={Users} title="No contacts yet" description="Add contacts specific to this project."
              action={<Button size="sm" icon={Plus} onClick={() => setShowAddContact(true)}>Add contact</Button>} /></Card>
          ) : (
            <div className="space-y-4">
              {projectContacts.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-violet-500 inline-block" />
                    Project contacts
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {projectContacts.map((c: any) => <ContactCard key={c.id} c={c} />)}
                  </div>
                </div>
              )}
              {customerContacts.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
                    Customer contacts
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {customerContacts.map((c: any) => <ContactCard key={c.id} c={c} />)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showCompose && (
        <EmailComposer
          context={{ customerId: customer.id, projectId: id }}
          onClose={() => setShowCompose(false)}
        />
      )}
      {showAddContact && (
        <AddContactModal
          customerId={customer.id}
          projectId={id}
          onClose={() => setShowAddContact(false)}
        />
      )}
    </div>
  );
}

function ContactCard({ c }: { c: any }) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-stone-100 flex items-center justify-center text-stone-600 text-xs font-semibold flex-shrink-0">
          {c.name.split(" ").slice(0, 2).map((w: string) => w[0]).join("")}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-sm font-semibold text-stone-900 truncate">{c.name}</div>
            {c.isPrimary && <Badge variant="blue" size="sm">Primary</Badge>}
            {c.isEscalation && <Badge variant="red" size="sm">Escalation</Badge>}
          </div>
          {c.title && <div className="text-[11px] text-stone-500 truncate">{c.title}</div>}
          <div className="flex items-center gap-1 text-xs text-stone-600 mt-1.5">
            <Mail size={11} /> <a href={`mailto:${c.email}`} className="hover:underline truncate">{c.email}</a>
          </div>
          {c.phone && <div className="flex items-center gap-1 text-xs text-stone-600 mt-1"><Phone size={11} /> {c.phone}</div>}
        </div>
      </div>
    </Card>
  );
}
