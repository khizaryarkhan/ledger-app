"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { Card, Button, Badge, Input } from "@/components/ui";
import { Building2, Users, Plus, Check, X, Eye, EyeOff, Shield, RefreshCw, Pencil, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={status === "Active" ? "green" : "neutral"} size="sm">{status}</Badge>;
}

function RoleBadge({ role }: { role: string }) {
  const map: Record<string, any> = {
    super_admin: { variant: "purple", label: "Super Admin" },
    company_admin: { variant: "blue", label: "Company Admin" },
    company_user: { variant: "neutral", label: "User" },
  };
  const cfg = map[role] || { variant: "neutral", label: role };
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
      <div className="bg-white rounded-xl w-full max-w-md shadow-xl">
        <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between">
          <h2 className="font-semibold text-stone-900">Create new organisation</h2>
          <button onClick={onClose} className="p-1 hover:bg-stone-100 rounded"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          {error && <div className="text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded">{error}</div>}
          <div>
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Organisation name</label>
            <Input value={form.name} onChange={(e: any) => { set("name", e.target.value); if (!form.slug) set("slug", autoSlug(e.target.value)); }} placeholder="Acme Ltd" />
          </div>
          <div>
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Slug (URL-safe, unique)</label>
            <Input value={form.slug} onChange={(e: any) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="acme-ltd" />
          </div>
          <div className="pt-2 border-t border-stone-100">
            <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">First Company Admin account</div>
            <div className="space-y-2">
              <Input value={form.adminName} onChange={(e: any) => set("adminName", e.target.value)} placeholder="Admin full name" />
              <div className="relative">
                <Input type="email" value={form.adminEmail} onChange={(e: any) => set("adminEmail", e.target.value)} placeholder="admin@company.com" />
                {checkingEmail && <span className="absolute right-3 top-2.5 text-[10px] text-stone-400">checking…</span>}
              </div>

              {/* Existing user notice */}
              {emailExists && (
                <div className="flex items-start gap-2 text-xs bg-blue-50 text-blue-700 px-3 py-2 rounded ring-1 ring-blue-200">
                  <Check size={13} className="mt-0.5 shrink-0" />
                  <span>This user already exists and will be linked to the new organisation. No new password needed.</span>
                </div>
              )}

              {/* Password field — only shown for new users */}
              {!emailExists && (
                <div className="relative">
                  <Input type={showPw ? "text" : "password"} value={form.adminPassword} onChange={(e: any) => set("adminPassword", e.target.value)} placeholder="Temporary password (min 8 chars)" />
                  <button onClick={() => setShowPw(p => !p)} className="absolute right-3 top-2.5 text-stone-400 hover:text-stone-700">
                    {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-stone-200 flex justify-end gap-2">
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
      <div className="bg-white rounded-xl w-full max-w-md shadow-xl">
        <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between">
          <h2 className="font-semibold text-stone-900">Add team member</h2>
          <button onClick={onClose} className="p-1 hover:bg-stone-100 rounded"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          {error && <div className="text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded">{error}</div>}
          <Input value={form.name} onChange={(e: any) => set("name", e.target.value)} placeholder="Full name" />
          <Input type="email" value={form.email} onChange={(e: any) => set("email", e.target.value)} placeholder="email@company.com" />
          <div className="relative">
            <Input type={showPw ? "text" : "password"} value={form.password} onChange={(e: any) => set("password", e.target.value)} placeholder="Temporary password (min 8 chars)" />
            <button onClick={() => setShowPw(p => !p)} className="absolute right-3 top-2.5 text-stone-400 hover:text-stone-700">
              {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <div>
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Role</label>
            <select value={form.role} onChange={(e: any) => set("role", e.target.value)}
              className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-stone-900 focus:outline-none bg-white">
              <option value="company_user">User — can use the app</option>
              <option value="company_admin">Company Admin — can manage users</option>
            </select>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-stone-200 flex justify-end gap-2">
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

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-xl shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-semibold text-stone-900">Edit organisation</h2>
            <p className="text-xs text-stone-500 mt-0.5 font-mono">/{org.slug}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-stone-100 rounded"><X size={16} /></button>
        </div>

        <div className="overflow-y-auto flex-1">
          {/* Org settings */}
          <div className="p-5 space-y-3">
            {error && <div className="text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded">{error}</div>}
            <div>
              <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Organisation name</label>
              <Input value={orgName} onChange={(e: any) => setOrgName(e.target.value)} placeholder="Organisation name" />
            </div>
            <div>
              <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Status</label>
              <select value={orgStatus} onChange={(e: any) => setOrgStatus(e.target.value)}
                className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-stone-900 focus:outline-none bg-white">
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
          <div className="border-t border-stone-100 px-5 pb-5">
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
              <div className="mb-3 p-3 rounded-lg bg-stone-50 ring-1 ring-stone-200 space-y-2">
                <div className="text-xs font-semibold text-stone-600 mb-1">Add / link a user to this organisation</div>
                {addError && <div className="text-xs text-rose-600 bg-rose-50 px-2 py-1.5 rounded">{addError}</div>}
                <div className="grid grid-cols-2 gap-2">
                  <div className="relative">
                    <Input type="email" value={addForm.email} onChange={(e: any) => setAdd("email", e.target.value)} placeholder="email@company.com" />
                    {checkingAddEmail && <span className="absolute right-2 top-2.5 text-[10px] text-stone-400">checking…</span>}
                  </div>
                  <Input value={addForm.name} onChange={(e: any) => setAdd("name", e.target.value)} placeholder="Full name" disabled={addEmailExists} />
                </div>
                {addEmailExists && (
                  <div className="flex items-start gap-2 text-xs bg-blue-50 text-blue-700 px-2 py-1.5 rounded ring-1 ring-blue-200">
                    <Check size={12} className="mt-0.5 shrink-0" />
                    <span>User already exists — they will be linked to this organisation.</span>
                  </div>
                )}
                {!addEmailExists && (
                  <div className="relative">
                    <Input type={addShowPw ? "text" : "password"} value={addForm.password} onChange={(e: any) => setAdd("password", e.target.value)} placeholder="Temporary password (min 8 chars)" />
                    <button onClick={() => setAddShowPw(p => !p)} className="absolute right-3 top-2.5 text-stone-400 hover:text-stone-700">
                      {addShowPw ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <select value={addForm.role} onChange={(e: any) => setAdd("role", e.target.value)}
                    className="flex-1 h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-stone-900 focus:outline-none bg-white">
                    <option value="company_admin">Company Admin</option>
                    <option value="company_user">User</option>
                  </select>
                  <Button variant="secondary" size="sm" onClick={() => setShowAddUser(false)}>Cancel</Button>
                  <Button size="sm" onClick={handleAddUser}
                    disabled={addingUser || !addForm.email || (!addEmailExists && (!addForm.name || !addForm.password))}>
                    {addingUser ? "Adding…" : addEmailExists ? "Link user" : "Create & link"}
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
                {userError && <div className="text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded">{userError}</div>}
                {users.map(u => (
                  <div key={u.id} className="rounded-lg ring-1 ring-stone-200 overflow-hidden">
                    {editingUser === u.id ? (
                      <div className="p-3 space-y-2 bg-stone-50">
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
                            className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-stone-900 focus:outline-none bg-white">
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
                        <div className="w-8 h-8 rounded-full bg-stone-200 flex items-center justify-center text-stone-700 text-xs font-semibold shrink-0">
                          {u.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-stone-900 truncate">{u.name}</div>
                          <div className="text-[11px] text-stone-500 truncate">{u.email}</div>
                        </div>
                        <RoleBadge role={u.role} />
                        <StatusBadge status={u.status} />
                        <button onClick={() => startEditUser(u)}
                          className="p-1.5 hover:bg-stone-100 rounded text-stone-400 hover:text-stone-700 transition-colors shrink-0">
                          <Pencil size={13} />
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
        <div className="px-5 py-3 border-t border-stone-200 flex justify-end shrink-0">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
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
  const [loading, setLoading] = useState(true);
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [editingOrg, setEditingOrg] = useState<any | null>(null);
  const [tab, setTab] = useState<"orgs" | "users">(isSuperAdmin ? "orgs" : "users");

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
      const r2 = await fetch("/api/admin/users");
      if (r2.ok) setOrgUsers(await r2.json());
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

  if (!isAdmin) return null;

  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-stone-900 flex items-center justify-center">
            <Shield size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-stone-900">
              {isSuperAdmin ? "Super Admin Portal" : "Team Management"}
            </h1>
            <p className="text-xs text-stone-500 mt-0.5">
              {isSuperAdmin ? "Manage all organisations and users" : "Manage users in your organisation"}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={loadData} icon={RefreshCw}>Refresh</Button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-stone-200 mb-5">
        {isSuperAdmin && (
          <button onClick={() => setTab("orgs")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${tab === "orgs" ? "border-stone-900 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-900"}`}>
            <Building2 size={13} /> Organisations ({orgs.length})
          </button>
        )}
        <button onClick={() => setTab("users")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${tab === "users" ? "border-stone-900 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-900"}`}>
          <Users size={13} /> {isSuperAdmin ? "This org's users" : "Team members"} ({orgUsers.length})
        </button>
      </div>

      {/* ORGANISATIONS tab — super admin only */}
      {tab === "orgs" && isSuperAdmin && (
        <div>
          <div className="flex justify-end mb-3">
            <Button icon={Plus} onClick={() => setShowCreateOrg(true)}>New organisation</Button>
          </div>
          <div className="space-y-2">
            {orgs.map(org => (
              <Card key={org.id} className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-stone-100 flex items-center justify-center text-stone-700 text-sm font-semibold flex-shrink-0">
                  {org.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-stone-900">{org.name}</div>
                  <div className="text-xs text-stone-500 font-mono mt-0.5">/{org.slug}</div>
                </div>
                <div className="flex items-center gap-3 text-sm text-stone-500">
                  <span>{org.userCount} users</span>
                  <StatusBadge status={org.status} />
                  <button onClick={() => setEditingOrg(org)}
                    className="p-1.5 hover:bg-stone-100 rounded text-stone-400 hover:text-stone-700 transition-colors"
                    title="Edit organisation">
                    <Pencil size={14} />
                  </button>
                </div>
              </Card>
            ))}
            {orgs.length === 0 && !loading && (
              <Card><div className="text-sm text-stone-500 text-center py-4">No organisations yet. Create the first one.</div></Card>
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
                <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-200">
                  <th className="text-left font-semibold px-4 py-3">Name</th>
                  <th className="text-left font-semibold px-4 py-3">Email</th>
                  <th className="text-left font-semibold px-4 py-3">Role</th>
                  <th className="text-left font-semibold px-4 py-3">Status</th>
                  <th className="text-left font-semibold px-4 py-3">Joined</th>
                  <th className="px-4 py-3 w-24"></th>
                </tr>
              </thead>
              <tbody>
                {orgUsers.map(user => (
                  <tr key={user.id} className="border-b border-stone-100 hover:bg-stone-50">
                    <td className="px-4 py-3 font-medium text-stone-900">{user.name}</td>
                    <td className="px-4 py-3 text-stone-600 text-[12px]">{user.email}</td>
                    <td className="px-4 py-3"><RoleBadge role={user.role} /></td>
                    <td className="px-4 py-3"><StatusBadge status={user.status} /></td>
                    <td className="px-4 py-3 text-stone-500 text-[12px]">
                      {new Date(user.createdAt).toLocaleDateString("en-IE", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3">
                      {user.id !== (session?.user as any)?.id && (
                        <button onClick={() => toggleUserStatus(user.id, user.status)}
                          className={`text-[11px] px-2 py-1 rounded font-medium transition-colors ${user.status === "Active" ? "bg-rose-50 text-rose-700 hover:bg-rose-100" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}>
                          {user.status === "Active" ? "Deactivate" : "Activate"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
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
    </div>
  );
}
