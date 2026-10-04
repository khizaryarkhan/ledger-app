"use client";

/**
 * Timesheets — Log Time (Dynamics-style quick create: Date, Hours, Type,
 * conditional Project/MO/Job Work), submit/approve/reject, and the admin
 * "Post timesheets" preview-then-confirm flow (lib/payroll/timesheet-posting.ts).
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Check, X as XIcon } from "lucide-react";
import { Field, Section, SelectField, controlInset, Drawer, DrawerFooter } from "@/components/form-kit";
import { ASSIGNABLE_LABEL, ASSIGNABLE_ENDPOINT, assignableOptionLabel, type AssignableType } from "@/lib/resources/assignable";
import { localToday, fmt } from "@/lib/format";

const STATUS_LABEL: Record<string, string> = { draft: "Draft", submitted: "Submitted", approved: "Approved", rejected: "Rejected", posted: "Posted" };
const STATUS_CLASS: Record<string, string> = {
  draft: "border-stone-700 text-stone-400",
  submitted: "border-amber-800/50 text-amber-400 bg-amber-500/10",
  approved: "border-sky-800/50 text-sky-400 bg-sky-500/10",
  rejected: "border-rose-800/50 text-rose-400 bg-rose-500/10",
  posted: "border-emerald-800/50 text-emerald-400 bg-emerald-500/10",
};

export function TimesheetsConsole() {
  const [entries, setEntries] = useState<any[] | null>(null);
  const [resources, setResources] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [showPost, setShowPost] = useState(false);

  async function load() {
    const qs = statusFilter ? `?status=${statusFilter}` : "";
    setEntries(await fetch(`/api/resources/time-entries${qs}`).then(r => r.json()).catch(() => []));
  }
  useEffect(() => { load(); }, [statusFilter]);
  useEffect(() => {
    fetch("/api/resources?status=active").then(r => r.json()).then(d => setResources(Array.isArray(d) ? d : [])).catch(() => {});
    fetch("/api/resources/timesheet-types?status=active").then(r => r.json()).then(d => setTypes(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const resourceName = (id: string) => resources.find(r => r.id === id)?.name ?? "—";
  const typeOf = (id: string) => types.find(t => t.id === id);

  async function act(id: string, action: "submit" | "approve" | "reject") {
    const body = action === "reject" ? { reason: prompt("Reason for rejecting?") || "" } : undefined;
    if (action === "reject" && !body!.reason) return;
    const r = await fetch(`/api/resources/time-entries/${id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (r.ok) load(); else alert((await r.json().catch(() => ({})))?.error || "Could not update entry");
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-[18px] font-semibold text-stone-100">Timesheets</h1>
          <p className="text-[13px] text-stone-500">Log time, submit for approval, then post approved hours to the GL.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={entries === null ? "animate-spin" : ""} /></button>
          <button onClick={() => setShowPost(true)} className="text-[13px] font-semibold bg-stone-800 text-stone-200 rounded-lg px-3.5 py-2 hover:bg-stone-700">Post timesheets…</button>
          <button onClick={() => setShowLog(true)} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700"><Plus size={14} /> Log time</button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 mb-3">
        {["", "draft", "submitted", "approved", "rejected", "posted"].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`text-[12px] font-medium px-2.5 py-1 rounded-full border ${statusFilter === s ? "border-stone-500 text-stone-100 bg-stone-800" : "border-stone-800 text-stone-500 hover:text-stone-300"}`}>
            {s === "" ? "All" : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {entries === null ? (
        <p className="text-center text-[13px] text-stone-500 py-8">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-center text-[13px] text-stone-500 py-8">No time entries yet.</p>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-stone-500 border-b border-stone-800">
              <th className="py-2 pr-2 font-medium">Date</th>
              <th className="py-2 pr-2 font-medium">Resource</th>
              <th className="py-2 pr-2 font-medium">Type</th>
              <th className="py-2 pr-2 font-medium text-right">Hours</th>
              <th className="py-2 pr-2 font-medium">Against</th>
              <th className="py-2 pr-2 font-medium">Status</th>
              <th className="py-2 pr-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => {
              const type = typeOf(e.timesheetTypeId);
              return (
                <tr key={e.id} className="border-b border-stone-900">
                  <td className="py-2 pr-2 text-stone-300">{e.date}</td>
                  <td className="py-2 pr-2 text-stone-200">{resourceName(e.resourceId)}</td>
                  <td className="py-2 pr-2 text-stone-400">{type?.name ?? "—"}</td>
                  <td className="py-2 pr-2 text-right text-stone-200">{e.hours}</td>
                  <td className="py-2 pr-2 text-stone-500">{e.assignableType ? `${ASSIGNABLE_LABEL[e.assignableType as AssignableType] ?? e.assignableType}` : "—"}</td>
                  <td className="py-2 pr-2"><span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${STATUS_CLASS[e.status]}`}>{STATUS_LABEL[e.status]}</span></td>
                  <td className="py-2 pr-2 text-right space-x-2">
                    {e.status === "draft" && <button onClick={() => act(e.id, "submit")} className="text-[12px] text-stone-400 hover:text-stone-200">Submit</button>}
                    {e.status === "submitted" && (
                      <>
                        <button onClick={() => act(e.id, "approve")} className="text-[12px] text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1"><Check size={12} /> Approve</button>
                        <button onClick={() => act(e.id, "reject")} className="text-[12px] text-rose-400 hover:text-rose-300 inline-flex items-center gap-1"><XIcon size={12} /> Reject</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {showLog && <LogTimeDrawer resources={resources} types={types} onClose={() => setShowLog(false)} onSaved={() => { setShowLog(false); load(); }} />}
      {showPost && <PostTimesheetsDrawer onClose={() => setShowPost(false)} onPosted={() => { setShowPost(false); load(); }} />}
    </div>
  );
}

function LogTimeDrawer({ resources, types, onClose, onSaved }: { resources: any[]; types: any[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ resourceId: "", date: localToday(), hours: "", timesheetTypeId: "", assignableType: "" as AssignableType | "", assignableId: "", description: "" });
  const [options, setOptions] = useState<any[]>([]);
  const [leaveBalance, setLeaveBalance] = useState<number | null>(null);
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");

  const type = types.find(t => t.id === form.timesheetTypeId);

  useEffect(() => {
    if (!form.assignableType) { setOptions([]); return; }
    fetch(ASSIGNABLE_ENDPOINT[form.assignableType as AssignableType]).then(r => r.json()).then(d => setOptions(Array.isArray(d) ? d : (d?.rows ?? []))).catch(() => setOptions([]));
  }, [form.assignableType]);

  // Mirrors Dynamics' read-only "Holiday Balance (Current Year)" field —
  // only meaningful for a balance-tracked leave type once a resource is picked.
  useEffect(() => {
    if (!form.resourceId || !type || type.category !== "leave" || !type.leavePolicy) { setLeaveBalance(null); return; }
    fetch(`/api/resources/leave-balance?resourceId=${form.resourceId}&timesheetTypeId=${type.id}`)
      .then(r => r.json()).then(d => setLeaveBalance(typeof d?.balance === "number" ? d.balance : null)).catch(() => setLeaveBalance(null));
  }, [form.resourceId, form.timesheetTypeId]);

  async function save() {
    if (!form.resourceId) { setErr("Choose a resource."); return; }
    if (!form.timesheetTypeId) { setErr("Choose a type."); return; }
    const h = Number(form.hours);
    if (!Number.isFinite(h) || h <= 0) { setErr("Enter a positive number of hours."); return; }
    if (type?.requiresAssignable && (!form.assignableType || !form.assignableId)) { setErr(`"${type.name}" requires a Project, Manufacturing Order or Job Work Order.`); return; }

    setSaving(true); setErr("");
    const body: any = { resourceId: form.resourceId, date: form.date, hours: h, timesheetTypeId: form.timesheetTypeId, description: form.description || null };
    if (type?.requiresAssignable) { body.assignableType = form.assignableType; body.assignableId = form.assignableId; }
    const r = await fetch("/api/resources/time-entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save."); return; }
    onSaved();
  }

  return (
    <Drawer title="Log time" onClose={onClose} footer={<DrawerFooter saving={saving} onClose={onClose} onSave={save} err={err} saveLabel="Save" />}>
      <div className="space-y-6">
        <Section title="Details">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Field label="Resource" required className="col-span-2">
              <SelectField inset value={form.resourceId} onChange={e => setForm(f => ({ ...f, resourceId: e.target.value }))}>
                <option value="">Choose…</option>
                {resources.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </SelectField>
            </Field>
            <Field label="Date" required><input type="date" className={controlInset} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></Field>
            <Field label="Hours" required><input type="number" step="0.25" className={controlInset} value={form.hours} onChange={e => setForm(f => ({ ...f, hours: e.target.value }))} /></Field>
            <Field label="Type" required className="col-span-2">
              <SelectField inset value={form.timesheetTypeId} onChange={e => setForm(f => ({ ...f, timesheetTypeId: e.target.value, assignableType: "", assignableId: "" }))}>
                <option value="">Choose…</option>
                {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </SelectField>
            </Field>
            {leaveBalance !== null && (
              <Field label="Current balance" className="col-span-2">
                <div className={`${controlInset} flex items-center !bg-stone-950/60`}>{leaveBalance} hours</div>
              </Field>
            )}
            {type?.requiresAssignable && (
              <>
                <Field label="Against" required>
                  <SelectField inset value={form.assignableType} onChange={e => setForm(f => ({ ...f, assignableType: e.target.value as AssignableType, assignableId: "" }))}>
                    <option value="">Choose…</option>
                    <option value="project">Project</option>
                    <option value="manufacturing_order">Manufacturing Order</option>
                    <option value="job_work_order">Job Work Order</option>
                  </SelectField>
                </Field>
                <Field label={form.assignableType ? ASSIGNABLE_LABEL[form.assignableType as AssignableType] : "Item"} required>
                  <SelectField inset value={form.assignableId} onChange={e => setForm(f => ({ ...f, assignableId: e.target.value }))} disabled={!form.assignableType}>
                    <option value="">Choose…</option>
                    {options.map((o: any) => <option key={o.id} value={o.id}>{assignableOptionLabel(form.assignableType as AssignableType, o)}</option>)}
                  </SelectField>
                </Field>
              </>
            )}
            <Field label="Description" className="col-span-2">
              <textarea className={`${controlInset} !h-auto py-2`} rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </Field>
          </div>
        </Section>
      </div>
    </Drawer>
  );
}

function PostTimesheetsDrawer({ onClose, onPosted }: { onClose: () => void; onPosted: () => void }) {
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState(""); const [pendingMsg, setPendingMsg] = useState("");

  useEffect(() => {
    fetch("/api/resources/timesheets/suggested-period").then(r => r.json()).then(d => {
      if (d?.start && d?.end) { setPeriodStart(d.start); setPeriodEnd(d.end); }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  async function runPreview() {
    if (!periodStart || !periodEnd) return;
    setErr(""); setPreview(null);
    const r = await fetch(`/api/resources/timesheets/preview-post?periodStart=${periodStart}&periodEnd=${periodEnd}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(d?.error || "Could not preview this period."); return; }
    setPreview(d);
  }
  useEffect(() => { if (!loading) runPreview(); }, [loading, periodStart, periodEnd]);

  async function confirmPost() {
    setPosting(true); setErr("");
    const r = await fetch("/api/resources/timesheets/post", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ periodStart, periodEnd }) });
    const d = await r.json().catch(() => ({}));
    setPosting(false);
    if (!r.ok) { setErr(d?.error || "Could not post."); return; }
    if (d?.pending) { setPendingMsg("This exceeds your org's approval threshold and has been submitted for approval — nothing has posted yet. See Approvals."); return; }
    onPosted();
  }

  return (
    <Drawer title="Post timesheets" onClose={onClose}
      footer={<DrawerFooter saving={posting} onClose={onClose} onSave={confirmPost} saveLabel="Confirm & post" err={err} pendingMsg={pendingMsg}
        saveDisabled={!preview || !preview.groups?.length} />}>
      {loading ? <p className="text-[13px] text-stone-500">Loading…</p> : (
        <div className="space-y-6">
          <Section title="Period">
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Field label="Start"><input type="date" className={controlInset} value={periodStart} onChange={e => setPeriodStart(e.target.value)} /></Field>
              <Field label="End"><input type="date" className={controlInset} value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} /></Field>
            </div>
          </Section>
          <Section title="Preview">
            {!preview ? <p className="text-[13px] text-stone-500">{err || "Choose a period."}</p> : preview.groups.length === 0 ? (
              <p className="text-[13px] text-stone-500">Nothing approved and unposted in this period.</p>
            ) : (
              <div className="space-y-2">
                {preview.groups.map((g: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-[13px] px-3 py-2 rounded-lg bg-stone-950 border border-stone-800">
                    <span className="text-stone-300">{g.assignableId ? `${g.assignableType}:${g.assignableId}` : "General"}</span>
                    <span className="text-stone-400">{g.hours}h · {fmt.num2(g.amount)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-[13px] px-3 py-2 font-semibold text-stone-100 border-t border-stone-800 pt-3">
                  <span>Total</span><span>{preview.totalHours}h · {fmt.num2(preview.totalAmount)}</span>
                </div>
                {preview.unrated?.length > 0 && <p className="text-[12px] text-rose-400">{preview.unrated.length} entr{preview.unrated.length === 1 ? "y has" : "ies have"} no resource cost rate — set one before posting.</p>}
              </div>
            )}
          </Section>
        </div>
      )}
    </Drawer>
  );
}
