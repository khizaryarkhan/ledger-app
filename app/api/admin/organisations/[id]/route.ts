/**
 * DELETE /api/admin/organisations/:id
 *
 * Hard-delete an organisation and everything that cascades from it:
 * users, invoices, communications, subscriptions, sync logs, etc.
 *
 * Before the DB delete we:
 *   1. Cancel the Stripe subscription immediately (if one exists and is active).
 *      Stripe remains the billing source of truth — never leave orphan subs.
 *   2. Delete the Stripe customer record (removes their saved card).
 *
 * The DB cascade (onDelete: "cascade") handles all child rows once the org
 * row is removed. This is irreversible — the caller must confirm explicitly.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { organisations, subscriptions, crmAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requirePlatformAdmin } from "@/lib/billing";
import { stripe } from "@/lib/stripe";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const orgId = params.id;

  // Verify the org exists.
  const [org] = await db
    .select({ id: organisations.id, name: organisations.name })
    .from(organisations)
    .where(eq(organisations.id, orgId))
    .limit(1);
  if (!org) return NextResponse.json({ error: "Organisation not found" }, { status: 404 });

  // Cancel Stripe subscription + delete Stripe customer (best-effort — don't
  // let Stripe failures block the local delete).
  const [sub] = await db
    .select({
      id: subscriptions.id,
      source: subscriptions.source,
      status: subscriptions.status,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
      stripeCustomerId: subscriptions.stripeCustomerId,
    })
    .from(subscriptions)
    .where(eq(subscriptions.orgId, orgId))
    .limit(1);

  const stripeErrors: string[] = [];

  if (sub?.source === "stripe") {
    if (sub.stripeSubscriptionId && ["active", "trialing", "past_due", "unpaid"].includes(sub.status ?? "")) {
      try {
        await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
      } catch (e: any) {
        stripeErrors.push(`sub cancel: ${e?.message}`);
      }
    }
    if (sub.stripeCustomerId) {
      try {
        await stripe.customers.del(sub.stripeCustomerId);
      } catch (e: any) {
        stripeErrors.push(`customer delete: ${e?.message}`);
      }
    }
  }

  // Detach the crm_accounts link so the FK doesn't block the org delete.
  await db
    .update(crmAccounts)
    .set({ organisationId: null })
    .where(eq(crmAccounts.organisationId, orgId))
    .catch(() => {});

  // Hard-delete. All cascade-deletes happen here.
  await db.delete(organisations).where(eq(organisations.id, orgId));

  return NextResponse.json({
    deleted: true,
    orgId,
    orgName: org.name,
    stripeErrors: stripeErrors.length ? stripeErrors : undefined,
  });
}
