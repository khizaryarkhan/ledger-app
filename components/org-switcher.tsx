"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronDown, Check, Loader2 } from "lucide-react";

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
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const active = orgs.find(o => o.isActive) ?? orgs[0];
  if (!active) return null;

  // Only one org — show static label, no dropdown
  if (orgs.length === 1) {
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
        <Building2 size={13} className="text-stone-400 shrink-0" />
        <span className="text-[12px] font-medium text-stone-700 max-w-[160px] truncate">
          {active.displayName || active.name}
        </span>
        {switching
          ? <Loader2 size={12} className="text-stone-400 animate-spin" />
          : <ChevronDown size={12} className={`text-stone-400 transition-transform ${open ? "rotate-180" : ""}`} />
        }
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-64 bg-white rounded-xl shadow-lg ring-1 ring-stone-200 z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-stone-100">
            <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">Switch Organisation</p>
          </div>
          <div className="py-1">
            {orgs.map(org => (
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
