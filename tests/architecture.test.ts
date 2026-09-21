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

describe("money is never declared as a float", () => {
  /**
   * PostgreSQL `real` is a 4-byte IEEE-754 float, ~7 significant digits, and
   * `pg_typeof(sum(real))` is `real` — so aggregates accumulate in single
   * precision too. Measured against live data: about half of all stored money
   * values in the provider mirror are not exact cent figures, and a SQL sum of
   * one org's AR is off by ~€0.20.
   *
   * The native ledger is already correct (`journal_lines` is numeric(14,2)).
   * 51 mirror columns are not, and converting them is a scheduled migration.
   * This guard exists so the problem cannot GROW while that is pending: a new
   * money column declared `real()` fails the build.
   *
   * Target type is numeric(14,2), matching journal_lines — not integer minor
   * units. Both are correct; a mixed model would be worse than either.
   */
  const MONEY_WORDS = /(amount|balance|total|price|cost|rate|paid|subtotal|value|credit_limit|unit_)/i;

  it("no new schema column combines a money-ish name with real()", () => {
    const src = readFileSync(join(ROOT, "db/schema.ts"), "utf8");
    const offenders: string[] = [];
    src.split("\n").forEach((line, i) => {
      if (!/\breal\(/.test(line)) return;
      if (!MONEY_WORDS.test(line)) return;
      offenders.push(`db/schema.ts:${i + 1}  ${line.trim().slice(0, 90)}`);
    });
    // The 51 pre-existing columns are recorded in INTEGRITY_AUDIT.md and are
    // migrating. This asserts the count does not grow past what was audited.
    expect(offenders.length).toBeLessThanOrEqual(51);
  });

  it("the native ledger itself never uses real()", () => {
    // journal_lines/journal_entries are the book of record. If one of these
    // ever becomes a float, the GL stops being exact and every reconciliation
    // built on it becomes meaningless.
    const src = readFileSync(join(ROOT, "db/schema.ts"), "utf8");
    const block = src.slice(
      src.indexOf("export const journalLines = pgTable"),
      src.indexOf("export const journalLines = pgTable") + 3000,
    );
    expect(block).not.toMatch(/\breal\(/);
    expect(block).toMatch(/numeric\(/);
  });
});

describe("a calendar date is never rendered through a timezone", () => {
  /**
   * `new Date("2026-09-15")` is UTC midnight, so rendering it with local
   * getters shows the 14th anywhere west of Greenwich. That is the bug a
   * client reported against a QBO invoice: QuickBooks said 15 Sep, we said
   * 14 Sep, and the stored varchar said "2026-09-15" all along.
   *
   * `+ "T00:00:00Z"` is the tempting non-fix — it names the same instant and
   * still renders locally. Three components carried it and were wrong in
   * exactly the same way, which is why it is worth a guard of its own: it
   * looks like the fix.
   *
   * Use fmt.date / formatDateShort / formatDate, which never build a Date for
   * a date-only string.
   */
  it("nothing pins a date string to UTC midnight and then formats it locally", () => {
    const offenders: string[] = [];
    for (const dir of ["app", "components", "lib"]) {
      for (const f of sourceFiles(dir)) {
        const flat = readFileSync(f, "utf8").replace(/\s+/g, "");
        if (flat.includes('+"T00:00:00Z").toLocale') || flat.includes('+"T00:00:00").toLocale')) {
          offenders.push(relative(ROOT, f));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the shared formatters do not parse a date-only string into a Date", () => {
    // If dateParts ever loses its string branch, every surface silently goes
    // back to being a day early for anyone west of Greenwich.
    const src = readFileSync(join(ROOT, "lib/format.ts"), "utf8");
    expect(src).toMatch(/const DATE_ONLY =/);
    expect(src).toMatch(/function dateParts/);
    // formatDate must go through dateParts, not straight to new Date().
    const body = src.slice(src.indexOf("export function formatDate"), src.indexOf("export function formatDateShort"));
    expect(body).toMatch(/dateParts\(/);
    expect(body).not.toMatch(/new Date\(/);
  });
});

describe("Google site verification stays reachable", () => {
  /**
   * Google says, on the verification screen itself: "To stay verified, don't
   * remove the file, even after verification succeeds." Losing it un-verifies
   * the domain, which un-blocks nothing and silently re-breaks the OAuth
   * consent-screen review.
   *
   * Two ways to lose it, and this covers both: deleting the file, and letting
   * middleware swallow the request. The second is the sneaky one — the file is
   * still on disk and looks fine, but an anonymous fetch gets redirected to
   * /login, so Google reads a login page where the token should be.
   */
  const VERIFY_FILES = readdirSync(join(ROOT, "public")).filter(f => /^google[0-9a-f]+\.html$/.test(f));

  it("the verification file is still present", () => {
    expect(VERIFY_FILES.length).toBeGreaterThan(0);
  });

  it("each file contains its own name as the token", () => {
    for (const f of VERIFY_FILES) {
      const body = readFileSync(join(ROOT, "public", f), "utf8").trim();
      expect(body).toBe(`google-site-verification: ${f}`);
    }
  });

  it("middleware serves them raw instead of redirecting to /login", () => {
    const src = readFileSync(join(ROOT, "middleware.ts"), "utf8");
    const m = /matcher:\s*\[\s*"([^"]+)"/.exec(src);
    expect(m, "could not find the middleware matcher").toBeTruthy();
    // Build the real matcher and run the real filenames through it.
    const re = new RegExp(`^${m![1].replace(/\\/g, "\\")}$`);
    for (const f of VERIFY_FILES) {
      expect(re.test(`/${f}`), `${f} is not exempt from middleware`).toBe(false);
    }
    // And the exemption must not have opened up the authed app by accident.
    expect(re.test("/dashboard")).toBe(true);
    expect(re.test("/")).toBe(true);
  });
});

describe("stock placement is only ever written through one choke point", () => {
  /**
   * `inventory_lot_locations` says where every unit of stock physically is, and
   * `lib/inventory/locations.ts` is the only module allowed to write it —
   * through placeQty() and takeQty(), which are single atomic statements
   * (neon-http has no transactions, so a read-modify-write here would lose
   * quantity under concurrency).
   *
   * That file is also where the TENANCY check lives: resolveLocationId() is
   * what proves a client-supplied location id belongs to the caller's org. A
   * direct insert somewhere else skips both guarantees at once — it could place
   * one tenant's stock in another tenant's warehouse, and nothing in the type
   * system would notice.
   *
   * Reads are fine from anywhere; this only guards mutation.
   */
  const MUTATION = /\b(insert|update|delete)\s*\([^)]*inventoryLotLocations|inventoryLotLocations[^\n]*\.\s*(set|values)\s*\(/;
  const RAW_SQL_MUTATION = /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+inventory_lot_locations/i;

  const ALLOWED = ["lib/inventory/locations.ts"];

  it("no module other than lib/inventory/locations.ts mutates the table", () => {
    const offenders: string[] = [];
    for (const dir of ["lib", "app", "components", "inngest", "scripts"]) {
      for (const f of sourceFiles(dir)) {
        const rel = relative(ROOT, f).replace(/\\/g, "/");
        if (ALLOWED.includes(rel)) continue;
        const src = readFileSync(f, "utf8");
        if (MUTATION.test(src) || RAW_SQL_MUTATION.test(src)) offenders.push(rel);
      }
    }
    expect(
      offenders,
      `these write stock placement directly instead of using placeQty/takeQty in lib/inventory/locations.ts: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("the choke point itself still exists and is what the rule points at", () => {
    const src = readFileSync(join(ROOT, "lib/inventory/locations.ts"), "utf8");
    expect(src).toMatch(/export async function placeQty/);
    expect(src).toMatch(/export async function takeQty/);
    expect(src).toMatch(/export async function resolveLocationId/);
  });

  it("every stock-moving module resolves its location instead of trusting the caller", () => {
    // A path that writes a lot or a movement but never calls resolveLocationId
    // is one that took a location id straight from a request body.
    const MOVERS = [
      "lib/inventory/valuation.ts",
      "lib/inventory/receiving.ts",
      "lib/inventory/shipping.ts",
      "lib/inventory/production.ts",
      "lib/inventory/jobwork.ts",
      "lib/inventory/transfers.ts",
      "lib/accounting/documents.ts",
    ];
    for (const rel of MOVERS) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src, `${rel} moves stock but never resolves a location`).toMatch(/resolveLocationId/);
    }
  });
});
