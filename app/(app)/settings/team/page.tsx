"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useData } from "@/components/data-provider";
import { Card, Button } from "@/components/ui";
import {
  ChevronLeft, Users, Plus, Trash2, KeyRound, Eye, EyeOff,
  Shield, UserPlus, ChevronDown, Briefcase,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
type TeamMember = { id: string; name: string; email: string; role: string; status: string };
type LoginInfo   = { hasLogin: boolean; email: string | null; status: string | null };

const ROLE_LABEL: Record<string, string> = {
  company_admin: "Admin",
  company_user:  "Full Access",
  super_admin:   "Super Admin",
};
const ROLE_COLOR: Record<string, string> = {
  company_admin: "bg-violet-50 text-violet-700",
  company_user:  "bg-blue-50 text-blue-700",
  super_admin:   "bg-rose-50 text-rose-700",
};

// ── Password modal ─────────────────────────────────────────────────────────────
function PasswordModal({
  repId, repName, hasLogin, onClose, onSuccess,
}: {
  repId: string; repName: string; hasLogin: boolean;
  onClose: () => void; onSuccess: (info: { email: string }) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [show,     setShow]     = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");
  const [success,  setSuccess]  = useState("");

  const handleSave = async () => {
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (password !== confirm) { setError("Passwords do not match"); return; }
    setSaving(true); setError("");
    try {
      const res  = await fetch(`/api/admin/reps/${repId}/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to save"); return; }
      setSuccess(data.created ? `Login created — email: ${data.email}` : `Password reset — email: ${data.email}`);
      onSuccess({ email: data.email });
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-center gap-2 mb-1">
          <KeyRound size={16} className="text-stone-700" />
          <h2 className="text-base font-semibold text-stone-900">
            {hasLogin ? "Reset password" : "Create login"} — {repName}
          </h2>
        </div>
        <p className="text-[12px] text-stone-500 mb-5">
          {hasLogin
            ? "Set a new portal password for this user."
            : "This gives the user a login to the portal to view their assigned receivables."}
        </p>
        <div className="space-y-3">
          <div className="relative">
            <input type={show ? "text" : "password"} value={password}
              onChange={e => setPassword(e.target.value)} placeholder="New password (8+ chars)"
              className="w-full h-9 px-3 pr-9 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
            <button type="button" onClick={() => setShow(p => !p)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700">
              {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <input type={show ? "text" : "password"} value={confirm}
            onChange={e => setConfirm(e.target.value)} placeholder="Confirm password"
            className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
          {error   && <div className="text-xs text-rose-600    bg-rose-50    ring-1 ring-rose-200    rounded px-3 py-2">{error}</div>}
          {success && <div className="text-xs text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200 rounded px-3 py-2">{success}</div>}
        </div>
        <div className="flex items-center gap-2 mt-5">
          {!success ? (
            <>
              <Button onClick={handleSave} disabled={saving || !password || !confirm}>
                {saving ? "Saving…" : hasLogin ? "Reset password" : "Create login"}
              </Button>
              <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            </>
          ) : (
            <Button onClick={onClose}>Done</Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function TeamSettingsPage() {
  const { data: session } = useSession();
  const { reps, regions, orgSettings, addRep, updateRepManager, deleteRep, addRegion, deleteRegion, updateOrgSettings } = useData();

  const currentUserId = (session?.user as any)?.id;
  const role   = (session?.user as any)?.role;
  const isAdmin = role === "company_admin" || role === "super_admin";

  // ── App users ────────────────────────────────────────────────────────────────
  const [members,        setMembers]        = useState<TeamMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [newMember,      setNewMember]      = useState({ name: "", email: "", password: "", role: "company_user" });
  const [addingMember,   setAddingMember]   = useState(false);
  const [memberError,    setMemberError]    = useState("");
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<string | null>(null);

  const loadMembers = async () => {
    setLoadingMembers(true);
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) setMembers(await res.json());
    } finally { setLoadingMembers(false); }
  };
  useEffect(() => { if (isAdmin) loadMembers(); }, [isAdmin]);

  const addMember = async () => {
    setMemberError("");
    if (!newMember.name.trim())              { setMemberError("Name is required"); return; }
    if (!/.+@.+\..+/.test(newMember.email)) { setMemberError("Valid email is required"); return; }
    if (newMember.password.length < 8)      { setMemberError("Password must be at least 8 characters"); return; }
    setAddingMember(true);
    try {
      const res  = await fetch("/api/admin/users", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newMember),
      });
      const data = await res.json();
      if (!res.ok) { setMemberError(data?.error || "Failed to create user"); return; }
      setNewMember({ name: "", email: "", password: "", role: "company_user" });
      await loadMembers();
    } finally { setAddingMember(false); }
  };

  const toggleMemberStatus = async (m: TeamMember) => {
    const res = await fetch("/api/admin/users", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: m.id, status: m.status === "Active" ? "Inactive" : "Active" }),
    });
    if (res.ok) await loadMembers();
  };

  const changeMemberRole = async (m: TeamMember, newRole: string) => {
    const res = await fetch("/api/admin/users", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: m.id, role: newRole }),
    });
    if (res.ok) await loadMembers();
  };

  const deleteMember = async (userId: string) => {
    const res = await fetch(`/api/admin/users?userId=${userId}`, { method: "DELETE" });
    if (res.ok) { setConfirmDeleteUser(null); await loadMembers(); }
  };

  // ── Rep portal login states ───────────────────────────────────────────────────
  const [loginInfos,  setLoginInfos]  = useState<Record<string, LoginInfo>>({});
  const [loginModal,  setLoginModal]  = useState<{ repId: string; repName: string; hasLogin: boolean } | null>(null);

  useEffect(() => {
    if (!reps || reps.length === 0 || !isAdmin) return;
    Promise.all(
      (reps as any[]).map(async (r: any) => {
        try {
          const res = await fetch(`/api/admin/reps/${r.id}/login`);
          return [r.id, res.ok ? await res.json() : { hasLogin: false, email: null, status: null }];
        } catch { return [r.id, { hasLogin: false, email: null, status: null }]; }
      })
    ).then(entries => setLoginInfos(Object.fromEntries(entries)));
  }, [reps, isAdmin]);

  const handleLoginSuccess = (repId: string, email: string) => {
    setLoginInfos(prev => ({ ...prev, [repId]: { hasLogin: true, email, status: "Active" } }));
    setLoginModal(null);
  };

  // ── Rep add form ──────────────────────────────────────────────────────────────
  const [newRepName,    setNewRepName]    = useState("");
  const [newRepEmail,   setNewRepEmail]   = useState("");
  const [newRepManager, setNewRepManager] = useState("");
  const [addingRep,     setAddingRep]     = useState(false);

  const [newEdName,  setNewEdName]  = useState("");
  const [newEdEmail, setNewEdEmail] = useState("");
  const [addingEd,   setAddingEd]   = useState(false);

  const edRms       = (reps ?? []).filter((r: any) => r.tier === "ed" || r.tier === "rd");
  const regularReps = (reps ?? []).filter((r: any) => r.tier !== "ed" && r.tier !== "rd");

  return (
    <div className="p-6 max-w-[780px] mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link href="/settings"
          className="inline-flex items-center gap-1 text-[13px] text-stone-500 hover:text-stone-900 mb-3 transition-colors">
          <ChevronLeft size={14} /> Settings
        </Link>
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Team</h1>
        <p className="text-sm text-stone-500 mt-1">Manage users, project managers and access levels.</p>
      </div>

      {/* ── Role overview ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {[
          { icon: Shield,    color: "text-violet-500", label: "Admin",        desc: "Full access — can create, edit and delete any user or data." },
          { icon: Users,     color: "text-blue-500",   label: "Full Access",  desc: "Can do everything except create or delete users." },
          { icon: Briefcase, color: "text-emerald-500",label: "Rep / PM",     desc: "Portal login — sees only projects and invoices assigned to them." },
          { icon: Shield,    color: "text-orange-500", label: "ED / RM",      desc: "Portal login — sees all projects and invoices for Reps reporting to them." },
        ].map(({ icon: Icon, color, label, desc }) => (
          <div key={label} className="flex items-start gap-3 p-3 rounded-lg bg-stone-50 ring-1 ring-stone-100">
            <Icon size={15} className={`${color} shrink-0 mt-0.5`} />
            <div>
              <div className="text-sm font-semibold text-stone-800">{label}</div>
              <div className="text-[11px] text-stone-500 mt-0.5 leading-relaxed">{desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── App Users ──────────────────────────────────────────────────────────── */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <UserPlus size={15} className="text-stone-600" />
          <h3 className="text-sm font-semibold text-stone-900">App Users</h3>
          <span className="ml-auto text-[11px] text-stone-400">{members.filter(m => m.role !== "super_admin").length}</span>
        </div>
        <p className="text-[12px] text-stone-500 mb-4">
          Users who log into the main app. Assign <strong className="font-medium text-stone-700">Admin</strong> for full control or <strong className="font-medium text-stone-700">Full Access</strong> for day-to-day use.
        </p>

        <div className="space-y-2 mb-4">
          {loadingMembers && <div className="text-sm text-stone-400 py-2">Loading…</div>}
          {!loadingMembers && members.filter(m => m.role !== "super_admin").length === 0 && (
            <div className="text-sm text-stone-400 py-2">No app users yet.</div>
          )}
          {members.filter(m => m.role !== "super_admin").map(m => (
            <div key={m.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg ring-1 ${m.status === "Active" ? "bg-white ring-stone-200" : "bg-stone-50 ring-stone-100 opacity-60"}`}>
              {/* Avatar */}
              <div className="w-8 h-8 rounded-full bg-stone-100 flex items-center justify-center text-[11px] font-semibold text-stone-600 shrink-0">
                {m.name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-stone-900 truncate">{m.name}</span>
                  {/* Role badge — Admin can change role for non-admins */}
                  {isAdmin && m.role !== "company_admin" && m.id !== currentUserId ? (
                    <div className="relative group">
                      <button className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ${ROLE_COLOR[m.role] || "bg-stone-100 text-stone-600"}`}>
                        {ROLE_LABEL[m.role] || m.role}
                        <ChevronDown size={9} />
                      </button>
                      <div className="absolute left-0 top-full mt-1 z-10 hidden group-hover:block bg-white rounded-lg shadow-lg ring-1 ring-stone-200 py-1 min-w-[130px]">
                        {["company_user", "company_admin"].map(r => (
                          <button key={r} onClick={() => changeMemberRole(m, r)}
                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 ${m.role === r ? "font-semibold text-stone-900" : "text-stone-600"}`}>
                            {ROLE_LABEL[r]}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${ROLE_COLOR[m.role] || "bg-stone-100 text-stone-600"}`}>
                      {ROLE_LABEL[m.role] || m.role}
                    </span>
                  )}
                  {m.status !== "Active" && (
                    <span className="text-[10px] text-stone-400">Inactive</span>
                  )}
                </div>
                <div className="text-[11px] text-stone-500">{m.email}</div>
              </div>
              {/* Actions */}
              {isAdmin && m.id !== currentUserId && m.role !== "super_admin" && (
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => toggleMemberStatus(m)}
                    className="text-[11px] px-2 py-1 rounded ring-1 ring-stone-200 text-stone-600 hover:bg-stone-100">
                    {m.status === "Active" ? "Deactivate" : "Activate"}
                  </button>
                  {confirmDeleteUser === m.id ? (
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-rose-600 font-medium">Sure?</span>
                      <button onClick={() => deleteMember(m.id)}
                        className="text-[11px] px-2 py-1 rounded bg-rose-600 text-white hover:bg-rose-700">Yes</button>
                      <button onClick={() => setConfirmDeleteUser(null)}
                        className="text-[11px] px-2 py-1 rounded ring-1 ring-stone-200 text-stone-600 hover:bg-stone-100">No</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDeleteUser(m.id)} className="p-1.5 text-stone-400 hover:text-rose-600 rounded">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {isAdmin && (
          <div className="pt-3 border-t border-stone-100">
            <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-2">Add app user</div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input value={newMember.name}
                onChange={e => setNewMember({ ...newMember, name: e.target.value })}
                placeholder="Full name *"
                className="h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
              <input value={newMember.email}
                onChange={e => setNewMember({ ...newMember, email: e.target.value })}
                placeholder="Email *"
                className="h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
              <input type="password" value={newMember.password}
                onChange={e => setNewMember({ ...newMember, password: e.target.value })}
                placeholder="Password (8+ chars) *"
                className="h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
              <select value={newMember.role}
                onChange={e => setNewMember({ ...newMember, role: e.target.value })}
                className="h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none bg-white">
                <option value="company_user">Full Access</option>
                {role === "super_admin" && <option value="company_admin">Admin</option>}
              </select>
            </div>
            {memberError && (
              <div className="text-xs text-rose-600 bg-rose-50 ring-1 ring-rose-200 rounded px-2 py-1.5 mb-2">{memberError}</div>
            )}
            <Button size="sm" icon={Plus} disabled={addingMember} onClick={addMember}>
              {addingMember ? "Adding…" : "Add user"}
            </Button>
            <p className="text-[10px] text-stone-400 mt-1.5">
              Share the email + initial password with the user — they can change it after first login.
            </p>
          </div>
        )}
      </Card>

      {/* ── Reps / PM ─────────────────────────────────────────────────────────── */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <Briefcase size={15} className="text-emerald-600" />
          <h3 className="text-sm font-semibold text-stone-900">Reps / PM</h3>
          <span className="ml-auto text-[11px] text-stone-400">{regularReps.length}</span>
        </div>
        <p className="text-[12px] text-stone-500 mb-4">
          Portal logins for project managers. Each Rep sees only the customers and invoices assigned to them.
          Assign them to an ED/RM so their data rolls up.
        </p>

        <div className="space-y-2 mb-4">
          {regularReps.length === 0 && <div className="text-sm text-stone-400 py-2">No Reps / PMs defined yet.</div>}
          {regularReps.map((r: any) => {
            const info    = loginInfos[r.id];
            const manager = edRms.find((e: any) => e.id === r.managerId);
            return (
              <div key={r.id} className="px-3 py-2.5 rounded-lg bg-stone-50 ring-1 ring-stone-100">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-stone-800">{r.name}</span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">PM</span>
                    </div>
                    {r.email && <div className="text-[11px] text-stone-500">{r.email}</div>}
                    {manager && <div className="text-[11px] text-stone-400 mt-0.5">Reports to: <span className="text-stone-600">{manager.name}</span></div>}
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => setLoginModal({ repId: r.id, repName: r.name, hasLogin: info?.hasLogin ?? false })}
                        className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-stone-900 text-white hover:bg-stone-700">
                        <KeyRound size={11} />
                        {info?.hasLogin ? "Reset" : "Login"}
                      </button>
                      <button onClick={() => deleteRep(r.id)} className="p-1.5 text-stone-400 hover:text-rose-600 rounded">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
                {/* Manager assignment */}
                {isAdmin && edRms.length > 0 && (
                  <div className="mt-2">
                    <select value={r.managerId ?? ""}
                      onChange={async e => await updateRepManager(r.id, e.target.value || null)}
                      className="w-full h-7 px-2 text-xs rounded ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none bg-white">
                      <option value="">Reports to ED/RM — None</option>
                      {edRms.map((ed: any) => <option key={ed.id} value={ed.id}>{ed.name}</option>)}
                    </select>
                  </div>
                )}
                {info?.hasLogin && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    <span className="text-[10px] text-stone-400">Portal login: {info.email}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {isAdmin && (
          <div className="pt-3 border-t border-stone-100">
            <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-2">Add Rep / PM</div>
            <div className="space-y-1.5">
              <input value={newRepName} onChange={e => setNewRepName(e.target.value)} placeholder="Name *"
                className="w-full h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
              <input value={newRepEmail} onChange={e => setNewRepEmail(e.target.value)} placeholder="Email (used as portal login)"
                className="w-full h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
              {edRms.length > 0 && (
                <select value={newRepManager} onChange={e => setNewRepManager(e.target.value)}
                  className="w-full h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none bg-white">
                  <option value="">Reports to ED/RM — None</option>
                  {edRms.map((ed: any) => <option key={ed.id} value={ed.id}>{ed.name}</option>)}
                </select>
              )}
              <Button size="sm" icon={Plus} disabled={addingRep || !newRepName.trim()}
                onClick={async () => {
                  setAddingRep(true);
                  try {
                    const rep = await addRep({ name: newRepName.trim(), email: newRepEmail.trim() || undefined, tier: "rep" });
                    if (newRepManager && rep?.id) await updateRepManager(rep.id, newRepManager);
                    setNewRepName(""); setNewRepEmail(""); setNewRepManager("");
                  } finally { setAddingRep(false); }
                }}>
                {addingRep ? "Adding…" : "Add Rep / PM"}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* ── ED / RM ───────────────────────────────────────────────────────────── */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <Shield size={15} className="text-orange-500" />
          <h3 className="text-sm font-semibold text-stone-900">ED / RM</h3>
          <span className="ml-auto text-[11px] text-stone-400">{edRms.length}</span>
        </div>
        <p className="text-[12px] text-stone-500 mb-4">
          Managers with a portal login. When they log in they see an aggregated view of all Reps/PMs reporting to them —
          same data as the Rep view but covering multiple PMs at once.
        </p>

        <div className="space-y-3 mb-4">
          {edRms.length === 0 && <div className="text-sm text-stone-400 py-2">No ED/RMs defined yet.</div>}
          {edRms.map((r: any) => {
            const info      = loginInfos[r.id];
            const reportees = regularReps.filter((rep: any) => rep.managerId === r.id);
            return (
              <div key={r.id} className="px-3 py-3 rounded-lg bg-stone-50 ring-1 ring-stone-100">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Shield size={13} className="text-orange-500 shrink-0" />
                      <span className="text-sm font-medium text-stone-800">{r.name}</span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-50 text-orange-700">ED/RM</span>
                    </div>
                    {r.email && <div className="text-[11px] text-stone-500 ml-5">{r.email}</div>}
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => setLoginModal({ repId: r.id, repName: r.name, hasLogin: info?.hasLogin ?? false })}
                        className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-stone-900 text-white hover:bg-stone-700">
                        <KeyRound size={11} />
                        {info?.hasLogin ? "Reset" : "Login"}
                      </button>
                      <button onClick={() => deleteRep(r.id)} className="p-1.5 text-stone-400 hover:text-rose-600 rounded">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Reps reporting to this ED/RM */}
                <div className="mt-2.5 ml-5">
                  <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5">Reps / PMs reporting to {r.name}</div>
                  {reportees.length === 0 ? (
                    <div className="text-[11px] text-stone-400 italic">No Reps assigned yet — use the Reports to dropdown in the Rep section above.</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {reportees.map((rep: any) => (
                        <span key={rep.id}
                          className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                          <Briefcase size={9} />
                          {rep.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {info?.hasLogin && (
                  <div className="mt-1.5 ml-5 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    <span className="text-[10px] text-stone-400">Portal login: {info.email}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {isAdmin && (
          <div className="pt-3 border-t border-stone-100">
            <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-2">Add ED / RM</div>
            <div className="space-y-1.5">
              <input value={newEdName} onChange={e => setNewEdName(e.target.value)} placeholder="Name *"
                className="w-full h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
              <input value={newEdEmail} onChange={e => setNewEdEmail(e.target.value)} placeholder="Email (used as portal login)"
                className="w-full h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
              <Button size="sm" icon={Plus} disabled={addingEd || !newEdName.trim()}
                onClick={async () => {
                  setAddingEd(true);
                  try {
                    await addRep({ name: newEdName.trim(), email: newEdEmail.trim() || undefined, tier: "ed" });
                    setNewEdName(""); setNewEdEmail("");
                  } finally { setAddingEd(false); }
                }}>
                {addingEd ? "Adding…" : "Add ED / RM"}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Portal login modal */}
      {loginModal && (
        <PasswordModal
          repId={loginModal.repId} repName={loginModal.repName} hasLogin={loginModal.hasLogin}
          onClose={() => setLoginModal(null)}
          onSuccess={({ email }) => handleLoginSuccess(loginModal.repId, email)}
        />
      )}
    </div>
  );
}
