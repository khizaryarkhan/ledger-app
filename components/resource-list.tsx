"use client";

/**
 * List + drawer CRUD for a `resources` type (person or equipment). Shared
 * component parameterized by `type` — People and Equipment are the same
 * screen shape, just a different filter and a different "link an existing
 * record" picker (People links to Employees; Equipment has none).
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Loader, Check, Trash2 } from "lucide-react";
import { Field, Section, SelectField, controlInset, Drawer, DrawerFooter } from "@/components/form-kit";
import {
  useListView, ListPage, ListPageHeader, ListToolbar, ListChips, ListScroll, ListHead, ListFoot,
  listTable, listRow, listNumCell, type ListColumn,
} from "@/components/list-view";

export function ResourceList({ type }: { type: "person" | "equipment" }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    setRows(await fetch(`/api/resources?type=${type}`).then(r => r.json()).catch(() => []));
  }
  useEffect(() => {
    load();
    if (type === "person") {
      fetch("/api/parties/employees").then(r => r.json()).then(d => setEmployees(Array.isArray(d) ? d : (d?.rows ?? []))).catch(() => {});
    }
  }, [type]);

  const label = type === "person" ? "People" : "Equipment";
  const listRows = rows ?? [];
  const RES_COLS = useMemo<ListColumn<any>[]>(() => [
    { key: "name", label: "Name", sort: r => r.name, filter: { kind: "text", value: r => r.name } },
    { key: "category", label: "Category", sort: r => r.category, filter: { kind: "multi", value: r => r.category } },
    { key: "dailyCapacity", label: "Daily capacity", align: "right", sort: r => r.dailyCapacity, sum: r => r.dailyCapacity },
    { key: "status", label: "Status", sort: r => r.status, filter: { kind: "multi", value: r => r.status } },
  ], []);
  const lv = useListView(listRows, RES_COLS, { storageKey: `resources-${type}`, defaultSort: "name" });

  return (
    <ListPage>
      <ListPageHeader title={label} subtitle={type === "person" ? "People available to schedule against Projects and production orders." : "Machines/equipment available to schedule against production orders."}>
        <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={rows === null ? "animate-spin" : ""} /></button>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700"><Plus size={14} /> New {type === "person" ? "person" : "equipment"}</button>
      </ListPageHeader>

      {showNew && <ResourceDrawer type={type} employees={employees} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}
      {openId && <ResourceDrawer type={type} employees={employees} id={openId} onClose={() => setOpenId(null)} onSaved={() => { setOpenId(null); load(); }} />}

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

function ResourceDrawer({ type, employees, id, onClose, onSaved }: { type: "person" | "equipment"; employees: any[]; id?: string; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!id;
  const [form, setForm] = useState({ employeeId: "", name: "", category: "", dailyCapacity: type === "person" ? "8" : "1", status: "active", notes: "" });
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");

  useEffect(() => {
    if (!id) return;
    fetch(`/api/resources/${id}`).then(r => r.json()).then(d => {
      setForm({ employeeId: d.employeeId || "", name: d.name || "", category: d.category || "", dailyCapacity: String(d.dailyCapacity ?? "1"), status: d.status || "active", notes: d.notes || "" });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  function onEmployee(empId: string) {
    const emp = employees.find(e => e.id === empId);
    setForm(f => ({ ...f, employeeId: empId, name: emp ? emp.name : f.name }));
  }

  async function save() {
    if (!form.name.trim()) { setErr("Name is required."); return; }
    setSaving(true); setErr("");
    const body = { type, ...form, dailyCapacity: Number(form.dailyCapacity) || 1 };
    const r = await fetch(isEdit ? `/api/resources/${id}` : "/api/resources", {
      method: isEdit ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save."); return; }
    onSaved();
  }

  async function del() {
    if (!id || !confirm("Delete this resource?")) return;
    const r = await fetch(`/api/resources/${id}`, { method: "DELETE" });
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not delete."); return; }
    onSaved();
  }

  return (
    <Drawer title={isEdit ? "Edit " + (type === "person" ? "person" : "equipment") : "New " + (type === "person" ? "person" : "equipment")} onClose={onClose}
      footer={loading ? null : (
        <DrawerFooter saving={saving} onClose={onClose} onSave={save} err={err}
          extra={isEdit ? <button onClick={del} className="p-1.5 rounded hover:bg-stone-800 text-stone-500 hover:text-rose-400" title="Delete"><Trash2 size={14} /></button> : undefined} />
      )}>
      {loading ? <p className="text-[13px] text-stone-500">Loading…</p> : (
        <div className="space-y-6">
          <Section title="Details">
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              {type === "person" && (
                <Field label="Link to existing employee" className="col-span-2" hint="Optional — reuses that employee's contact record rather than duplicating it">
                  <SelectField inset value={form.employeeId} onChange={e => onEmployee(e.target.value)}>
                    <option value="">None</option>
                    {employees.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </SelectField>
                </Field>
              )}
              <Field label="Name" required className="col-span-2">
                <input className={controlInset} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </Field>
              <Field label="Category" hint={type === "person" ? "e.g. Machine Operator" : "e.g. CNC Machine #2"}>
                <input className={controlInset} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
              </Field>
              <Field label={type === "person" ? "Daily capacity (hours)" : "Daily capacity (slots)"}>
                <input type="number" step="0.5" className={controlInset} value={form.dailyCapacity} onChange={e => setForm(f => ({ ...f, dailyCapacity: e.target.value }))} />
              </Field>
              <Field label="Status" className="col-span-2">
                <SelectField inset value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </SelectField>
              </Field>
              <Field label="Notes" className="col-span-2">
                <textarea className={`${controlInset} !h-auto py-2`} rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </Field>
            </div>
          </Section>
        </div>
      )}
    </Drawer>
  );
}

