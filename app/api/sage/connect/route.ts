/**
 * POST /api/sage/connect
 *
 * Validates Sage Intacct credentials and stores them (encrypted) for this org.
 * Sage uses credential-based auth (no OAuth), so we test the creds immediately
 * and persist only on success.
 *
 * Body: { companyId, sageUserId, password, entityId? }
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { sageIntacctCredentials } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireOrg, ok, bad } from "@/lib/api";
import { encryptSecret } from "@/lib/crypto";
import { logEvent } from "@/lib/audit";
import { testSageCredentials } from "@/lib/sage-sync";

export const maxDuration = 60;

export async function POST(req: Request) {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body", 400);
  }

  const { companyId, sageUserId, password, entityId } = body ?? {};
  if (!companyId?.trim() || !sageUserId?.trim() || !password?.trim()) {
    return bad("companyId, sageUserId, and password are required", 400);
  }

  // Validate credentials against the live Sage API
  let companyName: string;
  try {
    const result = await testSageCredentials({
      companyId: companyId.trim(),
      sageUserId: sageUserId.trim(),
      password: password.trim(),
      entityId: entityId?.trim() || null,
    });
    companyName = result.companyName;
  } catch (e: any) {
    return bad(`Sage Intacct authentication failed: ${e.message}`, 422);
  }

  // Upsert credentials (one row per org)
  const [existing] = await db
    .select({ id: sageIntacctCredentials.id })
    .from(sageIntacctCredentials)
    .where(eq(sageIntacctCredentials.orgId, orgId!))
    .limit(1);

  const encryptedPassword = encryptSecret(password.trim())!;

  if (existing) {
    await db
      .update(sageIntacctCredentials)
      .set({
        userId,
        companyId: companyId.trim(),
        sageUserId: sageUserId.trim(),
        password: encryptedPassword,
        entityId: entityId?.trim() || null,
        companyName,
        updatedAt: new Date(),
      })
      .where(eq(sageIntacctCredentials.orgId, orgId!));
  } else {
    await db.insert(sageIntacctCredentials).values({
      orgId: orgId!,
      userId,
      companyId: companyId.trim(),
      sageUserId: sageUserId.trim(),
      password: encryptedPassword,
      entityId: entityId?.trim() || null,
      companyName,
    });
  }

  await logEvent({
    orgId: orgId!,
    eventType: "integration_connected",
    actorId: userId,
    meta: { provider: "Sage Intacct", companyId: companyId.trim(), companyName },
  });

  return ok({ connected: true, companyId: companyId.trim(), companyName });
}
