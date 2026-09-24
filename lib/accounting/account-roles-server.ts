/**
 * Account roles — server side. The ONE place an inventory posting learns which
 * account to use. Pure vocabulary lives in `account-roles.ts`.
 *
 *   resolve:   item → its posting group (or the default group of its type)
 *              → role → account, with a validated Finance-Admin override on top.
 *   provision: seeds the default accounts + the four default groups for a
 *              native tenant; a synced tenant gets the groups only and maps
 *              each role to one of its own accounts on the mapping screen.
 *   block:     a tracked item whose group has any role unmapped cannot move
 *              stock — `loadItemCostInfo` refuses it, which covers every poster.
 */

import { db } from "@/db";
import { accounts, inventoryPostingGroups, postingGroupAccounts, organisations, apItems } from "@/db/schema";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { LedgerValidationError, postJournalEntry } from "@/lib/ledger";
import {
  ACCOUNT_ROLES, ROLES, GROUP_TYPES, GROUP_TYPE_META, INVENTORY_ROLES, INVENTORIES_HEADER, MAPPING_PATH,
  TEMPLATE_VERSION, TRADING_DEFAULT_NAMES, defaultAccountName, groupTypeForKind, isGroupType, missingRoles, rolesForGroupType, isRoleForGroupType,
  roleAccountError, roleForOverride, type AccountRole, type GroupType, type OverrideField,
} from "./account-roles";

/** A mapping gap. Extends LedgerValidationError so every route already turns it into a 400. */
export class AccountMappingError extends LedgerValidationError {}

type AcctRow = { id: string; name: string; code: string | null; type: string | null; subtype: string | null; status: string; isHeader: boolean; isSystem: boolean; isSystemDefault: boolean; defaultRole: string | null; source: string };

async function orgAccounts(orgId: string): Promise<AcctRow[]> {
  return db.select({
    id: accounts.id, name: accounts.name, code: accounts.code, type: accounts.type, subtype: accounts.subtype,
    status: accounts.status, isHeader: accounts.isHeader, isSystem: accounts.isSystem,
    isSystemDefault: accounts.isSystemDefault, defaultRole: accounts.defaultRole, source: accounts.source,
  }).from(accounts).where(eq(accounts.orgId, orgId));
}

/**
 * Does this org's chart live in QuickBooks/Xero? Judged by the chart itself,
 * not by a connection token: an org can hold a token and still keep its books
 * here (AM MERCHADISING does), and a disconnected org still has a synced chart.
 */
export async function isSyncedOrg(orgId: string): Promise<boolean> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(accounts)
    .where(and(eq(accounts.orgId, orgId), ne(accounts.source, "native")));
  return Number(row?.n ?? 0) > 0;
}

// ── Provisioning ────────────────────────────────────────────────────────────

/** Account subtype seeded for each role — so type-driven reports place it right. */
const ROLE_SUBTYPE: Record<string, string> = {
  current_asset: "Inventory", current_liability: "GRIRClearing", income: "SalesOfProductIncome",
  other_income: "OtherMiscellaneousIncome", cost_of_sales: "SuppliesMaterialsCogs",
};
const ROLE_TYPE: Record<string, { type: string; classification: string }> = {
  current_asset:     { type: "Other Current Asset",     classification: "Asset" },
  current_liability: { type: "Other Current Liability", classification: "Liability" },
  income:            { type: "Income",                  classification: "Revenue" },
  other_income:      { type: "Other Income",            classification: "Revenue" },
  cost_of_sales:     { type: "Cost of Goods Sold",      classification: "Expense" },
};

/**
 * Accounts that predate roles and already play one — ADOPTED rather than
 * duplicated, because they carry live balances (GR/IR holds every open
 * receipt). Only accounts WE created (`is_system`) are adopted automatically;
 * a user's own account is mapped deliberately or not at all.
 * The old catch-all "Inventory Asset" is deliberately NOT adopted: it holds
 * every kind's stock at once, and splitting it is the migration's reclass.
 */
const ADOPT_BY_SUBTYPE: Partial<Record<AccountRole, string>> = {
  GRNI: "GRIRClearing",
  COGS_FG: "SuppliesMaterialsCogs",
  INVENTORY_ADJUSTMENT: "OtherCostsOfServiceCos",
};

export type ProvisionReport = { createdAccounts: string[]; adoptedAccounts: string[]; createdGroups: string[]; mappedRoles: number };

/**
 * Seed the inventory-accounting template for an org. Idempotent: only ever ADDS
 * — an existing mapping, account or group is never altered.
 *
 * `withAccounts` false (a synced tenant's automatic path) creates the four
 * default groups and nothing in the chart. The mapping screen's "Create missing
 * default accounts" calls it with true for any tenant — the accounts are local;
 * nothing is pushed to QuickBooks or Xero.
 */
export async function provisionInventoryAccounting(orgId: string, opts: { withAccounts: boolean; dryRun?: boolean }): Promise<ProvisionReport> {
  const report: ProvisionReport = { createdAccounts: [], adoptedAccounts: [], createdGroups: [], mappedRoles: 0 };
  const accts = await orgAccounts(orgId);

  // 1. Default groups — one per type.
  const groups = await db.select().from(inventoryPostingGroups).where(eq(inventoryPostingGroups.orgId, orgId));
  const defaults = new Map<GroupType, string>();
  for (const g of groups) if (g.isDefault && isGroupType(g.groupType)) defaults.set(g.groupType, g.id);
  for (const t of GROUP_TYPES) {
    if (defaults.has(t)) continue;
    report.createdGroups.push(GROUP_TYPE_META[t].defaultGroupName);
    if (opts.dryRun) continue;
    // A user may already have a group by the default's name; don't collide.
    const taken = groups.some(g => g.name.trim().toLowerCase() === GROUP_TYPE_META[t].defaultGroupName.toLowerCase());
    const name = taken ? `${GROUP_TYPE_META[t].defaultGroupName} (default)` : GROUP_TYPE_META[t].defaultGroupName;
    await db.insert(inventoryPostingGroups).values({ orgId, name, groupType: t, isDefault: true, templateVersion: TEMPLATE_VERSION }).onConflictDoNothing();
  }
  if (!opts.dryRun) {
    const now = await db.select().from(inventoryPostingGroups).where(and(eq(inventoryPostingGroups.orgId, orgId), eq(inventoryPostingGroups.isDefault, true)));
    for (const g of now) if (isGroupType(g.groupType)) defaults.set(g.groupType, g.id);
  }

  if (!opts.withAccounts) {
    if (!opts.dryRun) await db.update(organisations).set({ inventoryTemplateVersion: TEMPLATE_VERSION }).where(eq(organisations.id, orgId));
    return report;
  }

  // 2. The template's accounts: adopt, else find by name, else create.
  const byKey = new Map<string, string>();                      // `${role}|${name}` → account id
  const key = (role: AccountRole, name: string) => `${role}|${name.toLowerCase()}`;
  for (const a of accts) if (a.defaultRole) byKey.set(key(a.defaultRole as AccountRole, a.name), a.id);
  // An ADOPTED account keeps its own name ("Cost of Goods Sold", not "Cost of
  // Sales – Finished Goods"), so it would never match its role's default by
  // name and a second run would create a duplicate beside it. It stands in for
  // the role's BASE default; the trading defaults carry their own names.
  const tradingNames = new Set(Object.values(TRADING_DEFAULT_NAMES).map(n => n!.toLowerCase()));
  for (const a of accts) {
    if (!a.defaultRole || !a.isSystemDefault || tradingNames.has(a.name.toLowerCase())) continue;
    const base = key(a.defaultRole as AccountRole, ROLES[a.defaultRole as AccountRole]?.defaultName ?? "");
    if (!byKey.has(base)) byKey.set(base, a.id);
  }

  let headerId = accts.find(a => a.isHeader && a.name.toLowerCase() === INVENTORIES_HEADER.name.toLowerCase())?.id ?? null;
  if (!headerId) {
    report.createdAccounts.push(INVENTORIES_HEADER.name);
    if (!opts.dryRun) {
      const [h] = await db.insert(accounts).values({
        orgId, source: "native", name: INVENTORIES_HEADER.name, code: null, classification: INVENTORIES_HEADER.classification,
        type: INVENTORIES_HEADER.type, subtype: "Inventory", status: "Active", isSystem: true, isSystemDefault: true, isHeader: true,
      }).returning({ id: accounts.id });
      headerId = h.id;
    }
  }

  const wanted: { role: AccountRole; name: string }[] = [];
  for (const role of ACCOUNT_ROLES) wanted.push({ role, name: ROLES[role].defaultName });
  for (const [role, name] of Object.entries(TRADING_DEFAULT_NAMES)) wanted.push({ role: role as AccountRole, name: name! });

  for (const w of wanted) {
    const k = key(w.role, w.name);
    if (byKey.has(k)) continue;
    const isBase = w.name === ROLES[w.role].defaultName;
    // Adoption only stands in for the BASE default of a role, never a trading one.
    const adoptSub = isBase ? ADOPT_BY_SUBTYPE[w.role] : undefined;
    const alreadyAdopted = accts.some(a => a.defaultRole === w.role && a.isSystemDefault);
    const adopt = adoptSub && !alreadyAdopted
      ? accts.find(a => a.isSystem && !a.isSystemDefault && !a.defaultRole && a.source === "native" && (a.subtype ?? "").toLowerCase() === adoptSub.toLowerCase() && !roleAccountError(w.role, a))
      : undefined;
    const sameName = accts.find(a => a.name.trim().toLowerCase() === w.name.toLowerCase() && !a.defaultRole && !roleAccountError(w.role, a));
    const hit = adopt ?? sameName;
    if (hit) {
      report.adoptedAccounts.push(`${hit.code ? hit.code + " " : ""}${hit.name} → ${w.role}`);
      byKey.set(k, hit.id);
      hit.defaultRole = w.role;
      if (!opts.dryRun) await db.update(accounts).set({ isSystemDefault: true, defaultRole: w.role, updatedAt: new Date() }).where(eq(accounts.id, hit.id));
      continue;
    }
    report.createdAccounts.push(w.name);
    if (opts.dryRun) { byKey.set(k, `dry:${k}`); continue; }
    const t = ROLE_TYPE[ROLES[w.role].kind];
    const [row] = await db.insert(accounts).values({
      orgId, source: "native", name: w.name, code: null,                 // blank code: the tenant numbers it
      classification: t.classification, type: t.type, subtype: ROLE_SUBTYPE[ROLES[w.role].kind],
      parentId: ROLES[w.role].kind === "current_asset" ? headerId : null,
      status: "Active", isSystem: true, isSystemDefault: true, defaultRole: w.role,
    }).returning({ id: accounts.id });
    byKey.set(k, row.id);
  }

  // 3. Fill every UNMAPPED role of each default group with its default account.
  const groupIds = [...defaults.values()];
  const existing = groupIds.length ? await db.select().from(postingGroupAccounts).where(inArray(postingGroupAccounts.groupId, groupIds)) : [];
  const have = new Set(existing.map(m => `${m.groupId}|${m.role}`));
  const inserts: { orgId: string; groupId: string; role: string; accountId: string }[] = [];
  for (const [t, gid] of defaults) {
    for (const role of rolesForGroupType(t)) {           // only what this group type posts through
      if (have.has(`${gid}|${role}`)) continue;
      const acct = byKey.get(key(role, defaultAccountName(role, t)));
      if (acct && !acct.startsWith("dry:")) inserts.push({ orgId, groupId: gid, role, accountId: acct });
      report.mappedRoles++;
    }
  }
  if (!opts.dryRun) {
    if (inserts.length) await db.insert(postingGroupAccounts).values(inserts).onConflictDoNothing();
    await db.update(organisations).set({ inventoryTemplateVersion: TEMPLATE_VERSION }).where(eq(organisations.id, orgId));
  }
  return report;
}

/**
 * Lazy provisioning on first use — same rule as locations and Suspense: nothing
 * appears in an org's chart until that org actually does inventory. A native
 * tenant gets the full template; a synced one only its groups (R-03: never
 * duplicate an external chart).
 */
export async function ensureInventoryAccounting(orgId: string): Promise<void> {
  const [org] = await db.select({ v: organisations.inventoryTemplateVersion }).from(organisations).where(eq(organisations.id, orgId)).limit(1);
  if (org?.v != null && org.v >= TEMPLATE_VERSION) return;
  await provisionInventoryAccounting(orgId, { withAccounts: !(await isSyncedOrg(orgId)) });
}

// ── Resolution ──────────────────────────────────────────────────────────────

export type GroupMap = {
  id: string; name: string; groupType: GroupType; isDefault: boolean;
  roles: Partial<Record<AccountRole, string>>;
};

/** Every posting group of the org with its role → account map. */
export async function loadGroupMaps(orgId: string): Promise<GroupMap[]> {
  const groups = await db.select().from(inventoryPostingGroups).where(eq(inventoryPostingGroups.orgId, orgId));
  if (!groups.length) return [];
  const maps = await db.select().from(postingGroupAccounts).where(eq(postingGroupAccounts.orgId, orgId));
  return groups.filter(g => isGroupType(g.groupType)).map(g => ({
    id: g.id, name: g.name, groupType: g.groupType as GroupType, isDefault: g.isDefault,
    // Only the roles this group type posts through. A mapping for a sibling's
    // goods role ("Finished goods inventory" on a Raw Materials group) would be
    // read by nothing, but counted as a use by remap and "in use" checks.
    roles: Object.fromEntries(maps.filter(m => m.groupId === g.id && isRoleForGroupType(m.role as AccountRole, g.groupType as GroupType)).map(m => [m.role, m.accountId])) as GroupMap["roles"],
  }));
}

export type ResolvedItemAccounts = {
  postingGroupId: string | null;
  groupType: GroupType | null;
  groupName: string | null;
  /** Every role of the item's group, overrides applied to the three item-level ones. */
  roles: Partial<Record<AccountRole, string>>;
  assetAccountId: string | null;
  cogsAccountId: string | null;
  incomeAccountId: string | null;
  unmapped: AccountRole[];
  /** Overrides present on the item but refused (wrong type, foreign, inactive). */
  ignoredOverrides: { field: OverrideField; accountId: string; reason: string }[];
};

type ItemRow = { id: string; productType: string; postingGroupId?: string | null; assetAccountId?: string | null; cogsAccountId?: string | null; incomeAccountId?: string | null };

/**
 * Resolve the accounts for tracked items. The item's own group wins when its
 * type matches; otherwise (none set, or a stale one of the wrong type) the
 * default group of the item's type — so an item is never left unposted
 * because nobody picked its group yet.
 */
export async function resolveItemAccounts(orgId: string, items: ItemRow[], opts?: { provision?: boolean }): Promise<Map<string, ResolvedItemAccounts>> {
  const out = new Map<string, ResolvedItemAccounts>();
  const tracked = items.filter(i => groupTypeForKind(i.productType));
  if (!tracked.length) return out;
  // Read-only callers (reports, reconciliation) pass provision:false so looking
  // at an org never seeds its chart.
  if (opts?.provision !== false) await ensureInventoryAccounting(orgId);
  const [groups, accts] = await Promise.all([loadGroupMaps(orgId), orgAccounts(orgId)]);
  const acctById = new Map(accts.map(a => [a.id, a]));
  for (const it of tracked) {
    const t = groupTypeForKind(it.productType)!;
    const own = it.postingGroupId ? groups.find(g => g.id === it.postingGroupId && g.groupType === t) : undefined;
    const g = own ?? groups.find(x => x.isDefault && x.groupType === t);
    const roles: ResolvedItemAccounts["roles"] = { ...(g?.roles ?? {}) };
    const ignored: ResolvedItemAccounts["ignoredOverrides"] = [];
    for (const field of ["assetAccountId", "cogsAccountId", "incomeAccountId"] as OverrideField[]) {
      const v = it[field];
      if (!v) continue;
      const role = roleForOverride(field, t);
      const a = acctById.get(v);
      const why = a ? roleAccountError(role, a) : "not an account in this organisation";
      if (why) { ignored.push({ field, accountId: v, reason: why }); continue; }
      roles[role] = v;
    }
    const m = GROUP_TYPE_META[t];
    out.set(it.id, {
      postingGroupId: g?.id ?? null, groupType: t, groupName: g?.name ?? null, roles,
      assetAccountId: roles[m.inventoryRole] ?? null, cogsAccountId: roles[m.cogsRole] ?? null, incomeAccountId: roles[m.salesRole] ?? null,
      unmapped: missingRoles(roles, t), ignoredOverrides: ignored,
    });
  }
  return out;
}

/** The message every blocked posting shows. */
export function unmappedMessage(itemName: string, groupName: string | null, roles: AccountRole[]): string {
  const list = roles.slice(0, 4).map(r => ROLES[r].label).join(", ") + (roles.length > 4 ? ` and ${roles.length - 4} more` : "");
  return `${itemName} can't move stock yet: its posting group${groupName ? ` "${groupName}"` : ""} has no account for ${list}. `
    + `Map every role under Accounting → Setup → Posting Groups (${MAPPING_PATH}) first.`;
}

/** The account a role resolves to for an item, or a clear refusal. */
export function roleAccount(item: { name: string; accounts?: ResolvedItemAccounts | null }, role: AccountRole): string {
  const id = item.accounts?.roles[role];
  if (!id) throw new AccountMappingError(unmappedMessage(item.name, item.accounts?.groupName ?? null, [role]));
  return id;
}

/**
 * An ORDER account (work in progress, variances, scrap loss) for an item whose
 * own group type doesn't carry that role — trading goods sent to a job worker,
 * or a job-work order whose output is a raw material. Orders are production,
 * so they fall back to the default Finished Goods group. Still a refusal, not a
 * guess, if that group has no account for the role either.
 */
export async function orderRoleAccount(orgId: string, item: { name: string; accounts?: ResolvedItemAccounts | null }, role: AccountRole): Promise<string> {
  const own = item.accounts?.roles[role];
  if (own) return own;
  const fp = (await loadGroupMaps(orgId)).find(g => g.isDefault && g.groupType === "FP");
  const id = fp?.roles[role];
  if (!id) throw new AccountMappingError(unmappedMessage(item.name, fp?.name ?? "Finished Goods", [role]));
  return id;
}

// ── Control accounts ────────────────────────────────────────────────────────

/** Accounts mapped to an inventory role anywhere in the org — control accounts. */
export async function inventoryControlAccountIds(orgId: string): Promise<Set<string>> {
  const rows = await db.select({ id: postingGroupAccounts.accountId }).from(postingGroupAccounts)
    .where(and(eq(postingGroupAccounts.orgId, orgId), inArray(postingGroupAccounts.role, INVENTORY_ROLES as unknown as string[])));
  const ids = new Set(rows.map(r => r.id));
  // Item-level inventory overrides are control accounts too.
  const ov = await db.select({ id: apItems.assetAccountId }).from(apItems)
    .where(and(eq(apItems.orgId, orgId), sql`${apItems.assetAccountId} is not null`));
  const local = new Set((await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.orgId, orgId))).map(a => a.id));
  for (const o of ov) if (o.id && local.has(o.id)) ids.add(o.id);
  return ids;
}

/** Everything that points at an account — used to refuse deactivate / re-type. */
export async function accountReferences(orgId: string, accountId: string): Promise<string[]> {
  const refs: string[] = [];
  const maps = await db.select({ role: postingGroupAccounts.role, group: inventoryPostingGroups.name })
    .from(postingGroupAccounts).innerJoin(inventoryPostingGroups, eq(inventoryPostingGroups.id, postingGroupAccounts.groupId))
    .where(and(eq(postingGroupAccounts.orgId, orgId), eq(postingGroupAccounts.accountId, accountId)));
  for (const m of maps) refs.push(`${m.group}: ${ROLES[m.role as AccountRole]?.label ?? m.role}`);
  const [items] = await db.select({ n: sql<number>`count(*)::int` }).from(apItems).where(and(eq(apItems.orgId, orgId),
    sql`(${apItems.assetAccountId} = ${accountId} or ${apItems.cogsAccountId} = ${accountId} or ${apItems.incomeAccountId} = ${accountId} or ${apItems.expenseAccountId} = ${accountId})`));
  if (Number(items?.n ?? 0) > 0) refs.push(`${items!.n} item${Number(items!.n) === 1 ? "" : "s"}`);
  return refs;
}

// ── Item accounting (create / edit) ─────────────────────────────────────────

type ItemAccountingInput = {
  productType: string;
  postingGroupId?: string | null;
  assetAccountId?: string | null; cogsAccountId?: string | null; incomeAccountId?: string | null;
};

/**
 * Validate the accounting half of an item before it is written. For a tracked
 * kind: the group must be this org's and of the item's type (blank = the
 * default group of that type), and every override must be an account that may
 * play the role it stands in for. Returns the values to store, or an error.
 * Untracked kinds carry no group — their own income/expense fields stand.
 */
export async function prepareItemAccounting(orgId: string, b: ItemAccountingInput): Promise<{ error: string } | { values: { postingGroupId: string | null; assetAccountId: string | null; cogsAccountId: string | null; incomeAccountId: string | null } }> {
  const t = groupTypeForKind(b.productType);
  if (!t) return { values: { postingGroupId: null, assetAccountId: null, cogsAccountId: null, incomeAccountId: b.incomeAccountId ?? null } };
  await ensureInventoryAccounting(orgId);
  const groups = await loadGroupMaps(orgId);
  let g = b.postingGroupId ? groups.find(x => x.id === b.postingGroupId) : undefined;
  if (b.postingGroupId && !g) return { error: "That posting group doesn't exist in this organisation." };
  if (g && g.groupType !== t) return { error: `"${g.name}" is a ${GROUP_TYPE_META[g.groupType].label.toLowerCase()} group — this item needs a ${GROUP_TYPE_META[t].label.toLowerCase()} group.` };
  g = g ?? groups.find(x => x.isDefault && x.groupType === t);
  if (!g) return { error: "No posting group exists for this item type yet — set them up under Accounting → Setup → Posting Groups." };

  const accts = await orgAccounts(orgId);
  const byId = new Map(accts.map(a => [a.id, a]));
  const out = { postingGroupId: g.id, assetAccountId: null as string | null, cogsAccountId: null as string | null, incomeAccountId: null as string | null };
  for (const field of ["assetAccountId", "cogsAccountId", "incomeAccountId"] as OverrideField[]) {
    const v = b[field];
    if (!v) continue;
    const role = roleForOverride(field, t);
    // Choosing exactly what the group already says is not an override; storing
    // it would silently pin the item if the group's mapping later moves.
    if (g.roles[role] === v) continue;
    const why = byId.has(v) ? roleAccountError(role, byId.get(v)!) : "That account doesn't exist in this organisation.";
    if (why) return { error: why };
    out[field] = v;
  }
  return { values: out };
}

/** The inventory account an item's stock currently sits in (group role, or its override). */
export async function effectiveInventoryAccount(orgId: string, item: ItemRow): Promise<string | null> {
  const r = (await resolveItemAccounts(orgId, [item])).get(item.id);
  return r?.assetAccountId ?? null;
}

// ── Balances, remapping (R-08) and reconciliation (R-09) ────────────────────

const rowsOf = (r: any): any[] => (r?.rows ?? r) as any[];

/** GL balance (debit − credit) per account, as at a date (inclusive). */
export async function glBalances(orgId: string, accountIds: string[], asAt?: string | null): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(accountIds.filter(Boolean))];
  if (!ids.length) return out;
  const rows = await db.execute(sql`
    select l.account_id as id, coalesce(sum(l.debit::numeric - l.credit::numeric), 0) as bal
    from journal_lines l join journal_entries e on e.id = l.entry_id
    where l.org_id = ${orgId} and l.account_id in (${sql.join(ids.map(i => sql`${i}::uuid`), sql`, `)})
      ${asAt ? sql`and e.entry_date <= ${asAt}` : sql``}
    group by l.account_id`);
  for (const r of rowsOf(rows)) out.set(String(r.id), Math.round(Number(r.bal) * 100) / 100);
  return out;
}

/**
 * Stock value per item as at a date, from the movement log (sum of the signed
 * cost of every in/out movement dated on or before it). Transfers are excluded:
 * they move placement, not value. Without a date the cached lot value is used,
 * which is exact for "now".
 */
export async function stockValueByItem(orgId: string, asAt?: string | null): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!asAt) {
    const rows = await db.select({ id: apItems.id, v: apItems.invValue }).from(apItems).where(eq(apItems.orgId, orgId));
    for (const r of rows) if (Number(r.v)) out.set(r.id, Number(r.v));
    return out;
  }
  const rows = await db.execute(sql`
    select item_id as id, coalesce(sum(total_cost::numeric), 0) as v from inventory_movements
    where org_id = ${orgId} and movement_type <> 'transfer' and coalesce(movement_date, created_at::date) <= ${asAt}
    group by item_id`);
  for (const r of rowsOf(rows)) if (Number(r.v)) out.set(String(r.id), Number(r.v));
  return out;
}

type TrackedItem = { id: string; name: string; productType: string; postingGroupId: string | null; assetAccountId: string | null; cogsAccountId: string | null; incomeAccountId: string | null };

async function trackedItems(orgId: string): Promise<TrackedItem[]> {
  const rows = await db.select({
    id: apItems.id, name: apItems.name, productType: apItems.productType, postingGroupId: apItems.postingGroupId,
    assetAccountId: apItems.assetAccountId, cogsAccountId: apItems.cogsAccountId, incomeAccountId: apItems.incomeAccountId,
  }).from(apItems).where(eq(apItems.orgId, orgId));
  return rows.filter(r => groupTypeForKind(r.productType));
}

export type StockVsGlRow = {
  accountId: string; accountName: string; accountCode: string | null;
  groups: string[]; stockValue: number; glBalance: number; difference: number;
};
export type WipRow = { accountId: string; accountName: string; accountCode: string | null; openOrdersValue: number; glBalance: number; difference: number };

/**
 * Stock vs GL and Open orders vs WIP (R-09). Reported per ACCOUNT, with the
 * groups that post to it, because two groups may share one inventory account
 * and the GL can only be compared account by account.
 */
export async function stockVsGl(orgId: string, asAt?: string | null, opts?: { provision?: boolean }): Promise<{ rows: StockVsGlRow[]; unassignedValue: number; wip: WipRow[] }> {
  const items = await trackedItems(orgId);
  const [resolved, values, groups] = await Promise.all([resolveItemAccounts(orgId, items, opts), stockValueByItem(orgId, asAt), loadGroupMaps(orgId)]);
  const byAcct = new Map<string, { groups: Set<string>; value: number }>();
  let unassigned = 0;
  for (const it of items) {
    const r = resolved.get(it.id);
    const v = values.get(it.id) ?? 0;
    if (!r?.assetAccountId) { unassigned += v; continue; }
    const e = byAcct.get(r.assetAccountId) ?? { groups: new Set<string>(), value: 0 };
    if (r.groupName) e.groups.add(r.groupName);
    e.value += v;
    byAcct.set(r.assetAccountId, e);
  }
  // Every account mapped to a stock role shows, even with nothing in it: a
  // balance on an account no item posts to is exactly the drift to see.
  for (const g of groups) {
    const acct = g.roles[GROUP_TYPE_META[g.groupType].inventoryRole];
    if (!acct) continue;
    const e = byAcct.get(acct) ?? { groups: new Set<string>(), value: 0 };
    e.groups.add(g.name);
    byAcct.set(acct, e);
  }
  const wipIds = [...new Set(groups.map(g => g.roles.WIP_OPEN_ORDERS).filter(Boolean) as string[])];
  const accts = await orgAccounts(orgId);
  const info = new Map(accts.map(a => [a.id, a]));
  const bal = await glBalances(orgId, [...byAcct.keys(), ...wipIds], asAt);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const rows: StockVsGlRow[] = [...byAcct.entries()].map(([id, e]) => {
    const stock = r2(e.value), gl = bal.get(id) ?? 0;
    return { accountId: id, accountName: info.get(id)?.name ?? "(unknown account)", accountCode: info.get(id)?.code ?? null, groups: [...e.groups].sort(), stockValue: stock, glBalance: gl, difference: r2(gl - stock) };
  }).sort((a, b) => a.accountName.localeCompare(b.accountName));

  // Open orders: the only orders holding value between steps today are job-work
  // orders (a build opens and closes in one entry). Open value = dispatched
  // less what has come back, at the dispatch rate.
  const open = await db.execute(sql`
    select o.sent_item_id as item, o.sent_qty::numeric as sq, o.sent_amount::numeric as sa,
      coalesce((select sum(coalesce(r.material_qty_consumed, r.received_qty)::numeric) from job_work_receipts r
                where r.job_work_order_id = o.id ${asAt ? sql`and r.receive_date <= ${asAt}` : sql``}), 0) as back
    from job_work_orders o
    where o.org_id = ${orgId}
      ${asAt ? sql`and o.dispatch_date <= ${asAt} and (o.closed_at is null or o.closed_at::date > ${asAt})` : sql`and o.status <> 'Closed'`}`);
  const openRows = rowsOf(open);
  const wipVal = new Map<string, number>();
  for (const r of openRows) {
    const acct = resolved.get(String(r.item))?.roles.WIP_OPEN_ORDERS;
    if (!acct) continue;
    const sq = Number(r.sq) || 0, rate = sq > 0 ? Number(r.sa) / sq : 0;
    wipVal.set(acct, (wipVal.get(acct) ?? 0) + Math.max(0, sq - Number(r.back)) * rate);
  }
  const wip: WipRow[] = wipIds.map(id => {
    const v = r2(wipVal.get(id) ?? 0), gl = bal.get(id) ?? 0;
    return { accountId: id, accountName: info.get(id)?.name ?? "(unknown account)", accountCode: info.get(id)?.code ?? null, openOrdersValue: v, glBalance: gl, difference: r2(gl - v) };
  });
  return { rows, unassignedValue: r2(unassigned), wip };
}

export type RemapChange = { role: AccountRole; from: string | null; to: string };
export type Reclass = { role: AccountRole; fromAccountId: string; toAccountId: string; amount: number; basis: "account balance" | "stock value of this group" };

/**
 * The reclass a remap needs (R-08). Only the four stock roles hold a balance
 * that belongs to stock; moving any other role only changes where FUTURE
 * postings go. If the old account serves only this role of this group, its
 * whole balance moves. If it is shared, only this group's stock value moves;
 * the rest belongs to whoever else uses it. A shared WIP account has no
 * per-group split that could be proved, so that remap is refused while it
 * holds value.
 */
export async function planReclass(orgId: string, groupId: string, changes: RemapChange[], asAt: string): Promise<{ reclass: Reclass[]; refused: string | null }> {
  const groups = await loadGroupMaps(orgId);
  const g = groups.find(x => x.id === groupId);
  if (!g) return { reclass: [], refused: "Posting group not found." };
  const items = await trackedItems(orgId);
  const out: Reclass[] = [];
  for (const c of changes) {
    if (!c.from || c.from === c.to || !(INVENTORY_ROLES as readonly string[]).includes(c.role)) continue;
    const otherUse = groups.some(x => Object.entries(x.roles).some(([role, acct]) => acct === c.from && !(x.id === g.id && role === c.role)))
      || items.some(i => i.assetAccountId === c.from);
    if (!otherUse) {
      const amount = (await glBalances(orgId, [c.from], asAt)).get(c.from) ?? 0;
      if (Math.abs(amount) >= 0.005) out.push({ role: c.role, fromAccountId: c.from, toAccountId: c.to, amount, basis: "account balance" });
      continue;
    }
    if (c.role === "WIP_OPEN_ORDERS") {
      const b = (await glBalances(orgId, [c.from], asAt)).get(c.from) ?? 0;
      if (Math.abs(b) >= 0.005) return { reclass: [], refused: `The work-in-progress account is shared with other groups and holds ${b.toFixed(2)}. Receive or close the open orders first, then remap.` };
      continue;
    }
    if (GROUP_TYPE_META[g.groupType].inventoryRole !== c.role) continue;       // no stock of this group posts to it
    const members = items.filter(i => (i.postingGroupId ? i.postingGroupId === g.id : g.isDefault && groupTypeForKind(i.productType) === g.groupType) && !i.assetAccountId);
    const values = await stockValueByItem(orgId, asAt);
    const amount = Math.round(members.reduce((s, i) => s + (values.get(i.id) ?? 0), 0) * 100) / 100;
    if (Math.abs(amount) >= 0.005) out.push({ role: c.role, fromAccountId: c.from, toAccountId: c.to, amount, basis: "stock value of this group" });
  }
  return { reclass: out, refused: null };
}

// ── Mapping writes ──────────────────────────────────────────────────────────

/** Create a group. It starts as a copy of the default group of its type (R-04). */
export async function createPostingGroup(orgId: string, name: string, groupType: GroupType): Promise<{ id: string } | { error: string }> {
  const clean = name.trim().slice(0, 128);
  if (!clean) return { error: "Give the group a name." };
  await ensureInventoryAccounting(orgId);
  const groups = await loadGroupMaps(orgId);
  if (groups.some(g => g.name.trim().toLowerCase() === clean.toLowerCase())) return { error: `A posting group called "${clean}" already exists.` };
  const [row] = await db.insert(inventoryPostingGroups).values({ orgId, name: clean, groupType, isDefault: false }).returning({ id: inventoryPostingGroups.id });
  const base = groups.find(g => g.isDefault && g.groupType === groupType);
  const copy = Object.entries(base?.roles ?? {}).filter(([r, a]) => a && isRoleForGroupType(r as AccountRole, groupType)).map(([role, accountId]) => ({ orgId, groupId: row.id, role, accountId: accountId! }));
  if (copy.length) await db.insert(postingGroupAccounts).values(copy);
  return { id: row.id };
}

export type MappingUpdate = {
  roles: Partial<Record<AccountRole, string>>;
  /** Post the reclass the remap needs. Without it, a remap that needs one is returned for confirmation. */
  confirm?: boolean;
  effectiveDate: string;
  actorId: string | null;
};

/**
 * Change a group's role → account map. Every account is type-checked against
 * its role. Remapping a stock role while the old account holds value returns
 * the reclass for confirmation first (R-08); with `confirm`, it posts the
 * reclass, dated on the effective date, and then saves the mapping. Posting
 * first means a refused entry (period lock, inactive account) leaves the
 * mapping unchanged rather than half-moved.
 */
export async function updateGroupMapping(orgId: string, groupId: string, u: MappingUpdate):
  Promise<{ error: string } | { needsConfirm: true; reclass: (Reclass & { fromName: string; toName: string })[] } | { saved: true; reclassEntryId: string | null }> {
  const groups = await loadGroupMaps(orgId);
  const g = groups.find(x => x.id === groupId);
  if (!g) return { error: "Posting group not found." };
  const accts = await orgAccounts(orgId);
  const byId = new Map(accts.map(a => [a.id, a]));
  const changes: RemapChange[] = [];
  for (const [role, accountId] of Object.entries(u.roles)) {
    if (!(ACCOUNT_ROLES as readonly string[]).includes(role)) return { error: `Unknown role ${role}.` };
    if (!isRoleForGroupType(role as AccountRole, g.groupType)) return { error: `${ROLES[role as AccountRole].label} is not used by a ${GROUP_TYPE_META[g.groupType].label.toLowerCase()} group.` };
    if (!accountId) return { error: `${ROLES[role as AccountRole].label} needs an account — a role can't be left unmapped once set.` };
    const why = byId.has(accountId) ? roleAccountError(role as AccountRole, byId.get(accountId)!) : "That account doesn't exist in this organisation.";
    if (why) return { error: why };
    if (g.roles[role as AccountRole] !== accountId) changes.push({ role: role as AccountRole, from: g.roles[role as AccountRole] ?? null, to: accountId });
  }
  if (!changes.length) return { saved: true, reclassEntryId: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(u.effectiveDate)) return { error: "A valid effective date is required." };

  const plan = await planReclass(orgId, groupId, changes, u.effectiveDate);
  if (plan.refused) return { error: plan.refused };
  if (plan.reclass.length && !u.confirm) {
    return { needsConfirm: true, reclass: plan.reclass.map(r => ({ ...r, fromName: byId.get(r.fromAccountId)?.name ?? "", toName: byId.get(r.toAccountId)?.name ?? "" })) };
  }

  let reclassEntryId: string | null = null;
  if (plan.reclass.length) {
    const lines: { accountId: string; debit?: number; credit?: number; description: string }[] = [];
    for (const r of plan.reclass) {
      const amt = Math.abs(r.amount);
      const desc = `Reclass ${ROLES[r.role].label} — ${g.name}`;
      if (r.amount > 0) { lines.push({ accountId: r.toAccountId, debit: amt, description: desc }); lines.push({ accountId: r.fromAccountId, credit: amt, description: desc }); }
      else { lines.push({ accountId: r.fromAccountId, debit: amt, description: desc }); lines.push({ accountId: r.toAccountId, credit: amt, description: desc }); }
    }
    const entry = await postJournalEntry({
      orgId, entryDate: u.effectiveDate, memo: `Posting group remap — ${g.name}`,
      series: "Journal", sourceType: "Reclass", createdBy: u.actorId, lines,
    });
    reclassEntryId = entry.id;
  }

  for (const c of changes) {
    const [hit] = await db.update(postingGroupAccounts).set({ accountId: c.to, updatedAt: new Date() })
      .where(and(eq(postingGroupAccounts.groupId, groupId), eq(postingGroupAccounts.role, c.role))).returning({ id: postingGroupAccounts.id });
    if (!hit) await db.insert(postingGroupAccounts).values({ orgId, groupId, role: c.role, accountId: c.to }).onConflictDoNothing();
  }
  return { saved: true, reclassEntryId };
}

/** Delete a non-default group that no item uses. */
export async function deletePostingGroup(orgId: string, groupId: string): Promise<{ error: string } | { deleted: true }> {
  const [g] = await db.select().from(inventoryPostingGroups).where(and(eq(inventoryPostingGroups.id, groupId), eq(inventoryPostingGroups.orgId, orgId))).limit(1);
  if (!g) return { error: "Posting group not found." };
  if (g.isDefault) return { error: "A default group can't be deleted — every item type needs one to fall back on." };
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(apItems).where(and(eq(apItems.orgId, orgId), eq(apItems.postingGroupId, groupId)));
  if (Number(n?.n ?? 0) > 0) return { error: `${n!.n} item${Number(n!.n) === 1 ? " uses" : "s use"} this group — move ${Number(n!.n) === 1 ? "it" : "them"} to another group first.` };
  await db.delete(inventoryPostingGroups).where(eq(inventoryPostingGroups.id, groupId));
  return { deleted: true };
}

/** Item counts per group (explicit members; unassigned items count toward their type's default group). */
export async function groupItemCounts(orgId: string): Promise<Map<string, number>> {
  const [items, groups] = await Promise.all([trackedItems(orgId), loadGroupMaps(orgId)]);
  const out = new Map<string, number>();
  for (const i of items) {
    const t = groupTypeForKind(i.productType)!;
    const own = i.postingGroupId ? groups.find(g => g.id === i.postingGroupId && g.groupType === t) : undefined;
    const g = own ?? groups.find(x => x.isDefault && x.groupType === t);
    if (g) out.set(g.id, (out.get(g.id) ?? 0) + 1);
  }
  return out;
}
