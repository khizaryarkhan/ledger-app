"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  AlertCircle,
  Building2,
  FileText,
  ShoppingCart,
  MessageSquare,
  RefreshCw,
  Save,
  MessageCircleQuestion,
  Globe,
  Calendar,
  CreditCard,
  Hash,
  Mail,
  Phone,
} from "lucide-react";
import { Card, Badge, Button, Input, Select } from "@/components/ui";

// ── Types ─────────────────────────────────────────────────────────────────────

type SupplierSource = "QBO" | "Xero" | "Manual";
type SupplierStatus = "Active" | "Inactive";
type RiskRating = "Low" | "Medium" | "High";

interface Supplier {
  id: string;
  name: string;
  displayName?: string;
  code?: string;
  email?: string;
  phone?: string;
  currency: string;
  paymentTerms?: number;
  status: SupplierStatus;
  source: SupplierSource;
  lastSynced?: string;
  country?: string;
  taxNumber?: string;
  riskRating?: RiskRating;
  notes?: string;
  address?: string;
  // summary
  totalOutstanding: number;
  openBillsCount: number;
  openQueriesCount: number;
}

interface Bill {
  id: string;
  billNumber: string;
  billDate: string;
  dueDate: string;
  total: number;
  balance: number;
  currency: string;
  workflowStatus: string;
}

interface PurchaseOrder {
  id: string;
  poNumber: string;
  poDate: string;
  total: number;
  currency: string;
  status: string;
}

interface Query {
  id: string;
  subject: string;
  createdAt: string;
  status: "Open" | "Resolved" | "Pending";
  resolvedAt?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function fmtDate(dateStr?: string) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function timeAgo(dateStr?: string) {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function sourceBadgeVariant(source: SupplierSource) {
  const map: Record<SupplierSource, string> = {
    QBO: "blue",
    Xero: "purple",
    Manual: "neutral",
  };
  return map[source] || "neutral";
}

function statusBadgeVariant(status: SupplierStatus) {
  return status === "Active" ? "green" : "neutral";
}

function riskBadgeVariant(rating?: RiskRating) {
  const map: Record<RiskRating, string> = {
    Low: "green",
    Medium: "yellow",
    High: "red",
  };
  return rating ? map[rating] : "neutral";
}

function workflowBadgeVariant(status: string) {
  const map: Record<string, string> = {
    Synced: "neutral",
    PendingReview: "blue",
    PendingApproval: "yellow",
    Approved: "green",
    OnHold: "orange",
    ReadyForPayment: "purple",
  };
  return map[status] || "neutral";
}

function workflowLabel(status: string) {
  const map: Record<string, string> = {
    Synced: "Synced",
    PendingReview: "Pending Review",
    PendingApproval: "Pending Approval",
    Approved: "Approved",
    OnHold: "On Hold",
    ReadyForPayment: "Ready for Payment",
  };
  return map[status] || status;
}

function queryBadge(status: Query["status"]) {
  const map: Record<string, string> = {
    Open: "red",
    Pending: "yellow",
    Resolved: "green",
  };
  return map[status] || "neutral";
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-stone-800 rounded ${className}`} />;
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

type Tab = "overview" | "bills" | "pos" | "queries";

function TabBar({
  tab,
  onChange,
  billCount,
  poCount,
  queryCount,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
  billCount: number;
  poCount: number;
  queryCount: number;
}) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "bills", label: `Bills (${billCount})` },
    { id: "pos", label: `Purchase Orders (${poCount})` },
    { id: "queries", label: `Queries (${queryCount})` },
  ];

  return (
    <div className="border-b border-stone-800 mb-5">
      <div className="flex items-center gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? "border-violet-500 text-white"
                : "border-transparent text-stone-500 hover:text-stone-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({
  supplier,
  onSaved,
}: {
  supplier: Supplier;
  onSaved: (updated: Supplier) => void;
}) {
  const [form, setForm] = useState({
    name: supplier.name ?? "",
    displayName: supplier.displayName ?? "",
    email: supplier.email ?? "",
    phone: supplier.phone ?? "",
    address: supplier.address ?? "",
    currency: supplier.currency ?? "USD",
    paymentTerms: supplier.paymentTerms?.toString() ?? "",
    country: supplier.country ?? "",
    taxNumber: supplier.taxNumber ?? "",
    riskRating: supplier.riskRating ?? ("" as RiskRating | ""),
    status: supplier.status ?? "Active",
    notes: supplier.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  function set(field: keyof typeof form) {
    return (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >
    ) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const res = await fetch(`/api/payables/suppliers/${supplier.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          paymentTerms: form.paymentTerms ? Number(form.paymentTerms) : undefined,
          riskRating: form.riskRating || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server error ${res.status}`);
      }
      const updated = await res.json();
      onSaved(updated);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setSaveError(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave}>
      {saveError && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2.5 rounded-md bg-rose-500/10 ring-1 ring-rose-500/30 text-rose-400 text-sm">
          <AlertCircle size={14} />
          {saveError}
        </div>
      )}
      {saveSuccess && (
        <div className="mb-4 px-3 py-2.5 rounded-md bg-violet-500/10 ring-1 ring-violet-500/30 text-violet-400 text-sm">
          Changes saved.
        </div>
      )}

      <Card padding="md" className="mb-4">
        <h3 className="text-sm font-semibold text-white mb-4">
          Contact Details
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Name
            </label>
            <Input value={form.name} onChange={set("name")} placeholder="Supplier name" />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Display Name
            </label>
            <Input value={form.displayName} onChange={set("displayName")} placeholder="Optional" />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Email
            </label>
            <Input type="email" value={form.email} onChange={set("email")} placeholder="accounts@supplier.com" />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Phone
            </label>
            <Input value={form.phone} onChange={set("phone")} placeholder="+1 555 000 0000" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Address
            </label>
            <Input value={form.address} onChange={set("address")} placeholder="Street, City, Country" />
          </div>
        </div>
      </Card>

      <Card padding="md" className="mb-4">
        <h3 className="text-sm font-semibold text-white mb-4">
          Financial Settings
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Currency
            </label>
            <Select
              value={form.currency}
              onChange={set("currency")}
              options={["USD", "EUR", "GBP", "AED"]}
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Payment Terms (days)
            </label>
            <Input type="number" value={form.paymentTerms} onChange={set("paymentTerms")} placeholder="30" />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Country
            </label>
            <Input value={form.country} onChange={set("country")} placeholder="Country" />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Tax Number
            </label>
            <Input value={form.taxNumber} onChange={set("taxNumber")} placeholder="Optional" />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Risk Rating
            </label>
            <Select
              value={form.riskRating}
              onChange={set("riskRating")}
              placeholder="Not set"
              options={["Low", "Medium", "High"]}
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Status
            </label>
            <Select
              value={form.status}
              onChange={set("status")}
              options={["Active", "Inactive"]}
              className="w-full"
            />
          </div>
        </div>
      </Card>

      <Card padding="md" className="mb-4">
        <h3 className="text-sm font-semibold text-white mb-3">Notes</h3>
        <textarea
          value={form.notes}
          onChange={set("notes")}
          rows={4}
          placeholder="Internal notes about this supplier…"
          className="w-full px-3 py-2.5 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none transition-colors resize-none"
        />
      </Card>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center justify-center font-medium rounded-md transition-colors bg-violet-600 text-white hover:bg-violet-500 disabled:bg-stone-700 disabled:text-stone-500 h-9 px-3.5 text-sm gap-2"
        >
          <Save size={14} />
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </form>
  );
}

// ── Bills Tab ─────────────────────────────────────────────────────────────────

function BillsTab({ bills, currency }: { bills: Bill[]; currency: string }) {
  if (bills.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-center">
        <div className="w-10 h-10 rounded-full bg-stone-800 flex items-center justify-center mb-3">
          <FileText size={18} className="text-stone-500" />
        </div>
        <p className="text-sm font-semibold text-white mb-1">No bills</p>
        <p className="text-xs text-stone-500">
          No bills found for this supplier.
        </p>
      </div>
    );
  }

  return (
    <Card padding="none">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-800 bg-stone-900/60">
              {["Bill #", "Bill Date", "Due Date", "Total", "Balance", "Status"].map(
                (h) => (
                  <th
                    key={h}
                    className={`px-4 py-2.5 text-[11px] uppercase tracking-wider text-stone-500 font-semibold ${
                      ["Total", "Balance"].includes(h) ? "text-right" : "text-left"
                    }`}
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {bills.map((bill) => (
              <tr
                key={bill.id}
                className="border-b border-stone-800 hover:bg-stone-800/40 transition-colors"
              >
                <td className="px-4 py-3 font-mono text-xs text-stone-300">
                  {bill.billNumber}
                </td>
                <td className="px-4 py-3 text-stone-400 text-xs whitespace-nowrap">
                  {fmtDate(bill.billDate)}
                </td>
                <td className="px-4 py-3 text-xs whitespace-nowrap">
                  <span
                    className={
                      new Date(bill.dueDate) < new Date()
                        ? "text-rose-400 font-medium"
                        : "text-stone-400"
                    }
                  >
                    {fmtDate(bill.dueDate)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-stone-300 tabular-nums text-xs">
                  {fmtMoney(bill.total, bill.currency || currency)}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-white tabular-nums text-xs">
                  {fmtMoney(bill.balance, bill.currency || currency)}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={workflowBadgeVariant(bill.workflowStatus)}>
                    {workflowLabel(bill.workflowStatus)}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── POs Tab ───────────────────────────────────────────────────────────────────

function POsTab({ pos, currency }: { pos: PurchaseOrder[]; currency: string }) {
  if (pos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-center">
        <div className="w-10 h-10 rounded-full bg-stone-800 flex items-center justify-center mb-3">
          <ShoppingCart size={18} className="text-stone-500" />
        </div>
        <p className="text-sm font-semibold text-white mb-1">No purchase orders</p>
        <p className="text-xs text-stone-500">
          No POs found for this supplier.
        </p>
      </div>
    );
  }

  return (
    <Card padding="none">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-800 bg-stone-900/60">
              {["PO #", "PO Date", "Total", "Status"].map((h) => (
                <th
                  key={h}
                  className={`px-4 py-2.5 text-[11px] uppercase tracking-wider text-stone-500 font-semibold ${
                    h === "Total" ? "text-right" : "text-left"
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pos.map((po) => (
              <tr
                key={po.id}
                className="border-b border-stone-800 hover:bg-stone-800/40 transition-colors"
              >
                <td className="px-4 py-3 font-mono text-xs text-stone-300">
                  {po.poNumber}
                </td>
                <td className="px-4 py-3 text-stone-400 text-xs whitespace-nowrap">
                  {fmtDate(po.poDate)}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-white tabular-nums text-xs">
                  {fmtMoney(po.total, po.currency || currency)}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={po.status === "Open" ? "blue" : po.status === "Closed" ? "neutral" : "green"}>
                    {po.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── Queries Tab ───────────────────────────────────────────────────────────────

function QueriesTab({ queries }: { queries: Query[] }) {
  if (queries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-center">
        <div className="w-10 h-10 rounded-full bg-stone-800 flex items-center justify-center mb-3">
          <MessageSquare size={18} className="text-stone-500" />
        </div>
        <p className="text-sm font-semibold text-white mb-1">No queries</p>
        <p className="text-xs text-stone-500">
          No supplier queries have been raised yet.
        </p>
      </div>
    );
  }

  return (
    <Card padding="none">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-800 bg-stone-900/60">
              {["Subject", "Raised", "Status", "Resolved"].map((h) => (
                <th
                  key={h}
                  className="px-4 py-2.5 text-left text-[11px] uppercase tracking-wider text-stone-500 font-semibold"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {queries.map((q) => (
              <tr
                key={q.id}
                className="border-b border-stone-800 hover:bg-stone-800/40 transition-colors"
              >
                <td className="px-4 py-3 text-stone-200 text-sm">
                  {q.subject}
                </td>
                <td className="px-4 py-3 text-stone-400 text-xs whitespace-nowrap">
                  {fmtDate(q.createdAt)}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={queryBadge(q.status)}>{q.status}</Badge>
                </td>
                <td className="px-4 py-3 text-stone-400 text-xs whitespace-nowrap">
                  {fmtDate(q.resolvedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [bills, setBills] = useState<Bill[]>([]);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [queries, setQueries] = useState<Query[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [raisingQuery, setRaisingQuery] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/payables/suppliers/${id}`);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const json = await res.json();
      setSupplier(json.supplier ?? json);
      setBills(json.bills ?? []);
      setPos(json.purchaseOrders ?? []);
      setQueries(json.queries ?? []);
    } catch (e: any) {
      setError(e.message || "Failed to load supplier");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  async function handleRaiseQuery() {
    const subject = window.prompt("Query subject:");
    if (!subject) return;
    setRaisingQuery(true);
    try {
      const res = await fetch(`/api/payables/suppliers/${id}/queries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject }),
      });
      if (!res.ok) throw new Error("Failed to raise query");
      const newQuery = await res.json();
      setQueries((prev) => [newQuery, ...prev]);
    } catch {
      alert("Failed to raise query — please try again.");
    } finally {
      setRaisingQuery(false);
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <Skeleton className="h-4 w-32 mb-6" />
        <div className="flex items-start gap-2 mb-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-5 w-16 mt-1.5" />
        </div>
        <div className="grid grid-cols-3 gap-5">
          <div className="col-span-2 space-y-4">
            <Skeleton className="h-8 w-80 mb-2" />
            <Skeleton className="h-48 w-full rounded-lg" />
          </div>
          <Skeleton className="h-80 rounded-lg" />
        </div>
      </div>
    );
  }

  // Error / not found
  if (error || !supplier) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-12 h-12 rounded-full bg-stone-800 flex items-center justify-center mb-4">
            <AlertCircle size={20} className="text-stone-500" />
          </div>
          <p className="text-sm font-semibold text-white mb-1">
            {error || "Supplier not found"}
          </p>
          <p className="text-xs text-stone-500 mb-4">
            It may have been deleted or does not exist.
          </p>
          <Button onClick={() => router.push("/payables/suppliers")}>
            Back to Suppliers
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Back link */}
      <Link
        href="/payables/suppliers"
        className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-200 mb-4 transition-colors"
      >
        <ArrowLeft size={14} />
        Back to Suppliers
      </Link>

      {/* Page title */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1.5">
            <h1 className="text-2xl font-semibold text-white tracking-tight">
              {supplier.name}
            </h1>
            <Badge variant={statusBadgeVariant(supplier.status)}>
              {supplier.status}
            </Badge>
            <Badge variant={sourceBadgeVariant(supplier.source)}>
              {supplier.source}
            </Badge>
            {supplier.riskRating && (
              <Badge variant={riskBadgeVariant(supplier.riskRating)}>
                {supplier.riskRating} Risk
              </Badge>
            )}
          </div>
          {supplier.displayName && supplier.displayName !== supplier.name && (
            <p className="text-sm text-stone-400">{supplier.displayName}</p>
          )}
          {supplier.code && (
            <p className="text-xs text-stone-500 font-mono mt-0.5">
              {supplier.code}
            </p>
          )}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-3 gap-5">
        {/* ── Left: tabs (2/3) ── */}
        <div className="col-span-2">
          <TabBar
            tab={tab}
            onChange={setTab}
            billCount={bills.length}
            poCount={pos.length}
            queryCount={queries.length}
          />

          {tab === "overview" && (
            <OverviewTab supplier={supplier} onSaved={setSupplier} />
          )}
          {tab === "bills" && (
            <BillsTab bills={bills} currency={supplier.currency} />
          )}
          {tab === "pos" && (
            <POsTab pos={pos} currency={supplier.currency} />
          )}
          {tab === "queries" && <QueriesTab queries={queries} />}
        </div>

        {/* ── Right: summary panel (1/3) ── */}
        <div className="space-y-4">
          {/* Outstanding balance */}
          <Card padding="md" className="border-violet-800/40">
            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">
              Total Outstanding
            </div>
            <div className="text-2xl font-semibold text-white tabular-nums">
              {fmtMoney(supplier.totalOutstanding, supplier.currency)}
            </div>
            <p className="text-xs text-stone-500 mt-1">
              {supplier.openBillsCount} open bill
              {supplier.openBillsCount !== 1 ? "s" : ""}
            </p>
          </Card>

          {/* Stats */}
          <Card padding="md">
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">
              Summary
            </h3>
            <dl className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-stone-500 flex items-center gap-1.5">
                  <FileText size={12} />
                  Open Bills
                </dt>
                <dd className="text-white font-semibold">
                  {supplier.openBillsCount}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-stone-500 flex items-center gap-1.5">
                  <MessageSquare size={12} />
                  Open Queries
                </dt>
                <dd className={`font-semibold ${supplier.openQueriesCount > 0 ? "text-rose-400" : "text-white"}`}>
                  {supplier.openQueriesCount}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-stone-500 flex items-center gap-1.5">
                  <CreditCard size={12} />
                  Currency
                </dt>
                <dd className="text-white">{supplier.currency}</dd>
              </div>
              {supplier.paymentTerms != null && (
                <div className="flex items-center justify-between">
                  <dt className="text-stone-500 flex items-center gap-1.5">
                    <Calendar size={12} />
                    Payment Terms
                  </dt>
                  <dd className="text-white">Net {supplier.paymentTerms}</dd>
                </div>
              )}
              {supplier.email && (
                <div className="flex items-center justify-between">
                  <dt className="text-stone-500 flex items-center gap-1.5">
                    <Mail size={12} />
                    Email
                  </dt>
                  <dd className="text-stone-300 text-xs truncate max-w-[140px]">
                    {supplier.email}
                  </dd>
                </div>
              )}
              {supplier.country && (
                <div className="flex items-center justify-between">
                  <dt className="text-stone-500 flex items-center gap-1.5">
                    <Globe size={12} />
                    Country
                  </dt>
                  <dd className="text-white text-xs">{supplier.country}</dd>
                </div>
              )}
            </dl>
          </Card>

          {/* Source & sync */}
          <Card padding="md">
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">
              Integration
            </h3>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-stone-400">Source</span>
              <Badge variant={sourceBadgeVariant(supplier.source)}>
                {supplier.source}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-stone-400 flex items-center gap-1.5">
                <RefreshCw size={11} />
                Last synced
              </span>
              <span className="text-xs text-stone-300">
                {supplier.lastSynced ? timeAgo(supplier.lastSynced) : "Never"}
              </span>
            </div>
          </Card>

          {/* Quick actions */}
          <Card padding="md">
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">
              Quick Actions
            </h3>
            <button
              onClick={handleRaiseQuery}
              disabled={raisingQuery}
              className="w-full inline-flex items-center justify-center gap-2 font-medium rounded-md transition-colors bg-stone-800 text-stone-200 ring-1 ring-stone-700 hover:bg-stone-700 hover:ring-stone-600 disabled:opacity-50 h-9 px-3.5 text-sm"
            >
              <MessageCircleQuestion size={14} />
              {raisingQuery ? "Raising…" : "Raise Query"}
            </button>
          </Card>
        </div>
      </div>
    </div>
  );
}
