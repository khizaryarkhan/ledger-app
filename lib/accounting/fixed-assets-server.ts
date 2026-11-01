/**
 * Fixed assets — the db half (rules live in fixed-assets.ts).
 *
 * neon-http has no transactions, so a depreciation run validates everything
 * first, then posts month by month. Each journal entry carries the reference
 * `FA:<assetId>:<period>`; if a run dies between the journal post and the
 * fixed_asset_depreciation insert, the next run finds that entry and records
 * it instead of posting the month a second time.
 */

import { db } from "@/db";
import { accounts, fixedAssets, fixedAssetDepreciation, journalEntries, organisations } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { accountTypeError } from "@/lib/accounting/account-roles";
import { postJournalEntry } from "@/lib/ledger";
import { periodEndDate, scheduleFor, unpostedPeriods, type AssetTerms } from "@/lib/accounting/fixed-assets";

export type AssetRow = typeof fixedAssets.$inferSelect;

export const toTerms = (a: AssetRow): AssetTerms => ({
  purchaseDate: a.purchaseDate,
  cost: Number(a.cost),
  salvageValue: Number(a.salvageValue),
  usefulLifeMonths: a.usefulLifeMonths,
  disposedDate: a.disposedDate,
});

export const depReference = (assetId: string, period: string) => `FA:${assetId}:${period}`;

/** null when the three accounts belong to the org and suit their roles. */
export async function accountsError(
  orgId: string,
  ids: { asset: string; accum: string; expense: string },
): Promise<string | null> {
  const rows = await db.select().from(accounts)
    .where(and(eq(accounts.orgId, orgId), inArray(accounts.id, [ids.asset, ids.accum, ids.expense])));
  const by = new Map(rows.map(r => [r.id, r]));
  return (
    accountTypeError("The asset account", ["Fixed Asset"], by.get(ids.asset)) ||
    accountTypeError("The accumulated depreciation account", ["Fixed Asset"], by.get(ids.accum)) ||
    accountTypeError("The depreciation expense account", ["Expense"], by.get(ids.expense)) ||
    (ids.asset === ids.accum ? "The asset and accumulated depreciation accounts must be different." : null)
  );
}

export async function postedPeriodsByAsset(orgId: string, assetIds?: string[]): Promise<Map<string, Map<string, number>>> {
  const rows = await db.select().from(fixedAssetDepreciation).where(eq(fixedAssetDepreciation.orgId, orgId));
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (assetIds && !assetIds.includes(r.assetId)) continue;
    const m = out.get(r.assetId) ?? new Map<string, number>();
    m.set(r.period, Number(r.amount));
    out.set(r.assetId, m);
  }
  return out;
}

export type PlannedCharge = {
  assetId: string; assetName: string; period: string; date: string; amount: number;
  blocked: string | null;
};

/** Everything a run through `through` would post. Writes nothing. */
export async function planDepreciation(orgId: string, through: string): Promise<PlannedCharge[]> {
  const [assets, posted, [org]] = await Promise.all([
    db.select().from(fixedAssets).where(eq(fixedAssets.orgId, orgId)),
    postedPeriodsByAsset(orgId),
    db.select({ lock: organisations.bookCloseDate }).from(organisations).where(eq(organisations.id, orgId)).limit(1),
  ]);
  const plan: PlannedCharge[] = [];
  for (const a of assets) {
    const done = new Set((posted.get(a.id) ?? new Map()).keys());
    for (const r of unpostedPeriods(toTerms(a), done, through)) {
      const date = periodEndDate(r.period);
      plan.push({
        assetId: a.id, assetName: a.name, period: r.period, date, amount: r.amount,
        blocked: org?.lock && date <= org.lock ? `Books are closed through ${org.lock}.` : null,
      });
    }
  }
  return plan.sort((x, y) => x.period.localeCompare(y.period) || x.assetName.localeCompare(y.assetName));
}

/** Post the plan. Caller must have refused a plan with blocked items. */
export async function postDepreciation(orgId: string, plan: PlannedCharge[], actorId: string | null) {
  const assets = await db.select().from(fixedAssets).where(eq(fixedAssets.orgId, orgId));
  const byId = new Map(assets.map(a => [a.id, a]));
  const existing = plan.length
    ? await db.select({ reference: journalEntries.reference, id: journalEntries.id }).from(journalEntries)
        .where(and(eq(journalEntries.orgId, orgId), eq(journalEntries.sourceType, "Depreciation"),
          inArray(journalEntries.reference, plan.map(p => depReference(p.assetId, p.period)))))
    : [];
  const healed = new Map(existing.map(e => [e.reference, e.id]));
  let posted = 0, recovered = 0;
  for (const p of plan) {
    const a = byId.get(p.assetId)!;
    const ref = depReference(p.assetId, p.period);
    let entryId = healed.get(ref);
    if (entryId) recovered++;
    else {
      const e = await postJournalEntry({
        orgId, entryDate: p.date, sourceType: "Depreciation", sourceId: a.id, reference: ref,
        memo: `Depreciation ${p.period} - ${a.name}`, createdBy: actorId,
        lines: [
          { accountId: a.depreciationExpenseAccountId, debit: p.amount, credit: 0, description: a.name },
          { accountId: a.accumDepAccountId, debit: 0, credit: p.amount, description: a.name },
        ],
      });
      entryId = e.id;
      posted++;
    }
    await db.insert(fixedAssetDepreciation).values({
      orgId, assetId: a.id, period: p.period, amount: p.amount.toFixed(2), journalEntryId: entryId,
    }).onConflictDoNothing();
  }
  return { posted, recovered };
}

export { scheduleFor };

/** numeric(14,2) column value. */
export const toCents = (n: number): string => n.toFixed(2);
