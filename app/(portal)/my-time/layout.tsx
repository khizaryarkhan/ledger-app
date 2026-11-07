"use client";

/**
 * Employee portal shell: a standalone page frame for logins whose only job is
 * their own timesheet and reports. Deliberately NOT the app shell: that one's
 * data provider calls many APIs an employee login cannot reach (requireOrg
 * confines the role to /api/resources/me/**). Same theme tokens, no new design.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Lock, LogOut } from "lucide-react";
import AuthProvider from "@/components/auth-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { portalNavFor } from "@/lib/resources/nav";
import { RESOURCE_NAV_ICONS } from "@/components/resource-nav-icons";

interface MeInfo {
  resource: { name: string; designationName: string | null } | null;
  canApprove: boolean;
  canTeamReports: boolean;
  isOrgAdmin?: boolean;
  orgName: string;
  unreadNotifications?: number;
}

type Load = { state: "loading" } | { state: "blocked"; message: string } | { state: "ready"; me: MeInfo };

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    fetch("/api/resources/me")
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) setLoad({ state: "blocked", message: body?.error || "This page is not available for your login." });
        else setLoad({ state: "ready", me: body as MeInfo });
      })
      .catch(() => setLoad({ state: "blocked", message: "Network problem. Reload to try again." }));
  }, []);

  const me = load.state === "ready" ? load.me : null;
  // The SAME menu as the app's Resources sidebar (lib/resources/nav.ts), mapped
  // to the portal's own pages: same groups, order and labels for everyone,
  // driven by what this person may do — never a separate, hand-kept tab list.
  const sections = portalNavFor(
    { approve: !!me?.canApprove, team: !!me?.canTeamReports, admin: !!me?.isOrgAdmin, modules: [] },
    !!me?.resource,
  );
  const unread = me?.unreadNotifications ?? 0;
  const isActive = (href: string) => (href === "/my-time" ? pathname === "/my-time" : pathname.startsWith(href));
  const linkClass = (href: string) => `relative w-full flex items-center gap-3 px-3 py-2 rounded-md text-[15px] mb-0.5 ${
    isActive(href) ? "bg-blue-500/10 text-primary-ink font-semibold before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-brand-orange" : "text-stone-200 font-medium hover:bg-stone-900 hover:text-stone-50"}`;

  return (
    <div className="h-screen bg-stone-950 text-stone-100 flex flex-col md:flex-row">
      <aside className="md:w-64 md:h-screen md:border-r border-b md:border-b-0 border-stone-800 bg-nav flex-shrink-0 flex flex-col">
        <div className="px-4 py-3 border-b border-stone-800 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-white tracking-tight truncate">{me?.orgName || "Timesheet"}</div>
            {me?.resource && (
              <div className="text-[11px] text-stone-400 truncate">{me.resource.name}{me.resource.designationName ? ` · ${me.resource.designationName}` : ""}</div>
            )}
          </div>
          <button onClick={() => signOut({ callbackUrl: "/login" })} aria-label="Sign out" title="Sign out"
            className="md:hidden h-8 w-8 flex items-center justify-center rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 hover:text-stone-100">
            <LogOut size={13} />
          </button>
        </div>
        <nav aria-label="Sections" className="flex-1 overflow-y-auto py-3 px-2 flex md:block gap-4 overflow-x-auto">
          {sections.map((sec, si) => (
            <div key={sec.label} className={si > 0 ? "md:mb-3 md:pt-3 md:border-t border-stone-800 shrink-0" : "md:mb-3 shrink-0"}>
              {sec.label && <div className="px-3 mb-1.5 text-[11px] font-bold uppercase text-brand-orange tracking-wider">{sec.label}</div>}
              {sec.items.map((i) => {
                const Icon = RESOURCE_NAV_ICONS[i.icon];
                const active = isActive(i.href);
                return (
                  <Link key={i.href} href={i.href} className={linkClass(i.href)}>
                    <Icon size={17} strokeWidth={active ? 2.25 : 1.9} className={active ? "text-primary-ink" : "text-stone-400"} />
                    <span className="flex-1 whitespace-nowrap">{i.label}</span>
                    {i.icon === "notifications" && unread > 0 && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary-ink/15 text-primary-ink">{unread}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="hidden md:block p-3 border-t border-stone-800">
          <button onClick={() => signOut({ callbackUrl: "/login" })}
            className="w-full h-8 px-3 rounded-md ring-1 ring-stone-700 bg-stone-800 text-[12px] text-stone-300 hover:text-stone-100 flex items-center justify-center gap-1.5">
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">
        {load.state === "loading" && <div className="p-6 text-[13px] text-stone-500">Loading...</div>}
        {load.state === "blocked" && (
          <div className="flex items-center justify-center min-h-[60vh] p-6">
            <div className="max-w-md text-center">
              <div className="mx-auto mb-4 w-10 h-10 rounded-full bg-stone-800 flex items-center justify-center"><Lock size={18} className="text-stone-400" /></div>
              <h1 className="text-[15px] font-semibold text-stone-100 mb-1.5">Timesheets are not available</h1>
              <p className="text-[13px] text-stone-400 leading-relaxed">{load.message}</p>
              <p className="text-[13px] text-stone-500 mt-2">Contact your administrator if you need access.</p>
            </div>
          </div>
        )}
        {load.state === "ready" && children}
      </main>
    </div>
  );
}

export default function MyTimeLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ThemeProvider>
        <Shell>{children}</Shell>
        <ImpersonationBanner />
      </ThemeProvider>
    </AuthProvider>
  );
}
