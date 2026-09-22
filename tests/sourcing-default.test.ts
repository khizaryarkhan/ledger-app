/**
 * The sourcing policy a NEW item starts with (defaultSourcingPolicy).
 *
 * Migration 0089 set existing Service / Non-Inventory items to `open` and left
 * stock kinds `restricted`, but new items took the column default —
 * `restricted` for every kind — so the first Bill for a Service created after
 * 0089 was refused for want of a supplier link nobody should need.
 */

import { describe, it, expect } from "vitest";
import { defaultSourcingPolicy, sourcingViolations } from "@/lib/inventory/sourcing";
import { ITEM_KIND_LIST } from "@/lib/inventory/item-kinds";

describe("defaultSourcingPolicy", () => {
  it("restricts every stock kind and opens every non-stock kind", () => {
    for (const k of ITEM_KIND_LIST) {
      expect(defaultSourcingPolicy(k.kind), k.kind).toBe(k.tracked ? "restricted" : "open");
    }
  });

  it("means a new Service item can be bought from a supplier it is not linked to", () => {
    const item = { id: "svc", name: "Consulting", productType: "Service", sourcingPolicy: defaultSourcingPolicy("Service") };
    const v = sourcingViolations([{ itemId: "svc" }], new Map([["svc", item]]), new Set(), "Acme Ltd");
    expect(v).toEqual([]);
  });
});
