"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { Card, Badge, Button, EmptyState, stageBadge, dueStatusBadge } from "@/components/ui";
import { CustomerModal, ProjectModal, AddContactModal } from "@/components/forms";
import { fmt, daysOverdue, getDueStatus, getAgingBucket } from "@/lib/format";
import { ArrowLeft, Mail, Phone, Plus, Users, FileText, Briefcase } from "lucide-react";

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { customers, invoices, projects, contacts, communications, tasks, addNote } = useData();
  const [tab, setTab] = useState<"overview" | "invoices" | "projects" | "contacts" | "timeline" | "tasks">("overview");
  const [showAddContact, setShowAddContact] = useState(false);
  const [showEditCustomer, setShowEditCustomer] = useState(false);
  const [showAddProject, setShowAddProject] = useState(false);

  const customer = customers.find(c => c.id === id);
  if (!customer) {
    return (
      <div className="p-6">
        <EmptyState icon={Users} title="Customer not found" description="It may have been deleted."
          action={<Button onClick={() => router.push("/customers")}>Back to customers</Button>} />
      </div>
    );
  }

  const custInvoices = useMemo(() => invoices.filter(i => i.customerId === id), [invoices, id]);
  const custProjects = projects.filter(p => p.customerId === id);
  const custContacts = contacts.filter(c => c.customerId === id);
  const custComms = useMemo(() => communications.filter(c => c.customerId === id), [communications, id]);
  const custTasks = tasks.filter(t => t.customerId === id);

  const open = custInvoices.filter(i => i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off");
  const outstanding = open.reduce((s, i) => s + (i.total - (i.paid || 0)), 0);
  const overdue = open.filter(i => daysOverdue(i.dueDate) > 0).reduce((s, i) => s + (i.total - (i.paid || 0)), 0);
  const buckets: Record<string, number> = { "Current": 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  open.forEach(i => { buckets[getAgingBucket(i)] += i.total - (i.paid || 0); });

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <Link href="/customers" className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-900 mb-4">
        <ArrowLeft size={14} /> Back to customers
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-stone-100 to-stone-200 flex items-center justify-center text-stone-700 text-lg font-semibold flex-shrink-0">
            {customer.name.split(" ").slice(0, 2).map(w => w[0]).join("")}
          </div>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">{customer.name}</h1>
              {customer.riskRating === "High" && <Badge variant="red">High risk</Badge>}
              {customer.riskRating === "Medium" && <Badge variant="yellow">Medium risk</Badge>}
              {customer.status !== "Active" && <Badge variant="orange">{customer.status}</Badge>}
            </div>
            <div className="flex items-center gap-2 text-sm text-stone-600">
              <span className="font-mono text-xs">{customer.code}</span>
              <span className="text-stone-300">·</span>
              <span>{customer.country || "—"}</span>
              <span className="text-stone-300">·</span>
              <span>{customer.currency}</span>
              <span className="text-stone-300">·</span>
              <span>{customer.paymentTerms} day terms</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-6">
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
          <div className="text-xl font-semibold text-stone-900 tabular-nums">{open.length}</div>
        </Card>
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Credit limit</div>
          <div className="text-xl font-semibold text-stone-900 tabular-nums">{fmt.money(customer.creditLimit, customer.currency)}</div>
        </Card>
      </div>

      <div className="border-b border-stone-200 mb-5">
        <div className="flex items-center gap-1">
          {[
            { id: "overview", label: "Overview" },
            { id: "invoices", label: `Invoices (${custInvoices.length})` },
            { id: "projects", label: `Projects (${custProjects.length})` },
            { id: "contacts", label: `Contacts (${custContacts.length})` },
            { id: "timeline", label: "Timeline" },
            { id: "tasks", label: `Tasks (${custTasks.length})` },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t.id ? "border-stone-900 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-900"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "overview" && (
        <div className="grid grid-cols-3 gap-3">
          <Card className="col-span-2">
            <h3 className="text-sm font-semibold text-stone-900 mb-4">Aging breakdown</h3>
            <div className="space-y-2.5">
              {["Current", "1-30", "31-60", "61-90", "90+"].map((b, i) => {
                const colors = ["bg-emerald-500", "bg-amber-400", "bg-orange-500", "bg-rose-500", "bg-rose-700"];
                const labels = ["Current", "1-30 days overdue", "31-60 days overdue", "61-90 days overdue", "90+ days overdue"];
                const max = Math.max(...Object.values(buckets), 1);
                return (
                  <div key={b} className="flex items-center gap-3">
                    <div className="w-44 text-xs text-stone-600 font-medium">{labels[i]}</div>
                    <div className="flex-1 h-6 bg-stone-100 rounded relative overflow-hidden">
                      <div className={`h-full ${colors[i]}`} style={{ width: `${(buckets[b] / max) * 100}%` }} />
                    </div>
                    <div className="w-28 text-right text-sm font-semibold text-stone-900 tabular-nums">{fmt.money(buckets[b], customer.currency)}</div>
                  </div>
                );
              })}
            </div>
          </Card>
          <Card>
            <h3 className="text-sm font-semibold text-stone-900 mb-3">Customer info</h3>
            <dl className="space-y-2.5 text-sm">
              <div><dt className="text-xs text-stone-500">Tax number</dt><dd className="font-mono text-xs">{customer.taxNumber || "—"}</dd></div>
              <div><dt className="text-xs text-stone-500">Status</dt><dd>{customer.status}</dd></div>
              <div><dt className="text-xs text-stone-500">Risk rating</dt><dd>{customer.riskRating}</dd></div>
              {customer.notes && <div><dt className="text-xs text-stone-500">Notes</dt><dd className="text-stone-700 mt-1">{customer.notes}</dd></div>}
            </dl>
          </Card>
        </div>
      )}

      {tab === "invoices" && (
        custInvoices.length === 0 ? <Card><EmptyState icon={FileText} title="No invoices" description="No invoices for this customer yet." /></Card> : (
          <Card padding="none">
            <table className="w-full text-sm">
              <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-200">
                <th className="text-left font-semibold px-4 py-2.5">Invoice</th>
                <th className="text-left font-semibold px-4 py-2.5">Due</th>
                <th className="text-left font-semibold px-4 py-2.5">Status</th>
                <th className="text-left font-semibold px-4 py-2.5">Stage</th>
                <th className="text-right font-semibold px-4 py-2.5">Outstanding</th>
              </tr></thead>
              <tbody>
                {custInvoices.map(inv => {
                  const out = inv.total - (inv.paid || 0);
                  return (
                    <tr key={inv.id} className="border-b border-stone-100 hover:bg-stone-50">
                      <td className="px-4 py-3"><Link href={`/invoices/${inv.id}`} className="font-mono text-[12px] block">{inv.invoiceNumber}</Link></td>
                      <td className="px-4 py-3"><Link href={`/invoices/${inv.id}`} className="block">{fmt.shortDate(inv.dueDate)}</Link></td>
                      <td className="px-4 py-3"><Link href={`/invoices/${inv.id}`}><Badge variant={dueStatusBadge(getDueStatus(inv))}>{getDueStatus(inv)}</Badge></Link></td>
                      <td className="px-4 py-3"><Link href={`/invoices/${inv.id}`}><Badge variant={stageBadge(inv.collectionStage)}>{inv.collectionStage}</Badge></Link></td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums"><Link href={`/invoices/${inv.id}`} className="block">{fmt.money(out, inv.currency)}</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )
      )}

      {tab === "projects" && (
        custProjects.length === 0 ? <Card><EmptyState icon={Briefcase} title="No projects" description="No projects for this customer yet." /></Card> : (
          <div className="grid grid-cols-2 gap-3">
            {custProjects.map(p => {
              const projInvoices = invoices.filter((i: any) => i.projectId === p.id);
              const projOpen = projInvoices.filter((i: any) => i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off");
              const projOut = projOpen.reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
              const projOverdue = projOpen.filter((i: any) => daysOverdue(i.dueDate) > 0).reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
              return (
                <Link key={p.id} href={`/projects/${p.id}`} className="block group">
                  <Card className="group-hover:ring-stone-300 transition-colors cursor-pointer">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-stone-900 group-hover:text-blue-700 transition-colors truncate">{p.name}</div>
                        <div className="text-[11px] text-stone-500 font-mono mt-0.5">{p.code}</div>
                      </div>
                      <Badge variant={p.status === "Active" ? "blue" : "neutral"} size="sm">{p.status}</Badge>
                    </div>
                    <div className="flex items-center justify-between pt-3 border-t border-stone-100 mt-3">
                      <span className="text-xs text-stone-500">{projInvoices.length} invoice{projInvoices.length !== 1 ? "s" : ""}</span>
                      <div className="text-right">
                        <div className="text-sm font-semibold tabular-nums">{fmt.money(projOut, customer.currency)}</div>
                        {projOverdue > 0 && <div className="text-[11px] text-rose-600 font-medium tabular-nums">{fmt.money(projOverdue, customer.currency)} overdue</div>}
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )
      )}

      {tab === "contacts" && (
        <div>
          <div className="flex items-center justify-end mb-3">
            <Button size="sm" icon={Plus} onClick={() => setShowAddContact(true)}>Add contact</Button>
          </div>
          {custContacts.length === 0 ? <Card><EmptyState icon={Users} title="No contacts" description="Add billing contacts to start communicating." /></Card> : (
            <div className="grid grid-cols-2 gap-3">
              {custContacts.map(c => (
                <Card key={c.id}>
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center text-stone-600 text-xs font-semibold flex-shrink-0">
                      {c.name.split(" ").slice(0, 2).map((w: string) => w[0]).join("")}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-stone-900 truncate">{c.name}</div>
                        {c.isPrimary && <Badge variant="blue" size="sm">Primary</Badge>}
                        {c.isEscalation && <Badge variant="red" size="sm">Escalation</Badge>}
                      </div>
                      {c.title && <div className="text-[11px] text-stone-500 truncate">{c.title}</div>}
                      <div className="flex items-center gap-1 text-xs text-stone-600 mt-1.5">
                        <Mail size={11} /> <a href={`mailto:${c.email}`} className="hover:underline">{c.email}</a>
                      </div>
                      {c.phone && <div className="flex items-center gap-1 text-xs text-stone-600 mt-1"><Phone size={11} /> {c.phone}</div>}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "timeline" && (
        <Timeline communications={custComms} onAddNote={(body: string) => addNote({ customerId: id, invoiceId: null, body })} />
      )}

      {tab === "tasks" && (
        <TasksList tasks={custTasks} />
      )}

      {showAddContact && <AddContactModal customerId={id} onClose={() => setShowAddContact(false)} />}
      {showEditCustomer && <CustomerModal customer={customer} onClose={() => setShowEditCustomer(false)} />}
      {showAddProject && <ProjectModal preCustomerId={id} onClose={() => setShowAddProject(false)} />}
    </div>
  );
}
