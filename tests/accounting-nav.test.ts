import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// The Accounting sidebar links to screens that live under other modules'
// URLs (Invoices, Bills, Shipping, Goods Receipts, Customers, ...). Landing on
// such a URL must NOT snap the sidebar into the module that owns it — that bug
// has now bitten Customers, Stock Status and Products & Services. Every
// Accounting nav link outside /accounting therefore has to be named in
// sidebar.tsx's `isSharedEntity` carve-out.

const src = readFileSync(join(process.cwd(), "components/sidebar.tsx"), "utf8");
const between = (from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to));

const navBlock = between("const accountingSections", "const batchSections");
const sharedBlock = between("const isSharedEntity", "const pathDepartment");
const hrefs = [...navBlock.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);

describe("Accounting sidebar", () => {
  it("found its links", () => {
    expect(hrefs.length).toBeGreaterThan(10);
  });

  it("every link to another module's URL is carved out of department switching", () => {
    const unguarded = hrefs
      .filter((h) => !h.startsWith("/accounting"))
      .filter((h) => !sharedBlock.includes(`"${h}"`));
    expect(unguarded).toEqual([]);
  });

  it("leads with the Dashboard, ahead of every group", () => {
    expect(navBlock.indexOf('"/accounting/dashboard"')).toBeGreaterThan(-1);
    expect(navBlock.indexOf('"/accounting/dashboard"')).toBeLessThan(navBlock.indexOf('label: "Sales"'));
  });

  it("groups are Sales, Purchases, Others, Setup — the old Ledger group is gone", () => {
    const order = ["Sales", "Purchases", "Others", "Setup"].map((l) => navBlock.indexOf(`label: "${l}"`));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(navBlock).not.toContain('label: "Ledger"');
  });
});
