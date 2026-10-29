"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useData } from "@/components/data-provider";
import { Badge, Button, dueStatusBadge } from "@/components/ui";
import { SendInvoicesModal } from "@/components/send-invoices-modal";
import { fmt, formatDate, daysOverdue, getDueStatus, matchesDueFilter, DUE_FILTERS, sourceLabel, sourceBadgeVariant, localToday } from "@/lib/format";
import { Plus, Trash2, Download, Send } from "lucide-react";
import { DEFAULT_STAGES, resolveStageLabel, type Stage } from "@/lib/stages";
import { SelectField } from "@/components/form-kit";
import { StageLabel } from "@/components/stage-label";
import { isPaidOrClosed } from "@/lib/receivable-composition";
import {
  useListView, ListPage, ListPageHeader, ListDivider, ListToolbar, ListChips, ListScroll, ListHead, ListFoot,
  sumByCurrency, listTable, listRow, listCheckCell, listCheckbox, listMoneyCell, listNumCell, type ListColumn,
} from "@/components/list-view";
import {
  ListSearch, ListPeriodFilter, ListSelectionBar, ListExportButton, usePeriodFilter, useRowSelection,
  exportRowsToExcel, type ExportColumn,
} from "@/components/list-chrome";
import { inWindow } from "@/lib/list-period";

/** What Export Excel writes — more than the table shows (paid, currency, email). */
const INVOICE_EXPORT: ExportColumn<any>[] = [
  { header: "Invoice #",     value: inv => inv.invoiceNumber, width: 14 },
  { header: "Customer",      value: inv => inv.customer?.name, width: 28 },
  { header: "Project",       value: inv => inv.project?.name, width: 22 },
  { header: "Rep",           value: inv => inv.rep?.name, width: 18 },
  { header: "Region",        value: inv => inv.region?.name, width: 16 },
  { header: "Invoice Date",  value: inv => inv.invoiceDate, width: 14 },
  { header: "Due Date",      value: inv => inv.dueDate, width: 14 },
  { header: "Status",        value: inv => inv.dueStatus, width: 14 },
  { header: "Stage",         value: inv => inv.stageLabel, width: 18 },
  { header: "Billing Email", value: inv => inv.resolvedEmail, width: 32 },
  { header: "Currency",      value: inv => inv.currency, width: 8 },
  { header: "Value",         value: inv => inv.total ?? 0, width: 12 },
  { header: "Paid",          value: inv => inv.paid ?? 0, width: 12 },
  { header: "Outstanding",   value: inv => inv.outstanding ?? 0, width: 12 },
];

export default function InvoicesPage() {
  const router = useRouter();
  const { invoices, customers, projects, contacts, regions, reps, bulkDeleteInvoices, orgSettings, refresh, toast } = useData() as any;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [responseFilter, setResponseFilter] = useState("");
  // Customer / region / stage used to be header selects too; they are column
  // filters now (funnel on each header), so the header keeps only the filters
  // a column can't express.

  // Date period filter — defaults to last month. Shared with every other list
  // (components/list-chrome.tsx); local dates, never toISOString() (CLAUDE.md,
  // "A date is a date").
  const todayStr = localToday();
  const period = usePeriodFilter("last-month");
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

  /** Resolve outstanding balance the SAME way for the table's Outstanding
   *  column and the batch-email modal: provider balance when known, else
   *  total - paid, zeroed once the invoice is settled (fix for the two
   *  surfaces silently disagreeing — see CLAUDE.md task brief). */
  function resolveBalance(inv: any): number {
    if (isPaidOrClosed(inv)) return 0;
    return Number(inv.qboBalance ?? inv.xeroBalance ?? Math.max(0, (inv.total ?? 0) - (inv.paid ?? 0)));
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

  const handleExportExcel = () => exportRowsToExcel({
    rows: lv.rows,
    columns: INVOICE_EXPORT,
    sheet: "Invoices",
    filename: `Invoices_${period.label.replace(/\s+/g, "_")}_${localToday()}.xlsx`,
  });

  const filtered = useMemo(() => {
    let res = invoices.map((i: any) => {
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
        isClosed: isPaidOrClosed(i),
        stageLabel: resolveStageLabel(i.collectionStage, stages),
        outstanding: resolveBalance(i),
        daysOverdue: daysOverdue(i.dueDate),
        dueStatus: getDueStatus(i),
        resolvedEmail: resolveEmail(i),
      };
    });

    // Date filter on invoice date — string comparison on the calendar date
    // (lib/list-period.ts); a document with no date is kept.
    res = res.filter((i: any) => inWindow(i.invoiceDate, period.range));

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
  }, [invoices, customers, projects, contacts, reps, regions, stages, search, statusFilter, responseFilter, period.range]);

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
  // longer see — the shared selection prunes itself when filters hide rows
  // (components/list-chrome.tsx, the board's rule).
  const sel = useRowSelection<any>(lv.rows);
  const { selected, toggleOne, clear: clearSelection } = sel;
  const someSelected = sel.selection.some;
  const selectedTotals = useMemo(
    () => sumByCurrency(lv.rows.filter((r: any) => selected.has(r.id)), (r: any) => ({ amount: r.outstanding, currency: r.currency })),
    [lv.rows, selected],
  );

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
      clearSelection();
    } finally {
      setBulkStageChanging(false);
    }
  };

  const handleBulkDelete = async () => {
    setDeleting(true);
    try {
      await bulkDeleteInvoices(Array.from(selected));
      clearSelection();
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
        subtitle={<>{filtered.length} invoice{filtered.length !== 1 ? "s" : ""} · Invoice date: {period.label}</>}>
        <ListSearch value={search} onChange={setSearch} placeholder="Search invoice #, customer, email, PO…" />
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
        <ListPeriodFilter state={period} label="Invoice date" capAtToday />
        <ListDivider />
        <Button icon={Plus} size="sm" onClick={() => router.push("/accounting/new/Invoice")}>New invoice</Button>
      </ListPageHeader>

      {/* Selection bar — board layout: count + per-currency total, actions right */}
      {someSelected && (
        <ListSelectionBar onClear={clearSelection}
          summary={<>{selected.size} selected · {Object.entries(selectedTotals).sort((a, b) => b[1] - a[1]).map(([c, v]) => fmt.money(v, c)).join(" · ") || fmt.money(0)}</>}>
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
        </ListSelectionBar>
      )}

      <ListToolbar lv={lv} noun="invoice" selected={selected.size} filtered={pageFiltered}>
        <ListExportButton onClick={handleExportExcel} />
      </ListToolbar>
      <ListChips lv={lv} />

      <ListScroll lv={lv} empty={invoices.length === 0 ? "No invoices yet — create one or import from CSV." : "No invoices match the current filters."}>
        <table className={listTable}>
          <ListHead lv={lv} selection={sel.selection} trailing={1} />
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

      {showBatchEmail && (() => {
        const sendRows = Array.from(selected)
          .map((sid) => invoices.find((i: any) => i.id === sid))
          .filter(Boolean)
          .map((inv: any) => ({
            inv,
            custId: inv.customerId,
            custName: customers.find((c: any) => c.id === inv.customerId)?.name ?? "Customer",
            projName: projects.find((p: any) => p.id === inv.projectId)?.name ?? null,
            bal: resolveBalance(inv),
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
            onSent={() => { setShowBatchEmail(false); clearSelection(); refresh(); }}
            toast={toast}
          />
        );
      })()}
    </ListPage>
  );
}
