# Development Guide

- **Purpose:** Get the app running, run the checks, and make the most common kinds of change safely.
- **Audience:** A developer on day one.
- **Last verified against:** commit `3eec3df` (2026-09-17)
- **Primary sources:** `package.json`, `README.md`, `SETUP-GUIDE.md`, `vitest.config.ts`, `tests/`, `scripts/`, `CLAUDE.md`

## Prerequisites

- **Node.js 20** (`engines: { node: ">=20" }`; CI uses 20 to match the pinned `@types/node` major).
- **A Neon Postgres database.** A free-tier project is enough. Use a **branch** for anything you might break.
- A `.env.local`. See [07-configuration-and-environments.md](07-configuration-and-environments.md) for the real variable list — `.env.example` covers only five of them.

Minimum to boot the app and sign in: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`.
Add `ENCRYPTION_KEY` before you connect any mailbox or accounting provider, or
their secrets will be stored as plaintext (you will get one `console.warn`).
Anything touching QuickBooks, Xero, Stripe or email needs those credentials too.

## Local setup

```bash
npm install
cp .env.example .env.local   # then fill in the real values
npm run db:migrate           # apply migrations to YOUR database
npm run dev                  # http://localhost:3000
```

> **Do not use `npm run db:push`** for schema changes, even though `README.md`
> suggests it. It writes the schema directly and skips the migration files, which
> is the mechanism behind the migration drift described in
> [04-data-model.md](04-data-model.md). Two production bugs were traced to
> exactly this. Use `db:generate` + `db:migrate`.

First account: create one through `/register`. [UNVERIFIED] `README.md` says the
first account becomes an admin automatically; the registration flow now goes
through `pending_registrations` and Stripe, so confirm against
`app/api/register/*` before relying on it.

Seed data: `npm run db:seed` (or `POST /api/seed`, which refuses to run when
`NODE_ENV=production`).

## Running the checks

```bash
npm test          # vitest — 17 files, 252 tests
npm run typecheck # tsc --noEmit — must be clean
npm run test:watch
```

Both are green at this commit. `npx tsc --noEmit` is the authoritative check,
because `next build` has `ignoreBuildErrors: true`.

**A local `next build` may legitimately fail** at page-data collection for routes
that need real Stripe or Intuit keys. That is an environment gap, not a type
error — which is exactly why CI does not run it either.

## Testing strategy

The suite is deliberately built around **the bugs that actually reached the
paying client**, not around coverage.

**Unit tests only — no database, no network.** Every defect that shipped in the
worst week lived in a pure function and would have been caught here. Anything
needing a real database belongs in `scripts/reconcile-foundation.ts` or
`/admin/reconcile`, which run against production; CI has no database and a
fabricated one proves nothing.

| Test file | Covers |
|---|---|
| `architecture.test.ts` | 13 structural rules (see below) |
| `date-display.test.ts` | Every formatter across seven timezones, UTC−8 to UTC+14, including a half-hour offset and DST boundaries |
| `ledger-invariants.test.ts` | Balance, one-side-per-line, account validation |
| `portal-submit.test.ts`, `portal-url.test.ts` | Portal response building; safe host detection |
| `ar-email.test.ts` | The branded template, including the double-pay-button dedup rule |
| `qbo-gl.test.ts`, `qbo-gl-mappers.test.ts` | Pure QuickBooks-to-GL mapping across 12 posting entities |
| `qbo-pay-button.test.ts` | PDF stamping, idempotency, and safe failure |
| `qbo-webhooks.test.ts` | Entity partitioning |
| `batch-update-safety.test.ts`, `batch-purchase.test.ts`, `batch-group-docs.test.ts` | Data Studio update safety and document grouping |
| `due-filters.test.ts`, `as-at.test.ts` | Due-date filtering and as-at receivable scoping |
| `email-template.test.ts`, `send-grouping.test.ts` | Template placeholder filling; send grouping |

`tests/architecture.test.ts` deserves a special mention: it is a set of
grep-based structural assertions — no QuickBooks report may serve a product
report, no client component may import `lib/modules-server.ts`, no `GROUP BY` on
a view column, no `real()` for money in the ledger, no date pinned to UTC
midnight and formatted locally, the Google verification file stays reachable.
Each was written after a real incident and each was **proven to fail on the
violation** before being committed.

**Constraints to respect**

- **vitest is pinned to `^2`.** v5's peer range wants `@types/node >= 22`; this repo pins 20.
- **`vite-tsconfig-paths` cannot be used** — it is ESM-only and cannot be required here. `vitest.config.ts` declares the `@/` alias directly. Keep it in step with `tsconfig.json`'s `paths`.
- **Do not import a route handler into a test.** Route handlers pull in `db` and `next/headers`. Extract the logic into `lib/` instead; `lib/portal-response.ts` and `lib/ar-email.ts`'s `appendPayButton` are the two worked examples, both behaviour-identical moves.

## Debugging

| Situation | Approach |
|---|---|
| A page 500s locally | Check the terminal — server components and route handlers log there, not in the browser console. |
| A query looks wrong | Confirm your local database is actually current: `select max(created_at) from drizzle.__drizzle_migrations` against `db/migrations/meta/_journal.json`. A stale local copy with realistic data has produced a full set of credible, wrong conclusions before. |
| Ledger numbers do not agree | Run `/admin/reconcile` or `npx tsx scripts/reconcile-foundation.ts`. |
| A background job did not run | Check the Inngest dashboard first. Confirm the function is registered in **all three** places: `inngest/functions/`, `inngest/index.ts`, `app/api/inngest/route.ts`. |
| A style is missing | You probably built a Tailwind class name at runtime. The scanner only sees literal strings. Also check `content` includes `lib/**`. |
| A provider call fails | `qbo_sync_log` / `xero_sync_log` / `sage_sync_log`, and `/api/qbo/webhook-health`. |
| Something about Data Studio updates | Test `shapeModifyPayload` directly — it is pure, no I/O. **Do not** monkey-patch `qboPost` / `qboReadOne` from outside the module in a `tsx` script: module interop does not preserve ESM live bindings for named function imports, so the patch silently no-ops and the real functions run. |

## Branching and release

- Branch off `main` for anything non-trivial. **`main` auto-deploys to production.**
- CI runs on every push to `main` and every pull request.
- **Commit messages are detailed and explain the why** — a fresh session should be able to reconstruct recent work from `git log`. This is a real convention here, visible across 1,231 commits, not an aspiration.
- No tags, no changelog, no release branches. The deployed version is whatever `main` is.

## Recipes for common changes

### Add an API endpoint

1. Create `app/api/<area>/<name>/route.ts`.
2. First lines:
   ```ts
   const { error, orgId, role } = await requireOrg();
   if (error) return error;
   ```
3. Validate every client-supplied foreign key with `ownsInOrg(table, id, orgId)` (or `userInOrg` for a `users` reference). A Postgres foreign key does not prove tenancy.
4. If the feature belongs to a gated module, add `requireModule(orgId!, "<key>")`.
5. Put the logic in `lib/`; keep the handler thin.
6. Return `ok(data)` or `bad(message, status)`.

### Add a database column

1. Edit `db/schema.ts`.
2. `npm run db:generate` and **read the generated SQL**.
3. For a hand-written migration, put `--> statement-breakpoint` between statements.
4. Check `db/migrations/meta/_journal.json`: the new entry's `when` must be **strictly greater** than the previous one. Drizzle silently skips otherwise — this dropped a table in production once.
5. Apply to a **Neon branch** first. Do not run `NOT NULL` or deletions until a backfill is verified.
6. `npm run db:migrate`, then deploy (production migrates as part of `vercel-build`).

### Add a page

1. Create the directory under the owning workspace in `app/(app)/`.
2. Decide ownership by the rule: **Supply Chain owns what moves physical goods; Accounting owns what moves money.**
3. Add a nav entry in `components/sidebar.tsx` under a **named** group — never "Other", "More" or "Misc".
4. If it links to a shared entity owned by another workspace (`/customers`, `/payables/suppliers`, `/projects`), add its path to the same "no module" bucket so the sidebar does not snap away from the user's current workspace.

### Add a form

Compose from `components/form-kit.tsx`: `<Field>` (label → control → hint/error),
`<Section>`, `<SelectField>` / `<CellSelect>` (custom chevron — never rely on the
native OS `<select>` arrow), and the `control` (for stone-950 panels) /
`controlInset` (for stone-900 drawer panels) / `cell` / `th` tokens. Do not
hand-roll input class strings; that is how the forms drifted into inconsistency
before.

### Add a background job

Three edits, all required:

1. Define it in `inngest/functions/<file>.ts`.
2. Export it from `inngest/index.ts`.
3. Register it in the `functions` array in `app/api/inngest/route.ts`.

For long-running work, use `lib/batch/lease.ts`'s primitives rather than looping
inside a request.

### Add a Data Studio entity

Add to `ENTITIES` in `lib/batch/entities.ts`. **Three things must agree, or a
column is a lie:**

1. `columns` — what the header row promises
2. `toRows` — what the export actually fills in
3. `build` — what the import actually reads back

A column in (1) but not (2) exports blank; missing from (3) means the user's edit
is silently discarded. Bank Deposits had nine such columns. Prefer a scripted
round-trip check (realistic payload → `toRows` → xlsx → `build`) over eyeballing.
Dropdowns go in `lib/batch/dropdowns.ts`, shared by the template **and** the
export — the export is the file people actually edit, so it needs them most.

### Post to the ledger

Call `postJournalEntry` (`lib/ledger.ts`) or `postDocument`
(`lib/accounting/documents.ts`). Never insert into `journal_entries` directly.
Afterwards, run the reconciliation.

### Render a date

Use `lib/format.ts` (`formatDate`, `formatDateShort`, `formatDateLong`,
`formatDateUS`, `fmt.date`, `fmt.shortDate`). Never call
`.toLocaleDateString()` on a due/invoice/transaction/promise date, and never
write `+ "T00:00:00Z"` — that names the same instant and is the same bug.

## Rules that will save you a bad afternoon

1. **There are no transactions.** `db.transaction()` throws. Validate fully, write, compensate on failure.
2. **Never trust the JWT.** Re-derive authorisation from the database.
3. **`invoices.source` does not mean "native".** Use `journal_entry_id` versus the provider id columns.
4. **`customers` and `ap_suppliers` are views.** No new foreign key to them, no `GROUP BY` on their columns, no `ON CONFLICT`.
5. **After any correctness fix to shared logic, grep the tree for a second copy.** That is how `commit-runner.ts` kept running a fixed bug.
6. **Seven send paths render the invoice email.** Grep `renderInvoiceEmail` before assuming you covered them.
7. **Dates are strings.** A date is a date.
8. **Tailwind class names must be literal.**

## Sources

`package.json`; `README.md`; `SETUP-GUIDE.md`; `vitest.config.ts`; `tests/`;
`scripts/migrate.ts`; `scripts/smoke.ts`; `scripts/reconcile-foundation.ts`;
`lib/api.ts`; `lib/ledger.ts`; `lib/batch/entities.ts`;
`components/form-kit.tsx`; `components/sidebar.tsx`; `CLAUDE.md`; `git log`.
