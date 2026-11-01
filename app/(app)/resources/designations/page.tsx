"use client";

/**
 * Designations — a person's role, and with it which reports they may open.
 * List + New/Edit in the shared Drawer. Only organisation admins can change
 * them (the API enforces it); everyone with the Resources module can read.
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Field, Section, SelectField, controlInset, Drawer, DrawerFooter } from "@/components/form-kit";
import {
  useListView, ListPage, ListPageHeader, ListToolbar, ListChips, ListScroll, ListHead, ListFoot,
  listTable, listRow, listNumCell, type ListColumn,
} from "@/components/list-view";

type Level = "self" | "team" | "all";

interface Designation {
  id: string;
  name: string;
  accessLevel: Level;
  sortOrder: number;
  status: string;
  peopleCount: number;
}

const LEVELS: { value: Level; label: string; plain: string }[] = [
  { value: "self", label: "Self", plain: "Own timesheet and reports only." },
  { value: "team", label: "Team", plain: "Self, plus everyone reporting to them, directly or indirectly. Can approve their time." },
  { value: "all", label: "All", plain: "Everyone in the organisation." },
];

function levelLabel(l: string) {
  return LEVELS.find(x => x.value === l)?.label ?? l;
}

export default function DesignationsPage() {
  const [rows, setRows] = useState<Designation[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Designation | null>(null);

  async function load() {
    const d = await fetch("/api/resources/designations").then(r => r.json()).catch(() => []);
    setRows(Array.isArray(d) ? d : []);
  }
  useEffect(() => { load(); }, []);

  const listRows = rows ?? [];
  const COLS = useMemo<ListColumn<Designation>[]>(() => [
    { key: "name", label: "Designation", sort: r => r.name, filter: { kind: "text", value: r => r.name } },
    { key: "accessLevel", label: "Report access", sort: r => r.accessLevel, filter: { kind: "multi", value: r => levelLabel(r.accessLevel) } },
    { key: "peopleCount", label: "People", align: "right", sort: r => r.peopleCount, sum: r => r.peopleCount },
    { key: "sortOrder", label: "Order", align: "right", sort: r => r.sortOrder },
    { key: "status", label: "Status", sort: r => r.status, filter: { kind: "multi", value: r => r.status } },
  ], []);
  const lv = useListView(listRows, COLS, { storageKey: "resources-designations", defaultSort: "sortOrder" });

  return (
    <ListPage>
      <ListPageHeader title="Designations" subtitle="A person's role. It decides which reports they can open.">
        <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={rows === null ? "animate-spin" : ""} /></button>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700"><Plus size={14} /> New designation</button>
      </ListPageHeader>

      {showNew && <DesignationDrawer onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}
      {editing && <DesignationDrawer item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}

      <div className="px-6 py-3 border-b border-stone-800 bg-stone-950 flex-shrink-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 mb-2">What each level can open</p>
        <dl className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-2">
          {LEVELS.map(l => (
            <div key={l.value}>
              <dt className="text-[13px] font-medium text-stone-200">{l.label}</dt>
              <dd className="text-[12px] text-stone-400">{l.plain}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[11px] text-stone-500 mt-2">Organisation admins always see everyone, whatever their designation.</p>
      </div>

      {rows === null ? (
        <p className="px-4 py-8 text-center text-[13px] text-stone-500">Loading…</p>
      ) : (
        <>
          <ListToolbar lv={lv} noun="designation" plural="designations" />
          <ListChips lv={lv} />
          <ListScroll lv={lv} empty={listRows.length === 0 ? "No designations yet — add one." : "No designations match the current filters."}>
            <table className={listTable}>
              <ListHead lv={lv} />
              <tbody>
                {lv.rows.map((r: Designation) => (
                  <tr key={r.id} onClick={() => setEditing(r)} className={`${listRow()} cursor-pointer`}>
                    <td className="px-2 py-2 text-stone-100">{r.name}</td>
                    <td className="px-2 py-2 text-stone-300">{levelLabel(r.accessLevel)}</td>
                    <td className={`${listNumCell} text-stone-300`}>{r.peopleCount}</td>
                    <td className={`${listNumCell} text-stone-400`}>{r.sortOrder}</td>
                    <td className="px-2 py-2">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${r.status === "active" ? "border-emerald-800/50 text-emerald-400 bg-emerald-500/10" : "border-stone-700 text-stone-500"}`}>{r.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              {lv.rows.length > 0 && <ListFoot lv={lv} noun="designation" plural="designations" />}
            </table>
          </ListScroll>
        </>
      )}
    </ListPage>
  );
}

function DesignationDrawer({ item, onClose, onSaved }: { item?: Designation; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!item;
  const [form, setForm] = useState({
    name: item?.name ?? "",
    accessLevel: (item?.accessLevel ?? "self") as Level,
    sortOrder: String(item?.sortOrder ?? 0),
    status: item?.status ?? "active",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    if (!form.name.trim()) { setErr("Name is required."); return; }
    setSaving(true); setErr("");
    const r = await fetch(isEdit ? `/api/resources/designations/${item!.id}` : "/api/resources/designations", {
      method: isEdit ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, sortOrder: Number(form.sortOrder) || 0 }),
    });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save."); return; }
    onSaved();
  }

  async function del() {
    if (!item || !confirm("Delete this designation?")) return;
    const r = await fetch(`/api/resources/designations/${item.id}`, { method: "DELETE" });
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not delete."); return; }
    onSaved();
  }

  const plain = LEVELS.find(l => l.value === form.accessLevel)?.plain;

  return (
    <Drawer title={isEdit ? "Edit designation" : "New designation"} onClose={onClose}
      footer={(
        <DrawerFooter saving={saving} onClose={onClose} onSave={save} err={err}
          extra={isEdit ? <button onClick={del} className="p-1.5 rounded hover:bg-stone-800 text-stone-500 hover:text-rose-400" title="Delete"><Trash2 size={14} /></button> : undefined} />
      )}>
      <div className="space-y-6">
        <Section title="Details">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Field label="Name" required className="col-span-2" hint="e.g. Team Lead, Operator, Finance Manager">
              <input className={controlInset} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </Field>
            <Field label="Report access" className="col-span-2" hint={plain}>
              <SelectField inset value={form.accessLevel} onChange={e => setForm(f => ({ ...f, accessLevel: e.target.value as Level }))}>
                {LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </SelectField>
            </Field>
            <Field label="Sort order" hint="Lower numbers list first">
              <input type="number" step="1" className={controlInset} value={form.sortOrder} onChange={e => setForm(f => ({ ...f, sortOrder: e.target.value }))} />
            </Field>
            <Field label="Status" hint="Inactive designations cannot be given to anyone new">
              <SelectField inset value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </SelectField>
            </Field>
          </div>
        </Section>
      </div>
    </Drawer>
  );
}
