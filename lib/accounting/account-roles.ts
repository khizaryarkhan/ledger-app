/**
 * Account roles & inventory posting groups — the vocabulary (pure, client-safe).
 *
 * Posting logic never names an account. It names a ROLE ("the inventory account
 * of this item", "goods received not invoiced"), and the item's POSTING GROUP
 * says which of the tenant's accounts plays that role. Several roles may point
 * at one account (a small business with one "Inventory" account maps all four
 * inventory roles to it); a role may never point at an account of the wrong
 * type, because the statements are built from type, not from intent.
 *
 * Server-side resolution lives in `account-roles-server.ts` (it imports `db`);
 * this file must stay importable from client components — same split as
 * `lib/modules.ts` / `lib/modules-server.ts`.
 */

import { kindOf } from "@/lib/inventory/item-kinds";

export const ACCOUNT_ROLES = [
  "RM_INVENTORY", "WIP_STOCK", "WIP_OPEN_ORDERS", "FG_INVENTORY",
  "GRNI",
  "SALES_FG", "SALES_SURPLUS", "SALES_RETURNS", "SCRAP_SALES",
  "COGS_FG", "COGS_SURPLUS",
  "LABOUR_ABSORBED", "OVERHEAD_ABSORBED", "PRODUCTION_VARIANCE", "PURCHASE_PRICE_VARIANCE",
  "SCRAP_LOSS", "INVENTORY_ADJUSTMENT", "INVENTORY_WRITEDOWN",
] as const;
export type AccountRole = typeof ACCOUNT_ROLES[number];

/**
 * The account TYPES a role may map to (QBO AccountType labels, as stored on
 * `accounts.type`). Strict on purpose: an inventory role on a Fixed Asset or
 * COGS on an Expense account both "work" arithmetically and both misstate the
 * statements — gross margin moves, or stock is reported as plant.
 */
export const ROLE_ACCOUNT_TYPES: Record<string, readonly string[]> = {
  current_asset:       ["Other Current Asset"],
  current_liability:   ["Other Current Liability"],
  income:              ["Income"],
  other_income:        ["Other Income", "Income"],
  cost_of_sales:       ["Cost of Goods Sold"],
};

export type RoleMeta = {
  role: AccountRole;
  label: string;
  purpose: string;
  kind: keyof typeof ROLE_ACCOUNT_TYPES;
  /** Name of the default account seeded for this role (2.2). */
  defaultName: string;
  section: "Inventory" | "Purchasing" | "Sales" | "Cost of sales" | "Production" | "Adjustments";
};

export const ROLES: Record<AccountRole, RoleMeta> = {
  RM_INVENTORY:            { role: "RM_INVENTORY",            section: "Inventory",     kind: "current_asset",     label: "Raw materials inventory",   purpose: "Raw material stock value",                                  defaultName: "Raw Materials Inventory" },
  WIP_STOCK:               { role: "WIP_STOCK",               section: "Inventory",     kind: "current_asset",     label: "Semi-finished stock",       purpose: "Stocked semi-finished / intermediate items",                defaultName: "Semi-finished Goods Inventory" },
  WIP_OPEN_ORDERS:         { role: "WIP_OPEN_ORDERS",         section: "Inventory",     kind: "current_asset",     label: "Work in progress — open orders", purpose: "Value inside open manufacturing and job-work orders", defaultName: "Work in Progress – Open Orders" },
  FG_INVENTORY:            { role: "FG_INVENTORY",            section: "Inventory",     kind: "current_asset",     label: "Finished goods inventory",  purpose: "Finished product stock value",                              defaultName: "Finished Goods Inventory" },
  GRNI:                    { role: "GRNI",                    section: "Purchasing",    kind: "current_liability", label: "Goods received not invoiced (clearing)", purpose: "Credited when goods are received; the supplier's bill clears it",     defaultName: "Goods Received Not Invoiced" },
  PURCHASE_PRICE_VARIANCE: { role: "PURCHASE_PRICE_VARIANCE", section: "Purchasing",    kind: "cost_of_sales",     label: "Purchase price variance",   purpose: "Invoice price differences not absorbed into stock",         defaultName: "Purchase Price Variance" },
  SALES_FG:                { role: "SALES_FG",                section: "Sales",         kind: "income",            label: "Sales — finished goods",    purpose: "Revenue from finished product sales",                       defaultName: "Sales – Finished Goods" },
  SALES_SURPLUS:           { role: "SALES_SURPLUS",           section: "Sales",         kind: "income",            label: "Sales — materials & surplus", purpose: "Revenue from sales of raw material and WIP items",        defaultName: "Sales – Materials & Surplus" },
  SALES_RETURNS:           { role: "SALES_RETURNS",           section: "Sales",         kind: "income",            label: "Sales returns",             purpose: "Customer returns (contra-income)",                          defaultName: "Sales Returns" },
  SCRAP_SALES:             { role: "SCRAP_SALES",             section: "Sales",         kind: "other_income",      label: "Scrap sales",               purpose: "Sale of non-stock scrap and offcuts",                       defaultName: "Scrap Sales" },
  COGS_FG:                 { role: "COGS_FG",                 section: "Cost of sales", kind: "cost_of_sales",     label: "Cost of sales — finished goods", purpose: "Cost of finished product sold",                        defaultName: "Cost of Sales – Finished Goods" },
  COGS_SURPLUS:            { role: "COGS_SURPLUS",            section: "Cost of sales", kind: "cost_of_sales",     label: "Cost of sales — materials & surplus", purpose: "Cost of raw material and WIP items sold",          defaultName: "Cost of Sales – Materials & Surplus" },
  LABOUR_ABSORBED:         { role: "LABOUR_ABSORBED",         section: "Production",    kind: "cost_of_sales",     label: "Labour absorbed",           purpose: "Labour charged into production",                            defaultName: "Labour Absorbed" },
  OVERHEAD_ABSORBED:       { role: "OVERHEAD_ABSORBED",       section: "Production",    kind: "cost_of_sales",     label: "Overhead absorbed",         purpose: "Overhead charged into production",                          defaultName: "Overhead Absorbed" },
  PRODUCTION_VARIANCE:     { role: "PRODUCTION_VARIANCE",     section: "Production",    kind: "cost_of_sales",     label: "Production variance",       purpose: "Residual on closed manufacturing and job-work orders",      defaultName: "Production Variance" },
  SCRAP_LOSS:              { role: "SCRAP_LOSS",              section: "Production",    kind: "cost_of_sales",     label: "Scrap & yield loss",        purpose: "Production loss beyond the BOM's expected yield",           defaultName: "Scrap & Yield Loss" },
  INVENTORY_ADJUSTMENT:    { role: "INVENTORY_ADJUSTMENT",    section: "Adjustments",   kind: "cost_of_sales",     label: "Inventory adjustments",     purpose: "Stock count gains and losses",                              defaultName: "Inventory Adjustments" },
  INVENTORY_WRITEDOWN:     { role: "INVENTORY_WRITEDOWN",     section: "Adjustments",   kind: "cost_of_sales",     label: "Inventory write-downs",     purpose: "Write-down to net realisable value, expiry, damage",        defaultName: "Inventory Write-downs" },
};


/**
 * The four stock roles. Accounts mapped to them are CONTROL accounts: their
 * balance must equal the stock subledger, so only stock movements may post to
 * them — a manual journal would move the GL and leave the lots where they were.
 */
export const INVENTORY_ROLES: readonly AccountRole[] = ["RM_INVENTORY", "WIP_STOCK", "WIP_OPEN_ORDERS", "FG_INVENTORY"];
export const isInventoryRole = (r: string) => (INVENTORY_ROLES as readonly string[]).includes(r);

export const isAccountRole = (r: unknown): r is AccountRole =>
  typeof r === "string" && (ACCOUNT_ROLES as readonly string[]).includes(r);

/** Account types a role accepts. */
export const allowedTypesFor = (role: AccountRole): readonly string[] => ROLE_ACCOUNT_TYPES[ROLES[role].kind];

/** null when the account may play the role, else the reason it may not. */
export function roleAccountError(role: AccountRole, account: { type?: string | null; name?: string | null; isHeader?: boolean | null; status?: string | null } | null | undefined): string | null {
  if (!account) return `No account chosen for ${ROLES[role].label}.`;
  if (account.isHeader) return `"${account.name}" is a header account and cannot be posted to.`;
  if (account.status && account.status !== "Active") return `"${account.name}" is inactive.`;
  const ok = allowedTypesFor(role);
  if (!ok.includes(account.type ?? "")) {
    return `${ROLES[role].label} must be ${ok.length > 1 ? "one of " + ok.join(" / ") : "a " + ok[0]} account — "${account.name}" is ${account.type ? "a " + account.type : "untyped"}.`;
  }
  return null;
}

// ── Posting groups ──────────────────────────────────────────────────────────

/**
 * A group's TYPE decides which item kinds may belong to it and which of the
 * roles its items post through. TRADING is the fourth type (bought and resold
 * as-is, `StockItem`): it sells as goods, so it uses the finished-goods roles,
 * but it has its own group — and so its own accounts — because a distributor's
 * trading margin is not a manufacturer's production margin.
 */
export const GROUP_TYPES = ["RM", "WIP", "FP", "TRADING"] as const;
export type GroupType = typeof GROUP_TYPES[number];

export const GROUP_TYPE_META: Record<GroupType, { label: string; defaultGroupName: string; inventoryRole: AccountRole; salesRole: AccountRole; cogsRole: AccountRole }> = {
  RM:      { label: "Raw material",      defaultGroupName: "Raw Materials",  inventoryRole: "RM_INVENTORY", salesRole: "SALES_SURPLUS", cogsRole: "COGS_SURPLUS" },
  WIP:     { label: "Semi-finished",     defaultGroupName: "Semi-finished",  inventoryRole: "WIP_STOCK",    salesRole: "SALES_SURPLUS", cogsRole: "COGS_SURPLUS" },
  FP:      { label: "Finished product",  defaultGroupName: "Finished Goods", inventoryRole: "FG_INVENTORY", salesRole: "SALES_FG",      cogsRole: "COGS_FG" },
  TRADING: { label: "Trading goods",     defaultGroupName: "Trading Goods",  inventoryRole: "FG_INVENTORY", salesRole: "SALES_FG",      cogsRole: "COGS_FG" },
};

export const isGroupType = (t: unknown): t is GroupType => typeof t === "string" && (GROUP_TYPES as readonly string[]).includes(t);

/** The group type an item kind belongs to; null for kinds that carry no stock. */
export function groupTypeForKind(productType?: string | null): GroupType | null {
  const k = kindOf(productType);
  if (!k.tracked) return null;
  switch (k.kind) {
    case "RawMaterial":     return "RM";
    case "WorkInProgress":  return "WIP";
    case "StockItem":       return "TRADING";
    default:                return "FP";
  }
}

/**
 * Default accounts the TRADING group gets in place of the finished-goods ones
 * for its three goods roles. Every other role it shares with the rest.
 */
export const TRADING_DEFAULT_NAMES: Partial<Record<AccountRole, string>> = {
  FG_INVENTORY: "Trading Goods Inventory",
  SALES_FG:     "Sales – Trading Goods",
  COGS_FG:      "Cost of Sales – Trading Goods",
};

/** The seeded account name for a role within a group type. */
export const defaultAccountName = (role: AccountRole, groupType: GroupType): string =>
  (groupType === "TRADING" ? TRADING_DEFAULT_NAMES[role] : undefined) ?? ROLES[role].defaultName;

/**
 * The accounts each group type actually posts through — and ONLY those.
 * The rule (product owner, 2026-09-24): an account belongs on a group only if
 * something that happens to that kind of item posts to it. The system has to
 * stay friendly without losing what matters, so a role that is merely
 * conceivable for a type does not earn a row.
 *
 *   - Stock / Sales / Cost of sales: every type, its OWN role of each.
 *   - GRNI: every type. Semi-finished is never bought, but a job worker's
 *     processing charge is received against the item that comes back.
 *   - Purchase price variance: only types that are bought (not semi-finished).
 *   - WIP open orders: raw material, semi-finished and finished — what can be
 *     sent to a job worker or be the output of a build. Trading goods fall
 *     back to the default finished-goods group (orderRoleAccount).
 *   - Labour / overhead absorbed, production variance, scrap & yield loss:
 *     only what is PRODUCED (semi-finished, finished). Raw material is never
 *     the output of an order, so absorbing labour into it means nothing.
 *   - Sales returns: what customers actually return (finished, trading). A
 *     rare surplus return falls back to the item's sales account.
 *   - Adjustments / write-downs: every type — any stock can be counted,
 *     damaged or expire.
 *   - Scrap sales: NO group. Scrap is never stock; its income account lives on
 *     the non-stock scrap item that is invoiced.
 */
const GROUP_ROLES: Record<GroupType, readonly AccountRole[]> = {
  RM: ["RM_INVENTORY", "SALES_SURPLUS", "COGS_SURPLUS",
       "GRNI", "PURCHASE_PRICE_VARIANCE", "WIP_OPEN_ORDERS",
       "INVENTORY_ADJUSTMENT", "INVENTORY_WRITEDOWN"],
  WIP: ["WIP_STOCK", "SALES_SURPLUS", "COGS_SURPLUS",
        "GRNI", "WIP_OPEN_ORDERS", "LABOUR_ABSORBED", "OVERHEAD_ABSORBED", "PRODUCTION_VARIANCE", "SCRAP_LOSS",
        "INVENTORY_ADJUSTMENT", "INVENTORY_WRITEDOWN"],
  FP: ["FG_INVENTORY", "SALES_FG", "COGS_FG",
       "GRNI", "PURCHASE_PRICE_VARIANCE", "WIP_OPEN_ORDERS", "LABOUR_ABSORBED", "OVERHEAD_ABSORBED", "PRODUCTION_VARIANCE", "SCRAP_LOSS",
       "SALES_RETURNS", "INVENTORY_ADJUSTMENT", "INVENTORY_WRITEDOWN"],
  TRADING: ["FG_INVENTORY", "SALES_FG", "COGS_FG",
            "GRNI", "PURCHASE_PRICE_VARIANCE",
            "SALES_RETURNS", "INVENTORY_ADJUSTMENT", "INVENTORY_WRITEDOWN"],
};

/** The roles a group of this type posts through, in the canonical role order. */
export function rolesForGroupType(t: GroupType): AccountRole[] {
  const set = new Set(GROUP_ROLES[t]);
  return ACCOUNT_ROLES.filter(r => set.has(r));
}

/** Is this role one a group of this type uses? */
export const isRoleForGroupType = (role: AccountRole, t: GroupType) => rolesForGroupType(t).includes(role);

/**
 * How a group's accounts are laid out on the mapping screen. The group's own
 * three goods accounts come first under neutral names ("Stock account"), since
 * what they are called depends only on the group; the shared roles follow,
 * grouped by the process that posts to them. Exhaustive: every role the group
 * uses appears exactly once (pinned in tests/account-roles.test.ts).
 */
export type RoleSection = { title: string; desc: string; roles: { role: AccountRole; label: string }[] };

export function groupRoleSections(t: GroupType): RoleSection[] {
  const m = GROUP_TYPE_META[t];
  const kind = m.label.toLowerCase();
  const produced = isRoleForGroupType("LABOUR_ABSORBED", t);
  const all: RoleSection[] = [
    { title: "This group's accounts", desc: `Where ${kind} stock is held, and where its sales and cost of sales go.`, roles: [
      { role: m.inventoryRole, label: "Stock account" },
      { role: m.salesRole,     label: "Sales account" },
      { role: m.cogsRole,      label: "Cost of sales account" },
    ] },
    { title: "Purchasing", desc: "The clearing account a receipt is credited to until the supplier's bill clears it, and price differences on that bill.", roles: [
      { role: "GRNI",                    label: ROLES.GRNI.label },
      { role: "PURCHASE_PRICE_VARIANCE", label: ROLES.PURCHASE_PRICE_VARIANCE.label },
    ] },
    { title: produced ? "Production & job work" : "Job work",
      desc: produced
        ? "Value inside open orders, what is charged into them, and what is left when they close."
        : `The value of ${kind} while it is out at a job worker, until it comes back.`,
      roles: [
      { role: "WIP_OPEN_ORDERS",     label: ROLES.WIP_OPEN_ORDERS.label },
      { role: "LABOUR_ABSORBED",     label: ROLES.LABOUR_ABSORBED.label },
      { role: "OVERHEAD_ABSORBED",   label: ROLES.OVERHEAD_ABSORBED.label },
      { role: "PRODUCTION_VARIANCE", label: ROLES.PRODUCTION_VARIANCE.label },
      { role: "SCRAP_LOSS",          label: ROLES.SCRAP_LOSS.label },
    ] },
    { title: "Returns", desc: "Customer returns, kept apart from sales so returns can be read on their own.", roles: [
      { role: "SALES_RETURNS", label: ROLES.SALES_RETURNS.label },
    ] },
    { title: "Stock adjustments", desc: "Count differences and write-downs of stock on hand.", roles: [
      { role: "INVENTORY_ADJUSTMENT", label: ROLES.INVENTORY_ADJUSTMENT.label },
      { role: "INVENTORY_WRITEDOWN",  label: ROLES.INVENTORY_WRITEDOWN.label },
    ] },
  ];
  return all
    .map(sec => ({ ...sec, roles: sec.roles.filter(r => isRoleForGroupType(r.role, t)) }))
    .filter(sec => sec.roles.length > 0);
}

/**
 * Roles still unmapped in a group's map — the block's input. With a group
 * type, only the roles that type uses count: an unmapped "Finished goods
 * inventory" on a Raw Materials group blocks nothing, because nothing reads it.
 */
export function missingRoles(map: Partial<Record<string, string | null | undefined>>, groupType?: GroupType): AccountRole[] {
  const roles = groupType ? rolesForGroupType(groupType) : [...ACCOUNT_ROLES];
  return roles.filter(r => !map[r]);
}

/**
 * Seed template — versioned (R-03). A change here reaches only tenants
 * provisioned afterwards; a release that ADDS a role leaves existing tenants
 * with that role unmapped, which blocks their inventory posting until they map
 * it on the mapping screen. Existing accounts are never altered silently.
 */
export const TEMPLATE_VERSION = 1;

/** Header account every seeded inventory account sits under. */
export const INVENTORIES_HEADER = { name: "Inventories", type: "Other Current Asset", classification: "Asset" } as const;

/** Where the posting-group mapping lives — the block message links here. */
export const MAPPING_PATH = "/accounting/posting-groups";

/**
 * The item-level account fields a Finance Admin override may set, and which
 * role each one overrides. Everything else on an item comes from its group.
 */
export const OVERRIDE_FIELDS = {
  assetAccountId:  "inventory",
  cogsAccountId:   "cogs",
  incomeAccountId: "sales",
} as const;
export type OverrideField = keyof typeof OVERRIDE_FIELDS;

/** The role an item-level override field stands in for, given the item's group type. */
export function roleForOverride(field: OverrideField, groupType: GroupType): AccountRole {
  const m = GROUP_TYPE_META[groupType];
  return OVERRIDE_FIELDS[field] === "inventory" ? m.inventoryRole : OVERRIDE_FIELDS[field] === "cogs" ? m.cogsRole : m.salesRole;
}
