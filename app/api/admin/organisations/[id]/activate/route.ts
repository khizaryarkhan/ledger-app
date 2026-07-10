/**
 * POST /api/admin/organisations/[id]/activate
 *
 * Manual rescue: activate an org and (re)send set-password invites. Covers
 * every half-provisioned state:
 *   - org Inactive after an offline payment that bypassed the webhook
 *   - pending (Inactive) users who never got their invite
 *   - Active users whose invite email was lost (unusable password) — re-invited
 *
 * Idempotent; safe to click repeatedly.
 */

import { requirePlatformAdmin, logBillingEvent } from "@/lib/billing";
import { activateOrgOnPayment } from "@/lib/admin/provisioning/provision-customer";
import { db } from "@/db";
import { organisations, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const [org] = await db.select({ id: organisations.id, name: organisations.name })
    .from(organisations).where(eq(organisations.id, params.id)).limit(1);
  if (!org) return NextResponse.json({ error: "Organisation not found" }, { status: 404 });

  const result = await activateOrgOnPayment(params.id, { reinviteUnusable: true });
  const orgUsers = await db.select({ id: users.id }).from(users).where(eq(users.orgId, params.id));

  await logBillingEvent({
    organizationId: params.id,
    actorUserId:    userId,
    action:         "organisation_manually_activated",
    metadata:       { invited: result.invited, activated: result.activated },
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    activated: result.activated,
    invited: result.invited,
    userCount: orgUsers.length,
    warning: orgUsers.length === 0
      ? "This organisation has NO user accounts — add the customer's admin user first (org detail → Add user), then activate again."
      : result.invited === 0
      ? "No invites needed — all users already have working credentials."
      : undefined,
  });
}
