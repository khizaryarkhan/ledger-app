/**
 * POST /api/sage/disconnect
 *
 * Removes stored Sage Intacct credentials for this org.
 * Synced data (customers, invoices, bills) is retained.
 */

import { db } from "@/db";
import { sageIntacctCredentials } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireOrg, ok } from "@/lib/api";
import { logEvent } from "@/lib/audit";

export async function POST() {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id;

  await db
    .delete(sageIntacctCredentials)
    .where(eq(sageIntacctCredentials.orgId, orgId!));

  await logEvent({
    orgId: orgId!,
    eventType: "integration_disconnected",
    actorId: userId,
    meta: { provider: "Sage Intacct" },
  });

  return ok({ disconnected: true });
}
