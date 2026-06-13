"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { LayoutDashboard, XCircle, FileText, CreditCard, ScrollText, ShieldAlert, Clock } from "lucide-react";
import type { ReactNode } from "react";

const BILLING_NAV = [
  { href: "/admin/billing",       icon: LayoutDashboard, label: "Billing Overview" },
  { href: "/admin/cancellations", icon: XCircle,         label: "Cancellations" },
  { href: "/admin/temp-access",   icon: Clock,           label: "Temp Access" },
  { href: "/admin/leads",         icon: FileText,        label: "Leads" },
  { href: "/admin/subscriptions", icon: CreditCard,      label: "Subscriptions" },
  { href: "/admin/audit",         icon: ScrollText,      label: "Audit Log" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;
  const isBillingSection = BILLING_NAV.some(n => path.startsWith(n.href));

  // Non-super_admin users should not reach this layout at all (middleware + page guards handle it)
  // but we render nothing special for the main /admin page — that's the existing org management page.

  if (!isBillingSection) {
    return <>{children}</>;
  }

  if (role !== "super_admin" && role !== "platform_admin") {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <ShieldAlert size={28} className="text-stone-500" />
        <p className="text-sm text-stone-400">Access restricted to platform administrators.</p>
      </div>
    );
  }

  return (
    <div className="flex gap-6">
      {/* Sidebar */}
      <aside className="w-48 flex-shrink-0 space-y-0.5 pt-1">
        <p className="text-[10px] text-stone-600 font-semibold uppercase tracking-widest px-3 pb-2">
          Billing Admin
        </p>
        {BILLING_NAV.map(({ href, icon: Icon, label }) => {
          const active = path.startsWith(href);
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
              <Icon size={14} className={active ? "text-emerald-400" : "text-stone-500"} />
              {label}
            </Link>
          );
        })}
        <div className="pt-3 px-3">
          <Link href="/admin" className="text-[11px] text-stone-600 hover:text-stone-400 flex items-center gap-1 transition-colors">
            ← Org management
          </Link>
        </div>
      </aside>

      {/* Page content */}
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
