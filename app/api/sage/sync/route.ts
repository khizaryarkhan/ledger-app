/**
 * GET /api/sage/sync
 *
 * Returns Sage Intacct connection status for this org.
 * Mirrors the shape of /api/qbo/sync and /api/xero/sync so the UI
 * can treat all three providers uniformly.
 */

import { db } from "@/db";
import { sageIntacctCredentials } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireOrg, ok } from "@/lib/api";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [cred] = await db
    .select({
      companyId:   sageIntacctCredentials.companyId,
      companyName: sageIntacctCredentials.companyName,
      entityId:    sageIntacctCredentials.entityId,
    })
    .from(sageIntacctCredentials)
    .where(eq(sageIntacctCredentials.orgId, orgId!))
    .limit(1);

  if (!cred) return ok({ connected: false });

  return ok({
    connected:   true,
    companyId:   cred.companyId,
    companyName: cred.companyName || cred.companyId,
    entityId:    cred.entityId || null,
  });
}
