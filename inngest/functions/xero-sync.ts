import { inngest } from "@/lib/inngest";
import { db } from "@/db";
import { xeroTokens } from "@/db/schema";
import { isNotNull } from "drizzle-orm";
import { runXeroSync } from "@/lib/xero-sync";

export const xeroSyncScheduler = inngest.createFunction(
  { id: "xero-sync-scheduler", triggers: [{ cron: "0 2 * * *" }] },
  async ({ step }) => {
    const tokens = await step.run("fetch-xero-tokens", () =>
      db.select({
        orgId:                 xeroTokens.orgId,
        userId:                xeroTokens.userId,
        tenantName:            xeroTokens.tenantName,
        refreshTokenExpiresAt: xeroTokens.refreshTokenExpiresAt,
      })
      .from(xeroTokens)
      .where(isNotNull(xeroTokens.orgId)),
    );

    if (tokens.length === 0) return { queued: 0 };

    await inngest.send(
      tokens.map(t => ({
        name: "xero/sync-org" as const,
        data: {
          orgId:                 t.orgId!,
          userId:                t.userId,
          tenantName:            t.tenantName,
          refreshTokenExpiresAt: typeof t.refreshTokenExpiresAt === "string" ? t.refreshTokenExpiresAt : (t.refreshTokenExpiresAt as Date).toISOString(),
        },
      })),
    );

    return { queued: tokens.length };
  },
);

export const runOrgXeroSync = inngest.createFunction(
  { id: "run-org-xero-sync", retries: 2, triggers: [{ event: "xero/sync-org" }] },
  async ({ event, step }) => {
    const { orgId, userId, tenantName, refreshTokenExpiresAt } = event.data;

    if (new Date(refreshTokenExpiresAt) < new Date()) {
      return { orgId, tenant: tenantName, status: "skipped", error: "Refresh token expired — reconnect Xero in Settings" };
    }

    await step.run("sync", () => runXeroSync(orgId, userId));
    return { orgId, tenant: tenantName, status: "ok" };
  },
);
