"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  LayoutDashboard, XCircle, CreditCard, ScrollText, Users,
  Building2, FileText, LogOut, ShieldCheck, ChevronRight,
} from "lucide-react";
import type { ReactNode } from "react";

const NAV = [
  { href: "/admin",             icon: LayoutDashboard, label: "Overview",       exact: true },
  { href: "/admin/leads",       icon: FileText,        label: "Leads"                        },
  { href: "/admin/customers",     icon: Building2,     label: "Customers"                    },
  { href: "/admin/subscriptions", icon: CreditCard,    label: "Subscriptions"                },
  { href: "/admin/cancellations", icon: XCircle,       label: "Cancellations"                },
  { href: "/admin/audit",       icon: ScrollText,      label: "Audit Log"                    },
  { href: "/admin/team",        icon: Users,           label: "Admin Team"                   },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const path    = usePathname();
  const router  = useRouter();
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;
  const user = session?.user as any;

  if (role !== "super_admin" && role !== "platform_admin") {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4 text-center">
        <ShieldCheck size={28} className="text-stone-600" />
        <p className="text-sm text-stone-400">Access restricted to platform administrators.</p>
      </div>
    );
  }

  return (
    <div className="flex gap-0 min-h-screen">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 flex flex-col border-r border-stone-800 bg-stone-950 pt-6 pb-4">
        {/* Brand */}
        <div className="px-4 mb-6">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/15 flex items-center justify-center">
              <ShieldCheck size={14} className="text-emerald-400" />
            </div>
            <div>
              <p className="text-xs font-semibold text-white leading-none">Admin Portal</p>
              <p className="text-[10px] text-stone-600 mt-0.5">Prime Accountax</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 space-y-0.5">
          <p className="text-[9px] text-stone-700 font-semibold uppercase tracking-widest px-2 pb-1.5 pt-0.5">
            Platform
          </p>
          {NAV.map(({ href, icon: Icon, label, exact }) => {
            const active = exact ? path === href : path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors group ${
                  active
                    ? "bg-stone-800 text-white font-medium"
                    : "text-stone-500 hover:text-stone-200 hover:bg-stone-900"
                }`}
              >
                <Icon
                  size={14}
                  className={active ? "text-emerald-400" : "text-stone-600 group-hover:text-stone-400"}
                />
                <span className="flex-1">{label}</span>
                {active && <ChevronRight size={11} className="text-stone-600" />}
              </Link>
            );
          })}
        </nav>

        {/* Footer — user + sign out */}
        <div className="px-2 pt-3 border-t border-stone-800/60 mt-3">
          <div className="px-3 py-2 mb-1">
            <p className="text-xs font-medium text-stone-300 truncate">{user?.name ?? "Admin"}</p>
            <p className="text-[11px] text-stone-600 truncate">{user?.email ?? ""}</p>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "https://admin.primeaccountax.com/login" })}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-stone-600 hover:text-rose-400 hover:bg-rose-500/8 transition-colors group"
          >
            <LogOut size={13} className="group-hover:text-rose-400" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 p-6 overflow-auto">
        {children}
      </main>
    </div>
  );
}
