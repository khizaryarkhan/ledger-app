/**
 * Module gating — which module owns a page or an API route (lib/modules.ts).
 *
 * The bug this pins: the admin portal's module checkboxes were honoured only
 * for manufacturing and resources. The four "core" modules were drawn
 * unconditionally and none of their routes checked anything, so a test org
 * with only Receivables + Payables ticked still had Accounting and Studio in
 * its switcher and every one of their endpoints answering.
 *
 * The rule tables are the whole policy — sidebar, page guard and requireOrg
 * all read them — so what matters is that they (a) gate what is exclusively
 * a module's, (b) never gate what another module borrows, and (c) name paths
 * that actually exist. A typo'd rule silently gates nothing.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { PAGE_OWNERS, API_OWNERS, moduleForPage, moduleForApi, MODULE_HOME, MODULE_KEYS, APP_PATH_HEADER } from "@/lib/modules";

const ROOT = join(__dirname, "..");

describe("moduleForPage", () => {
  it("gates each core module's own screens", () => {
    expect(moduleForPage("/dashboard")).toBe("receivables");
    expect(moduleForPage("/board")).toBe("receivables");
    expect(moduleForPage("/invoices/abc")).toBe("receivables");
    expect(moduleForPage("/payables/bills")).toBe("payables");
    expect(moduleForPage("/payables/purchase-orders/1")).toBe("payables");
    expect(moduleForPage("/batch")).toBe("studio");
    expect(moduleForPage("/batch/upload")).toBe("studio");
    expect(moduleForPage("/accounting")).toBe("accounting");
    expect(moduleForPage("/accounting/dashboard")).toBe("accounting");
    expect(moduleForPage("/accounting/journal")).toBe("accounting");
    expect(moduleForPage("/accounting/new/Invoice")).toBe("accounting");
    expect(moduleForPage("/accounting/reports/trial-balance")).toBe("accounting");
  });

  it("never gates what another module borrows", () => {
    // Shared master data and the Supply Chain screens hosted under /accounting.
    for (const p of [
      "/customers", "/customers/1", "/projects", "/payables/suppliers", "/payables/suppliers/9",
      "/batch/history",                                // Receivables' Email History
      "/accounting/products", "/accounting/tax-rates", "/accounting/locations",
      "/accounting/trade/purchase-orders", "/accounting/trade/sales-orders/5",
      "/accounting/new/PurchaseOrder", "/accounting/new/SalesOrder",
      "/accounting/reports", "/accounting/reports/stock-status", "/accounting/reports/lot-traceability",
      "/accounting/transactions/abc",                  // document detail, linked from Supply Chain reports
      "/accounting/jobwork", "/settings", "/settings/accounting/journal", "/guide",
    ]) expect(moduleForPage(p), p).toBeNull();
  });

  it("matches on a path segment, not a string prefix", () => {
    // "/boards" is not "/board"; "/accounting-x" is not "/accounting".
    expect(moduleForPage("/boards")).toBeNull();
    expect(moduleForPage("/accounting/dashboards")).toBeNull();
    expect(moduleForPage("/accounting/x")).toBeNull();   // /accounting is exact
  });
});

describe("moduleForApi", () => {
  it("gates each core module's own routes", () => {
    expect(moduleForApi("/api/batch/upload/start")).toBe("studio");
    expect(moduleForApi("/api/google-sheets/connect")).toBe("studio");
    expect(moduleForApi("/api/payables/bills")).toBe("payables");
    expect(moduleForApi("/api/ledger/journal")).toBe("accounting");
    expect(moduleForApi("/api/ledger/trial-balance")).toBe("accounting");
    expect(moduleForApi("/api/financials")).toBe("accounting");
    expect(moduleForApi("/api/accounting/opening-balances")).toBe("accounting");
    expect(moduleForApi("/api/board")).toBe("receivables");
  });

  it("never gates the routes other modules call", () => {
    for (const p of [
      "/api/batch/jobs", "/api/batch/jobs/1/run-chunk-now",   // Receivables' bulk invoice send
      "/api/payables/suppliers", "/api/payables/suppliers/3", // Accounting's purchases + GL reports
      "/api/ledger/journal/abc", "/api/ledger/journal/abc/reverse", // the shared document page
      "/api/accounting/items", "/api/accounting/tax-rates", "/api/accounting/currencies",
      "/api/accounting/posting-groups", "/api/documents/Bill", "/api/transactions/links",
      "/api/period-close", "/api/org/settings",
      "/api/customers", "/api/invoices", "/api/communications", "/api/tasks", "/api/reps", // app-wide data provider
    ]) expect(moduleForApi(p), p).toBeNull();
  });
});

describe("the rule tables", () => {
  const tables = [["PAGE_OWNERS", PAGE_OWNERS], ["API_OWNERS", API_OWNERS]] as const;

  it("list every shared carve-out ABOVE the owned rule it carves out of", () => {
    // First match wins. A carve-out below its prefix would never be reached,
    // and the shared route would be gated after all.
    for (const [name, rules] of tables) {
      rules.forEach((r, i) => {
        if (r.owner !== null) return;
        const shadow = rules.findIndex((o) => o.owner !== null && !o.exact && r.path.startsWith(o.path + "/"));
        if (shadow !== -1) expect(shadow, `${name}: ${r.path} is below ${rules[shadow].path}`).toBeGreaterThan(i);
      });
    }
  });

  it("name paths that exist", () => {
    const pageDir = (p: string) => {
      // /accounting/new/PurchaseOrder is a value of the [type] segment, not a folder.
      const parts = p.split("/").filter(Boolean);
      let dir = join(ROOT, "app/(app)");
      for (const seg of parts) {
        if (existsSync(join(dir, seg))) { dir = join(dir, seg); continue; }
        const dyn = ["[type]", "[kind]", "[list]", "[statement]", "[id]"].find((d) => existsSync(join(dir, d)));
        if (!dyn) return false;
        dir = join(dir, dyn);
      }
      return true;
    };
    for (const r of PAGE_OWNERS) expect(pageDir(r.path), `page ${r.path}`).toBe(true);
    for (const r of API_OWNERS) expect(existsSync(join(ROOT, "app", r.path)), `api ${r.path}`).toBe(true);
  });

  it("give every module a landing page", () => {
    for (const k of MODULE_KEYS) expect(MODULE_HOME[k], k).toMatch(/^\//);
  });
});

describe("enforcement is wired end to end", () => {
  it("middleware stamps the real path and requireOrg reads it", () => {
    // If either half goes, API_OWNERS is decoration: the check would silently
    // see no path and let every request through.
    const mw = readFileSync(join(ROOT, "middleware.ts"), "utf8");
    expect(mw).toMatch(/headers\.set\(APP_PATH_HEADER,\s*path\)/);
    const api = readFileSync(join(ROOT, "lib/api.ts"), "utf8");
    expect(api).toMatch(/headers\(\)\.get\(APP_PATH_HEADER\)/);
    expect(api).toMatch(/moduleForApi\(/);
    expect(APP_PATH_HEADER).toBe("x-app-path");
  });

  it("the app shell renders the page guard", () => {
    const layout = readFileSync(join(ROOT, "app/(app)/layout.tsx"), "utf8");
    expect(layout).toMatch(/<ModuleGate>\{children\}<\/ModuleGate>/);
  });
});
