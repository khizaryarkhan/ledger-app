"use client";

import { useState, useEffect } from "react";
import {
  AlertCircle,
  Loader2,
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  CheckCircle2,
  Database,
  Settings,
  GitBranch,
} from "lucide-react";
import { Badge, Button, Card, Input, Select, Modal } from "@/components/ui";

// ── Types ─────────────────────────────────────────────────────────────────────

type EntityType = "PR" | "PO" | "Bill" | "PaymentRun";

interface WorkflowRule {
  id: string;
  name: string;
  entityType: EntityType;
  active: boolean;
  conditionsSummary: string;
  stepsSummary: string;
  thresholdAmount?: number;
  supplierType?: string;
  approverRole?: string;
  approverId?: string;
  approverName?: string;
}

interface SyncStatus {
  entity: string;
  lastSyncAt?: string;
  count: number;
  status: "synced" | "pending" | "error";
}

interface GeneralSettings {
  defaultCurrency: string;
  defaultPaymentTerms: string;
  approvalThreshold: number;
  notifyOnNewBill: boolean;
  notifyOnApproval: boolean;
  notifyOnRejection: boolean;
  notifyOnPayment: boolean;
}

type SettingsTab = "general" | "workflow" | "sync";

const CURRENCIES = ["USD", "EUR", "GBP", "AUD", "CAD", "SGD", "AED"];
const PAYMENT_TERMS = [
  "Net 7",
  "Net 14",
  "Net 30",
  "Net 45",
  "Net 60",
  "Due on Receipt",
];
const ENTITY_TYPES: EntityType[] = ["PR", "PO", "Bill", "PaymentRun"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d?: string) {
  if (!d) return "Never";
  return new Date(d).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function entityBadgeColor(type: EntityType): string {
  const map: Record<EntityType, string> = {
    PR: "blue",
    PO: "purple",
    Bill: "orange",
    PaymentRun: "green",
  };
  return map[type];
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-stone-800 rounded ${className}`} />;
}

// ── Rule Modal ────────────────────────────────────────────────────────────────

interface RuleModalProps {
  open: boolean;
  rule: WorkflowRule | null;
  onClose: () => void;
  onSave: (data: Partial<WorkflowRule>) => Promise<void>;
}

function RuleModal({ open, rule, onClose, onSave }: RuleModalProps) {
  const [name, setName] = useState("");
  const [entityType, setEntityType] = useState<EntityType | "">("");
  const [threshold, setThreshold] = useState("");
  const [supplierType, setSupplierType] = useState("");
  const [approverRole, setApproverRole] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) {
      setName(rule?.name ?? "");
      setEntityType(rule?.entityType ?? "");
      setThreshold(rule?.thresholdAmount?.toString() ?? "");
      setSupplierType(rule?.supplierType ?? "");
      setApproverRole(rule?.approverRole ?? "");
      setErr("");
    }
  }, [open, rule]);

  async function handleSave() {
    if (!name.trim() || !entityType) {
      setErr("Name and Entity Type are required.");
      return;
    }
    setLoading(true);
    try {
      await onSave({
        name,
        entityType: entityType as EntityType,
        thresholdAmount: threshold ? parseFloat(threshold) : undefined,
        supplierType: supplierType || undefined,
        approverRole: approverRole || undefined,
      });
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={rule ? "Edit Workflow Rule" : "Add Workflow Rule"}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 size={14} className="animate-spin" />}
            {rule ? "Save Changes" : "Create Rule"}
          </Button>
        </>
      }
    >
      <div className="p-5 space-y-4">
        {err && (
          <div className="flex items-center gap-2 p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-md text-rose-400 text-xs">
            <AlertCircle size={13} /> {err}
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-stone-400 mb-1.5">
            Rule Name <span className="text-rose-400">*</span>
          </label>
          <Input
            value={name}
            onChange={(e: any) => setName(e.target.value)}
            placeholder="e.g. High-Value Bill Approval"
            className="w-full"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-400 mb-1.5">
            Entity Type <span className="text-rose-400">*</span>
          </label>
          <Select
            value={entityType}
            onChange={(e: any) => setEntityType(e.target.value)}
            placeholder="Select entity type"
            options={ENTITY_TYPES}
            className="w-full"
          />
        </div>
        <div className="border-t border-stone-800 pt-4">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">
            Conditions
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-stone-400 mb-1.5">
                Threshold Amount
              </label>
              <Input
                value={threshold}
                onChange={(e: any) => setThreshold(e.target.value)}
                type="number"
                placeholder="e.g. 5000"
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-400 mb-1.5">
                Supplier Type
              </label>
              <Input
                value={supplierType}
                onChange={(e: any) => setSupplierType(e.target.value)}
                placeholder="e.g. Contractor"
                className="w-full"
              />
            </div>
          </div>
        </div>
        <div className="border-t border-stone-800 pt-4">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">
            Approver
          </p>
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1.5">
              Approver Role / User
            </label>
            <Input
              value={approverRole}
              onChange={(e: any) => setApproverRole(e.target.value)}
              placeholder="e.g. Finance Manager"
              className="w-full"
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── General Tab ───────────────────────────────────────────────────────────────

function GeneralTab() {
  const [settings, setSettings] = useState<GeneralSettings>({
    defaultCurrency: "USD",
    defaultPaymentTerms: "Net 30",
    approvalThreshold: 5000,
    notifyOnNewBill: true,
    notifyOnApproval: true,
    notifyOnRejection: true,
    notifyOnPayment: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/payables/settings/general")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setSettings(d);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/payables/settings/general", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error("Failed to save settings");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function Toggle({
    checked,
    onChange,
    label,
    description,
  }: {
    checked: boolean;
    onChange: (v: boolean) => void;
    label: string;
    description?: string;
  }) {
    return (
      <div className="flex items-center justify-between py-3 border-b border-stone-800 last:border-0">
        <div>
          <p className="text-sm font-medium text-white">{label}</p>
          {description && (
            <p className="text-xs text-stone-400 mt-0.5">{description}</p>
          )}
        </div>
        <button
          onClick={() => onChange(!checked)}
          className={`transition-colors ${
            checked ? "text-violet-400" : "text-stone-600"
          }`}
        >
          {checked ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-2xl">
      {error && (
        <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-sm">
          <AlertCircle size={14} /> {error}
        </div>
      )}
      {saved && (
        <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400 text-sm">
          <CheckCircle2 size={14} /> Settings saved successfully.
        </div>
      )}

      <Card>
        <h3 className="text-sm font-semibold text-white mb-4">
          Defaults
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1.5">
              Default Currency
            </label>
            <Select
              value={settings.defaultCurrency}
              onChange={(e: any) =>
                setSettings((s) => ({ ...s, defaultCurrency: e.target.value }))
              }
              options={CURRENCIES}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1.5">
              Default Payment Terms
            </label>
            <Select
              value={settings.defaultPaymentTerms}
              onChange={(e: any) =>
                setSettings((s) => ({
                  ...s,
                  defaultPaymentTerms: e.target.value,
                }))
              }
              options={PAYMENT_TERMS}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1.5">
              Approval Required Threshold
            </label>
            <div className="flex items-center gap-2">
              <span className="text-stone-400 text-sm">
                {settings.defaultCurrency}
              </span>
              <Input
                value={settings.approvalThreshold}
                onChange={(e: any) =>
                  setSettings((s) => ({
                    ...s,
                    approvalThreshold: parseFloat(e.target.value) || 0,
                  }))
                }
                type="number"
                placeholder="5000"
                className="w-40"
              />
            </div>
            <p className="text-xs text-stone-500 mt-1">
              Bills above this amount require approval before payment.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-white mb-2">
          Email Notifications
        </h3>
        <Toggle
          checked={settings.notifyOnNewBill}
          onChange={(v) => setSettings((s) => ({ ...s, notifyOnNewBill: v }))}
          label="New Bill Received"
          description="Notify when a new bill is imported from accounting."
        />
        <Toggle
          checked={settings.notifyOnApproval}
          onChange={(v) =>
            setSettings((s) => ({ ...s, notifyOnApproval: v }))
          }
          label="Approval Required"
          description="Notify approvers when items need their review."
        />
        <Toggle
          checked={settings.notifyOnRejection}
          onChange={(v) =>
            setSettings((s) => ({ ...s, notifyOnRejection: v }))
          }
          label="Item Rejected"
          description="Notify requesters when their submission is rejected."
        />
        <Toggle
          checked={settings.notifyOnPayment}
          onChange={(v) =>
            setSettings((s) => ({ ...s, notifyOnPayment: v }))
          }
          label="Payment Processed"
          description="Notify when a payment run is posted."
        />
      </Card>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          Save Settings
        </button>
      </div>
    </div>
  );
}

// ── Workflow Rules Tab ────────────────────────────────────────────────────────

function WorkflowRulesTab() {
  const [rules, setRules] = useState<WorkflowRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ruleModal, setRuleModal] = useState<{
    open: boolean;
    rule: WorkflowRule | null;
  }>({ open: false, rule: null });
  const [deleting, setDeleting] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/workflow-rules");
      if (!res.ok) throw new Error("Failed to load workflow rules");
      const data = await res.json();
      setRules(Array.isArray(data) ? data : data.rules ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSave(data: Partial<WorkflowRule>) {
    const rule = ruleModal.rule;
    const url = rule
      ? `/api/payables/workflow-rules/${rule.id}`
      : "/api/payables/workflow-rules";
    const method = rule ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to save rule");
    await load();
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      const res = await fetch(`/api/payables/workflow-rules/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete rule");
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeleting(null);
    }
  }

  async function handleToggle(rule: WorkflowRule) {
    setToggling(rule.id);
    try {
      const res = await fetch(`/api/payables/workflow-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !rule.active }),
      });
      if (!res.ok) throw new Error("Failed to update rule");
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, active: !r.active } : r))
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setToggling(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {error && (
        <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-sm">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={() => setRuleModal({ open: true, rule: null })}
          className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors"
        >
          <Plus size={15} />
          Add Rule
        </button>
      </div>

      {rules.length === 0 ? (
        <Card>
          <p className="text-center text-stone-500 text-sm py-6">
            No workflow rules configured. Add one to automate approvals.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <Card key={rule.id} className="flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-white text-sm">
                    {rule.name}
                  </span>
                  <Badge variant={entityBadgeColor(rule.entityType)}>
                    {rule.entityType}
                  </Badge>
                  <Badge variant={rule.active ? "green" : "neutral"}>
                    {rule.active ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <p className="text-xs text-stone-400">
                  Conditions: {rule.conditionsSummary || "None"}
                </p>
                <p className="text-xs text-stone-400">
                  Steps: {rule.stepsSummary || "None"}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => handleToggle(rule)}
                  disabled={toggling === rule.id}
                  className={`p-1.5 rounded-md transition-colors ${
                    rule.active
                      ? "text-violet-400 hover:bg-violet-500/10"
                      : "text-stone-600 hover:text-stone-300 hover:bg-stone-800"
                  }`}
                >
                  {toggling === rule.id ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : rule.active ? (
                    <ToggleRight size={20} />
                  ) : (
                    <ToggleLeft size={20} />
                  )}
                </button>
                <button
                  onClick={() => setRuleModal({ open: true, rule })}
                  className="p-1.5 rounded-md text-stone-400 hover:text-white hover:bg-stone-800 transition-colors"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => handleDelete(rule.id)}
                  disabled={deleting === rule.id}
                  className="p-1.5 rounded-md text-stone-600 hover:text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
                >
                  {deleting === rule.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <RuleModal
        open={ruleModal.open}
        rule={ruleModal.rule}
        onClose={() => setRuleModal({ open: false, rule: null })}
        onSave={handleSave}
      />
    </div>
  );
}

// ── Sync Tab ──────────────────────────────────────────────────────────────────

function SyncTab() {
  const [syncStatuses, setSyncStatuses] = useState<SyncStatus[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | undefined>(undefined);

  useEffect(() => {
    fetch("/api/payables/settings/sync-status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setSyncStatuses(d.statuses ?? []);
          setLastSync(d.lastSyncAt);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/sync-master-data", {
        method: "POST",
      });
      if (!res.ok) throw new Error("Sync failed");
      const data = await res.json();
      setSyncStatuses(data.statuses ?? []);
      setLastSync(data.lastSyncAt);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  }

  const ENTITIES = [
    "Suppliers",
    "Chart of Accounts",
    "Items",
    "Tax Rates",
    "Dimensions",
  ];

  return (
    <div className="space-y-5 max-w-2xl">
      {error && (
        <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-sm">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Master Data Sync</h3>
            <p className="text-xs text-stone-400 mt-0.5">
              Last synced: {fmtDate(lastSync)}
            </p>
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50"
          >
            {syncing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Sync Master Data from Accounting
          </button>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <div className="divide-y divide-stone-800">
            {ENTITIES.map((entity) => {
              const status = syncStatuses.find((s) => s.entity === entity) ?? {
                entity,
                count: 0,
                status: "pending" as const,
              };
              return (
                <div
                  key={entity}
                  className="flex items-center justify-between py-3"
                >
                  <div className="flex items-center gap-2.5">
                    <Database size={14} className="text-stone-500" />
                    <span className="text-sm text-white font-medium">
                      {entity}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {status.lastSyncAt && (
                      <span className="text-xs text-stone-500">
                        {fmtDate(status.lastSyncAt)}
                      </span>
                    )}
                    {status.count > 0 && (
                      <span className="text-xs text-stone-400 tabular-nums">
                        {status.count.toLocaleString()} records
                      </span>
                    )}
                    <Badge
                      variant={
                        status.status === "synced"
                          ? "green"
                          : status.status === "error"
                          ? "red"
                          : "neutral"
                      }
                    >
                      {status.status === "synced"
                        ? "Synced"
                        : status.status === "error"
                        ? "Error"
                        : "Pending"}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const TABS: { id: SettingsTab; label: string; icon: any }[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "workflow", label: "Workflow Rules", icon: GitBranch },
  { id: "sync", label: "Sync", icon: RefreshCw },
];

export default function APSettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-white tracking-tight">
          AP Settings
        </h1>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-stone-800">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                active
                  ? "border-violet-500 text-violet-400"
                  : "border-transparent text-stone-400 hover:text-stone-200"
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          );
        })}
      </div>

      {activeTab === "general" && <GeneralTab />}
      {activeTab === "workflow" && <WorkflowRulesTab />}
      {activeTab === "sync" && <SyncTab />}
    </div>
  );
}
