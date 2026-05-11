"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronDown, Check, Loader2, Search, Shield } from "lucide-react";

type OrgOption = {
  id: string;
  name: string;
  displayName: string | null;
  logoUrl: string | null;
  role: string;
  isActive: boolean;
};

export function OrgSwitcher() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/user/orgs")
      .then(r => r.json())
      .then(setOrgs)
      .catch(() => {});
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const active = orgs.find(o => o.isActive) ?? orgs[0];
  const isSuperAdmin = orgs.some(o => o.role === "super_admin");

  const filtered = useMemo(() => {
    if (!query.trim()) return orgs;
    const q = query.toLowerCase();
    return orgs.filter(o => (o.displayName || o.name).toLowerCase().includes(q));
  }, [orgs, query]);

  if (!active) return null;

  // Only one org AND not super admin — show static label, no dropdown.
  // Super admin always gets the switcher even if there's only one org so they
  // can see they're acting as super admin and access the list.
  if (orgs.length === 1 && !isSuperAdmin) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-stone-50 ring-1 ring-stone-200">
        <Building2 size={13} className="text-stone-400 shrink-0" />
        <span className="text-[12px] font-medium text-stone-700">
          {active.displayName || active.name}
        </span>
      </div>
    );
  }

  const handleSwitch = async (orgId: string) => {
    if (orgId === active.id || switching) return;
    setSwitching(true);
    setOpen(false);
    try {
      const res = await fetch("/api/auth/switch-org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      if (res.ok) {
        // Hard refresh to reload all data for the new org
        window.location.href = "/dashboard";
      }
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(p => !p)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-stone-50 ring-1 ring-stone-200 hover:bg-stone-100 transition-colors"
      >
        {isSuperAdmin
          ? <Shield size={13} className="text-brand-orange shrink-0" />
          : <Building2 size={13} className="text-stone-400 shrink-0" />}
        <span className="text-[12px] font-medium text-stone-700 max-w-[160px] truncate">
          {active.displayName || active.name}
        </span>
        {switching
          ? <Loader2 size={12} className="text-stone-400 animate-spin" />
          : <ChevronDown size={12} className={`text-stone-400 transition-transform ${open ? "rotate-180" : ""}`} />
        }
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-72 bg-white rounded-xl shadow-lg ring-1 ring-stone-200 z-50 overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-stone-100 flex items-center justify-between">
            <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">
              {isSuperAdmin ? `All Organisations (${orgs.length})` : "Switch Organisation"}
            </p>
            {isSuperAdmin && (
              <span className="text-[9px] font-semibold text-brand-orange uppercase tracking-wider flex items-center gap-1">
                <Shield size={9} /> Super Admin
              </span>
            )}
          </div>

          {/* Search — visible when there are many orgs (super admin case) */}
          {orgs.length > 8 && (
            <div className="px-2 py-2 border-b border-stone-100">
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search organisations…"
                  autoFocus
                  className="w-full text-[12px] pl-7 pr-2 py-1.5 rounded-md ring-1 ring-stone-200 focus:ring-stone-400 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div className="py-1 max-h-80 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-center text-[11px] text-stone-400">
                No organisations match "{query}"
              </div>
            )}
            {filtered.map(org => (
              <button
                key={org.id}
                onClick={() => handleSwitch(org.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-stone-50 transition-colors ${
                  org.isActive ? "bg-stone-50" : ""
                }`}
              >
                <div className="w-7 h-7 rounded-md bg-brand-navy flex items-center justify-center shrink-0">
                  <span className="text-white text-[10px] font-bold">
                    {(org.displayName || org.name).slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-stone-800 truncate">
                    {org.displayName || org.name}
                  </div>
                  <div className="text-[10px] text-stone-400 capitalize">{org.role.replace("_", " ")}</div>
                </div>
                {org.isActive && <Check size={14} className="text-brand-orange shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
