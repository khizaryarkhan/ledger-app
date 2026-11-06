"use client";

/**
 * Settings → Roles. An admin decides what each role can open — the same idea
 * as the platform's per-organisation Modules card, one level down: the org's
 * modules are the ceiling, a role picks None / View / Edit for each, plus
 * whose people it sees (timesheets, approvals, reports). Rules: lib/roles.ts.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { ChevronLeft, Plus, Shield, Lock, Trash2 } from "lucide-react";
import { Drawer, DrawerFooter, Field, SelectField, controlInset } from "@/components/form-kit";
import { MODULES, type ModuleKey } from "@/lib/modules";
import { BASE_ROLE_LABEL, PEOPLE_SCOPES, SCOPE_LABEL, type ModuleAccess, type PeopleScope } from "@/lib/roles";

type Role = { id: string; name: string; baseRole: string; modules: Record<string, ModuleAccess>; peopleScope: PeopleScope; members: number };
type SystemRole = { key: string; name: string; description: string };
type Draft = { id: string | null; name: string; baseRole: string; modules: Record<string, ModuleAccess>; peopleScope: PeopleScope };

const ACCESS_CHOICES: { v: ModuleAccess; label: string }[] = [
  { v: "none", label: "None" },
  { v: "view", label: "View" },
  { v: "edit", label: "Edit" },
];

function accessSummary(r: Role, orgModules: string[]): string {
  if (r.baseRole === "employee") return "Own timesheet only";
  const parts = orgModules
    .filter((m) => (r.modules[m] ?? "none") !== "none")
    .map((m) => `${MODULES[m as ModuleKey]?.label ?? m}${r.modules[m] === "view" ? " (view)" : ""}`);
  return parts.length ? parts.join(", ") : "No modules";
}

export default function RolesPage() {
  const { data: session } = useSession();
  const sessionRole = (session?.user as any)?.role;
  const isAdmin = sessionRole === "company_admin" || sessionRole === "super_admin" || sessionRole === "platform_admin";

  const [system, setSystem] = useState<SystemRole[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [orgModules, setOrgModules] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/org/roles");
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setLoadErr(d?.error || "Could not load roles"); return; }
      setSystem(d.system ?? []); setRoles(d.roles ?? []); setOrgModules(d.modules ?? []);
      setLoadErr(null);
    } finally { setLoading(false); }
  };
  useEffect(() => { if (isAdmin) load(); else setLoading(false); }, [isAdmin]);

  const openNew = () => {
    setErr(null);
    setDraft({ id: null, name: "", baseRole: "company_user", modules: Object.fromEntries(orgModules.map((m) => [m, "view" as ModuleAccess])), peopleScope: "self" });
  };
  const openEdit = (r: Role) => {
    setErr(null);
    // Keep only modules the org still has: the editor cannot show the others,
    // and sending one made every later save of this role fail.
    const modules = Object.fromEntries(Object.entries(r.modules).filter(([m]) => orgModules.includes(m as any)));
    setDraft({ id: r.id, name: r.name, baseRole: r.baseRole, modules, peopleScope: r.peopleScope });
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true); setErr(null);
    try {
      const modules = draft.baseRole === "employee" ? {} : draft.modules;
      const res = await fetch(draft.id ? `/api/org/roles/${draft.id}` : "/api/org/roles", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name, baseRole: draft.baseRole, modules, peopleScope: draft.peopleScope }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d?.error || "Could not save the role"); return; }
      setDraft(null);
      await load();
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!draft?.id) return;
    setSaving(true); setErr(null);
    try {
      const res = await fetch(`/api/org/roles/${draft.id}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d?.error || "Could not delete the role"); return; }
      setDraft(null);
      await load();
    } finally { setSaving(false); }
  };

  if (!isAdmin) {
    return <div className="p-6 text-sm text-stone-400">Only Company Admins can manage roles.</div>;
  }

  return (
    <div className="p-6 max-w-[860px] mx-auto">
      <div className="mb-6">
        <Link href="/settings" className="inline-flex items-center gap-1 text-[13px] text-stone-500 hover:text-stone-200 mb-3 transition-colors">
          <ChevronLeft size={14} /> Settings
        </Link>
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <h1 className="text-xl font-semibold text-white tracking-tight">Roles</h1>
            <p className="text-sm text-stone-400 mt-0.5">
              Decide what each role can open. A role never goes beyond the modules your organisation has.
              Give people a role in <Link href="/settings/team" className="text-stone-200 underline underline-offset-2">Team</Link>.
            </p>
          </div>
          <button onClick={openNew} disabled={loading || !!loadErr}
            className="h-8 inline-flex items-center gap-1.5 text-xs font-semibold bg-emerald-600 text-white rounded-md px-3 hover:bg-emerald-700 disabled:opacity-60">
            <Plus size={13} /> New role
          </button>
        </div>
      </div>

      {loadErr && <div className="text-sm text-rose-400 mb-4">{loadErr}</div>}
      {loading && <div className="text-sm text-stone-400">Loading…</div>}

      {!loading && !loadErr && (
        <>
          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-2">Your roles</div>
          <div className="space-y-2 mb-8">
            {roles.length === 0 && (
              <div className="text-sm text-stone-500 rounded-lg ring-1 ring-stone-800 px-3 py-3">
                No roles yet. Create one, for example Project Lead or Director, then give it to people in Team.
              </div>
            )}
            {roles.map((r) => (
              <button key={r.id} onClick={() => openEdit(r)}
                className="w-full text-left rounded-lg ring-1 ring-stone-700 bg-stone-900 hover:bg-stone-800/70 px-3 py-2.5 flex items-start gap-3 transition-colors">
                <Shield size={15} className="text-stone-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white">{r.name}</div>
                  <div className="text-[11px] text-stone-500 mt-0.5">
                    {BASE_ROLE_LABEL[r.baseRole] ?? r.baseRole} · Sees {SCOPE_LABEL[r.peopleScope].toLowerCase()} · {accessSummary(r, orgModules)}
                  </div>
                </div>
                <span className="text-[11px] text-stone-400 shrink-0">{r.members} {r.members === 1 ? "person" : "people"}</span>
              </button>
            ))}
          </div>

          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-2">Built-in roles</div>
          <div className="space-y-2">
            {system.map((r) => (
              <div key={r.key} className="rounded-lg ring-1 ring-stone-800 bg-stone-900/50 px-3 py-2.5 flex items-start gap-3">
                <Lock size={14} className="text-stone-500 mt-0.5 shrink-0" />
                <div>
                  <div className="text-sm font-medium text-stone-200">{r.name}</div>
                  <div className="text-[11px] text-stone-500 mt-0.5">{r.description}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {draft && (
        <Drawer
          title={draft.id ? "Edit role" : "New role"}
          subtitle="What people with this role can open and whose people they can see."
          onClose={() => setDraft(null)}
          footer={
            <DrawerFooter
              saving={saving} err={err}
              onClose={() => setDraft(null)} onSave={save}
              saveLabel={draft.id ? "Save role" : "Create role"}
              extra={draft.id ? (
                <button onClick={remove} disabled={saving}
                  className="inline-flex items-center gap-1 text-[12px] text-rose-400 hover:text-rose-300 px-2 py-2 rounded-lg hover:bg-rose-500/10">
                  <Trash2 size={13} /> Delete
                </button>
              ) : undefined}
            />
          }>
          <div className="space-y-5">
            <Field label="Name" required>
              <input value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Project Lead" className={controlInset} />
            </Field>

            <Field label="Access type" hint={
              draft.baseRole === "rep" ? "Sees only the customers and projects assigned to them in Receivables."
                : draft.baseRole === "employee" ? "Can only fill their own timesheet and read their own reports."
                : "Works across the modules ticked below."
            }>
              <SelectField inset value={draft.baseRole} onChange={(e) => setDraft({ ...draft, baseRole: e.target.value })}>
                <option value="company_user">Standard</option>
                <option value="rep">Collector (own customers only)</option>
                <option value="employee">Timesheet only</option>
              </SelectField>
            </Field>

            {draft.baseRole !== "employee" && (
              <div>
                <div className="text-[12px] font-medium text-stone-300 mb-2">Modules</div>
                <div className="space-y-1.5">
                  {orgModules.map((m) => {
                    const cur = draft.modules[m] ?? "none";
                    return (
                      <div key={m} className="flex items-center gap-3 rounded-md ring-1 ring-stone-800 bg-stone-950 px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] text-stone-200">{MODULES[m as ModuleKey]?.label ?? m}</div>
                          <div className="text-[11px] text-stone-500 truncate">{MODULES[m as ModuleKey]?.description}</div>
                        </div>
                        <div className="flex rounded-md ring-1 ring-stone-700 overflow-hidden shrink-0">
                          {ACCESS_CHOICES.map(({ v, label }) => (
                            <button key={v} type="button"
                              onClick={() => setDraft({ ...draft, modules: { ...draft.modules, [m]: v } })}
                              className={cur === v
                                ? "h-7 px-2.5 text-[11px] font-semibold bg-stone-700 text-stone-100"
                                : "h-7 px-2.5 text-[11px] bg-stone-900 text-stone-400 hover:text-stone-200"}>
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-stone-500 mt-1.5">View lets them read; Edit lets them create and change. Shared lists such as Customers and Suppliers stay visible to everyone.</p>
              </div>
            )}

            <Field label="Whose people they see" hint="Timesheets, approvals and team reports. Leading a project always adds that project's people.">
              <SelectField inset value={draft.peopleScope} onChange={(e) => setDraft({ ...draft, peopleScope: e.target.value as PeopleScope })}>
                {PEOPLE_SCOPES.map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
              </SelectField>
            </Field>
          </div>
        </Drawer>
      )}
    </div>
  );
}
