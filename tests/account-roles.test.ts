import { describe, it, expect } from "vitest";
import {
  ACCOUNT_ROLES, ROLES, GROUP_TYPES, GROUP_TYPE_META, INVENTORY_ROLES, TRADING_DEFAULT_NAMES,
  allowedTypesFor, roleAccountError, groupTypeForKind, missingRoles, defaultAccountName, roleForOverride,
  rolesForGroupType, groupRoleSections,
} from "@/lib/accounting/account-roles";
import { ITEM_KIND_LIST } from "@/lib/inventory/item-kinds";
import { ACCOUNT_TYPE_NAMES } from "@/lib/accounting/account-types";

// The inventory Chart-of-Accounts mapping (Phase 2). These pin the vocabulary
// every poster relies on: a wrong flag here does not fail loudly, it posts
// stock or margin to the wrong statement line.
describe("account roles", () => {
  it("has exactly the 18 roles of the spec, each with a default account", () => {
    expect(ACCOUNT_ROLES).toHaveLength(18);
    for (const r of ACCOUNT_ROLES) {
      expect(ROLES[r].role).toBe(r);
      expect(ROLES[r].defaultName.length).toBeGreaterThan(0);
    }
    expect(new Set(ACCOUNT_ROLES.map(r => ROLES[r].defaultName)).size).toBe(18);
  });

  it("every role accepts only real account types", () => {
    for (const r of ACCOUNT_ROLES) for (const t of allowedTypesFor(r)) expect(ACCOUNT_TYPE_NAMES).toContain(t);
  });

  it("stock roles are current assets, GRNI a current liability, costs cost of sales", () => {
    for (const r of INVENTORY_ROLES) expect(allowedTypesFor(r)).toEqual(["Other Current Asset"]);
    expect(allowedTypesFor("GRNI")).toEqual(["Other Current Liability"]);
    for (const r of ["COGS_FG", "COGS_SURPLUS", "PRODUCTION_VARIANCE", "SCRAP_LOSS", "INVENTORY_ADJUSTMENT", "PURCHASE_PRICE_VARIANCE"] as const) {
      expect(allowedTypesFor(r)).toEqual(["Cost of Goods Sold"]);
    }
    expect(allowedTypesFor("SALES_FG")).toEqual(["Income"]);
  });

  it("refuses an account of the wrong type, a header and an inactive one", () => {
    expect(roleAccountError("RM_INVENTORY", { name: "Stock", type: "Other Current Asset" })).toBeNull();
    // The two mistakes the old item form allowed: stock on a Fixed Asset, COGS on an Expense.
    expect(roleAccountError("RM_INVENTORY", { name: "Plant", type: "Fixed Asset" })).toMatch(/Other Current Asset/);
    expect(roleAccountError("COGS_FG", { name: "Rent", type: "Expense" })).toMatch(/Cost of Goods Sold/);
    expect(roleAccountError("FG_INVENTORY", { name: "Inventories", type: "Other Current Asset", isHeader: true })).toMatch(/header/);
    expect(roleAccountError("GRNI", { name: "Old", type: "Other Current Liability", status: "Inactive" })).toMatch(/inactive/);
    expect(roleAccountError("GRNI", null)).toMatch(/No account/);
  });
});

describe("posting groups", () => {
  it("every stocked kind belongs to exactly one group type; untracked kinds to none", () => {
    for (const k of ITEM_KIND_LIST) {
      const g = groupTypeForKind(k.kind);
      if (k.tracked) expect(GROUP_TYPES).toContain(g);
      else expect(g).toBeNull();
    }
    expect(groupTypeForKind("RawMaterial")).toBe("RM");
    expect(groupTypeForKind("WorkInProgress")).toBe("WIP");
    expect(groupTypeForKind("FinishedProduct")).toBe("FP");
    expect(groupTypeForKind("StockItem")).toBe("TRADING");       // the 4th type
  });

  it("a group type's stock role is a control role, its sales and COGS roles are the right kind", () => {
    for (const t of GROUP_TYPES) {
      const m = GROUP_TYPE_META[t];
      expect(INVENTORY_ROLES).toContain(m.inventoryRole);
      expect(ROLES[m.salesRole].kind).toBe("income");
      expect(ROLES[m.cogsRole].kind).toBe("cost_of_sales");
    }
  });

  it("finished and trading goods sell as goods; raw material and WIP sell as surplus", () => {
    expect(GROUP_TYPE_META.FP.salesRole).toBe("SALES_FG");
    expect(GROUP_TYPE_META.TRADING.cogsRole).toBe("COGS_FG");
    expect(GROUP_TYPE_META.RM.salesRole).toBe("SALES_SURPLUS");
    expect(GROUP_TYPE_META.WIP.cogsRole).toBe("COGS_SURPLUS");
  });

  it("trading goods get their own stock, sales and COGS accounts, and share the rest", () => {
    expect(defaultAccountName("FG_INVENTORY", "TRADING")).toBe(TRADING_DEFAULT_NAMES.FG_INVENTORY);
    expect(defaultAccountName("FG_INVENTORY", "TRADING")).not.toBe(defaultAccountName("FG_INVENTORY", "FP"));
    expect(defaultAccountName("GRNI", "TRADING")).toBe(defaultAccountName("GRNI", "FP"));
  });

  it("an item override stands in for its group type's role", () => {
    expect(roleForOverride("assetAccountId", "RM")).toBe("RM_INVENTORY");
    expect(roleForOverride("assetAccountId", "WIP")).toBe("WIP_STOCK");
    expect(roleForOverride("cogsAccountId", "RM")).toBe("COGS_SURPLUS");
    expect(roleForOverride("incomeAccountId", "FP")).toBe("SALES_FG");
  });

  it("reports every unmapped role — the block's input", () => {
    expect(missingRoles({})).toHaveLength(18);
    const all = Object.fromEntries(ACCOUNT_ROLES.map(r => [r, "a"]));
    expect(missingRoles(all)).toEqual([]);
    expect(missingRoles({ ...all, GRNI: null })).toEqual(["GRNI"]);
  });

  // The reported confusion: a Raw Materials group showed (and required)
  // "Finished goods inventory" — a row nothing reads for a raw material.
  it("a group uses only its own stock, sales and COGS role — never a sibling's", () => {
    for (const t of GROUP_TYPES) {
      const m = GROUP_TYPE_META[t];
      const used = rolesForGroupType(t);
      for (const r of [m.inventoryRole, m.salesRole, m.cogsRole]) expect(used).toContain(r);
      for (const other of GROUP_TYPES) {
        const o = GROUP_TYPE_META[other];
        if (o.inventoryRole !== m.inventoryRole) expect(used).not.toContain(o.inventoryRole);
        if (o.salesRole !== m.salesRole) expect(used).not.toContain(o.salesRole);
      }
    }
    expect(rolesForGroupType("RM")).not.toContain("FG_INVENTORY");
    expect(rolesForGroupType("RM")).not.toContain("WIP_STOCK");
  });

  // Product owner's rule: an account is on a group only if something that
  // happens to that kind of item posts to it.
  it("keeps only the practically applicable accounts per type", () => {
    expect(rolesForGroupType("RM")).toHaveLength(8);
    expect(rolesForGroupType("WIP")).toHaveLength(11);
    expect(rolesForGroupType("FP")).toHaveLength(13);
    expect(rolesForGroupType("TRADING")).toHaveLength(8);
    // Raw material is never produced: no labour, overhead or production results.
    for (const r of ["LABOUR_ABSORBED", "OVERHEAD_ABSORBED", "PRODUCTION_VARIANCE", "SCRAP_LOSS"] as const) {
      expect(rolesForGroupType("RM")).not.toContain(r);
      expect(rolesForGroupType("TRADING")).not.toContain(r);
      expect(rolesForGroupType("FP")).toContain(r);
      expect(rolesForGroupType("WIP")).toContain(r);
    }
    // Semi-finished is never bought.
    expect(rolesForGroupType("WIP")).not.toContain("PURCHASE_PRICE_VARIANCE");
    // Scrap is never stock — its income account lives on the scrap item.
    for (const t of GROUP_TYPES) expect(rolesForGroupType(t)).not.toContain("SCRAP_SALES");
    // Every type can be received and counted.
    for (const t of GROUP_TYPES) for (const r of ["GRNI", "INVENTORY_ADJUSTMENT", "INVENTORY_WRITEDOWN"] as const) expect(rolesForGroupType(t)).toContain(r);
  });

  it("an unmapped sibling role does not block a group", () => {
    const rm = Object.fromEntries(rolesForGroupType("RM").map(r => [r, "a"]));
    expect(missingRoles(rm, "RM")).toEqual([]);
    expect(missingRoles(rm)).toEqual(expect.arrayContaining(["FG_INVENTORY", "WIP_STOCK", "SALES_FG", "COGS_FG"]));
  });

  it("the screen's sections show every role a group uses exactly once, and nothing else", () => {
    for (const t of GROUP_TYPES) {
      const shown = groupRoleSections(t).flatMap(s => s.roles.map(r => r.role));
      expect(new Set(shown).size).toBe(shown.length);
      expect([...shown].sort()).toEqual([...rolesForGroupType(t)].sort());
      expect(groupRoleSections(t)[0].roles.map(r => r.label)).toEqual(["Stock account", "Sales account", "Cost of sales account"]);
    }
  });
});
