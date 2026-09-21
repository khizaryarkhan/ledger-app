# Risks, Technical Debt and Open Questions

- **Purpose:** The fragile parts, the known debt, and the things a new maintainer cannot determine from the repository alone.
- **Audience:** A new maintainer, and whoever plans the next quarter's work.
- **Last verified against:** commit `3eec3df` (2026-09-17)
- **Primary sources:** `CLAUDE.md`, `INTEGRITY_AUDIT.md`, `db/migrations/`, `tests/architecture.test.ts`, `next.config.js`, `package.json`, `git log`

Everything here is an observation. Nothing in this documentation exercise changed
any code.

A note on tone: this codebase is unusually honest about its own defects. Much of
what follows is already written down in `CLAUDE.md` and `INTEGRITY_AUDIT.md`,
often with the incident that produced it. That is a strength, not a symptom —
this document collects and ranks it rather than discovering it.

---

## A. Structural risks

### A1. No database transactions — every multi-write is hand-rolled

`neon-http` cannot do `db.transaction()`. Every multi-statement write is a
compensating sequence (`lib/ledger.ts`) or a single atomic conditional `UPDATE`
(`lib/batch/lease.ts`). The existing implementations are careful, but **the
guarantee is per-site, not systemic**: a new contributor who assumes atomicity
will write a bug that only shows up under failure.

*Evidence:* `db/index.ts`, `lib/ledger.ts` (compensating header delete),
`lib/batch/lease.ts` header comment, `CLAUDE.md` gotchas.

### A2. Migration ordering is hand-maintained and has failed silently

`meta/_journal.json`'s `when` must be strictly greater than the previous entry;
Drizzle skips entries that are not, without error. This has already dropped a
table in production — migration `0085_heal_skipped_0016_0017` exists to repair
it. Nothing mechanically enforces the ordering.

Compounding it: `npm run db:push` is still in `package.json` and is what
`README.md` tells a new developer to run. Schema applied that way leaves no
migration file, which is invisible until someone migrates a fresh database — the
exact origin of `0066_external_id_nullable.sql` and `0067_invoices_source.sql`.

*Suggested mitigation:* a CI check that the journal is strictly increasing, and a
periodic from-scratch migration against a throwaway database.

### A3. No row-level security

Tenancy is enforced entirely in application code across 422 route handlers. The
helpers (`requireOrg`, `ownsInOrg`, `userInOrg`) are good, but one missed filter
is a cross-tenant leak, and nothing catches it automatically.

### A4. Type checking is off at build time

`next.config.js` sets `typescript.ignoreBuildErrors: true` and
`eslint.ignoreDuringBuilds: true`. Only CI's `npm run typecheck` catches type
errors, and **there is no lint step anywhere**. `tsconfig.json` also sets
`strict: false`, so null-safety is not checked at all — `lib/batch/lease.ts`
documents working around the absence of `strictNullChecks` in its own type
design.

### A5. The unit suite cannot see the failures that reach customers

This is deliberate and correct (no database, no network — see
[09-development-guide.md](09-development-guide.md)), but the consequence is real:
the `GROUP BY`-on-a-view 500, the portal redirect, and the swallowed Google
verification file all passed CI. The production smoke workflow is the
compensating control, and it only covers the signed-in surfaces when
`SMOKE_EMAIL` / `SMOKE_PASSWORD` secrets are configured.

---

## B. Known fragility and hidden coupling

### B1. Seven send paths for one email template

`renderInvoiceEmail` is called from seven places: four server-side, two
client-side (`components/send-invoices-modal.tsx`, `components/feature.tsx`), and
the free-text composer handled server-side in `app/api/email/send/route.ts`. A
fix to the first four shipped and the customer still saw nothing, because the
paths they actually used render in the browser where there is no QuickBooks
token. **Grep before assuming coverage.**

### B2. Duplicated logic is the recurring failure mode

`commit-runner.ts` held its own inline copy of build + safety-check + sparse +
post, and kept running the broken version after `commitOneDoc` was fixed. The
stated rule — *after any correctness fix to shared logic, grep the whole tree for
the pattern you just fixed* — is a process control, not a mechanical one.

### B3. Views that look like tables

`customers` and `ap_suppliers` are compatibility views over `parties`. Three
things silently break on them: new foreign keys, `GROUP BY` on their columns, and
`ON CONFLICT`. Only the second is guarded by a test. `customers_legacy` and
`ap_suppliers_legacy` still hold pre-migration data and have not been dropped.

### B4. Two settlement graphs keyed on different ids

`transaction_links` (native, `numeric`, keyed on `journal_entries.id`) and
`payment_applications` (QuickBooks mirror, `real`, keyed on `invoices.id` plus
the raw QBO id). They are bridged on the read side, but any new code touching
settlement has to know which one applies and how to join them
(through `invoices.journal_entry_id`). Open balance likewise has two answers.
Unification is planned and not done.

### B5. Money as `real()` on the AR mirror

`invoices.amount/total/paid`, `payment_applications.amount_applied` and others
are `real` — a binary float. The native ledger correctly uses `numeric(14,2)`
and a test enforces it *for the ledger*, but the mirror tables predate that rule
and were not migrated. Rounding drift is possible on aggregates.

### B6. Deliberate duplicate purchase-order screens

`/payables/purchase-orders` and `/accounting/trade/purchase-orders` are two real
screens over the same concept. Merging them is an intentional Phase 1b deferral.
It is written down precisely so nobody "fixes" it on sight without that context —
but it remains a live source of confusion.

### B7. Large files that concentrate risk

`components/board-list.tsx` (2,949 lines), `lib/qbo-sync.ts` (2,366),
`app/(app)/admin/leads/page.tsx` (2,406), `app/(app)/reports/page.tsx` (1,721),
`app/(app)/dashboard/page.tsx` (1,713). `db/schema.ts` is 3,145 lines in one
file. These are also among the highest-churn files in the history.

### B8. Overlapping schedulers

QuickBooks and Xero sync are scheduled on **both** Vercel Cron and Inngest, at
adjacent times. Nothing states which is authoritative.

---

## C. Incomplete work, clearly marked in the code

### C1. The native general ledger for provider organisations is shadow-only

`ingestOrgTransactions` is called from `scripts/qbo-gl-ingest.ts` **and nowhere
else** — not the sync, not a cron, not the webhook handler.
`tests/architecture.test.ts` pins it there deliberately. The consequence stated
plainly in `CLAUDE.md`: *a full sync today still puts nothing in the GL, and the
native Trial Balance is still empty for a QuickBooks organisation.*
`/reporting/trial-balance` is a QuickBooks passthrough and is currently the only
trial balance such an organisation can see.

Blocking decision on record and unresolved: **history cutoff**. Ingesting from a
cutoff date needs an opening-balance journal at that date or the trial balance
will not tie, and that is not built. Ingesting all history avoids it. The
recommendation on record is all history.

### C2. Deposit line removal in QuickBooks is unresolved

A full update on a QuickBooks Deposit returns 200 OK but keeps every line omitted
from the payload. A delete-and-recreate fix was reverted because it changes the
deposit's internal id and resets bank reconciliation. **Do not ship another
deposit-line-removal fix on the money path until the `deposit-reduce` diagnostic
settles whether an in-place line delete is possible at all.**

### C3. Batch idempotency window

If a QuickBooks write succeeds but the process dies before `recordItem` commits,
a retry reprocesses the item — a possible duplicate create whose id is never
logged, so Undo cannot find it either. The window is one database write. It
predates the shared engine and is explicitly unaddressed.

### C4. Inventory gaps

Not built, and named as such: unit-of-measure conversion on bill/invoice/BOM
lines (quantity is assumed base UoM outside PO/SO/receiving/shipping); sales and
purchase return inventory movement; standard-cost variances; multicurrency GR/IR
and AR/AP foreign-exchange variance. Credit notes and vendor credits do not move
stock.

### C5. White-label is partial

Branded subdomains cover four pre-auth pages. **Outbound email branding is not
done at all** — `lib/system-mailer.ts`'s layout and every transactional subject
hardcode "Prime Accountax" globally with no per-org parameter. Fully custom
customer-owned domains are also out of scope. And the code alone does not make
any subdomain resolve: a wildcard domain on the Vercel project plus wildcard DNS
is a manual step outside this repository.

### C6. No Accounting-scoped list views for Invoices, Bills or Expenses

Only the global `/invoices` AR screen and the `/accounting/new/[type]` create
forms exist. Flagged during the module restructure, not invented.

### C7. Resource Management is scheduling only

Time tracking (actual hours) and billing integration are deferred; the Phase 1
data model carries neither a rate nor a billable flag.

---

## D. Smaller debt

| Item | Detail |
|---|---|
| `.env.example` is five variables; the code reads fifty-plus | Anyone following `README.md` will get a non-working setup |
| `README.md` is stale | Describes an `(auth)` route group that no longer exists, tells you to use `db:push`, and describes a first-account-becomes-admin behaviour that may no longer hold |
| `groq-sdk` is a dependency with zero imports | Dead weight in the install |
| `DISABLE_PUBLIC_SIGNUP` documented but unreferenced | Setting it does nothing |
| `/api/debug-auth` still listed as public in middleware | Handler is a 404 stub; the entry is stale |
| Session lifetime declared as both 8 hours and 30 days | `lib/auth.ts` versus `auth.config.ts` |
| `CRON_SECRET` guards are inconsistent | Some routes return 500 when unset, others compare against `Bearer undefined`. All fail closed, but differently. |
| Five `/api/migrate/*` routes | One-off SQL patches kept as live endpoints rather than scripts |
| No Content-Security-Policy | The rest of the header set is thorough |
| No dependency scanning | No `npm audit` in CI, no Dependabot configuration |
| `tsconfig.tsbuildinfo` is committed | 47 of the last 300 commits touched it |
| Documentation is scattered across the root | `CLAUDE.md`, `PROJECT-REFERENCE.md` (1,232 lines), `DEPLOY.md`, `SETUP-GUIDE.md`, `INTEGRITY_AUDIT.md`, `IT-ADMIN-EMAIL.md`, plus this `/docs` set. Overlapping and partly contradictory. |

Only **one** `TODO`/`FIXME` marker exists in the entire `lib/`, `app/`,
`components/` and `inngest/` tree. Debt here is recorded in prose, not in
markers — which is why `CLAUDE.md` must be read.

---

## E. Dependency currency

Not scanned — `npm audit` contacts the npm registry, outside the read-only-local
boundary of this exercise. Versions worth a deliberate look:

| Package | Pinned | Note |
|---|---|---|
| `next` | 14.2.5 | Next 15 is current; 14.2.5 is a specific, non-caret pin |
| `next-auth` | `5.0.0-beta.20` | **A beta release on the authentication path.** |
| `drizzle-orm` / `drizzle-kit` | 0.30.10 / 0.21.4 | Both well behind current |
| `vitest` | `^2` | Pinned deliberately — v5 wants `@types/node >= 22`, this repo pins 20 |
| `@types/node` | `^20` | Pins the Node major across CI and tooling |
| `xlsx` | `^0.18.5` | The npm-registry build of this package has a history of advisories; worth checking the source |
| `stripe` | `^22`, API version pinned in code | |

*Recommended next step:* run `npm audit` and `npm outdated` in an environment
where registry access is acceptable, and record the result here.

---

## F. Open questions for the original team

Numbered, each with the evidence that prompted it.

1. **What is the history cutoff for QuickBooks GL ingestion?**
   *Evidence:* `CLAUDE.md`, "Open decision: history cutoff"; `lib/accounting/qbo-gl.ts`. Ingesting from a cutoff needs an opening-balance journal that does not exist; ingesting all history avoids it. The recommendation on record is all history — is that agreed?

2. **When the GL ingestion is wired into the live sync, who updates `tests/architecture.test.ts`, and in which commit?**
   *Evidence:* the test deliberately pins ingestion to the CLI, and `CLAUDE.md` says the test is the thing to update, deliberately, in the same commit. Nothing says who owns that.

3. **Are the Vercel Cron provider-sync paths still wanted?**
   *Evidence:* `vercel.json` schedules `/api/cron/qbo-sync` at 02:00 and `/api/cron/xero-sync` at 03:00, while Inngest runs `qboSyncScheduler` at 03:00 and `xeroSyncScheduler` at 02:00. Two schedulers, adjacent times, no statement of which is authoritative.

4. **Can a line be removed from a QuickBooks Deposit in place at all?**
   *Evidence:* `CLAUDE.md`, "Open investigation". A full update returns 200 and keeps omitted lines; delete-and-recreate was reverted for resetting bank reconciliation. The `deposit-reduce` diagnostic was to settle it. What did it find?

5. **Is the wildcard domain `*.primeaccountax.com` actually attached to the Vercel project, with matching DNS?**
   *Evidence:* `next.config.js` allows the origin and `middleware.ts` parses the subdomain, but `CLAUDE.md` flags the domain and DNS as a manual step "outside this codebase". Without it, no customer's branded subdomain resolves.

6. **Are `customers_legacy` and `ap_suppliers_legacy` still needed?**
   *Evidence:* migration `0079_unify_parties.sql` kept them as an audit trail, "not yet dropped". Is there a retention requirement, or can they go?

7. **Which of the root markdown files is authoritative?**
   *Evidence:* `CLAUDE.md`, `PROJECT-REFERENCE.md`, `DEPLOY.md`, `SETUP-GUIDE.md`, `INTEGRITY_AUDIT.md` overlap. `CLAUDE.md` reads as the living one; `README.md` is demonstrably stale. Should the others be folded into `/docs` or retired?

8. **Is there an external uptime monitor pointed at `/api/health`, and does anyone receive smoke-test failures?**
   *Evidence:* the endpoint and the workflow exist; no alerting configuration exists anywhere in the repository. A red run is a GitHub notification and nothing more.

9. **Is `SMOKE_EMAIL` / `SMOKE_PASSWORD` configured in the repository secrets?**
   *Evidence:* `.github/workflows/smoke.yml` says the signed-in checks — which cover the exact route that once 500'd for days — only run when they are set.

10. **Should `invoices.source` be backfilled and made trustworthy, or removed?**
    *Evidence:* `CLAUDE.md` states it is read nowhere and is unreliable. It is still written by two paths and is a standing trap.

11. **Is there a data-retention or data-subject-request obligation?**
    *Evidence:* personal data is stored (contact names, emails, phone numbers); no purge, export or erasure mechanism exists; `/privacy` and `/terms` pages exist but nothing in the repository states a policy.

12. **Is `next-auth` `5.0.0-beta.20` a deliberate pin, and what is the plan for reaching a stable release?**
    *Evidence:* `package.json`. A beta on the authentication path is a standing risk.

13. **What is the intended relationship between the `reporting_enabled` boolean and the module registry?**
    *Evidence:* `CLAUDE.md` says it is intentionally not folded in and should not be extended — but it remains a second, parallel gating mechanism for a whole workspace.

14. **Is the mobile application in active development?**
    *Evidence:* `mobile/` is excluded from `tsconfig.json` and CI; `CLAUDE.md` records it has "not yet run on a device or simulator". The web app nonetheless carries a bearer-token auth path and 12 `/api/mobile/*` routes maintained for it. (Out of scope for this documentation set by instruction, but it affects web-side decisions.)

---

## G. Suggested priority order

Based only on what is visible in the repository:

1. **Make migration ordering mechanical** (A2) — this class of failure loses data silently.
2. **Answer open questions 1 and 4** — both block money-path work.
3. **Turn on `npm audit` and dependency scanning** (E), then decide about `next-auth` (question 12).
4. **Confirm the smoke secrets are set** (question 9) — it is a one-line fix to the only control that sees customer-visible breakage.
5. **Refresh `README.md` and `.env.example`** (D) — the cheapest fix with the highest onboarding return.
6. **Unify the settlement graphs** (B4) — already planned, and it removes a whole category of "which one applies here".
7. **Migrate the AR mirror money columns to `numeric`** (B5).

## Sources

`CLAUDE.md`; `INTEGRITY_AUDIT.md`; `README.md`; `PROJECT-REFERENCE.md`;
`package.json`; `next.config.js`; `tsconfig.json`; `vercel.json`;
`db/migrations/` and `meta/_journal.json`; `tests/architecture.test.ts`;
`.github/workflows/smoke.yml`; `lib/accounting/qbo-gl.ts`;
`lib/batch/lease.ts`; `lib/batch/commit-one.ts`; `lib/system-mailer.ts`;
`scripts/qbo-gl-ingest.ts`; `git log` file-churn analysis.
