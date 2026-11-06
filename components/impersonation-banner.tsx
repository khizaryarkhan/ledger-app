"use client";

/**
 * Shown whenever a super admin is signed in as someone else (lib/impersonation.ts).
 * A fixed pill rather than a bar, because every work screen sizes itself to
 * 100vh minus the 44px top bar — a bar here would push them all off by its height.
 * "Return" sends NextAuth's session update, the one write the read-only rule allows.
 */
import { useSession } from "next-auth/react";
import { useState } from "react";
import { Eye, Loader } from "lucide-react";

export function ImpersonationBanner() {
  const { data, update } = useSession();
  const [busy, setBusy] = useState(false);
  const by = (data?.user as any)?.impersonatedBy as { name: string | null; until: number } | null | undefined;
  if (!by) return null;

  const until = new Date(by.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  async function stop() {
    setBusy(true);
    await update({ stopImpersonation: true });
    window.location.href = "/settings/team";
  }

  return (
    <div role="status" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-3 rounded-lg bg-amber-500 text-stone-950 px-4 py-2 shadow-lg ring-1 ring-amber-300">
      <Eye size={15} />
      <span className="text-[13px] font-medium">
        Viewing as <strong>{data?.user?.name ?? "this user"}</strong> · read-only · ends {until}
      </span>
      <button onClick={stop} disabled={busy}
        className="h-7 inline-flex items-center gap-1.5 rounded-md bg-stone-950 text-amber-300 px-3 text-[12px] font-semibold hover:bg-stone-800 disabled:opacity-60">
        {busy && <Loader size={12} className="animate-spin" />} Return to my account
      </button>
    </div>
  );
}
