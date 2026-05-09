"use client";

import { useState, useMemo, useCallback } from "react";
import { useData } from "@/components/data-provider";
import { Card, Badge } from "@/components/ui";
import {
  Zap, Mail, Clock, AlertOctagon, Search, AlertTriangle,
  Info, CheckCircle, Users, Briefcase,
} from "lucide-react";

// ─────────────────────────────────────────────
// AUTOMATION RULES (existing content)
// ─────────────────────────────────────────────
const RULES = [
  { name: "Pre-due reminder",        trigger: "3 days before due date",  action: "Send 'Friendly reminder' template",      status: "active" },
  { name: "First overdue notice",    trigger: "1 day after due date",    action: "Send 'First overdue' template",           status: "active" },
  { name: "Second overdue notice",   trigger: "8 days after due date",   action: "Send 'Second overdue' template",          status: "active" },
  { name: "Final notice",            trigger: "21 days after due date",  action: "Send 'Final notice' template, escalate",  status: "active" },
  { name: "Auto-escalate (30 days)", trigger: "30+ days overdue",        action: "Move stage to Escalated",                 status: "active" },
  { name: "Pause on dispute",        trigger: "Stage = Disputed",        action: "Pause all reminders",                     status: "active" },
  { name: "Pause on promise",        trigger: "Stage = Promise to Pay",  action: "Pause until promise date",               status: "active" },
];

// ─────────────────────────────────────────────
// REMINDER PROGRAMME TAB
// ─────────────────────────────────────────────
function ReminderProgramme() {
  const { customers, projects, contacts, orgSettings, refresh, toast } = useData();
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  // Allow user to override view independently of org default
  const [viewLevel, setViewLevel] = useState<"customer" | "project">(
    orgSettings.classificationLevel ?? "customer"
  );

  const isProjectLevel = viewLevel === "project";
  const entities: any[] = isProjectLevel ? projects : customers;

  // For each entity: gather its contacts (with email), find active reminder contact
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entities
      .filter((e) => !q || e.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entity) => {
        const entityContacts = contacts
          .filter((c: any) =>
            isProjectLevel ? c.projectId === entity.id : c.customerId === entity.id
          )
          .filter((c: any) => c.email); // only contacts with an email address

        const activeContact = entityContacts.find((c: any) => c.receivesAuto) ?? null;
        const isOn = !!activeContact;

        return { entity, entityContacts, activeContact, isOn };
      });
  }, [entities, contacts, search, isProjectLevel]);

  // ── API helpers ──────────────────────────────
  const patchContact = useCallback(async (contactId: string, data: any) => {
    await fetch(`/api/contacts/${contactId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }, []);

  // Select a new reminder contact for an entity
  const handleContactChange = useCallback(
    async (entityId: string, oldContactId: string | null, newContactId: string) => {
      setSaving((p) => ({ ...p, [entityId]: true }));
      try {
        if (oldContactId && oldContactId !== newContactId) {
          await patchContact(oldContactId, { receivesAuto: false });
        }
        await patchContact(newContactId, { receivesAuto: true });
        await refresh();
      } catch {
        toast("Failed to update contact", "error");
      } finally {
        setSaving((p) => ({ ...p, [entityId]: false }));
      }
    },
    [patchContact, refresh, toast]
  );

  // Toggle programme ON / OFF
  const handleToggle = useCallback(
    async (entityId: string, entityContacts: any[], activeContact: any | null, turnOn: boolean) => {
      if (turnOn && entityContacts.length === 0) {
        toast("Add a contact with an email address first", "error");
        return;
      }
      setSaving((p) => ({ ...p, [entityId]: true }));
      try {
        if (!turnOn) {
          // Turn OFF: clear receivesAuto on all contacts for this entity
          await Promise.all(
            entityContacts
              .filter((c: any) => c.receivesAuto)
              .map((c: any) => patchContact(c.id, { receivesAuto: false }))
          );
        } else {
          // Turn ON: pick best available contact
          const target =
            entityContacts.find((c: any) => c.isPrimary) ??
            entityContacts.find((c: any) => c.type === "Billing") ??
            entityContacts[0];
          await patchContact(target.id, { receivesAuto: true });
        }
        await refresh();
      } catch {
        toast("Failed to update programme", "error");
      } finally {
        setSaving((p) => ({ ...p, [entityId]: false }));
      }
    },
    [patchContact, refresh, toast]
  );

  const onCount  = rows.filter((r) => r.isOn).length;
  const offCount = rows.filter((r) => !r.isOn).length;
  const noContactCount = rows.filter((r) => r.entityContacts.length === 0).length;

  return (
    <div className="space-y-4">
      {/* Summary KPIs */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Programme ON",         value: onCount,        color: "text-emerald-600" },
          { label: "Programme OFF",         value: offCount,       color: "text-stone-500"   },
          { label: "No email contact",      value: noContactCount, color: "text-amber-600"   },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-lg ring-1 ring-stone-200 px-4 py-3 text-center">
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
            <div className="text-[11px] text-stone-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-3">
        {/* Level toggle */}
        <div className="flex items-center gap-1 bg-stone-100 rounded-lg p-1">
          <button
            onClick={() => setViewLevel("customer")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
              viewLevel === "customer"
                ? "bg-white text-stone-900 shadow-sm"
                : "text-stone-500 hover:text-stone-800"
            }`}
          >
            <Users size={12} /> By Customer
          </button>
          <button
            onClick={() => setViewLevel("project")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
              viewLevel === "project"
                ? "bg-white text-stone-900 shadow-sm"
                : "text-stone-500 hover:text-stone-800"
            }`}
          >
            <Briefcase size={12} /> By Project
          </button>
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${isProjectLevel ? "projects" : "customers"}…`}
            className="w-full h-9 pl-8 pr-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none bg-white"
          />
        </div>

        <div className="ml-auto text-[11px] text-stone-400">
          {rows.length} {isProjectLevel ? "projects" : "customers"}
        </div>
      </div>

      {/* Table */}
      <Card padding="none">
        {/* Header */}
        <div className="grid grid-cols-[1fr_2fr_140px] gap-4 px-4 py-2.5 border-b border-stone-200 bg-stone-50">
          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">
            {isProjectLevel ? "Project" : "Customer"}
          </div>
          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">
            Reminder Contact &amp; Email
          </div>
          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider text-center">
            Programme
          </div>
        </div>

        {rows.length === 0 && (
          <div className="py-12 text-center text-sm text-stone-500">
            {search ? "No results match your search" : `No ${isProjectLevel ? "projects" : "customers"} found`}
          </div>
        )}

        {rows.map(({ entity, entityContacts, activeContact, isOn }) => {
          const isSaving = !!saving[entity.id];
          const hasNoContacts = entityContacts.length === 0;

          return (
            <div
              key={entity.id}
              className={`grid grid-cols-[1fr_2fr_140px] gap-4 items-center px-4 py-3 border-b border-stone-100 last:border-0 transition-colors ${
                isSaving ? "opacity-60" : ""
              }`}
            >
              {/* Entity name */}
              <div className="min-w-0">
                <div className="text-sm font-medium text-stone-900 truncate">{entity.name}</div>
                {entity.code && (
                  <div className="text-[11px] text-stone-400 font-mono">{entity.code}</div>
                )}
              </div>

              {/* Contact selector */}
              <div className="flex items-center gap-2 min-w-0">
                {hasNoContacts ? (
                  <div className="flex items-center gap-1.5 text-[12px] text-amber-600">
                    <AlertTriangle size={12} />
                    <span>No contact with email — add one in customer profile</span>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <select
                        value={activeContact?.id ?? ""}
                        disabled={isSaving}
                        onChange={(e) => {
                          if (e.target.value) {
                            handleContactChange(entity.id, activeContact?.id ?? null, e.target.value);
                          }
                        }}
                        className="w-full h-8 px-2 text-sm rounded-md ring-1 ring-stone-200 bg-white focus:ring-2 focus:ring-stone-900 focus:outline-none appearance-none cursor-pointer disabled:opacity-50"
                        style={{
                          backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                          backgroundPosition: "right 0.5rem center",
                          backgroundSize: "12px",
                          paddingRight: "1.75rem",
                        }}
                      >
                        <option value="">Select contact…</option>
                        {entityContacts.map((c: any) => (
                          <option key={c.id} value={c.id}>
                            {c.name}{c.title ? ` (${c.title})` : ""} — {c.email}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Status icon */}
                    {activeContact ? (
                      <CheckCircle size={14} className="text-emerald-500 shrink-0" />
                    ) : (
                      <AlertTriangle size={14} className="text-amber-400 shrink-0" title="No contact selected — programme will not send" />
                    )}
                  </>
                )}
              </div>

              {/* ON/OFF toggle */}
              <div className="flex items-center justify-center gap-2">
                <button
                  disabled={isSaving || (hasNoContacts && !isOn)}
                  onClick={() => handleToggle(entity.id, entityContacts, activeContact, !isOn)}
                  className={`relative w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none disabled:cursor-not-allowed ${
                    isOn ? "bg-emerald-500" : "bg-stone-200"
                  }`}
                  title={
                    hasNoContacts
                      ? "Add a contact first"
                      : isOn
                      ? "Click to turn off"
                      : "Click to turn on"
                  }
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200 ${
                      isOn ? "translate-x-6" : "translate-x-0"
                    }`}
                  />
                </button>
                <span
                  className={`text-[11px] font-semibold w-7 ${
                    isOn ? "text-emerald-600" : "text-stone-400"
                  }`}
                >
                  {isOn ? "ON" : "OFF"}
                </span>
              </div>
            </div>
          );
        })}
      </Card>

      {/* Info note */}
      <div className="flex items-start gap-2 px-1 text-[12px] text-stone-400">
        <Info size={13} className="mt-0.5 shrink-0" />
        <span>
          When a programme is ON, the contact above will receive automated reminder emails according to
          the schedule in <strong className="text-stone-600">Automation Rules</strong>. Invoices in Disputed or
          Promise to Pay stages are always skipped. Invoice PDFs are attached automatically when available.
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
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-stone-900 text-stone-900"
                : "border-transparent text-stone-500 hover:text-stone-900"
            }`}
          >
            {t === "programme" ? "Reminder Programme" : "Automation Rules"}
          </button>
        ))}
      </div>

      {/* ── Reminder Programme ── */}
      {tab === "programme" && <ReminderProgramme />}

      {/* ── Automation Rules ── */}
      {tab === "rules" && (
        <div className="space-y-4">
          <Card className="bg-amber-50 ring-amber-200">
            <div className="flex items-start gap-3">
              <AlertOctagon size={18} className="text-amber-700 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-amber-900">
                <div className="font-medium mb-1">Email sending requires SMTP configuration</div>
                <div>
                  Reminder rules are active but emails won't send until SMTP is configured in{" "}
                  <a href="/settings/notifications" className="underline font-medium">
                    Settings → Notifications
                  </a>
                  . The 30-day auto-escalation rule runs daily without SMTP.
                </div>
              </div>
            </div>
          </Card>

          <Card padding="none">
            <div className="px-4 py-3 border-b border-stone-200">
              <h3 className="text-sm font-semibold text-stone-900">Active rules</h3>
              <p className="text-[11px] text-stone-500 mt-0.5">
                These rules apply to all customers with the Reminder Programme turned ON
              </p>
            </div>
            {RULES.map((r, i) => (
              <div
                key={i}
                className="px-4 py-3 border-b border-stone-100 last:border-0 flex items-start gap-3"
              >
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
