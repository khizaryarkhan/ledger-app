/** Shared guard and error mapping for /api/edi/** (module "edi"). */
import { bad, requireRole, canPostInventoryTxn, type requireOrg } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { ediErrorOf } from "@/lib/edi/edi-server";
import { NextResponse } from "next/server";

/** Each route calls requireOrg() itself (tests/module-gating.test.ts) and hands the result here.
 * level "read": any org user; "operate": who may post floor documents; "admin": partner setup. */
export async function ediGuard(org: Awaited<ReturnType<typeof requireOrg>>, level: "read" | "operate" | "admin") {
  const { error, orgId, role, session } = org;
  if (error) return { error };
  const { error: modErr } = await requireModule(orgId!, "edi");
  if (modErr) return { error: modErr };
  if (level === "operate" && !canPostInventoryTxn(role)) return { error: bad("You don't have permission for this action", 403) };
  if (level === "admin" && !(role && requireRole(role, "company_admin"))) return { error: bad("Only an admin can change EDI partner profiles", 403) };
  return { orgId: orgId!, actorId: ((session?.user as any)?.id ?? null) as string | null };
}

export function ediFail(e: unknown) {
  const x = ediErrorOf(e);
  if (x) return NextResponse.json({ error: x.message, problems: x.problems ?? undefined }, { status: x.status });
  throw e;
}
