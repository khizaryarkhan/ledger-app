/**
 * GET /api/google-sheets — connection status for the org's Google Sheets link.
 */

import { db } from "@/db";
import { oauthConnections } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrg, ok } from "@/lib/api";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const [token] = await db.select({ email: oauthConnections.email })
    .from(oauthConnections)
    .where(and(eq(oauthConnections.orgId, orgId!), eq(oauthConnections.provider, "google_sheets")))
    .limit(1);
  return ok({ connected: !!token, email: token?.email ?? null });
}
