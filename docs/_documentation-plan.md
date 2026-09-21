# Documentation Plan

- **Purpose:** Record what was surveyed, what will be written, what was deliberately skipped, and where the risk sits — before the documents themselves.
- **Audience:** Whoever maintains `/docs`, and reviewers checking coverage.
- **Last verified against:** commit `3eec3df` (2026-09-17), surveyed 2026-09-19
- **Primary sources:** `package.json`, `app/`, `lib/`, `db/schema.ts`, `.github/workflows/`, `vercel.json`, `CLAUDE.md`, `git log`

## Scope

Documenting the **web application** only. The `mobile/` React Native (Expo)
project is **explicitly out of scope** at the requester's instruction. It is a
separate npm project with its own `package.json` and lockfile, is excluded from
`tsconfig.json` and from CI, and is not part of the Next.js build. It is
mentioned only where the web app has surface area built for it (the
`Authorization: Bearer` auth path in `lib/api.ts` and the `app/api/mobile/*`
routes), because ignoring that would make the web-side auth model look wrong.

Nothing outside `/docs` was modified.

## What was surveyed

| Area | Method |
|---|---|
| Repo structure | `find`, `ls` over the repo root, `app/`, `lib/`, `components/`, `db/`, `inngest/`, `scripts/`, `tests/` |
| Stack & tooling | `package.json`, `tsconfig.json`, `vitest.config.ts`, `next.config.js`, `drizzle.config.ts`, `tailwind.config.js` |
| Entry points | `middleware.ts`, `app/**/route.ts` (422 files), `app/**/page.tsx` (175), `inngest/functions/*`, `vercel.json` crons, `scripts/*` |
| CI/CD | `.github/workflows/ci.yml`, `.github/workflows/smoke.yml`, `vercel.json` |
| Data | `db/schema.ts` (3,145 lines, ~125 tables), `db/migrations/` (87 SQL files + `meta/_journal.json`) |
| Config | Every `process.env.*` reference across `app/`, `lib/`, `inngest/`, `scripts/`, root configs |
| Intended behaviour | `tests/` (17 files, 252 assertions) — run green |
| History | `git log` (1,231 commits, 2026-05-06 → 2026-09-17), file-churn ranking over the last 300 commits |
| Existing prose | `CLAUDE.md`, `README.md`, `PROJECT-REFERENCE.md`, `DEPLOY.md`, `SETUP-GUIDE.md`, `INTEGRITY_AUDIT.md`, `docs/admin-portal-account-model-plan.md` |

Verification commands run locally (read-only, no database, no network):

```
npm test          # 17 files, 252 tests, all passing
npx tsc --noEmit  # exit 0
```

`next build` was **not** run: the repo's own CI declines to run it because
several routes need real Stripe/Intuit keys and fail at page-data collection
without them. `npm audit` was not run either — it contacts the npm registry,
which is outside the read-only-local boundary for this exercise. Dependency
currency is therefore recorded as an open question, not a finding.

## Documents to produce

| File | Status |
|---|---|
| `README.md` | Index + reading order |
| `01-system-overview.md` | Domain, users, scope, context diagram |
| `02-architecture.md` | Style, container/component diagrams, cross-cutting concerns |
| `03-codebase-guide.md` | Directory map, entry points, "where do I add X" |
| `04-data-model.md` | Core ER diagrams, migration approach, the two settlement graphs |
| `05-key-flows.md` | 8 flows with sequence diagrams |
| `06-interfaces-and-integrations.md` | API surface, webhooks, every external system |
| `07-configuration-and-environments.md` | Env vars (names only), feature gates, precedence |
| `08-build-deploy-operations.md` | Build, CI, deployment topology, jobs, monitoring |
| `09-development-guide.md` | Setup, test, debug, common-change recipes |
| `10-security-and-compliance.md` | AuthN/AuthZ, tenancy, secrets, gaps |
| `11-risks-debt-and-open-questions.md` | Debt, fragility, numbered open questions |
| `glossary.md` | Domain + technical terms |
| `adr/` | 6 ADRs for decisions with clear evidence |

## Coverage priorities

Prioritised by centrality — how much of the system breaks if the reader
misunderstands it.

**Documented in depth**

1. Multi-tenancy and request authorisation (`lib/api.ts`, `middleware.ts`) — every
   read and write depends on it, and it is the largest correctness risk.
2. The general ledger (`lib/ledger.ts`, `lib/accounting/`) — immutable posting,
   the bridge tables, the reconciliation harness.
3. Accounts-receivable collections (board, stages, promises, portal, chase) — the
   original product and still the busiest surface.
4. Provider sync (QuickBooks Online, Xero, Sage Intacct) — the largest external
   coupling and the source of most operational incidents in the history.
5. Data Studio's chunked job engine (`lib/batch/`) — the only place the app does
   bulk writes into someone else's system.
6. Background jobs and the two different schedulers (Vercel cron + Inngest).

**Documented lightly**

- The 97 `app/api/admin/*` routes (platform back-office: leads, CRM, billing
  administration, provisioning). Structure and responsibility documented; not
  route by route.
- Marketing/SEO pages under `app/(marketing)/` — static content, low risk.
- Inventory/manufacturing internals (FIFO valuation, BOM, job work). The
  accounting consequences are documented; the algorithms are summarised, not
  traced line by line.
- Reporting engine (`lib/reporting/`) and the Reporting module passthrough.

**Skipped, with reason**

- `mobile/` — out of scope by instruction.
- `.next/`, `node_modules/`, `.vercel/` — build output and dependencies.
- `scripts/load-test-*.browser.js` — ad-hoc browser console harnesses, not part
  of any pipeline.
- Individual React component internals — `components/` is documented as a map
  and a set of conventions, not per-component.

## Highest-risk areas identified up front

These drove where the deep analysis went, and each has a corresponding entry in
`11-risks-debt-and-open-questions.md`.

1. **No database transactions.** `neon-http` cannot do `db.transaction()`.
   Every multi-statement write is a hand-rolled compensating sequence.
2. **Two parallel settlement graphs** (`transaction_links` vs
   `payment_applications`) keyed on different ids for the same invoice.
3. **Migration drift.** The journal's `when` ordering is hand-maintained and has
   silently dropped a table in production once.
4. **A partially-built native GL for provider orgs.** `ingestOrgTransactions` is
   shadow-only and reachable only from a CLI script; a QuickBooks org's native
   trial balance is empty.
5. **Money stored as `real()`** on the AR mirror tables while the native ledger
   uses `numeric(14,2)`.
6. **Deliberate duplication** between `/payables/purchase-orders` and
   `/accounting/trade/purchase-orders`, deferred rather than resolved.
7. **Build-time type and lint checking disabled** (`next.config.js` sets
   `ignoreBuildErrors` and `ignoreDuringBuilds`); only CI catches type errors.
