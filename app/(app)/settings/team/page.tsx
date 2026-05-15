"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useData } from "@/components/data-provider";
import { Card, Button } from "@/components/ui";
import {
  ChevronLeft, Users, Plus, Trash2, Shield, UserPlus,
  ChevronDown, Briefcase, X,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
// Virtual role = what the UI shows. Maps to users.role + reps.tier:
//   company_admin → Admin
//   company_user  → Full Access
//   rep           → Rep / PM   (users.role='rep', reps.tier='rep')
//   ed            → ED / RM    (users.role='rep', reps.tier='ed' or 'rd')

type TeamUser = {
  id: string;
  orgId: string;
  name: string;
  email: string;
  role: string;          // db value: 'company_admin' | 'company_user' | 'rep'
  repId: string | null;
  repTier: string | null;      // 'rep' | 'ed' | 'rd' | null
  repManagerId: string | null; // reps.managerId — the rep record of the managing ED
  status: string;
  createdAt: string;
};

// Derive display role from db role + repTier
function virtualRole(u: TeamUser): string {
  if (u.role === "rep") return (u.repTier === "ed" || u.repTier === "rd") ? "ed" : "rep";
  return u.role;
}

const ROLE_LABEL: Record<string, string> = {
  company_admin: "Admin",
  company_user:  "Full Access",
  rep:           "Rep / PM",
  ed:            "ED / RM",
  super_admin:   "Super Admin",
};

const ROLE_COLOR: Record<string, string> = {
  company_admin: "bg-violet-50 text-violet-700 ring-violet-200",
  company_user:  "bg-blue-50 text-blue-700 ring-blue-200",
  rep:           "bg-emerald-50 text-emerald-700 ring-emerald-200",
  ed:            "bg-orange-50 text-orange-700 ring-orange-200",
  super_admin:   "bg-rose-50 text-rose-700 ring-rose-200",
};

// ── Main page ──────────────────────────────────────────────────────────────────
export default function TeamSettingsPage() {
  const { data: session } = useSession();
  const { updateRepManager } = useData();

  const currentUserId = (session?.user as any)?.id;
  const sessionRole   = (session?.user as any)?.role;
  const isAdmin  = sessionRole === "company_admin" || sessionRole === "super_admin";
  const isSuper  = sessionRole === "super_admin";

  // ── Users state ──────────────────────────────────────────────────────────────
  const [members,        setMembers]        = useState<TeamUser[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const loadMembers = async () => {
    setLoadingMembers(true);
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) setMembers(await res.json());
    } finally { setLoadingMembers(false); }
  };
  useEffect(() => { if (isAdmin) loadMembers(); }, [isAdmin]);

  // ── Create user form ──────────────────────────────────────────────────────────
  const [newUser,     setNewUser]     = useState({ name: "", email: "", password: "", role: "company_user" });
  const [addingUser,  setAddingUser]  = useState(false);
  const [createError, setCreateError] = useState("");

  const createUser = async () => {
    setCreateError("");
    if (!newUser.name.trim())             { setCreateError("Name is required"); return; }
    if (!/.+@.+\..+/.test(newUser.email)) { setCreateError("Valid email is required"); return; }
    if (newUser.password.length < 8)      { setCreateError("Password must be at least 8 characters"); return; }
    setAddingUser(true);
    try {
      const res  = await fetch("/api/admin/users", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      });
      const data = await res.json();
      if (!res.ok) { setCreateError(data?.error || "Failed to create user"); return; }
      setNewUser({ name: "", email: "", password: "", role: "company_user" });
      await loadMembers();
    } finally { setAddingUser(false); }
  };

  // ── Actions ───────────────────────────────────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [roleSaving,    setRoleSaving]    = useState<string | null>(null);
  const [managerSaving, setManagerSaving] = useState<string | null>(null);

  const toggleStatus = async (m: TeamUser) => {
    await fetch("/api/admin/users", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: m.id, status: m.status === "Active" ? "Inactive" : "Active" }),
    });
    await loadMembers();
  };

  const changeRole = async (m: TeamUser, newVirtualRole: string) => {
    setRoleSaving(m.id);
    try {
      await fetch("/api/admin/users", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: m.id, role: newVirtualRole }),
      });
      await loadMembers();
    } finally { setRoleSaving(null); }
  };

  const deleteUser = async (userId: string) => {
    await fetch(`/api/admin/users?userId=${userId}`, { method: "DELETE" });
    setConfirmDelete(null);
    await loadMembers();
  };

  // Change which ED a rep reports to (using reps.managerId)
  const changeManager = async (repUser: TeamUser, newManagerRepId: string | null) => {
    if (!repUser.repId) return;
    setManagerSaving(repUser.id);
    try {
      await updateRepManager(repUser.repId, newManagerRepId);
      await loadMembers();
    } finally { setManagerSaving(null); }
  };

  // Add a rep as a reportee of an ED (set rep's managerId to the ED's repId)
  const addReportee = async (repUser: TeamUser, edRepId: string) => {
    if (!repUser.repId) return;
    setManagerSaving(repUser.id);
    try {
      await updateRepManager(repUser.repId, edRepId);
      await loadMembers();
    } finally { setManagerSaving(null); }
  };

  // Remove a rep from reporting to an ED
  const removeReportee = async (repUser: TeamUser) => {
    if (!repUser.repId) return;
    setManagerSaving(repUser.id);
    try {
      await updateRepManager(repUser.repId, null);
      await loadMembers();
    } finally { setManagerSaving(null); }
  };

  // ── Derived lists ─────────────────────────────────────────────────────────────
  const visible    = members.filter(m => m.role !== "super_admin");
  const repPmUsers = members.filter(m => virtualRole(m) === "rep");
  const edRmUsers  = members.filter(m => virtualRole(m) === "ed");

  // Reps not yet assigned to an ED (available to add as reportees)
  const unassignedReps = (edRepId: string) =>
    repPmUsers.filter(r => !r.repManagerId || r.repManagerId === "");

  return (
    <div className="p-6 max-w-[820px] mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link href="/settings"
          className="inline-flex items-center gap-1 text-[13px] text-stone-500 hover:text-stone-900 mb-3 transition-colors">
          <ChevronLeft size={14} /> Settings
        </Link>
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Team</h1>
        <p className="text-sm text-stone-500 mt-1">Manage users and access levels.</p>
      </div>

      {/* ── Role overview ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {[
          { icon: Shield,    color: "text-violet-500",  label: "Admin",       desc: "Full access — can create, edit and delete any user or data." },
          { icon: Users,     color: "text-blue-500",    label: "Full Access", desc: "Can do everything except create or delete users." },
          { icon: Briefcase, color: "text-emerald-500", label: "Rep / PM",    desc: "Portal login — sees only projects assigned to them." },
          { icon: Shield,    color: "text-orange-500",  label: "ED / RM",     desc: "Portal login — sees projects for all Reps reporting to them." },
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

      {/* ── Users list ─────────────────────────────────────────────────────────── */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <UserPlus size={15} className="text-stone-600" />
          <h3 className="text-sm font-semibold text-stone-900">Users</h3>
          <span className="ml-auto text-[11px] text-stone-400">{visible.length}</span>
        </div>
        <p className="text-[12px] text-stone-500 mb-4">
          All team members. Assign <strong className="font-medium text-stone-700">Rep / PM</strong> or{" "}
          <strong className="font-medium text-stone-700">ED / RM</strong> to give portal access and enable
          project assignment.
        </p>

        <div className="space-y-2 mb-5">
          {loadingMembers && <div className="text-sm text-stone-400 py-2">Loading…</div>}
          {!loadingMembers && visible.length === 0 && (
            <div className="text-sm text-stone-400 py-2">No users yet.</div>
          )}

          {visible.map(m => {
            const vRole      = virtualRole(m);
            const isPortal   = vRole === "rep" || vRole === "ed";
            const canEdit    = isAdmin && m.id !== currentUserId && m.role !== "super_admin";
            const isActive   = m.status === "Active";

            // For rep: find the ED/RM user they report to
            const managingEdUser = vRole === "rep" && m.repManagerId
              ? members.find(u => u.repId === m.repManagerId) ?? null
              : null;

            // For ed: find reps reporting to this ED
            const reporteeUsers = vRole === "ed" && m.repId
              ? repPmUsers.filter(r => r.repManagerId === m.repId)
              : [];

            // Reps available to add as reportees for this ED (not yet reporting to anyone)
            const addableReps = vRole === "ed" && m.repId
              ? repPmUsers.filter(r => !r.repManagerId && r.id !== m.id)
              : [];

            return (
              <div key={m.id}
                className={`rounded-lg ring-1 px-3 py-2.5 space-y-2 ${isActive ? "bg-white ring-stone-200" : "bg-stone-50 ring-stone-100 opacity-60"}`}>

                {/* ── Main row ── */}
                <div className="flex items-center gap-3">
                  {/* Avatar */}
                  <div className="w-8 h-8 rounded-full bg-stone-100 flex items-center justify-center text-[11px] font-semibold text-stone-600 shrink-0">
                    {m.name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase()}
                  </div>

                  {/* Name + role + email */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-stone-900 truncate">{m.name}</span>

                      {/* Role badge — clickable dropdown for admins */}
                      {canEdit ? (
                        <div className="relative group">
                          <button
                            className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ring-1 ${ROLE_COLOR[vRole] || "bg-stone-100 text-stone-600 ring-stone-200"} ${roleSaving === m.id ? "opacity-50" : ""}`}
                            disabled={roleSaving === m.id}>
                            {ROLE_LABEL[vRole] || vRole}
                            <ChevronDown size={9} />
                          </button>
                          <div className="absolute left-0 top-full mt-1 z-20 hidden group-hover:block bg-white rounded-lg shadow-xl ring-1 ring-stone-200 py-1 min-w-[140px]">
                            {[
                              { v: "company_user", label: "Full Access" },
                              ...(isSuper ? [{ v: "company_admin", label: "Admin" }] : []),
                              { v: "rep", label: "Rep / PM" },
                              { v: "ed",  label: "ED / RM" },
                            ].map(({ v, label }) => (
                              <button key={v} onClick={() => changeRole(m, v)}
                                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 transition-colors ${vRole === v ? "font-semibold text-stone-900" : "text-stone-600"}`}>
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ring-1 ${ROLE_COLOR[vRole] || "bg-stone-100 text-stone-600 ring-stone-200"}`}>
                          {ROLE_LABEL[vRole] || vRole}
                        </span>
                      )}

                      {!isActive && <span className="text-[10px] text-stone-400 italic">Inactive</span>}
                    </div>
                    <div className="text-[11px] text-stone-500">{m.email}</div>
                  </div>

                  {/* Action buttons */}
                  {canEdit && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => toggleStatus(m)}
                        className="text-[11px] px-2 py-1 rounded ring-1 ring-stone-200 text-stone-600 hover:bg-stone-100 transition-colors">
                        {isActive ? "Deactivate" : "Activate"}
                      </button>
                      {confirmDelete === m.id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-[11px] text-rose-600 font-medium">Sure?</span>
                          <button onClick={() => deleteUser(m.id)}
                            className="text-[11px] px-2 py-1 rounded bg-rose-600 text-white hover:bg-rose-700">Yes</button>
                          <button onClick={() => setConfirmDelete(null)}
                            className="text-[11px] px-2 py-1 rounded ring-1 ring-stone-200 text-stone-600 hover:bg-stone-100">No</button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDelete(m.id)}
                          className="p-1.5 text-stone-400 hover:text-rose-600 rounded transition-colors">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Rep / PM: "Reports to" ED dropdown ── */}
                {isPortal && vRole === "rep" && isAdmin && (
                  <div className="flex items-center gap-2 pl-11">
                    <span className="text-[11px] text-stone-400 shrink-0">Reports to:</span>
                    <select
                      value={m.repManagerId ?? ""}
                      disabled={managerSaving === m.id}
                      onChange={e => changeManager(m, e.target.value || null)}
                      className="flex-1 h-7 px-2 text-xs rounded ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none bg-white disabled:opacity-50">
                      <option value="">— None —</option>
                      {edRmUsers.map(ed => (
                        <option key={ed.id} value={ed.repId ?? ""}>
                          {ed.name}
                        </option>
                      ))}
                    </select>
                    {managingEdUser && (
                      <span className="text-[10px] text-stone-500 shrink-0">{managingEdUser.name}</span>
                    )}
                  </div>
                )}

                {/* ── ED / RM: Reporting reps ── */}
                {isPortal && vRole === "ed" && isAdmin && (
                  <div className="pl-11 space-y-1.5">
                    <div className="text-[11px] text-stone-400">Reporting Reps / PMs</div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {reporteeUsers.map(r => (
                        <span key={r.id}
                          className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                          <Briefcase size={9} />
                          {r.name}
                          <button onClick={() => removeReportee(r)}
                            className="ml-0.5 text-emerald-400 hover:text-rose-600 transition-colors">
                            <X size={9} />
                          </button>
                        </span>
                      ))}

                      {/* Add reportee dropdown */}
                      {addableReps.length > 0 && (
                        <div className="relative group">
                          <button className="inline-flex items-center gap-0.5 text-[11px] px-2 py-0.5 rounded-full ring-1 ring-dashed ring-stone-300 text-stone-500 hover:ring-stone-500 hover:text-stone-700 transition-colors">
                            <Plus size={9} /> Add
                          </button>
                          <div className="absolute left-0 top-full mt-1 z-20 hidden group-hover:block bg-white rounded-lg shadow-xl ring-1 ring-stone-200 py-1 min-w-[150px]">
                            {addableReps.map(r => (
                              <button key={r.id}
                                onClick={() => m.repId && addReportee(r, m.repId)}
                                className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 transition-colors">
                                {r.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {reporteeUsers.length === 0 && addableReps.length === 0 && (
                        <span className="text-[11px] text-stone-400 italic">No reps assigned</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Add User Form ── */}
        {isAdmin && (
          <div className="pt-4 border-t border-stone-100">
            <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-3">Add user</div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input
                value={newUser.name}
                onChange={e => setNewUser({ ...newUser, name: e.target.value })}
                placeholder="Full name *"
                className="h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
              <input
                value={newUser.email}
                onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                placeholder="Email *"
                className="h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
              <input
                type="password"
                value={newUser.password}
                onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                placeholder="Password (8+ chars) *"
                className="h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none" />
              <select
                value={newUser.role}
                onChange={e => setNewUser({ ...newUser, role: e.target.value })}
                className="h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none bg-white">
                <option value="company_user">Full Access</option>
                {isSuper && <option value="company_admin">Admin</option>}
                <option value="rep">Rep / PM</option>
                <option value="ed">ED / RM</option>
              </select>
            </div>

            {createError && (
              <div className="text-xs text-rose-600 bg-rose-50 ring-1 ring-rose-200 rounded px-2 py-1.5 mb-2">
                {createError}
              </div>
            )}

            <Button size="sm" icon={Plus} disabled={addingUser} onClick={createUser}>
              {addingUser ? "Adding…" : "Add user"}
            </Button>
            <p className="text-[10px] text-stone-400 mt-1.5">
              Rep / PM and ED / RM users get portal access — share their email + password so they can log in.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
