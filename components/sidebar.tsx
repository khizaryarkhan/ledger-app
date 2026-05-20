"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  LayoutDashboard, Users, Briefcase, FileText, Kanban, Filter, Inbox,
  CheckSquare, BarChart3, Upload, Zap, Settings, LogOut, Shield, TrendingUp, X
} from "lucide-react";
import { useData } from "./data-provider";

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ isOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { invoices, communications, tasks, orgSettings } = useData();

  const role = (session?.user as any)?.role;
  const isAdmin = role === "super_admin" || role === "company_admin";

  const counts = {
    inbox: communications.filter(c => c.direction === "Inbound").length,
    invoices: invoices.filter(i => i.paymentStatus !== "Paid").length,
    tasks: tasks.filter(t => !t.completed).length,
  };

  const sections = [
    {
      items: [
        { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      ],
    },
    {
      label: "SALES",
      items: [
        { href: "/invoices", label: "Invoices", icon: FileText, count: counts.invoices },
        { href: "/customers", label: "Customers", icon: Users },
        { href: "/projects", label: "Projects", icon: Briefcase },
      ],
    },
    {
      label: "RECEIVABLES",
      items: [
        { href: "/board", label: "Collections Board", icon: Kanban },
        { href: "/automations", label: "Automations", icon: Zap },
        { href: "/inbox", label: "Communication Notes", icon: Inbox, count: counts.inbox },
        { href: "/tasks", label: "Tasks", icon: CheckSquare, count: counts.tasks },
      ],
    },
    {
      label: "INSIGHTS",
      items: [
        { href: "/smart-views", label: "Smart Views", icon: Filter },
        { href: "/performance", label: "Performance", icon: TrendingUp },
        { href: "/reports", label: "Reports", icon: BarChart3 },
      ],
    },
    {
      label: "CONFIGURE",
      items: [
        { href: "/imports", label: "Imports", icon: Upload },
        { href: "/settings", label: "Settings", icon: Settings },
        ...(isAdmin ? [{ href: "/admin", label: "Admin Portal", icon: Shield }] : []),
      ],
    },
  ];

  const userName = session?.user?.name || "User";
  const initials = userName.split(" ").slice(0, 2).map((w: string) => w[0]).join("").toUpperCase();

  return (
    <aside
      className={[
        // Base styles
        "w-60 bg-stone-50/50 border-r border-stone-200 flex flex-col h-screen",
        // Mobile: fixed overlay, slides in/out
        "fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-in-out",
        isOpen ? "translate-x-0 shadow-xl" : "-translate-x-full",
        // Desktop: back in normal flow, always visible
        "md:sticky md:top-0 md:translate-x-0 md:shadow-none",
      ].join(" ")}
    >
      {/* Logo + mobile close button */}
      <div className="px-4 py-4 border-b border-stone-200 flex items-center justify-between">
        <div className="flex items-center gap-2.5 h-8 min-w-0">
          {orgSettings?.logoUrl ? (
            <img
              src={orgSettings.logoUrl}
              alt={orgSettings?.displayName || orgSettings?.name || "Logo"}
              className="h-8 w-auto object-contain"
            />
          ) : (
            <span className="text-sm font-semibold text-stone-800 tracking-tight truncate">
              {orgSettings?.displayName || orgSettings?.name || ""}
            </span>
          )}
        </div>
        {/* Close button — only shown on mobile */}
        <button
          onClick={onClose}
          className="md:hidden p-1 rounded hover:bg-stone-100 text-stone-400 hover:text-stone-700 shrink-0"
          aria-label="Close menu"
        >
          <X size={16} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {sections.map((sec, si) => (
          <div key={si} className="mb-4">
            {sec.label && (
              <div className="px-2.5 mb-1.5 text-[10px] font-semibold text-stone-400 tracking-widest">
                {sec.label}
              </div>
            )}
            {sec.items.map(item => {
              const Icon = item.icon;
              const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}  // auto-close on mobile when navigating
                  className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-colors mb-0.5 ${
                    isActive
                      ? "bg-brand-navy text-white"
                      : "text-stone-600 hover:bg-stone-100/70 hover:text-stone-900"
                  }`}
                >
                  <Icon
                    size={15}
                    strokeWidth={isActive ? 2.25 : 2}
                    className={isActive ? "text-white" : "text-stone-500"}
                  />
                  <span className="flex-1">{item.label}</span>
                  {item.count != null && item.count > 0 && (
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        isActive ? "bg-white/20 text-white" : "bg-stone-200/60 text-stone-600"
                      }`}
                    >
                      {item.count}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-stone-200">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-stone-700 to-stone-900 flex items-center justify-center text-white text-[11px] font-semibold shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium text-stone-900 truncate">{userName}</div>
            <div className="text-[10px] text-stone-500 truncate">{(session?.user as any)?.role || "User"}</div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="p-1 rounded hover:bg-stone-100 text-stone-400 hover:text-stone-700"
            title="Sign out"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}
