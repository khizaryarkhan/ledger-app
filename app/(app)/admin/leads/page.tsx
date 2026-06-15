"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Search, FileText, Loader, X, Plus, Mail, Globe, UserPlus, Send,
  MessageSquare, CheckCircle, BookTemplate, Pencil, Trash2, ChevronDown, StickyNote,
  Upload, Download, Square, ListTodo, Zap, Play, Pause,
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
  onSave: (data: { name: string; subject: string; body: string; stage?: string }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name,    setName]    = useState(initial?.name    ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [body,    setBody]    = useState(initial?.body    ?? "");
  const [stage,   setStage]   = useState(initial?.stage   ?? "");

  const canSave = !saving && !!name.trim() && !!subject.trim() && !!body.trim();

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5">
        <div className="col-span-2">
          <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Template name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Initial follow-up"
            className="w-full h-8 px-3 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 focus:ring-emerald-500 focus:outline-none" />
        </div>
        <div>
          <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">
            Stage
            <span className="ml-1.5 text-stone-600 normal-case tracking-normal font-normal">auto-selected in batch email</span>
          </label>
          <select value={stage} onChange={e => setStage(e.target.value)}
            className="w-full h-8 px-2.5 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 focus:ring-emerald-500 focus:outline-none">
            <option value="">Any stage</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
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
        <button onClick={() => onSave({ name, subject, body, stage: stage || undefined })} disabled={!canSave}
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
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-semibold text-white">{t.name}</p>
                          {t.stage && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded font-mono bg-stone-700 text-stone-400">{t.stage}</span>
                          )}
                        </div>
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

  const [to,        setTo]        = useState(lead.email ?? "");
  const [ccTags,    setCcTags]    = useState<string[]>([]);
  const [ccInput,   setCcInput]   = useState("");
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

  // CC tag input — add on Enter or comma
  const addCcTag = (raw: string) => {
    const email = raw.trim().replace(/,+$/, "");
    if (email && !ccTags.includes(email)) setCcTags(prev => [...prev, email]);
    setCcInput("");
  };

  const onCcKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addCcTag(ccInput);
    } else if (e.key === "Backspace" && !ccInput && ccTags.length > 0) {
      setCcTags(prev => prev.slice(0, -1));
    }
  };

  const onCcBlur = () => { if (ccInput.trim()) addCcTag(ccInput); };

  const send = async () => {
    if (sending) return;
    setErrMsg("");
    if (!to.trim()) { setErrMsg("To address is required"); return; }
    setSending(true);
    try {
      const r = await fetch(`/api/admin/leads/${lead.id}/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject, body, to: to.trim(), cc: ccTags }),
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
            <p className="text-xs text-stone-500">
              Delivered to {to}{ccTags.length > 0 ? ` + ${ccTags.length} CC` : ""}
            </p>
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

              {/* To — editable */}
              <div>
                <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">To</label>
                <input
                  type="email"
                  value={to}
                  onChange={e => setTo(e.target.value)}
                  className="w-full h-8 px-3 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              {/* CC — tag input */}
              <div>
                <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">
                  CC
                  <span className="ml-1.5 text-stone-600 normal-case tracking-normal font-normal">press Enter or comma to add</span>
                </label>
                <div
                  className="min-h-8 px-2 py-1 flex flex-wrap gap-1 items-center rounded-md ring-1 ring-stone-700 bg-stone-800 focus-within:ring-blue-500 cursor-text"
                  onClick={() => document.getElementById("cc-input")?.focus()}
                >
                  {ccTags.map(tag => (
                    <span key={tag} className="inline-flex items-center gap-1 text-[11px] bg-stone-700 text-stone-200 rounded px-2 py-0.5">
                      {tag}
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); setCcTags(prev => prev.filter(t => t !== tag)); }}
                        className="text-stone-500 hover:text-stone-200 leading-none"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    id="cc-input"
                    type="email"
                    value={ccInput}
                    onChange={e => setCcInput(e.target.value)}
                    onKeyDown={onCcKey}
                    onBlur={onCcBlur}
                    placeholder={ccTags.length === 0 ? "Add email addresses…" : ""}
                    className="flex-1 min-w-24 text-xs bg-transparent text-stone-200 placeholder-stone-600 outline-none py-0.5"
                  />
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
                <textarea value={body} onChange={e => setBody(e.target.value)} rows={8}
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
              <button onClick={send} disabled={sending || !to.trim() || !subject.trim() || !body.trim()}
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

// ── Excel import modal ────────────────────────────────────────────────────
function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: (n: number) => void }) {
  const [step,      setStep]      = useState<"upload" | "preview" | "importing" | "done">("upload");
  const [preview,   setPreview]   = useState<any[]>([]);
  const [error,     setError]     = useState("");
  const [results,   setResults]   = useState<{ inserted: number; skipped: number } | null>(null);
  const [isDragging,setIsDragging]= useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([
      ["Full Name","Email","Company","Phone","Country","Interested Service","Stage","Message"],
      ["Jane Smith","jane@company.com","Acme Ltd","+44 7700 900000","United Kingdom","AR Automation","new","Interested in automating AR"],
      ["John Doe","john@startup.io","Startup IO","+353 87 123 4567","Ireland","Invoice Management","contacted","Spoke at conference"],
    ]);
    ws["!cols"] = [{wch:20},{wch:28},{wch:20},{wch:18},{wch:15},{wch:22},{wch:12},{wch:35}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Leads");
    XLSX.writeFile(wb, "leads-import-template.xlsx");
  };

  const parseFile = async (file: File) => {
    setError("");
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    try {
      const wb   = XLSX.read(new Uint8Array(buf), { type: "array" });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
      if (rows.length < 2) { setError("File appears to be empty"); return; }

      const headers = rows[0].map((h: any) => String(h).toLowerCase().trim());
      const fieldMap: Record<string,string> = {
        "full name":"fullName","name":"fullName",
        "email":"email","e-mail":"email",
        "company":"companyName","company name":"companyName",
        "phone":"phone","telephone":"phone",
        "country":"country",
        "interested service":"interestedService","service":"interestedService","interested in":"interestedService",
        "stage":"status","status":"status",
        "message":"message","notes":"message",
      };
      const parsed = rows.slice(1)
        .filter(row => row.some((c: any) => String(c).trim()))
        .map(row => {
          const obj: Record<string,string> = {};
          headers.forEach((h, i) => { const f = fieldMap[h]; if (f && row[i] != null) obj[f] = String(row[i]).trim(); });
          return obj;
        })
        .filter(r => r.fullName && r.email);

      if (parsed.length === 0) { setError("No valid rows — make sure columns are 'Full Name' and 'Email'"); return; }
      setPreview(parsed);
      setStep("preview");
    } catch { setError("Could not read file — use a valid .xlsx or .csv"); }
  };

  const confirmImport = async () => {
    setStep("importing");
    const r = await fetch("/api/admin/leads/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rows: preview }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setResults(d); setStep("done"); onImported(d.inserted ?? 0); }
    else      { setError(d.error ?? "Import failed"); setStep("preview"); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-stone-900 rounded-xl w-full max-w-2xl shadow-2xl ring-1 ring-stone-800 flex flex-col" style={{ maxHeight: "min(90vh, 700px)" }}>
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/15 flex items-center justify-center">
              <Upload size={13} className="text-emerald-400" />
            </div>
            <div>
              <h2 className="font-semibold text-white text-sm">Import leads</h2>
              <p className="text-[10px] text-stone-500 mt-0.5">
                {step === "upload"    && "Upload an Excel or CSV file"}
                {step === "preview"   && `${preview.length} leads ready to import`}
                {step === "importing" && "Importing…"}
                {step === "done"      && "Import complete"}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-white"><X size={15} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 min-h-0">
          {error && <div className="text-xs text-rose-400 bg-rose-500/10 px-3 py-2 rounded ring-1 ring-rose-500/30 mb-4">{error}</div>}

          {step === "upload" && (
            <div className="space-y-4">
              <button onClick={downloadTemplate}
                className="w-full flex items-center gap-3 p-4 rounded-xl border border-stone-700 hover:border-emerald-600/50 hover:bg-emerald-500/5 transition-colors group">
                <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0 group-hover:bg-emerald-500/20 transition-colors">
                  <Download size={15} className="text-emerald-400" />
                </div>
                <div className="text-left">
                  <p className="text-xs font-semibold text-stone-200">Download Excel template</p>
                  <p className="text-[11px] text-stone-500 mt-0.5">Fill in your leads then upload the file below</p>
                </div>
              </button>

              <div
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) parseFile(f); }}
                onClick={() => fileRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-3 p-10 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
                  isDragging ? "border-emerald-500 bg-emerald-500/10" : "border-stone-700 hover:border-stone-600 hover:bg-stone-800/30"
                }`}
              >
                <Upload size={24} className="text-stone-600" />
                <div className="text-center">
                  <p className="text-sm font-medium text-stone-400">Drop your file here or click to browse</p>
                  <p className="text-[11px] text-stone-600 mt-1">Supports .xlsx and .csv</p>
                </div>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) parseFile(f); e.target.value = ""; }} />
              </div>

              <div className="bg-stone-800/50 rounded-lg p-3">
                <p className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2">Expected columns</p>
                <div className="flex flex-wrap gap-1.5">
                  {["Full Name *","Email *","Company","Phone","Country","Interested Service","Stage","Message"].map(c => (
                    <span key={c} className={`text-[10px] px-2 py-0.5 rounded font-mono ${c.includes("*") ? "bg-emerald-500/10 text-emerald-400" : "bg-stone-700 text-stone-400"}`}>{c}</span>
                  ))}
                </div>
                <p className="text-[10px] text-stone-600 mt-2">* Required. Stage values: new · contacted · qualified · converted · rejected · archived</p>
              </div>
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-stone-400">Reviewing <span className="font-semibold text-white">{preview.length}</span> lead{preview.length !== 1 ? "s" : ""}</p>
                <button onClick={() => setStep("upload")} className="text-[11px] text-stone-500 hover:text-stone-300">← Back</button>
              </div>
              <div className="overflow-auto rounded-lg ring-1 ring-stone-700 max-h-80">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-stone-700 bg-stone-800">
                      {["Name","Email","Company","Phone","Stage"].map(h => (
                        <th key={h} className="text-left px-3 py-2 text-[10px] text-stone-500 font-semibold uppercase tracking-wider whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="border-b border-stone-800 last:border-0">
                        <td className="px-3 py-2 text-stone-200 font-medium">{row.fullName}</td>
                        <td className="px-3 py-2 text-stone-400">{row.email}</td>
                        <td className="px-3 py-2 text-stone-400">{row.companyName ?? "—"}</td>
                        <td className="px-3 py-2 text-stone-400">{row.phone ?? "—"}</td>
                        <td className="px-3 py-2"><span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-700 text-stone-400 font-mono">{row.status ?? "new"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === "importing" && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader size={28} className="animate-spin text-emerald-400" />
              <p className="text-sm font-medium text-stone-300">Importing {preview.length} leads…</p>
            </div>
          )}

          {step === "done" && results && (
            <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
              <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
                <CheckCircle size={26} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Import complete</p>
                <p className="text-xs text-stone-500 mt-1">
                  <span className="text-emerald-400 font-semibold">{results.inserted}</span> leads imported
                  {results.skipped > 0 && <span> · <span className="text-amber-400">{results.skipped}</span> skipped (missing name or email)</span>}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-stone-800 flex justify-between items-center shrink-0">
          <button onClick={onClose} className="h-8 px-3 text-xs rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors">
            {step === "done" ? "Close" : "Cancel"}
          </button>
          {step === "preview" && (
            <button onClick={confirmImport}
              className="h-8 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors flex items-center gap-1.5">
              <Upload size={11} /> Import {preview.length} leads
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Batch email modal ──────────────────────────────────────────────────────
function BatchEmailModal({ leads, onClose, onSent }: { leads: any[]; onClose: () => void; onSent: () => void }) {
  const [templates,       setTemplates]       = useState<any[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [subject,         setSubject]         = useState("");
  const [body,            setBody]            = useState("");
  const [ccTags,          setCcTags]          = useState<string[]>([]);
  const [ccInput,         setCcInput]         = useState("");
  const [sending,         setSending]         = useState(false);
  const [progress,        setProgress]        = useState(0);
  const [results,         setResults]         = useState<{ ok: number; fail: number } | null>(null);
  const [errMsg,          setErrMsg]          = useState("");
  const [pickerOpen,      setPickerOpen]      = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/admin/email-templates").then(r => r.ok ? r.json() : []).then((data: any[]) => {
      setTemplates(data);
      setTemplatesLoaded(true);
      if (data.length > 0) {
        const stageCounts = leads.reduce((acc: Record<string,number>, l) => { acc[l.status] = (acc[l.status] ?? 0) + 1; return acc; }, {});
        const dominant    = Object.entries(stageCounts).sort((a, b) => (b[1] as number) - (a[1] as number))[0]?.[0];
        const tpl         = data.find((t: any) => t.stage === dominant) ?? data[0];
        if (tpl) { setSubject(tpl.subject); setBody(tpl.body); }
      }
    });
  }, []);

  useEffect(() => {
    if (!pickerOpen) return;
    const h = (e: MouseEvent) => { if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [pickerOpen]);

  const addCcTag = (raw: string) => {
    const email = raw.trim().replace(/,+$/, "");
    if (email && !ccTags.includes(email)) setCcTags(prev => [...prev, email]);
    setCcInput("");
  };

  const fill = (str: string, lead: any) =>
    str.replace(/\{\{firstName\}\}/g, lead.fullName?.split(" ")[0] ?? "")
       .replace(/\{\{companyName\}\}/g, lead.companyName ?? "");

  const sendBatch = async () => {
    if (sending) return;
    setSending(true);
    let ok = 0; let fail = 0;
    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];
      try {
        const r = await fetch(`/api/admin/leads/${lead.id}/email`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ to: lead.email, subject: fill(subject, lead), body: fill(body, lead), cc: ccTags }),
        });
        if (r.ok) ok++; else fail++;
      } catch { fail++; }
      setProgress(i + 1);
    }
    setResults({ ok, fail });
    setSending(false);
    onSent();
  };

  if (results) return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-stone-900 rounded-xl w-full max-w-md shadow-2xl ring-1 ring-stone-800 p-10 text-center">
        <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-4">
          <CheckCircle size={26} className="text-emerald-400" />
        </div>
        <p className="text-sm font-semibold text-white mb-1">Batch email sent</p>
        <p className="text-xs text-stone-500">
          <span className="text-emerald-400 font-semibold">{results.ok}</span> delivered
          {results.fail > 0 && <span> · <span className="text-rose-400 font-semibold">{results.fail}</span> failed</span>}
        </p>
        <button onClick={onClose} className="mt-6 h-8 px-5 text-xs font-medium rounded-lg bg-stone-800 text-stone-200 hover:bg-stone-700 transition-colors">Close</button>
      </div>
    </div>
  );

  const previewLeads = leads.slice(0, 3);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-stone-900 rounded-xl w-full max-w-lg shadow-2xl ring-1 ring-stone-800 flex flex-col" style={{ maxHeight: "min(90vh, 720px)" }}>
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-500/15 flex items-center justify-center">
              <Mail size={13} className="text-blue-400" />
            </div>
            <div>
              <h2 className="font-semibold text-white text-sm">Batch email</h2>
              <p className="text-[10px] text-stone-500 mt-0.5">Sending to {leads.length} lead{leads.length !== 1 ? "s" : ""}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-white"><X size={15} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3 min-h-0">
          {errMsg && <div className="text-xs text-rose-400 bg-rose-500/10 px-3 py-2 rounded ring-1 ring-rose-500/30">{errMsg}</div>}

          {/* Recipients */}
          <div className="flex flex-wrap gap-1.5">
            {previewLeads.map(l => (
              <span key={l.id} className="text-[10px] bg-stone-800 text-stone-400 rounded px-2 py-0.5">{l.fullName}</span>
            ))}
            {leads.length > 3 && <span className="text-[10px] bg-stone-800 text-stone-500 rounded px-2 py-0.5">+{leads.length - 3} more</span>}
          </div>

          {/* Template picker */}
          <div className="flex justify-between items-center" ref={pickerRef}>
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider">Template</label>
            <div className="relative">
              <button onClick={() => setPickerOpen(v => !v)}
                className="flex items-center gap-1.5 h-7 px-3 text-[11px] font-medium rounded-lg border border-stone-700 text-stone-400 hover:text-stone-200 hover:border-stone-600 transition-colors">
                <BookTemplate size={11} className="text-violet-400" />
                {!templatesLoaded ? "Loading…" : "Change template"}
                <ChevronDown size={10} className={`transition-transform ${pickerOpen ? "rotate-180" : ""}`} />
              </button>
              {pickerOpen && (
                <div className="absolute right-0 top-full mt-1.5 z-20 w-64 bg-stone-800 border border-stone-700 rounded-xl shadow-2xl overflow-hidden">
                  {templates.length === 0 ? (
                    <div className="px-4 py-3 text-xs text-stone-500">No templates yet</div>
                  ) : (
                    <div className="max-h-52 overflow-y-auto">
                      {templates.map((t: any) => (
                        <button key={t.id} onClick={() => { setSubject(t.subject); setBody(t.body); setPickerOpen(false); }}
                          className="w-full text-left px-4 py-2.5 hover:bg-stone-700 transition-colors border-b border-stone-700/50 last:border-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-medium text-stone-200">{t.name}</p>
                            {t.stage && <span className="text-[9px] bg-stone-600 text-stone-400 rounded px-1 font-mono">{t.stage}</span>}
                          </div>
                          <p className="text-[10px] text-stone-500 mt-0.5 truncate">{t.subject}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* CC */}
          <div>
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">
              CC <span className="ml-1 text-stone-600 normal-case font-normal tracking-normal">press Enter to add</span>
            </label>
            <div className="min-h-8 px-2 py-1 flex flex-wrap gap-1 items-center rounded-md ring-1 ring-stone-700 bg-stone-800 focus-within:ring-blue-500 cursor-text"
              onClick={() => document.getElementById("bcc-input")?.focus()}>
              {ccTags.map(tag => (
                <span key={tag} className="inline-flex items-center gap-1 text-[11px] bg-stone-700 text-stone-200 rounded px-2 py-0.5">
                  {tag}
                  <button type="button" onClick={e => { e.stopPropagation(); setCcTags(p => p.filter(t => t !== tag)); }} className="text-stone-500 hover:text-stone-200 leading-none">×</button>
                </span>
              ))}
              <input id="bcc-input" type="email" value={ccInput} onChange={e => setCcInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addCcTag(ccInput); } }}
                onBlur={() => { if (ccInput.trim()) addCcTag(ccInput); }}
                placeholder={ccTags.length === 0 ? "Add CC addresses…" : ""}
                className="flex-1 min-w-24 text-xs bg-transparent text-stone-200 placeholder-stone-600 outline-none py-0.5" />
            </div>
          </div>

          {/* Subject */}
          <div>
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Your subject line"
              className="w-full h-8 px-3 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 focus:ring-blue-500 focus:outline-none" />
          </div>

          {/* Body */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider">Message</label>
              <span className="text-[10px] text-stone-600">{'{{firstName}}'} and {'{{companyName}}'} personalised per lead</span>
            </div>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={6}
              placeholder={"Hi {{firstName}},\n\nThank you for your interest…"}
              className="w-full px-3 py-2.5 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 resize-none focus:ring-blue-500 focus:outline-none leading-relaxed" />
          </div>

          {/* First-lead preview */}
          {subject && body && previewLeads[0] && (
            <div className="rounded-lg p-3 bg-stone-800/50 ring-1 ring-stone-700/50">
              <p className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-1.5">Preview · {previewLeads[0].fullName}</p>
              <p className="text-[11px] font-medium text-stone-300">{fill(subject, previewLeads[0])}</p>
              <p className="text-[11px] text-stone-500 mt-1 line-clamp-2 whitespace-pre-wrap">{fill(body, previewLeads[0])}</p>
            </div>
          )}

          {/* Progress bar */}
          {sending && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-stone-400">
                <span>Sending…</span><span>{progress}/{leads.length}</span>
              </div>
              <div className="h-1.5 bg-stone-800 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all duration-200" style={{ width: `${(progress / leads.length) * 100}%` }} />
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-stone-800 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} disabled={sending}
            className="h-8 px-3 text-xs rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 disabled:opacity-40 transition-colors">
            Cancel
          </button>
          <button onClick={sendBatch} disabled={sending || !subject.trim() || !body.trim()}
            className="h-8 px-4 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-stone-700 disabled:text-stone-500 text-white transition-colors flex items-center gap-1.5">
            {sending ? <Loader size={11} className="animate-spin" /> : <Send size={11} />}
            {sending ? `Sending ${progress}/${leads.length}…` : `Send to ${leads.length} leads`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Follow-up tasks panel ──────────────────────────────────────────────────
function LeadTasks({ leadId }: { leadId: string }) {
  const [tasks,   setTasks]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [title,   setTitle]   = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState("");

  useEffect(() => {
    fetch(`/api/admin/leads/${leadId}/tasks`).then(r => r.ok ? r.json() : [])
      .then(data => { setTasks(data); setLoading(false); });
  }, [leadId]);

  const addTask = async () => {
    if (!title.trim() || saving) return;
    setError("");
    setSaving(true);
    const r = await fetch(`/api/admin/leads/${leadId}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: title.trim(), dueDate: dueDate || null }),
    });
    if (r.ok) { const t = await r.json(); setTasks(prev => [...prev, t]); setTitle(""); setDueDate(""); }
    else      { const d = await r.json().catch(() => ({})); setError(d.error ?? "Failed to create task"); }
    setSaving(false);
  };

  const toggleTask = async (taskId: string, completed: boolean) => {
    const r = await fetch(`/api/admin/leads/${leadId}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ completed }),
    });
    if (r.ok) setTasks(prev => prev.map(t => t.id === taskId ? { ...t, completedAt: completed ? new Date().toISOString() : null } : t));
  };

  const pending   = tasks.filter(t => !t.completedAt);
  const completed = tasks.filter(t =>  t.completedAt);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto p-3 space-y-2 min-h-0">
        {loading && <div className="text-[12px] text-stone-600 text-center py-6 flex items-center justify-center gap-2"><Loader size={12} className="animate-spin" /> Loading…</div>}
        {!loading && tasks.length === 0 && <div className="text-[12px] text-stone-600 text-center py-6">No tasks yet</div>}
        {pending.map(t => {
          const overdue = t.dueDate && new Date(t.dueDate) < new Date();
          return (
            <div key={t.id} className="rounded-lg px-3 py-2 border-l-2 border-amber-500 bg-amber-950/20 flex items-start gap-2.5">
              <button onClick={() => toggleTask(t.id, true)} className="mt-0.5 shrink-0 text-amber-500 hover:text-emerald-400 transition-colors">
                <Square size={13} />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-stone-200">{t.title}</p>
                {t.dueDate && (
                  <p className={`text-[10px] mt-0.5 ${overdue ? "text-rose-400" : "text-stone-500"}`}>
                    {overdue ? "Overdue · " : "Due "}
                    {new Date(t.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </p>
                )}
              </div>
            </div>
          );
        })}
        {completed.length > 0 && (
          <>
            <p className="text-[10px] text-stone-600 px-1 pt-1">Completed</p>
            {completed.map(t => (
              <div key={t.id} className="rounded-lg px-3 py-2 border-l-2 border-stone-700 flex items-start gap-2.5 opacity-50">
                <button onClick={() => toggleTask(t.id, false)} className="mt-0.5 shrink-0 text-emerald-600 hover:text-amber-500 transition-colors">
                  <CheckCircle size={13} />
                </button>
                <p className="text-[12px] text-stone-500 line-through">{t.title}</p>
              </div>
            ))}
          </>
        )}
      </div>
      <div className="p-2.5 border-t border-stone-800 flex-shrink-0">
        {error && <p className="text-[10px] text-rose-400 mb-1.5 px-1">{error}</p>}
        <div className="text-[10px] text-stone-600 font-medium mb-1.5 px-1">New task</div>
        <div className="flex items-center gap-1.5">
          <input value={title} onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTask(); } }}
            placeholder="Task description…"
            className="flex-1 text-[12px] border border-stone-700 rounded-lg px-2.5 py-1.5 bg-stone-900 text-stone-300 placeholder-stone-600 outline-none focus:ring-1 focus:ring-amber-500" />
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
            className="text-[11px] border border-stone-700 rounded-lg px-2 py-1.5 bg-stone-900 text-stone-400 outline-none focus:ring-1 focus:ring-amber-500 w-28" />
          <button onClick={addTask} disabled={saving || !title.trim()}
            className="text-[11px] font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg px-3 py-1.5 disabled:opacity-40 transition-colors flex items-center">
            {saving ? <Loader size={11} className="animate-spin" /> : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Activity panel (notes + tasks + enrolment) ────────────────────────────
function ActivityPanel({ leadId, onCountChange }: { leadId: string; onCountChange?: (n: number) => void }) {
  const [tab,         setTab]         = useState<"activity" | "tasks">("activity");
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [sequences,   setSequences]   = useState<any[]>([]);
  const [enrollOpen,  setEnrollOpen]  = useState(false);
  const enrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/admin/leads/${leadId}/enrollments`).then(r => r.ok ? r.json() : []).then(setEnrollments);
    fetch("/api/admin/sequences").then(r => r.ok ? r.json() : [])
      .then((data: any[]) => setSequences(data.filter(s => s.isActive)));
  }, [leadId]);

  useEffect(() => {
    if (!enrollOpen) return;
    const h = (e: MouseEvent) => { if (enrollRef.current && !enrollRef.current.contains(e.target as Node)) setEnrollOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [enrollOpen]);

  const enroll = async (sequenceId: string) => {
    setEnrollOpen(false);
    const r = await fetch(`/api/admin/leads/${leadId}/enrollments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sequenceId }),
    });
    if (r.ok) setEnrollments(prev => [...prev, await r.json()]);
  };

  const cancelEnrollment = async (enrollmentId: string) => {
    const r = await fetch(`/api/admin/leads/${leadId}/enrollments/${enrollmentId}`, { method: "DELETE" });
    if (r.ok) setEnrollments(prev => prev.map(e => e.id === enrollmentId ? { ...e, status: "cancelled" } : e));
  };

  const activeEnrollments = enrollments.filter(e => e.status === "active");
  const canEnroll = sequences.filter(s => !activeEnrollments.some(e => e.sequenceId === s.id));

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Sequence enrolment bar */}
      {(activeEnrollments.length > 0 || sequences.length > 0) && (
        <div className="px-3 py-2 border-b border-stone-800 flex items-center gap-2 flex-wrap shrink-0" ref={enrollRef}>
          {activeEnrollments.map(e => (
            <div key={e.id} className="flex items-center gap-1 text-[10px] bg-purple-500/10 text-purple-300 rounded-full px-2 py-0.5 border border-purple-500/20">
              <Zap size={9} />
              <span className="max-w-[90px] truncate">{e.sequenceName}</span>
              <button onClick={() => cancelEnrollment(e.id)} className="text-purple-400 hover:text-rose-400 leading-none ml-0.5" title="Cancel">×</button>
            </div>
          ))}
          {canEnroll.length > 0 && (
            <div className="relative">
              <button onClick={() => setEnrollOpen(v => !v)}
                className="flex items-center gap-1 text-[10px] text-stone-500 hover:text-purple-400 transition-colors">
                <Zap size={10} /> Enroll in sequence
              </button>
              {enrollOpen && (
                <div className="absolute left-0 top-full mt-1 z-30 w-52 bg-stone-800 border border-stone-700 rounded-lg shadow-xl overflow-hidden">
                  {canEnroll.map((s: any) => (
                    <button key={s.id} onClick={() => enroll(s.id)}
                      className="w-full text-left px-3 py-2.5 text-xs hover:bg-stone-700 transition-colors border-b border-stone-700/50 last:border-0">
                      <p className="font-medium text-stone-200">{s.name}</p>
                      <p className="text-[10px] text-stone-500 mt-0.5">{s.stepCount} step{s.stepCount !== 1 ? "s" : ""}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-stone-800 shrink-0">
        <button onClick={() => setTab("activity")}
          className={`flex-1 py-2 text-[11px] font-medium transition-colors flex items-center justify-center gap-1.5 ${tab === "activity" ? "text-stone-200 border-b-2 border-emerald-500 -mb-px" : "text-stone-500 hover:text-stone-300"}`}>
          <MessageSquare size={11} /> Activity
        </button>
        <button onClick={() => setTab("tasks")}
          className={`flex-1 py-2 text-[11px] font-medium transition-colors flex items-center justify-center gap-1.5 ${tab === "tasks" ? "text-stone-200 border-b-2 border-amber-500 -mb-px" : "text-stone-500 hover:text-stone-300"}`}>
          <ListTodo size={11} /> Tasks
        </button>
      </div>
      {tab === "activity"
        ? <LeadNotes leadId={leadId} onCountChange={onCountChange} />
        : <LeadTasks leadId={leadId} />
      }
    </div>
  );
}

// ── Sequences management modal ─────────────────────────────────────────────
function SequencesModal({ onClose }: { onClose: () => void }) {
  const [sequences, setSequences] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [view,      setView]      = useState<"list" | "edit">("list");
  const [editing,   setEditing]   = useState<any>(null);
  const [steps,     setSteps]     = useState<any[]>([]);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState("");

  // Sequence form
  const [seqName, setSeqName]           = useState("");
  const [seqDesc, setSeqDesc]           = useState("");
  const [seqActive, setSeqActive]       = useState(true);

  // Step form
  const [addingStep,    setAddingStep]  = useState(false);
  const [stepDelay,     setStepDelay]   = useState(1);
  const [stepSubject,   setStepSubject] = useState("");
  const [stepBody,      setStepBody]    = useState("");
  const [stepSaving,    setStepSaving]  = useState(false);

  const loadSequences = async () => {
    setLoading(true);
    const r = await fetch("/api/admin/sequences");
    if (r.ok) setSequences(await r.json());
    setLoading(false);
  };

  useEffect(() => { loadSequences(); }, []);

  const openEdit = async (seq: any | null) => {
    setEditing(seq);
    setSeqName(seq?.name ?? "");
    setSeqDesc(seq?.description ?? "");
    setSeqActive(seq?.isActive ?? true);
    setSteps([]);
    setAddingStep(false);
    setError("");
    if (seq) {
      const r = await fetch(`/api/admin/sequences/${seq.id}/steps`);
      if (r.ok) setSteps(await r.json());
    }
    setView("edit");
  };

  const saveSequence = async () => {
    if (!seqName.trim()) { setError("Name is required"); return; }
    setSaving(true); setError("");
    const url    = editing ? `/api/admin/sequences/${editing.id}` : "/api/admin/sequences";
    const method = editing ? "PATCH" : "POST";
    const r = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: seqName.trim(), description: seqDesc.trim(), isActive: seqActive }),
    });
    const d = await r.json().catch(() => ({}));
    setSaving(false);
    if (r.ok) {
      if (!editing) { setEditing(d); loadSequences(); }
      else          { setSequences(prev => prev.map(s => s.id === d.id ? { ...d, stepCount: s.stepCount } : s)); setEditing(d); }
    } else { setError(d.error ?? "Failed to save"); }
  };

  const deleteSequence = async (id: string) => {
    await fetch(`/api/admin/sequences/${id}`, { method: "DELETE" });
    setSequences(prev => prev.filter(s => s.id !== id));
    if (editing?.id === id) { setView("list"); setEditing(null); }
  };

  const toggleActive = async (seq: any) => {
    const r = await fetch(`/api/admin/sequences/${seq.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: !seq.isActive }),
    });
    if (r.ok) setSequences(prev => prev.map(s => s.id === seq.id ? { ...s, isActive: !s.isActive } : s));
  };

  const addStep = async () => {
    if (!stepSubject.trim() || !stepBody.trim() || !editing) return;
    setStepSaving(true);
    const r = await fetch(`/api/admin/sequences/${editing.id}/steps`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ delayDays: stepDelay, subject: stepSubject.trim(), body: stepBody.trim() }),
    });
    if (r.ok) {
      setSteps(prev => [...prev, await r.json()]);
      setStepSubject(""); setStepBody(""); setStepDelay(1); setAddingStep(false);
      setSequences(prev => prev.map(s => s.id === editing.id ? { ...s, stepCount: (s.stepCount ?? 0) + 1 } : s));
    }
    setStepSaving(false);
  };

  const deleteStep = async (stepId: string) => {
    await fetch(`/api/admin/sequences/${editing.id}/steps/${stepId}`, { method: "DELETE" });
    setSteps(prev => prev.filter(s => s.id !== stepId));
    setSequences(prev => prev.map(s => s.id === editing!.id ? { ...s, stepCount: Math.max(0, (s.stepCount ?? 1) - 1) } : s));
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-stone-900 rounded-xl w-full max-w-2xl shadow-xl ring-1 ring-stone-800 flex flex-col" style={{ maxHeight: "min(90vh, 720px)" }}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-purple-500/15 flex items-center justify-center">
              <Zap size={13} className="text-purple-400" />
            </div>
            <div>
              <h2 className="font-semibold text-white text-sm">
                {view === "list" ? "Email sequences" : editing ? `Editing: ${editing.name}` : "New sequence"}
              </h2>
              {view === "list" && <p className="text-[10px] text-stone-500 mt-0.5">{sequences.length} sequence{sequences.length !== 1 ? "s" : ""}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {view === "edit" && (
              <button onClick={() => { setView("list"); setEditing(null); }}
                className="h-7 px-3 text-[11px] text-stone-400 hover:text-stone-200 hover:bg-stone-800 rounded-lg transition-colors">
                ← Back
              </button>
            )}
            <button onClick={onClose} className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-white"><X size={15} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 min-h-0">
          {error && <div className="text-xs text-rose-400 bg-rose-500/10 px-3 py-2 rounded ring-1 ring-rose-500/30 mb-3">{error}</div>}

          {/* LIST */}
          {view === "list" && (
            loading ? (
              <div className="space-y-2">{[1,2].map(i => <div key={i} className="h-20 bg-stone-800 rounded-lg animate-pulse" />)}</div>
            ) : sequences.length === 0 ? (
              <div className="text-center py-12">
                <Zap size={24} className="text-stone-700 mx-auto mb-2" />
                <p className="text-sm text-stone-500 font-medium">No sequences yet</p>
                <p className="text-xs text-stone-600 mt-1">Automate follow-ups — enrol leads and emails send on schedule</p>
              </div>
            ) : (
              <div className="space-y-2">
                {sequences.map(s => (
                  <div key={s.id} className="flex items-center gap-3 p-3.5 rounded-lg border border-stone-800 bg-stone-800/30 hover:bg-stone-800/60 transition-colors group">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-semibold text-white">{s.name}</p>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${s.isActive ? "bg-emerald-500/15 text-emerald-400" : "bg-stone-700 text-stone-500"}`}>
                          {s.isActive ? "active" : "paused"}
                        </span>
                        <span className="text-[10px] text-stone-600">{s.stepCount ?? 0} step{s.stepCount !== 1 ? "s" : ""}</span>
                      </div>
                      {s.description && <p className="text-[11px] text-stone-500 mt-0.5 truncate">{s.description}</p>}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button onClick={() => toggleActive(s)} title={s.isActive ? "Pause" : "Activate"}
                        className="p-1.5 rounded hover:bg-stone-700 text-stone-500 hover:text-stone-200 transition-colors">
                        {s.isActive ? <Pause size={12} /> : <Play size={12} />}
                      </button>
                      <button onClick={() => openEdit(s)}
                        className="p-1.5 rounded hover:bg-stone-700 text-stone-500 hover:text-stone-200 transition-colors">
                        <Pencil size={12} />
                      </button>
                      <button onClick={() => deleteSequence(s.id)}
                        className="p-1.5 rounded hover:bg-rose-500/15 text-stone-500 hover:text-rose-400 transition-colors">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* EDIT / CREATE */}
          {view === "edit" && (
            <div className="space-y-5">
              {/* Sequence details */}
              <div className="p-4 rounded-lg bg-stone-800/30 ring-1 ring-stone-800 space-y-3">
                <div>
                  <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Sequence name</label>
                  <input value={seqName} onChange={e => setSeqName(e.target.value)} placeholder="e.g. New lead nurture"
                    className="w-full h-8 px-3 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 focus:ring-purple-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Description</label>
                  <input value={seqDesc} onChange={e => setSeqDesc(e.target.value)} placeholder="Optional description"
                    className="w-full h-8 px-3 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 focus:ring-purple-500 focus:outline-none" />
                </div>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={seqActive} onChange={e => setSeqActive(e.target.checked)} className="rounded accent-emerald-500" />
                    <span className="text-xs text-stone-300">Active — new enrolments will send automatically</span>
                  </label>
                  <button onClick={saveSequence} disabled={saving || !seqName.trim()}
                    className="h-8 px-4 text-xs font-semibold rounded-lg bg-purple-600 hover:bg-purple-500 disabled:bg-stone-700 disabled:text-stone-500 text-white transition-colors flex items-center gap-1.5">
                    {saving && <Loader size={11} className="animate-spin" />}
                    {editing ? "Save" : "Create sequence"}
                  </button>
                </div>
              </div>

              {/* Steps — only show once the sequence exists */}
              {editing && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">Steps ({steps.length})</p>
                    {!addingStep && (
                      <button onClick={() => setAddingStep(true)}
                        className="flex items-center gap-1 h-6 px-2.5 text-[11px] font-medium rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-400 hover:text-stone-200 transition-colors">
                        <Plus size={10} /> Add step
                      </button>
                    )}
                  </div>

                  {steps.length === 0 && !addingStep && (
                    <div className="text-center py-6 rounded-lg border border-dashed border-stone-700">
                      <p className="text-xs text-stone-600">No steps yet — add the first email in this sequence</p>
                    </div>
                  )}

                  <div className="space-y-2">
                    {steps.map((step, idx) => (
                      <div key={step.id} className="rounded-lg p-3.5 bg-stone-800/30 ring-1 ring-stone-800 group">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded">Step {idx + 1}</span>
                            <span className="text-[10px] text-stone-500">
                              {step.delayDays === 0 ? "Immediately on enrolment" : `${step.delayDays} day${step.delayDays !== 1 ? "s" : ""} after ${idx === 0 ? "enrolment" : "previous step"}`}
                            </span>
                          </div>
                          <button onClick={() => deleteStep(step.id)}
                            className="p-1 rounded hover:bg-rose-500/15 text-stone-600 hover:text-rose-400 transition-colors opacity-0 group-hover:opacity-100">
                            <Trash2 size={11} />
                          </button>
                        </div>
                        <p className="text-[11px] font-medium text-stone-300">{step.subject}</p>
                        <p className="text-[11px] text-stone-500 mt-0.5 line-clamp-2 whitespace-pre-wrap">{step.body}</p>
                      </div>
                    ))}

                    {addingStep && (
                      <div className="rounded-lg p-4 ring-1 ring-purple-500/30 bg-purple-500/5 space-y-3">
                        <p className="text-[10px] font-semibold text-purple-400 uppercase tracking-wider">Step {steps.length + 1}</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">
                              Delay (days after {steps.length === 0 ? "enrolment" : "previous step"})
                            </label>
                            <input type="number" min={0} value={stepDelay} onChange={e => setStepDelay(Number(e.target.value))}
                              className="w-full h-8 px-3 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 focus:ring-purple-500 focus:outline-none" />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Subject</label>
                            <input value={stepSubject} onChange={e => setStepSubject(e.target.value)} placeholder="Email subject"
                              className="w-full h-8 px-3 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 focus:ring-purple-500 focus:outline-none" />
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">
                            Body <span className="ml-1.5 text-stone-600 normal-case font-normal tracking-normal">{'{{firstName}}'}, {'{{companyName}}'} supported</span>
                          </label>
                          <textarea value={stepBody} onChange={e => setStepBody(e.target.value)} rows={5}
                            placeholder={"Hi {{firstName}},\n\n"}
                            className="w-full px-3 py-2.5 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 resize-none focus:ring-purple-500 focus:outline-none leading-relaxed" />
                        </div>
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setAddingStep(false)}
                            className="h-7 px-3 text-[11px] text-stone-400 hover:text-stone-200 hover:bg-stone-800 rounded-lg transition-colors">Cancel</button>
                          <button onClick={addStep} disabled={stepSaving || !stepSubject.trim() || !stepBody.trim()}
                            className="h-7 px-3 text-[11px] font-semibold rounded-lg bg-purple-600 hover:bg-purple-500 disabled:bg-stone-700 disabled:text-stone-500 text-white transition-colors flex items-center gap-1">
                            {stepSaving && <Loader size={10} className="animate-spin" />} Add step
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {view === "list" && (
          <div className="px-5 py-3 border-t border-stone-800 flex justify-between items-center shrink-0">
            <button onClick={onClose} className="h-8 px-3 text-xs rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors">Close</button>
            <button onClick={() => openEdit(null)}
              className="flex items-center gap-1.5 h-8 px-4 text-xs font-semibold rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition-colors">
              <Plus size={12} /> New sequence
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Lead activity / notes thread ──────────────────────────────────────────
function LeadNotes({ leadId, onCountChange }: { leadId: string; onCountChange?: (n: number) => void }) {
  const [notes,   setNotes]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [text,    setText]    = useState("");
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const r = await fetch(`/api/admin/leads/${leadId}/notes`);
    if (r.ok) {
      const data = await r.json();
      setNotes(data);
      onCountChange?.(data.length);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [leadId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [notes]);

  const add = async () => {
    if (!text.trim() || saving) return;
    setError("");
    setSaving(true);
    const res = await fetch(`/api/admin/leads/${leadId}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: text }),
    });
    if (res.ok) {
      const note = await res.json();
      const updated = [...notes, note];
      setNotes(updated);
      onCountChange?.(updated.length);
      setText("");
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Failed to save note");
    }
    setSaving(false);
  };

  const sorted = [...notes].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return (
    <div className="flex flex-col h-full">
      {/* Feed */}
      <div className="flex-1 overflow-auto p-3 space-y-2 min-h-0">
        {loading && (
          <div className="text-[12px] text-stone-600 text-center py-6 flex items-center justify-center gap-2">
            <Loader size={12} className="animate-spin" /> Loading…
          </div>
        )}
        {!loading && sorted.length === 0 && (
          <div className="text-[12px] text-stone-600 text-center py-6">No activity yet</div>
        )}
        {sorted.map(n => {
          const ts      = new Date(n.createdAt);
          const dateStr = ts.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
          const timeStr = ts.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

          // Detect email-log entries (stored as JSON by the email API)
          let emailData: { subject: string; preview: string; to?: string; cc?: string[] } | null = null;
          try {
            const parsed = JSON.parse(n.body);
            if (parsed._type === "email") emailData = parsed;
          } catch {}

          if (emailData) {
            return (
              <div key={n.id} className="rounded-lg px-3 py-2 border-l-2 border-blue-500 bg-blue-950/20">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold text-blue-400">
                    <Mail size={11} />
                    <span>{n.authorName} · email sent</span>
                  </div>
                  <span className="text-[10px] text-stone-600 tabular-nums flex-shrink-0">{dateStr} {timeStr}</span>
                </div>
                {emailData.to && (
                  <div className="text-[10px] text-stone-500 mb-0.5">
                    <span className="text-stone-600">To: </span>{emailData.to}
                    {emailData.cc && emailData.cc.length > 0 && (
                      <span> · <span className="text-stone-600">CC: </span>{emailData.cc.join(", ")}</span>
                    )}
                  </div>
                )}
                <div className="text-[11px] font-medium text-stone-300 mb-1">{emailData.subject}</div>
                <div className="text-[12px] text-stone-400 whitespace-pre-wrap leading-relaxed line-clamp-3">{emailData.preview}</div>
              </div>
            );
          }

          return (
            <div key={n.id} className="rounded-lg px-3 py-2 border-l-2 border-stone-600">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-stone-400">
                  <StickyNote size={11} />
                  <span>{n.authorName}</span>
                </div>
                <span className="text-[10px] text-stone-600 tabular-nums flex-shrink-0">
                  {dateStr} {timeStr}
                </span>
              </div>
              <div className="text-[12px] text-stone-300 whitespace-pre-wrap leading-relaxed">{n.body}</div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-2.5 border-t border-stone-800 flex-shrink-0">
        {error && <p className="text-[10px] text-rose-400 mb-1.5 px-1">{error}</p>}
        <div className="text-[10px] text-stone-600 font-medium mb-1.5 px-1">Internal note</div>
        <div className="flex items-center gap-1.5">
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); add(); } }}
            placeholder="Write a note…"
            className="flex-1 text-[12px] border border-stone-700 rounded-lg px-2.5 py-1.5 bg-stone-900 text-stone-300 placeholder-stone-600 outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <button
            onClick={add}
            disabled={saving || !text.trim()}
            className="text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg px-3 py-1.5 disabled:opacity-40 transition-colors flex items-center"
          >
            {saving ? <Loader size={11} className="animate-spin" /> : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Lead detail modal (no Activity tab — panel is inline on the row) ────────
function LeadModal({ lead, onClose, onSave, onEmail }: any) {
  const [status, setStatus] = useState<LeadStatus>(lead?.status ?? "new");
  const [saving, setSaving] = useState(false);

  if (!lead) return null;

  const handleSave = async () => {
    setSaving(true);
    await onSave(lead.id, status, lead.adminNotes);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-stone-900 rounded-xl w-full max-w-xl shadow-xl ring-1 ring-stone-800 flex flex-col" style={{ maxHeight: "min(90vh, 600px)" }}>
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

        {/* Details */}
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

        <div className="px-5 py-3 border-t border-stone-800 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="h-8 px-3 text-xs rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors">Close</button>
          <button onClick={handleSave} disabled={saving}
            className="h-8 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 disabled:text-stone-500 text-white transition-colors flex items-center gap-1.5">
            {saving && <Loader size={11} className="animate-spin" />}
            Save changes
          </button>
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
  const [notesOpenId, setNotesOpenId] = useState<string | null>(null);
  const [noteCounts, setNoteCounts]   = useState<Record<string, number>>({});
  const [toast, setToast]             = useState<any>(null);
  const [search, setSearch]           = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showAdd, setShowAdd]         = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showImport, setShowImport]         = useState(false);
  const [showSequences, setShowSequences]   = useState(false);
  const [selected, setSelected]             = useState<Set<string>>(new Set());
  const [showBatchEmail, setShowBatchEmail] = useState(false);

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

  const toggleSelect = (id: string) =>
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selectAll = () => setSelected(new Set(leads.map(l => l.id)));
  const clearSelect = () => setSelected(new Set());

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
          <button
            onClick={() => setShowSequences(true)}
            className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg border border-stone-700 text-stone-400 hover:text-purple-300 hover:border-purple-700/50 hover:bg-purple-500/5 transition-colors"
          >
            <Zap size={13} className="text-purple-400" />
            Sequences
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg border border-stone-700 text-stone-400 hover:text-emerald-300 hover:border-emerald-700/50 hover:bg-emerald-500/5 transition-colors"
          >
            <Upload size={13} className="text-emerald-400" />
            Import
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
                <th className="pl-4 py-2.5 w-8">
                  <input type="checkbox"
                    checked={selected.size === leads.length && leads.length > 0}
                    onChange={e => e.target.checked ? selectAll() : clearSelect()}
                    className="rounded border-stone-600 bg-stone-800 accent-emerald-500 cursor-pointer"
                  />
                </th>
                {["Name / Company", "Email", "Service", "Status", "Source", "Received", ""].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-stone-500 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map((l: any) => (
                <tr key={l.id} className={`border-b border-stone-800/50 hover:bg-stone-800/20 transition-colors group ${selected.has(l.id) ? "bg-stone-800/30" : ""}`}>
                  <td className="pl-4 py-3 w-8" onClick={e => e.stopPropagation()}>
                    <input type="checkbox"
                      checked={selected.has(l.id)}
                      onChange={() => toggleSelect(l.id)}
                      className="rounded border-stone-600 bg-stone-800 accent-emerald-500 cursor-pointer"
                    />
                  </td>
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

                  {/* Actions + inline activity panel */}
                  <td className="px-4 py-3 relative">
                    <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={e => { e.stopPropagation(); setEmailTarget(l); }}
                        title="Email this lead"
                        className="p-1.5 rounded hover:bg-blue-500/15 text-stone-500 hover:text-blue-400 transition-colors"
                      >
                        <Mail size={13} />
                      </button>
                      {/* Notes icon — shows count badge if notes exist */}
                      <button
                        onClick={e => { e.stopPropagation(); setNotesOpenId(notesOpenId === l.id ? null : l.id); }}
                        title="Activity notes"
                        className={`relative p-1.5 rounded transition-colors ${
                          notesOpenId === l.id
                            ? "bg-stone-700 text-stone-200"
                            : "text-stone-500 hover:text-stone-200 hover:bg-stone-800"
                        }`}
                      >
                        <MessageSquare size={13} />
                        {(noteCounts[l.id] ?? 0) > 0 && (
                          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] rounded-full bg-emerald-500 text-[9px] font-bold text-white flex items-center justify-center px-0.5">
                            {noteCounts[l.id]}
                          </span>
                        )}
                      </button>
                      <button onClick={() => setActive(l)}
                        className="text-[10px] px-2 py-1 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-800 transition-colors font-medium">
                        View
                      </button>
                    </div>

                    {/* Inline activity panel — identical to Collections Board */}
                    {notesOpenId === l.id && (
                      <div
                        className="absolute right-2 top-9 z-30 w-96 bg-stone-950 rounded-xl shadow-2xl ring-1 ring-stone-700 text-left flex flex-col"
                        style={{ maxHeight: "520px" }}
                        onClick={e => e.stopPropagation()}
                      >
                        {/* Panel header */}
                        <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-800 flex-shrink-0">
                          <div className="flex items-center gap-2">
                            <MessageSquare size={13} className="text-stone-400" />
                            <span className="text-[12px] font-semibold text-stone-200">
                              Activity · {l.fullName}
                            </span>
                            {(noteCounts[l.id] ?? 0) > 0 && (
                              <span className="text-[10px] text-stone-500">
                                {noteCounts[l.id]} note{noteCounts[l.id] !== 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                          <button onClick={() => setNotesOpenId(null)} className="text-stone-500 hover:text-stone-200">
                            <X size={14} />
                          </button>
                        </div>

                        <ActivityPanel
                          leadId={l.id}
                          onCountChange={count => setNoteCounts(prev => ({ ...prev, [l.id]: count }))}
                        />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {showSequences  && <SequencesModal onClose={() => setShowSequences(false)} />}
      {showTemplates  && <TemplatesModal onClose={() => setShowTemplates(false)} />}
      {showAdd        && <AddLeadModal onClose={() => setShowAdd(false)} onSaved={handleLeadAdded} />}
      {showImport     && <ImportModal onClose={() => setShowImport(false)} onImported={n => { setToast({ type: "success", message: `${n} lead${n !== 1 ? "s" : ""} imported` }); load(); }} />}
      {showBatchEmail && (
        <BatchEmailModal
          leads={leads.filter(l => selected.has(l.id))}
          onClose={() => setShowBatchEmail(false)}
          onSent={() => { setToast({ type: "success", message: `Batch email sent to ${selected.size} leads` }); clearSelect(); }}
        />
      )}
      {active         && <LeadModal lead={active} onClose={() => setActive(null)} onSave={handleSave} onStatusChange={handleInlineStatusChange} onEmail={setEmailTarget} />}
      {emailTarget    && <LeadEmailModal lead={emailTarget} onClose={() => setEmailTarget(null)} />}
      <Toast toast={toast} onClose={() => setToast(null)} />

      {/* Floating batch action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 bg-stone-900 border border-stone-700 rounded-2xl px-5 py-3 shadow-2xl">
            <span className="text-xs font-semibold text-stone-200">
              {selected.size} lead{selected.size !== 1 ? "s" : ""} selected
            </span>
            <div className="w-px h-4 bg-stone-700" />
            <button
              onClick={() => setShowBatchEmail(true)}
              className="flex items-center gap-1.5 h-7 px-3 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
            >
              <Mail size={11} /> Send email
            </button>
            <button
              onClick={clearSelect}
              className="h-7 w-7 flex items-center justify-center rounded-lg text-stone-500 hover:text-stone-300 hover:bg-stone-800 transition-colors"
              title="Clear selection"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
