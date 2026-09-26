"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";
import { useData } from "@/components/data-provider";
import { MODULES, MODULE_HOME, hasModule, moduleForPage, type ModuleKey } from "@/lib/modules";

// A page that belongs to a module the org doesn't have (lib/modules.ts
// PAGE_OWNERS) renders this instead of itself. The sidebar already hides the
// module, so this is what a bookmark, an old link or a typed URL lands on.
// The server refuses the module's API routes regardless (requireOrg), so this
// is the explanation, not the control.
//
// Waits for the org's settings: until they arrive, the provider's defaults
// would claim the four core modules, and blocking on a guess is worse than a
// moment's delay in blocking.
export function ModuleGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { loaded, orgSettings } = useData();
  const owner = moduleForPage(pathname);

  if (!owner || !loaded || hasModule(orgSettings.enabledModules, owner)) return <>{children}</>;

  const elsewhere = (Object.keys(MODULE_HOME) as ModuleKey[]).find((k) => hasModule(orgSettings.enabledModules, k));

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 w-10 h-10 rounded-full bg-stone-800 flex items-center justify-center">
          <Lock size={18} className="text-stone-400" />
        </div>
        <h1 className="text-[15px] font-semibold text-stone-100 mb-1.5">{MODULES[owner].label} isn't enabled for this organisation</h1>
        <p className="text-[13px] text-stone-400 leading-relaxed">
          Modules are assigned to an organisation by Prime Accountax. Contact your administrator if you need access.
        </p>
        {elsewhere && (
          <Link href={MODULE_HOME[elsewhere]}
            className="inline-block mt-5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-semibold transition-colors">
            Go to {MODULES[elsewhere].label}
          </Link>
        )}
      </div>
    </div>
  );
}
