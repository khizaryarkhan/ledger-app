"use client";

import { useState, useEffect } from "react";
import {
  AlertCircle,
  Plus,
  Loader2,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  GitBranch,
} from "lucide-react";
import { Badge, Button, Card, Input, Select, Modal, EmptyState } from "@/components/ui";

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
  approverName?: string;
  createdAt?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ENTITY_TYPES: EntityType[] = ["PR", "PO", "Bill", "PaymentRun"];

const ENTITY_LABELS: Record<EntityType, string> = {
  PR: "Purchase Request",
  PO: "Purchase Order",
  Bill: "Bill",
  PaymentRun: "Payment Run",
};

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
            options={ENTITY_TYPES.map((t) => ({
              value: t,
              label: ENTITY_LABELS[t],
            }))}
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
              <p className="text-[10px] text-stone-600 mt-1">
                Apply rule when amount exceeds this value.
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-400 mb-1.5">
                Supplier Type
              </label>
              <Input
                value={supplierType}
                onChange={(e: any) => setSupplierType(e.target.value)}
                placeholder="e.g. Contractor, Vendor"
                className="w-full"
              />
            </div>
          </div>
        </div>

        <div className="border-t border-stone-800 pt-4">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">
            Approval Steps
          </p>
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1.5">
              Approver Role / User
            </label>
            <Input
              value={approverRole}
              onChange={(e: any) => setApproverRole(e.target.value)}
              placeholder="e.g. Finance Manager, CFO"
              className="w-full"
            />
            <p className="text-[10px] text-stone-600 mt-1">
              The role or user responsible for approval at this step.
            </p>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Rule Card ─────────────────────────────────────────────────────────────────

interface RuleCardProps {
  rule: WorkflowRule;
  onEdit: (rule: WorkflowRule) => void;
  onDelete: (id: string) => void;
  onToggle: (rule: WorkflowRule) => void;
  deleting: boolean;
  toggling: boolean;
}

function RuleCard({
  rule,
  onEdit,
  onDelete,
  onToggle,
  deleting,
  toggling,
}: RuleCardProps) {
  const condParts: string[] = [];
  if (rule.thresholdAmount) {
    condParts.push(
      `Amount > ${new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(rule.thresholdAmount)}`
    );
  }
  if (rule.supplierType) condParts.push(`Supplier type: ${rule.supplierType}`);
  const condDisplay =
    condParts.length > 0
      ? condParts.join(" · ")
      : rule.conditionsSummary || "No conditions set";

  const stepsDisplay = rule.approverRole
    ? `1. ${rule.approverRole}`
    : rule.stepsSummary || "No steps configured";

  return (
    <Card className="flex gap-5">
      {/* Active indicator bar */}
      <div
        className={`w-1 rounded-full shrink-0 ${
          rule.active ? "bg-violet-500" : "bg-stone-700"
        }`}
      />

      <div className="flex-1 min-w-0">
        {/* Header row */}
        <div className="flex items-center gap-2.5 mb-2">
          <span className="text-sm font-semibold text-white">{rule.name}</span>
          <Badge variant={entityBadgeColor(rule.entityType)}>
            {ENTITY_LABELS[rule.entityType]}
          </Badge>
          <Badge variant={rule.active ? "green" : "neutral"}>
            {rule.active ? "Active" : "Inactive"}
          </Badge>
        </div>

        {/* Conditions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="bg-stone-800/60 rounded-md px-3 py-2">
            <p className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide mb-0.5">
              Conditions
            </p>
            <p className="text-xs text-stone-300">{condDisplay}</p>
          </div>
          <div className="bg-stone-800/60 rounded-md px-3 py-2">
            <p className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide mb-0.5">
              Approval Steps
            </p>
            <p className="text-xs text-stone-300">{stepsDisplay}</p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col items-end justify-between shrink-0 gap-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onToggle(rule)}
            disabled={toggling}
            className={`p-1.5 rounded-md transition-colors ${
              rule.active
                ? "text-violet-400 hover:bg-violet-500/10"
                : "text-stone-600 hover:text-stone-300 hover:bg-stone-800"
            } disabled:opacity-50`}
            title={rule.active ? "Deactivate" : "Activate"}
          >
            {toggling ? (
              <Loader2 size={18} className="animate-spin" />
            ) : rule.active ? (
              <ToggleRight size={22} />
            ) : (
              <ToggleLeft size={22} />
            )}
          </button>
          <button
            onClick={() => onEdit(rule)}
            className="p-1.5 rounded-md text-stone-400 hover:text-white hover:bg-stone-800 transition-colors"
            title="Edit"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={() => onDelete(rule.id)}
            disabled={deleting}
            className="p-1.5 rounded-md text-stone-600 hover:text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
            title="Delete"
          >
            {deleting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Trash2 size={14} />
            )}
          </button>
        </div>
      </div>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function WorkflowRulesPage() {
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
    setError(null);
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
    setError(null);
    try {
      const res = await fetch(`/api/payables/workflow-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !rule.active }),
      });
      if (!res.ok) throw new Error("Failed to update rule");
      setRules((prev) =>
        prev.map((r) =>
          r.id === rule.id ? { ...r, active: !r.active } : r
        )
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setToggling(null);
    }
  }

  const activeCount = rules.filter((r) => r.active).length;

  return (
    <div className="p-6 max-w-[1000px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">
            Workflow Rules
          </h1>
          {!loading && rules.length > 0 && (
            <p className="text-sm text-stone-500 mt-1">
              {rules.length} rule{rules.length !== 1 ? "s" : ""} ·{" "}
              {activeCount} active
            </p>
          )}
        </div>
        <button
          onClick={() => setRuleModal({ open: true, rule: null })}
          className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors"
        >
          <Plus size={15} />
          Add Rule
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-sm">
          <AlertCircle size={14} /> {error}
          <button
            onClick={load}
            className="ml-auto text-rose-300 hover:text-white underline text-xs"
          >
            Retry
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : rules.length === 0 ? (
        <EmptyState
          icon={GitBranch}
          title="No workflow rules"
          description="Create rules to automatically route approvals based on entity type, amount thresholds, and supplier type."
          action={
            <button
              onClick={() => setRuleModal({ open: true, rule: null })}
              className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors"
            >
              <Plus size={14} />
              Add First Rule
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {/* Active rules first */}
          {rules
            .slice()
            .sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0))
            .map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                onEdit={(r) => setRuleModal({ open: true, rule: r })}
                onDelete={handleDelete}
                onToggle={handleToggle}
                deleting={deleting === rule.id}
                toggling={toggling === rule.id}
              />
            ))}
        </div>
      )}

      {/* Rule Modal */}
      <RuleModal
        open={ruleModal.open}
        rule={ruleModal.rule}
        onClose={() => setRuleModal({ open: false, rule: null })}
        onSave={handleSave}
      />
    </div>
  );
}
