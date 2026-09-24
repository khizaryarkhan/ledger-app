/**
 * R-10 — move existing tenants onto account roles and posting groups.
 *
 * DRY RUN BY DEFAULT: prints what it would do and writes nothing. `--commit`
 * applies it. Idempotent — safe to re-run; each step only adds what is missing
 * and the reclass is skipped once it has been posted.
 *
 *   npx tsx scripts/migrate-inventory-accounting.ts --env .env.production.vercel
 *   npx tsx scripts/migrate-inventory-accounting.ts --env .env.production.vercel --org <orgId> --commit
 *   ... --date 2026-09-24      # reclass date (default: today)
 *
 * Per org:
 *   1. Native chart → create the default accounts that are missing (adopting
 *      the existing GR/IR, COGS and Inventory Adjustments) and the four default
 *      groups. Synced chart (QuickBooks / Xero) → the groups only; roles are
 *      mapped by the tenant on the Posting Groups screen. Nothing is pushed out.
 *   2. Assign every stocked item to the default group of its type.
 *   3. Item-level account fields: kept as an override when the account is a
 *      valid type for the role, dropped (and listed) when it is not.
 *   4. Reclass the old single "Inventory Asset" (and "Materials with Job
 *      Worker") into the role accounts at STOCK VALUATION per group type as at
 *      the date; open job-work value goes to Work in Progress. Anything left in
 *      the old account afterwards is a historic GL-vs-stock difference and is
 *      REPORTED, not plugged — see GAP_REPORT.md §C / D-3.
 *   5. Historic journals are never rewritten.
 *
 * Migration 0095 must be applied first (the tables it writes to come from it).
 */
import { config as loadEnv } from "dotenv";

const argv = process.argv.slice(2);
const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
loadEnv({ path: arg("--env") ?? ".env.local", quiet: true });
if (!process.env.DATABASE_URL && process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;

const COMMIT = argv.includes("--commit");
const ONLY = arg("--org") ?? null;
const DATE = arg("--date") ?? new Date().toISOString().slice(0, 10);
const MEMO = "Inventory accounting migration — split of the single inventory account by posting group";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE)) throw new Error("--date must be YYYY-MM-DD");
  const { db } = await import("../db");
  const S = await import("../db/schema");
  const { and, eq, sql } = await import("drizzle-orm");
  const R = await import("../lib/accounting/account-roles");
  const RS = await import("../lib/accounting/account-roles-server");
  const { postJournalEntry } = await import("../lib/ledger");
  const { dbIdentity, formatIdentity } = await import("./db-identity");

  console.log(formatIdentity(await dbIdentity(process.env.DATABASE_URL!)));
  console.log(`mode: ${COMMIT ? "COMMIT" : "DRY RUN (nothing is written)"} · reclass date ${DATE}\n`);

  const orgs = await db.select({ id: S.organisations.id, name: S.organisations.name }).from(S.organisations)
    .where(ONLY ? eq(S.organisations.id, ONLY) : sql`true`);
  const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  for (const org of orgs) {
    const synced = await RS.isSyncedOrg(org.id);
    const items = (await db.select().from(S.apItems).where(eq(S.apItems.orgId, org.id))).filter(i => R.groupTypeForKind(i.productType));
    const lots = await db.select({ n: sql<number>`count(*)::int` }).from(S.inventoryLots).where(eq(S.inventoryLots.orgId, org.id));
    console.log(`── ${org.name.trim()} (${org.id}) · ${synced ? "synced chart" : "native chart"} · ${items.length} stocked item(s) · ${lots[0]?.n ?? 0} lot(s)`);
    // Same rule as lazy provisioning: nothing appears in a chart until the org
    // actually holds stock. The first stocked item or posting provisions it.
    if (!items.length) { console.log(`  skipped:  no stocked items — provisioned on first use
`); continue; }

    // 1. Provision
    const prov = await RS.provisionInventoryAccounting(org.id, { withAccounts: !synced, dryRun: !COMMIT });
    if (prov.createdGroups.length) console.log(`  groups:   ${COMMIT ? "created" : "would create"} ${prov.createdGroups.join(", ")}`);
    if (prov.adoptedAccounts.length) console.log(`  adopt:    ${prov.adoptedAccounts.join("; ")}`);
    if (prov.createdAccounts.length) console.log(`  accounts: ${COMMIT ? "created" : "would create"} ${prov.createdAccounts.length} — ${prov.createdAccounts.join(", ")}`);
    if (synced) console.log(`  roles:    left for the tenant to map on /accounting/posting-groups (synced chart — nothing created, nothing pushed)`);

    const groups = await RS.loadGroupMaps(org.id);
    const defaultOf = (t: string) => groups.find(g => g.isDefault && g.groupType === t);

    // 2. Assign groups
    const toAssign = items.filter(i => {
      const t = R.groupTypeForKind(i.productType)!;
      const own = i.postingGroupId ? groups.find(g => g.id === i.postingGroupId && g.groupType === t) : undefined;
      return !own;
    });
    if (toAssign.length) {
      console.log(`  assign:   ${toAssign.length} item(s) → default group of their type`);
      if (COMMIT) for (const i of toAssign) {
        const g = defaultOf(R.groupTypeForKind(i.productType)!);
        if (g) await db.update(S.apItems).set({ postingGroupId: g.id }).where(eq(S.apItems.id, i.id));
      }
    }

    // 3. Overrides
    const accts = await db.select().from(S.accounts).where(eq(S.accounts.orgId, org.id));
    const byId = new Map(accts.map(a => [a.id, a]));
    for (const i of items) {
      const t = R.groupTypeForKind(i.productType)!;
      for (const field of ["assetAccountId", "cogsAccountId", "incomeAccountId"] as const) {
        const v = (i as any)[field] as string | null;
        if (!v) continue;
        const role = R.roleForOverride(field, t);
        const a = byId.get(v);
        const why = a ? R.roleAccountError(role, { ...a, isHeader: a.isHeader }) : "not a local account (provider id)";
        if (!why && defaultOf(t)?.roles[role] === v) continue;                       // same as the group: not an override
        console.log(`  override: ${i.name} · ${R.ROLES[role].label} → ${a ? a.name : v} — ${why ? `DROP (${why})` : "keep"}`);
        if (why && COMMIT) await db.update(S.apItems).set({ [field]: null } as any).where(eq(S.apItems.id, i.id));
      }
    }

    // 4. Reclass (native charts only — a synced org's GL lives in QuickBooks/Xero)
    if (synced) { console.log(""); continue; }
    const legacy = accts.filter(a => a.isSystem && !a.isSystemDefault && !a.isHeader && ["Inventory", "JobWorkMaterials"].includes(a.subtype ?? ""));
    const legacyBal = await RS.glBalances(org.id, legacy.map(a => a.id), DATE);
    const legacyTotal = legacy.reduce((s, a) => s + (legacyBal.get(a.id) ?? 0), 0);
    const done = await db.select({ id: S.journalEntries.id }).from(S.journalEntries)
      .where(and(eq(S.journalEntries.orgId, org.id), eq(S.journalEntries.memo, MEMO))).limit(1);
    if (done.length) { console.log(`  reclass:  already posted — skipped\n`); continue; }
    if (Math.abs(legacyTotal) < 0.005) { console.log(`  reclass:  old inventory account(s) hold nothing — none needed\n`); continue; }

    const values = await RS.stockValueByItem(org.id, DATE);
    // Read-only either way. In a dry run on a tenant not yet provisioned there
    // is no WIP account to resolve, so open job work reads as 0 until --commit.
    const svg = await RS.stockVsGl(org.id, DATE, { provision: false });
    const perType = new Map<string, number>();
    for (const i of items) perType.set(R.groupTypeForKind(i.productType)!, (perType.get(R.groupTypeForKind(i.productType)!) ?? 0) + (values.get(i.id) ?? 0));
    const openWip = svg.wip.reduce((s, w) => s + w.openOrdersValue, 0);

    console.log(`  reclass:  old inventory account(s) hold ${money(legacyTotal)} as at ${DATE}`);
    const lines: { accountId: string; debit?: number; credit?: number; description: string }[] = [];
    let moved = 0;
    for (const [t, v] of perType) {
      const amt = Math.round(v * 100) / 100;
      if (amt <= 0) continue;
      const role = R.GROUP_TYPE_META[t as keyof typeof R.GROUP_TYPE_META].inventoryRole;
      const target = defaultOf(t)?.roles[role];
      console.log(`            → ${R.ROLES[role].label} (${R.GROUP_TYPE_META[t as keyof typeof R.GROUP_TYPE_META].label}): ${money(amt)}`);
      if (target) lines.push({ accountId: target, debit: amt, description: `Stock of ${R.GROUP_TYPE_META[t as keyof typeof R.GROUP_TYPE_META].label.toLowerCase()} items` });
      moved += amt;
    }
    if (openWip > 0.005) {
      const target = defaultOf("RM")?.roles.WIP_OPEN_ORDERS;
      console.log(`            → Work in progress — open job work: ${money(openWip)}`);
      if (target) lines.push({ accountId: target, debit: Math.round(openWip * 100) / 100, description: "Open job-work orders" });
      moved += Math.round(openWip * 100) / 100;
    }
    moved = Math.round(moved * 100) / 100;
    const residual = Math.round((legacyTotal - moved) * 100) / 100;
    console.log(`            residual left in the old account: ${money(residual)}${Math.abs(residual) >= 0.005 ? "  ← historic GL-vs-stock difference, REPORTED not plugged (GAP_REPORT §C)" : ""}`);

    if (COMMIT && moved > 0) {
      // Credit the old accounts in proportion to what they hold — in practice
      // the catch-all Inventory Asset, since job-work clearing nets to zero.
      let left = moved;
      const holders = legacy.filter(a => (legacyBal.get(a.id) ?? 0) > 0).sort((a, b) => (legacyBal.get(b.id)! - legacyBal.get(a.id)!));
      for (const a of holders) {
        const take = Math.min(left, legacyBal.get(a.id)!);
        if (take > 0.004) { lines.push({ accountId: a.id, credit: Math.round(take * 100) / 100, description: `Out of ${a.name}` }); left = Math.round((left - take) * 100) / 100; }
      }
      if (left > 0.004) { console.log(`            ✗ the old accounts hold less than the stock value — not posting; investigate first`); console.log(""); continue; }
      const entry = await postJournalEntry({ orgId: org.id, entryDate: DATE, memo: MEMO, series: "Journal", sourceType: "Reclass", createdBy: null, lines });
      console.log(`            ✓ posted ${entry.docNumber ?? entry.id}`);
    }
    console.log("");
  }
  if (!COMMIT) console.log("Dry run only. Re-run with --commit to apply.");
}

main().catch(e => { console.error(e); process.exit(1); });
