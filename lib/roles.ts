/**
 * Organisation roles — what a person may open in the app (pure, client-safe).
 *
 * The model (researched against QBO Advanced, NetSuite, Dynamics 365, Zoho):
 *  - ONE role per person per organisation. Stacked roles are hard for a small
 *    business admin to reason about.
 *  - A role is a grid of MODULE x ACCESS (none | view | edit) plus a separate
 *    PEOPLE SCOPE (self | team | department | all) for timesheets and reports.
 *  - Every role sits on a BASE access type, one of the app's existing system
 *    roles. Hundreds of routes already check company_admin / company_user /
 *    rep / employee, and a custom role must never mean something they don't
 *    expect. Admin is system-only, so a role editor cannot mint a second kind
 *    of admin (no privilege escalation through the role screen).
 *  - The four system roles are built in, not editable. A person with no custom
 *    role behaves exactly as before roles existed.
 *  - A role only ever NARROWS what the organisation has bought: the module
 *    gate runs first, then the role gate.
 */

import { MODULE_KEYS, type ModuleKey } from "@/lib/modules";

export type ModuleAccess = "none" | "view" | "edit";
export type PeopleScope = "self" | "team" | "department" | "all";
/** The base access types a CUSTOM role may sit on. Admin is system-only. */
export type BaseRole = "company_user" | "rep" | "employee";

export const MODULE_ACCESS: readonly ModuleAccess[] = ["none", "view", "edit"];
export const PEOPLE_SCOPES: readonly PeopleScope[] = ["self", "team", "department", "all"];
export const CUSTOM_BASE_ROLES: readonly BaseRole[] = ["company_user", "rep", "employee"];

export const BASE_ROLE_LABEL: Record<string, string> = {
  company_admin: "Admin",
  company_user: "Standard",
  rep: "Collector (own customers only)",
  employee: "Timesheet only",
};

export const SCOPE_LABEL: Record<PeopleScope, string> = {
  self: "Own only",
  team: "Their team",
  department: "Their department",
  all: "Everyone",
};

export interface OrgRole {
  id: string;
  name: string;
  baseRole: BaseRole;
  /** Module -> access. A module missing from the map is "none". */
  modules: Partial<Record<ModuleKey, ModuleAccess>>;
  peopleScope: PeopleScope;
}

/** The built-in roles, shown beside custom ones. Not stored. */
export const SYSTEM_ROLES = [
  { key: "company_admin", name: "Admin", description: "Everything, including people, roles, billing and settings." },
  { key: "company_user", name: "Full Access", description: "Every module the organisation has. Cannot manage people or roles." },
  { key: "rep", name: "Rep", description: "Collections for their own customers." },
  { key: "employee", name: "Employee", description: "Their own timesheet and reports only." },
] as const;

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** A missing method counts as a write: fail closed, never open. */
export function isWriteMethod(method: string | null | undefined): boolean {
  return !method || !READ_METHODS.has(method.toUpperCase());
}

/** May this role call a route owned by `module` with `method`? */
export function roleAllows(role: Pick<OrgRole, "modules"> | null | undefined, module: ModuleKey, method: string | null | undefined): boolean {
  if (!role) return true; // no custom role = today's behaviour
  const access = role.modules[module] ?? "none";
  if (access === "edit") return true;
  if (access === "view") return !isWriteMethod(method);
  return false;
}

/**
 * May this role write to a SHARED route (no owning module — Customers,
 * documents, ledger, products…)? Only if it can edit at least one module:
 * a role that is view-only everywhere is view-only everywhere.
 */
export function canWriteShared(role: Pick<OrgRole, "modules"> | null | undefined): boolean {
  if (!role) return true;
  return Object.values(role.modules).some((a) => a === "edit");
}

/** The modules this person can see: the org's, narrowed by the role. */
export function visibleModules(orgModules: readonly string[], role: Pick<OrgRole, "modules"> | null | undefined): string[] {
  if (!role) return [...orgModules];
  return orgModules.filter((m) => (role.modules[m as ModuleKey] ?? "none") !== "none");
}

export interface RoleInput {
  name: string;
  baseRole: string;
  modules: Record<string, string>;
  peopleScope: string;
}

/** Validate and normalise a role from a request. */
export function parseRoleInput(input: RoleInput): { error: string } | { role: Omit<OrgRole, "id"> } {
  const name = (input?.name || "").trim();
  if (!name) return { error: "Give the role a name." };
  if (name.length > 60) return { error: "Role names are 60 characters at most." };
  if (SYSTEM_ROLES.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
    return { error: `"${name}" is a built-in role name. Choose another.` };
  }
  if (!CUSTOM_BASE_ROLES.includes(input.baseRole as BaseRole)) {
    return { error: "Choose an access type: Standard, Collector or Timesheet only." };
  }
  if (!PEOPLE_SCOPES.includes(input.peopleScope as PeopleScope)) return { error: "Choose who this role can see." };
  const modules: Partial<Record<ModuleKey, ModuleAccess>> = {};
  for (const [k, v] of Object.entries(input.modules || {})) {
    if (!(MODULE_KEYS as readonly string[]).includes(k)) return { error: `Unknown module "${k}".` };
    if (!MODULE_ACCESS.includes(v as ModuleAccess)) return { error: `Invalid access "${v}" for ${k}.` };
    if (v !== "none") modules[k as ModuleKey] = v as ModuleAccess;
  }
  // A timesheet-only login never reaches module routes; offering modules would be a lie.
  if (input.baseRole === "employee" && Object.keys(modules).length) {
    return { error: "A Timesheet only role cannot open modules. Use Standard to give module access." };
  }
  return { role: { name, baseRole: input.baseRole as BaseRole, modules, peopleScope: input.peopleScope as PeopleScope } };
}

/**
 * Lockout guard: would this change leave the organisation with no active admin?
 * `activeAdminIds` = active members whose base role is company_admin.
 */
export function wouldRemoveLastAdmin(activeAdminIds: readonly string[], targetUserId: string, newBaseRole: string | null): boolean {
  if (!activeAdminIds.includes(targetUserId)) return false;
  if (newBaseRole === "company_admin") return false;
  return activeAdminIds.length <= 1;
}

/** Modules a role names must be ones the org has; anything else is refused, not silently kept. */
export function checkModulesInOrg(modules: Record<string, string>, enabled: readonly string[]): string | null {
  const extra = Object.keys(modules).filter((k) => !enabled.includes(k));
  return extra.length ? `This organisation does not have: ${extra.join(", ")}.` : null;
}
