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

interface MeInfo {
  resource: { name: string; designationName: string | null } | null;
  canApprove: boolean;
  canTeamReports: boolean;
  orgName: string;
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
  const tabs = [
    { href: "/my-time", label: "Timesheet", show: true },
    { href: "/my-time/reports", label: "My Reports", show: true },
    { href: "/my-time/details", label: "My Details", show: !!me?.resource },
    { href: "/my-time/approvals", label: "Approvals", show: !!me?.canApprove },
    { href: "/my-time/team", label: "Team Reports", show: !!me?.canTeamReports },
  ].filter((t) => t.show);
  const isActive = (href: string) => (href === "/my-time" ? pathname === "/my-time" : pathname.startsWith(href));

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100 flex flex-col">
      <header className="border-b border-stone-800 bg-stone-950 px-6 py-3 flex items-center gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-white tracking-tight">{me?.orgName || "Timesheet"}</div>
          {me?.resource && (
            <div className="text-[12px] text-stone-400">{me.resource.name}{me.resource.designationName ? ` · ${me.resource.designationName}` : ""}</div>
          )}
        </div>
        <nav className="flex items-center gap-1 ml-4" aria-label="Sections">
          {tabs.map((t) => (
            <Link key={t.href} href={t.href}
              className={`px-3 h-8 flex items-center rounded-md text-[13px] ${isActive(t.href) ? "bg-stone-800 text-stone-100" : "text-stone-400 hover:text-stone-200 hover:bg-stone-900"}`}>
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="flex-1" />
        <button onClick={() => signOut({ callbackUrl: "/login" })}
          className="h-8 px-3 rounded-md ring-1 ring-stone-700 bg-stone-800 text-[12px] text-stone-300 hover:text-stone-100 flex items-center gap-1.5">
          <LogOut size={13} /> Sign out
        </button>
      </header>

      <main className="flex-1">
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
      </ThemeProvider>
    </AuthProvider>
  );
}
