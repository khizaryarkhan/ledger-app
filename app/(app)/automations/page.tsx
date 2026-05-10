"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useData } from "@/components/data-provider";
import { Card, Badge } from "@/components/ui";
import {
  Zap, Mail, Clock, AlertOctagon, Search, AlertTriangle,
  Info, CheckCircle, Users, Briefcase, Check, Minus,
} from "lucide-react";

// ─────────────────────────────────────────────
// AUTOMATION RULES
// ─────────────────────────────────────────────
const RULES = [
  { name: "Pre-due reminder",        trigger: "3 days before due date",  action: "Send 'Friendly reminder' template — open invoices attached"     },
  { name: "First overdue notice",    trigger: "1 day after due date",    action: "Send 'First overdue' template — open invoices attached"           },
  { name: "Second overdue notice",   trigger: "8 days after due date",   action: "Send 'Second overdue' template — open invoices attached"          },
  { name: "Final notice",            trigger: "21 days after due date",  action: "Send 'Final notice' template, escalate — open invoices attached"  },
  { name: "Auto-escalate (30 days)", trigger: "30+ days overdue",        action: "Move stage to Escalated"                                          },
  { name: "Pause on dispute",        trigger: "Stage = Disputed",        action: "Pause all reminders"                                              },
  { name: "Pause on promise",        trigger: "Stage = Promise to Pay",  action: "Pause until promise date"                                         },
];

// ─────────────────────────────────────────────
// REMINDER PROGRAMME TAB
// ─────────────────────────────────────────────
function ReminderProgramme() {
  const { customers, projects, contacts, invoices, orgSettings, refresh, toast } = useData() as any;

  const [search, setSearch]       = useState("");
  const [saving, setSaving]       = useState<Record<string, boolean>>({});
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"Active" | "Inactive" | "On Hold" | "All">("Active");
  const [viewLevel, setViewLevel] = useState<"customer" | "project">(
    orgSettings?.classificationLevel ?? "customer"
  );

  // Per-entity local email values (editable directly)
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [emailDirty, setEmailDirty] = useState<Set<string>>(new Set());

  const isProjectLevel = viewLevel === "project";

  // By Customer → only customers NOT flagged chaseByProject
  // By Project  → only projects whose parent customer IS flagged chaseByProject
  const entities: any[] = isProjectLevel
    ? (projects ?? []).filter((p: any) => {
        const cust = (customers ?? []).find((c: any) => c.id === p.customerId);
        return cust?.chaseByProject === true;
      })
    : (customers ?? []).filter((c: any) => !c.chaseByProject);

  // Initialise email inputs from active contacts (only if not dirty)
  useEffect(() => {
    setEmails((prev) => {
      const next = { ...prev };
      entities.forEach((entity) => {
        if (!emailDirty.has(entity.id)) {
          const active = (contacts ?? []).find((c: any) =>
            (isProjectLevel ? c.projectId === entity.id : c.customerId === entity.id) && c.receivesAuto
          );
          // If no project-specific auto contact, fall back to customer-level
          const fallback = !isProjectLevel
            ? null
            : (contacts ?? []).find((c: any) => c.customerId === entity.customerId && !c.projectId && c.receivesAuto);
          next[entity.id] = active?.email ?? fallback?.email ?? "";
        }
      });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, isProjectLevel]);

  // ── Derived row data ──────────────────────────
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entities
      .filter((e) => !q || e.name.toLowerCase().includes(q) || (e.code ?? "").toLowerCase().includes(q))
      .map((entity) => {
        const entityContacts = (contacts ?? []).filter((c: any) =>
          isProjectLevel ? c.projectId === entity.id : c.customerId === entity.id
        );
        const activeContact = entityContacts.find((c: any) => c.receivesAuto) ?? null;
        const isOn = !!activeContact && !!activeContact.email;
        const localEmail = emails[entity.id] ?? "";
        const isDirty = emailDirty.has(entity.id);

        // Count open invoices with balance > 0 for this entity (CMs excluded — negative total fails > 0)
        const openInvoices = (invoices ?? []).filter((inv: any) => {
          const matchesEntity = isProjectLevel
            ? inv.projectId === entity.id
            : inv.customerId === entity.id;
          return matchesEntity
            && inv.txnType !== "CreditMemo"
            && inv.paymentStatus !== "Paid"
            && inv.paymentStatus !== "Written Off"
            && (inv.total - (inv.paid || 0)) > 0;
        });

        // Compute outstanding and effectiveStatus (same logic as Customers / Projects pages)
        const outstanding = openInvoices.reduce(
          (sum: number, inv: any) => sum + (inv.total - (inv.paid || 0)), 0
        );
        const effectiveStatus: "Active" | "Inactive" | "On Hold" =
          entity.status === "On Hold" ? "On Hold" : outstanding > 0 ? "Active" : "Inactive";

        return { entity, entityContacts, activeContact, isOn, localEmail, isDirty, openInvoices, outstanding, effectiveStatus };
      })
      .filter((r) => statusFilter === "All" || r.effectiveStatus === statusFilter)
      .sort((a, b) => a.entity.name.localeCompare(b.entity.name));
  }, [entities, contacts, emails, emailDirty, search, isProjectLevel, invoices, statusFilter]);

  const onCount  = rows.filter((r) => r.isOn).length;
  const offCount = rows.filter((r) => !r.isOn).length;
  const noEmailCount = rows.filter((r) => !r.localEmail).length;

  // ── API helpers ──────────────────────────────
  const patchContact = useCallback(async (contactId: string, data: any) => {
    const res = await fetch(`/api/contacts/${contactId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to update contact");
    return res.json();
  }, []);

  const createContact = useCallback(async (entity: any, email: string) => {
    const body: any = {
      customerId: isProjectLevel ? entity.customerId : entity.id,
      name: entity.name,
      email,
      type: "Billing",
      isPrimary: false,
      receivesAuto: true,
    };
    if (isProjectLevel) body.projectId = entity.id;
    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Failed to create contact");
    return res.json();
  }, [isProjectLevel]);

  // Save the email for an entity (create or update contact)
  const validateEmails = (value: string) => {
    const parts = value.split(",").map((e) => e.trim()).filter(Boolean);
    if (parts.length === 0) return false;
    return parts.every((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  };

  const saveEmail = useCallback(
    async (entity: any, email: string, row: typeof rows[0]) => {
      if (!email.trim() || !validateEmails(email)) {
        toast("Please enter a valid email address (comma-separate multiple)", "error");
        return;
      }
      setSaving((p) => ({ ...p, [entity.id]: true }));
      try {
        if (row.activeContact) {
          await patchContact(row.activeContact.id, { email: email.trim(), receivesAuto: true });
        } else if (row.entityContacts.length > 0) {
          // Update an existing non-auto contact and enable it
          const target =
            row.entityContacts.find((c: any) => c.type === "Billing") ??
            row.entityContacts[0];
          await patchContact(target.id, { email: email.trim(), receivesAuto: true });
        } else {
          // No contact yet — create one
          await createContact(entity, email.trim());
        }
        setEmailDirty((prev) => { const s = new Set(prev); s.delete(entity.id); return s; });
        await refresh();
        toast("Email saved");
      } catch {
        toast("Failed to save email", "error");
      } finally {
        setSaving((p) => ({ ...p, [entity.id]: false }));
      }
    },
    [patchContact, createContact, refresh, toast]
  );

  // Toggle programme ON / OFF
  const handleToggle = useCallback(
    async (entity: any, row: typeof rows[0], turnOn: boolean) => {
      // If turning ON and email in input but not yet saved → save first
      const email = emails[entity.id]?.trim() ?? "";
      if (turnOn && !row.activeContact && !email) {
        toast("Enter an email address first", "error");
        return;
      }
      if (turnOn && email && !validateEmails(email)) {
        toast("One or more email addresses are invalid", "error");
        return;
      }
      setSaving((p) => ({ ...p, [entity.id]: true }));
      try {
        if (!turnOn) {
          await Promise.all(
            row.entityContacts
              .filter((c: any) => c.receivesAuto)
              .map((c: any) => patchContact(c.id, { receivesAuto: false }))
          );
        } else {
          if (row.activeContact) {
            await patchContact(row.activeContact.id, { receivesAuto: true });
          } else if (email) {
            // Save the email then turn on
            if (row.entityContacts.length > 0) {
              const target =
                row.entityContacts.find((c: any) => c.type === "Billing") ?? row.entityContacts[0];
              await patchContact(target.id, { email, receivesAuto: true });
            } else {
              await createContact(entity, email);
            }
            setEmailDirty((prev) => { const s = new Set(prev); s.delete(entity.id); return s; });
          }
        }
        await refresh();
      } catch {
        toast("Failed to update programme", "error");
      } finally {
        setSaving((p) => ({ ...p, [entity.id]: false }));
      }
    },
    [emails, patchContact, createContact, refresh, toast]
  );

  // ── Batch actions ──────────────────────────────
  const allSelected  = rows.length > 0 && rows.every((r) => selected.has(r.entity.id));
  const someSelected = rows.some((r) => selected.has(r.entity.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.entity.id)));
    }
  };

  const handleBulk = useCallback(
    async (turnOn: boolean) => {
      const targets = rows.filter((r) => selected.has(r.entity.id));
      if (targets.length === 0) return;

      // Validate: turning ON requires an email
      if (turnOn) {
        const missing = targets.filter((r) => !r.localEmail.trim());
        if (missing.length > 0) {
          toast(`${missing.length} ${missing.length === 1 ? "row has" : "rows have"} no email — enter emails first`, "error");
          return;
        }
      }

      setBulkSaving(true);
      try {
        await Promise.all(
          targets.map(async (r) => {
            if (!turnOn) {
              return Promise.all(
                r.entityContacts
                  .filter((c: any) => c.receivesAuto)
                  .map((c: any) => patchContact(c.id, { receivesAuto: false }))
              );
            } else {
              const email = r.localEmail.trim();
              if (r.activeContact) {
                return patchContact(r.activeContact.id, { receivesAuto: true, email });
              } else if (r.entityContacts.length > 0) {
                const target =
                  r.entityContacts.find((c: any) => c.type === "Billing") ?? r.entityContacts[0];
                return patchContact(target.id, { receivesAuto: true, email });
              } else {
                return createContact(r.entity, email);
              }
            }
          })
        );
        await refresh();
        toast(`${targets.length} ${turnOn ? "turned ON" : "turned OFF"}`);
        setSelected(new Set());
      } catch {
        toast("Bulk update failed", "error");
      } finally {
        setBulkSaving(false);
      }
    },
    [rows, selected, patchContact, createContact, refresh, toast]
  );

  return (
    <div className="space-y-4">
      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Programme ON",   value: onCount,      color: "text-emerald-600" },
          { label: "Programme OFF",  value: offCount,     color: "text-stone-500"   },
          { label: "No email set",   value: noEmailCount, color: "text-amber-600"   },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-lg ring-1 ring-stone-200 px-4 py-3 text-center">
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
            <div className="text-[11px] text-stone-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Level toggle */}
        <div className="flex items-center gap-1 bg-stone-100 rounded-lg p-1">
            <button onClick={() => { setViewLevel("customer"); setSelected(new Set()); setStatusFilter("Active"); }}
            title="Customers chased at account level"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${viewLevel === "customer" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800"}`}>
            <Users size={12} /> By Customer
          </button>
          <button onClick={() => { setViewLevel("project"); setSelected(new Set()); setStatusFilter("Active"); }}
            title="Projects for customers flagged 'Chase by Project'"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${viewLevel === "project" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800"}`}>
            <Briefcase size={12} /> By Project
          </button>
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as any); setSelected(new Set()); }}
          className="h-9 px-2.5 pr-7 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none bg-white text-stone-700"
        >
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
          <option value="On Hold">On Hold</option>
          <option value="All">All statuses</option>
        </select>

        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${isProjectLevel ? "projects" : "customers"}…`}
            className="w-full h-9 pl-8 pr-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none bg-white" />
        </div>

        <div className="ml-auto text-[11px] text-stone-400">{rows.length} {isProjectLevel ? "projects" : "customers"}</div>
      </div>

      {/* Bulk action bar */}
      {someSelected && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-stone-900 text-white rounded-lg">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => handleBulk(true)}
              disabled={bulkSaving}
              className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
            >
              Turn ON ({selected.size})
            </button>
            <button
              onClick={() => handleBulk(false)}
              disabled={bulkSaving}
              className="px-3 py-1.5 bg-stone-700 hover:bg-stone-600 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
            >
              Turn OFF ({selected.size})
            </button>
            <button onClick={() => setSelected(new Set())}
              className="px-2 py-1.5 text-stone-400 hover:text-white text-sm rounded-md transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <Card padding="none">
        {/* Header */}
        <div className="grid grid-cols-[40px_1fr_90px_110px_2fr_130px] gap-3 px-4 py-2.5 border-b border-stone-200 bg-stone-50">
          {/* Select all */}
          <div className="flex items-center justify-center">
            <button
              onClick={toggleSelectAll}
              className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                allSelected
                  ? "bg-stone-900 border-stone-900"
                  : someSelected
                  ? "bg-stone-400 border-stone-400"
                  : "border-stone-300 hover:border-stone-500"
              }`}
            >
              {allSelected && <Check size={10} className="text-white" strokeWidth={3} />}
              {someSelected && !allSelected && <Minus size={10} className="text-white" strokeWidth={3} />}
            </button>
          </div>
          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">
            {isProjectLevel ? "Project" : "Customer"}
          </div>
          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">
            Status
          </div>
          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider text-right">
            Outstanding
          </div>
          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">
            Reminder Email
          </div>
          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider text-center">
            Programme
          </div>
        </div>

        {rows.length === 0 && (
          <div className="py-12 text-center text-sm text-stone-500">
            {search
              ? "No results match your search"
              : isProjectLevel
              ? <span>No projects set to per-project chasing.<br /><span className="text-[11px] text-stone-400">Open a customer and enable <strong className="text-stone-500">Chase by Project</strong> to see their projects here.</span></span>
              : "No customers found"}
          </div>
        )}

        {rows.map(({ entity, entityContacts, activeContact, isOn, localEmail, isDirty, openInvoices, outstanding, effectiveStatus }) => {
          const isSaving   = !!saving[entity.id] || bulkSaving;
          const isSelected = selected.has(entity.id);
          const emailVal   = emails[entity.id] ?? "";

          const statusBadge =
            effectiveStatus === "Active"   ? { label: "Active",   cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" } :
            effectiveStatus === "On Hold"  ? { label: "On Hold",  cls: "bg-amber-50 text-amber-700 ring-amber-200"       } :
                                             { label: "Inactive", cls: "bg-stone-100 text-stone-500 ring-stone-200"      };

          return (
            <div
              key={entity.id}
              className={`grid grid-cols-[40px_1fr_90px_110px_2fr_130px] gap-3 items-center px-4 py-3 border-b border-stone-100 last:border-0 transition-colors ${
                isSelected ? "bg-stone-50" : ""
              } ${isSaving ? "opacity-60" : ""}`}
            >
              {/* Checkbox */}
              <div className="flex items-center justify-center">
                <button
                  onClick={() => {
                    setSelected((prev) => {
                      const s = new Set(prev);
                      s.has(entity.id) ? s.delete(entity.id) : s.add(entity.id);
                      return s;
                    });
                  }}
                  className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                    isSelected
                      ? "bg-stone-900 border-stone-900"
                      : "border-stone-300 hover:border-stone-500"
                  }`}
                >
                  {isSelected && <Check size={10} className="text-white" strokeWidth={3} />}
                </button>
              </div>

              {/* Entity name */}
              <div className="min-w-0">
                <div className="text-sm font-medium text-stone-900 truncate">{entity.name}</div>
                {(entity.code || entity.invoiceNumber) && (
                  <div className="text-[11px] text-stone-400 font-mono">{entity.code}</div>
                )}
                {openInvoices.length > 0 && (
                  <div className="text-[10px] text-emerald-600 mt-0.5">
                    {openInvoices.length} open invoice{openInvoices.length !== 1 ? "s" : ""}
                  </div>
                )}
              </div>

              {/* Effective status badge */}
              <div>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ${statusBadge.cls}`}>
                  {statusBadge.label}
                </span>
              </div>

              {/* Outstanding */}
              <div className="text-right tabular-nums">
                {outstanding > 0 ? (
                  <span className="text-sm font-semibold text-stone-900">
                    {new Intl.NumberFormat(undefined, { style: "currency", currency: orgSettings?.currency ?? "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(outstanding)}
                  </span>
                ) : (
                  <span className="text-[11px] text-stone-400">—</span>
                )}
              </div>

              {/* Email input */}
              <div className="flex items-center gap-2 min-w-0">
                <div className="relative flex-1 min-w-0">
                  <input
                    type="text"
                    value={emailVal}
                    disabled={isSaving}
                    placeholder="billing@customer.com, cc@customer.com"
                    onChange={(e) => {
                      const val = e.target.value;
                      setEmails((prev) => ({ ...prev, [entity.id]: val }));
                      setEmailDirty((prev) => {
                        const s = new Set(prev);
                        // Mark dirty only if value differs from saved contact email
                        if (val !== (activeContact?.email ?? "")) s.add(entity.id);
                        else s.delete(entity.id);
                        return s;
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEmail(entity, emailVal, { entity, entityContacts, activeContact, isOn, localEmail, isDirty, openInvoices });
                    }}
                    onBlur={() => {
                      if (isDirty && emailVal.trim()) {
                        saveEmail(entity, emailVal, { entity, entityContacts, activeContact, isOn, localEmail, isDirty, openInvoices });
                      }
                    }}
                    className={`w-full h-8 px-2.5 text-sm rounded-md ring-1 focus:ring-2 focus:ring-stone-900 focus:outline-none bg-white transition-colors ${
                      isDirty
                        ? "ring-amber-300 bg-amber-50"
                        : emailVal
                        ? "ring-stone-200"
                        : "ring-stone-200 placeholder:text-stone-300"
                    }`}
                  />
                  {isDirty && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-amber-600 font-medium pointer-events-none">
                      unsaved
                    </span>
                  )}
                </div>

                {/* Status icon */}
                {!emailVal ? (
                  <span title="No email set"><AlertTriangle size={14} className="text-amber-400 shrink-0" /></span>
                ) : isOn ? (
                  <span title="Programme active"><CheckCircle size={14} className="text-emerald-500 shrink-0" /></span>
                ) : (
                  <div className="w-3.5 h-3.5 shrink-0" />
                )}
              </div>

              {/* ON/OFF toggle + label */}
              <div className="flex items-center justify-center gap-2">
                <button
                  disabled={isSaving}
                  onClick={() => handleToggle(entity, { entity, entityContacts, activeContact, isOn, localEmail, isDirty, openInvoices }, !isOn)}
                  title={isOn ? "Click to turn off" : emailVal ? "Click to turn on" : "Enter email first"}
                  className={`relative w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none disabled:cursor-not-allowed ${
                    isOn ? "bg-emerald-500" : "bg-stone-200"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200 ${
                      isOn ? "translate-x-6" : "translate-x-0"
                    }`}
                  />
                </button>
                <span className={`text-[11px] font-semibold w-7 ${isOn ? "text-emerald-600" : "text-stone-400"}`}>
                  {isOn ? "ON" : "OFF"}
                </span>
              </div>
            </div>
          );
        })}
      </Card>

      {/* Footer note */}
      <div className="flex items-start gap-2 px-1 text-[12px] text-stone-400">
        <Info size={13} className="mt-0.5 shrink-0" />
        <span>
          Reminders are sent only for <strong className="text-stone-600">open invoices with an outstanding balance</strong>.
          Invoice PDFs are attached automatically. Invoices in Disputed or Promise to Pay stages are always skipped.
          Email subjects include the project/customer reference and invoice numbers.
          Type directly in the email field — it saves automatically on Enter or when you click away.
          <strong className="text-stone-600"> Multiple recipients supported</strong> — just separate addresses with a comma.
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────
export default function AutomationsPage() {
  const [tab, setTab] = useState<"rules" | "programme">("programme");

  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Automations</h1>
        <p className="text-sm text-stone-500 mt-1">Reminder rules and per-customer programme management</p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 border-b border-stone-200">
        {(["programme", "rules"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? "border-stone-900 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-900"
            }`}>
            {t === "programme" ? "Reminder Programme" : "Automation Rules"}
          </button>
        ))}
      </div>

      {tab === "programme" && <ReminderProgramme />}

      {tab === "rules" && (
        <div className="space-y-4">
          <Card className="bg-amber-50 ring-amber-200">
            <div className="flex items-start gap-3">
              <AlertOctagon size={18} className="text-amber-700 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-amber-900">
                <div className="font-medium mb-1">Email sending requires SMTP configuration</div>
                <div>
                  Rules are active but emails won't send until SMTP is configured in{" "}
                  <a href="/settings/notifications" className="underline font-medium">Settings → Notifications</a>.
                  The 30-day auto-escalation rule runs daily without SMTP.
                </div>
              </div>
            </div>
          </Card>

          <Card padding="none">
            <div className="px-4 py-3 border-b border-stone-200">
              <h3 className="text-sm font-semibold text-stone-900">Active rules</h3>
              <p className="text-[11px] text-stone-500 mt-0.5">
                Apply to all customers/projects with Reminder Programme ON · only open invoices with a balance are included
              </p>
            </div>
            {RULES.map((r, i) => (
              <div key={i} className="px-4 py-3 border-b border-stone-100 last:border-0 flex items-start gap-3">
                <div className="w-8 h-8 rounded-md bg-stone-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Zap size={14} className="text-stone-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <div className="text-sm font-medium text-stone-900">{r.name}</div>
                    <Badge variant="green" size="sm">Active</Badge>
                  </div>
                  <div className="text-xs text-stone-600 flex items-center gap-1.5">
                    <Clock size={11} className="text-stone-400" /> {r.trigger}
                  </div>
                  <div className="text-xs text-stone-600 flex items-center gap-1.5 mt-0.5">
                    <Mail size={11} className="text-stone-400" /> {r.action}
                  </div>
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
