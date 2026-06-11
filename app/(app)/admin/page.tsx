"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Card, Button, Badge, Input } from "@/components/ui";
import { Building2, Users, Plus, Check, X, Eye, EyeOff, Shield, RefreshCw, Pencil, Loader2, Trash2, Search, AlertTriangle, CreditCard, XCircle, FileText, Clock, CheckCircle2, TrendingUp, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={status === "Active" ? "green" : "neutral"} size="sm">{status}</Badge>;
}

function RoleBadge({ role, repTier }: { role: string; repTier?: string | null }) {
  // repTier overrides the base role for display (rep/rd/ed)
  const effective = repTier ?? role;
  const map: Record<string, any> = {
    super_admin:   { variant: "purple",  label: "Super Admin"  },
    company_admin: { variant: "blue",    label: "Company Admin" },
    company_user:  { variant: "neutral", label: "User"          },
    rep:           { variant: "orange",  label: "Rep / PM"      },
    rd:            { variant: "blue",    label: "RD"            },
    ed:            { variant: "green",   label: "ED / RM"       },
  };
  const cfg = map[effective] || { variant: "neutral", label: effective };
  return <Badge variant={cfg.variant} size="sm">{cfg.label}</Badge>;
}

// ============================================================
// CREATE ORG MODAL (Super Admin only)
// ============================================================
function CreateOrgModal({ onClose, onCreated }: any) {
  const [form, setForm] = useState({ name: "", slug: "", adminName: "", adminEmail: "", adminPassword: "" });
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [emailExists, setEmailExists] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  // Check if email already exists in the system
  useEffect(() => {
    if (!form.adminEmail || !/\S+@\S+\.\S+/.test(form.adminEmail)) { setEmailExists(false); return; }
    const timer = setTimeout(async () => {
      setCheckingEmail(true);
      try {
        const res = await fetch(`/api/admin/users?email=${encodeURIComponent(form.adminEmail)}`);
        const data = await res.json();
        setEmailExists(Array.isArray(data) ? data.some((u: any) => u.email === form.adminEmail.toLowerCase()) : false);
      } catch { setEmailExists(false); }
      finally { setCheckingEmail(false); }
    }, 400);
    return () => clearTimeout(timer);
  }, [form.adminEmail]);

  const handleSubmit = async () => {
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/admin/organisations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed"); return; }
      onCreated(data);
      onClose();
    } finally { setSaving(false); }
  };

  const autoSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const canSubmit = !saving && !!form.name && !!form.slug && !!form.adminEmail && (emailExists || !!form.adminPassword);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-stone-900 rounded-xl w-full max-w-md shadow-xl ring-1 ring-stone-800">
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
          <h2 className="font-semibold text-white">Create new organisation</h2>
          <button onClick={onClose} className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-white"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          {error && <div className="text-sm text-rose-400 bg-rose-500/10 px-3 py-2 rounded ring-1 ring-rose-500/30">{error}</div>}
          <div>
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Organisation name</label>
            <Input value={form.name} onChange={(e: any) => { set("name", e.target.value); if (!form.slug) set("slug", autoSlug(e.target.value)); }} placeholder="Acme Ltd" />
          </div>
          <div>
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Slug (URL-safe, unique)</label>
            <Input value={form.slug} onChange={(e: any) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="acme-ltd" />
          </div>
          <div className="pt-2 border-t border-stone-800">
            <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">First Company Admin account</div>
            <div className="space-y-2">
              <Input value={form.adminName} onChange={(e: any) => set("adminName", e.target.value)} placeholder="Admin full name" />
              <div className="relative">
                <Input type="email" value={form.adminEmail} onChange={(e: any) => set("adminEmail", e.target.value)} placeholder="admin@company.com" />
                {checkingEmail && <span className="absolute right-3 top-2.5 text-[10px] text-stone-400">checking…</span>}
              </div>

              {/* Existing user notice */}
              {emailExists && (
                <div className="flex items-start gap-2 text-xs bg-blue-500/10 text-blue-300 px-3 py-2 rounded ring-1 ring-blue-500/30">
                  <Check size={13} className="mt-0.5 shrink-0" />
                  <span>This user already exists and will be linked to the new organisation. No new password needed.</span>
                </div>
              )}

              {/* Password field — only shown for new users */}
              {!emailExists && (
                <div className="relative">
                  <Input type={showPw ? "text" : "password"} value={form.adminPassword} onChange={(e: any) => set("adminPassword", e.target.value)} placeholder="Temporary password (min 8 chars)" />
                  <button onClick={() => setShowPw(p => !p)} className="absolute right-3 top-2.5 text-stone-400 hover:text-stone-300">
                    {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-stone-800 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {saving ? "Creating…" : "Create organisation"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// CREATE USER MODAL (Company Admin)
// ============================================================
function CreateUserModal({ onClose, onCreated }: any) {
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "company_user" });
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async () => {
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed"); return; }
      onCreated(data);
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-stone-900 rounded-xl w-full max-w-md shadow-xl ring-1 ring-stone-800">
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
          <h2 className="font-semibold text-white">Add team member</h2>
          <button onClick={onClose} className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-white"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          {error && <div className="text-sm text-rose-400 bg-rose-500/10 px-3 py-2 rounded ring-1 ring-rose-500/30">{error}</div>}
          <Input value={form.name} onChange={(e: any) => set("name", e.target.value)} placeholder="Full name" />
          <Input type="email" value={form.email} onChange={(e: any) => set("email", e.target.value)} placeholder="email@company.com" />
          <div className="relative">
            <Input type={showPw ? "text" : "password"} value={form.password} onChange={(e: any) => set("password", e.target.value)} placeholder="Temporary password (min 8 chars)" />
            <button onClick={() => setShowPw(p => !p)} className="absolute right-3 top-2.5 text-stone-400 hover:text-stone-300">
              {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <div>
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Role</label>
            <select value={form.role} onChange={(e: any) => set("role", e.target.value)}
              className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-700 focus:ring-emerald-500 focus:outline-none bg-stone-800 text-stone-300">
              <option value="company_user">User — can use the app</option>
              <option value="company_admin">Company Admin — can manage users</option>
            </select>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-stone-800 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving || !form.name || !form.email || !form.password}>
            {saving ? "Adding…" : "Add team member"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// EDIT ORG MODAL (Super Admin only)
// ============================================================
function EditOrgModal({ org, onClose, onSaved }: { org: any; onClose: () => void; onSaved: () => void }) {
  const [orgName, setOrgName] = useState(org.name);
  const [orgStatus, setOrgStatus] = useState(org.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Users list
  const [users, setUsers] = useState<any[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);

  // Edit user inline
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", role: "" });
  const [savingUser, setSavingUser] = useState(false);
  const [userError, setUserError] = useState("");

  // Add user section
  const [showAddUser, setShowAddUser] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", email: "", password: "", role: "company_admin" });
  const [addShowPw, setAddShowPw] = useState(false);
  const [addEmailExists, setAddEmailExists] = useState(false);
  const [checkingAddEmail, setCheckingAddEmail] = useState(false);
  const [addingUser, setAddingUser] = useState(false);
  const [addError, setAddError] = useState("");
  const setAdd = (k: string, v: string) => setAddForm(p => ({ ...p, [k]: v }));

  const loadUsers = () => {
    setUsersLoading(true);
    fetch(`/api/admin/users?orgId=${org.id}`)
      .then(r => r.json())
      .then(data => { setUsers(Array.isArray(data) ? data : []); setUsersLoading(false); })
      .catch(() => setUsersLoading(false));
  };

  useEffect(() => { loadUsers(); }, [org.id]);

  // Debounced email check for add user form
  useEffect(() => {
    if (!addForm.email || !/\S+@\S+\.\S+/.test(addForm.email)) { setAddEmailExists(false); return; }
    const timer = setTimeout(async () => {
      setCheckingAddEmail(true);
      try {
        const res = await fetch(`/api/admin/users?email=${encodeURIComponent(addForm.email)}`);
        const data = await res.json();
        setAddEmailExists(Array.isArray(data) ? data.some((u: any) => u.email === addForm.email.toLowerCase()) : false);
      } catch { setAddEmailExists(false); }
      finally { setCheckingAddEmail(false); }
    }, 400);
    return () => clearTimeout(timer);
  }, [addForm.email]);

  const handleAddUser = async () => {
    setAddingUser(true); setAddError("");
    try {
      const res = await fetch(`/api/admin/organisations/${org.id}/users`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      const data = await res.json();
      if (!res.ok) { setAddError(data.error || "Failed to add user"); return; }
      setShowAddUser(false);
      setAddForm({ name: "", email: "", password: "", role: "company_admin" });
      setAddEmailExists(false);
      loadUsers();
      onSaved(); // refresh org count
    } finally { setAddingUser(false); }
  };

  const saveOrg = async () => {
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/admin/organisations", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: org.id, name: orgName, status: orgStatus }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to update"); return; }
      onSaved(); // refresh parent list
    } finally { setSaving(false); }
  };

  const startEditUser = (u: any) => {
    setEditingUser(u.id);
    setEditForm({ name: u.name, email: u.email, role: u.role });
    setUserError("");
  };

  const saveUser = async (userId: string) => {
    setSavingUser(true); setUserError("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...editForm }),
      });
      const data = await res.json();
      if (!res.ok) { setUserError(data.error || "Failed to update user"); return; }
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...data } : u));
      setEditingUser(null);
    } finally { setSavingUser(false); }
  };

  const removeUser = async (userId: string, name: string) => {
    if (!confirm(`Remove ${name} from this organisation? They will lose access immediately. If this is their only organisation, their account will be deactivated.`)) return;
    setUserError("");
    try {
      const res = await fetch(`/api/admin/organisations/${org.id}/users?userId=${userId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { setUserError(data.error || "Failed to remove user"); return; }
      setUsers(prev => prev.filter(u => u.id !== userId));
      onSaved(); // refresh org user count
    } catch (e: any) {
      setUserError(e?.message || "Failed to remove user");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-stone-900 rounded-xl w-full max-w-xl shadow-xl ring-1 ring-stone-800 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-semibold text-white">Edit organisation</h2>
            <p className="text-xs text-stone-500 mt-0.5 font-mono">/{org.slug}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-white"><X size={16} /></button>
        </div>

        <div className="overflow-y-auto flex-1">
          {/* Org settings */}
          <div className="p-5 space-y-3">
            {error && <div className="text-sm text-rose-400 bg-rose-500/10 px-3 py-2 rounded ring-1 ring-rose-500/30">{error}</div>}
            <div>
              <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Organisation name</label>
              <Input value={orgName} onChange={(e: any) => setOrgName(e.target.value)} placeholder="Organisation name" />
            </div>
            <div>
              <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Status</label>
              <select value={orgStatus} onChange={(e: any) => setOrgStatus(e.target.value)}
                className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-700 focus:ring-emerald-500 focus:outline-none bg-stone-800 text-stone-300">
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
            <div className="flex justify-end">
              <Button onClick={saveOrg} disabled={saving || !orgName.trim()}>
                {saving ? "Saving…" : "Save organisation"}
              </Button>
            </div>
          </div>

          {/* Users section */}
          <div className="border-t border-stone-800 px-5 pb-5">
            <div className="flex items-center justify-between mt-4 mb-3">
              <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
                Users in this organisation
              </div>
              <button onClick={() => { setShowAddUser(p => !p); setAddError(""); }}
                className="flex items-center gap-1 text-xs font-medium text-brand-orange hover:text-brand-orange-dark transition-colors">
                <Plus size={12} /> Add user
              </button>
            </div>

            {/* Add user form */}
            {showAddUser && (
              <div className="mb-3 p-3 rounded-lg bg-stone-800/50 ring-1 ring-stone-700 space-y-2">
                <div className="text-xs font-semibold text-stone-400 mb-1">Add / link a user to this organisation</div>
                {addError && <div className="text-xs text-rose-400 bg-rose-500/10 px-2 py-1.5 rounded ring-1 ring-rose-500/30">{addError}</div>}
                <div className="grid grid-cols-2 gap-2">
                  <div className="relative">
                    <Input type="email" value={addForm.email} onChange={(e: any) => setAdd("email", e.target.value)} placeholder="email@company.com" />
                    {checkingAddEmail && <span className="absolute right-2 top-2.5 text-[10px] text-stone-400">checking…</span>}
                  </div>
                  <Input value={addForm.name} onChange={(e: any) => setAdd("name", e.target.value)} placeholder="Full name" disabled={addEmailExists} />
                </div>
                {addEmailExists && (
                  <div className="flex items-start gap-2 text-xs bg-blue-500/10 text-blue-300 px-2 py-1.5 rounded ring-1 ring-blue-500/30">
                    <Check size={12} className="mt-0.5 shrink-0" />
                    <span>User already exists — they will be linked to this organisation.</span>
                  </div>
                )}
                {!addEmailExists && (
                  <div className="relative">
                    <Input type={addShowPw ? "text" : "password"} value={addForm.password} onChange={(e: any) => setAdd("password", e.target.value)} placeholder="Temporary password (min 8 chars)" />
                    <button onClick={() => setAddShowPw(p => !p)} className="absolute right-3 top-2.5 text-stone-400 hover:text-stone-300">
                      {addShowPw ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <select value={addForm.role} onChange={(e: any) => setAdd("role", e.target.value)}
                    className="flex-1 h-9 px-3 text-sm rounded-md ring-1 ring-stone-700 focus:ring-emerald-500 focus:outline-none bg-stone-800 text-stone-300">
                    <option value="company_admin">Company Admin</option>
                    <option value="company_user">User</option>
                  </select>
                  <Button variant="secondary" size="sm" onClick={() => setShowAddUser(false)}>Cancel</Button>
                  <Button size="sm" onClick={handleAddUser}
                    disabled={addingUser || !addForm.email || (!addEmailExists && !addForm.name)}>
                    {addingUser ? "Adding…" : addEmailExists ? "Link user" : "Add user"}
                  </Button>
                </div>
              </div>
            )}

            {usersLoading ? (
              <div className="flex items-center gap-2 text-sm text-stone-400 py-3">
                <Loader2 size={14} className="animate-spin" /> Loading users…
              </div>
            ) : users.length === 0 ? (
              <div className="text-sm text-stone-400 py-3">No users yet. Use "Add user" above to get started.</div>
            ) : (
              <div className="space-y-2">
                {userError && <div className="text-sm text-rose-400 bg-rose-500/10 px-3 py-2 rounded ring-1 ring-rose-500/30">{userError}</div>}
                {users.map(u => (
                  <div key={u.id} className="rounded-lg ring-1 ring-stone-700 overflow-hidden">
                    {editingUser === u.id ? (
                      <div className="p-3 space-y-2 bg-stone-800/60">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Name</label>
                            <Input value={editForm.name} onChange={(e: any) => setEditForm(p => ({ ...p, name: e.target.value }))} placeholder="Full name" />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Email</label>
                            <Input type="email" value={editForm.email} onChange={(e: any) => setEditForm(p => ({ ...p, email: e.target.value }))} placeholder="email@company.com" />
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Role</label>
                          <select value={editForm.role} onChange={(e: any) => setEditForm(p => ({ ...p, role: e.target.value }))}
                            className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-700 focus:ring-emerald-500 focus:outline-none bg-stone-800 text-stone-300">
                            <option value="company_user">User</option>
                            <option value="company_admin">Company Admin</option>
                          </select>
                        </div>
                        <div className="flex gap-2 justify-end">
                          <Button variant="secondary" size="sm" onClick={() => setEditingUser(null)}>Cancel</Button>
                          <Button size="sm" onClick={() => saveUser(u.id)} disabled={savingUser}>
                            {savingUser ? "Saving…" : "Save"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 px-3 py-2.5">
                        <div className="w-8 h-8 rounded-full bg-stone-700 flex items-center justify-center text-stone-300 text-xs font-semibold shrink-0">
                          {u.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-white truncate">{u.name}</div>
                          <div className="text-[11px] text-stone-400 truncate">{u.email}</div>
                        </div>
                        <RoleBadge role={u.role} />
                        <StatusBadge status={u.status} />
                        <button onClick={() => startEditUser(u)}
                          className="p-1.5 hover:bg-stone-800 rounded text-stone-400 hover:text-stone-200 transition-colors shrink-0"
                          title="Edit user">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => removeUser(u.id, u.name)}
                          className="p-1.5 hover:bg-rose-500/15 rounded text-stone-400 hover:text-rose-400 transition-colors shrink-0"
                          title="Remove from this organisation">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-stone-800 flex justify-end shrink-0">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// DELETE ORG MODAL (Super Admin only)
// ============================================================
function DeleteOrgModal({ org, onClose, onDeleted }: { org: any; onClose: () => void; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const canDelete = confirm.trim().toLowerCase() === org.name.trim().toLowerCase();

  const handleDelete = async () => {
    if (!canDelete) return;
    setDeleting(true); setError("");
    try {
      const res = await fetch(`/api/admin/organisations?orgId=${org.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to delete"); return; }
      onDeleted();
      onClose();
    } finally { setDeleting(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-stone-900 rounded-xl w-full max-w-md shadow-xl ring-1 ring-rose-500/30">
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-rose-500/15 flex items-center justify-center">
              <AlertTriangle size={15} className="text-rose-400" />
            </div>
            <h2 className="font-semibold text-white">Delete organisation</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-white"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-rose-500/10 ring-1 ring-rose-500/30 rounded-lg px-4 py-3 text-sm text-rose-300 space-y-1">
            <p className="font-semibold">This action is permanent and cannot be undone.</p>
            <p className="text-rose-400/80 text-xs">All data will be deleted — customers, invoices, contacts, collections, users, email history, integrations, and settings.</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-2">
              Type <span className="text-white font-mono">{org.name}</span> to confirm
            </label>
            <input
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder={org.name}
              className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 placeholder-stone-600 focus:ring-rose-500 focus:outline-none"
            />
          </div>
          {error && <div className="text-sm text-rose-400 bg-rose-500/10 px-3 py-2 rounded ring-1 ring-rose-500/30">{error}</div>}
        </div>
        <div className="px-5 py-3 border-t border-stone-800 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <button
            onClick={handleDelete}
            disabled={!canDelete || deleting}
            className="h-9 px-4 text-sm font-semibold rounded-lg transition-colors bg-rose-600 hover:bg-rose-500 disabled:bg-stone-700 disabled:text-stone-500 text-white"
          >
            {deleting ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// DASHBOARD OVERVIEW (super admin only)
// ============================================================
function AdminDashboard() {
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/overview")
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const s = data?.stats ?? {};

  type StatColor = "emerald" | "blue" | "rose" | "amber" | "stone";

  const KPI_CARDS: { label: string; key: string; icon: any; color: StatColor; href: string; alert?: boolean }[] = [
    { label: "Active subscriptions",  key: "active",               icon: CheckCircle2,  color: "emerald", href: "/admin/billing" },
    { label: "Trialing",              key: "trialing",             icon: Clock,         color: "blue",    href: "/admin/subscriptions" },
    { label: "Past due",              key: "pastDue",              icon: AlertTriangle, color: "rose",    href: "/admin/subscriptions", alert: true },
    { label: "Pending cancellations", key: "pendingCancellations", icon: XCircle,       color: "amber",   href: "/admin/cancellations", alert: true },
    { label: "New leads",             key: "newLeads",             icon: FileText,      color: "blue",    href: "/admin/leads", alert: true },
    { label: "Failed payments",       key: "failedPayments",       icon: CreditCard,    color: "rose",    href: "/admin/subscriptions", alert: true },
    { label: "Organisations",         key: "totalOrgs",            icon: Building2,     color: "stone",   href: "#orgs" },
    { label: "Total users",           key: "totalUsers",           icon: Users,         color: "stone",   href: "#users" },
  ];

  const colorMap: Record<StatColor, { bg: string; icon: string; val: string; dot?: string }> = {
    emerald: { bg: "bg-emerald-500/10", icon: "text-emerald-400", val: "text-emerald-400" },
    blue:    { bg: "bg-blue-500/10",    icon: "text-blue-400",    val: "text-blue-400"    },
    rose:    { bg: "bg-rose-500/10",    icon: "text-rose-400",    val: "text-rose-400"    },
    amber:   { bg: "bg-amber-500/10",   icon: "text-amber-400",   val: "text-amber-300"   },
    stone:   { bg: "bg-stone-800",      icon: "text-stone-400",   val: "text-white"       },
  };

  // Items that need action
  const alerts = KPI_CARDS.filter(c => c.alert && (s[c.key] ?? 0) > 0);

  return (
    <div className="mb-7 space-y-4">
      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {KPI_CARDS.map(card => {
          const { bg, icon: iconCls, val } = colorMap[card.color];
          const value = loading ? null : (s[card.key] ?? 0);
          const isAlert = card.alert && value && value > 0;
          return (
            <Link key={card.key} href={card.href}
              className={`group relative rounded-xl p-4 border transition-all hover:border-stone-600 ${
                isAlert ? "border-amber-500/30 bg-stone-900" : "border-stone-800 bg-stone-900"
              }`}
            >
              {isAlert && (
                <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              )}
              <div className="flex items-start justify-between mb-3">
                <p className="text-[11px] text-stone-500 leading-snug">{card.label}</p>
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${bg}`}>
                  <card.icon size={13} className={iconCls} />
                </div>
              </div>
              {loading ? (
                <div className="h-8 w-12 bg-stone-800 rounded animate-pulse" />
              ) : (
                <p className={`text-3xl font-bold tabular-nums ${val}`}>{value}</p>
              )}
              <ChevronRight size={12} className="absolute bottom-3 right-3 text-stone-700 group-hover:text-stone-400 transition-colors" />
            </Link>
          );
        })}
      </div>

      {/* Alert followup cards */}
      {!loading && alerts.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-stone-500 uppercase tracking-widest">Needs attention</p>
          <div className="grid sm:grid-cols-3 gap-3">
            {alerts.map(card => {
              const value = s[card.key] ?? 0;
              const copyMap: Record<string, { title: string; body: string; cta: string; color: string }> = {
                pendingCancellations: {
                  title: `${value} cancellation${value !== 1 ? "s" : ""} awaiting review`,
                  body:  "Customers have requested to cancel. Review and set the cancellation schedule.",
                  cta:   "Review requests",
                  color: "amber",
                },
                newLeads: {
                  title: `${value} new lead${value !== 1 ? "s" : ""} to follow up`,
                  body:  "Demo or interest requests submitted from the landing page.",
                  cta:   "View leads",
                  color: "blue",
                },
                failedPayments: {
                  title: `${value} failed payment${value !== 1 ? "s" : ""}`,
                  body:  "Subscriptions with payment failures that may need outreach.",
                  cta:   "View subscriptions",
                  color: "rose",
                },
                pastDue: {
                  title: `${value} past-due subscription${value !== 1 ? "s" : ""}`,
                  body:  "Subscriptions past their due date — may affect access.",
                  cta:   "View subscriptions",
                  color: "rose",
                },
              };
              const meta = copyMap[card.key];
              if (!meta) return null;
              const borderColor = meta.color === "amber" ? "border-amber-500/25" : meta.color === "rose" ? "border-rose-500/25" : "border-blue-500/25";
              const titleColor  = meta.color === "amber" ? "text-amber-300"  : meta.color === "rose" ? "text-rose-300"  : "text-blue-300";
              const ctaColor    = meta.color === "amber" ? "text-amber-400 hover:text-amber-200" : meta.color === "rose" ? "text-rose-400 hover:text-rose-200" : "text-blue-400 hover:text-blue-200";
              return (
                <div key={card.key} className={`rounded-xl border ${borderColor} bg-stone-900 p-4 flex flex-col gap-3`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${colorMap[card.color].bg}`}>
                      <card.icon size={14} className={colorMap[card.color].icon} />
                    </div>
                    <div>
                      <p className={`text-sm font-semibold ${titleColor}`}>{meta.title}</p>
                      <p className="text-[11px] text-stone-500 mt-0.5 leading-snug">{meta.body}</p>
                    </div>
                  </div>
                  <Link href={card.href} className={`text-xs font-medium flex items-center gap-1 ${ctaColor} transition-colors`}>
                    {meta.cta} <ChevronRight size={11} />
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent activity strip */}
      {!loading && data?.recentAuditLogs?.length > 0 && (
        <div className="rounded-xl border border-stone-800 bg-stone-900">
          <div className="flex items-center justify-between px-4 py-3 border-b border-stone-800">
            <p className="text-xs font-semibold text-stone-400">Recent billing events</p>
            <Link href="/admin/audit" className="text-[11px] text-stone-500 hover:text-stone-200 transition-colors">
              View all →
            </Link>
          </div>
          <div className="divide-y divide-stone-800/60">
            {data.recentAuditLogs.slice(0, 4).map((log: any) => (
              <div key={log.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="text-[11px] text-stone-200 font-medium capitalize flex-1 min-w-0 truncate">
                  {log.action.replace(/_/g, " ")}
                </span>
                <span className="text-[11px] text-stone-500 truncate max-w-[120px]">{log.orgName ?? "—"}</span>
                <span className="text-[11px] text-stone-600 whitespace-nowrap">
                  {new Date(log.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// MAIN ADMIN PAGE
// ============================================================
export default function AdminPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const role = (session?.user as any)?.role;
  const isSuperAdmin = role === "super_admin";
  const isAdmin = ["super_admin", "company_admin"].includes(role);

  const [orgs, setOrgs] = useState<any[]>([]);
  const [orgUsers, setOrgUsers] = useState<any[]>([]);
  const [orgReps, setOrgReps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [editingOrg, setEditingOrg] = useState<any | null>(null);
  const [deletingOrg, setDeletingOrg] = useState<any | null>(null);
  const [orgSearch, setOrgSearch] = useState("");
  const [tab, setTab] = useState<"orgs" | "users">(isSuperAdmin ? "orgs" : "users");

  // Inline role editing for users tab
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUserForm, setEditUserForm] = useState({ role: "", managerId: "" });
  const [savingUserEdit, setSavingUserEdit] = useState(false);
  const [userEditError, setUserEditError] = useState("");

  useEffect(() => {
    if (!isAdmin) { router.push("/dashboard"); return; }
    loadData();
  }, [isAdmin]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (isSuperAdmin) {
        const r = await fetch("/api/admin/organisations");
        if (r.ok) setOrgs(await r.json());
      }
      const [r2, r3] = await Promise.all([
        fetch("/api/admin/users"),
        fetch("/api/reps"),
      ]);
      if (r2.ok) setOrgUsers(await r2.json());
      if (r3.ok) setOrgReps(await r3.json());
    } finally { setLoading(false); }
  };

  const toggleUserStatus = async (userId: string, currentStatus: string) => {
    const newStatus = currentStatus === "Active" ? "Inactive" : "Active";
    await fetch("/api/admin/users", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, status: newStatus }),
    });
    setOrgUsers(prev => prev.map(u => u.id === userId ? { ...u, status: newStatus } : u));
  };

  const startEditUser = (u: any) => {
    const virtualRole = u.repTier === "ed" ? "ed" : u.repTier === "rd" ? "rd" : u.repTier === "rep" ? "rep" : u.role;
    setEditingUserId(u.id);
    setEditUserForm({ role: virtualRole, managerId: u.repManagerId || "" });
    setUserEditError("");
  };

  const saveUserEdit = async (userId: string) => {
    setSavingUserEdit(true); setUserEditError("");
    try {
      const body: any = { userId, role: editUserForm.role };
      if (editUserForm.managerId) body.managerId = editUserForm.managerId;
      const res = await fetch("/api/admin/users", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setUserEditError(data.error || "Failed to update role"); return; }
      setEditingUserId(null);
      loadData();
    } finally { setSavingUserEdit(false); }
  };

  if (!isAdmin) return null;

  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-stone-900 flex items-center justify-center">
            <Shield size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">
              {isSuperAdmin ? "Super Admin Portal" : "Team Management"}
            </h1>
            <p className="text-xs text-stone-500 mt-0.5">
              {isSuperAdmin ? "Manage all organisations and users" : "Manage users in your organisation"}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={loadData} icon={RefreshCw}>Refresh</Button>
      </div>

      {/* Dashboard overview — super admin only */}
      {isSuperAdmin && <AdminDashboard />}

      {/* Tabs */}
      <div id="orgs" className="flex items-center gap-1 border-b border-stone-800 mb-5">
        {isSuperAdmin && (
          <button onClick={() => setTab("orgs")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${tab === "orgs" ? "border-emerald-500 text-emerald-400" : "border-transparent text-stone-500 hover:text-stone-200"}`}>
            <Building2 size={13} /> Organisations ({orgs.length})
          </button>
        )}
        <button id="users" onClick={() => setTab("users")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${tab === "users" ? "border-emerald-500 text-emerald-400" : "border-transparent text-stone-500 hover:text-stone-200"}`}>
          <Users size={13} /> {isSuperAdmin ? "This org's users" : "Team members"} ({orgUsers.length})
        </button>
      </div>

      {/* ORGANISATIONS tab — super admin only */}
      {tab === "orgs" && isSuperAdmin && (
        <div>
          <div className="flex items-center gap-3 mb-3">
            {/* Search */}
            <div className="relative flex-1 max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 pointer-events-none" />
              <input
                value={orgSearch}
                onChange={e => setOrgSearch(e.target.value)}
                placeholder="Search organisations…"
                className="w-full h-9 pl-8 pr-3 text-sm rounded-lg ring-1 ring-stone-700 bg-stone-800 text-stone-300 placeholder-stone-600 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
            <div className="ml-auto">
              <Button icon={Plus} onClick={() => setShowCreateOrg(true)}>New organisation</Button>
            </div>
          </div>
          <div className="space-y-2">
            {orgs
              .filter(org =>
                !orgSearch ||
                org.name.toLowerCase().includes(orgSearch.toLowerCase()) ||
                org.slug.toLowerCase().includes(orgSearch.toLowerCase())
              )
              .map(org => (
                <Card key={org.id} className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-stone-800 flex items-center justify-center text-stone-300 text-sm font-semibold flex-shrink-0">
                    {org.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-white">{org.name}</div>
                    <div className="text-xs text-stone-500 font-mono mt-0.5">/{org.slug}</div>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-stone-500">
                    <span>{org.userCount} users</span>
                    <StatusBadge status={org.status} />
                    <button onClick={() => setEditingOrg(org)}
                      className="p-1.5 hover:bg-stone-800 rounded text-stone-400 hover:text-stone-200 transition-colors"
                      title="Edit organisation">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => setDeletingOrg(org)}
                      className="p-1.5 hover:bg-rose-500/15 rounded text-stone-500 hover:text-rose-400 transition-colors"
                      title="Delete organisation">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </Card>
              ))}
            {orgs.filter(org =>
              !orgSearch ||
              org.name.toLowerCase().includes(orgSearch.toLowerCase()) ||
              org.slug.toLowerCase().includes(orgSearch.toLowerCase())
            ).length === 0 && !loading && (
              <Card>
                <div className="text-sm text-stone-500 text-center py-4">
                  {orgSearch ? `No organisations matching "${orgSearch}"` : "No organisations yet. Create the first one."}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* USERS tab */}
      {tab === "users" && (
        <div>
          <div className="flex justify-end mb-3">
            <Button icon={Plus} onClick={() => setShowCreateUser(true)}>Add team member</Button>
          </div>
          <Card padding="none">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800">
                  <th className="text-left font-semibold px-4 py-3">Name</th>
                  <th className="text-left font-semibold px-4 py-3">Email</th>
                  <th className="text-left font-semibold px-4 py-3">Role</th>
                  <th className="text-left font-semibold px-4 py-3">Manager</th>
                  <th className="text-left font-semibold px-4 py-3">Status</th>
                  <th className="text-left font-semibold px-4 py-3">Joined</th>
                  <th className="px-4 py-3 w-28"></th>
                </tr>
              </thead>
              <tbody>
                {orgUsers.map(user => {
                  const managerRep = user.repManagerId
                    ? orgReps.find((r: any) => r.id === user.repManagerId)
                    : null;
                  const isEditingThis = editingUserId === user.id;
                  const isSelf = user.id === (session?.user as any)?.id;
                  return (
                    <tr key={user.id} className="border-b border-stone-800">
                      {isEditingThis ? (
                        <td colSpan={7} className="px-4 py-3">
                          <div className="flex flex-wrap items-end gap-3">
                            <div>
                              <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Role</label>
                              <select
                                value={editUserForm.role}
                                onChange={e => setEditUserForm(p => ({ ...p, role: e.target.value, managerId: "" }))}
                                className="h-9 px-3 text-sm rounded-md ring-1 ring-stone-700 focus:ring-emerald-500 focus:outline-none bg-stone-800 text-stone-300">
                                <option value="company_user">User</option>
                                <option value="company_admin">Company Admin</option>
                                <option value="rep">Rep / PM</option>
                                <option value="rd">RD</option>
                                <option value="ed">ED / RM</option>
                              </select>
                            </div>
                            {(editUserForm.role === "rep" || editUserForm.role === "rd") && (
                              <div>
                                <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Reports to (Manager)</label>
                                <select
                                  value={editUserForm.managerId}
                                  onChange={e => setEditUserForm(p => ({ ...p, managerId: e.target.value }))}
                                  className="h-9 px-3 text-sm rounded-md ring-1 ring-stone-700 focus:ring-emerald-500 focus:outline-none bg-stone-800 text-stone-300 min-w-[180px]">
                                  <option value="">— No manager —</option>
                                  {orgReps
                                    .filter((r: any) => r.tier === "ed" || r.tier === "rd")
                                    .filter((r: any) => r.id !== user.repId) // can't report to self
                                    .map((r: any) => (
                                      <option key={r.id} value={r.id}>{r.name} ({r.tier.toUpperCase()})</option>
                                    ))}
                                </select>
                              </div>
                            )}
                            {userEditError && (
                              <div className="text-xs text-rose-400 bg-rose-500/10 px-2 py-1.5 rounded ring-1 ring-rose-500/30 self-center">{userEditError}</div>
                            )}
                            <div className="flex gap-2 ml-auto self-end">
                              <Button variant="secondary" size="sm" onClick={() => { setEditingUserId(null); setUserEditError(""); }}>Cancel</Button>
                              <Button size="sm" onClick={() => saveUserEdit(user.id)} disabled={savingUserEdit}>
                                {savingUserEdit ? "Saving…" : "Save"}
                              </Button>
                            </div>
                          </div>
                        </td>
                      ) : (
                        <>
                          <td className="px-4 py-3 font-medium text-white">{user.name}</td>
                          <td className="px-4 py-3 text-stone-400 text-[12px]">{user.email}</td>
                          <td className="px-4 py-3"><RoleBadge role={user.role} repTier={user.repTier} /></td>
                          <td className="px-4 py-3 text-[12px] text-stone-500">
                            {managerRep ? managerRep.name : <span className="text-stone-300">—</span>}
                          </td>
                          <td className="px-4 py-3"><StatusBadge status={user.status} /></td>
                          <td className="px-4 py-3 text-stone-500 text-[12px]">
                            {new Date(user.createdAt).toLocaleDateString("en-IE", { day: "2-digit", month: "short", year: "numeric" })}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1 justify-end">
                              {!isSelf && (
                                <button onClick={() => startEditUser(user)}
                                  className="p-1.5 hover:bg-stone-800 rounded text-stone-400 hover:text-stone-200 transition-colors"
                                  title="Edit role / rep assignment">
                                  <Pencil size={13} />
                                </button>
                              )}
                              {!isSelf && (
                                <button onClick={() => toggleUserStatus(user.id, user.status)}
                                  className={`text-[11px] px-2 py-1 rounded font-medium transition-colors ${user.status === "Active" ? "bg-rose-500/10 text-rose-400 hover:bg-rose-500/20" : "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"}`}>
                                  {user.status === "Active" ? "Deactivate" : "Activate"}
                                </button>
                              )}
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {orgUsers.length === 0 && !loading && (
              <div className="text-sm text-stone-500 text-center py-8">No team members yet.</div>
            )}
          </Card>
        </div>
      )}

      {showCreateOrg && <CreateOrgModal onClose={() => setShowCreateOrg(false)} onCreated={loadData} />}
      {showCreateUser && <CreateUserModal onClose={() => setShowCreateUser(false)} onCreated={loadData} />}
      {editingOrg && (
        <EditOrgModal
          org={editingOrg}
          onClose={() => setEditingOrg(null)}
          onSaved={() => { loadData(); setEditingOrg(null); }}
        />
      )}
      {deletingOrg && (
        <DeleteOrgModal
          org={deletingOrg}
          onClose={() => setDeletingOrg(null)}
          onDeleted={loadData}
        />
      )}
    </div>
  );
}
