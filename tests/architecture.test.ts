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

  /**
   * lib/inventory/sourcing-server.ts is the same split for the sourcing policy:
   * it imports `db`, while lib/inventory/sourcing.ts holds the pure rule and IS
   * imported by client components (the Products register, the document form).
   * Collapsing the two would pull the database — and its credentials — into the
   * browser bundle the moment either is imported there.
   */
  it("no component imports sourcing-server", () => {
    expect(importers("components", "sourcing-server")).toEqual([]);
  });

  it("the pure sourcing rule stays free of the database", () => {
    const src = readFileSync(join(ROOT, "lib/inventory/sourcing.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["']@\/db/);
    expect(src).not.toMatch(/from\s+["']drizzle-orm/);
  });
});

describe("a purchase cannot be posted without its sourcing decision", () => {
  /**
   * The policy is enforced where a document becomes a fact in the ledger, not
   * in the form. The form's narrowed picker is help; it can be bypassed by a
   * direct API call, the mobile client, or its own "Show all items" escape.
   *
   * Both writers must check. A Bill carrying a tracked item posts Dr Inventory
   * and creates FIFO lots with no Purchase Order anywhere (CLAUDE.md: every
   * procure-to-pay step is bypassable), so a rule that only bound the PO path
   * would be advisory — the first person in a hurry posts a Bill instead.
   */
  const callsSourcing = (file: string) =>
    /sourcingErrorMessage\s*\(/.test(readFileSync(join(ROOT, file), "utf8"));

  it("postDocument checks it — that is the Bill and Expense path", () => {
    expect(callsSourcing("lib/accounting/documents.ts")).toBe(true);
  });

  it("createTradeDoc checks it — that is the Purchase Order path", () => {
    expect(callsSourcing("lib/accounting/trade-documents.ts")).toBe(true);
  });

  it("the check runs before any line is built, not after", () => {
    // Ordering is the point: postDocument writes nothing until it returns, but
    // a check placed after the inventory plan would already have read lots and
    // resolved locations for a document that must not exist.
    // Measured from inside postDocument, so the helpers' own definitions
    // earlier in the file cannot be mistaken for their call sites.
    const src = readFileSync(join(ROOT, "lib/accounting/documents.ts"), "utf8");
    const body = src.slice(src.indexOf("export async function postDocument"));
    const check = body.indexOf("sourcingErrorMessage(");
    const build = body.indexOf("buildSalesPurchaseLines(");
    expect(check).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(-1);
    expect(check).toBeLessThan(build);
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

describe("every migration chunk is exactly one SQL command", () => {
  /**
   * neon-http sends each `--> statement-breakpoint` chunk as its own PREPARED
   * statement, and Postgres refuses more than one command in one of those:
   *   NeonDbError: cannot insert multiple commands into a prepared statement
   *
   * This is not a style rule. It failed a production deploy: two blocks were
   * appended to 0087 without a breakpoint between them, every test passed, tsc
   * was clean, and the build died at `npm run db:migrate` — after the code had
   * already been pushed to main. Nothing else in the suite can see it, because
   * nothing else reads the .sql files.
   *
   * 0017 and 0018 predate this guard and are already applied in production.
   * Rewriting an applied migration changes nothing in the database and risks
   * breaking a from-scratch migrate, so they are grandfathered by name rather
   * than "fixed".
   */
  const GRANDFATHERED = new Set([
    "db/migrations/0017_communications_message_id.sql",
    "db/migrations/0018_invoice_escalation.sql",
  ]);

  /** Top-level commands in a chunk, treating $$...$$ bodies as opaque. */
  function commandsIn(chunk: string): string[] {
    const withoutComments = chunk
      .split("\n")
      .filter(l => !l.trim().startsWith("--"))
      .join("\n");
    // A DO $$ ... $$ block is ONE command however many semicolons it contains.
    const opaque = withoutComments.replace(/\$\$[\s\S]*?\$\$/g, "$$BLOCK$$");
    return opaque.split(";").map(c => c.trim()).filter(Boolean);
  }

  it("no chunk contains two or more commands", () => {
    const dir = join(ROOT, "db/migrations");
    const files = readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
    expect(files.length, "no migrations found — is the path right?").toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const f of files) {
      const rel = `db/migrations/${f}`;
      if (GRANDFATHERED.has(rel)) continue;
      const sql = readFileSync(join(dir, f), "utf8");
      sql.split("--> statement-breakpoint").forEach((chunk, i) => {
        const cmds = commandsIn(chunk);
        if (cmds.length > 1) {
          offenders.push(`${rel} chunk #${i} has ${cmds.length} commands (first: ${cmds[0].slice(0, 60)}…)`);
        }
      });
    }
    expect(
      offenders,
      `neon-http cannot run these — add a "--> statement-breakpoint" between them:
${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("the journal's `when` values strictly increase", () => {
    /**
     * Drizzle SKIPS an entry whose `when` is not greater than the previous one,
     * silently and without error. CLAUDE.md records that this dropped a table in
     * production once.
     *
     * 0016 and 0017 are that incident, still visible in the data: both `when`
     * values predate 0015's — which is precisely why the repair migration is
     * called `0085_heal_skipped_0016_0017`. It is NOT corrected here — the entries are long applied, and
     * rewriting an applied `when` would re-order history for any fresh database
     * while changing nothing in the existing one.
     */
    const KNOWN_INVERSIONS = new Set(["0016_contacts_updated_at", "0017_communications_message_id"]);

    const journal = JSON.parse(readFileSync(join(ROOT, "db/migrations/meta/_journal.json"), "utf8"));
    const entries: { when: number; tag: string }[] = journal.entries ?? [];
    expect(entries.length).toBeGreaterThan(0);

    for (let i = 1; i < entries.length; i++) {
      if (KNOWN_INVERSIONS.has(entries[i].tag)) continue;
      // Compare against the highest `when` seen so far rather than the previous
      // entry, so the one grandfathered dip cannot mask a NEW one after it.
      const ceiling = Math.max(...entries.slice(0, i).map(e => e.when));
      expect(
        entries[i].when,
        `${entries[i].tag} has when=${entries[i].when}, not greater than every earlier entry (max ${ceiling}) — drizzle will skip it`,
      ).toBeGreaterThan(ceiling);
    }
  });

  it("every journal entry has a file, and every file an entry", () => {
    /**
     * A .sql file the journal never names simply does not run. 0018 is exactly
     * that: its columns are in db/schema.ts and the app writes them, so they
     * were applied by hand or by `drizzle-kit push` — the migration-drift class
     * CLAUDE.md documents.
     *
     * It is deliberately NOT added to the journal. Its statements are bare
     * `ADD COLUMN` with no IF NOT EXISTS, so running them against a database
     * that already has those columns would fail — and because migrations run in
     * `vercel-build`, that would break every future deploy, not just one.
     */
    const ORPHANED_BY_HISTORY = new Set(["0018_invoice_escalation"]);

    const journal = JSON.parse(readFileSync(join(ROOT, "db/migrations/meta/_journal.json"), "utf8"));
    const tags: string[] = (journal.entries ?? []).map((e: any) => e.tag);
    const files = readdirSync(join(ROOT, "db/migrations"))
      .filter(f => f.endsWith(".sql"))
      .map(f => f.replace(/\.sql$/, ""));

    for (const t of tags) expect(files, `journal names ${t} but no such .sql file exists`).toContain(t);
    for (const f of files) {
      if (ORPHANED_BY_HISTORY.has(f)) continue;
      expect(tags, `${f}.sql exists but the journal never runs it`).toContain(f);
    }
  });
});

describe("the app stays on one type scale", () => {
  /**
   * The customer portal (app/portal/[token]) is the most finished-looking
   * surface in the product. Its scale is 10 / 11 / 12 / 13 / 15 / 18 / 20px
   * with 13px as body, and form-kit's `t` tokens encode exactly that.
   *
   * The reason screens used to look unfinished beside each other was never a
   * missing design: most components bypassed form-kit and reached for
   * Tailwind's named sizes, so "body text" landed at 12px (text-xs), 13px
   * (t.body) or 14px (text-sm) depending on which screen you were on.
   *
   * 394 usages across 49 components were migrated in one pass; this is now a
   * BAN rather than a ratchet, because the debt is cleared and the only way it
   * returns is a new component written without looking at the scale.
   *
   * Two exclusions, both deliberate:
   *
   *  - PUBLIC MARKETING AND PRE-AUTH surfaces. A landing page legitimately
   *    needs a display scale — hero type well above 20px — and squeezing it to
   *    a 13px body would make it worse, not more consistent. Different surface,
   *    different job.
   *  - COMMENT LINES. Prose explaining the rule necessarily names the classes
   *    the rule forbids. A codemod run without this exclusion rewrote
   *    form-kit's own documentation into gibberish before it was caught.
   *
   * The portal itself is never scanned: it is inline-styled, customer-facing,
   * and explicitly not to be touched.
   */
  const DISPLAY_SCALE_SURFACES = new Set([
    "marketing.tsx",
    "alternative-page.tsx",
    "solution-page.tsx",
    "interest-form.tsx",
    "login-form.tsx",
  ]);

  const OFF_SCALE = /\btext-(sm|xs|base|lg|xl|2xl|3xl)\b|text-\[(9|14|16|17|19)px\]/;
  const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

  it("no app component uses an off-scale text size", () => {
    const offenders: string[] = [];
    for (const f of sourceFiles("components")) {
      const name = f.split(/[\\/]/).pop()!;
      if (DISPLAY_SCALE_SURFACES.has(name)) continue;
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (COMMENT_LINE.test(line)) return;
        if (OFF_SCALE.test(line)) offenders.push(`${name}:${i + 1}`);
      });
    }
    expect(
      offenders,
      `these use a size outside the portal scale — use the "t" tokens from ` +
      `components/form-kit.tsx (13px body, 12px secondary, 11px label, 10px micro, ` +
      `15/18/20px headings): ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("form-kit's label and header tokens stay on the scale", () => {
    // If these drift, every form drifts with them — they are what the rest of
    // the app was migrated toward.
    const src = readFileSync(join(ROOT, "components/form-kit.tsx"), "utf8");
    expect(src).toMatch(/label:\s*"text-\[11px\]/);
    expect(src).toMatch(/micro:\s*"text-\[10px\]/);
    expect(src).toMatch(/body:\s*"text-\[13px\]/);
    // Derived, not restated, or the scale forks when someone edits one of them.
    expect(src).toContain('export const fieldLabel = "block " + t.label');
    expect(src).toContain('export const th = "text-left " + t.micro');
  });
});

describe("form controls come from the kit, not from each component", () => {
  /**
   * CLAUDE.md has said for a long time not to hand-roll input class strings —
   * "that's how the forms drifted into inconsistency before". It was never
   * enforced, so it drifted again: 34 components carried form controls and only
   * 12 composed from form-kit. The other 22 each defined their own, which is
   * why two drawers opened looking like two different products.
   *
   * The signature below is what every one of those hand-rolled controls shared:
   * a stone background, a border and a radius, on a line that is an <input>,
   * <select>, <textarea>, or a `const inputCls = "..."` feeding one.
   *
   * Compose from form-kit instead:
   *   control / controlInset   full form field (h-9)
   *   controlCompact           inline filter or in-table numeric (h-8)
   *   controlMultiline         textarea
   *   cell / cellSelectCls     ghost line-item cell
   *   fieldLabel, th           label and table header
   * Extra classes are fine on top — `${controlCompact} w-16 text-right` says
   * "a standard control, narrower and right-aligned", which is a variation.
   * Re-declaring the whole anatomy is a fork.
   *
   * Excluded: form-kit itself (it IS the definition), ui.tsx (the shared
   * primitives), and the public marketing / pre-auth surfaces, which have their
   * own visual language and no reason to match an internal data screen.
   */
  const OWNS_ITS_STYLING = new Set([
    "form-kit.tsx",
    "ui.tsx",
    "marketing.tsx",
    "alternative-page.tsx",
    "solution-page.tsx",
    "interest-form.tsx",
    "login-form.tsx",
  ]);

  // A stone surface + border + radius, in either order.
  const CONTROL_SIG = /bg-stone-9[05]0[^"`]*border[^"`]*rounded|rounded[^"`]*border[^"`]*bg-stone-9[05]0/;
  const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

  // Only the class string belonging to the CONTROL ITSELF, never every string
  // on the line. A card <div> and an <input> routinely share a line, and
  // flagging the card because an input sits beside it is a false positive —
  // the kind that gets a guard switched off rather than obeyed.
  const CONTROL_CLASS = /<(?:input|select|textarea)[^>]*?className="([^"]*)"/g;
  const CONTROL_CONST = /(?:inputCls|labelCls|const input)\s*=\s*"([^"]*)"/g;

  it("no component hand-rolls a form control's styling", () => {
    const offenders: string[] = [];
    for (const f of sourceFiles("components")) {
      const name = f.split(/[\\/]/).pop()!;
      if (OWNS_ITS_STYLING.has(name)) continue;
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (COMMENT_LINE.test(line)) return;
        for (const re of [CONTROL_CLASS, CONTROL_CONST]) {
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(line)) !== null) {
            if (CONTROL_SIG.test(m[1])) offenders.push(`${name}:${i + 1}`);
          }
        }
      });
    }
    expect(
      offenders,
      `these define a control's styling inline instead of composing from ` +
      `components/form-kit.tsx (control / controlInset / controlCompact / ` +
      `controlMultiline / cell): ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("the kit still exports the tokens components are told to use", () => {
    const src = readFileSync(join(ROOT, "components/form-kit.tsx"), "utf8");
    for (const token of [
      "control", "controlInset", "controlCompact", "controlMultiline",
      "cell", "fieldLabel", "th",
    ]) {
      expect(src, `form-kit no longer exports ${token}`).toMatch(
        new RegExp(`export const ${token}\\b`),
      );
    }
  });
});

describe("the app looks like one product", () => {
  /**
   * Consistency is the product's stated first principle, so it is asserted
   * rather than reviewed. Each rule below was a measured defect, not a
   * preference — the counts are from the audit that produced the fixes.
   *
   * Public marketing and pre-auth pages are excluded throughout: they are a
   * different surface with a display scale of their own, and forcing them to
   * match an internal data screen would make them worse.
   */
  const DISPLAY_SURFACES = new Set([
    "marketing.tsx", "alternative-page.tsx", "solution-page.tsx",
    "interest-form.tsx", "login-form.tsx",
  ]);
  const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

  function appComponents() {
    return sourceFiles("components").filter(
      f => !DISPLAY_SURFACES.has(f.split(/[\\/]/).pop()!),
    );
  }

  /** Lines of a file with comment lines dropped, as [lineNo, text]. */
  function codeLines(f: string): [number, string][] {
    return readFileSync(f, "utf8")
      .split("\n")
      .map((l, i) => [i + 1, l] as [number, string])
      .filter(([, l]) => !COMMENT_LINE.test(l));
  }

  it("no text is invisible against the dark theme", () => {
    /**
     * text-stone-700/800/900 is dark ink. It is correct on a light chip or
     * button and unreadable on the app's near-black surface — 82 elements were
     * in the second category, including every label in forms.tsx. They were
     * light-theme leftovers, and on a dark background they simply did not
     * render.
     *
     * The light-background check is what makes this a per-element rule rather
     * than a global ban: `bg-white text-stone-900` is a deliberate light
     * button and there are six of them.
     */
    const DARK_INK = /text-stone-[789]00/;
    const LIGHT_BG = /\bbg-(white|stone-(?:50|100|200)|amber-100|emerald-100|rose-100|blue-100)\b/;
    const CLASS = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g;

    const offenders: string[] = [];
    for (const f of appComponents()) {
      const name = f.split(/[\\/]/).pop()!;
      for (const [no, line] of codeLines(f)) {
        CLASS.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = CLASS.exec(line)) !== null) {
          const cls = m[1] ?? m[2] ?? "";
          if (DARK_INK.test(cls) && !LIGHT_BG.test(cls)) offenders.push(`${name}:${no}`);
        }
      }
    }
    expect(
      offenders,
      `dark ink with no light background — invisible on this theme. Use the ` +
      `ink ramp in form-kit (stone-100 strong / 200 body / 400 secondary / ` +
      `500 muted): ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("no border is a light-theme leftover", () => {
    // border-stone-200 on a near-black surface draws a bright line where a
    // subtle divider was meant. 15 of these existed, in the same three files
    // that carried the invisible text.
    const offenders: string[] = [];
    for (const f of appComponents()) {
      const name = f.split(/[\\/]/).pop()!;
      for (const [no, line] of codeLines(f)) {
        if (/\bborder-stone-[1-4]00\b/.test(line)) offenders.push(`${name}:${no}`);
      }
    }
    expect(
      offenders,
      `light borders on the dark theme — use border-stone-700/800: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("nothing is rounder than the portal's 8px ceiling", () => {
    // The portal uses 5 / 6 / 8 and nothing above. 85 elements were at 12px or
    // 16px, which is why a card here looked softer than the same card three
    // screens away. rounded-full is untouched — a pill is a circle by intent.
    const offenders: string[] = [];
    for (const f of appComponents()) {
      const name = f.split(/[\\/]/).pop()!;
      for (const [no, line] of codeLines(f)) {
        if (/\brounded(-(?:t|b|l|r|tl|tr|bl|br))?-(?:xl|2xl|3xl)\b/.test(line)) {
          offenders.push(`${name}:${no}`);
        }
      }
    }
    expect(
      offenders,
      `radius above the 8px ceiling — use rounded-lg: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("every table header row uses the one token", () => {
    // Six variants across 31 tables. The <th> cells are fine — they carry only
    // alignment and padding — so this guards the <tr> that carries the type.
    const offenders: string[] = [];
    for (const f of appComponents()) {
      const name = f.split(/[\\/]/).pop()!;
      for (const [no, line] of codeLines(f)) {
        const m = /<tr className="([^"]*)"/.exec(line);
        if (m && /uppercase|text-\[1[01]px\]/.test(m[1])) offenders.push(`${name}:${no}`);
      }
    }
    expect(
      offenders,
      `hand-styled table header row — use tableHead from form-kit: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("dates are derived from the local calendar, never UTC", () => {
    /**
     * `new Date().toISOString().slice(0,10)` is UTC. CLAUDE.md: "Use
     * localToday(), never today(), for anything compared against an invoice or
     * due date — today() is UTC and shifts the day either side of Greenwich."
     *
     * 27 sites filled default date inputs and "as of" filters this way. West
     * of Greenwich after about 19:00 local they default to TOMORROW. This is
     * the same defect class as the "a date is a date" incident, in the place
     * the existing guard cannot see: that one watches the RENDER side for
     * `+ "T00:00:00Z"`, and these are on the DERIVE side.
     */
    const offenders: string[] = [];
    for (const f of sourceFiles("components")) {
      const name = f.split(/[\\/]/).pop()!;
      for (const [no, line] of codeLines(f)) {
        if (/toISOString\(\)\.slice\(0,\s*10\)/.test(line)) offenders.push(`${name}:${no}`);
      }
    }
    expect(
      offenders,
      `UTC date derivation — use localToday() / ymd() from lib/format: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

describe("money and quantity are formatted in one place", () => {
  /**
   * The decimal rules live in lib/format.ts (`fmt.money`, `fmt.num2`,
   * `fmt.qty`). Nine independent copies of a currency formatter existed, each
   * with `maximumFractionDigits: 0` hard-coded — so changing the rule centrally
   * fixed three surfaces and silently left the other nine rounding away cents,
   * including the chase email a DEBTOR reads.
   *
   * That is the failure this guards: not that a copy is ugly, but that a copy
   * does not receive the fix.
   *
   * EXCLUDED: everything customer-portal-facing — app/portal/** (the page) and
   * app/api/portal/** (its PDF and statement generators). The portal was
   * explicitly placed out of scope, so its formatters are left alone. They
   * already use maximumFractionDigits 2, so they do show cents; the only
   * difference from the app rule is that a round figure prints as "100" rather
   * than "100.00". Worth aligning, but not worth changing a document a customer
   * receives without being asked for it.
   */
  const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

  function scanned() {
    return [...sourceFiles("components"), ...sourceFiles("lib"), ...sourceFiles("app")]
      .filter(f => !/\/app\/(api\/)?portal\//.test(f.replace(/\\/g, "/")))
      // lib/format.ts IS the definition.
      .filter(f => !f.replace(/\\/g, "/").endsWith("lib/format.ts"));
  }

  it("no module builds its own currency formatter", () => {
    const offenders: string[] = [];
    for (const f of scanned()) {
      const rel = relative(ROOT, f).replace(/\\/g, "/");
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (COMMENT_LINE.test(line)) return;
        if (/new Intl\.NumberFormat/.test(line) && /style:\s*["']currency["']/.test(line)) {
          offenders.push(`${rel}:${i + 1}`);
        }
      });
    }
    expect(
      offenders,
      `these build their own currency formatter instead of calling fmt.money ` +
      `from lib/format — a copy does not receive a fix to the rule: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("nothing rounds money to whole units", () => {
    // `maximumFractionDigits: 0` on a currency value is the specific defect
    // that hid cents across the app until 2026-09-21.
    const offenders: string[] = [];
    for (const f of scanned()) {
      const rel = relative(ROOT, f).replace(/\\/g, "/");
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (COMMENT_LINE.test(line)) return;
        if (/maximumFractionDigits:\s*0\b/.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(
      offenders,
      `money rounded to whole units — use fmt.money (min 2 decimals): ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("the rules themselves are what lib/format declares", () => {
    const src = readFileSync(join(ROOT, "lib/format.ts"), "utf8");
    expect(src).toMatch(/const MONEY_MIN_DP = 2;/);
    expect(src).toMatch(/const MONEY_MAX_DP = 6;/);
    expect(src).toMatch(/const QTY_MAX_DP = 5;/);
  });
});

describe("quantities keep the decimals the database now holds", () => {
  // Migration 0088 widened every quantity column to numeric(_,6). That achieves
  // nothing on its own: before it, `round4()` and `.toFixed(4)` truncated each
  // quantity in the engines BEFORE it reached the database, and inline
  // `Math.round(q * 1e4) / 1e4` truncated it again on the way back out to a
  // report. Both halves had to change, and both halves are the kind that grow
  // back one convenient copy at a time.
  const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

  /** Names that mean "this is a count of things", not an amount of money. */
  const QTY_NAME = /\b(qty|quantity|packs|baseQty|onHand|remaining|shortfall|unlocated|committed|available|expected|received|shipped|billed|invoiced|wastage)\w*/i;

  const MONEY_NAME = /\b(amount|cost|value|price|rate|total|balance|fx|unitCost|avgCost)\w*/i;

  const engineFiles = () =>
    [...sourceFiles("lib/inventory"), ...sourceFiles("app/api/inventory")];

  it("no quantity is rounded to four decimals", () => {
    // 4dp is the OLD column scale. A quantity rounded there loses the 5th and
    // 6th decimal permanently — silently, and only for the customers whose
    // units are small enough to need them.
    const offenders: string[] = [];
    for (const f of engineFiles()) {
      const rel = relative(ROOT, f).replace(/\\/g, "/");
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (COMMENT_LINE.test(line)) return;
        const rounds4 = /round4\s*\(|toFixed\(4\)|\*\s*1e4\s*\)\s*\/\s*1e4/.test(line);
        if (!rounds4) return;
        // A line may legitimately round money to 4 alongside a quantity name
        // (`totalCost: n4(qty * unitCost)`), so a quantity name alone is not
        // the test — the flag is a quantity name with NO money name present.
        if (QTY_NAME.test(line) && !MONEY_NAME.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(
      offenders,
      `these round a quantity to 4 decimals, which is the pre-0088 column scale — ` +
      `use roundQty / nQty (6dp) so the 5th decimal a user typed survives: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("the quantity epsilon is the smallest quantity the column can hold", () => {
    // Every "is this remainder zero?" test was a bare 0.0001, which at 6dp
    // storage silently closes a PO line that still has 0.00005 outstanding.
    const src = readFileSync(join(ROOT, "lib/inventory/round.ts"), "utf8");
    expect(src).toMatch(/export const QTY_EPSILON = 1e-6;/);
    expect(src).toMatch(/export const roundQty = .*1e6.*1e6;/);

    const offenders: string[] = [];
    for (const f of engineFiles()) {
      const rel = relative(ROOT, f).replace(/\\/g, "/");
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (COMMENT_LINE.test(line)) return;
        if (/0\.0001\b/.test(line) && QTY_NAME.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(
      offenders,
      `these compare a quantity against a hand-written 0.0001 — import ` +
      `QTY_EPSILON from lib/inventory/round so the threshold tracks the column ` +
      `scale instead of drifting from it: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("every quantity column in the schema carries six decimals", () => {
    // The guard that makes the other two mean something: if a new quantity
    // column lands at scale 4, rounding to 6 in the engine just hands Postgres
    // a number it will round back down.
    const src = readFileSync(join(ROOT, "db/schema.ts"), "utf8");
    const offenders: string[] = [];
    let table = "";
    src.split("\n").forEach(line => {
      const t = /export const \w+ = pgTable\("([^"]+)"/.exec(line);
      if (t) table = t[1];
      const c = /(\w+):\s*numeric\("([^"]+)",\s*\{\s*precision:\s*(\d+),\s*scale:\s*(\d+)/.exec(line);
      if (!c) return;
      const [, , col, , scale] = c;
      if (/qty|quantity|packs/i.test(col) && Number(scale) < 6) {
        offenders.push(`${table}.${col} (scale ${scale})`);
      }
    });
    expect(
      offenders,
      `these quantity columns still hold only 4 decimals, so a 5-decimal entry ` +
      `is rounded away on write: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
