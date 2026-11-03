// An invoice deleted in QuickBooks/Xero is soft-deleted (`deleted_at`) and its
// last open balance is left on the row (lib/qbo-sync.ts). Every surface that
// totals receivables must therefore filter `deleted_at` itself — the Board and
// invoice list did, the reports did not, so ACC's dashboard carried 152 deleted
// invoices ($93,981) and EDC's €13,902 that nobody owed.
//
// A source guard, like tests/architecture.test.ts: each listed file must read
// invoices only with the filter. Adding a new AR surface? Add it here.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

const AR_SURFACES = [
  "app/api/reports/ar-snapshot/route.ts",
  "lib/ar-aging.ts",
  "app/api/reports/executive-overview/route.ts",
  "app/api/reports/reconcile/route.ts",
  "app/api/invoices/route.ts",
];

describe("receivables never count invoices deleted in QuickBooks/Xero", () => {
  it.each(AR_SURFACES)("%s filters deleted_at on every invoices query", (f) => {
    const src = read(f);
    // Every `.from(invoices)` must be followed, within its statement, by isNull(invoices.deletedAt).
    const queries = src.split(/\.from\(invoices\)/).slice(1);
    expect(queries.length, `${f} reads invoices`).toBeGreaterThan(0);
    queries.forEach((rest, i) => {
      const stmt = rest.slice(0, rest.search(/;\s*\n/) + 1 || 400);
      expect(stmt, `${f}: invoices query #${i + 1} has no deleted_at filter`).toMatch(/isNull\(invoices\.deletedAt\)/);
    });
  });

  it("the QuickBooks count check compares only live, mirrored rows", () => {
    const src = read("app/api/qbo/verify/route.ts");
    expect(src).toMatch(/liveMirrored = and\(eq\(invoices\.orgId, orgId!\), isNull\(invoices\.deletedAt\), isNotNull\(invoices\.qboId\)\)/);
    expect(src).not.toMatch(/from\(invoices\)\.where\(and\(eq\(invoices\.orgId, orgId!\), eq\(invoices\.txnType/);
  });

  it("an incremental sync logs a full QuickBooks AR total, not just the day's changes", () => {
    const src = read("lib/qbo-sync.ts");
    const step = src.slice(src.indexOf("STEP 9"), src.indexOf("STEP 10"));
    expect(step).toMatch(/if \(isIncremental\) \{\s*results\.qboTotalAR = currentInvoices/);
  });
});
