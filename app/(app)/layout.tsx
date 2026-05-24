"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import AuthProvider from "@/components/auth-provider";
import { DataProvider, useData } from "@/components/data-provider";
import { Sidebar } from "@/components/sidebar";
import { OrgSwitcher } from "@/components/org-switcher";
import { Toast } from "@/components/ui";
import { ChatWidget } from "@/components/chat-widget";

function AppShell({ children }: { children: React.ReactNode }) {
  const { loaded, toastState, clearToast } = useData();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-stone-400 text-sm">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-white text-stone-900">
      {/* Mobile backdrop — tap to close sidebar */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <Sidebar isOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar */}
        <header className="h-11 shrink-0 border-b border-stone-200 bg-white flex items-center justify-between px-4 md:justify-end md:px-5">
          {/* Hamburger — mobile only */}
          <button
            className="md:hidden p-1.5 rounded-md hover:bg-stone-100 text-stone-500 hover:text-stone-800 transition-colors"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>
          <OrgSwitcher />
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>

      <Toast toast={toastState} onClose={clearToast} />
      <ChatWidget />
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DataProvider>
        <AppShell>{children}</AppShell>
      </DataProvider>
    </AuthProvider>
  );
}
