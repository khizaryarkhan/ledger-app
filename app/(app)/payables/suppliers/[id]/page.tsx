"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  AlertCircle,
  ShoppingCart,
  MessageSquare,
  Save,
  Pencil,
  Receipt,
  MessageCircleQuestion,
} from "lucide-react";
import { Card, Badge, Button, Input, Select } from "@/components/ui";
import { fmt, formatDate } from "@/lib/format";

// ── Types ─────────────────────────────────────────────────────────────────────

type SupplierSource = "QBO" | "Xero" | "Manual" | string;
type SupplierStatus = "Active" | "Inactive" | "Suspended";
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
  totalOutstanding: number;
  openBillsCount: number;
  openQueriesCount: number;
}

interface Bill {
  id: string;
  billNumber: string | null;
  billDate: string | null;
  dueDate: string | null;
  total: number;
  balance: number;
  currency: string;
  accountingPaymentStatus?: string;
  workflowStatus?: string;
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

function normalizeSource(source?: string) {
  if (!source) return "Manual";
  const m: Record<string, string> = { qbo: "QBO", xero: "Xero", manual: "Manual" };
  return m[source.toLowerCase()] ?? source;
}
function sourceBadgeVariant(source?: string) {
  const m: Record<string, string> = { QBO: "blue", Xero: "purple", Manual: "neutral" };
  return m[normalizeSource(source)] ?? "neutral";
}
function statusBadgeVariant(status: SupplierStatus) {
  return status === "Active" ? "green" : "neutral";
}
function riskBadgeVariant(rating?: RiskRating) {
  const m: Record<RiskRating, string> = { Low: "green", Medium: "yellow", High: "red" };
  return rating ? m[rating] : "neutral";
}
function txnStatusBadge(status?: string) {
  const m: Record<string, any> = {
    Paid: "green",
    "Partially Paid": "amber",
    Unpaid: "neutral",
    Voided: "neutral",
  };
  return <Badge variant={m[status ?? ""] ?? "neutral"} size="sm">{status ?? "—"}</Badge>;
}
function daysOverdue(due?: string | null) {
  if (!due) return 0;
  return Math.floor((Date.now() - new Date(due + "T00:00:00").getTime()) / 86400000);
}
function getBucket(due?: string | null): string {
  const d = daysOverdue(due);
  if (d <= 0) return "Current";
  if (d <= 30) return "1-30";
  if (d <= 60) return "31-60";
  if (d <= 90) return "61-90";
  return "90+";
}
function withinDateRange(dateStr: string | null, range: string): boolean {
  if (!dateStr) return range === "all";
  if (range === "all") return true;
  const d = new Date(dateStr + "T00:00:00").getTime();
  const now = Date.now();
  if (range === "this-year") return new Date(dateStr).getFullYear() === new Date().getFullYear();
  const ms = range === "last-12" ? 365 * 86400000 : range === "last-90" ? 90 * 86400000 : range === "last-30" ? 30 * 86400000 : 0;
  return d >= now - ms;
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-stone-800 rounded ${className}`} />;
}

// ── Transactions tab (mirrors AR customer Transactions) ────────────────────────

function SupplierTransactions({ bills }: { bills: Bill[] }) {
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");

  const rows = useMemo(
    () =>
      bills.map((b) => ({
        id: b.id,
        txnDate: b.billDate,
        type: "Bill",
        number: b.billNumber,
        amount: b.total ?? 0,
        balance: b.balance ?? 0,
        currency: b.currency,
        status: b.accountingPaymentStatus ?? (b.balance > 0 ? "Unpaid" : "Paid"),
      })),
    [bills]
  );

  const filtered = useMemo(
    () => rows.filter((r) => (typeFilter === "all" || r.type === typeFilter) && withinDateRange(r.txnDate, dateFilter)),
    [rows, typeFilter, dateFilter]
  );

  const totals = useMemo(() => {
    let billed = 0, open = 0;
    for (const r of filtered) { billed += r.amount; open += Math.max(0, r.balance); }
    return { billed, paid: billed - open, open };
  }, [filtered]);

  const ccy = filtered[0]?.currency || "EUR";

  return (
    <div className="space-y-3">
      <Card padding="sm">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Type</label>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
              className="h-8 px-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 focus:border-violet-500 focus:outline-none">
              <option value="all">All transactions {rows.length ? `(${rows.length})` : ""}</option>
              <option value="Bill">Bills {rows.length ? `(${rows.length})` : ""}</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Date</label>
            <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}
              className="h-8 px-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 focus:border-violet-500 focus:outline-none">
              <option value="all">All time</option>
              <option value="this-year">This year</option>
              <option value="last-12">Last 12 months</option>
              <option value="last-90">Last 90 days</option>
              <option value="last-30">Last 30 days</option>
            </select>
          </div>
          {filtered.length > 0 && (
            <div className="ml-auto flex items-center gap-4 text-[11px]">
              <div><div className="text-stone-500 uppercase tracking-wider mb-0.5">Billed</div><div className="text-stone-300 tabular-nums">{fmt.money(totals.billed, ccy)}</div></div>
              <div><div className="text-stone-500 uppercase tracking-wider mb-0.5">Paid</div><div className="text-stone-300 tabular-nums">{fmt.money(totals.paid, ccy)}</div></div>
              <div><div className="text-stone-500 uppercase tracking-wider mb-0.5">Open AP</div><div className="font-semibold tabular-nums text-rose-400">{fmt.money(totals.open, ccy)}</div></div>
              <div><div className="text-stone-500 uppercase tracking-wider mb-0.5">Net</div><div className="font-semibold tabular-nums text-stone-100">{fmt.money(totals.open, ccy)}</div></div>
            </div>
          )}
        </div>
      </Card>

      <Card padding="none">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
              <th className="text-left font-semibold px-4 py-3 w-28">Date</th>
              <th className="text-left font-semibold px-4 py-3 w-40">Type</th>
              <th className="text-left font-semibold px-4 py-3 w-28">Number</th>
              <th className="text-left font-semibold px-4 py-3">Memo</th>
              <th className="text-right font-semibold px-4 py-3 w-28">Total</th>
              <th className="text-right font-semibold px-4 py-3 w-28">Balance</th>
              <th className="text-left font-semibold px-4 py-3 w-28">Status</th>
              <th className="text-right font-semibold px-4 py-3 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-500 text-sm">No transactions found for this filter.</td></tr>
            )}
            {filtered.map((r) => {
              const showBalance = r.balance > 0.005;
              return (
                <tr key={r.id} className="border-b border-stone-800/60 hover:bg-stone-800/40 transition-colors">
                  <td className="px-4 py-3 text-stone-300 tabular-nums text-[12px] whitespace-nowrap">{r.txnDate ? formatDate(r.txnDate) : "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2"><Receipt size={13} className="text-stone-400" /><span className="text-stone-200">{r.type}</span></div>
                  </td>
                  <td className="px-4 py-3 text-stone-400 tabular-nums text-[12px]">{r.number || "—"}</td>
                  <td className="px-4 py-3 text-stone-500 text-[12px]"></td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-stone-100">{fmt.money(r.amount, r.currency)}</td>
                  <td className={`px-4 py-3 text-right tabular-nums font-semibold ${showBalance ? "text-rose-400" : "text-stone-600"}`}>{showBalance ? fmt.money(r.balance, r.currency) : "—"}</td>
                  <td className="px-4 py-3">{txnStatusBadge(r.status)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/payables/bills/${r.id}`} className="text-[12px] text-violet-400 hover:text-violet-300 font-medium">View</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length > 0 && (
          <div className="px-4 py-2 border-t border-stone-800 text-[11px] text-stone-500 flex items-center justify-between">
            <span>Showing {filtered.length} of {rows.length} transactions</span>
            <span className="text-stone-600">Balance shown for unpaid bills only</span>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Purchase Orders tab ─────────────────────────────────────────────────────────

function POsTab({ pos, currency }: { pos: PurchaseOrder[]; currency: string }) {
  if (pos.length === 0)
    return <Card padding="none"><div className="flex flex-col items-center justify-center py-14 text-center"><ShoppingCart size={20} className="text-stone-600 mb-2" /><p className="text-sm font-semibold text-white mb-1">No purchase orders</p><p className="text-xs text-stone-500">No POs found for this supplier.</p></div></Card>;
  return (
    <Card padding="none">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
            <th className="text-left font-semibold px-4 py-3">PO #</th>
            <th className="text-left font-semibold px-4 py-3">PO Date</th>
            <th className="text-right font-semibold px-4 py-3">Total</th>
            <th className="text-left font-semibold px-4 py-3">Status</th>
            <th className="text-right font-semibold px-4 py-3 w-16"></th>
          </tr>
        </thead>
        <tbody>
          {pos.map((po) => (
            <tr key={po.id} className="border-b border-stone-800/60 hover:bg-stone-800/40 transition-colors">
              <td className="px-4 py-3 font-mono text-xs text-stone-300">{po.poNumber}</td>
              <td className="px-4 py-3 text-stone-400 text-xs whitespace-nowrap">{formatDate(po.poDate)}</td>
              <td className="px-4 py-3 text-right font-semibold text-white tabular-nums text-xs">{fmt.money(po.total, po.currency || currency)}</td>
              <td className="px-4 py-3"><Badge variant={po.status === "Approved" ? "green" : po.status === "Cancelled" ? "neutral" : "blue"} size="sm">{po.status}</Badge></td>
              <td className="px-4 py-3 text-right"><Link href={`/payables/purchase-orders/${po.id}`} className="text-[12px] text-violet-400 hover:text-violet-300 font-medium">View</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ── Queries tab ───────────────────────────────────────────────────────────────

function QueriesTab({ queries }: { queries: Query[] }) {
  if (queries.length === 0)
    return <Card padding="none"><div className="flex flex-col items-center justify-center py-14 text-center"><MessageSquare size={20} className="text-stone-600 mb-2" /><p className="text-sm font-semibold text-white mb-1">No queries</p><p className="text-xs text-stone-500">No supplier queries have been raised yet.</p></div></Card>;
  const qBadge = (s: string) => (s === "Open" ? "red" : s === "Pending" ? "yellow" : "green");
  return (
    <Card padding="none">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
            <th className="text-left font-semibold px-4 py-3">Subject</th>
            <th className="text-left font-semibold px-4 py-3">Raised</th>
            <th className="text-left font-semibold px-4 py-3">Status</th>
            <th className="text-left font-semibold px-4 py-3">Resolved</th>
          </tr>
        </thead>
        <tbody>
          {queries.map((q) => (
            <tr key={q.id} className="border-b border-stone-800/60 hover:bg-stone-800/40 transition-colors">
              <td className="px-4 py-3 text-stone-200 text-sm">{q.subject}</td>
              <td className="px-4 py-3 text-stone-400 text-xs whitespace-nowrap">{formatDate(q.createdAt)}</td>
              <td className="px-4 py-3"><Badge variant={qBadge(q.status)} size="sm">{q.status}</Badge></td>
              <td className="px-4 py-3 text-stone-400 text-xs whitespace-nowrap">{q.resolvedAt ? formatDate(q.resolvedAt) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ── Edit form (Overview edit mode) ──────────────────────────────────────────────

function EditForm({ supplier, onSaved, onCancel }: { supplier: Supplier; onSaved: (s: Supplier) => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    name: supplier.name ?? "", displayName: supplier.displayName ?? "", email: supplier.email ?? "",
    phone: supplier.phone ?? "", address: supplier.address ?? "", currency: supplier.currency ?? "EUR",
    paymentTerms: supplier.paymentTerms?.toString() ?? "", country: supplier.country ?? "",
    taxNumber: supplier.taxNumber ?? "", riskRating: supplier.riskRating ?? ("" as RiskRating | ""),
    status: supplier.status ?? "Active", notes: supplier.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (f: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [f]: e.target.value }));

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      const res = await fetch(`/api/payables/suppliers/${supplier.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, paymentTerms: form.paymentTerms ? Number(form.paymentTerms) : undefined, riskRating: form.riskRating || undefined }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `Server error ${res.status}`); }
      onSaved(await res.json());
    } catch (e: any) { setErr(e.message || "Failed to save"); } finally { setSaving(false); }
  }

  return (
    <form onSubmit={handleSave}>
      {err && <div className="mb-4 flex items-center gap-2 px-3 py-2.5 rounded-md bg-rose-500/10 ring-1 ring-rose-500/30 text-rose-400 text-sm"><AlertCircle size={14} />{err}</div>}
      <Card padding="md" className="mb-4">
        <h3 className="text-sm font-semibold text-white mb-4">Contact Details</h3>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="block text-xs text-stone-400 mb-1.5 font-medium">Name</label><Input value={form.name} onChange={set("name")} /></div>
          <div><label className="block text-xs text-stone-400 mb-1.5 font-medium">Display Name</label><Input value={form.displayName} onChange={set("displayName")} placeholder="Optional" /></div>
          <div><label className="block text-xs text-stone-400 mb-1.5 font-medium">Email</label><Input type="email" value={form.email} onChange={set("email")} /></div>
          <div><label className="block text-xs text-stone-400 mb-1.5 font-medium">Phone</label><Input value={form.phone} onChange={set("phone")} /></div>
          <div className="col-span-2"><label className="block text-xs text-stone-400 mb-1.5 font-medium">Address</label><Input value={form.address} onChange={set("address")} /></div>
        </div>
      </Card>
      <Card padding="md" className="mb-4">
        <h3 className="text-sm font-semibold text-white mb-4">Financial Settings</h3>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="block text-xs text-stone-400 mb-1.5 font-medium">Currency</label><Select value={form.currency} onChange={set("currency")} options={["USD", "EUR", "GBP", "AED"]} className="w-full" /></div>
          <div><label className="block text-xs text-stone-400 mb-1.5 font-medium">Payment Terms (days)</label><Input type="number" value={form.paymentTerms} onChange={set("paymentTerms")} placeholder="30" /></div>
          <div><label className="block text-xs text-stone-400 mb-1.5 font-medium">Country</label><Input value={form.country} onChange={set("country")} /></div>
          <div><label className="block text-xs text-stone-400 mb-1.5 font-medium">Tax Number</label><Input value={form.taxNumber} onChange={set("taxNumber")} placeholder="Optional" /></div>
          <div><label className="block text-xs text-stone-400 mb-1.5 font-medium">Risk Rating</label><Select value={form.riskRating} onChange={set("riskRating")} placeholder="Not set" options={["Low", "Medium", "High"]} className="w-full" /></div>
          <div><label className="block text-xs text-stone-400 mb-1.5 font-medium">Status</label><Select value={form.status} onChange={set("status")} options={["Active", "Inactive", "Suspended"]} className="w-full" /></div>
        </div>
      </Card>
      <Card padding="md" className="mb-4">
        <h3 className="text-sm font-semibold text-white mb-3">Notes</h3>
        <textarea value={form.notes} onChange={set("notes")} rows={4} placeholder="Internal notes about this supplier…"
          className="w-full px-3 py-2.5 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none resize-none" />
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" type="button" onClick={onCancel}>Cancel</Button>
        <Button type="submit" icon={Save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
      </div>
    </form>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────────

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [bills, setBills] = useState<Bill[]>([]);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [queries, setQueries] = useState<Query[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "transactions" | "pos" | "queries">("overview");
  const [editing, setEditing] = useState(false);
  const [raisingQuery, setRaisingQuery] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/payables/suppliers/${id}`);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const json = await res.json();
      setSupplier(json.supplier ?? json);
      setBills(json.bills ?? []);
      setPos(json.purchaseOrders ?? []);
      setQueries(json.queries ?? []);
    } catch (e: any) { setError(e.message || "Failed to load supplier"); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [id]);

  async function handleRaiseQuery() {
    const subject = window.prompt("Query subject:");
    if (!subject) return;
    setRaisingQuery(true);
    try {
      const res = await fetch(`/api/payables/suppliers/${id}/queries`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject }),
      });
      if (!res.ok) throw new Error("Failed to raise query");
      const created = await res.json();
      setQueries((prev) => [created, ...prev]);
    } catch { alert("Failed to raise query — please try again."); } finally { setRaisingQuery(false); }
  }

  const invCcy = supplier?.currency || "EUR";
  const openBills = useMemo(() => bills.filter((b) => (b.balance ?? 0) > 0), [bills]);
  const overdue = useMemo(() => openBills.filter((b) => daysOverdue(b.dueDate) > 0).reduce((s, b) => s + (b.balance ?? 0), 0), [openBills]);
  const buckets = useMemo(() => {
    const b: Record<string, number> = { Current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    openBills.forEach((bill) => { b[getBucket(bill.dueDate)] += bill.balance ?? 0; });
    return b;
  }, [openBills]);

  if (loading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <Skeleton className="h-4 w-32 mb-6" />
        <Skeleton className="h-10 w-72 mb-6" />
        <div className="grid grid-cols-4 gap-3 mb-6">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}</div>
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }
  if (error || !supplier) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <AlertCircle size={22} className="text-stone-500 mb-3" />
          <p className="text-sm font-semibold text-white mb-1">{error || "Supplier not found"}</p>
          <p className="text-xs text-stone-500 mb-4">It may have been deleted or does not exist.</p>
          <Button onClick={() => router.push("/payables/suppliers")}>Back to suppliers</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <Link href="/payables/suppliers" className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-200 mb-4">
        <ArrowLeft size={14} /> Back to suppliers
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-lg bg-stone-800 flex items-center justify-center text-stone-200 text-lg font-semibold flex-shrink-0">
            {supplier.name.split(" ").slice(0, 2).map((w) => w[0]).join("")}
          </div>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-semibold text-stone-100 tracking-tight">{supplier.name}</h1>
              {supplier.riskRating === "High" && <Badge variant="red">High risk</Badge>}
              {supplier.riskRating === "Medium" && <Badge variant="yellow">Medium risk</Badge>}
              <Badge variant={statusBadgeVariant(supplier.status)}>{supplier.status}</Badge>
              <Badge variant={sourceBadgeVariant(supplier.source)}>{normalizeSource(supplier.source)}</Badge>
              {supplier.totalOutstanding > 0 && (
                <span className="text-sm font-semibold tabular-nums text-stone-300">{fmt.money(supplier.totalOutstanding, invCcy)} outstanding</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-stone-400">
              {supplier.code && <><span className="font-mono text-xs">{supplier.code}</span><span className="text-stone-700">·</span></>}
              <span>{supplier.country || "—"}</span>
              <span className="text-stone-700">·</span>
              <span>{supplier.currency}</span>
              <span className="text-stone-700">·</span>
              <span>{supplier.paymentTerms ?? 30} day terms</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleRaiseQuery} disabled={raisingQuery}
            className="flex items-center gap-2 px-3 py-2 rounded-lg ring-1 bg-stone-800 ring-stone-700 text-stone-400 hover:bg-stone-700 hover:text-stone-200 text-sm font-medium transition-colors disabled:opacity-50">
            <MessageCircleQuestion size={13} /> {raisingQuery ? "Raising…" : "Raise query"}
          </button>
          <Button icon={Pencil} onClick={() => { setTab("overview"); setEditing(true); }}>Edit</Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <Card padding="md"><div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Outstanding</div><div className="text-xl font-semibold text-stone-100 tabular-nums">{fmt.money(supplier.totalOutstanding, invCcy)}</div></Card>
        <Card padding="md"><div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Overdue</div><div className={`text-xl font-semibold tabular-nums ${overdue > 0 ? "text-rose-400" : "text-stone-100"}`}>{fmt.money(overdue, invCcy)}</div></Card>
        <Card padding="md"><div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Open bills</div><div className="text-xl font-semibold text-stone-100 tabular-nums">{supplier.openBillsCount}</div></Card>
        <Card padding="md"><div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Payment terms</div><div className="text-xl font-semibold text-stone-100 tabular-nums">Net {supplier.paymentTerms ?? 30}</div></Card>
      </div>

      {/* Tabs */}
      <div className="border-b border-stone-800 mb-5">
        <div className="flex items-center gap-1">
          {[
            { id: "overview", label: "Overview" },
            { id: "transactions", label: "Transactions" },
            { id: "pos", label: `Purchase Orders (${pos.length})` },
            { id: "queries", label: `Queries (${queries.length})` },
          ].map((t) => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t.id ? "border-violet-500 text-stone-100" : "border-transparent text-stone-500 hover:text-stone-200"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "overview" && (
        editing ? (
          <EditForm supplier={supplier} onSaved={(s) => { setSupplier({ ...supplier, ...s }); setEditing(false); }} onCancel={() => setEditing(false)} />
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <Card className="col-span-2">
              <h3 className="text-sm font-semibold text-stone-100 mb-4">Aging breakdown</h3>
              <div className="space-y-2.5">
                {(["Current", "1-30", "31-60", "61-90", "90+"] as const).map((b, i) => {
                  const colors = ["bg-emerald-500", "bg-amber-400", "bg-orange-500", "bg-rose-500", "bg-rose-700"];
                  const labels = ["Current", "1-30 days overdue", "31-60 days overdue", "61-90 days overdue", "90+ days overdue"];
                  const max = Math.max(...Object.values(buckets), 1);
                  return (
                    <div key={b} className="flex items-center gap-3">
                      <div className="w-44 text-xs text-stone-400 font-medium">{labels[i]}</div>
                      <div className="flex-1 h-6 bg-stone-800 rounded relative overflow-hidden"><div className={`h-full ${colors[i]}`} style={{ width: `${(buckets[b] / max) * 100}%` }} /></div>
                      <div className="w-28 text-right text-sm font-semibold text-stone-100 tabular-nums">{fmt.money(buckets[b], invCcy)}</div>
                    </div>
                  );
                })}
              </div>
            </Card>
            <Card>
              <h3 className="text-sm font-semibold text-stone-100 mb-3">Supplier info</h3>
              <dl className="space-y-2.5 text-sm">
                <div><dt className="text-xs text-stone-500">Email</dt><dd className="text-stone-300">{supplier.email || "—"}</dd></div>
                <div><dt className="text-xs text-stone-500">Phone</dt><dd className="text-stone-300">{supplier.phone || "—"}</dd></div>
                <div><dt className="text-xs text-stone-500">Tax number</dt><dd className="font-mono text-xs text-stone-300">{supplier.taxNumber || "—"}</dd></div>
                <div><dt className="text-xs text-stone-500">Status</dt><dd className="text-stone-300">{supplier.status}</dd></div>
                <div><dt className="text-xs text-stone-500">Risk rating</dt><dd className="text-stone-300">{supplier.riskRating || "—"}</dd></div>
                <div><dt className="text-xs text-stone-500">Open queries</dt><dd className={supplier.openQueriesCount > 0 ? "text-rose-400" : "text-stone-300"}>{supplier.openQueriesCount}</dd></div>
                {supplier.notes && <div><dt className="text-xs text-stone-500">Notes</dt><dd className="text-stone-400 mt-1">{supplier.notes}</dd></div>}
              </dl>
            </Card>
          </div>
        )
      )}

      {tab === "transactions" && <SupplierTransactions bills={bills} />}
      {tab === "pos" && <POsTab pos={pos} currency={invCcy} />}
      {tab === "queries" && <QueriesTab queries={queries} />}
    </div>
  );
}
