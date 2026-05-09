"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useData } from "@/components/data-provider";
import { Card, Button } from "@/components/ui";
import {
  ChevronLeft, Users, MapPin, Plus, Trash2, KeyRound, Eye, EyeOff, Search,
} from "lucide-react";

export default function TeamSettingsPage() {
  const { data: session } = useSession();
  const { reps, regions, orgSettings, addRep, deleteRep, addRegion, deleteRegion, updateOrgSettings } = useData();

  const role = (session?.user as any)?.role;
  const isAdmin = role === "company_admin" || role === "super_admin";

  // Rep search
  const [repSearch, setRepSearch] = useState("");

  // Add rep
  const [newRepName, setNewRepName] = useState("");
  const [newRepEmail, setNewRepEmail] = useState("");
  const [addingRep, setAddingRep] = useState(false);

  // Add region
  const [newRegionName, setNewRegionName] = useState("");
  const [addingRegion, setAddingRegion] = useState(false);

  // Rep login statuses
  const [repLogins, setRepLogins] = useState<Record<string, { hasLogin: boolean; email: string | null; status: string | null }>>({});

  // Rep login modal
  const [repLoginModal, setRepLoginModal] = useState<{ repId: string; repName: string; hasLogin: boolean } | null>(null);
  const [repLoginPassword, setRepLoginPassword] = useState("");
  const [repLoginConfirm, setRepLoginConfirm] = useState("");
  const [repLoginSaving, setRepLoginSaving] = useState(false);
  const [repLoginError, setRepLoginError] = useState("");
  const [repLoginSuccess, setRepLoginSuccess] = useState("");
  const [showRepPassword, setShowRepPassword] = useState(false);

  // Load rep login statuses
  useEffect(() => {
    if (!reps || reps.length === 0 || !isAdmin) return;
    const load = async () => {
      const entries = await Promise.all(
        (reps as any[]).map(async (r: any) => {
          try {
            const res = await fetch(`/api/admin/reps/${r.id}/login`);
            if (!res.ok) return [r.id, { hasLogin: false, email: null, status: null }];
            return [r.id, await res.json()];
          } catch {
            return [r.id, { hasLogin: false, email: null, status: null }];
          }
        })
      );
      setRepLogins(Object.fromEntries(entries));
    };
    load();
  }, [reps, isAdmin]);

  const handleRepLoginSave = async () => {
    if (!repLoginModal) return;
    if (repLoginPassword.length < 8) { setRepLoginError("Password must be at least 8 characters"); return; }
    if (repLoginPassword !== repLoginConfirm) { setRepLoginError("Passwords do not match"); return; }
    setRepLoginSaving(true);
    setRepLoginError("");
    setRepLoginSuccess("");
    try {
      const res = await fetch(`/api/admin/reps/${repLoginModal.repId}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: repLoginPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setRepLoginError(data.error || "Failed to save"); return; }
      setRepLoginSuccess(
        data.created
          ? `Login created! Rep can log in with: ${data.email}`
          : `Password updated for: ${data.email}`
      );
      setRepLogins(prev => ({
        ...prev,
        [repLoginModal.repId]: { hasLogin: true, email: data.email, status: "Active" },
      }));
      setRepLoginPassword("");
      setRepLoginConfirm("");
    } finally {
      setRepLoginSaving(false);
    }
  };

  const filteredReps = (reps ?? []).filter((r: any) =>
    !repSearch ||
    r.name?.toLowerCase().includes(repSearch.toLowerCase()) ||
    r.email?.toLowerCase().includes(repSearch.toLowerCase())
  );

  return (
    <div className="p-6 max-w-[860px] mx-auto">
      {/* Back + header */}
      <div className="mb-6">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-[13px] text-stone-500 hover:text-stone-900 mb-3 transition-colors"
        >
          <ChevronLeft size={14} /> Settings
        </Link>
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Team</h1>
        <p className="text-sm text-stone-500 mt-1">Manage reps, regions, portal access and classification.</p>
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
            ? "Rep and Region are assigned at the Customer level. All invoices for a customer belong to the assigned rep."
            : "Rep and Region are assigned at the Project (sub-customer) level. Useful when one customer has multiple reps per project."}
        </p>
      </Card>

      {/* Reps & Regions */}
      <Card className="mb-4">
        <div className="grid grid-cols-2 gap-6">
          {/* Reps */}
          <div>
            <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-3">
              Reps ({reps?.length ?? 0})
            </div>

            {(reps ?? []).length > 0 && (
              <div className="relative mb-2">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
                <input
                  value={repSearch}
                  onChange={e => setRepSearch(e.target.value)}
                  placeholder="Search reps…"
                  className="w-full h-8 pl-7 pr-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
                />
              </div>
            )}

            <div className="space-y-1 mb-3 max-h-64 overflow-y-auto">
              {(reps ?? []).length === 0 && (
                <div className="text-sm text-stone-400 py-2">No reps defined yet.</div>
              )}
              {filteredReps.map((r: any) => {
                const loginInfo = repLogins[r.id];
                return (
                  <div key={r.id} className="px-3 py-2 rounded-md bg-stone-50 ring-1 ring-stone-100">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-stone-800">{r.name}</div>
                        {r.email && <div className="text-[11px] text-stone-500">{r.email}</div>}
                      </div>
                      {isAdmin && (
                        <div className="flex items-center gap-1 ml-2 shrink-0">
                          <button
                            onClick={() => {
                              setRepLoginModal({ repId: r.id, repName: r.name, hasLogin: loginInfo?.hasLogin ?? false });
                              setRepLoginPassword("");
                              setRepLoginConfirm("");
                              setRepLoginError("");
                              setRepLoginSuccess("");
                              setShowRepPassword(false);
                            }}
                            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-stone-900 text-white hover:bg-stone-700 transition-colors"
                            title={loginInfo?.hasLogin ? "Reset password" : "Create login"}
                          >
                            <KeyRound size={11} />
                            {loginInfo?.hasLogin ? "Reset" : "Create login"}
                          </button>
                          <button
                            onClick={() => deleteRep(r.id)}
                            className="p-1 text-stone-400 hover:text-rose-600 rounded"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                    {loginInfo?.hasLogin && (
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                        <span className="text-[10px] text-stone-400">Login: {loginInfo.email}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {isAdmin && (
              <div className="space-y-1.5">
                <input
                  value={newRepName}
                  onChange={e => setNewRepName(e.target.value)}
                  placeholder="Rep name *"
                  className="w-full h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
                />
                <input
                  value={newRepEmail}
                  onChange={e => setNewRepEmail(e.target.value)}
                  placeholder="Email (optional)"
                  className="w-full h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
                />
                <Button
                  size="sm"
                  icon={Plus}
                  disabled={addingRep || !newRepName.trim()}
                  onClick={async () => {
                    setAddingRep(true);
                    try {
                      await addRep({ name: newRepName.trim(), email: newRepEmail.trim() || undefined });
                      setNewRepName("");
                      setNewRepEmail("");
                    } finally {
                      setAddingRep(false);
                    }
                  }}
                >
                  Add rep
                </Button>
              </div>
            )}
          </div>

          {/* Regions */}
          <div>
            <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-3">
              Regions ({regions?.length ?? 0})
            </div>

            <div className="space-y-1 mb-3 max-h-64 overflow-y-auto">
              {(regions ?? []).length === 0 && (
                <div className="text-sm text-stone-400 py-2">No regions defined yet.</div>
              )}
              {(regions ?? []).map((r: any) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between px-3 py-2 rounded-md bg-stone-50 ring-1 ring-stone-100"
                >
                  <div className="flex items-center gap-2">
                    <MapPin size={13} className="text-stone-400" />
                    <span className="text-sm font-medium text-stone-800">{r.name}</span>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => deleteRegion(r.id)}
                      className="p-1 text-stone-400 hover:text-rose-600 rounded"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {isAdmin && (
              <div className="space-y-1.5">
                <input
                  value={newRegionName}
                  onChange={e => setNewRegionName(e.target.value)}
                  placeholder="Region name *"
                  className="w-full h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
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
                    } finally {
                      setAddingRegion(false);
                    }
                  }}
                >
                  Add region
                </Button>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Rep Login Modal */}
      {repLoginModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-2 mb-1">
              <KeyRound size={16} className="text-stone-700" />
              <h2 className="text-base font-semibold text-stone-900">
                {repLoginModal.hasLogin ? "Reset password" : "Create rep login"}
              </h2>
            </div>
            <p className="text-[12px] text-stone-500 mb-5">
              {repLoginModal.hasLogin
                ? `Set a new password for ${repLoginModal.repName}.`
                : `Create a login for ${repLoginModal.repName}. They'll be able to log in and view their assigned receivables.`}
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">
                  New password
                </label>
                <div className="relative">
                  <input
                    type={showRepPassword ? "text" : "password"}
                    value={repLoginPassword}
                    onChange={e => setRepLoginPassword(e.target.value)}
                    placeholder="Min. 8 characters"
                    className="w-full h-9 px-3 pr-9 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowRepPassword(p => !p)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
                  >
                    {showRepPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">
                  Confirm password
                </label>
                <input
                  type={showRepPassword ? "text" : "password"}
                  value={repLoginConfirm}
                  onChange={e => setRepLoginConfirm(e.target.value)}
                  placeholder="Re-enter password"
                  className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
                />
              </div>

              {repLoginError && (
                <div className="text-xs text-rose-600 bg-rose-50 ring-1 ring-rose-200 rounded px-3 py-2">
                  {repLoginError}
                </div>
              )}
              {repLoginSuccess && (
                <div className="text-xs text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200 rounded px-3 py-2">
                  {repLoginSuccess}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 mt-5">
              {!repLoginSuccess ? (
                <>
                  <Button
                    onClick={handleRepLoginSave}
                    disabled={repLoginSaving || !repLoginPassword || !repLoginConfirm}
                  >
                    {repLoginSaving
                      ? "Saving…"
                      : repLoginModal.hasLogin
                      ? "Reset password"
                      : "Create login"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setRepLoginModal(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button onClick={() => setRepLoginModal(null)}>Done</Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
