import { db } from "@/db";
import { qboTokens, xeroTokens, sageIntacctCredentials, qboSyncLog, xeroSyncLog, sageSyncLog } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq } from "drizzle-orm";
import { runQboSync } from "@/lib/qbo-sync";
import { runQboApSync } from "@/lib/qbo-ap-sync";
import { runXeroSync } from "@/lib/xero-sync";
import { runXeroApSync } from "@/lib/xero-ap-sync";
import { runSageSync } from "@/lib/sage-sync";
import { runSageApSync } from "@/lib/sage-ap-sync";

// Allow up to 5 minutes — a full AR + AP sync across a large org can be slow.
export const maxDuration = 300;

/**
 * POST /api/sync
 * Unified sync — runs AR and AP for every provider connected to this org.
 * Replaces the separate /api/qbo/sync, /api/xero/sync, and
 * /api/payables/sync-master-data manual-trigger endpoints.
 */
export async function POST(req: Request) {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id;

  // Body options:
  //   full:     true → ignore the incremental boundary and re-pull everything.
  //   provider: "qbo" | "xero" | "sage" → run only that provider (the Full Sync
  //             button chunks the work per provider so no single request times out).
  //   scope:    "ar" | "ap" → run only Receivables or only Payables (further
  //             chunking — a full AR re-pull and a full AP re-pull each get their
  //             own request/time budget).
  let fullSync = false;
  let provider: string | undefined;
  let scope: string | undefined;
  try {
    const body = await req.json();
    fullSync = body?.full === true;
    provider = body?.provider;
    scope = body?.scope;
  } catch {
    // no body → incremental, all providers, both scopes (default)
  }
  const opts = { fullSync };
  const runAr = scope !== "ap";
  const runAp = scope !== "ar";
  const wants = (p: string) => !provider || provider === p;

  const [qboToken] = await db
    .select({ id: qboTokens.id })
    .from(qboTokens)
    .where(eq(qboTokens.orgId, orgId!))
    .limit(1);

  const [xeroToken] = await db
    .select({ id: xeroTokens.id })
    .from(xeroTokens)
    .where(eq(xeroTokens.orgId, orgId!))
    .limit(1);

  const [sageToken] = await db
    .select({ orgId: sageIntacctCredentials.orgId })
    .from(sageIntacctCredentials)
    .where(eq(sageIntacctCredentials.orgId, orgId!))
    .limit(1);

  if (!qboToken && !xeroToken && !sageToken) {
    return bad("No accounting integration connected. Connect QuickBooks, Xero, or Sage Intacct in Settings → Integrations.", 400);
  }

  const result: {
    qbo?: { ar: any; ap: any; error?: string };
    xero?: { ar: any; ap: any; error?: string };
    sage?: { ar: any; ap: any; error?: string };
  } = {};

  // ── QBO ────────────────────────────────────────────────────────────────────
  if (qboToken && wants("qbo")) {
    try {
      const [ar, ap] = await Promise.all([
        runAr ? runQboSync(orgId!, userId, opts) : Promise.resolve(null),
        runAp ? runQboApSync(orgId!, userId, opts) : Promise.resolve(null),
      ]);
      result.qbo = { ar, ap };
    } catch (e: any) {
      console.error("QBO sync error:", e);
      await db
        .insert(qboSyncLog)
        .values({ userId, orgId, status: "error", errorMessage: e.message })
        .catch(() => {});
      result.qbo = { ar: null, ap: null, error: e.message };
    }
  }

  // ── Xero ───────────────────────────────────────────────────────────────────
  if (xeroToken && wants("xero")) {
    try {
      const [ar, ap] = await Promise.all([
        runAr ? runXeroSync(orgId!, userId, opts) : Promise.resolve(null),
        runAp ? runXeroApSync(orgId!, userId, opts) : Promise.resolve(null),
      ]);
      result.xero = { ar, ap };
    } catch (e: any) {
      console.error("Xero sync error:", e);
      await db
        .insert(xeroSyncLog)
        .values({ userId, orgId, status: "error", errorMessage: e.message })
        .catch(() => {});
      result.xero = { ar: null, ap: null, error: e.message };
    }
  }

  // ── Sage Intacct ──────────────────────────────────────────────────────────
  if (sageToken && wants("sage")) {
    try {
      const [ar, ap] = await Promise.all([
        runAr ? runSageSync(orgId!, userId, opts) : Promise.resolve(null),
        runAp ? runSageApSync(orgId!, userId, opts) : Promise.resolve(null),
      ]);
      result.sage = { ar, ap };
    } catch (e: any) {
      console.error("Sage sync error:", e);
      await db
        .insert(sageSyncLog)
        .values({ userId, orgId, status: "error", errorMessage: e.message })
        .catch(() => {});
      result.sage = { ar: null, ap: null, error: e.message };
    }
  }

  const hasError = result.qbo?.error || result.xero?.error || result.sage?.error;
  return ok({ success: !hasError, synced: result });
}

/**
 * GET /api/sync
 * Returns connection status for all providers so the UI knows what's connected.
 */
export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [qboToken] = await db
    .select({ companyName: qboTokens.companyName, realmId: qboTokens.realmId })
    .from(qboTokens)
    .where(eq(qboTokens.orgId, orgId!))
    .limit(1);

  const [xeroToken] = await db
    .select({ tenantName: xeroTokens.tenantName, tenantId: xeroTokens.tenantId })
    .from(xeroTokens)
    .where(eq(xeroTokens.orgId, orgId!))
    .limit(1);

  const [sageCred] = await db
    .select({ companyId: sageIntacctCredentials.companyId, companyName: sageIntacctCredentials.companyName })
    .from(sageIntacctCredentials)
    .where(eq(sageIntacctCredentials.orgId, orgId!))
    .limit(1);

  return ok({
    qbo: qboToken
      ? { connected: true, companyName: qboToken.companyName, realmId: qboToken.realmId }
      : { connected: false },
    xero: xeroToken
      ? { connected: true, tenantName: xeroToken.tenantName, tenantId: xeroToken.tenantId }
      : { connected: false },
    sage: sageCred
      ? { connected: true, companyId: sageCred.companyId, companyName: sageCred.companyName || sageCred.companyId }
      : { connected: false },
  });
}
