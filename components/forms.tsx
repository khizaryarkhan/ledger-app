"use client";

import { useState } from "react";
import { Modal, Button, Input, Select } from "./ui";
import { useData } from "./data-provider";

// =====================
// CREATE / EDIT PROJECT
// =====================
// A project is a customer-grouping label: it has no date columns, and the
// create/edit routes would discard dates if this form offered them.
const EMPTY_PROJECT = { customerId: "", name: "", code: "", status: "Active" };

export function ProjectModal({ project, preCustomerId, onClose }: { project?: any; preCustomerId?: string; onClose: () => void }) {
  const { customers, addProject, updateProject } = useData() as any;
  const isEdit = !!project;
  const [form, setForm] = useState(project ? { ...EMPTY_PROJECT, ...project } : { ...EMPTY_PROJECT, customerId: preCustomerId || "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const handle = async () => {
    if (!form.customerId || !form.name || !form.code) { setError("Customer, name and code are required"); return; }
    setSubmitting(true); setError("");
    try {
      if (isEdit) await updateProject(project.id, form);
      else await addProject(form);
      onClose();
    } catch (e: any) { setError(e.message || "Failed to save"); }
    finally { setSubmitting(false); }
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? "Edit project" : "New project"} size="md"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={handle} disabled={submitting}>{submitting ? "Saving…" : isEdit ? "Save changes" : "Create project"}</Button>
      </>}>
      <div className="p-5 space-y-4">
        {error && <div className="text-[13px] text-rose-600 bg-rose-50 ring-1 ring-rose-200 rounded-md p-3">{error}</div>}
        <div><label className="text-[12px] font-medium text-stone-400 block mb-1">Customer *</label>
          <Select value={form.customerId} onChange={(e: any) => set("customerId", e.target.value)} className="w-full" placeholder="Select customer"
            options={customers.map((c: any) => ({ value: c.id, label: c.name }))} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-[12px] font-medium text-stone-400 block mb-1">Project name *</label><Input value={form.name} onChange={(e: any) => set("name", e.target.value)} placeholder="Cloud Migration Phase II" /></div>
          <div><label className="text-[12px] font-medium text-stone-400 block mb-1">Project code *</label><Input value={form.code} onChange={(e: any) => set("code", e.target.value)} placeholder="HTG-CM2" /></div>
        </div>
        <div><label className="text-[12px] font-medium text-stone-400 block mb-1">Status</label>
          <Select value={form.status} onChange={(e: any) => set("status", e.target.value)} className="w-full"
            options={["Pending", "Active", "In Progress", "Completed", "On Hold", "Cancelled"]} />
        </div>
      </div>
    </Modal>
  );
}

// ============================================================
// ADD CONTACT MODAL
// ============================================================
export function AddContactModal({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const { addContact } = useData();
  const [form, setForm] = useState({ name: "", title: "", email: "", phone: "", type: "Billing", isPrimary: false, isEscalation: false, receivesAuto: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (k: string, v: any) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) { setError("Name is required"); return; }
    if (!form.email.trim()) { setError("Email is required"); return; }
    setSaving(true);
    try {
      await addContact({ ...form, customerId });
      onClose();
    } catch (e: any) {
      setError(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Add contact" size="md"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Add contact"}</Button>
      </>}>
      <div className="space-y-3">
        {error && <div className="text-[13px] text-rose-600 bg-rose-50 px-3 py-2 rounded">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[12px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Full name *</label>
            <Input value={form.name} onChange={(e: any) => set("name", e.target.value)} placeholder="Jane Smith" />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Title</label>
            <Input value={form.title} onChange={(e: any) => set("title", e.target.value)} placeholder="Finance Manager" />
          </div>
        </div>
        <div>
          <label className="text-[12px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Email *</label>
          <Input type="email" value={form.email} onChange={(e: any) => set("email", e.target.value)} placeholder="jane@company.com" />
        </div>
        <div>
          <label className="text-[12px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Phone</label>
          <Input value={form.phone} onChange={(e: any) => set("phone", e.target.value)} placeholder="+353 1 234 5678" />
        </div>
        <div>
          <label className="text-[12px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Type</label>
          <Select value={form.type} onChange={(e: any) => set("type", e.target.value)} options={["Billing", "Finance", "Project", "Escalation", "Legal", "Other"]} />
        </div>
        <div className="flex flex-col gap-2 pt-1">
          {[
            { key: "isPrimary", label: "Primary contact — receives all communications" },
            { key: "isEscalation", label: "Escalation contact — CC'd on overdue notices" },
            { key: "receivesAuto", label: "Receives automated reminders" },
          ].map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 text-[13px] text-stone-400 cursor-pointer">
              <input type="checkbox" checked={(form as any)[key]} onChange={e => set(key, e.target.checked)}
                className="rounded border-stone-700" />
              {label}
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}
