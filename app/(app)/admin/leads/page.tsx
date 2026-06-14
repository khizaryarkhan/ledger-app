"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Search, FileText, Loader, X, Plus, Mail, Globe, UserPlus, Send,
  MessageSquare, CheckCircle, BookTemplate, Pencil, Trash2, ChevronDown,
} from "lucide-react";
import { Card, Badge, Toast } from "@/components/ui";

const STATUS_OPTIONS = ["new", "contacted", "qualified", "converted", "rejected", "archived"] as const;
type LeadStatus = typeof STATUS_OPTIONS[number];

const STATUS_COLOR: Record<LeadStatus, string> = {
  new:       "blue",
  contacted: "yellow",
  qualified: "green",
  converted: "emerald",
  rejected:  "neutral",
  archived:  "neutral",
};

const STATUS_LABEL: Record<LeadStatus, string> = {
  new:       "New",
  contacted: "Contacted",
  qualified: "Qualified",
  converted: "Converted",
  rejected:  "Rejected",
  archived:  "Archived",
};

// ── Inline status changer ──────────────────────────────────────────────────
function StatusCell({ lead, onChange }: { lead: any; onChange: (id: string, status: string) => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const pick = async (s: string) => {
    setOpen(false);
    if (s === lead.status) return;
    setSaving(true);
    await fetch(`/api/admin/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: s }),
    });
    onChange(lead.id, s);
    setSaving(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        disabled={saving}
        className="focus:outline-none"
      >
        {saving
          ? <Loader size={12} className="animate-spin text-stone-400" />
          : <span className="cursor-pointer hover:opacity-80 transition-opacity">
              <Badge variant={STATUS_COLOR[lead.status as LeadStatus] as any} size="sm">
                {STATUS_LABEL[lead.status as LeadStatus] ?? lead.status}
              </Badge>
            </span>
        }
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 w-36 bg-stone-800 border border-stone-700 rounded-lg shadow-xl overflow-hidden">
          {STATUS_OPTIONS.map(s => (
            <button key={s} onClick={() => pick(s)}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2 ${
                s === lead.status ? "bg-stone-700 text-white font-medium" : "text-stone-300 hover:bg-stone-700"
              }`}>
              <Badge variant={STATUS_COLOR[s] as any} size="sm">{STATUS_LABEL[s]}</Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Template form (shared by create + edit) ────────────────────────────────
function TemplateForm({
  initial, onSave, onCancel, saving,
}: {
  initial?: any;
  onSave: (data: { name: string; subject: string; body: string }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name,    setName]    = useState(initial?.name    ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [body,    setBody]    = useState(initial?.body    ?? "");

  const canSave = !saving && !!name.trim() && !!subject.trim() && !!body.trim();

  return (
    <div className="space-y-3">
      <div>
        <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Template name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Initial follow-up"
          className="w-full h-8 px-3 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 focus:ring-emerald-500 focus:outline-none" />
      </div>
      <div>
        <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Subject</label>
        <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Prime Accountax — Following up"
          className="w-full h-8 px-3 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 focus:ring-emerald-500 focus:outline-none" />
      </div>
      <div>
        <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">
          Body
          <span className="ml-2 text-stone-600 normal-case tracking-normal font-normal">
            Use {'{{firstName}}'}, {'{{companyName}}'} as placeholders
          </span>
        </label>
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={8}
          placeholder={"Hi {{firstName}},\n\nThank you for your interest in Prime Accountax.\n\n"}
          className="w-full px-3 py-2.5 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 resize-none focus:ring-emerald-500 focus:outline-none leading-relaxed" />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel}
          className="h-8 px-3 text-xs rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors">
          Cancel
        </button>
        <button onClick={() => onSave({ name, subject, body })} disabled={!canSave}
          className="h-8 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 disabled:text-stone-500 text-white transition-colors flex items-center gap-1.5">
          {saving && <Loader size={11} className="animate-spin" />}
          {initial ? "Save changes" : "Create template"}
        </button>
      </div>
    </div>
  );
}

// ── Templates management modal ─────────────────────────────────────────────
function TemplatesModal({ onClose }: { onClose: () => void }) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [view,      setView]      = useState<"list" | "create" | "edit">("list");
  const [editing,   setEditing]   = useState<any>(null);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState("");
  const [deleting,  setDeleting]  = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const r = await fetch("/api/admin/email-templates");
    if (r.ok) setTemplates(await r.json());
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (data: any) => {
    setError("");
    setSaving(true);
    const r = await fetch("/api/admin/email-templates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    const d = await r.json().catch(() => ({}));
    setSaving(false);
    if (r.ok) { setView("list"); load(); }
    else setError(d.error ?? "Failed to create template");
  };

  const handleEdit = async (data: any) => {
    setError("");
    setSaving(true);
    const r = await fetch(`/api/admin/email-templates/${editing.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    const d = await r.json().catch(() => ({}));
    setSaving(false);
    if (r.ok) { setView("list"); setEditing(null); load(); }
    else setError(d.error ?? "Failed to update template");
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    await fetch(`/api/admin/email-templates/${id}`, { method: "DELETE" });
    setTemplates(prev => prev.filter(t => t.id !== id));
    setDeleting(null);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-stone-900 rounded-xl w-full max-w-xl shadow-xl ring-1 ring-stone-800 flex flex-col" style={{ maxHeight: "min(90vh, 680px)" }}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-violet-500/15 flex items-center justify-center">
              <BookTemplate size={13} className="text-violet-400" />
            </div>
            <div>
              <h2 className="font-semibold text-white text-sm">
                {view === "create" ? "New template" : view === "edit" ? "Edit template" : "Email templates"}
              </h2>
              {view === "list" && (
                <p className="text-[10px] text-stone-500 mt-0.5">{templates.length} template{templates.length !== 1 ? "s" : ""}</p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-white">
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 min-h-0">
          {error && (
            <div className="text-xs text-rose-400 bg-rose-500/10 px-3 py-2 rounded ring-1 ring-rose-500/30 mb-3">{error}</div>
          )}

          {view === "create" && (
            <TemplateForm
              saving={saving}
              onSave={handleCreate}
              onCancel={() => { setView("list"); setError(""); }}
            />
          )}

          {view === "edit" && editing && (
            <TemplateForm
              initial={editing}
              saving={saving}
              onSave={handleEdit}
              onCancel={() => { setView("list"); setEditing(null); setError(""); }}
            />
          )}

          {view === "list" && (
            <>
              {loading ? (
                <div className="space-y-2">
                  {[1,2,3].map(i => <div key={i} className="h-16 bg-stone-800 rounded-lg animate-pulse" />)}
                </div>
              ) : templates.length === 0 ? (
                <div className="text-center py-10">
                  <BookTemplate size={24} className="text-stone-700 mx-auto mb-2" />
                  <p className="text-sm text-stone-500 font-medium">No templates yet</p>
                  <p className="text-xs text-stone-600 mt-1">Create reusable email templates for faster outreach</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {templates.map(t => (
                    <div key={t.id} className="flex items-start gap-3 p-3.5 rounded-lg border border-stone-800 bg-stone-800/30 hover:bg-stone-800/60 transition-colors group">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-white">{t.name}</p>
                        <p className="text-[11px] text-stone-500 mt-0.5 truncate">{t.subject}</p>
                        <p className="text-[11px] text-stone-600 mt-1 line-clamp-2 leading-relaxed">{t.body}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => { setEditing(t); setView("edit"); setError(""); }}
                          className="p-1.5 rounded hover:bg-stone-700 text-stone-500 hover:text-stone-200 transition-colors"
                          title="Edit"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => handleDelete(t.id)}
                          disabled={deleting === t.id}
                          className="p-1.5 rounded hover:bg-rose-500/15 text-stone-500 hover:text-rose-400 transition-colors"
                          title="Delete"
                        >
                          {deleting === t.id ? <Loader size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {view === "list" && (
          <div className="px-5 py-3 border-t border-stone-800 flex justify-between items-center shrink-0">
            <button onClick={onClose}
              className="h-8 px-3 text-xs rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors">
              Close
            </button>
            <button
              onClick={() => { setView("create"); setError(""); }}
              className="flex items-center gap-1.5 h-8 px-4 text-xs font-semibold rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors"
            >
              <Plus size={12} /> New template
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Email compose modal ────────────────────────────────────────────────────
function LeadEmailModal({ lead, onClose }: { lead: any; onClose: () => void }) {
  const firstName   = lead.fullName?.split(" ")[0] ?? "";
  const companyName = lead.companyName ?? "";

  const [subject,   setSubject]   = useState("Prime Accountax — Following up");
  const [body,      setBody]      = useState(`Hi ${firstName},\n\nThank you for your interest in Prime Accountax.\n\n`);
  const [sending,   setSending]   = useState(false);
  const [sent,      setSent]      = useState(false);
  const [errMsg,    setErrMsg]    = useState("");

  // Template picker
  const [templates,       setTemplates]       = useState<any[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [pickerOpen,      setPickerOpen]      = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const loadTemplates = async () => {
    if (templatesLoaded) return;
    const r = await fetch("/api/admin/email-templates");
    if (r.ok) setTemplates(await r.json());
    setTemplatesLoaded(true);
  };

  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [pickerOpen]);

  const applyTemplate = (tpl: any) => {
    const filled = (str: string) =>
      str.replace(/\{\{firstName\}\}/g, firstName).replace(/\{\{companyName\}\}/g, companyName);
    setSubject(filled(tpl.subject));
    setBody(filled(tpl.body));
    setPickerOpen(false);
  };

  const send = async () => {
    if (sending) return;
    setErrMsg("");
    setSending(true);
    try {
      const r = await fetch(`/api/admin/leads/${lead.id}/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject, body }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setSent(true);
      else setErrMsg(d.error ?? "Failed to send email");
    } finally { setSending(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
      <div className="bg-stone-900 rounded-xl w-full max-w-lg shadow-2xl ring-1 ring-stone-800">
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-500/15 flex items-center justify-center">
              <Mail size={13} className="text-blue-400" />
            </div>
            <div>
              <h2 className="font-semibold text-white text-sm">Send email</h2>
              <p className="text-[10px] text-stone-500 mt-0.5">to {lead.fullName} · {lead.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-white">
            <X size={15} />
          </button>
        </div>

        {sent ? (
          <div className="p-10 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-3">
              <CheckCircle size={22} className="text-emerald-400" />
            </div>
            <p className="text-sm font-semibold text-white mb-1">Email sent</p>
            <p className="text-xs text-stone-500">Your message was delivered to {lead.email}</p>
            <button onClick={onClose}
              className="mt-5 h-8 px-4 text-xs font-medium rounded-lg bg-stone-800 text-stone-200 hover:bg-stone-700 transition-colors">
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="p-5 space-y-3">
              {errMsg && (
                <div className="text-xs text-rose-400 bg-rose-500/10 px-3 py-2 rounded ring-1 ring-rose-500/30">{errMsg}</div>
              )}

              {/* Template picker */}
              <div className="flex justify-end" ref={pickerRef}>
                <div className="relative">
                  <button
                    onClick={() => { loadTemplates(); setPickerOpen(v => !v); }}
                    className="flex items-center gap-1.5 h-7 px-3 text-[11px] font-medium rounded-lg border border-stone-700 text-stone-400 hover:text-stone-200 hover:border-stone-600 transition-colors"
                  >
                    <BookTemplate size={11} className="text-violet-400" />
                    Use template
                    <ChevronDown size={10} className={`transition-transform ${pickerOpen ? "rotate-180" : ""}`} />
                  </button>
                  {pickerOpen && (
                    <div className="absolute right-0 top-full mt-1.5 z-20 w-64 bg-stone-800 border border-stone-700 rounded-xl shadow-2xl overflow-hidden">
                      {!templatesLoaded ? (
                        <div className="px-4 py-3 flex items-center gap-2 text-xs text-stone-500">
                          <Loader size={11} className="animate-spin" /> Loading…
                        </div>
                      ) : templates.length === 0 ? (
                        <div className="px-4 py-3 text-xs text-stone-500">No templates yet — create one from the Templates button.</div>
                      ) : (
                        <div className="max-h-52 overflow-y-auto">
                          {templates.map(t => (
                            <button key={t.id} onClick={() => applyTemplate(t)}
                              className="w-full text-left px-4 py-2.5 hover:bg-stone-700 transition-colors border-b border-stone-700/50 last:border-0">
                              <p className="text-xs font-medium text-stone-200">{t.name}</p>
                              <p className="text-[10px] text-stone-500 mt-0.5 truncate">{t.subject}</p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* To — read-only */}
              <div>
                <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">To</label>
                <div className="w-full h-8 px-3 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800/40 text-stone-400 flex items-center select-none">
                  {lead.email}
                </div>
              </div>

              {/* Subject */}
              <div>
                <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Subject</label>
                <input value={subject} onChange={e => setSubject(e.target.value)}
                  className="w-full h-8 px-3 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 focus:ring-blue-500 focus:outline-none" />
              </div>

              {/* Body */}
              <div>
                <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Message</label>
                <textarea value={body} onChange={e => setBody(e.target.value)} rows={9}
                  className="w-full px-3 py-2.5 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 resize-none focus:ring-blue-500 focus:outline-none leading-relaxed" />
              </div>

              <p className="text-[10px] text-stone-600">
                Sent from your platform system email (support@primeaccountax.com)
              </p>
            </div>

            <div className="px-5 py-3 border-t border-stone-800 flex justify-end gap-2">
              <button onClick={onClose}
                className="h-8 px-3 text-xs rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors">
                Cancel
              </button>
              <button onClick={send} disabled={sending || !subject.trim() || !body.trim()}
                className="h-8 px-4 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-stone-700 disabled:text-stone-500 text-white transition-colors flex items-center gap-1.5">
                {sending ? <Loader size={11} className="animate-spin" /> : <Send size={11} />}
                Send email
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Add Lead modal ─────────────────────────────────────────────────────────
function AddLeadModal({ onClose, onSaved }: { onClose: () => void; onSaved: (lead: any) => void }) {
  const [form, setForm] = useState({
    fullName: "", email: "", companyName: "", phone: "",
    country: "", interestedService: "", message: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async () => {
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/admin/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to add lead"); return; }
      onSaved(data);
      onClose();
    } finally { setSaving(false); }
  };

  const canSubmit = !saving && !!form.fullName.trim() && !!form.email.trim();

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-stone-900 rounded-xl w-full max-w-md shadow-xl ring-1 ring-stone-800">
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-500/15 flex items-center justify-center">
              <UserPlus size={13} className="text-blue-400" />
            </div>
            <h2 className="font-semibold text-white text-sm">Add lead manually</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-white"><X size={15} /></button>
        </div>
        <div className="p-5 space-y-3">
          {error && <div className="text-xs text-rose-400 bg-rose-500/10 px-3 py-2 rounded ring-1 ring-rose-500/30">{error}</div>}
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Full name <span className="text-rose-400">*</span></label>
              <input value={form.fullName} onChange={e => set("fullName", e.target.value)} placeholder="Jane Smith"
                className="w-full h-8 px-3 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 focus:ring-emerald-500 focus:outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Email <span className="text-rose-400">*</span></label>
              <input type="email" value={form.email} onChange={e => set("email", e.target.value)} placeholder="jane@company.com"
                className="w-full h-8 px-3 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 focus:ring-emerald-500 focus:outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Company</label>
              <input value={form.companyName} onChange={e => set("companyName", e.target.value)} placeholder="Acme Ltd"
                className="w-full h-8 px-3 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 focus:ring-emerald-500 focus:outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Phone</label>
              <input value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="+353 1 234 5678"
                className="w-full h-8 px-3 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 focus:ring-emerald-500 focus:outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Country</label>
              <input value={form.country} onChange={e => set("country", e.target.value)} placeholder="Ireland"
                className="w-full h-8 px-3 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 focus:ring-emerald-500 focus:outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Interested in</label>
              <input value={form.interestedService} onChange={e => set("interestedService", e.target.value)} placeholder="AR Automation"
                className="w-full h-8 px-3 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 focus:ring-emerald-500 focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Notes / Message</label>
            <textarea value={form.message} onChange={e => set("message", e.target.value)} rows={2} placeholder="Context about this lead…"
              className="w-full px-3 py-2 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 resize-none focus:ring-emerald-500 focus:outline-none" />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-stone-800 flex justify-end gap-2">
          <button onClick={onClose} className="h-8 px-3 text-xs rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors">Cancel</button>
          <button onClick={handleSubmit} disabled={!canSubmit}
            className="h-8 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 disabled:text-stone-500 text-white transition-colors flex items-center gap-1.5">
            {saving && <Loader size={11} className="animate-spin" />}
            Add lead
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Lead chat / notes thread ───────────────────────────────────────────────
function LeadNotes({ leadId }: { leadId: string }) {
  const [notes,   setNotes]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [body,    setBody]    = useState("");
  const [sending, setSending] = useState(false);
  const [error,   setError]   = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const r = await fetch(`/api/admin/leads/${leadId}/notes`);
    if (r.ok) setNotes(await r.json());
    setLoading(false);
  };

  useEffect(() => { load(); }, [leadId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [notes]);

  const send = async () => {
    if (!body.trim() || sending) return;
    setError("");
    setSending(true);
    const res = await fetch(`/api/admin/leads/${leadId}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (res.ok) {
      const note = await res.json();
      setNotes(p => [...p, note]);
      setBody("");
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Failed to save note");
    }
    setSending(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-stone-500 py-2">
            <Loader size={11} className="animate-spin" /> Loading…
          </div>
        )}
        {!loading && notes.length === 0 && (
          <div className="text-center py-6">
            <MessageSquare size={20} className="text-stone-700 mx-auto mb-2" />
            <p className="text-xs text-stone-600">No notes yet. Add the first one below.</p>
          </div>
        )}
        {notes.map(n => (
          <div key={n.id} className="flex gap-2.5">
            <div className="w-6 h-6 rounded-full bg-stone-700 flex items-center justify-center text-[10px] font-bold text-stone-300 shrink-0 mt-0.5">
              {n.authorName.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-[11px] font-semibold text-stone-300">{n.authorName}</span>
                <span className="text-[10px] text-stone-600">
                  {new Date(n.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  {" "}
                  {new Date(n.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <p className="text-xs text-stone-200 whitespace-pre-wrap leading-relaxed bg-stone-800/60 rounded-lg px-3 py-2">
                {n.body}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="px-4 pb-3 pt-2 border-t border-stone-800 shrink-0">
        {error && <p className="text-[10px] text-rose-400 mb-1.5">{error}</p>}
        <div className="flex gap-2 items-end">
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            onKeyDown={onKey}
            rows={2}
            placeholder="Add a note… (⌘↵ to send)"
            className="flex-1 px-3 py-2 text-xs rounded-lg border border-stone-700 bg-stone-800/60 text-white placeholder-stone-600 resize-none focus:border-emerald-500 focus:outline-none leading-relaxed"
          />
          <button onClick={send} disabled={!body.trim() || sending}
            className="h-9 w-9 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 flex items-center justify-center transition-colors shrink-0">
            {sending ? <Loader size={13} className="animate-spin text-white" /> : <Send size={13} className="text-white" />}
          </button>
        </div>
        <p className="text-[10px] text-stone-700 mt-1">Internal only — not visible to the lead</p>
      </div>
    </div>
  );
}

// ── Lead detail modal ──────────────────────────────────────────────────────
function LeadModal({ lead, onClose, onSave, onStatusChange, onEmail }: any) {
  const [status, setStatus] = useState<LeadStatus>(lead?.status ?? "new");
  const [saving, setSaving] = useState(false);
  const [tab,    setTab]    = useState<"details" | "notes">("details");

  if (!lead) return null;

  const handleSave = async () => {
    setSaving(true);
    await onSave(lead.id, status, lead.adminNotes);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-stone-900 rounded-xl w-full max-w-xl shadow-xl ring-1 ring-stone-800 flex flex-col" style={{ height: "min(90vh, 680px)" }}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-800 flex items-start justify-between shrink-0">
          <div>
            <h2 className="font-semibold text-white text-sm">{lead.fullName ?? "Lead"}</h2>
            <p className="text-[11px] text-stone-500 mt-0.5">{lead.companyName ? `${lead.companyName} · ` : ""}{lead.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onEmail(lead)}
              className="flex items-center gap-1.5 h-7 px-3 text-[11px] font-medium rounded-lg bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 transition-colors"
            >
              <Mail size={11} /> Email
            </button>
            <button onClick={onClose} className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-white">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-stone-800 shrink-0 px-5">
          {(["details", "notes"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-xs font-medium border-b-2 -mb-px capitalize transition-colors flex items-center gap-1.5 ${
                tab === t ? "border-emerald-500 text-emerald-400" : "border-transparent text-stone-500 hover:text-stone-300"
              }`}>
              {t === "notes" && <MessageSquare size={11} />}
              {t === "details" ? "Details" : "Notes"}
            </button>
          ))}
        </div>

        {/* Details tab */}
        {tab === "details" && (
          <div className="overflow-y-auto flex-1 p-5 space-y-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
              {[
                ["Phone",        lead.phone       ?? "—"],
                ["Country",      lead.country     ?? "—"],
                ["Company size", lead.companySize ?? "—"],
                ["Service",      lead.interestedService ?? "—"],
                ["Source",       lead.source ?? "landing_page"],
                ["Received",     new Date(lead.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-[10px] text-stone-500 mb-0.5 uppercase tracking-wider font-semibold">{label}</p>
                  <p className="text-stone-200">{value}</p>
                </div>
              ))}
            </div>

            {lead.message && (
              <div className="p-3 bg-stone-800/60 rounded-lg">
                <p className="text-[10px] text-stone-500 mb-1.5 uppercase tracking-wider font-semibold">Message</p>
                <p className="text-xs text-stone-300 whitespace-pre-wrap leading-relaxed">{lead.message}</p>
              </div>
            )}

            {(lead.utmSource || lead.utmMedium || lead.utmCampaign) && (
              <div className="flex gap-2 flex-wrap">
                {lead.utmSource   && <span className="text-[10px] text-stone-500 bg-stone-800 px-2 py-0.5 rounded font-mono">src: {lead.utmSource}</span>}
                {lead.utmMedium   && <span className="text-[10px] text-stone-500 bg-stone-800 px-2 py-0.5 rounded font-mono">med: {lead.utmMedium}</span>}
                {lead.utmCampaign && <span className="text-[10px] text-stone-500 bg-stone-800 px-2 py-0.5 rounded font-mono">cmp: {lead.utmCampaign}</span>}
              </div>
            )}

            <div>
              <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1.5">Status</label>
              <select value={status} onChange={e => setStatus(e.target.value as LeadStatus)}
                className="w-full h-8 px-2.5 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 focus:ring-emerald-500 focus:outline-none">
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* Notes tab */}
        {tab === "notes" && (
          <div className="flex-1 flex flex-col min-h-0">
            <LeadNotes leadId={lead.id} />
          </div>
        )}

        <div className="px-5 py-3 border-t border-stone-800 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="h-8 px-3 text-xs rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors">Close</button>
          {tab === "details" && (
            <button onClick={handleSave} disabled={saving}
              className="h-8 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 disabled:text-stone-500 text-white transition-colors flex items-center gap-1.5">
              {saving && <Loader size={11} className="animate-spin" />}
              Save changes
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function LeadsPage() {
  const [leads, setLeads]             = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);
  const [active, setActive]           = useState<any>(null);
  const [emailTarget, setEmailTarget] = useState<any>(null);
  const [toast, setToast]             = useState<any>(null);
  const [search, setSearch]           = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showAdd, setShowAdd]         = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search) params.set("q", search);
      const r = await fetch(`/api/admin/leads?${params}`);
      if (r.ok) setLeads((await r.json()).leads ?? []);
    } finally { setLoading(false); }
  }, [statusFilter, search]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (id: string, newStatus: string, adminNotes: string) => {
    const r = await fetch(`/api/admin/leads/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: newStatus, adminNotes }),
    });
    if (r.ok) {
      setToast({ type: "success", message: "Lead updated" });
      setActive(null);
      load();
    } else {
      const d = await r.json().catch(() => ({}));
      setToast({ type: "error", message: d.error ?? "Failed to update lead" });
    }
  };

  const handleInlineStatusChange = (id: string, newStatus: string) => {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, status: newStatus } : l));
  };

  const handleLeadAdded = (lead: any) => {
    setLeads(prev => [lead, ...prev]);
    setToast({ type: "success", message: `${lead.fullName} added as a lead` });
  };

  const stats = {
    total:      leads.length,
    new:        leads.filter(l => l.status === "new").length,
    inProgress: leads.filter(l => l.status === "contacted" || l.status === "qualified").length,
    converted:  leads.filter(l => l.status === "converted").length,
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-base font-semibold text-white">Leads</h1>
          <p className="text-xs text-stone-500 mt-0.5">Prospects and enquiries — landing page &amp; manually added</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTemplates(true)}
            className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg border border-stone-700 text-stone-400 hover:text-violet-300 hover:border-violet-700/50 hover:bg-violet-500/5 transition-colors"
          >
            <BookTemplate size={13} className="text-violet-400" />
            Templates
          </button>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors">
            <Plus size={13} /> Add lead
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {!loading && leads.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Total",       value: stats.total,      color: "text-white",       bg: "bg-stone-900" },
            { label: "New",         value: stats.new,        color: "text-blue-400",    bg: "bg-blue-500/8" },
            { label: "In progress", value: stats.inProgress, color: "text-amber-400",   bg: "bg-amber-500/8" },
            { label: "Converted",   value: stats.converted,  color: "text-emerald-400", bg: "bg-emerald-500/8" },
          ].map(s => (
            <div key={s.label} className={`rounded-xl border border-stone-800 ${s.bg} px-4 py-3`}>
              <p className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
              <p className="text-[11px] text-stone-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-500 pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, email, company…"
            className="w-full h-8 pl-8 pr-3 text-xs rounded-md border border-stone-700 bg-stone-800 text-stone-200 placeholder-stone-500 focus:outline-none focus:border-emerald-500"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300">
              <X size={12} />
            </button>
          )}
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="h-8 px-2.5 text-xs rounded-md border border-stone-700 bg-stone-800 text-stone-200 focus:outline-none focus:border-emerald-500">
          <option value="all">All statuses</option>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <button onClick={load} disabled={loading}
          className="h-8 px-3 text-xs text-stone-400 hover:text-stone-200 rounded-md border border-stone-700 bg-stone-800 hover:bg-stone-700 transition-colors flex items-center gap-1.5 disabled:opacity-50">
          {loading ? <Loader size={11} className="animate-spin" /> : "Refresh"}
        </button>
      </div>

      {/* Table */}
      <Card padding="none">
        {loading ? (
          <div className="p-5 space-y-2.5">
            {[1,2,3,4,5].map(i => <div key={i} className="h-11 bg-stone-800 rounded animate-pulse" />)}
          </div>
        ) : !leads.length ? (
          <div className="py-20 text-center">
            <FileText size={26} className="text-stone-700 mx-auto mb-3" />
            <p className="text-sm text-stone-500 font-medium">No leads found</p>
            <p className="text-xs text-stone-600 mt-1">
              {search || statusFilter !== "all" ? "Try adjusting your filters" : "Add your first lead or wait for landing page enquiries"}
            </p>
            {!search && statusFilter === "all" && (
              <button onClick={() => setShowAdd(true)}
                className="mt-4 flex items-center gap-1.5 h-8 px-4 text-xs font-medium rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800 transition-colors mx-auto">
                <Plus size={12} /> Add lead
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-800">
                {["Name / Company", "Email", "Service", "Status", "Source", "Received", ""].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-stone-500 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map((l: any) => (
                <tr key={l.id} className="border-b border-stone-800/50 hover:bg-stone-800/20 transition-colors group">
                  <td className="px-4 py-3 cursor-pointer" onClick={() => setActive(l)}>
                    <p className="text-white text-xs font-medium">{l.fullName ?? "—"}</p>
                    {l.companyName && <p className="text-[11px] text-stone-500 mt-0.5">{l.companyName}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs text-stone-300 max-w-[160px]">
                    <span className="truncate block">{l.email}</span>
                    {l.phone && <span className="text-[11px] text-stone-500">{l.phone}</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-stone-400 max-w-[120px] truncate">{l.interestedService ?? "—"}</td>
                  <td className="px-4 py-3">
                    <StatusCell lead={l} onChange={handleInlineStatusChange} />
                  </td>
                  <td className="px-4 py-3">
                    {l.source === "manual"
                      ? <span className="inline-flex items-center gap-1 text-[10px] font-medium text-stone-500 bg-stone-800 px-1.5 py-0.5 rounded"><UserPlus size={9} /> Manual</span>
                      : <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded"><Globe size={9} /> Website</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-xs text-stone-500 whitespace-nowrap">
                    {new Date(l.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={e => { e.stopPropagation(); setEmailTarget(l); }}
                        title="Email this lead"
                        className="p-1.5 rounded hover:bg-blue-500/15 text-stone-500 hover:text-blue-400 transition-colors"
                      >
                        <Mail size={13} />
                      </button>
                      <button onClick={() => setActive(l)}
                        className="text-[10px] px-2 py-1 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-800 transition-colors font-medium">
                        View
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {showTemplates && <TemplatesModal onClose={() => setShowTemplates(false)} />}
      {showAdd       && <AddLeadModal onClose={() => setShowAdd(false)} onSaved={handleLeadAdded} />}
      {active        && <LeadModal lead={active} onClose={() => setActive(null)} onSave={handleSave} onStatusChange={handleInlineStatusChange} onEmail={setEmailTarget} />}
      {emailTarget   && <LeadEmailModal lead={emailTarget} onClose={() => setEmailTarget(null)} />}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
