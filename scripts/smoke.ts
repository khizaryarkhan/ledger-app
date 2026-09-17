/**
 * Production smoke test — does the app that customers actually touch still work?
 *
 * WHY THIS EXISTS
 *
 * Every regression that has reached a paying client had the same shape: a URL
 * that returned 200 yesterday returns a 500, or a redirect, today. And in every
 * case nobody had edited the thing that broke — something it quietly depended
 * on changed underneath it:
 *
 *   - the customer portal started redirecting to a Vercel login page, because
 *     links were built from the request host and the app got served on a
 *     *.vercel.app URL. Nothing in the portal changed.
 *   - Payables → Suppliers began returning 500, because `ap_suppliers` became a
 *     VIEW and `GROUP BY view.id` is not legal on one. Nothing in that route
 *     changed.
 *   - Google's site-verification file was redirected to /login by middleware,
 *     which would have failed the OAuth review with no visible symptom.
 *
 * None of these are catchable by the unit suite, and that is by design: it runs
 * with no database and no network, which is what keeps it fast and honest — a
 * fabricated database proves nothing. So this check runs against the REAL
 * deployed site, after the deploy, and is the only thing in the system that can
 * see this class of failure.
 *
 * Until now, the detection mechanism was the customer emailing us.
 *
 * STRICTLY READ-ONLY. Every request is a GET, apart from the one POST that is a
 * login. Nothing here writes, sends an email, or calls QuickBooks.
 *
 * Usage:
 *   npx tsx scripts/smoke.ts
 *   npx tsx scripts/smoke.ts --base https://ledger-app-git-some-branch.vercel.app
 *
 * Exit code is 1 if any check fails, so a post-deploy hook or CI can gate on it.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });

const arg = (n: string): string | null => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : null;
};

const BASE = (arg("base") ?? process.env.SMOKE_BASE_URL ?? "https://primeaccountax.com").replace(/\/+$/, "");
const TIMEOUT_MS = 25_000;

type Check = {
  name: string;
  path: string;
  /** Status codes that mean "this is working". */
  expect: number[];
  /** Optional substring the body must contain. */
  contains?: string;
  /** A redirect is a PASS for some checks and a FAIL for others — say which. */
  noRedirect?: boolean;
  auth?: boolean;
  why: string;
};

/**
 * Anonymous checks.
 *
 * `redirect: "manual"` is the load-bearing detail. A 307 to /login is exactly
 * how both the portal and the Google file failed, and letting fetch follow
 * redirects automatically would have turned both of those into a passing 200 —
 * a green check over a broken customer experience.
 */
const PUBLIC_CHECKS: Check[] = [
  { name: "homepage",        path: "/",           expect: [200], why: "the marketing site is up at all" },
  { name: "login page",      path: "/login",      expect: [200], why: "customers and staff can sign in" },
  { name: "health endpoint", path: "/api/health", expect: [200], why: "the app can reach its database" },
  {
    name: "Google verification",
    path: "/google5715fe54cedbe3cb.html",
    expect: [200],
    contains: "google-site-verification",
    noRedirect: true,
    why: "losing this un-verifies the domain and blocks the Gmail OAuth review",
  },
  {
    // The portal is the highest-stakes public surface — it is what a debtor
    // opens from a chase email. An unknown or expired token must render the
    // portal's own "link expired" page, NOT a redirect to a login wall of any
    // kind. Redirect here means every link we have emailed is dead.
    name: "portal (unknown token)",
    path: "/portal/smoke-test-not-a-real-token",
    expect: [200, 404],
    noRedirect: true,
    why: "THE bug: a portal link that redirects anywhere is a dead link to a customer",
  },
];

/**
 * Authenticated checks — the ones that would have caught the Suppliers 500.
 * That failure happened at query time, AFTER auth, so no anonymous request can
 * reach it; without credentials this whole class stays invisible.
 *
 * Skipped unless SMOKE_EMAIL / SMOKE_PASSWORD are set. Use a dedicated
 * read-only smoke account, never a real admin's credentials.
 */
const AUTHED_CHECKS: Check[] = [
  { name: "invoices",     path: "/api/invoices?limit=1",           expect: [200], auth: true, why: "the core AR list" },
  { name: "customers",    path: "/api/customers?limit=1",          expect: [200], auth: true, why: "customer master data" },
  { name: "AR snapshot",  path: "/api/reports/ar-snapshot?live=1", expect: [200], auth: true, why: "every dashboard widget reads this one endpoint" },
  { name: "AR aging",     path: "/api/reports/ar-aging",           expect: [200], auth: true, why: "the aging report the client runs" },
  { name: "suppliers",    path: "/api/payables/suppliers",         expect: [200], auth: true, why: "this is the route that returned 500 until a customer reported it" },
  { name: "org settings", path: "/api/org/settings",               expect: [200], auth: true, why: "the app shell will not render without it" },
];

type Result = { name: string; ok: boolean; detail: string; why: string };

async function run(c: Check, token: string | null): Promise<Result> {
  const url = `${BASE}${c.path}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "manual",
      signal: ctl.signal,
      headers: {
        "user-agent": "prime-accountax-smoke/1",
        ...(token && c.auth ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    const isRedirect = res.status >= 300 && res.status < 400;
    const loc = res.headers.get("location") ?? "";

    if (isRedirect && (c.noRedirect || !c.expect.includes(res.status))) {
      return { name: c.name, ok: false, detail: `HTTP ${res.status} → ${loc || "(no location header)"}`, why: c.why };
    }
    if (!c.expect.includes(res.status)) {
      return { name: c.name, ok: false, detail: `HTTP ${res.status} (wanted ${c.expect.join("/")})`, why: c.why };
    }
    if (c.contains) {
      const body = await res.text();
      if (!body.includes(c.contains)) {
        return { name: c.name, ok: false, detail: `HTTP ${res.status} but body is missing "${c.contains}"`, why: c.why };
      }
    }
    return { name: c.name, ok: true, detail: `HTTP ${res.status}`, why: c.why };
  } catch (e: any) {
    const detail = e?.name === "AbortError" ? `timed out after ${TIMEOUT_MS / 1000}s` : String(e?.message ?? e);
    return { name: c.name, ok: false, detail, why: c.why };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bearer token via the mobile auth path — a script cannot hold the web app's
 * httpOnly session cookie, but `requireOrg()` accepts `Authorization: Bearer`
 * and re-validates it against the database exactly like the cookie path.
 */
async function login(): Promise<string | null> {
  const email = process.env.SMOKE_EMAIL;
  const password = process.env.SMOKE_PASSWORD;
  if (!email || !password) return null;
  try {
    const res = await fetch(`${BASE}/api/mobile/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      console.log(`\n⚠️  smoke login failed: HTTP ${res.status} — authenticated checks skipped`);
      return null;
    }
    const j: any = await res.json();
    const token = j.accessToken ?? j.access_token ?? null;
    if (!token) {
      console.log(`\n⚠️  login returned no access token (multi-org account?) — authenticated checks skipped`);
    }
    return token;
  } catch (e: any) {
    console.log(`\n⚠️  smoke login errored: ${e?.message ?? e} — authenticated checks skipped`);
    return null;
  }
}

async function main() {
  console.log(`\n── Smoke test: ${BASE} ─────────────────────────────────────\n`);

  const token = await login();
  const checks = token ? [...PUBLIC_CHECKS, ...AUTHED_CHECKS] : PUBLIC_CHECKS;
  if (!token) {
    console.log(`Public checks only. Set SMOKE_EMAIL and SMOKE_PASSWORD (a read-only`);
    console.log(`smoke account) to also cover the signed-in routes — that is where the`);
    console.log(`Suppliers 500 lived, and no anonymous request can reach it.\n`);
  }

  // Sequential on purpose: a burst of parallel requests against production is
  // indistinguishable from a small load test, and this runs on every deploy.
  const results: Result[] = [];
  for (const c of checks) results.push(await run(c, token));

  const width = Math.max(...results.map(r => r.name.length)) + 2;
  for (const r of results) {
    console.log(`${r.ok ? "✅" : "❌"} ${r.name.padEnd(width)} ${r.detail}`);
    if (!r.ok) console.log(`   ${" ".repeat(width)} ↳ ${r.why}`);
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);

  if (failed.length) {
    console.log(`\n❌ SMOKE FAILED — ${failed.map(f => f.name).join(", ")}`);
    console.log(`   A redirect here usually means middleware is intercepting a route that`);
    console.log(`   must stay public. A 500 usually means a database-shaped change (a table`);
    console.log(`   becoming a view, a dropped column) that no unit test can see.`);
    process.exit(1);
  }
  console.log(`\n✅ Everything a customer touches is responding.`);
}

main().catch(e => { console.error(e); process.exit(1); });
