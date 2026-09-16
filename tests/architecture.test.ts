/**
 * Boundaries that are decisions, not preferences.
 *
 * Each rule here was settled deliberately and is the kind that erodes by
 * accident — one import added to fix something quickly, and the decision is
 * quietly reversed with nobody noticing. A grep in a test is cheap; discovering
 * it in a client's books is not.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, resolve, relative } from "path";

const ROOT = resolve(__dirname, "..");

/** Every .ts/.tsx file under a directory, skipping build output. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let entries: string[];
    try { entries = readdirSync(d); } catch { return; }
    for (const e of entries) {
      if (e === "node_modules" || e === ".next" || e === "dist") continue;
      const full = join(d, e);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e)) out.push(full);
    }
  };
  walk(join(ROOT, dir));
  return out;
}

const importers = (dir: string, needle: string) =>
  sourceFiles(dir)
    .filter(f => {
      const src = readFileSync(f, "utf8");
      // Real import statements only, not prose in a comment. All three forms
      // must be covered: the CLI uses `await import(...)` deliberately, so that
      // env vars load before @/db reads DATABASE_URL — matching only static
      // `from` imports would have reported the scripts as clean and made this
      // whole guard useless.
      return new RegExp(
        `(from\\s+["'][^"']*${needle}|require\\(\\s*["'][^"']*${needle}|import\\(\\s*["'][^"']*${needle})`,
      ).test(src);
    })
    .map(f => relative(ROOT, f).replace(/\\/g, "/"));

describe("QuickBooks' own reports never serve a product report", () => {
  /**
   * Settled 2026-09-14: a Trial Balance we show anyone must come from our own
   * journal_lines. QBO's TrialBalance report is used in exactly one place —
   * lib/accounting/qbo-gl-verify.ts — to prove the ingested ledger matches
   * their books before anything reads from it. It is a test fixture reached
   * only from the CLI, never a product dependency.
   *
   * The moment a route imports it, "our native accounting" becomes a
   * QuickBooks passthrough again, which is the entire thing this work exists
   * to undo.
   */
  it("no route, page or component imports the GL verifier", () => {
    expect(importers("app", "qbo-gl-verify")).toEqual([]);
    expect(importers("components", "qbo-gl-verify")).toEqual([]);
    expect(importers("inngest", "qbo-gl-verify")).toEqual([]);
  });

  it("the verifier is reachable only from scripts/", () => {
    // If this ever finds a second caller, the boundary above is already gone.
    expect(importers("scripts", "qbo-gl-verify")).toEqual(["scripts/qbo-gl-ingest.ts"]);
  });

  it("the native financials engine never calls QuickBooks", () => {
    // trialBalance/profitAndLoss/balanceSheet must be computable with no
    // network at all — that is what makes them OURS rather than a proxy.
    const src = readFileSync(join(ROOT, "lib/accounting/financials.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["'][^"']*qbo/i);
    expect(src).not.toMatch(/quickbooks\.api\.intuit\.com/);
  });
});

describe("the GL ingestion stays out of the live sync until it is proven", () => {
  /**
   * The ingestion posts into a paying client's ledger. Until the trial
   * balances reconcile, it must run only when a human runs it — not on a cron,
   * not from a webhook, not as part of the nightly sync.
   *
   * When that gate is passed this test is the thing to update, deliberately,
   * in the same commit that wires it up.
   */
  it("is called only from the CLI", () => {
    for (const dir of ["app", "components", "inngest"]) {
      expect(importers(dir, "accounting/qbo-ingest")).toEqual([]);
    }
    expect(importers("scripts", "accounting/qbo-ingest")).toEqual(["scripts/qbo-gl-ingest.ts"]);
  });
});

describe("client bundles never reach server-only modules", () => {
  /**
   * lib/modules-server.ts imports `db`. CLAUDE.md records why this matters:
   * importing it from a client component bundles server code — and its
   * credentials — into the browser.
   */
  it("no component imports modules-server", () => {
    expect(importers("components", "modules-server")).toEqual([]);
  });
});

describe("no GROUP BY on a view-backed table", () => {
  /**
   * `customers` and `ap_suppliers` are VIEWS over `parties` (migration 0079).
   * A view has no primary key, so Postgres cannot treat other selected columns
   * as functionally dependent on a grouped one — `GROUP BY x.id` while
   * selecting x.org_id, x.name, … fails outright with
   *   column "x.org_id" must appear in the GROUP BY clause
   * which surfaces as a 500 on the page, not a type error.
   *
   * That is exactly how the Payables → Suppliers list broke. Aggregate in a
   * subquery and join it instead.
   */
  const VIEW_BACKED = ["apSuppliers", "customers"];

  it("never groups directly by a view's column", () => {
    const offenders: string[] = [];
    for (const dir of ["app", "lib"]) {
      for (const f of sourceFiles(dir)) {
        // Strip whitespace rather than build a regex: the pattern is full of
        // characters that need escaping, and an escaping slip makes the guard
        // silently match nothing — which is worse than no guard at all.
        const flat = readFileSync(f, "utf8").replace(/\s+/g, "");
        for (const v of VIEW_BACKED) {
          if (flat.includes(`.groupBy(${v}.`)) {
            offenders.push(`${relative(ROOT, f).replace(/\\/g, "/")} groups by ${v}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
