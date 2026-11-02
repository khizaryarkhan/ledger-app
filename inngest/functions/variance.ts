/**
 * Hours-over-plan enquiries — the nightly assessor.
 *
 * Mirrors chase.ts / recurring.ts's two-function shape: a cron scheduler fans
 * out one event per org, a per-org handler runs in isolation so one org's
 * failure cannot stop the rest.
 *
 * It keeps no state. Every enquiry is keyed (org, person, booking, month) by a
 * unique index, so re-running — a retry, a replay, two runs in a day — opens
 * nothing twice.
 *
 * Uses `today()` (UTC), never `localToday()`: this runs with no viewer, so
 * there is no "local" for it to be relative to. Same precedent as chase.ts.
 */

import { inngest } from "@/lib/inngest";
import { db } from "@/db";
import { organisations } from "@/db/schema";
import { today } from "@/lib/format";
import { hasModule } from "@/lib/modules";
import { requireActiveSubscription } from "@/lib/billing";
import { assessMonth, escalateStale } from "@/lib/resources/variance-server";
import { monthOf, previousMonth } from "@/lib/resources/variance";

export const hoursVarianceScheduler = inngest.createFunction(
  { id: "hours-variance-scheduler", triggers: [{ cron: "0 5 * * *" }] },
  async ({ step }) => {
    // Only orgs that bought the module: fanning out to everyone would queue
    // work that can only ever decide it has nothing to do.
    const orgs = await step.run("fetch-orgs", async () => {
      const rows = await db.select({ id: organisations.id, enabledModules: organisations.enabledModules }).from(organisations);
      return rows.filter((o) => hasModule(o.enabledModules as any, "resources")).map((o) => ({ id: o.id }));
    });
    if (orgs.length === 0) return { queued: 0 };
    await inngest.send(orgs.map((org) => ({ name: "resources/assess-variance" as const, data: { orgId: org.id } })));
    return { queued: orgs.length };
  },
);

export const assessOrgVariance = inngest.createFunction(
  { id: "assess-org-variance", retries: 2, triggers: [{ event: "resources/assess-variance" }] },
  async ({ event, step }) => {
    const { orgId } = event.data;
    const todayStr = today();

    const { access } = await step.run("check-subscription", () => requireActiveSubscription(orgId)) as { access: string };
    if (access === "blocked" || access === "readonly") return { orgId, skipped: 1, reason: `subscription-${access}` };

    // Last month, every night. A month that was not settled early in the
    // following month is picked up by the same run once the fallback day
    // passes, so nothing needs to remember it was skipped.
    const month = previousMonth(monthOf(todayStr));

    const stats = await step.run(`assess-${month}`, () => assessMonth(orgId, month, todayStr));
    const escalated = await step.run("escalate-stale", () => escalateStale(orgId, todayStr));

    return { orgId, ...stats, escalated };
  },
);
