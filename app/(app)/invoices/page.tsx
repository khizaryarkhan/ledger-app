"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { Card, Badge, Input, Select, Button, EmptyState, stageBadge, dueStatusBadge } from "@/components/ui";
import { InvoiceModal } from "@/components/forms";
import { BatchEmailModal } from "@/components/feature";
import { fmt, formatDate, daysOverdue, getDueStatus } from "@/lib/format";
import { Search, Upload, Plus, FileText, Trash2, X, Download, Send } from "lucide-react";

export default function InvoicesPage() {
  const { invoices, customers, projects, contacts, regions, bulkDeleteInvoices, orgSettings } = useData() as any;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [showBatchEmail, setShowBatchEmail] = useState(false);

  const df = orgSettings?.dateFormat || "DD MMM YYYY";

  /** Resolve best email: billingEmail → primary contact → customer email */
  function resolveEmail(inv: any): string | null {
    if (inv.billingEmail) return inv.billingEmail;
    const primaryContact = contacts?.find((c: any) => c.customerId === inv.customerId && c.isPrimary && c.email);
    if (primaryContact) return primaryContact.email;
    const customer = customers?.find((c: any) => c.id === inv.customerId);
    return customer?.email || null;
  }

  const handleDownloadPdf = async (e: React.MouseEvent, inv: any) => {
    e.preventDefault();
    e.stopPropagation();
    if (!inv.qboId || inv.qboId.startsWith("CM-")) return;
    setDownloadingId(inv.id);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`/api/invoices/${inv.id}/pdf`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Invoice-${inv.invoiceNumber}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      clearTimeout(timer);
      if (e?.name === "AbortError") alert("PDF download timed out — please try again.");
    } finally {
      setDownloadingId(null);
    }
  };

  const filtered = useMemo(() => {
    let res = invoices.map((i: any) => {
      const isPaidOrClosed = ["Paid", "Written Off"].includes(i.paymentStatus) || i.collectionStage === "Closed";
      return {
        ...i,
        customer: customers.find((c: any) => c.id === i.customerId),
        project: projects.find((p: any) => p.id === i.projectId),
        outstanding: isPaidOrClosed ? 0 : i.total - (i.paid || 0),
        daysOverdue: daysOverdue(i.dueDate),
        dueStatus: getDueStatus(i),
        resolvedEmail: resolveEmail(i),
      };
    });
    if (search) {
      const s = search.toLowerCase();
      res = res.filter((i: any) =>
        i.invoiceNumber.toLowerCase().includes(s) ||
        i.customer?.name.toLowerCase().includes(s) ||
        (i.poNumber || "").toLowerCase().includes(s) ||
        (i.resolvedEmail || "").toLowerCase().includes(s)
      );
    }
    if (statusFilter) res = res.filter((i: any) => i.dueStatus === statusFilter);
    if (stageFilter) {
      const STAGE_ALIASES: Record<string, string[]> = {
        "Scheduled": ["Scheduled", "Reminder Scheduled"],
        "Awaiting":  ["Awaiting", "Awaiting Reply"],
        "Promised":  ["Promised", "Promise to Pay"],
      };
      const aliases = STAGE_ALIASES[stageFilter] || [stageFilter];
      res = res.filter((i: any) => aliases.includes(i.collectionStage));
    }
    if (customerFilter) res = res.filter((i: any) => i.customerId === customerFilter);
    if (regionFilter) res = res.filter((i: any) => {
      const cust = customers.find((c: any) => c.id === i.customerId);
      if (cust?.regionId === regionFilter) return true;
      const proj = projects.find((p: any) => p.id === i.projectId);
      return proj?.regionId === regionFilter;
    });
    res.sort((a: any, b: any) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
    return res;
  }, [invoices, customers, projects, contacts, search, statusFilter, stageFilter, customerFilter, regionFilter]);

  const allSelected = filtered.length > 0 && filtered.every((i: any) => selected.has(i.id));
  const someSelected = selected.size > 0;

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map((i: any) => i.id)));
  };

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    setDeleting(true);
    try {
      await bulkDeleteInvoices(Array.from(selected));
      setSelected(new Set());
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Invoices</h1>
          <p className="text-sm text-stone-500 mt-1">{filtered.length} of {invoices.length} invoices</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/imports"><Button variant="secondary" icon={Upload}>Import CSV</Button></Link>
          <Button icon={Plus} onClick={() => setShowCreate(true)}>New invoice</Button>
        </div>
      </div>

      {/* Bulk action bar */}
      {someSelected && (
        <div className="mb-3 flex items-center gap-3 px-4 py-2.5 bg-stone-900 text-white rounded-lg flex-wrap">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="flex-1" />
          <button onClick={() => setSelected(new Set())} className="text-stone-400 hover:text-white p-1 rounded">
            <X size={14} />
          </button>
          <Button variant="secondary" size="sm" icon={Send} onClick={() => setShowBatchEmail(true)}>
            Send email
          </Button>
          {!confirmDelete ? (
            <Button variant="danger" size="sm" icon={Trash2} onClick={() => setConfirmDelete(true)}>
              Delete {selected.size} invoice{selected.size > 1 ? "s" : ""}
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-amber-300">Are you sure? This cannot be undone.</span>
              <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={handleBulkDelete} disabled={deleting}>
                {deleting ? "Deleting…" : "Yes, delete"}
              </Button>
            </div>
          )}
        </div>
      )}

      <Card padding="none">
        <div className="p-3 border-b border-stone-200 flex items-center gap-2 flex-wrap">
          <Input value={search} onChange={(e: any) => setSearch(e.target.value)} placeholder="Search invoice #, customer, email, PO..." icon={Search} className="w-72" />
          <Select value={statusFilter} onChange={(e: any) => setStatusFilter(e.target.value)} placeholder="All statuses" options={["Not Due", "Due Soon", "Due Today", "Overdue", "Paid", "Written Off"]} />
          <Select value={stageFilter} onChange={(e: any) => setStageFilter(e.target.value)} placeholder="All stages" options={["New", "Scheduled", "Reminder Sent", "Second Notice", "Final Notice", "Awaiting", "Promised", "Disputed", "Escalated", "On Hold", "Closed"]} />
          <Select value={customerFilter} onChange={(e: any) => setCustomerFilter(e.target.value)} placeholder="All customers" options={customers.map((c: any) => ({ value: c.id, label: c.name }))} />
          <select value={regionFilter} onChange={(e: any) => setRegionFilter(e.target.value)}
            className="h-9 px-3 pr-8 text-sm rounded-md ring-1 ring-stone-200 bg-white appearance-none"
            style={{backgroundImage:`url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,backgroundRepeat:"no-repeat",backgroundPosition:"right 0.5rem center",backgroundSize:"12px"}}>
            <option value="">All regions</option>
            {(regions ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          {(search || statusFilter || stageFilter || customerFilter || regionFilter) && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setStatusFilter(""); setStageFilter(""); setCustomerFilter(""); setRegionFilter(""); }}>Clear</Button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-200 bg-stone-50/50">
                <th className="px-3 py-2.5 w-10">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-stone-300 cursor-pointer" />
                </th>
                <th className="text-left font-semibold px-3 py-2.5">Invoice</th>
                <th className="text-left font-semibold px-3 py-2.5">Customer</th>
                <th className="text-left font-semibold px-3 py-2.5">Project</th>
                <th className="text-left font-semibold px-3 py-2.5">Inv. Date</th>
                <th className="text-left font-semibold px-3 py-2.5">Due Date</th>
                <th className="text-left font-semibold px-3 py-2.5">Status</th>
                <th className="text-left font-semibold px-3 py-2.5">Stage</th>
                <th className="text-left font-semibold px-3 py-2.5">Billing Email</th>
                <th className="text-right font-semibold px-3 py-2.5">Value</th>
                <th className="text-right font-semibold px-3 py-2.5">Outstanding</th>
                <th className="w-10 px-2 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv: any) => (
                <tr key={inv.id} className={`border-b border-stone-100 hover:bg-stone-50 ${selected.has(inv.id) ? "bg-blue-50/50" : ""}`}>
                  <td className="px-3 py-2.5 w-10">
                    <input type="checkbox" checked={selected.has(inv.id)} onChange={() => toggleOne(inv.id)}
                      className="rounded border-stone-300 cursor-pointer" onClick={(e) => e.stopPropagation()} />
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[12px]">
                    <Link href={`/invoices/${inv.id}`} className="block w-full">{inv.invoiceNumber}</Link>
                  </td>
                  <td className="px-3 py-2.5 font-medium text-stone-900">
                    <Link href={`/invoices/${inv.id}`} className="block w-full truncate max-w-[160px]">{inv.customer?.name}</Link>
                  </td>
                  <td className="px-3 py-2.5 text-stone-500 text-[12px]">
                    <Link href={`/invoices/${inv.id}`} className="block w-full truncate max-w-[140px]">{inv.project?.name || "—"}</Link>
                  </td>
                  <td className="px-3 py-2.5 text-stone-600 text-[12px] whitespace-nowrap">
                    <Link href={`/invoices/${inv.id}`} className="block w-full">{formatDate(inv.invoiceDate, df)}</Link>
                  </td>
                  <td className="px-3 py-2.5 text-stone-700 whitespace-nowrap">
                    <Link href={`/invoices/${inv.id}`} className="block w-full">
                      {formatDate(inv.dueDate, df)}
                      {inv.daysOverdue > 0 && <span className="ml-1 text-[11px] text-rose-600 font-medium">+{inv.daysOverdue}d</span>}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/invoices/${inv.id}`}><Badge variant={dueStatusBadge(inv.dueStatus)}>{inv.dueStatus}</Badge></Link>
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/invoices/${inv.id}`}><Badge variant={stageBadge(inv.collectionStage)}>{inv.collectionStage}</Badge></Link>
                  </td>
                  <td className="px-3 py-2.5 text-[12px] max-w-[200px]">
                    <Link href={`/invoices/${inv.id}`} className="block w-full" title={inv.resolvedEmail || ""}>
                      {inv.resolvedEmail ? (() => {
                        const addrs = inv.resolvedEmail.split(",").map((e: string) => e.trim()).filter(Boolean);
                        return (
                          <span className="text-stone-600 truncate block">
                            {addrs[0]}
                            {addrs.length > 1 && (
                              <span className="ml-1 text-[10px] text-blue-500 font-medium">+{addrs.length - 1}</span>
                            )}
                          </span>
                        );
                      })() : <span className="text-stone-300 italic">No email</span>}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-right text-stone-500 tabular-nums text-[13px]">
                    <Link href={`/invoices/${inv.id}`} className="block w-full">{fmt.money(inv.total, inv.currency)}</Link>
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-stone-900 tabular-nums">
                    <Link href={`/invoices/${inv.id}`} className="block w-full">{fmt.money(inv.outstanding, inv.currency)}</Link>
                  </td>
                  <td className="px-2 py-2.5 w-10">
                    {inv.qboId && !inv.qboId.startsWith("CM-") && (
                      <button onClick={(e) => handleDownloadPdf(e, inv)}
                        className="p-1.5 rounded hover:bg-stone-100 text-stone-400 hover:text-stone-700 transition-colors"
                        title="Download PDF">
                        {downloadingId === inv.id
                          ? <span className="animate-spin inline-block w-3.5 h-3.5 border border-stone-400 border-t-transparent rounded-full" />
                          : <Download size={14} />}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <EmptyState icon={FileText} title="No invoices found"
              description={invoices.length === 0 ? "Create your first invoice or import from CSV." : "Try adjusting your filters."}
              action={invoices.length === 0 ? <Button icon={Plus} onClick={() => setShowCreate(true)}>New invoice</Button> : undefined} />
          )}
        </div>
      </Card>

      {showCreate && <InvoiceModal onClose={() => setShowCreate(false)} />}
      {showBatchEmail && (
        <BatchEmailModal
          invoiceIds={Array.from(selected)}
          onClose={() => setShowBatchEmail(false)}
        />
      )}
    </div>
  );
}
