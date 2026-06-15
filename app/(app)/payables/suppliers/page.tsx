"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Plus,
  Users,
  AlertCircle,
  X,
  RefreshCw,
} from "lucide-react";
import { Card, Badge, Button, Input, Select, Modal, EmptyState } from "@/components/ui";

// ── Types ────────────────────────────────────────────────────────────────────

type SupplierStatus = "Active" | "Inactive";
type SupplierSource = "QBO" | "Xero" | "Manual";

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
}

type StatusFilter = "All" | "Active" | "Inactive";
type SourceFilter = "All" | "QBO" | "Xero" | "Manual";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(dateStr?: string) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function statusBadgeVariant(status: SupplierStatus) {
  return status === "Active" ? "green" : "neutral";
}

function sourceBadgeVariant(source: SupplierSource) {
  const map: Record<SupplierSource, string> = {
    QBO: "blue",
    Xero: "purple",
    Manual: "neutral",
  };
  return map[source] || "neutral";
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-stone-800 rounded ${className}`} />;
}

// ── Add Supplier Modal ────────────────────────────────────────────────────────

const EMPTY_FORM = {
  name: "",
  displayName: "",
  code: "",
  email: "",
  phone: "",
  currency: "USD",
  paymentTerms: "",
  country: "",
  taxNumber: "",
  status: "Active" as SupplierStatus,
};

function AddSupplierModal({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (supplier: Supplier) => void;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(field: keyof typeof EMPTY_FORM) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Supplier name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          paymentTerms: form.paymentTerms ? Number(form.paymentTerms) : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server error ${res.status}`);
      }
      const supplier = await res.json();
      onAdded(supplier);
      setForm(EMPTY_FORM);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to add supplier");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Supplier"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <button
            type="submit"
            form="add-supplier-form"
            disabled={saving}
            className="inline-flex items-center justify-center font-medium rounded-md transition-colors bg-violet-600 text-white hover:bg-violet-500 disabled:bg-stone-700 disabled:text-stone-500 h-9 px-3.5 text-sm gap-2"
          >
            {saving ? "Saving…" : "Add Supplier"}
          </button>
        </>
      }
    >
      <form
        id="add-supplier-form"
        onSubmit={handleSubmit}
        className="p-5 space-y-4"
      >
        {error && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-rose-500/10 ring-1 ring-rose-500/30 text-rose-400 text-sm">
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {/* Name */}
          <div className="col-span-2">
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Name <span className="text-rose-400">*</span>
            </label>
            <Input
              value={form.name}
              onChange={set("name")}
              placeholder="Acme Corp"
            />
          </div>

          {/* Display Name */}
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Display Name
            </label>
            <Input
              value={form.displayName}
              onChange={set("displayName")}
              placeholder="Optional"
            />
          </div>

          {/* Code */}
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Code
            </label>
            <Input
              value={form.code}
              onChange={set("code")}
              placeholder="SUP-001"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Email
            </label>
            <Input
              type="email"
              value={form.email}
              onChange={set("email")}
              placeholder="accounts@acme.com"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Phone
            </label>
            <Input
              value={form.phone}
              onChange={set("phone")}
              placeholder="+1 555 000 0000"
            />
          </div>

          {/* Currency */}
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

          {/* Payment Terms */}
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Payment Terms (days)
            </label>
            <Input
              type="number"
              value={form.paymentTerms}
              onChange={set("paymentTerms")}
              placeholder="30"
            />
          </div>

          {/* Country */}
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Country
            </label>
            <Input
              value={form.country}
              onChange={set("country")}
              placeholder="United States"
            />
          </div>

          {/* Tax Number */}
          <div>
            <label className="block text-xs text-stone-400 mb-1.5 font-medium">
              Tax Number
            </label>
            <Input
              value={form.taxNumber}
              onChange={set("taxNumber")}
              placeholder="Optional"
            />
          </div>

          {/* Status */}
          <div className="col-span-2">
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
      </form>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SuppliersPage() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("All");
  const [showAdd, setShowAdd] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/suppliers");
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const json = await res.json();
      setSuppliers(Array.isArray(json) ? json : json.suppliers ?? []);
    } catch (e: any) {
      setError(e.message || "Failed to load suppliers");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    let rows = suppliers;
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(
        (sup) =>
          sup.name.toLowerCase().includes(s) ||
          (sup.code ?? "").toLowerCase().includes(s) ||
          (sup.email ?? "").toLowerCase().includes(s)
      );
    }
    if (statusFilter !== "All") {
      rows = rows.filter((s) => s.status === statusFilter);
    }
    if (sourceFilter !== "All") {
      rows = rows.filter((s) => s.source === sourceFilter);
    }
    return rows;
  }, [suppliers, search, statusFilter, sourceFilter]);

  const hasFilters =
    search || statusFilter !== "All" || sourceFilter !== "All";

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">
            Suppliers
          </h1>
          <p className="text-sm text-stone-500 mt-1">
            {loading ? "Loading…" : `${filtered.length} supplier${filtered.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center justify-center font-medium rounded-md transition-colors bg-violet-600 text-white hover:bg-violet-500 h-9 px-3.5 text-sm gap-2"
        >
          <Plus size={15} strokeWidth={2} />
          Add Supplier
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-5 flex items-center gap-2 px-4 py-3 rounded-lg bg-rose-500/10 ring-1 ring-rose-500/30 text-rose-400 text-sm">
          <AlertCircle size={16} />
          {error}
          <button
            onClick={load}
            className="ml-auto underline hover:no-underline text-rose-300"
          >
            Retry
          </button>
        </div>
      )}

      {/* Filters */}
      <Card padding="none" className="mb-0">
        <div className="px-3 py-2.5 border-b border-stone-800 flex items-center gap-2 flex-wrap">
          <Input
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setSearch(e.target.value)
            }
            placeholder="Search name, code, email…"
            icon={Search}
            className="w-72"
          />
          <Select
            value={statusFilter}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              setStatusFilter(e.target.value as StatusFilter)
            }
            options={["All", "Active", "Inactive"]}
            className="w-36"
          />
          <Select
            value={sourceFilter}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              setSourceFilter(e.target.value as SourceFilter)
            }
            options={["All", "QBO", "Xero", "Manual"]}
            className="w-36"
          />
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              icon={X}
              onClick={() => {
                setSearch("");
                setStatusFilter("All");
                setSourceFilter("All");
              }}
            >
              Clear
            </Button>
          )}
        </div>

        {/* Table */}
        {loading ? (
          <div className="p-5 space-y-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="animate-pulse bg-stone-800 rounded h-10 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No suppliers found"
            description={
              hasFilters
                ? "Try adjusting your filters."
                : "Add your first supplier to get started."
            }
            action={
              !hasFilters ? (
                <button
                  onClick={() => setShowAdd(true)}
                  className="inline-flex items-center justify-center font-medium rounded-md transition-colors bg-violet-600 text-white hover:bg-violet-500 h-9 px-3.5 text-sm gap-2"
                >
                  <Plus size={15} />
                  Add Supplier
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-800 bg-stone-900/60">
                  {[
                    "Name",
                    "Code",
                    "Email",
                    "Currency",
                    "Terms",
                    "Status",
                    "Source",
                    "Last Synced",
                  ].map((h) => (
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
                {filtered.map((sup) => (
                  <tr
                    key={sup.id}
                    onClick={() => router.push(`/payables/suppliers/${sup.id}`)}
                    className="border-b border-stone-800 hover:bg-stone-800/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-white whitespace-nowrap">
                      {sup.name}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-stone-400">
                      {sup.code || "—"}
                    </td>
                    <td className="px-4 py-3 text-stone-300 text-xs max-w-[200px] truncate">
                      {sup.email || "—"}
                    </td>
                    <td className="px-4 py-3 text-stone-300 text-xs">
                      {sup.currency}
                    </td>
                    <td className="px-4 py-3 text-stone-300 text-xs">
                      {sup.paymentTerms != null ? `Net ${sup.paymentTerms}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={statusBadgeVariant(sup.status)}>
                        {sup.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={sourceBadgeVariant(sup.source)}>
                        {sup.source}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-stone-400 text-xs whitespace-nowrap">
                      {fmtDate(sup.lastSynced)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <AddSupplierModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onAdded={(sup) => setSuppliers((prev) => [sup, ...prev])}
      />
    </div>
  );
}
