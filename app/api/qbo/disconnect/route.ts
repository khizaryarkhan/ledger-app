import { db } from "@/db";
import { qboTokens } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq } from "drizzle-orm";

export async function POST() {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;
  await db.delete(qboTokens).where(eq(qboTokens.orgId, orgId!));
  return ok({ disconnected: true });
}
