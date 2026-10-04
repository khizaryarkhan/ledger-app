"use client";

/**
 * List + drawer for Holiday Calendars — a region's public-holiday list.
 * Orgs with multi-region staff (e.g. UK + Ireland) need more than one;
 * `resources.holidayCalendarId` null = the org's default (is_default).
 */

import { useEffect, useState } from "react";
import { Plus, RefreshCw, Trash2, X } from "lucide-react";
import { Field, Section, controlInset, Drawer, DrawerFooter } from "@/components/form-kit";

export function HolidayCalendarList() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    setRows(await fetch("/api/resources/holiday-calendars").then(r => r.json()).catch(() => []));
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-[18px] font-semibold text-stone-100">Holiday Calendars</h1>
          <p className="text-[13px] text-stone-500">Public holidays by region — used to compute each resource's capacity.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={rows === null ? "animate-spin" : ""} /></button>
          <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700"><Plus size={14} /> New calendar</button>
        </div>
      </div>

      {rows === null ? (
        <p className="text-center text-[13px] text-stone-500 py-8">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-center text-[13px] text-stone-500 py-8">No holiday calendars yet — add one.</p>
      ) : (
        <div className="space-y-2">
          {rows.map(r => (
            <button key={r.id} onClick={() => setOpenId(r.id)} className="w-full flex items-center justify-between px-4 py-3 rounded-lg bg-stone-900 hover:bg-stone-800 border border-stone-800 text-left">
              <span className="text-[13px] text-stone-100">{r.name}</span>
              {r.isDefault && <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border border-emerald-800/50 text-emerald-400 bg-emerald-500/10">Default</span>}
            </button>
          ))}
        </div>
      )}

      {showNew && <CalendarDrawer onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}
      {openId && <CalendarDrawer id={openId} rows={rows ?? []} onClose={() => setOpenId(null)} onSaved={() => { setOpenId(null); load(); }} />}
    </div>
  );
}

function CalendarDrawer({ id, rows, onClose, onSaved }: { id?: string; rows?: any[]; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!id;
  const existing = rows?.find(r => r.id === id);
  const [name, setName] = useState(existing?.name ?? "");
  const [isDefault, setIsDefault] = useState(!!existing?.isDefault);
  const [dates, setDates] = useState<any[] | null>(null);
  const [newDate, setNewDate] = useState(""); const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");

  async function loadDates() {
    if (!id) return;
    setDates(await fetch(`/api/resources/holiday-calendars/${id}/dates`).then(r => r.json()).catch(() => []));
  }
  useEffect(() => { loadDates(); }, [id]);

  async function save() {
    if (!name.trim()) { setErr("Name is required."); return; }
    setSaving(true); setErr("");
    const r = await fetch(isEdit ? `/api/resources/holiday-calendars/${id}` : "/api/resources/holiday-calendars", {
      method: isEdit ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, isDefault }),
    });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save."); return; }
    onSaved();
  }

  async function del() {
    if (!id || !confirm("Delete this calendar?")) return;
    const r = await fetch(`/api/resources/holiday-calendars/${id}`, { method: "DELETE" });
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not delete."); return; }
    onSaved();
  }

  async function addDate() {
    if (!id || !newDate || !newName.trim()) return;
    const r = await fetch(`/api/resources/holiday-calendars/${id}/dates`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: newDate, name: newName }),
    });
    if (r.ok) { setNewDate(""); setNewName(""); loadDates(); }
  }

  async function removeDate(dateId: string) {
    if (!id) return;
    await fetch(`/api/resources/holiday-calendars/${id}/dates/${dateId}`, { method: "DELETE" });
    loadDates();
  }

  return (
    <Drawer title={isEdit ? "Edit holiday calendar" : "New holiday calendar"} onClose={onClose}
      footer={<DrawerFooter saving={saving} onClose={onClose} onSave={save} err={err}
        extra={isEdit ? <button onClick={del} className="p-1.5 rounded hover:bg-stone-800 text-stone-500 hover:text-rose-400" title="Delete"><Trash2 size={14} /></button> : undefined} />}>
      <div className="space-y-6">
        <Section title="Details">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Field label="Name" required className="col-span-2"><input className={controlInset} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. UK, Ireland" /></Field>
            <Field label="Org default calendar" className="col-span-2" hint="Resources with no calendar of their own use this one.">
              <label className="flex items-center gap-2 text-[13px] text-stone-300">
                <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} /> Make this the default
              </label>
            </Field>
          </div>
        </Section>

        {isEdit && (
          <Section title="Public holidays">
            <div className="space-y-2">
              {(dates ?? []).map(d => (
                <div key={d.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-stone-950 border border-stone-800">
                  <span className="text-[13px] text-stone-200">{d.date} — {d.name}</span>
                  <button onClick={() => removeDate(d.id)} className="p-1 rounded hover:bg-stone-800 text-stone-500 hover:text-rose-400"><X size={13} /></button>
                </div>
              ))}
              {(dates ?? []).length === 0 && <p className="text-[12px] text-stone-500">No dates yet.</p>}
              <div className="flex items-center gap-2 pt-2">
                <input type="date" className={controlInset} value={newDate} onChange={e => setNewDate(e.target.value)} />
                <input className={controlInset} placeholder="Name" value={newName} onChange={e => setNewName(e.target.value)} />
                <button onClick={addDate} className="text-[12px] font-semibold bg-stone-800 text-stone-200 rounded-lg px-3 py-2 hover:bg-stone-700 whitespace-nowrap">Add</button>
              </div>
            </div>
          </Section>
        )}
      </div>
    </Drawer>
  );
}
