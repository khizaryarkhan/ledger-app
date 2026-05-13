"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useData } from "@/components/data-provider";
import { Card, Button } from "@/components/ui";
import {
  ChevronLeft, Users, MapPin, Plus, Trash2, KeyRound, Eye, EyeOff, Shield, UserPlus,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────
type LoginInfo = { hasLogin: boolean; email: string | null; status: string | null };
type TeamMember = { id: string; name: string; email: string; role: string; status: string };

// ── Login modal (shared for reps and ED/RDs) ───────────────────────────────
function LoginModal({
  repId,
  repName,
  hasLogin,
  onClose,
  onSuccess,
}: {
  repId: string;
  repName: string;
  hasLogin: boolean;
  onClose: () => void;
  onSuccess: (info: { email: string }) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleSave = async () => {
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (password !== confirm) { setError("Passwords do not match"); return; }
    setSaving(true); setError("");
    try {
      const res = await fetch(`/api/admin/reps/${repId}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to save"); return; }
      setSuccess(data.created ? `Login created. Email: ${data.email}` : `Password reset. Email: ${data.email}`);
      onSuccess({ email: data.email });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-center gap-2 mb-1">
          <KeyRound size={16} className="text-stone-700" />
          <h2 className="text-base font-semibold text-stone-900">
            {hasLogin ? "Reset password" : "Create login"}
          </h2>
        </div>
        <p className="text-[12px] text-stone-500 mb-5">
          {hasLogin
            ? `Set a new password for ${repName}.`
            : `${repName} will be able to log in and view their assigned receivables.`}
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">New password</label>
            <div className="relative">
              <input
                type={show ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                className="w-full h-9 px-3 pr-9 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
              />
              <button type="button" onClick={() => setShow(p => !p)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700">
                {show ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Confirm password</label>
            <input
              type={show ? "text" : "password"}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Re-enter password"
              className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
            />
          </div>
          {error && <div className="text-xs text-rose-600 bg-rose-50 ring-1 ring-rose-200 rounded px-3 py-2">{error}</div>}
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

// ── Main page ──────────────────────────────────────────────────────────────
export default function TeamSettingsPage() {
  const { data: session } = useSession();
  const { reps, regions, orgSettings, addRep, updateRepTier, updateRepManager, deleteRep, addRegion, deleteRegion, updateOrgSettings } = useData();

  const role = (session?.user as any)?.role;
  const isAdmin = role === "company_admin" || role === "super_admin";

  // Login statuses keyed by repId
  const [loginInfos, setLoginInfos] = useState<Record<string, LoginInfo>>({});

  // Modal state
  const [loginModal, setLoginModal] = useState<{ repId: string; repName: string; hasLogin: boolean } | null>(null);

  // Add ED/RD form
  const [newEdName, setNewEdName] = useState("");
  const [newEdEmail, setNewEdEmail] = useState("");
  const [addingEd, setAddingEd] = useState(false);

  // Add Rep form
  const [newRepName, setNewRepName] = useState("");
  const [newRepEmail, setNewRepEmail] = useState("");
  const [newRepManager, setNewRepManager] = useState("");
  const [addingRep, setAddingRep] = useState(false);

  // Add region
  const [newRegionName, setNewRegionName] = useState("");
  const [addingRegion, setAddingRegion] = useState(false);

  // Team Members (company users) — owned by this page, not the data provider
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [newMember, setNewMember] = useState({ name: "", email: "", password: "", role: "company_user" });
  const [addingMember, setAddingMember] = useState(false);
  const [memberError, setMemberError] = useState("");

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
    if (!newMember.name.trim()) { setMemberError("Name is required"); return; }
    if (!/.+@.+\..+/.test(newMember.email)) { setMemberError("Valid email is required"); return; }
    if (newMember.password.length < 8) { setMemberError("Password must be at least 8 characters"); return; }
    setAddingMember(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newMember),
      });
      const data = await res.json();
      if (!res.ok) { setMemberError(data?.error || "Failed to create user"); return; }
      setNewMember({ name: "", email: "", password: "", role: "company_user" });
      await loadMembers();
    } finally { setAddingMember(false); }
  };

  const toggleMemberStatus = async (m: TeamMember) => {
    const next = m.status === "Active" ? "Inactive" : "Active";
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: m.id, status: next }),
    });
    if (res.ok) await loadMembers();
  };

  const edRds = (reps ?? []).filter((r: any) => r.tier === "ed" || r.tier === "rd");
  const regularReps = (reps ?? []).filter((r: any) => r.tier !== "ed" && r.tier !== "rd");

  // Load login statuses
  useEffect(() => {
    if (!reps || reps.length === 0 || !isAdmin) return;
    Promise.all(
      (reps as any[]).map(async (r: any) => {
        try {
          const res = await fetch(`/api/admin/reps/${r.id}/login`);
          return [r.id, res.ok ? await res.json() : { hasLogin: false, email: null, status: null }];
        } catch {
          return [r.id, { hasLogin: false, email: null, status: null }];
        }
      })
    ).then(entries => setLoginInfos(Object.fromEntries(entries)));
  }, [reps, isAdmin]);

  const openLoginModal = (repId: string, repName: string) => {
    setLoginModal({ repId, repName, hasLogin: loginInfos[repId]?.hasLogin ?? false });
  };

  const handleLoginSuccess = (repId: string, email: string) => {
    setLoginInfos(prev => ({ ...prev, [repId]: { hasLogin: true, email, status: "Active" } }));
  };

  // ── Row for an ED/RD ────────────────────────────────────────────────────
  const EdRdRow = ({ r }: { r: any }) => {
    const info = loginInfos[r.id];
    const reportees = regularReps.filter((rep: any) => rep.managerId === r.id);
    return (
      <div className="px-3 py-2.5 rounded-md bg-stone-50 ring-1 ring-stone-100">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Shield size={13} className="text-violet-500 shrink-0" />
              <span className="text-sm font-medium text-stone-800">{r.name}</span>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 uppercase tracking-wide">ED/RD</span>
            </div>
            {r.email && <div className="text-[11px] text-stone-500 ml-5">{r.email}</div>}
            {reportees.length > 0 && (
              <div className="text-[11px] text-stone-400 ml-5 mt-0.5">
                Reports: {reportees.map((rep: any) => rep.name).join(", ")}
              </div>
            )}
          </div>
          {isAdmin && (
            <div className="flex items-center gap-1 ml-2 shrink-0">
              <button
                onClick={() => openLoginModal(r.id, r.name)}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-stone-900 text-white hover:bg-stone-700 transition-colors"
              >
                <KeyRound size={11} />
                {info?.hasLogin ? "Reset" : "Create login"}
              </button>
              <button onClick={() => deleteRep(r.id)} className="p-1 text-stone-400 hover:text-rose-600 rounded">
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </div>
        {info?.hasLogin && (
          <div className="mt-1 ml-5 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
            <span className="text-[10px] text-stone-400">Login: {info.email}</span>
          </div>
        )}
      </div>
    );
  };

  // ── Row for a regular Rep ───────────────────────────────────────────────
  const RepRow = ({ r }: { r: any }) => {
    const info = loginInfos[r.id];
    return (
      <div className="px-3 py-2.5 rounded-md bg-stone-50 ring-1 ring-stone-100">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-stone-800">{r.name}</div>
            {r.email && <div className="text-[11px] text-stone-500">{r.email}</div>}
          </div>
          {isAdmin && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => openLoginModal(r.id, r.name)}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-stone-900 text-white hover:bg-stone-700 transition-colors"
              >
                <KeyRound size={11} />
                {info?.hasLogin ? "Reset" : "Create login"}
              </button>
              <button onClick={() => deleteRep(r.id)} className="p-1 text-stone-400 hover:text-rose-600 rounded">
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </div>
        {/* Manager assignment */}
        {isAdmin && (
          <div className="mt-2">
            <label className="text-[10px] text-stone-400 font-medium uppercase tracking-wide block mb-1">Reports to (ED/RD)</label>
            <select
              value={r.managerId ?? ""}
              onChange={async e => {
                const val = e.target.value || null;
                await updateRepManager(r.id, val);
              }}
              className="w-full h-7 px-2 text-xs rounded ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none bg-white"
            >
              <option value="">— None —</option>
              {edRds.map((ed: any) => (
                <option key={ed.id} value={ed.id}>{ed.name}</option>
              ))}
            </select>
          </div>
        )}
        {!isAdmin && r.managerId && (
          <div className="text-[11px] text-stone-400 mt-1">
            Reports to: {edRds.find((e: any) => e.id === r.managerId)?.name ?? "—"}
          </div>
        )}
        {info?.hasLogin && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
            <span className="text-[10px] text-stone-400">Login: {info.email}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-6 max-w-[900px] mx-auto">
      {/* Back + header */}
      <div className="mb-6">
        <Link href="/settings" className="inline-flex items-center gap-1 text-[13px] text-stone-500 hover:text-stone-900 mb-3 transition-colors">
          <ChevronLeft size={14} /> Settings
        </Link>
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Team</h1>
        <p className="text-sm text-stone-500 mt-1">Manage ED/RDs, reps, regions and portal access.</p>
      </div>

      {/* Classification level */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-4">
          <Users size={16} className="text-stone-600" />
          <h3 className="text-sm font-semibold text-stone-900">Classification level</h3>
        </div>
        <div className="flex gap-2 mb-2">
          {(["customer", "project"] as const).map(level => (
            <button
              key={level}
              onClick={() => isAdmin && updateOrgSettings({ classificationLevel: level })}
              className={`px-4 py-2 rounded-md text-sm font-medium border transition-colors ${
                orgSettings?.classificationLevel === level
                  ? "bg-stone-900 text-white border-stone-900"
                  : "bg-white text-stone-600 border-stone-200 hover:border-stone-400"
              }`}
            >
              By {level === "customer" ? "Customer" : "Project / Sub-customer"}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-stone-500">
          {orgSettings?.classificationLevel === "customer"
            ? "Rep and Region are assigned at the Customer level."
            : "Rep and Region are assigned at the Project level."}
        </p>
      </Card>

      {/* Team Members (company users) */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-4">
          <UserPlus size={15} className="text-stone-600" />
          <h3 className="text-sm font-semibold text-stone-900">Team Members</h3>
          <span className="ml-auto text-[11px] text-stone-400">{members.length}</span>
        </div>
        <p className="text-[12px] text-stone-500 mb-3">
          Users in this organisation who log in and manage receivables. Reps are managed below in their own section.
        </p>

        <div className="space-y-2 mb-4 max-h-72 overflow-y-auto">
          {loadingMembers && <div className="text-sm text-stone-400 py-1">Loading…</div>}
          {!loadingMembers && members.length === 0 && (
            <div className="text-sm text-stone-400 py-1">No team members yet.</div>
          )}
          {members.map(m => (
            <div key={m.id} className="flex items-center justify-between px-3 py-2 rounded-md bg-stone-50 ring-1 ring-stone-100">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-stone-800">{m.name}</span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide bg-stone-200 text-stone-700">
                    {m.role === "company_admin" ? "Admin" : m.role === "super_admin" ? "Super" : "User"}
                  </span>
                  <span className={`text-[10px] ${m.status === "Active" ? "text-emerald-600" : "text-stone-400"}`}>
                    {m.status}
                  </span>
                </div>
                <div className="text-[11px] text-stone-500">{m.email}</div>
              </div>
              {isAdmin && m.role !== "super_admin" && (
                <button
                  onClick={() => toggleMemberStatus(m)}
                  className="text-[11px] px-2 py-1 rounded ring-1 ring-stone-200 text-stone-600 hover:bg-stone-100"
                >
                  {m.status === "Active" ? "Deactivate" : "Activate"}
                </button>
              )}
            </div>
          ))}
        </div>

        {isAdmin && (
          <div className="space-y-1.5 pt-3 border-t border-stone-100">
            <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-1">Add team member</div>
            <div className="grid grid-cols-2 gap-1.5">
              <input
                value={newMember.name}
                onChange={e => setNewMember({ ...newMember, name: e.target.value })}
                placeholder="Full name *"
                className="h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
              />
              <input
                value={newMember.email}
                onChange={e => setNewMember({ ...newMember, email: e.target.value })}
                placeholder="Email *"
                className="h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
              />
              <input
                type="password"
                value={newMember.password}
                onChange={e => setNewMember({ ...newMember, password: e.target.value })}
                placeholder="Initial password (8+ chars) *"
                className="h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
              />
              <select
                value={newMember.role}
                onChange={e => setNewMember({ ...newMember, role: e.target.value })}
                className="h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none bg-white"
              >
                <option value="company_user">User</option>
                {role === "super_admin" && <option value="company_admin">Company Admin</option>}
              </select>
            </div>
            {memberError && (
              <div className="text-xs text-rose-600 bg-rose-50 ring-1 ring-rose-200 rounded px-2 py-1.5">{memberError}</div>
            )}
            <Button size="sm" icon={Plus} disabled={addingMember} onClick={addMember}>
              {addingMember ? "Adding…" : "Add team member"}
            </Button>
            <p className="text-[10px] text-stone-400">
              Share the email + initial password with the user; they can change it after first login.
            </p>
          </div>
        )}
      </Card>

      {/* ED/RD + Reps side by side */}
      <div className="grid grid-cols-2 gap-4 mb-4">

        {/* ── ED / RD section ── */}
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Shield size={15} className="text-violet-500" />
            <h3 className="text-sm font-semibold text-stone-900">ED / RD</h3>
            <span className="ml-auto text-[11px] text-stone-400">{edRds.length}</span>
          </div>
          <p className="text-[12px] text-stone-500 mb-3">
            ED/RDs have their own portal login and see data for all reps reporting to them.
          </p>

          <div className="space-y-2 mb-4 max-h-72 overflow-y-auto">
            {edRds.length === 0 && <div className="text-sm text-stone-400 py-1">No ED/RDs defined yet.</div>}
            {edRds.map((r: any) => <EdRdRow key={r.id} r={r} />)}
          </div>

          {isAdmin && (
            <div className="space-y-1.5 pt-3 border-t border-stone-100">
              <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-1">Add ED/RD</div>
              <input
                value={newEdName}
                onChange={e => setNewEdName(e.target.value)}
                placeholder="Name *"
                className="w-full h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
              />
              <input
                value={newEdEmail}
                onChange={e => setNewEdEmail(e.target.value)}
                placeholder="Email (used as login)"
                className="w-full h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
              />
              <Button
                size="sm"
                icon={Plus}
                disabled={addingEd || !newEdName.trim()}
                onClick={async () => {
                  setAddingEd(true);
                  try {
                    await addRep({ name: newEdName.trim(), email: newEdEmail.trim() || undefined, tier: "ed" });
                    setNewEdName(""); setNewEdEmail("");
                  } finally { setAddingEd(false); }
                }}
              >
                Add ED/RD
              </Button>
            </div>
          )}
        </Card>

        {/* ── Reps section ── */}
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Users size={15} className="text-stone-500" />
            <h3 className="text-sm font-semibold text-stone-900">Reps</h3>
            <span className="ml-auto text-[11px] text-stone-400">{regularReps.length}</span>
          </div>
          <p className="text-[12px] text-stone-500 mb-3">
            Each rep sees only their assigned customers and invoices. Assign them to an ED/RD so they roll up.
          </p>

          <div className="space-y-2 mb-4 max-h-72 overflow-y-auto">
            {regularReps.length === 0 && <div className="text-sm text-stone-400 py-1">No reps defined yet.</div>}
            {regularReps.map((r: any) => <RepRow key={r.id} r={r} />)}
          </div>

          {isAdmin && (
            <div className="space-y-1.5 pt-3 border-t border-stone-100">
              <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-1">Add rep</div>
              <input
                value={newRepName}
                onChange={e => setNewRepName(e.target.value)}
                placeholder="Name *"
                className="w-full h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
              />
              <input
                value={newRepEmail}
                onChange={e => setNewRepEmail(e.target.value)}
                placeholder="Email (used as login)"
                className="w-full h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
              />
              {edRds.length > 0 && (
                <select
                  value={newRepManager}
                  onChange={e => setNewRepManager(e.target.value)}
                  className="w-full h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none bg-white"
                >
                  <option value="">Reports to — None</option>
                  {edRds.map((ed: any) => (
                    <option key={ed.id} value={ed.id}>Reports to {ed.name}</option>
                  ))}
                </select>
              )}
              <Button
                size="sm"
                icon={Plus}
                disabled={addingRep || !newRepName.trim()}
                onClick={async () => {
                  setAddingRep(true);
                  try {
                    const rep = await addRep({ name: newRepName.trim(), email: newRepEmail.trim() || undefined, tier: "rep" });
                    if (newRepManager && rep?.id) {
                      await updateRepManager(rep.id, newRepManager);
                    }
                    setNewRepName(""); setNewRepEmail(""); setNewRepManager("");
                  } finally { setAddingRep(false); }
                }}
              >
                Add rep
              </Button>
            </div>
          )}
        </Card>
      </div>

      {/* Regions */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-4">
          <MapPin size={15} className="text-stone-500" />
          <h3 className="text-sm font-semibold text-stone-900">Regions</h3>
          <span className="ml-auto text-[11px] text-stone-400">{regions?.length ?? 0}</span>
        </div>
        <div className="space-y-1 mb-3 max-h-48 overflow-y-auto">
          {(regions ?? []).length === 0 && <div className="text-sm text-stone-400 py-1">No regions defined yet.</div>}
          {(regions ?? []).map((r: any) => (
            <div key={r.id} className="flex items-center justify-between px-3 py-2 rounded-md bg-stone-50 ring-1 ring-stone-100">
              <div className="flex items-center gap-2">
                <MapPin size={12} className="text-stone-400" />
                <span className="text-sm text-stone-800">{r.name}</span>
              </div>
              {isAdmin && (
                <button onClick={() => deleteRegion(r.id)} className="p-1 text-stone-400 hover:text-rose-600 rounded">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
        {isAdmin && (
          <div className="flex gap-2 items-center">
            <input
              value={newRegionName}
              onChange={e => setNewRegionName(e.target.value)}
              placeholder="Region name *"
              className="flex-1 h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
            />
            <Button
              size="sm"
              icon={Plus}
              disabled={addingRegion || !newRegionName.trim()}
              onClick={async () => {
                setAddingRegion(true);
                try {
                  await addRegion({ name: newRegionName.trim() });
                  setNewRegionName("");
                } finally { setAddingRegion(false); }
              }}
            >
              Add
            </Button>
          </div>
        )}
      </Card>

      {/* Login modal */}
      {loginModal && (
        <LoginModal
          repId={loginModal.repId}
          repName={loginModal.repName}
          hasLogin={loginModal.hasLogin}
          onClose={() => setLoginModal(null)}
          onSuccess={({ email }) => {
            handleLoginSuccess(loginModal.repId, email);
            setLoginModal(null);
          }}
        />
      )}
    </div>
  );
}
