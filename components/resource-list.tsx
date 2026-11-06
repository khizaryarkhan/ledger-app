"use client";

/**
 * List + drawer CRUD for a `resources` type (person or equipment). Shared
 * component parameterized by `type` — People and Equipment are the same
 * screen shape, just a different filter and a different "link an existing
 * record" picker (People links to Employees; Equipment has none).
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Loader, Check, Trash2, KeyRound, Eye } from "lucide-react";
import { useSession } from "next-auth/react";
import { Field, Section, SelectField, controlInset, Drawer, DrawerFooter } from "@/components/form-kit";
import { WorkingHoursPanel } from "@/components/working-hours-panel";
import { MachineDowntimePanel } from "@/components/machine-downtime-panel";
import { usePersonDetails, PersonalTab, EmergencyTab, BankTab } from "@/components/person-details-tabs";
import { CAPACITY_UNITS, CAPACITY_UNIT_LABEL, fromDaily, toDaily, isCapacityUnit, type CapacityUnit } from "@/lib/resources/capacity-unit";
import {
  useListView, ListPage, ListPageHeader, ListToolbar, ListChips, ListScroll, ListHead, ListFoot,
  listTable, listRow, listNumCell, type ListColumn,
} from "@/components/list-view";

export function ResourceList({ type }: { type: "person" | "equipment" }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  const [calendars, setCalendars] = useState<any[]>([]);
  const [designations, setDesignations] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loginFor, setLoginFor] = useState<any | null>(null);

  // "Sign in as" (admins; read-only, 60 minutes — lib/impersonation.ts).
  const { data: session, update: updateSession } = useSession();
  // Super admins and company admins; the server refuses an admin target for a company admin.
  // Decided by the role in THIS org (from /api/resources/me), not the global
  // users.role on the session, which is what the server checks against too.
  const [orgAdmin, setOrgAdmin] = useState(false);
  useEffect(() => {
    fetch("/api/resources/me").then(r => r.ok ? r.json() : null).then(d => setOrgAdmin(!!d?.isOrgAdmin)).catch(() => {});
  }, []);
  const canSignInAs = orgAdmin;
  const [signingInAs, setSigningInAs] = useState<string | null>(null);
  async function signInAs(r: any) {
    setSigningInAs(r.id);
    try {
      const res = await fetch("/api/org/impersonate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceId: r.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ticket) { alert(d?.error || "Could not sign in as this person."); return; }
      await updateSession({ impersonationTicket: d.ticket });
      window.location.href = "/dashboard"; // middleware sends employee/rep logins to their own portal
    } finally { setSigningInAs(null); }
  }

  async function load() {
    const d = await fetch(`/api/resources?type=${type}`).then(r => r.json()).catch(() => []);
    setRows(Array.isArray(d) ? d : []);
  }
  useEffect(() => {
    load();
    if (type === "person") {
      fetch("/api/parties/employees").then(r => r.json()).then(d => setEmployees(Array.isArray(d) ? d : (d?.rows ?? []))).catch(() => {});
      fetch("/api/resources/holiday-calendars").then(r => r.json()).then(d => setCalendars(Array.isArray(d) ? d : [])).catch(() => {});
      fetch("/api/resources/designations").then(r => r.json()).then(d => setDesignations(Array.isArray(d) ? d : [])).catch(() => {});
    }
  }, [type]);

  const label = type === "person" ? "People" : "Equipment";
  const listRows = rows ?? [];
  const RES_COLS = useMemo<ListColumn<any>[]>(() => [
    { key: "name", label: "Name", sort: r => r.name, filter: { kind: "text", value: r => r.name } },
    { key: "category", label: "Category", sort: r => r.category, filter: { kind: "multi", value: r => r.category } },
    ...(type === "person" ? [
      { key: "designation", label: "Designation", sort: (r: any) => r.designationName, filter: { kind: "multi" as const, value: (r: any) => r.designationName || "None" } },
      { key: "manager", label: "Manager", sort: (r: any) => r.managerName, filter: { kind: "multi" as const, value: (r: any) => r.managerName || "None" } },
      { key: "login", label: "Login", sort: (r: any) => r.loginEmail, filter: { kind: "multi" as const, value: (r: any) => (r.hasLogin ? "Has login" : "No login") } },
    ] : []),
    { key: "dailyCapacity", label: "Daily capacity", align: "right", sort: r => r.dailyCapacity, sum: r => r.dailyCapacity },
    { key: "status", label: "Status", sort: r => r.status, filter: { kind: "multi", value: r => r.status } },
  ], [type]);
  const lv = useListView(listRows, RES_COLS, { storageKey: `resources-${type}`, defaultSort: "name" });

  return (
    <ListPage>
      <ListPageHeader title={label} subtitle={type === "person" ? "People available to schedule against Projects and production orders." : "Machines/equipment available to schedule against production orders."}>
        <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={rows === null ? "animate-spin" : ""} /></button>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 text-[13px] font-semibold bg-primary text-white rounded-lg px-3.5 py-2 hover:bg-primary-hover"><Plus size={14} /> New {type === "person" ? "person" : "equipment"}</button>
      </ListPageHeader>

      {showNew && <ResourceDrawer type={type} employees={employees} calendars={calendars} designations={designations} people={listRows} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}
      {openId && <ResourceDrawer type={type} employees={employees} calendars={calendars} designations={designations} people={listRows} id={openId} canEdit={orgAdmin} onClose={() => setOpenId(null)} onSaved={() => { setOpenId(null); load(); }} />}
      {loginFor && <LoginDrawer person={loginFor} defaultEmail={loginFor.employee?.email || ""} onClose={() => setLoginFor(null)} onSaved={() => { setLoginFor(null); load(); }} />}

      {rows === null ? (
        <p className="px-4 py-8 text-center text-[13px] text-stone-500">Loading…</p>
      ) : (
        <>
          <ListToolbar lv={lv} noun={type === "person" ? "person" : "resource"} plural={type === "person" ? "people" : "resources"} />
          <ListChips lv={lv} />
          <ListScroll lv={lv} empty={listRows.length === 0 ? `No ${label.toLowerCase()} yet — add one.` : `No ${label.toLowerCase()} match the current filters.`}>
            <table className={listTable}>
              <ListHead lv={lv} />
              <tbody>
                {lv.rows.map((r: any) => (
                  <tr key={r.id} onClick={() => setOpenId(r.id)} className={`${listRow()} cursor-pointer`}>
                    <td className="px-2 py-2 text-stone-100">{r.name}{r.employee ? <span className="text-stone-500"> · linked to {r.employee.name}</span> : null}</td>
                    <td className="px-2 py-2 text-stone-400">{r.category || "—"}</td>
                    {type === "person" && (
                      <>
                        <td className="px-2 py-2 text-stone-300">{r.designationName || "—"}</td>
                        <td className="px-2 py-2 text-stone-300">{r.managerName || "—"}</td>
                        <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center">
                          {r.hasLogin && r.loginManagedHere === false ? (
                            <span className="flex items-center gap-1.5 text-[12px] text-stone-300" title="Team member: password and access are managed in Settings → Team">
                              <KeyRound size={12} className="text-emerald-400" />
                              {r.loginEmail || "Has login"}
                            </span>
                          ) : (
                          <button onClick={() => setLoginFor(r)} className="flex items-center gap-1.5 text-[12px] text-stone-300 hover:text-white" title={r.hasLogin ? "Reset password or remove login" : "Give this person a login"}>
                            <KeyRound size={12} className={r.hasLogin ? "text-emerald-400" : "text-stone-500"} />
                            {r.hasLogin ? (r.loginEmail || "Has login") : <span className="text-stone-500">No login · Give login</span>}
                          </button>
                          )}
                          {canSignInAs && r.hasLogin && r.status === "active" && (
                            <button onClick={() => signInAs(r)} disabled={signingInAs === r.id}
                              title="See the app exactly as this person does (read-only, 60 minutes)"
                              className="ml-2 inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded ring-1 ring-amber-600/50 text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">
                              <Eye size={11} /> Sign in as
                            </button>
                          )}
                          </div>
                        </td>
                      </>
                    )}
                    <td className={`${listNumCell} text-stone-300`}>{r.dailyCapacity}</td>
                    <td className="px-2 py-2">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${r.status === "active" ? "border-emerald-800/50 text-emerald-400 bg-emerald-500/10" : "border-stone-700 text-stone-500"}`}>{r.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              {lv.rows.length > 0 && <ListFoot lv={lv} noun={type === "person" ? "person" : "resource"} plural={type === "person" ? "people" : "resources"} />}
            </table>
          </ListScroll>
        </>
      )}
    </ListPage>
  );
}

const MIN_PASSWORD_LENGTH = 8;

/** Give a person a login, reset its password, or remove it. */
function LoginDrawer({ person, defaultEmail, onClose, onSaved }: { person: any; defaultEmail: string; onClose: () => void; onSaved: () => void }) {
  const hasLogin = !!person.hasLogin;
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");

  async function save() {
    if (!hasLogin && !email.trim()) { setErr("Email is required."); return; }
    if (password.length < MIN_PASSWORD_LENGTH) { setErr(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`); return; }
    setSaving(true); setErr("");
    const r = await fetch(`/api/resources/${person.id}/login`, {
      method: hasLogin ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(hasLogin ? { password } : { email: email.trim(), password }),
    });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save."); return; }
    onSaved();
  }

  async function remove() {
    if (!confirm(`Remove ${person.name}'s login? They will no longer be able to sign in.`)) return;
    const r = await fetch(`/api/resources/${person.id}/login`, { method: "DELETE" });
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not remove the login."); return; }
    onSaved();
  }

  return (
    <Drawer title={hasLogin ? "Reset password" : "Give login"} subtitle={person.name} onClose={onClose}
      footer={(
        <DrawerFooter saving={saving} onClose={onClose} onSave={save} err={err} saveLabel={hasLogin ? "Reset password" : "Create login"}
          extra={hasLogin ? <button onClick={remove} className="flex items-center gap-1.5 text-[12px] text-stone-400 hover:text-rose-400"><Trash2 size={14} /> Remove login</button> : undefined} />
      )}>
      <div className="space-y-6">
        <Section title="Sign-in" desc="This login can only be used to fill in this person's own timesheet.">
          <div className="grid grid-cols-1 gap-4">
            <Field label="Email" required>
              {hasLogin
                ? <input className={controlInset} value={person.loginEmail || ""} disabled />
                : <input type="email" autoComplete="off" className={controlInset} value={email} onChange={e => setEmail(e.target.value)} />}
            </Field>
            <Field label={hasLogin ? "New password" : "Password"} required hint={`At least ${MIN_PASSWORD_LENGTH} characters. Share it with the person securely.`}>
              <input type="password" autoComplete="new-password" className={controlInset} value={password} onChange={e => setPassword(e.target.value)} />
            </Field>
          </div>
        </Section>
      </div>
    </Drawer>
  );
}

/**
 * Hours a linked machine ran in the last 30 days, read from completed runs.
 * Not linked is a different statement from zero hours, so they read differently;
 * and hours that were defaulted from the plan are never presented as measured.
 * `linkKey` is the picker's current value: it re-reads after a save changes the link.
 */
function MachineUsagePanel({ resourceId, linkKey }: { resourceId: string; linkKey: string }) {
  const [u, setU] = useState<any>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/resources/${resourceId}/usage`).then(r => (r.ok ? r.json() : null))
      .then(d => { if (live) setU(d); }).catch(() => { if (live) setU(null); });
    return () => { live = false; };
  }, [resourceId, linkKey]);
  if (!u) return null;

  return (
    <Section title="Usage, last 30 days">
      {!u.linked ? (
        <p className="text-[13px] text-stone-500">Not linked to a work centre, so no usage is read for this machine.</p>
      ) : (
        <div className="text-[13px] text-stone-300 space-y-1">
          <p>
            <span className="text-white font-medium">{u.usage.hours} h</span> across {u.usage.runs} run{u.usage.runs === 1 ? "" : "s"} at {u.workCentre.name}
            {u.usage.hours > 0 && !u.firm && <span className="text-amber-400"> · not all measured</span>}
          </p>
          {u.usage.hours > 0 && (
            <p className="text-stone-500">
              Entered {u.usage.firmHours} h · defaulted from plan {u.usage.estimatedHours} h · not recorded {u.usage.notRecordedHours} h
            </p>
          )}
          {u.usage.hours === 0 && <p className="text-stone-500">No completed run booked time here in this period.</p>}
        </div>
      )}
    </Section>
  );
}

const WEEKDAYS = [{ v: 1, l: "Mon" }, { v: 2, l: "Tue" }, { v: 3, l: "Wed" }, { v: 4, l: "Thu" }, { v: 5, l: "Fri" }, { v: 6, l: "Sat" }, { v: 7, l: "Sun" }];
const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5];

type PersonTab = "details" | "work" | "personal" | "emergency" | "bank";
const PERSON_TABS: { key: PersonTab; label: string }[] = [
  { key: "details", label: "Details" },
  { key: "work", label: "Work & hours" },
  { key: "personal", label: "Personal" },
  { key: "emergency", label: "Emergency contact" },
  { key: "bank", label: "Bank" },
];

function ResourceDrawer({ type, employees, calendars, designations, people, id, onClose, onSaved, canEdit = false }: { type: "person" | "equipment"; employees: any[]; calendars: any[]; designations: any[]; people: any[]; id?: string; onClose: () => void; onSaved: () => void; canEdit?: boolean }) {
  const isEdit = !!id;
  const isPerson = type === "person";
  const [form, setForm] = useState({
    employeeId: "", name: "", category: "", dailyCapacity: isPerson ? "8" : "1", status: "active", notes: "",
    costRatePerHour: "", holidayCalendarId: "", workingDays: DEFAULT_WORKING_DAYS as number[],
    designationId: "", managerId: "", department: "",
    // Equipment only. "" means not linked; the server refuses a link on a person.
    workCentreId: "", fixedAssetId: "",
  });
  const [tab, setTab] = useState<PersonTab>("details");
  const personal = usePersonDetails(isPerson ? id : undefined);

  // Capacity is STORED as hours per day; the organisation decides whether it is
  // entered and shown per day, week or month (lib/resources/capacity-unit.ts).
  const [capUnit, setCapUnit] = useState<CapacityUnit>("day");
  const [capEntry, setCapEntry] = useState(isPerson ? "8" : "1");
  const [unitMsg, setUnitMsg] = useState("");
  useEffect(() => {
    if (!isPerson) return;
    fetch("/api/resources/payroll-settings").then(r => (r.ok ? r.json() : null)).then(d => {
      if (d && isCapacityUnit(d.capacityUnit)) setCapUnit(d.capacityUnit);
    }).catch(() => { /* stays per day */ });
  }, [isPerson]);
  // Re-express the stored figure whenever the unit or the record changes.
  useEffect(() => {
    if (!isPerson) return;
    setCapEntry(String(fromDaily(Number(form.dailyCapacity) || 0, capUnit, form.workingDays)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capUnit, form.dailyCapacity]);

  async function changeUnit(next: CapacityUnit) {
    // Keep the figure already typed, in hours/day, before re-expressing it.
    const daily = toDaily(Number(capEntry) || 0, capUnit, form.workingDays);
    setForm(f => ({ ...f, dailyCapacity: String(daily) }));
    setCapUnit(next);
    const r = await fetch("/api/resources/payroll-settings", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ capacityUnit: next }),
    }).catch(() => null);
    setUnitMsg(r && r.ok ? "Saved for your organisation — everyone's capacity now shows this way." : "Shown this way here only; the organisation setting could not be saved.");
  }

  // Each list sits behind a module the org may not have (work centres need
  // Manufacturing, fixed assets need Accounting), so a failed fetch leaves that
  // picker out rather than showing an error.
  const [workCentres, setWorkCentres] = useState<{ id: string; name: string; code: string | null }[] | null>(null);
  const [assets, setAssets] = useState<{ id: string; name: string; code: string | null }[] | null>(null);
  useEffect(() => {
    if (type !== "equipment") return;
    fetch("/api/production/work-centres").then(r => (r.ok ? r.json() : null))
      .then(rows => setWorkCentres(Array.isArray(rows) ? rows : null)).catch(() => setWorkCentres(null));
    fetch("/api/accounting/fixed-assets").then(r => (r.ok ? r.json() : null))
      .then(b => setAssets(Array.isArray(b?.assets) ? b.assets : null)).catch(() => setAssets(null));
  }, [type]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");

  useEffect(() => {
    if (!id) return;
    fetch(`/api/resources/${id}`).then(r => r.json()).then(d => {
      setForm({
        employeeId: d.employeeId || "", name: d.name || "", category: d.category || "", dailyCapacity: String(d.dailyCapacity ?? "1"), status: d.status || "active", notes: d.notes || "",
        costRatePerHour: d.costRatePerHour != null ? String(d.costRatePerHour) : "", holidayCalendarId: d.holidayCalendarId || "",
        workingDays: Array.isArray(d.workingDays) && d.workingDays.length ? d.workingDays : DEFAULT_WORKING_DAYS,
        designationId: d.designationId || "", managerId: d.managerId || "", department: d.department || "",
        workCentreId: d.workCentreId || "", fixedAssetId: d.fixedAssetId || "",
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  function toggleDay(day: number) {
    setForm(f => ({ ...f, workingDays: f.workingDays.includes(day) ? f.workingDays.filter(d => d !== day) : [...f.workingDays, day].sort() }));
  }

  function onEmployee(empId: string) {
    const emp = employees.find(e => e.id === empId);
    setForm(f => ({ ...f, employeeId: empId, name: emp ? emp.name : f.name }));
  }

  async function save() {
    if (!form.name.trim()) { setErr("Name is required."); setTab("details"); return; }
    setSaving(true); setErr("");
    // A weekly or monthly figure is divided over THIS person's working days at save.
    const daily = isPerson ? toDaily(Number(capEntry) || 0, capUnit, form.workingDays) : Number(form.dailyCapacity) || 1;
    const body = { type, ...form, dailyCapacity: daily };
    const r = await fetch(isEdit ? `/api/resources/${id}` : "/api/resources", {
      method: isEdit ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const saved = await r.json().catch(() => ({}));
    if (!r.ok) { setSaving(false); setErr(saved?.error || "Could not save."); return; }
    // Personal details hang off the person's id, so a new person saves them second.
    const personId: string | undefined = id ?? saved?.id;
    if (isPerson && personId && personal.state.dirty) {
      const detailsErr = await personal.save(personId);
      if (detailsErr) { setSaving(false); setErr(`Saved, except personal details: ${detailsErr}`); return; }
    }
    setSaving(false);
    onSaved();
  }

  async function del() {
    if (!id || !confirm("Delete this resource?")) return;
    const r = await fetch(`/api/resources/${id}`, { method: "DELETE" });
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not delete."); return; }
    onSaved();
  }

  const statusField = (
    <Field label="Status" className="col-span-2">
      <SelectField inset value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </SelectField>
    </Field>
  );
  const notesField = (
    <Field label="Notes" className="col-span-2">
      <textarea className={`${controlInset} !h-auto py-2`} rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
    </Field>
  );
  const costField = (
    <Field label="Cost rate per hour" hint="Required before this resource's timesheets can be posted to the GL" className="col-span-2">
      <input type="number" step="0.01" className={controlInset} value={form.costRatePerHour} onChange={e => setForm(f => ({ ...f, costRatePerHour: e.target.value }))} />
    </Field>
  );

  const title = isEdit ? (isPerson ? form.name || "Edit person" : "Edit equipment") : (isPerson ? "New person" : "New equipment");

  return (
    <Drawer title={title} subtitle={isPerson && isEdit ? "Person" : undefined} size={isPerson ? "lg" : "md"} onClose={onClose}
      footer={loading ? null : (
        <DrawerFooter saving={saving} onClose={onClose} onSave={save} err={err}
          extra={isEdit ? <button onClick={del} className="p-1.5 rounded hover:bg-stone-800 text-stone-500 hover:text-rose-400" title="Delete"><Trash2 size={14} /></button> : undefined} />
      )}>
      {loading ? <p className="text-[13px] text-stone-500">Loading…</p> : isPerson ? (
        <div className="space-y-5">
          <div className="flex gap-1.5 flex-wrap" role="tablist">
            {PERSON_TABS.map(t => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                className={tab === t.key
                  ? "h-8 px-3 text-[12px] font-medium rounded-md ring-1 ring-stone-600 bg-stone-700 text-stone-100"
                  : "h-8 px-3 text-[12px] font-medium rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-400 hover:text-stone-200"}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === "details" && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Field label="Name" required className="col-span-2">
                <input className={controlInset} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </Field>
              <Field label="Link to existing employee" className="col-span-2" hint="Optional — reuses that employee's contact record rather than duplicating it">
                <SelectField inset value={form.employeeId} onChange={e => onEmployee(e.target.value)}>
                  <option value="">None</option>
                  {employees.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </SelectField>
              </Field>
              <Field label="Category" hint="e.g. Machine Operator, Site Engineer">
                <input className={controlInset} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
              </Field>
              <Field label="Department">
                <input className={controlInset} value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} />
              </Field>
              <Field label="Designation" hint="Decides which reports this person can open">
                <SelectField inset value={form.designationId} onChange={e => setForm(f => ({ ...f, designationId: e.target.value }))}>
                  <option value="">None</option>
                  {designations.filter((d: any) => d.status === "active" || d.id === form.designationId).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </SelectField>
              </Field>
              <Field label="Manager" hint="Their line manager. Approvers come from this chain.">
                <SelectField inset value={form.managerId} onChange={e => setForm(f => ({ ...f, managerId: e.target.value }))}>
                  <option value="">None</option>
                  {people.filter((p: any) => p.id !== id && (p.status === "active" || p.id === form.managerId)).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </SelectField>
              </Field>
              {statusField}
              {notesField}
            </div>
          )}

          {tab === "work" && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                <Field label="Standard capacity" className="col-span-2"
                  hint={unitMsg || "Used on any day not covered by a dated contract below. Week and month figures are spread over this person's working days."}>
                  <div className="flex gap-2">
                    <input type="number" step="0.5" min={0} className={controlInset} value={capEntry} onChange={e => setCapEntry(e.target.value)} />
                    <div className="w-48 shrink-0">
                      <SelectField inset value={capUnit} onChange={e => { if (isCapacityUnit(e.target.value)) changeUnit(e.target.value); }}>
                        {CAPACITY_UNITS.map(u => <option key={u} value={u}>{CAPACITY_UNIT_LABEL[u]}</option>)}
                      </SelectField>
                    </div>
                  </div>
                </Field>
                <Field label="Working days" className="col-span-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    {WEEKDAYS.map(w => (
                      <label key={w.v} className="flex items-center gap-1.5 text-[13px] text-stone-300">
                        <input type="checkbox" checked={form.workingDays.includes(w.v)} onChange={() => toggleDay(w.v)} /> {w.l}
                      </label>
                    ))}
                  </div>
                </Field>
                <Field label="Holiday calendar" hint="Blank = org default" className="col-span-2">
                  <SelectField inset value={form.holidayCalendarId} onChange={e => setForm(f => ({ ...f, holidayCalendarId: e.target.value }))}>
                    <option value="">Org default</option>
                    {calendars.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </SelectField>
                </Field>
                {costField}
              </div>
              {isEdit && id ? (
                <Section title="Contracted hours (dated)">
                  <WorkingHoursPanel resourceId={id} canEdit={canEdit} />
                </Section>
              ) : (
                <p className="text-[12px] text-stone-500">Dated contracts (a change of hours from a given date) can be added once the person is saved.</p>
              )}
            </div>
          )}

          {tab === "personal" && <PersonalTab hook={personal} />}
          {tab === "emergency" && <EmergencyTab hook={personal} />}
          {tab === "bank" && <BankTab hook={personal} />}
        </div>
      ) : (
        <div className="space-y-6">
          <Section title="Details">
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Field label="Name" required className="col-span-2">
                <input className={controlInset} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </Field>
              <Field label="Category" hint="e.g. CNC Machine #2">
                <input className={controlInset} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
              </Field>
              <Field label="Bookings at once" hint="How many jobs it can take on the same day (usually 1). Its hours are under Available hours.">
                <input type="number" step="1" min={1} className={controlInset} value={form.dailyCapacity} onChange={e => setForm(f => ({ ...f, dailyCapacity: e.target.value }))} />
              </Field>
              {costField}
              {workCentres && (
                <Field label="Work centre" className="col-span-2" hint="Link a machine to the work centre its production hours are charged to, and its usage is read from completed runs — no second place to type hours">
                  <SelectField inset value={form.workCentreId} onChange={e => setForm(f => ({ ...f, workCentreId: e.target.value }))}>
                    <option value="">Not linked</option>
                    {workCentres.map(w => <option key={w.id} value={w.id}>{w.code ? `${w.code} · ` : ""}{w.name}</option>)}
                  </SelectField>
                </Field>
              )}
              {assets && (
                <Field label="Fixed asset" className="col-span-2" hint="The asset this machine depreciates as. Shown beside running cost, never added to it">
                  <SelectField inset value={form.fixedAssetId} onChange={e => setForm(f => ({ ...f, fixedAssetId: e.target.value }))}>
                    <option value="">Not linked</option>
                    {assets.map(a => <option key={a.id} value={a.id}>{a.code ? `${a.code} · ` : ""}{a.name}</option>)}
                  </SelectField>
                </Field>
              )}
              {statusField}
              {notesField}
            </div>
          </Section>

          {isEdit && id && <MachineUsagePanel resourceId={id} linkKey={form.workCentreId} />}
          {isEdit && id && <MachineDowntimePanel resourceId={id} linkKey={form.workCentreId} />}

          {/* A machine's available hours are what its utilisation is measured
              against. "Bookings at once" is slots, not hours, so this dated
              record is the only source the report will use. */}
          {isEdit && id && (
            <Section title="Available hours">
              <WorkingHoursPanel resourceId={id} canEdit={canEdit} />
            </Section>
          )}
        </div>
      )}
    </Drawer>
  );
}
