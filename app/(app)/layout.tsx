"use client";

import AuthProvider from "@/components/auth-provider";
import { DataProvider, useData } from "@/components/data-provider";
import { Sidebar } from "@/components/sidebar";
import { OrgSwitcher } from "@/components/org-switcher";
import { Toast } from "@/components/ui";

function AppShell({ children }: { children: React.ReactNode }) {
  const { loaded, toastState, clearToast } = useData();

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-stone-400 text-sm">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-white text-stone-900">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-11 shrink-0 border-b border-stone-200 bg-white flex items-center justify-end px-5">
          <OrgSwitcher />
        </header>
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
      <Toast toast={toastState} onClose={clearToast} />
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
