import { db } from "@/db";
import { microsoftTokens } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { eq } from "drizzle-orm";

export async function POST() {
  // Disconnect the org's Microsoft integration. Any admin in the org can do this.
  const { error, session, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) {
    return bad("Only company admins can disconnect Microsoft", 403);
  }
  await db.delete(microsoftTokens).where(eq(microsoftTokens.orgId, orgId!));
  await logEvent({ orgId: orgId!, eventType: "integration_disconnected", actorId: (session!.user as any).id, actorName: (session!.user as any).name ?? null, meta: { provider: "Microsoft" } });
  return ok({ disconnected: true });
}
