"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { LayoutDashboard, Users, XCircle, FileText, CreditCard, ScrollText, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";

const NAV = [
  { href: "/admin",               icon: LayoutDashboard, label: "Overview" },
  { href: "/admin/cancellations", icon: XCircle,         label: "Cancellations" },
  { href: "/admin/leads",         icon: FileText,        label: "Leads" },
  { href: "/admin/subscriptions", icon: CreditCard,      label: "Subscriptions" },
  { href: "/admin/audit",         icon: ScrollText,      label: "Audit Log" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const path    = usePathname();
  const { data: session } = useSession();
  const role    = (session?.user as any)?.role;
  const allowed = role === "platform_admin" || role === "super_admin";

  if (!allowed) {
    return (
      <div className="min-h-screen bg-stone-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center p-8">
          <ShieldAlert size={32} className="text-stone-500" />
          <h2 className="text-lg font-semibold text-white">Access denied</h2>
          <p className="text-sm text-stone-500">This area is restricted to internal platform administrators.</p>
          <Link href="/dashboard" className="text-sm text-emerald-400 hover:text-emerald-300 mt-2">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      {/* Top bar */}
      <header className="border-b border-stone-800 bg-stone-900/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-md bg-emerald-500 flex items-center justify-center">
              <span className="text-white font-bold text-xs leading-none">P</span>
            </div>
            <span className="text-sm font-semibold text-white">Prime Accountax</span>
            <span className="text-stone-600 text-xs">·</span>
            <span className="text-xs font-medium text-stone-400 bg-stone-800 px-2 py-0.5 rounded-md">Admin Panel</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-stone-500">{(session?.user as any)?.email}</span>
            <Link href="/dashboard" className="text-xs text-stone-500 hover:text-stone-300 transition-colors">
              App →
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 flex gap-6 py-6">
        {/* Sidebar */}
        <aside className="w-48 flex-shrink-0 space-y-0.5">
          {NAV.map(({ href, icon: Icon, label }) => {
            const active = href === "/admin" ? path === "/admin" : path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active
                    ? "bg-stone-800 text-white font-medium"
                    : "text-stone-400 hover:text-stone-200 hover:bg-stone-900"
                }`}
              >
                <Icon size={15} className={active ? "text-emerald-400" : "text-stone-500"} />
                {label}
              </Link>
            );
          })}
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
