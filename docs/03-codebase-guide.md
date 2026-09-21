# Codebase Guide

- **Purpose:** Where everything lives, what each area is responsible for, and where to put new code.
- **Audience:** A developer about to make their first change.
- **Last verified against:** commit `3eec3df` (2026-09-17)
- **Primary sources:** repository tree, `tsconfig.json`, `next.config.js`, `CLAUDE.md`

## Top-level map

```
ledger-app/
├── app/                    Next.js App Router — pages and API routes
│   ├── (app)/              Authenticated application shell
│   ├── (marketing)/        Public SEO landing pages and blog
│   ├── (rep-portal)/       Sales-rep-only portal
│   ├── api/                422 route handlers
│   ├── portal/[token]/     Customer response portal (no login)
│   ├── owner-portal/[token]/  Escalation owner portal (no login)
│   ├── approver/[token]/   Bill approver portal (no login)
│   ├── print/              Printable document renderers
│   ├── login, register, forgot-password, reset-password, admin-login
│   └── privacy, terms
├── components/             68 React components, all client-side
├── db/
│   ├── schema.ts           The entire schema, ~125 tables, 3,145 lines
│   ├── index.ts            Neon + Drizzle client with fetch retry
│   └── migrations/         87 .sql files + meta/_journal.json
├── lib/                    141 modules — all domain logic lives here
├── inngest/                Background job definitions
├── scripts/                Operational CLI scripts (tsx)
├── tests/                  17 Vitest files, 252 tests, no DB or network
├── public/                 Static assets, incl. Google verification files
├── mobile/                 Separate Expo project — OUT OF SCOPE here
├── middleware.ts           Edge auth gate and host routing
├── auth.config.ts          Edge-safe NextAuth config (middleware only)
├── next.config.js          Headers, redirects, Sentry wrap, external packages
├── vercel.json             Vercel cron schedule
└── CLAUDE.md               The living engineering log — read it
```

## Entry points

There are five ways into this system. Know all five before debugging anything.

| # | Entry point | File(s) | Auth |
|---|---|---|---|
| 1 | **Browser page request** | `app/**/page.tsx` via `middleware.ts` | Session cookie; role gates in middleware |
| 2 | **HTTP API call** | `app/api/**/route.ts` | `requireOrg()` etc., or `Authorization: Bearer` for mobile |
| 3 | **Vercel Cron** | 8 paths listed in `vercel.json` | `CRON_SECRET`; bypasses session auth in middleware |
| 4 | **Inngest** | `POST /api/inngest` serving 15 functions | HMAC signature against `INNGEST_SIGNING_KEY`, verified by the SDK |
| 5 | **Provider webhooks** | `app/api/webhooks/{qbo,xero,stripe}/route.ts` | Signed payload verified per provider |

A sixth, human-driven entry point: `scripts/*.ts` run with `tsx` against a
database URL from the environment.

## `app/` in detail

### `app/(app)/` — the authenticated shell

`app/(app)/layout.tsx` is a **client component**. It composes `AuthProvider`,
`DataProvider`, `ThemeProvider`, the sidebar, org switcher, create menu, alert
bell, global search and the subscription gate. Every authenticated page renders
inside it, except `/admin/*` and `/ar-report/*`, which get a clean shell.

Pages are organised into six workspaces (`components/sidebar.tsx`, `WORKSPACES`):

| Workspace | Root path | Module gate |
|---|---|---|
| Receivables | `/dashboard`, `/board`, `/invoices`, `/customers`, `/projects`, `/responses` | core |
| Payables | `/payables/*` (15 sections) | core |
| Supply Chain | `/supply-chain/*` | `manufacturing` |
| Accounting | `/accounting/*` (journal, transactions, trade, reports, products, parties) | core |
| Resources | `/resources/*` | `resources` |
| Reporting | `/reporting/*` | `organisations.reporting_enabled` |
| Studio | `/batch/*` (upload, modify, delete, bulk-edit, download, scheduled, history) | core |

Plus `/admin/*` — the platform back office, reached in production through the
`admin.primeaccountax.com` host rewrite.

**The placement rule**, stated in `CLAUDE.md` and worth repeating because it
settles most arguments: *Supply Chain owns everything that moves physical goods
or commits to moving them; Accounting owns everything that moves money or
records what already moved.* Estimates stay in Accounting (a quote commits
nothing); purchase and sales orders live in Supply Chain (a commitment to move
goods).

Also from `CLAUDE.md`, and enforced socially rather than mechanically: **no
sidebar or Create-menu group may be named "Other", "More" or "Misc".** If
something does not fit a named group, a named group is missing.

### `app/api/` — route handlers

Largest groups, by handler count: `admin` (97), `payables` (36), `inventory`
(33), `batch` (30), `invoices` (14), `qbo` (13), `mobile` (12), `reporting` (10),
`cron` (10).

Conventions:
- One `route.ts` per path; exported `GET` / `POST` / `PATCH` / `DELETE`.
- First line of a protected handler is `const { error, orgId, role } = await requireOrg();` followed by `if (error) return error;`.
- Return via `ok(data)` / `bad(message, status)` from `lib/api.ts`.
- 47 routes declare `export const runtime = "nodejs"` explicitly; one declares `"edge"`. The rest inherit the default.

### Public, token-authenticated pages

`app/portal/[token]/`, `app/owner-portal/[token]/`, `app/approver/[token]/`.
These are listed explicitly in `middleware.ts` as public. Their authorisation is
the token itself, re-validated on every request against the database, including
an ownership re-check for the owner portal.

## `lib/` in detail

This is where the system actually lives. Grouped by responsibility:

| Group | Modules | Responsibility |
|---|---|---|
| **Platform** | `api.ts`, `auth.ts`, `credentials.ts`, `mfa.ts`, `billing.ts`, `modules.ts`, `modules-server.ts`, `crypto.ts`, `rate-limit.ts`, `audit.ts`, `mobile-auth.ts`, `oauth-state.ts` | Session, tenancy, entitlement, secrets, audit |
| **Receivables** | `portal.ts`, `portal-response.ts`, `ar-aging.ts`, `ar-email.ts`, `stages.ts`, `escalation-types.ts`, `receivable-composition.ts`, `next-action.ts`, `send-grouping.ts`, `bulk-send.ts`, `receivables/*` | Collections board, portal, chasing, aging |
| **Accounting** | `ledger.ts` plus `accounting/` (24 modules: `documents.ts`, `financials.ts`, `reconcile.ts`, `links.ts`, `numbering.ts`, `payments.ts`, `period-close.ts`, `qbo-gl*.ts`, `standard-coa.ts`, `system-accounts.ts`, `trade-documents.ts`, `fx.ts`, …) | The general ledger and everything posting into it |
| **Inventory** | `inventory/` (14 modules: `valuation.ts`, `receiving.ts`, `shipping.ts`, `production.ts`, `jobwork.ts`, `manufacturing-orders.ts`, `item-kinds.ts`, `genealogy.ts`, `uom.ts`, …) | Perpetual FIFO stock and manufacturing |
| **Provider sync** | `qbo-sync.ts` (2,366 lines), `qbo-ap-sync.ts`, `qbo-token.ts`, `qbo-pay-button.ts`, `qbo-aging-report.ts`, `qbo-webhook-entities.ts`, `xero-sync.ts`, `xero-ap-sync.ts`, `xero-token.ts`, `sage-sync.ts`, `sage-ap-sync.ts` | Mirroring third-party books |
| **Data Studio** | `batch/` (30 modules incl. `entities.ts`, `lease.ts`, `commit-one.ts`, `chunk-runner.ts`, `builders.ts`, `row-mappers.ts`, `dropdowns.ts`, `xero/*`) | Bulk import/export/update/delete |
| **Delivery** | `mailer.ts`, `system-mailer.ts`, `gmail.ts`, `microsoft.ts`, `admin-mailbox.ts`, `email-template.ts`, `email-ref.ts`, `spam.ts`, `statement-pdf.ts`, `approval-pdf.ts` | Outbound and inbound email, PDFs |
| **Reporting** | `reporting/` (`engine.ts`, `source.ts`, `attributes-meta.ts`, `statement-template.ts`, `types.ts`), `export-report.ts` | Report definitions and rendering |
| **Platform admin / CRM** | `admin/` (`accounts.ts`, `activities.ts`, `campaigns.ts`, `emails.ts`, `billing-state.ts`, `page-guides.ts`, `provisioning/provision-customer.ts`), `opportunities.ts`, `pipeline.ts` | Back office |
| **Shared utilities** | `format.ts`, `countries.ts`, `regions.ts`, `search.ts`, `rep-scope.ts`, `guide-content.ts`, `marketing-data.ts`, `blog-data.ts`, `competitors-data.ts` | |

Two files carry disproportionate weight and should be read before changing
anything near them: **`lib/api.ts`** (tenancy) and **`lib/ledger.ts`** (posting).

## `components/`

All client components. Notable ones:

- `data-provider.tsx` — the client-side data context. Loads customers, contacts, projects, invoices, communications, tasks, reps, regions, countries and `orgSettings` once and exposes mutators. Much of the app reads from here rather than fetching per page.
- `sidebar.tsx` — navigation and the workspace switcher; also the module-gate consumer.
- `form-kit.tsx` — **the single source of truth for form field styling.** Use `<Field>`, `<Section>`, `<SelectField>` / `<CellSelect>` and the `control` / `controlInset` / `cell` / `th` tokens. Do not hand-roll input class strings in feature components.
- `ui.tsx` — primitives (buttons, toast, table shells).
- `board-list.tsx` — the collections board.
- Console components — `receiving-console.tsx`, `shipping-console.tsx`, `production-console.tsx`, `mo-console.tsx`, `jobwork-console.tsx`, `reconcile-console.tsx`.

## Conventions

- **Path alias:** `@/` maps to the repository root (`tsconfig.json`, mirrored in `vitest.config.ts` — keep the two in step).
- **Naming:** files are kebab-case; exported functions are camelCase; Drizzle table constants are camelCase and their SQL names snake_case.
- **Money:** `numeric(14,2)` in the native ledger, written as `.toFixed(2)` strings. `fmt.money()` deliberately rounds to whole numbers for display only.
- **Dates:** date-only values are `varchar(16)` holding `YYYY-MM-DD`. Always render through `lib/format.ts`. Never call `new Date()` on one, and never append `T00:00:00Z`.
- **Tailwind:** class names must be literal strings. Build them with explicit ternaries, never string concatenation or `.replace`. The `content` globs must include `lib/**`.
- **Comments:** this codebase comments the *why*, often at length, usually with the incident that motivated the code. Match that when you touch it.

## Where to add new code

| You want to… | Do this |
|---|---|
| Add an API endpoint | New `app/api/<area>/<name>/route.ts`. Start with `requireOrg()`. Put logic in `lib/`, not the handler. |
| Make route logic testable | Extract a pure function into `lib/` and import it from the handler. Pattern: `lib/portal-response.ts`, `lib/ar-email.ts`. Do not import route handlers into tests — they pull in `db` and `next/headers`. |
| Add a database column | Edit `db/schema.ts`, run `npm run db:generate`, review the SQL, check `meta/_journal.json` has a strictly greater `when`, test on a Neon branch, then `npm run db:migrate`. |
| Add a page | New directory under `app/(app)/<workspace>/`. Add a nav entry in `components/sidebar.tsx` under a **named** group. |
| Add a form | Compose from `components/form-kit.tsx`. |
| Gate a feature per organisation | Add a `ModuleKey` in `lib/modules.ts`; call `requireModule()` in every route for it; gate the nav entry. The admin card picks new keys up automatically. |
| Add a background job | Define it in `inngest/functions/`, export from `inngest/index.ts`, **and register it in `app/api/inngest/route.ts`** — all three, or it silently never runs. |
| Add a Data Studio entity | Add to `ENTITIES` in `lib/batch/entities.ts` with `columns`, `build`, `toRows`, `refs`. Verify all three agree by round-tripping a realistic payload. |
| Post to the ledger | Call `postJournalEntry` (`lib/ledger.ts`) or `postDocument` (`lib/accounting/documents.ts`). Never insert into `journal_entries` directly. |
| Add a shared entity link across workspaces | Follow the `/customers`, `/payables/suppliers`, `/projects` precedent: add the path to the "no module" bucket in `components/sidebar.tsx` so the sidebar does not snap to another workspace. |

## If you change X, also check Y

| Change | Also check |
|---|---|
| `lib/ar-email.ts` or anything about invoice emails | **Seven** send paths — grep `renderInvoiceEmail`. Four are server-side, two are client-side (`components/send-invoices-modal.tsx`, `components/feature.tsx`), one is the free-text composer handled server-side in `app/api/email/send/route.ts`. |
| Anything in `lib/batch/commit-one.ts` | Grep the tree for a second copy of the pattern. `commit-runner.ts` once held its own inline duplicate of the update logic and kept running the old, broken version. |
| `db/schema.ts` | `db/migrations/` must contain the matching SQL, and `meta/_journal.json` the matching entry. A hand-applied or `db:push` change with no migration file is invisible until someone migrates a fresh database. |
| `tsconfig.json` `paths` | `vitest.config.ts` alias. |
| Posting, bridging or settlement logic | Run `scripts/reconcile-foundation.ts` or `/admin/reconcile`. |
| Wiring the QuickBooks GL ingestion into the live sync | `tests/architecture.test.ts` pins it to the CLI — update that test deliberately, in the same commit. |
| A date formatter | `tests/date-display.test.ts` runs across seven timezones. |

## Sources

Repository tree; `app/(app)/layout.tsx`; `components/sidebar.tsx`;
`components/data-provider.tsx`; `components/form-kit.tsx`; `lib/api.ts`;
`lib/format.ts`; `lib/batch/entities.ts`; `app/api/inngest/route.ts`;
`tsconfig.json`; `vitest.config.ts`; `CLAUDE.md`.
