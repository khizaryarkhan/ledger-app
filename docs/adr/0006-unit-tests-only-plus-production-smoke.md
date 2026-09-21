# ADR 0006 — Unit tests with no database, plus a production smoke test

- **Status:** Accepted (2026-09-12)
- **Rationale:** [EVIDENCED] — both workflow files and `vitest.config.ts` explain themselves at length.
- **Last verified against:** commit `3eec3df` (2026-09-17)
- **Primary sources:** `vitest.config.ts`, `.github/workflows/ci.yml`, `.github/workflows/smoke.yml`, `scripts/smoke.ts`, `tests/`

## Context

The repository had **zero** automated tests until 2026-09-12. The motivation was
not coverage: it was a specific set of defects that reached a paying client — a
portal response type rejected outright, template placeholders emailed verbatim,
two pay buttons on every invoice, broken due-date filters. Every one of them
lived in a pure function.

## Decision

Two complementary suites, each honest about what it can prove.

**1. Unit tests only — no database, no network** (`npm test`, Vitest).

Anything needing a real database belongs in `scripts/reconcile-foundation.ts` or
`/admin/reconcile`, which run against production. CI has no database and a
fabricated one proves nothing. CI also **does not run `next build`**, because
several routes need real Stripe and Intuit keys and would go red for an
environment gap rather than a defect.

To test route logic, **extract it** — do not import the route, which pulls in
`db` and `next/headers`. `lib/portal-response.ts` and `lib/ar-email.ts`'s
`appendPayButton` are the two worked examples, both behaviour-identical moves.

A sub-genre deserves its own mention: `tests/architecture.test.ts` holds
grep-based **structural** assertions — no QuickBooks report may serve a product
report, no client component may import server-only modules, no `GROUP BY` on a
view column, no `real()` for money in the ledger, no date pinned to UTC midnight
and formatted locally, the Google verification file stays reachable. Each was
written after a real incident and each was proven to fail on the violation
before being committed.

**2. A read-only production smoke test** (`npm run smoke`), triggered on every
successful production deploy and every 30 minutes.

It exists because every regression that actually reached a client had the same
shape — a URL that returned 200 yesterday returns 500 or a redirect today, and
nobody edited the thing that broke: the portal redirecting debtors to a Vercel
login page, Payables → Suppliers returning 500 for days, Google's verification
file swallowed by middleware. None of those are catchable by a suite with no
database and no network. Until this existed, the detection mechanism was the
customer emailing.

## Consequences

- CI is fast and never flaky, and a green run means something precise: the pure logic is consistent and the types check.
- It explicitly **cannot** see integration failures. The smoke test is the only thing that can, and its signed-in checks — which cover the exact route that once returned 500 for days — run only when a dedicated **read-only** account is configured as `SMOKE_EMAIL` / `SMOKE_PASSWORD` in repository secrets.
- There is no integration or end-to-end suite, and no plan for one in the repository.
- Constraints to respect: vitest is pinned to `^2` (v5 wants `@types/node >= 22`, this repo pins 20), and `vite-tsconfig-paths` cannot be used (ESM-only), so `vitest.config.ts` declares the `@/` alias directly and must be kept in step with `tsconfig.json`.
- State at this commit: 17 files, 252 tests, all passing; `tsc --noEmit` exits 0.
