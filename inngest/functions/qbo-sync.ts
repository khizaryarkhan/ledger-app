import { inngest } from "@/lib/inngest";
import { db } from "@/db";
import { qboTokens } from "@/db/schema";
import { isNotNull } from "drizzle-orm";
import { runQboSync } from "@/lib/qbo-sync";

export const qboSyncScheduler = inngest.createFunction(
  { id: "qbo-sync-scheduler" },
  { cron: "0 3 * * *" },
  async ({ step }) => {
    const tokens = await step.run("fetch-qbo-tokens", () =>
      db.select({
        orgId:                  qboTokens.orgId,
        userId:                 qboTokens.userId,
        companyName:            qboTokens.companyName,
        refreshTokenExpiresAt:  qboTokens.refreshTokenExpiresAt,
      })
      .from(qboTokens)
      .where(isNotNull(qboTokens.orgId)),
    );

    if (tokens.length === 0) return { queued: 0 };

    await inngest.send(
      tokens.map(t => ({
        name: "qbo/sync-org" as const,
        data: {
          orgId:                 t.orgId!,
          userId:                t.userId,
          companyName:           t.companyName,
          refreshTokenExpiresAt: t.refreshTokenExpiresAt.toISOString(),
        },
      })),
    );

    return { queued: tokens.length };
  },
);

export const runOrgQboSync = inngest.createFunction(
  { id: "run-org-qbo-sync", retries: 2 },
  { event: "qbo/sync-org" },
  async ({ event, step }) => {
    const { orgId, userId, companyName, refreshTokenExpiresAt } = event.data;

    if (new Date(refreshTokenExpiresAt) < new Date()) {
      return { orgId, company: companyName, status: "skipped", error: "Refresh token expired — reconnect QuickBooks in Settings" };
    }

    await step.run("sync", () => runQboSync(orgId, userId));
    return { orgId, company: companyName, status: "ok" };
  },
);
