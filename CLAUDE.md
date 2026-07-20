# Prime Accountax — project guide for Claude Code

> This file is auto-loaded at the start of every Claude Code session in this repo,
> on any machine. Keep it current: when a hard-won gotcha or architectural
> decision emerges, add it here so no session (or teammate) relearns it.

## What this is

**Prime Accountax** (primeaccountax.com) — a multi-tenant SaaS for **accounts
receivable (AR) management & collections**, integrated with **QuickBooks Online
and Xero**. It syncs invoices/customers, automates branded payment reminders,
tracks promises & disputes, and reduces DSO. There's also an **accounts payable
(AP)** side and an in-progress **native accounting** engine (standalone GL, so an
org can run without QBO/Xero).

- **Stack:** Next.js 14 (App Router), TypeScript, Drizzle ORM, Neon Postgres,
  Tailwind, NextAuth, Stripe, Inngest (background jobs), deployed on Vercel.
- **Repo:** `github.com/khizaryarkhan/ledger-app`. Deploys auto on push to `main`.

## Run it

```bash
npm install
npm run dev            # Next dev server
npm run db:generate    # drizzle-kit: generate a migration from schema.ts
npm run db:migrate     # apply migrations (tsx scripts/migrate.ts) — runs on vercel-build too
```

Needs a `.env.local` (DATABASE_URL, AUTH_SECRET, ENCRYPTION_KEY, Stripe keys, QBO/
Xero client ids, etc.). **Local DATABASE_URL ≠ production DB** — don't assume data
parity. Some API routes need real keys, so a local `next build` can fail at
page-data collection for those routes even when the code is fine (e.g. an
accounting route needing an Intuit key) — that's an env gap, not a type error.
Verify changes with `npx tsc --noEmit`, which should be clean.

## Architecture & conventions

- **Multi-tenant:** every query is org-scoped. Helpers in `lib/api.ts` /
  `lib/billing.ts`: `requireOrg()`, `requirePlatformAdmin()`, `requireSuperAdmin()`
  (DB-revalidated, use for destructive/admin routes — never trust JWT alone).
- **Stripe is the source of truth for billing.** Never hand-edit billing state.
  Card data never touches the app (out of PCI scope).
- **Secrets** (mailbox passwords, OAuth tokens) are encrypted at rest via
  `lib/crypto.ts` (AES-256-GCM, keys from ENCRYPTION_KEY/AUTH_SECRET).
- **Real 1:1 collection emails** send from the admin's own connected mailbox
  (Gmail/Microsoft/SMTP). `support@foodready.ai`-style system mail is only for
  transactional/system messages.
- **Money:** `fmt.money()` in `lib/format.ts` deliberately rounds to whole
  numbers for scannability. GL/ledger columns use `numeric(14,2)` (stored as
  `.toFixed(2)` strings for Drizzle).
- **Theming:** app supports Dark/Light/System via CSS variables. The Tailwind
  palette (stone + accent steps) resolves through `rgb(var(--…))` in
  `tailwind.config.js`; token values live in `app/globals.css` (`:root` = dark,
  `[data-theme="light"]` = light). `ThemeProvider` (set on the app shell only)
  stamps `data-theme`. **Never build Tailwind class names at runtime** (string
  concat/`.replace`) — the scanner only sees literal class strings, so dynamic
  ones silently render unstyled. Use explicit literal ternaries.

## ⚠️ Gotchas that have bitten us

- **neon-http has NO transactions.** `db.transaction()` throws. Use
  pre-validation + a single multi-row statement, or compensating deletes with
  loud error logs. Never assume atomicity across statements.
- **Hand-written migrations** in `db/migrations/` need `--> statement-breakpoint`
  between statements, and the `meta/_journal.json` entry's `when` must be
  GREATER than the previous (drizzle skips entries with an older/equal `when` —
  this silently dropped a table in prod once). Latest is `0025` at `when`
  `1783300000000`; keep incrementing.
- **Tailwind `content` globs must include `lib/**`** — classes defined in shared
  lib files were silently unstyled until it was added.
- Test migrations/backfills on a **Neon branch** before prod. Don't run
  destructive steps (NOT NULL, deletions) until a backfill is verified on prod.

## Key domain concepts

- **Collections Board** (`app/(app)/board/`, `components/board-list.tsx`): the
  daily working screen. Rows = open invoices, grouped Customer→Project.
- **Stage** is the single dynamic state per invoice. The pill shows the richest
  state: Escalated (`→ Owner · Type`), Disputed (`· reason`), **Broken
  commitment** (a promise whose date has passed — shown in red, NOT "Committed"),
  Committed (`· date`), or a plain stage. Escalation/Committed/Disputed each open
  an inline picker. Stage & customer response are unified: `recomputeInvoiceState`
  in `lib/portal.ts` syncs promise→Committed / dispute→Disputed and reverts.
- **Escalation types** (`lib/escalation-types.ts`): stage stays "Escalated"; the
  *type* (Handed Over, Final Account, Retention, Legal, etc.) is the "why".
- **Receivable Composition** (`lib/receivable-composition.ts`): shared classifier
  splitting open AR into workable / blocked / not-yet-due groups. Powers the
  Dashboard widget and the Board's click-to-filter strip. Chart colors are
  validated per theme (3 semantic hues: rose=blocked, sky=workable,
  emerald=current) — don't hand-pick a hue per category.
- **QBO Reports API:** modernized (`testing_migration=true`) is validated and in
  use. `app/api/reporting/[type]` serves native QBO/Xero reports (Reporting
  module, gated by `organisations.reporting_enabled`).
- **Owner escalation portal** (`app/owner-portal/[token]/`): no-login, token-auth,
  30-day expiry, ownership re-checked live on every request.

## Where things live

- `app/(app)/` — the authed app (dashboard, board, invoices, customers, payables,
  reporting, settings, admin, …). `app/(app)/layout.tsx` = shell + ThemeProvider.
- `app/api/` — route handlers. `app/owner-portal/`, `app/register/` — public.
- `components/` — `board-list.tsx`, `sidebar.tsx`, `data-provider.tsx` (client
  data context), `theme-provider.tsx`, UI primitives in `ui.tsx`.
- `db/schema.ts` — the whole schema. `db/migrations/` — SQL + `meta/_journal.json`.
- `lib/` — domain logic: `ledger.ts` (GL engine), `portal.ts` (recompute/tokens),
  `qbo-sync.ts`/`xero-sync.ts`, `mailer.ts`, `escalation-types.ts`,
  `receivable-composition.ts`, `format.ts`, `crypto.ts`, `api.ts`, `billing.ts`.
- `inngest/` — background jobs (scheduled chases). `scripts/` — migrate/seed/backfill.

## Working style

- Commit messages are detailed and explain the *why* — a fresh session should be
  able to reconstruct recent work from `git log`.
- Branch off `main` for anything non-trivial; `main` auto-deploys.
- End commit messages with the Co-Authored-By trailer.
