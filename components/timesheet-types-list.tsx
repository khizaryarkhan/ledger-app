"use client";

/**
 * List + drawer CRUD for Timesheet Types — the org-configurable categories a
 * time entry is logged against ("Work", "Sick time", "Holiday - UK", "R&D",
 * ...), each mapped to one expense account. Leave types can optionally turn
 * on balance accrual (leave_policies).
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { Field, Section, SelectField, controlInset, Drawer, DrawerFooter } from "@/components/form-kit";
import {
  useListView, ListPage, ListPageHeader, ListToolbar, ListChips, ListScroll, ListHead, ListFoot,
  listTable, listRow, type ListColumn,
} from "@/components/list-view";

const CATEGORY_LABEL: Record<string, string> = { work: "Work", leave: "Leave", internal: "Internal (non-billable)" };

export function TimesheetTypesList() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    setRows(await fetch("/api/resources/timesheet-types").then(r => r.json()).catch(() => []));
  }
  useEffect(() => {
    load();
    fetch("/api/accounting/accounts").then(r => r.json()).then(d => setAccounts(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const listRows = rows ?? [];
  const COLS = useMemo<ListColumn<any>[]>(() => [
    { key: "name", label: "Name", sort: r => r.name, filter: { kind: "text", value: r => r.name } },
    { key: "category", label: "Category", sort: r => r.category, filter: { kind: "multi", value: r => r.category } },
    { key: "status", label: "Status", sort: r => r.status, filter: { kind: "multi", value: r => r.status } },
  ], []);
  const lv = useListView(listRows, COLS, { storageKey: "resources-timesheet-types", defaultSort: "name" });

  return (
    <ListPage>
      <ListPageHeader title="Timesheet Types" subtitle="The categories a time entry can be logged against, each mapped to one expense account.">
        <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={rows === null ? "animate-spin" : ""} /></button>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700"><Plus size={14} /> New type</button>
      </ListPageHeader>

      {showNew && <TimesheetTypeDrawer accounts={accounts} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}
      {openId && <TimesheetTypeDrawer accounts={accounts} id={openId} onClose={() => setOpenId(null)} onSaved={() => { setOpenId(null); load(); }} />}

      {rows === null ? (
        <p className="px-4 py-8 text-center text-[13px] text-stone-500">Loading…</p>
      ) : (
        <>
          <ListToolbar lv={lv} noun="type" plural="types" />
          <ListChips lv={lv} />
          <ListScroll lv={lv} empty={listRows.length === 0 ? "No timesheet types yet — add one." : "No types match the current filters."}>
            <table className={listTable}>
              <ListHead lv={lv} />
              <tbody>
                {lv.rows.map((r: any) => (
                  <tr key={r.id} onClick={() => setOpenId(r.id)} className={`${listRow()} cursor-pointer`}>
                    <td className="px-2 py-2 text-stone-100">{r.name}</td>
                    <td className="px-2 py-2 text-stone-400">{CATEGORY_LABEL[r.category] ?? r.category}</td>
                    <td className="px-2 py-2">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${r.status === "active" ? "border-emerald-800/50 text-emerald-400 bg-emerald-500/10" : "border-stone-700 text-stone-500"}`}>{r.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              {lv.rows.length > 0 && <ListFoot lv={lv} noun="type" plural="types" />}
            </table>
          </ListScroll>
        </>
      )}
    </ListPage>
  );
}

function TimesheetTypeDrawer({ accounts, id, onClose, onSaved }: { accounts: any[]; id?: string; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!id;
  const [form, setForm] = useState({
    name: "", category: "work", billable: false, requiresAssignable: true, isPublicHoliday: false,
    expenseAccountId: "", status: "active", trackBalance: false,
    accrualMethod: "fixed_annual", accrualAmountPerYear: "0", carryForwardCap: "",
  });
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");

  useEffect(() => {
    if (!id) return;
    fetch(`/api/resources/timesheet-types`).then(r => r.json()).then((list: any[]) => {
      const d = (list || []).find(x => x.id === id);
      if (d) setForm({
        name: d.name || "", category: d.category || "work", billable: !!d.billable,
        requiresAssignable: !!d.requiresAssignable, isPublicHoliday: !!d.isPublicHoliday,
        expenseAccountId: d.expenseAccountId || "", status: d.status || "active",
        trackBalance: !!d.leavePolicy, accrualMethod: d.leavePolicy?.accrualMethod || "fixed_annual",
        accrualAmountPerYear: String(d.leavePolicy?.accrualAmountPerYear ?? "0"),
        carryForwardCap: d.leavePolicy?.carryForwardCap != null ? String(d.leavePolicy.carryForwardCap) : "",
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  const expenseAccounts = accounts.filter(a => a.classification === "Expense" && !a.isHeader);

  async function save() {
    if (!form.name.trim()) { setErr("Name is required."); return; }
    if (!form.expenseAccountId) { setErr("An expense account is required."); return; }
    setSaving(true); setErr("");
    const body: any = {
      name: form.name, category: form.category, billable: form.billable, requiresAssignable: form.requiresAssignable,
      isPublicHoliday: form.isPublicHoliday, expenseAccountId: form.expenseAccountId, status: form.status,
    };
    if (form.category === "leave") {
      body.leavePolicy = form.trackBalance
        ? { accrualMethod: form.accrualMethod, accrualAmountPerYear: Number(form.accrualAmountPerYear) || 0, carryForwardCap: form.carryForwardCap ? Number(form.carryForwardCap) : null }
        : null;
    }
    const r = await fetch(isEdit ? `/api/resources/timesheet-types/${id}` : "/api/resources/timesheet-types", {
      method: isEdit ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save."); return; }
    onSaved();
  }

  return (
    <Drawer title={isEdit ? "Edit timesheet type" : "New timesheet type"} onClose={onClose}
      footer={loading ? null : <DrawerFooter saving={saving} onClose={onClose} onSave={save} err={err} />}>
      {loading ? <p className="text-[13px] text-stone-500">Loading…</p> : (
        <div className="space-y-6">
          <Section title="Details">
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Field label="Name" required className="col-span-2">
                <input className={controlInset} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </Field>
              <Field label="Category" required className="col-span-2" hint="Work needs a Project/MO/Job Work; Leave draws a balance; Internal is non-billable overhead.">
                <SelectField inset value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  <option value="work">Work</option>
                  <option value="leave">Leave</option>
                  <option value="internal">Internal (non-billable)</option>
                </SelectField>
              </Field>
              {form.category === "work" && (
                <>
                  <Field label="Billable"><SelectField inset value={form.billable ? "1" : "0"} onChange={e => setForm(f => ({ ...f, billable: e.target.value === "1" }))}><option value="0">No</option><option value="1">Yes</option></SelectField></Field>
                  <Field label="Requires a Project/MO/Job Work"><SelectField inset value={form.requiresAssignable ? "1" : "0"} onChange={e => setForm(f => ({ ...f, requiresAssignable: e.target.value === "1" }))}><option value="1">Yes</option><option value="0">No</option></SelectField></Field>
                </>
              )}
              {form.category === "leave" && (
                <Field label="This is a Public Holiday type" className="col-span-2" hint="Auto-suggested from the calendar; never balance-tracked.">
                  <SelectField inset value={form.isPublicHoliday ? "1" : "0"} onChange={e => setForm(f => ({ ...f, isPublicHoliday: e.target.value === "1" }))}><option value="0">No</option><option value="1">Yes</option></SelectField>
                </Field>
              )}
              <Field label="Expense account" required className="col-span-2">
                <SelectField inset value={form.expenseAccountId} onChange={e => setForm(f => ({ ...f, expenseAccountId: e.target.value }))}>
                  <option value="">Choose an account…</option>
                  {expenseAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </SelectField>
              </Field>
              <Field label="Status" className="col-span-2">
                <SelectField inset value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </SelectField>
              </Field>
            </div>
          </Section>

          {form.category === "leave" && !form.isPublicHoliday && (
            <Section title="Balance tracking (optional)">
              <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                <Field label="Track a leave balance for this type" className="col-span-2">
                  <SelectField inset value={form.trackBalance ? "1" : "0"} onChange={e => setForm(f => ({ ...f, trackBalance: e.target.value === "1" }))}><option value="0">No — capture only</option><option value="1">Yes — accrue and deduct</option></SelectField>
                </Field>
                {form.trackBalance && (
                  <>
                    <Field label="Accrual method">
                      <SelectField inset value={form.accrualMethod} onChange={e => setForm(f => ({ ...f, accrualMethod: e.target.value }))}>
                        <option value="fixed_annual">Fixed annual grant</option>
                        <option value="monthly">Monthly accrual</option>
                      </SelectField>
                    </Field>
                    <Field label="Hours per year">
                      <input type="number" step="0.5" className={controlInset} value={form.accrualAmountPerYear} onChange={e => setForm(f => ({ ...f, accrualAmountPerYear: e.target.value }))} />
                    </Field>
                    <Field label="Carry-forward cap (hours)" hint="Leave blank for unlimited" className="col-span-2">
                      <input type="number" step="0.5" className={controlInset} value={form.carryForwardCap} onChange={e => setForm(f => ({ ...f, carryForwardCap: e.target.value }))} />
                    </Field>
                  </>
                )}
              </div>
            </Section>
          )}
        </div>
      )}
    </Drawer>
  );
}
