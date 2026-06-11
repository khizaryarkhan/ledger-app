import { db } from "@/db";
import { gmailTokens } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { eq } from "drizzle-orm";

export async function POST() {
  // Disconnect the org's Gmail integration. Allowed for admins so any admin
  // in the org can manage the shared connection (matches Settings UI gating).
  const { error, session, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) {
    return bad("Only company admins can disconnect Gmail", 403);
  }
  await db.delete(gmailTokens).where(eq(gmailTokens.orgId, orgId!));
  await logEvent({ orgId: orgId!, eventType: "integration_disconnected", actorId: (session!.user as any).id, actorName: (session!.user as any).name ?? null, meta: { provider: "Gmail" } });
  return ok({ disconnected: true });
}
