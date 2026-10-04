import { db } from "@/db";
import { oauthConnections } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrg, ok } from "@/lib/api";

export async function POST() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  await db.delete(oauthConnections).where(and(eq(oauthConnections.orgId, orgId!), eq(oauthConnections.provider, "google_sheets")));
  return ok({ disconnected: true });
}
