"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { Badge, Button, dueStatusBadge } from "@/components/ui";
import { InvoiceModal } from "@/components/forms";
import { SendInvoicesModal } from "@/components/send-invoices-modal";
import { fmt, formatDate, daysOverdue, getDueStatus, matchesDueFilter, DUE_FILTERS, sourceLabel, sourceBadgeVariant, localToday } from "@/lib/format";
import { Search, Plus, Trash2, X, Download, Send } from "lucide-react";
import { DEFAULT_STAGES, resolveStageLabel, type Stage } from "@/lib/stages";
import { SelectField, control } from "@/components/form-kit";
import { StageLabel } from "@/components/stage-label";
import {
  useListView, ListPage, ListPageHeader, ListDivider, ListToolbar, ListChips, ListScroll, ListHead, ListFoot,
  sumByCurrency, listTable, listRow, listCheckCell, listCheckbox, listMoneyCell, listNumCell, type ListColumn,
} from "@/components/list-view";

// ── Date period helpers ────────────────────────────────────────────────────────
type PeriodId = "this-month" | "last-month" | "last-3m" | "last-6m" | "all" | "custom";

const PERIODS: { id: PeriodId; label: string }[] = [
  { id: "this-month",  label: "This Month"  },
  { id: "last-month",  label: "Last Month"  },
  { id: "last-3m",     label: "Last 3M"     },
  { id: "last-6m",     label: "Last 6M"     },
  { id: "all",         label: "All Time"    },
  { id: "custom",      label: "Custom"      },
];

function getPeriodRange(id: PeriodId): { from: Date; to: Date } {
  const now = new Date();
  if (id === "this-month")
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 0) };
  if (id === "last-month")
    return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 0) };
  if (id === "last-3m")
    return { from: new Date(now.getFullYear(), now.getMonth() - 3, 1), to: now };
  if (id === "last-6m")
    return { from: new Date(now.getFullYear(), now.getMonth() - 6, 1), to: now };
  // "all" and "custom" handled at call site
  return { from: new Date(2000, 0, 1), to: now };
}

export default function InvoicesPage() {
  const { invoices, customers, projects, contacts, regions, reps, bulkDeleteInvoices, orgSettings, refresh, toast } = useData() as any;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [responseFilter, setResponseFilter] = useState("");
  // Customer / region / stage used to be header selects too; they are column
  // filters now (funnel on each header), so the header keeps only the filters
  // a column can't express.
  const [showCreate, setShowCreate] = useState(false);

  // Date period filter — defaults to last month
  // Local dates, never toISOString(): that is UTC and shifts the day either
  // side of Greenwich (CLAUDE.md, "A date is a date").
  const todayStr = localToday();
  const lastMonthStart = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; })();
  const [period, setPeriod] = useState<PeriodId>("last-month");
  const [customFrom, setCustomFrom] = useState(lastMonthStart);
  const [customTo, setCustomTo]   = useState(todayStr);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [showBatchEmail, setShowBatchEmail] = useState(false);
  const [bulkStageChanging, setBulkStageChanging] = useState(false);

  const df = orgSettings?.dateFormat || "DD MMM YYYY";
  const stages: Stage[] = orgSettings?.stages?.length ? orgSettings.stages : DEFAULT_STAGES;
  const today = todayStr;

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
    if (!((inv.qboId && !inv.qboId.startsWith("CM-")) || (inv.xeroId && !inv.xeroId.startsWith("CN-")))) return;
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

  // Resolve active date range
  const { from: periodFrom, to: periodTo } = useMemo(() => {
    if (period === "custom") {
      return {
        from: new Date(customFrom + "T00:00:00"),
        to:   new Date(customTo   + "T23:59:59"),
      };
    }
    if (period === "all") return { from: new Date(2000, 0, 1), to: new Date(9999, 11, 31) };
    return getPeriodRange(period);
  }, [period, customFrom, customTo]);

  const handleExportExcel = () => {
    import("xlsx").then((XLSX) => {
      const rows = lv.rows.map((inv: any) => ({
        "Invoice #":      inv.invoiceNumber,
        "Customer":       inv.customer?.name ?? "",
        "Project":        inv.project?.name ?? "",
        "Rep":            inv.rep?.name ?? "",
        "Region":         inv.region?.name ?? "",
        "Invoice Date":   inv.invoiceDate ?? "",
        "Due Date":       inv.dueDate ?? "",
        "Status":         inv.dueStatus ?? "",
        "Stage":          inv.stageLabel ?? "",
        "Billing Email":  inv.resolvedEmail ?? "",
        "Currency":       inv.currency ?? "",
        "Value":          inv.total ?? 0,
        "Paid":           inv.paid ?? 0,
        "Outstanding":    inv.outstanding ?? 0,
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      // Column widths
      ws["!cols"] = [14,28,22,18,16,14,14,14,18,32,8,12,12,12].map(w => ({ wch: w }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Invoices");
      const period_label = PERIODS.find(p => p.id === period)?.label ?? "Custom";
      XLSX.writeFile(wb, `Invoices_${period_label.replace(/\s+/g, "_")}_${localToday()}.xlsx`);
    });
  };

  const filtered = useMemo(() => {
    let res = invoices.map((i: any) => {
      const isPaidOrClosed = ["Paid", "Written Off"].includes(i.paymentStatus) || i.collectionStage === "Closed";
      const customer = customers.find((c: any) => c.id === i.customerId);
      const project  = projects.find((p: any) => p.id === i.projectId);
      const repId    = customer?.repId ?? project?.repId;
      const regionId = customer?.regionId ?? project?.regionId;
      return {
        ...i,
        customer,
        project,
        rep:    reps?.find((r: any) => r.id === repId) ?? null,
        region: regions?.find((r: any) => r.id === regionId) ?? null,
        isClosed: isPaidOrClosed,
        stageLabel: resolveStageLabel(i.collectionStage, stages),
        outstanding: isPaidOrClosed ? 0 : i.total - (i.paid || 0),
        daysOverdue: daysOverdue(i.dueDate),
        dueStatus: getDueStatus(i),
        resolvedEmail: resolveEmail(i),
      };
    });

    // Date filter on invoice date
    // Use T00:00:00 to force local-time parsing — bare "YYYY-MM-DD" is interpreted
    // as UTC midnight, which causes off-by-one errors for users outside UTC.
    res = res.filter((i: any) => {
      if (!i.invoiceDate) return true;
      const d = new Date(i.invoiceDate + "T00:00:00");
      return d >= periodFrom && d <= periodTo;
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
    // matchesDueFilter, not an equality check on dueStatus: the calendar
    // windows ("Due This Week"/"Due This Month") overlap the single buckets.
    if (statusFilter) res = res.filter((i: any) => matchesDueFilter(i, statusFilter));
    // Customer Response Portal filters (uses cached invoice fields)
    if (responseFilter === "dispute") res = res.filter((i: any) => i.hasOpenDispute);
    if (responseFilter === "promise") res = res.filter((i: any) => !!i.promiseDate);
    return res;
  }, [invoices, customers, projects, contacts, reps, regions, stages, search, statusFilter, responseFilter, periodFrom, periodTo]);

  // Column definitions — sort + funnel filter per column, board-style.
  const INV_COLS = useMemo<ListColumn<any>[]>(() => [
    { key: "invoice",     label: "Invoice",   sort: r => r.invoiceNumber, filter: { kind: "text", value: r => r.invoiceNumber } },
    { key: "customer",    label: "Customer",  sort: r => r.customer?.name, filter: { kind: "text", value: r => r.customer?.name } },
    { key: "project",     label: "Project",   sort: r => r.project?.name, filter: { kind: "text", value: r => r.project?.name } },
    { key: "rep",         label: "Rep",       sort: r => r.rep?.name, filter: { kind: "multi", value: r => r.rep?.name } },
    { key: "region",      label: "Region",    sort: r => r.region?.name, filter: { kind: "multi", value: r => r.region?.name } },
    { key: "invoiceDate", label: "Inv. date", sort: r => r.invoiceDate },
    { key: "dueDate",     label: "Due",       sort: r => r.dueDate },
    { key: "dueStatus",   label: "Status",    sort: r => r.dueStatus, filter: { kind: "multi", value: r => r.dueStatus } },
    { key: "stage",       label: "Stage",     sort: r => r.stageLabel, filter: { kind: "multi", value: r => r.stageLabel } },
    { key: "email",       label: "Billing email", sort: r => r.resolvedEmail, filter: { kind: "text", value: r => r.resolvedEmail } },
    { key: "total",       label: "Value",     sort: r => Number(r.total ?? 0), descFirst: true, align: "right",
      filter: { kind: "range", value: r => Number(r.total ?? 0) }, money: r => ({ amount: Number(r.total ?? 0), currency: r.currency }) },
    { key: "outstanding", label: "Outstanding", sort: r => r.outstanding, descFirst: true, align: "right",
      filter: { kind: "range", value: r => r.outstanding }, money: r => ({ amount: r.outstanding, currency: r.currency }) },
  ], []);
  const lv = useListView(filtered, INV_COLS, { storageKey: "invoices", defaultSort: "dueDate", defaultDir: "asc", summary: "outstanding" });

  // Batch actions must never silently operate on invoices the user can no
  // longer see — prune the selection when filters hide rows (board rule).
  useEffect(() => {
    const visible = new Set(lv.rows.map((r: any) => r.id));
    setSelected(prev => [...prev].some(id => !visible.has(id)) ? new Set([...prev].filter(id => visible.has(id))) : prev);
  }, [lv.rows]);

  const allSelected = lv.rows.length > 0 && lv.rows.every((i: any) => selected.has(i.id));
  const someSelected = selected.size > 0;
  const selectedTotals = useMemo(
    () => sumByCurrency(lv.rows.filter((r: any) => selected.has(r.id)), (r: any) => ({ amount: r.outstanding, currency: r.currency })),
    [lv.rows, selected],
  );

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(lv.rows.map((i: any) => i.id)));
  };

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkStageChange = async (stage: string) => {
    if (!stage) return;
    setBulkStageChanging(true);
    try {
      await Promise.all(
        Array.from(selected).map((id) =>
          fetch(`/api/invoices/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ collectionStage: stage }),
          })
        )
      );
      await refresh();
      toast?.(`Stage updated for ${selected.size} invoice${selected.size > 1 ? "s" : ""}`);
      setSelected(new Set());
    } finally {
      setBulkStageChanging(false);
    }
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

  const pageFiltered = !!(search || statusFilter || responseFilter);
  const td = "px-2 py-2";

  return (
    <ListPage>
      <ListPageHeader title="Invoices"
        subtitle={<>{filtered.length} invoice{filtered.length !== 1 ? "s" : ""} · Invoice date: {PERIODS.find(p => p.id === period)?.label ?? "Custom"}</>}>
        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoice #, customer, email, PO…"
            className={`${control} h-8 w-60 pl-7 pr-2 text-xs`} />
        </div>
        {/* Status stays a header filter: its calendar windows ("Due This Week")
            overlap the single buckets, so it can't be a one-value column pick. */}
        <SelectField value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status" className="w-auto h-8 text-xs">
          <option value="">All statuses</option>
          {DUE_FILTERS.map(s => <option key={s} value={s}>{s}</option>)}
        </SelectField>
        <SelectField value={responseFilter} onChange={(e) => setResponseFilter(e.target.value)} aria-label="Filter by customer response" className="w-auto h-8 text-xs">
          <option value="">All responses</option>
          <option value="dispute">Open dispute</option>
          <option value="promise">Has commitment</option>
        </SelectField>
        <SelectField value={period} onChange={(e) => setPeriod(e.target.value as PeriodId)} aria-label="Invoice date period" className="w-auto h-8 text-xs">
          {PERIODS.map(p => <option key={p.id} value={p.id}>Invoice date: {p.label}</option>)}
        </SelectField>
        {period === "custom" && (
          <>
            <input type="date" value={customFrom} max={customTo} onChange={e => setCustomFrom(e.target.value)}
              aria-label="From" className={`${control} h-8 w-auto text-xs`} />
            <input type="date" value={customTo} min={customFrom} max={todayStr} onChange={e => setCustomTo(e.target.value)}
              aria-label="To" className={`${control} h-8 w-auto text-xs`} />
          </>
        )}
        <ListDivider />
        <Button icon={Plus} size="sm" onClick={() => setShowCreate(true)}>New invoice</Button>
      </ListPageHeader>

      {/* Selection bar — board layout: count + per-currency total, actions right */}
      {someSelected && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-stone-900 text-white border-b border-stone-800 flex-wrap shrink-0">
          <span className="text-[13px] font-medium">
            {selected.size} selected · {Object.entries(selectedTotals).sort((a, b) => b[1] - a[1]).map(([c, v]) => fmt.money(v, c)).join(" · ") || fmt.money(0)}
          </span>
          <div className="flex-1" />
          <SelectField value="" disabled={bulkStageChanging} aria-label="Change stage of the selected invoices"
            onChange={(e) => handleBulkStageChange(e.target.value)}
            className="w-auto min-w-[150px] h-8 text-[12px]">
            <option value="" disabled>{bulkStageChanging ? "Updating…" : "Change stage…"}</option>
            {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </SelectField>
          <Button variant="secondary" size="sm" icon={Send} onClick={() => setShowBatchEmail(true)}>Send email</Button>
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
          <button onClick={() => setSelected(new Set())} className="text-stone-400 hover:text-white p-1" aria-label="Clear selection"><X size={15} /></button>
        </div>
      )}

      <ListToolbar lv={lv} noun="invoice" selected={selected.size} filtered={pageFiltered}>
        <button onClick={handleExportExcel}
          className="flex items-center gap-1.5 text-[12px] font-medium rounded-md px-2.5 py-1.5 border text-stone-400 border-stone-700 hover:bg-stone-800 transition-colors">
          <Download size={13} /> Export Excel
        </button>
      </ListToolbar>
      <ListChips lv={lv} />

      <ListScroll lv={lv} empty={invoices.length === 0 ? "No invoices yet — create one or import from CSV." : "No invoices match the current filters."}>
        <table className={listTable}>
          <ListHead lv={lv} selection={{ all: allSelected, some: someSelected, onToggle: toggleAll }} trailing={1} />
          <tbody>
            {lv.rows.map((inv: any) => {
              const isSel = selected.has(inv.id);
              return (
                <tr key={inv.id} className={listRow(isSel)}>
                  <td className={listCheckCell}>
                    <input type="checkbox" checked={isSel} onChange={() => toggleOne(inv.id)} className={listCheckbox} aria-label={`Select invoice ${inv.invoiceNumber}`} />
                  </td>
                  <td className={`${td} whitespace-nowrap`}>
                    <Link href={`/invoices/${inv.id}`} className="inline-flex items-center gap-1.5 font-mono text-[12px] text-stone-400 hover:text-white hover:underline">
                      #{inv.invoiceNumber}
                      <Badge variant={sourceBadgeVariant(inv.source)} size="sm">{sourceLabel(inv.source)}</Badge>
                    </Link>
                  </td>
                  <td className={`${td} text-stone-200 text-[13px] max-w-[180px] truncate`} title={inv.customer?.name}>{inv.customer?.name ?? "—"}</td>
                  <td className={`${td} text-stone-500 text-[12px] max-w-[150px] truncate`} title={inv.project?.name ?? ""}>{inv.project?.name ?? "—"}</td>
                  <td className={`${td} text-stone-500 text-[12px] max-w-[120px] truncate`}>{inv.rep?.name ?? "—"}</td>
                  <td className={`${td} text-stone-500 text-[12px] max-w-[110px] truncate`}>{inv.region?.name ?? "—"}</td>
                  <td className={`${td} text-stone-400 text-[12px] whitespace-nowrap tabular-nums`}>{formatDate(inv.invoiceDate, df)}</td>
                  {/* Due — date first, days-overdue on its own line, as on the board */}
                  <td className={`${td} whitespace-nowrap tabular-nums`}>
                    <span className="text-stone-400 text-[12px]">{formatDate(inv.dueDate, df)}</span>
                    {!inv.isClosed && (
                      <span className={`block text-[11px] font-medium ${inv.daysOverdue > 0 ? "text-rose-400" : "text-stone-600"}`}>
                        {inv.daysOverdue > 0 ? `${inv.daysOverdue}d over` : "not due"}
                      </span>
                    )}
                  </td>
                  <td className={td}><Badge variant={dueStatusBadge(inv.dueStatus)} size="sm">{inv.dueStatus}</Badge></td>
                  <td className={td}>
                    <StageLabel label={inv.stageLabel} stages={stages} today={today}
                      hasOpenDispute={inv.hasOpenDispute} disputeReason={inv.disputeReason}
                      promiseDate={inv.isClosed ? null : inv.promiseDate} escalationType={inv.escalationType} />
                  </td>
                  <td className={`${td} max-w-[200px]`} title={inv.resolvedEmail || ""}>
                    {inv.resolvedEmail ? (() => {
                      const addrs = inv.resolvedEmail.split(",").map((e: string) => e.trim()).filter(Boolean);
                      return (
                        <span className="text-[12px] text-stone-300 truncate block">
                          {addrs[0]}
                          {addrs.length > 1 && <span className="ml-1 text-[11px] text-blue-400 font-medium">+{addrs.length - 1}</span>}
                        </span>
                      );
                    })() : <span className="text-[12px] text-stone-600 italic">no email</span>}
                  </td>
                  <td className={`${listNumCell} text-stone-400 text-[12px]`}>{fmt.money(inv.total, inv.currency)}</td>
                  <td className={listMoneyCell}><span className="font-medium text-stone-300 text-[13px]">{fmt.money(inv.outstanding, inv.currency)}</span></td>
                  <td className="px-3 py-2 text-center w-10">
                    {((inv.qboId && !inv.qboId.startsWith("CM-")) || (inv.xeroId && !inv.xeroId.startsWith("CN-"))) && (
                      <button onClick={(e) => handleDownloadPdf(e, inv)}
                        className="inline-flex items-center justify-center p-1 rounded hover:bg-stone-800 text-stone-500 hover:text-stone-200 transition-colors"
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
          {lv.rows.length > 0 && <ListFoot lv={lv} noun="invoice" selectable trailing={1} />}
        </table>
      </ListScroll>

      {showCreate && <InvoiceModal onClose={() => setShowCreate(false)} />}
      {showBatchEmail && (() => {
        const sendRows = Array.from(selected)
          .map((sid) => invoices.find((i: any) => i.id === sid))
          .filter(Boolean)
          .map((inv: any) => ({
            inv,
            custId: inv.customerId,
            custName: customers.find((c: any) => c.id === inv.customerId)?.name ?? "Customer",
            projName: projects.find((p: any) => p.id === inv.projectId)?.name ?? null,
            bal: Number(inv.qboBalance ?? inv.xeroBalance ?? Math.max(0, (inv.total ?? 0) - (inv.paid ?? 0))),
            days: daysOverdue(inv.dueDate),
            email: resolveEmail(inv),
          }));
        const multiCustomer = new Set(sendRows.map((r: any) => r.custId)).size > 1;
        return (
          <SendInvoicesModal
            rows={sendRows}
            ccy={sendRows[0]?.inv?.currency ?? "EUR"}
           
            orgName={orgSettings?.displayName ?? orgSettings?.name}
            logoUrl={orgSettings?.logoUrl}
            onClose={() => setShowBatchEmail(false)}
            onSent={() => { setShowBatchEmail(false); setSelected(new Set()); refresh(); }}
            toast={toast}
          />
        );
      })()}
    </ListPage>
  );
}
