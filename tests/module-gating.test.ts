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
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, relative, basename } from "path";
import {
  PAGE_OWNERS, API_OWNERS, moduleForPage, moduleForApi, MODULE_HOME, MODULE_KEYS, APP_PATH_HEADER,
  matches, findRule, type PathRule,
} from "@/lib/modules";

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

// ── Reverse completeness ─────────────────────────────────────────────────────
//
// The tests above only ever check ONE direction: that every registered rule
// names a real path. They never checked the reverse — that every real page
// or API route is accounted for somewhere — which is exactly how /api/production,
// /api/inventory (bar four master-data routes) and /api/resources went
// unregistered for as long as they did: each of those routes already called
// requireModule() itself, so nothing broke at runtime and nobody noticed the
// registry didn't know about them.
//
// A real route counts as accounted for when it is either:
//   1. matched by a PAGE_OWNERS/API_OWNERS rule (owned, or an explicit
//      `owner: null` carve-out), or
//   2. named in the allowlist below, with a reason.
// There is deliberately no third "it calls requireModule so it's fine"
// escape hatch — that leniency is exactly what let #1-3 above go unnoticed,
// and it would let the next one slip through the same way. Enforcement
// self-checks (below) are a separate, additional assertion on OWNED routes,
// not an alternative way to satisfy this completeness check.

type AllowEntry = { path: string; why: string; exact?: boolean };

/** Routes that are genuinely shared / platform-level / out of scope for the
 * per-org module registry — not owned by any single module, and not gated. */
const UNOWNED_API: readonly AllowEntry[] = [
  { path: "/api/accounting/[entity]", why: "generic master-data CRUD (tax rates, currencies, dimensions, …) read by every module" },
  { path: "/api/accounting/posting-groups", why: "Chart-of-Accounts posting-group setup — shared across Accounting and Supply Chain (CLAUDE.md 'Inventory Chart-of-Accounts mapping')" },
  { path: "/api/accounting/stock-vs-gl", why: "stock-vs-GL reconciliation report, read by both Accounting and Supply Chain reports (R-09)" },
  { path: "/api/accounts/seed", why: "one-off dev seeding utility, not org-module scoped" },
  { path: "/api/admin", why: "platform admin portal — gated by platform-admin/super-admin role, not the org module registry" },
  { path: "/api/approvals", why: "generic document-approval inbox spanning entity types across modules (bills, POs, MOs, …)" },
  { path: "/api/approver", why: "public, unauthenticated external-approver token portal" },
  { path: "/api/audit-events", why: "shared audit trail, read by admin and multiple modules" },
  { path: "/api/auth", why: "authentication (NextAuth, MFA, password reset) — pre-org, not module scoped" },
  { path: "/api/backfill-inactive", why: "one-off backfill script" },
  { path: "/api/backfill-payment-status", why: "one-off backfill script" },
  { path: "/api/billing", why: "Stripe org billing — org-level, not a product module" },
  { path: "/api/chat", why: "AI chat assistant — reads/acts across modules (e.g. can send Receivables invoices)" },
  { path: "/api/communications", why: "loaded by the app-wide data provider on every page" },
  { path: "/api/contacts", why: "shared sub-resource of Customers and Projects, both shared entities" },
  { path: "/api/countries", why: "static reference data" },
  { path: "/api/cron", why: "scheduled background jobs, not a user-facing route in any module" },
  { path: "/api/customers", why: "shared master data — Payables/Accounting/Supply Chain all read Receivables' Customers" },
  { path: "/api/debug-auth", why: "debug utility" },
  { path: "/api/documents", why: "shared document posting/read engine — Supply Chain posts through it too (CLAUDE.md)" },
  { path: "/api/email-templates", why: "shared email template library" },
  { path: "/api/email", why: "shared mail composer/inbox sync, not module scoped" },
  { path: "/api/estimates", why: "legacy top-level estimates list, superseded by /accounting/trade/estimates but kept for old links" },
  { path: "/api/gmail", why: "shared mailbox connection (org email settings)" },
  { path: "/api/group", why: "cross-org consolidated rollup for an org group — spans multiple orgs, not one org's module" },
  { path: "/api/guide", why: "in-app help content, not module-specific" },
  { path: "/api/health", why: "health check" },
  { path: "/api/inngest", why: "background job runner's own webhook endpoint" },
  { path: "/api/interest", why: "public marketing 'request access' form, unauthenticated" },
  { path: "/api/invoices", why: "loaded by the app-wide data provider on every page (same carve-out reasoning as /api/customers)" },
  { path: "/api/ledger/journal/[id]", why: "a single journal entry — read by the shared document detail page; only the list is Accounting-owned (see the exact:true carve-out above)" },
  { path: "/api/me", why: "current-user endpoints (escalations, rep), identity not module scoped" },
  { path: "/api/microsoft", why: "shared mailbox connection (org email settings)" },
  { path: "/api/migrate", why: "one-off migration scripts" },
  { path: "/api/mobile", why: "mobile client has no module-awareness yet; gating this would break the app for orgs with a module disabled — tracked separately, do not gate without a client-side companion fix" },
  { path: "/api/numbering", why: "shared document numbering settings" },
  { path: "/api/org", why: "org settings, used from every module" },
  { path: "/api/owner-portal", why: "public, unauthenticated owner-escalation token portal" },
  { path: "/api/parties", why: "shared unified customer/supplier/employee master data" },
  { path: "/api/period-close", why: "shared — Supply Chain posts through it too (CLAUDE.md)" },
  { path: "/api/portal", why: "public, unauthenticated customer token portal" },
  { path: "/api/print", why: "shared generic document PDF printing" },
  { path: "/api/projects", why: "shared master data (customer-grouping entity, CLAUDE.md 'Projects joined the same pattern')" },
  { path: "/api/public", why: "public, unauthenticated widgets (chat)" },
  { path: "/api/qbo", why: "QuickBooks integration/sync — org-wide, not a single product module" },
  { path: "/api/regions", why: "static reference data" },
  { path: "/api/register", why: "public signup flow, pre-org" },
  { path: "/api/reporting", why: "gated by its own organisations.reporting_enabled flag, a separate legacy toggle predating the module registry (CLAUDE.md)" },
  { path: "/api/reports", why: "AR reporting/reconciliation endpoints read by the Dashboard/Reports pages and admin tooling; not yet folded into the module registry" },
  { path: "/api/reps", why: "shared rep hierarchy used across Receivables and admin" },
  { path: "/api/sage", why: "Sage Intacct integration/sync — org-wide, not a single product module" },
  { path: "/api/search", why: "global cross-module search" },
  { path: "/api/seed", why: "one-off dev seeding utility" },
  { path: "/api/settings", why: "shared org settings (approval thresholds)" },
  { path: "/api/sync", why: "generic sync trigger, not module scoped" },
  { path: "/api/tasks", why: "loaded by the app-wide data provider on every page" },
  { path: "/api/trade-documents", why: "shared trade documents (PO/SO/Estimates) used by Payables, Accounting and Supply Chain" },
  { path: "/api/transactions", why: "shared Linked Transactions graph (CLAUDE.md)" },
  { path: "/api/user", why: "shared user/org-switch endpoints" },
  { path: "/api/webhooks", why: "inbound provider webhooks (QBO/Stripe/Xero) — unauthenticated by nature, not module scoped" },
  { path: "/api/xero", why: "Xero integration/sync — org-wide, not a single product module" },
];

const UNOWNED_PAGES: readonly AllowEntry[] = [
  { path: "/accounting/[list]", why: "generic list-page dispatcher (accounts/journal/opening-balances/reconcile are owned concretely at runtime above; other list values like products/tax-rates/locations are shared)" },
  { path: "/accounting/approvals", why: "document-approval inbox spanning entity types across modules" },
  { path: "/accounting/jobwork", why: "shared — linked from Supply Chain and Accounting alike" },
  { path: "/accounting/parties/[type]", why: "legacy generic party list, retired for customers/suppliers (redirected) and still the one screen for employees" },
  { path: "/accounting/posting-groups", why: "Chart-of-Accounts posting-group setup, shared across Accounting and Supply Chain" },
  { path: "/accounting/products", why: "shared Products & Services master data (CLAUDE.md 'shared master data')" },
  { path: "/accounting/reports", why: "the shared reports hub index — its individual reports are owned or allowlisted below", exact: true },
  { path: "/accounting/reports/[statement]", why: "dynamic report dispatcher — trial-balance/profit-loss/balance-sheet are owned concretely at runtime above" },
  { path: "/accounting/reports/awaiting-invoicing", why: "Supply Chain's Fulfilment report, hosted in the shared reports hub" },
  { path: "/accounting/reports/delivery-risk", why: "Supply Chain's order-tracking report, hosted in the shared reports hub" },
  { path: "/accounting/reports/expected-bills", why: "Supply Chain's Purchasing report, hosted in the shared reports hub" },
  { path: "/accounting/reports/jobwork-yield", why: "Supply Chain's job-work report, hosted in the shared reports hub" },
  { path: "/accounting/reports/lot-traceability", why: "Supply Chain's lot/movement audit trail, hosted in the shared reports hub" },
  { path: "/accounting/reports/open-bills", why: "Supply Chain's Purchasing report, hosted in the shared reports hub" },
  { path: "/accounting/reports/open-invoices", why: "Supply Chain's Fulfilment report, hosted in the shared reports hub" },
  { path: "/accounting/reports/open-pos", why: "Supply Chain's Purchasing report, hosted in the shared reports hub" },
  { path: "/accounting/reports/open-sos", why: "Supply Chain's Fulfilment report, hosted in the shared reports hub" },
  { path: "/accounting/reports/stock-status", why: "Supply Chain's Inventory report, hosted in the shared reports hub" },
  { path: "/accounting/reports/stock-valuation", why: "Supply Chain's Inventory report, hosted in the shared reports hub" },
  { path: "/accounting/reports/stock-vs-gl", why: "Supply Chain/Accounting reconciliation report, hosted in the shared reports hub" },
  { path: "/accounting/trade/[kind]", why: "dynamic PO/SO/Estimates list dispatcher — estimates is owned concretely at runtime above, PO/SO stay shared (Supply Chain's documents, hosted under /accounting)" },
  { path: "/accounting/trade/sales-orders/[id]", why: "the Order Production Tracker — Supply Chain's screen, hosted under /accounting (CLAUDE.md)" },
  { path: "/accounting/transactions/[id]", why: "shared document detail page, linked from Supply Chain reports too (CLAUDE.md)" },
  { path: "/admin", why: "platform admin portal — gated by platform-admin/super-admin role, not the org module registry" },
  { path: "/customers", why: "shared master data (CLAUDE.md 'shared master data')" },
  { path: "/estimates", why: "legacy top-level estimates list, superseded by /accounting/trade/estimates but kept for old links" },
  { path: "/group", why: "cross-org consolidated rollup for an org group — spans multiple orgs, not one org's module" },
  { path: "/guide", why: "in-app help, not module-specific" },
  { path: "/projects", why: "shared master data (CLAUDE.md 'Projects joined the same pattern')" },
  { path: "/reporting", why: "gated by its own organisations.reporting_enabled flag, a separate legacy toggle predating the module registry (CLAUDE.md)" },
  { path: "/settings", why: "shared account/org settings, used from every module" },
];

function asRule(a: AllowEntry): PathRule {
  return { path: a.path, owner: null, exact: a.exact };
}

/** Every real *.ts/*.tsx route file under `dir`, as a URL path with dynamic
 * segments (`[id]`, `[type]`, …) and route groups (`(app)`) preserved/dropped
 * the same way Next.js itself treats them. Returns { url, file } pairs so
 * callers can also inspect the file's source. */
function collectRoutes(dir: string, fileNames: readonly string[]): { url: string; file: string }[] {
  const out: { url: string; file: string }[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (fileNames.includes(entry.name)) {
        let rel = relative(dir, full).replace(/\\/g, "/");
        rel = rel.slice(0, -("/" + entry.name).length);
        const segs = rel.split("/").filter((s) => s && !(s.startsWith("(") && s.endsWith(")")));
        out.push({ url: "/" + segs.join("/"), file: full });
      }
    }
  };
  walk(dir);
  return out;
}

const API_DIR = join(ROOT, "app", "api");
const PAGE_DIR = join(ROOT, "app", "(app)");

const apiRouteFiles = collectRoutes(API_DIR, ["route.ts", "route.tsx"]).map((r) => ({ ...r, url: "/api" + r.url }));
const pageRouteFiles = collectRoutes(PAGE_DIR, ["page.tsx", "page.ts"]);

function isAccountedFor(rules: readonly PathRule[], allow: readonly AllowEntry[], pathname: string): boolean {
  if (findRule(rules, pathname)) return true;
  return allow.some((a) => matches(pathname, asRule(a)));
}

describe("reverse completeness — every real route is accounted for", () => {
  it("every real API route is owned, explicitly shared, or allowlisted", () => {
    const uncovered = apiRouteFiles
      .map((r) => r.url)
      .filter((url) => !isAccountedFor(API_OWNERS, UNOWNED_API, url));
    expect(uncovered, uncovered.join("\n")).toEqual([]);
  });

  it("every real page route is owned, explicitly shared, or allowlisted", () => {
    const uncovered = pageRouteFiles
      .map((r) => r.url)
      .filter((url) => !isAccountedFor(PAGE_OWNERS, UNOWNED_PAGES, url));
    expect(uncovered, uncovered.join("\n")).toEqual([]);
  });

  it("every owned API route actually enforces access somewhere in its source", () => {
    // A registered-but-unenforced route would otherwise pass every check above
    // while doing nothing at runtime — this is the defense-in-depth half of
    // the same guarantee: registered AND wired, not just registered.
    //
    // requireReadScope() qualifies because it calls requireOrg() as its very
    // first line (lib/api.ts) — it's requireOrg with an extra group-read
    // widening on top, not a different gate. verifyOAuthState() qualifies for
    // the same reason requireOrg does: it proves the request is tied to a
    // specific, already-authorised org (lib/oauth-state.ts's tamper-proof
    // signed state) for the one shape of route that must stay reachable by an
    // unauthenticated browser redirect (an OAuth provider's callback) and so
    // cannot call requireOrg() itself.
    const ENFORCES = /requireOrg\(|requireModule\(|requireReadScope\(|verifyOAuthState\(/;
    const unenforced = apiRouteFiles
      .filter((r) => {
        const rule = findRule(API_OWNERS, r.url);
        return rule !== null && rule.owner !== null;
      })
      .filter((r) => !ENFORCES.test(readFileSync(r.file, "utf8")))
      .map((r) => r.url);
    expect(unenforced, unenforced.join("\n")).toEqual([]);
  });

  it("no allowlist entry may be an ancestor of an owned rule's path", () => {
    // A broad allowlist entry (e.g. /api/mobile) must never be able to shadow
    // a MORE SPECIFIC path that is (now, or later) registered as owned — e.g.
    // if /api/mobile/receivables were ever added to API_OWNERS, a bare
    // /api/mobile allowlist entry must not still appear to cover it.
    const tables = [
      ["API_OWNERS/UNOWNED_API", API_OWNERS, UNOWNED_API],
      ["PAGE_OWNERS/UNOWNED_PAGES", PAGE_OWNERS, UNOWNED_PAGES],
    ] as const;
    for (const [name, rules, allow] of tables) {
      for (const a of allow) {
        for (const r of rules) {
          if (r.owner === null) continue;
          const swallowed = matches(r.path, asRule(a));
          expect(swallowed, `${name}: allowlist "${a.path}" is an ancestor of owned rule "${r.path}"`).toBe(false);
        }
      }
    }
  });

  it("has no stale allowlist entries", () => {
    // Every entry must still match a real route, or it's dead documentation
    // that could hide a future gap behind a name that no longer means anything.
    const tables = [
      ["UNOWNED_API", UNOWNED_API, apiRouteFiles.map((r) => r.url)],
      ["UNOWNED_PAGES", UNOWNED_PAGES, pageRouteFiles.map((r) => r.url)],
    ] as const;
    for (const [name, allow, urls] of tables) {
      for (const a of allow) {
        const hit = urls.some((u) => matches(u, asRule(a)));
        expect(hit, `${name}: "${a.path}" matches no real route`).toBe(true);
      }
    }
  });
});
