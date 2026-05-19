import { db } from "@/db";
import { microsoftTokens } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq } from "drizzle-orm";

export async function POST() {
  // Disconnect the org's Microsoft integration. Any admin in the org can do this.
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) {
    return bad("Only company admins can disconnect Microsoft", 403);
  }
  await db.delete(microsoftTokens).where(eq(microsoftTokens.orgId, orgId!));
  return ok({ disconnected: true });
}
