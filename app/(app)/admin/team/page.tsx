"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Users, Plus, X, Eye, EyeOff, Loader2, ShieldCheck, Shield, UserX, UserCheck } from "lucide-react";

// ── Add Admin Modal ────────────────────────────────────────────────────────
function AddAdminModal({ onClose, onSaved }: { onClose: () => void; onSaved: (u: any) => void }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "platform_admin" });
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async () => {
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/admin/platform-users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to create admin"); return; }
      onSaved(data);
      onClose();
    } finally { setSaving(false); }
  };

  const canSubmit = !saving && !!form.name.trim() && !!form.email.trim() && form.password.length >= 8;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-stone-900 rounded-xl w-full max-w-md shadow-xl ring-1 ring-stone-800">
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/15 flex items-center justify-center">
              <ShieldCheck size={13} className="text-emerald-400" />
            </div>
            <h2 className="font-semibold text-white text-sm">Add admin user</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-white">
            <X size={15} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {error && (
            <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{error}</div>
          )}
          <div>
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Full name</label>
            <input value={form.name} onChange={e => set("name", e.target.value)} placeholder="Jane Smith"
              className="w-full h-9 px-3 text-sm rounded-lg border border-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 focus:border-emerald-500 focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Email</label>
            <input type="email" value={form.email} onChange={e => set("email", e.target.value)} placeholder="admin@primeaccountax.com"
              className="w-full h-9 px-3 text-sm rounded-lg border border-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 focus:border-emerald-500 focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Temporary password</label>
            <div className="relative">
              <input type={showPw ? "text" : "password"} value={form.password} onChange={e => set("password", e.target.value)}
                placeholder="Min 8 characters"
                className="w-full h-9 px-3 pr-9 text-sm rounded-lg border border-stone-700 bg-stone-800 text-stone-200 placeholder-stone-600 focus:border-emerald-500 focus:outline-none" />
              <button type="button" onClick={() => setShowPw(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300">
                {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Role</label>
            <select value={form.role} onChange={e => set("role", e.target.value)}
              className="w-full h-9 px-3 text-sm rounded-lg border border-stone-700 bg-stone-800 text-stone-200 focus:border-emerald-500 focus:outline-none">
              <option value="platform_admin">Platform Admin — standard admin access</option>
              <option value="super_admin">Super Admin — full access including org creation</option>
            </select>
          </div>
          <div className="text-[11px] text-stone-600 bg-stone-800/60 rounded-lg px-3 py-2 leading-relaxed">
            The user will be able to sign in at <span className="text-stone-400 font-mono">admin.primeaccountax.com</span> with these credentials.
            Ask them to change their password after first login.
          </div>
        </div>

        <div className="px-5 py-3 border-t border-stone-800 flex justify-end gap-2">
          <button onClick={onClose} className="h-8 px-3 text-xs rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={!canSubmit}
            className="h-8 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 disabled:text-stone-500 text-white transition-colors flex items-center gap-1.5">
            {saving && <Loader2 size={11} className="animate-spin" />}
            Add admin
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function TeamPage() {
  const { data: session } = useSession();
  const selfId = (session?.user as any)?.id;
  const [admins, setAdmins] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [error, setError]   = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/platform-users");
      if (r.ok) setAdmins(await r.json());
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const toggleStatus = async (admin: any) => {
    if (admin.id === selfId) return;
    setToggling(admin.id);
    setError("");
    try {
      const newStatus = admin.status === "Active" ? "Inactive" : "Active";
      const res = await fetch("/api/admin/platform-users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: admin.id, status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to update"); return; }
      setAdmins(prev => prev.map(a => a.id === admin.id ? { ...a, status: newStatus } : a));
    } finally { setToggling(null); }
  };

  const handleAdded = (u: any) => {
    setAdmins(prev => [u, ...prev]);
  };

  const active   = admins.filter(a => a.status === "Active");
  const inactive = admins.filter(a => a.status !== "Active");

  return (
    <div className="max-w-2xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-base font-semibold text-white">Admin Team</h1>
          <p className="text-xs text-stone-500 mt-0.5">Platform admins with access to this portal</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors">
          <Plus size={13} /> Add admin
        </button>
      </div>

      {error && (
        <div className="mb-4 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-stone-400 py-8">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-6">
          {/* Active admins */}
          <section>
            <p className="text-[10px] font-semibold text-stone-600 uppercase tracking-widest mb-2">
              Active · {active.length}
            </p>
            <div className="rounded-xl border border-stone-800 divide-y divide-stone-800/60 overflow-hidden">
              {active.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-stone-600">No active admins.</div>
              )}
              {active.map(admin => (
                <AdminRow
                  key={admin.id}
                  admin={admin}
                  isSelf={admin.id === selfId}
                  toggling={toggling === admin.id}
                  onToggle={() => toggleStatus(admin)}
                />
              ))}
            </div>
          </section>

          {/* Inactive admins */}
          {inactive.length > 0 && (
            <section>
              <p className="text-[10px] font-semibold text-stone-600 uppercase tracking-widest mb-2">
                Inactive · {inactive.length}
              </p>
              <div className="rounded-xl border border-stone-800 divide-y divide-stone-800/60 overflow-hidden">
                {inactive.map(admin => (
                  <AdminRow
                    key={admin.id}
                    admin={admin}
                    isSelf={admin.id === selfId}
                    toggling={toggling === admin.id}
                    onToggle={() => toggleStatus(admin)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {showAdd && <AddAdminModal onClose={() => setShowAdd(false)} onSaved={handleAdded} />}
    </div>
  );
}

function AdminRow({ admin, isSelf, toggling, onToggle }: {
  admin: any; isSelf: boolean; toggling: boolean; onToggle: () => void;
}) {
  const initials = admin.name.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase();
  const isSuper  = admin.role === "super_admin";
  const isActive = admin.status === "Active";

  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${!isActive ? "opacity-50" : ""}`}>
      {/* Avatar */}
      <div className="w-9 h-9 rounded-lg bg-stone-800 flex items-center justify-center text-stone-300 text-xs font-bold shrink-0">
        {initials}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white truncate">{admin.name}</span>
          {isSelf && <span className="text-[10px] text-stone-600 bg-stone-800 px-1.5 py-0.5 rounded font-medium">You</span>}
        </div>
        <p className="text-[11px] text-stone-500 truncate">{admin.email}</p>
      </div>

      {/* Role badge */}
      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
        isSuper
          ? "text-purple-400 bg-purple-500/15 border-purple-500/20"
          : "text-blue-400 bg-blue-500/15 border-blue-500/20"
      }`}>
        {isSuper ? <Shield size={9} /> : <ShieldCheck size={9} />}
        {isSuper ? "Super Admin" : "Platform Admin"}
      </span>

      {/* Joined */}
      <span className="text-[11px] text-stone-600 whitespace-nowrap hidden sm:block">
        {new Date(admin.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
      </span>

      {/* Toggle */}
      {!isSelf && (
        <button onClick={onToggle} disabled={toggling}
          className={`flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11px] font-medium transition-colors ${
            isActive
              ? "text-stone-500 bg-stone-800 hover:bg-rose-500/15 hover:text-rose-400"
              : "text-stone-500 bg-stone-800 hover:bg-emerald-500/15 hover:text-emerald-400"
          }`}>
          {toggling
            ? <Loader2 size={11} className="animate-spin" />
            : isActive
              ? <><UserX size={11} /> Deactivate</>
              : <><UserCheck size={11} /> Activate</>
          }
        </button>
      )}
    </div>
  );
}
