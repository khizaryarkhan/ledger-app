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

## Tests & CI (2026-09-12)

`npm test` (vitest) and `npm run typecheck` run on every push to `main` and
every PR via `.github/workflows/ci.yml`. Before this the repo had **zero**
automated tests; the suite is deliberately built around the bugs that actually
reached the paying client, not around coverage.

- **Unit tests only — no database, no network.** Every bug that shipped in the
  worst week lived in a pure function. Anything needing a real database belongs
  in `scripts/reconcile-foundation.ts` / `/admin/reconcile`, which run against
  production; CI has no database and a fabricated one proves nothing.
- **CI does NOT run `next build`** — several routes need real Stripe/Intuit
  keys and fail at page-data collection without them (see "Run it"), so a
  build here would go red for an env gap rather than a defect.
- **vitest is pinned to `^2`**: v5's peer range wants `@types/node >=22` and
  this repo pins 20. **`vite-tsconfig-paths` cannot be used** — it's ESM-only
  and can't be `require`d here, so `vitest.config.ts` declares the `@/` alias
  directly. Keep it in step with `tsconfig.json`'s `paths`.
- **To test route logic, extract it — don't import the route.** Route handlers
  pull in `db` and `next/headers`. Two extractions exist as the pattern to
  follow: `lib/portal-response.ts` (`buildPortalSubmission`, and
  `DISPUTE_CATEGORIES` moved here and re-exported from `lib/portal.ts` so
  existing imports are untouched) and `lib/ar-email.ts`'s `appendPayButton`
  (which owns the double-pay-button dedup rule). Both were behaviour-identical
  moves.

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
- **Money and quantity display (set 2026-09-21 — REVERSES the old rule).**
  `lib/format.ts` owns both, and nothing may build its own currency formatter;
  `tests/architecture.test.ts` enforces that and was proven against real
  violations.
  - **Money — minimum 2 decimals, up to 6, trailing zeros beyond the 2nd
    stripped.** `100 -> 100.00`, `1234.5 -> 1,234.50`, `1.2345 -> 1.2345`,
    `1.234567 -> 1.234567` (unit costs are `numeric(18,6)`; rounding them to
    cents misstates cost).
  - **Quantity — up to 5 decimals, never padded.** `10 -> 10`, `10.5 -> 10.5`,
    `10.12345 -> 10.12345`. A non-zero value that rounds to zero at 5dp renders
    as `<0.00001` rather than `0` — "no stock" and "a very little stock" are
    different facts.
  - `fmt.num2` is money without the symbol and uses the SAME decimals, so a
    figure does not change shape between a ledger column and a summary card.
  - **The old rule said `fmt.money()` "deliberately rounds to whole numbers for
    scannability".** That was overruled: an accounting product that hides cents
    is not scannable, it is wrong. **Nine independent copies** of the formatter
    existed with `maximumFractionDigits: 0` hard-coded, including the chase
    email a DEBTOR reads — so fixing `lib/format.ts` alone would have corrected
    three surfaces and silently left the rest rounding. They were found by the
    guard, not by looking.
  - **Not changed, deliberately**: `app/portal/**` and `app/api/portal/**` keep
    their own formatters. The customer portal is explicitly out of scope; it
    already shows cents (`maximumFractionDigits: 2`), differing only in that a
    round figure prints `100` rather than `100.00`.
- **Quantity columns are `numeric(_,6)`** (migration `0088`, 2026-09-21 — 28
  columns across 16 tables). They were all `numeric(_,4)`, so once display was
  raised to 5 decimals the database still could not hold a 5th and `10.12345`
  silently became `10.1235` on write. Widened by +2 on BOTH scale and precision
  (`numeric(18,4) -> numeric(20,6)`, `numeric(14,4) -> numeric(16,6)`) so the
  integer range is unchanged and no existing row could be rejected by the ALTER.
  - **Widening the columns achieved nothing on its own.** `round4()` and
    `.toFixed(4)` truncated every quantity in the engines *before* it reached
    the database, and inline `Math.round(q * 1e4) / 1e4` truncated it again on
    the way back out to a report. Both halves had to change together; either one
    alone leaves the user reading a figure the system has already discarded.
  - **`lib/inventory/round.ts` is the vocabulary, and the names carry the
    distinction**: `roundQty` / `nQty` = quantity (6dp), `round4` / `n4` = money
    at `numeric(_,4)` (movement `total_cost`, line `amount`, cached `inv_value`),
    `round6` / `n6` = unit cost or rate at `numeric(_,6)`. `n4` used to serve
    quantities *and* money in `valuation.ts`, which is precisely how the loss
    went unnoticed — never reintroduce one helper for both.
  - **`QTY_EPSILON` (`1e-6`) is the only "is this remainder zero?" threshold.**
    Every such test was a bare `0.0001`, which at 6dp storage closes a PO line
    that still has `0.00005` outstanding. The rule is: if the column cannot tell
    it from zero, it is zero — so the epsilon is tied to the column scale, not
    picked by feel. `reconcile.ts`'s `lot_placement_balances` tolerance moved
    the same way.
  - Scale **6**, not 5: it matches `unit_cost`/`exchange_rate`, which were
    already `numeric(_,6)`, and leaves headroom for UoM conversions that produce
    repeating decimals. **Display stays at 5** — the 6th decimal is for
    arithmetic, not for reading.
  - `tests/architecture.test.ts` guards all three properties (no quantity
    rounded at 4dp, no hand-written `0.0001` against a quantity, no schema
    quantity column below scale 6) and each guard was proven to fail on the real
    defect. `tests/number-display.test.ts` pins the round trip itself.
- GL/ledger columns use `numeric(14,2)` (stored as `.toFixed(2)` strings for
  Drizzle).
- **Theming:** app supports Dark/Light/System via CSS variables. The Tailwind
  palette (stone + accent steps) resolves through `rgb(var(--…))` in
  `tailwind.config.js`; token values live in `app/globals.css` (`:root` = dark,
  `[data-theme="light"]` = light). `ThemeProvider` (set on the app shell only)
  stamps `data-theme`. **Never build Tailwind class names at runtime** (string
  concat/`.replace`) — the scanner only sees literal class strings, so dynamic
  ones silently render unstyled. Use explicit literal ternaries.

- **Entry forms compose from `components/form-kit.tsx`** — the single source
  of truth for field styling (dark). Use `<Field>` (label→control→hint/error),
  `<Section>`, `<SelectField>`/`<CellSelect>` (custom chevron — never rely on the
  native OS `<select>` arrow), and the `control` (raised, for stone-950 panels) /
  `controlInset` (for stone-900 drawer panels) / `cell` / `th` tokens. Don't
  hand-roll input class strings in feature components — that's how the forms
  drifted into inconsistency before. The New Document form + all inventory
  drawers (Receiving/Shipping/Products/BOM/MO) are already on it.

## A form opens in a SIDE DRAWER (2026-09-23)

**Decision: the drawer is the norm, the centred dialog is the exception.**
`components/form-kit.tsx` exports `Drawer` + `DrawerFooter`; import them.

Why, beyond consistency: the list you came from stays visible behind it, a long
form has full height to use, and the primary action is **pinned** under the
scrolling body. That last part is not taste — the Send Invoices dialog shipped
with "Send 228 invoices" below the fold, because the whole box was
`max-h-[90vh] overflow-auto` and the footer scrolled with everything else.

- **Put the primary action in `footer`, never at the end of `children`.** That
  is the entire point of the drawer; a footer inside the scroll area is the
  defect above, rebuilt.
- **`DrawerFooter`** gives the standard Cancel + primary pair, with `err`
  (shown beside the button, where the eye already is), `pendingMsg` (work
  already committed — the only action left is Done), and `extra` (a
  left-aligned secondary action such as Delete, kept away from the primary).
- **The one thing that stays a centred dialog**: a short yes/no confirmation
  with no form in it ("Delete this?"). A three-line confirm in a full-height
  side panel is worse, and none of the drawer's justifications apply to it.
- **`Drawer` was defined SEVEN times** — once each in bom-register,
  resource-list, resource-board, shipping-console, products-register,
  mo-console and receiving-console — before it moved here, and the copies had
  already drifted: `wide` meant `max-w-md` in one file, `max-w-lg` in another
  and `max-w-2xl` in a third, and exactly ONE of the seven had the pinned
  footer. The other six rendered their footer inside the scroll area, so every
  one of those Save buttons could scroll out of reach on a long form. They all
  import the shared one now and all six gained the pin.
- **The sweep is DONE (2026-09-23) — every dialog in the app is now one of two
  shared components.** `components/ui.tsx`'s **`Modal` renders form-kit's
  `Drawer`**; it keeps its name and props only so its ~37 call sites did not
  each need rewriting. `Modal`'s sizes map onto the drawer's, which top out
  narrower on purpose (its old `xl`, max-w-6xl, lands at the drawer's `2xl`,
  max-w-4xl). **`center` is `Modal`'s only opt-out and means exactly one
  thing**: a short yes/no confirmation with no form in it. Roughly 45
  hand-rolled boxes across admin, settings, payables, leads, batch,
  trade-doc-list, board-list and the inventory consoles were converted at the
  same time. `Drawer` also gained `pad` (off when the caller's content brings
  its own padding), `size="2xl"` (for a panel that is genuinely a table) and
  `elevated` (z-[60], for quick-add, which opens from inside the New Document
  form — at the same z-index, DOM order would decide which wins).
- **What is deliberately NOT a drawer**, so don't "fix" these on sight: the two
  command palettes (`global-search.tsx`, admin's `_command-palette.tsx`) belong
  under the cursor; `subscription-gate.tsx` blocks the whole app rather than
  asking anything; two one-line "sent" acknowledgements have no form and no
  title bar; and `new-document-form.tsx` plus `accounting/transactions/[id]`
  are near-full-width document *sheets* (max-w-[1320px]/[1000px]), a different
  shape from a side panel. Each is named in the guards' allowlist with its
  reason — add to that list only with a reason of the same kind.
- `tests/architecture.test.ts` enforces four things: nothing defines a private
  `Drawer`/`DrawerFooter`, the shared one keeps the body as the only scroller,
  **no file builds its own centred dialog**, and **no file builds its own side
  panel**. The last two were the real gap — a private `function Drawer` was
  only the loudest way to get a second implementation; an inline `fixed
  inset-0` overlay was the quiet one, and that is how ~45 of them accumulated.
  All four are proven to fail on a real violation, not merely to pass.
- **Two things to preserve when converting a dialog**, both learned here: a
  submit button moved out of a `<form>` into `footer` needs `form="<id>"` or it
  silently stops submitting and stops honouring `required` (Sage connect); and
  a two-phase dialog (send → sent, import → imported) should resolve `footer`
  to `undefined` once the work is committed, leaving the result panel its own
  Done, rather than a live Send under something already sent.

## Module information architecture (Phase 1a, 2026-09-06)

Six top-level modules in the workspace switcher, in this order: **Receivables,
Payables, Supply Chain, Accounting, Reporting, Studio** (`components/sidebar.tsx`'s
`WORKSPACES` array). Supply Chain and Reporting only appear when their module
gate is on (`manufacturingEnabled` / `reportingEnabled`).

**The governing rule for where anything lives** (use this for every future
placement decision, not just this rewrite): **Supply Chain owns everything
that moves physical goods or commits to moving them. Accounting owns
everything that moves money or records what already moved.** Estimates stay
in Accounting because a quote commits nothing; Purchase Orders and Sales
Orders moved OUT to Supply Chain because they're a commitment to move goods,
even though no money has moved yet.

**No sidebar or Create-menu group may be named "Other", "More" or "Misc".**
If something doesn't obviously belong in a named group, that's a signal a
named group is missing from the design — say so and ask, don't invent a bin
to dump it in. (The Create menu's old "Other" group — Journal entry, Bank
deposit, Transfer, Bill of Materials, Manufacturing order, Production build,
Reconcile account, Add product/service, Add account, all mixed together — is
exactly the anti-pattern this rule exists to prevent.)

- **Supply Chain** (renamed from "Production" — same orange accent, same
  `manufacturing` module gate; UI-layer rename only, internal identifiers
  (`production_runs`, `/api/inventory/production`, `lib/inventory/production.ts`,
  the `BUILD-` numbering series) are untouched) — four sections:
  - **Purchasing**: Purchase Orders (`/accounting/trade/purchase-orders` — shared
    with Accounting, not moved), Goods Receipts (`/supply-chain/receiving`),
    Purchasing Reports (links to the shared `/accounting/reports` hub — there's
    no dedicated single page per report group, only per-report pages inside it).
  - **Manufacturing**: Production Schedule and Production Orders BOTH point at
    `/supply-chain` on purpose, not a bug — `components/mo-console.tsx` already
    IS the combined schedule/orders board, there's no separate screen for one
    without the other. Build (`/supply-chain/build`), Bill of Materials
    (`/supply-chain/bom`).
  - **Fulfilment**: Sales Orders (`/accounting/trade/sales-orders` — shared,
    not moved), Shipments (`/supply-chain/shipping`), Fulfilment Reports (same
    shared reports hub as Purchasing Reports).
  - **Inventory**: Stock Status, Lots & Movements (→ `/accounting/reports/lot-traceability`,
    the closest existing screen to a FIFO/movement audit trail — there is no
    dedicated "Lots & Movements" screen by that exact name), Products & Materials
    (`/accounting/products` — shared, not moved).
  - Old routes (`/production`, `/production/build`, `/accounting/receiving`,
    `/accounting/shipping`, `/accounting/bom`) permanently (308) redirect to
    their new `/supply-chain/*` homes (`next.config.js`) — bookmarks and old
    links keep working. `app/api/**` was NOT touched; the mobile app calls
    those routes directly.
- **Accounting**'s old "Master Data" section mixed the ledger itself with
  genuine setup/reference lists — split into **Ledger** (Chart of Accounts,
  Journal, Opening Balances, Trial Balance — always-expanded, core nav, not
  reference data) and **Setup** (Tax Rates, Classes, Locations, Cost Centres,
  Custom Fields, Employees, Products & Services — kept as the collapsible
  flyout "Master Data" used to be). Sales/Purchases sections now hold only
  Customers/Estimates and Suppliers respectively — Sales Orders, Purchase
  Orders, Shipping, Receiving and Bill of Materials all moved to Supply Chain.
  There's currently no dedicated Accounting-scoped list view for Invoices,
  Bills or Expenses as distinct screens (only the global `/invoices` AR
  screen and the `/accounting/new/[type]` create forms exist) — flagged, not
  invented, during the Phase 1a rewrite.
- **Known, deliberate duplication — NOT a bug, don't "fix" it on sight:**
  `/payables/purchase-orders` (Payables module's own PO screen) and
  `/accounting/trade/purchase-orders` (the trade-document PO, which Supply
  Chain's nav points at) are two separate, real screens over the same
  concept. Merging them is an intentional **Phase 1b** deferral, not an
  oversight discovered mid-session — don't rediscover this and "fix" it
  without that context.
- **Customer and Supplier are shared master data, not Accounting's to own a
  third copy of** (2026-09-06): Accounting's Sales/Purchases sections link
  `Customers`/`Suppliers` straight at Receivables' `/customers` and Payables'
  `/payables/suppliers` — the same rich list+detail screens those modules
  already have, not a separate thinner build. The old
  `/accounting/parties/customers`/`suppliers` screens (`components/party-list.tsx`'s
  `PartyList`, generic across customers/suppliers/employees) are retired for
  those two types and permanently (308) redirect to the real ones
  (`next.config.js`); `/accounting/parties/employees` is untouched — there is
  no Receivables/Payables equivalent for Employees, so that stays the one
  real screen for that type. See migration `0079_unify_parties.sql` and the
  "Accounting foundation" section below for the underlying data-model change
  this nav fix sits on top of.
- **Projects joined the same pattern (2026-09-07)**: Accounting's Sales
  section links `Projects` straight at Receivables' `/projects` (a
  customer-grouping entity, own rep/region reclassification) rather than
  building a second copy. This surfaced a real bug in the pattern:
  `components/sidebar.tsx`'s active-module detection was pure
  `pathname.startsWith(...)`, so landing on any shared entity's URL
  (`/customers`, `/payables/suppliers`, `/projects`) from Accounting
  force-switched the whole sidebar to whichever module owns that URL —
  confusing, reported as a bug. Fixed once, for all three: these paths now
  fall into the same `isChrome`-style "no module" bucket that Settings/Guide
  already used, so the sidebar keeps showing whichever module the user was
  actually in (`lastDept`) instead of snapping away. Apply this same
  treatment to any future shared-entity link, don't special-case it per
  entity.

## White-label Phase 1 — branded subdomain (2026-09-07)

Prompted by a customer request ("our name with the domain"), built as a
general per-org capability (any org, set from the admin portal), not a
one-off. Scope is deliberately narrow — a subdomain of ours, pre-auth pages
only:

- `organisations.subdomain` (nullable, unique when set) — an admin sets it
  on `/admin/customers/[orgId]` (the small subdomain editor next to the org
  ID in the header). `null` = no custom subdomain, org just uses the
  default app.
- **`middleware.ts` does NOT query the database.** `auth.config.ts` (what
  middleware's `auth()` wrapper runs on) is deliberately Edge-safe with "no
  Node.js imports (no bcrypt, no DB, no crypto)" — a constraint already in
  place before this feature and respected here. Middleware only does pure
  string parsing: for `<subdomain>.primeaccountax.com` on one of 4 pre-auth
  paths (`/login`, `/register/success`, `/forgot-password`,
  `/reset-password`), not a reserved word (`app`/`admin`/`www`/`api`/…), it
  sets a request header `x-org-subdomain`. The actual DB lookup happens
  downstream in `app/login/page.tsx` — now a server component that reads
  the header, queries `organisations` by `subdomain`, and passes
  name/logo down to the client `components/login-form.tsx`. A miss (no
  header, or no matching org) falls back to default Prime Accountax
  branding — this can never block a login.
- `next.config.js`'s `serverActions.allowedOrigins` gained a
  `"*.primeaccountax.com"` wildcard entry alongside the existing literal
  origins.
- **Manual step still required, outside this codebase**: a wildcard domain
  (`*.primeaccountax.com`) needs attaching to the Vercel project (Settings →
  Domains), plus the matching wildcard DNS record wherever
  primeaccountax.com's DNS is managed. The code changes alone don't make
  `<anything>.primeaccountax.com` resolve on the public internet — verify
  this separately before assuming a customer's subdomain actually works.
- **Deliberately out of scope, not forgotten**: outbound email branding
  (`lib/system-mailer.ts`'s `baseLayout` and every transactional email
  subject are hardcoded "Prime Accountax" globally, with no per-org
  parameter at all — a materially bigger, separate gap) and fully custom
  customer-owned domains (their own DNS + Vercel Domains API verification
  flow). The app shell itself (`components/sidebar.tsx`,
  `app/owner-portal/[token]/`) was already white-label-ready before this
  work — it already reads `orgSettings.logoUrl`/`displayName` with "Prime
  Accountax" only as the last-resort fallback.

## Modules & per-org feature gating

The product is expanding into vertical-specific functionality — Manufacturing
(BOM, production builds, job work, receiving, shipping, lot traceability) is
the first, more will follow. Every org has an `organisations.enabled_modules`
jsonb array (`db/schema.ts`) recording which `ModuleKey`s
(`lib/modules.ts` — `receivables`/`payables`/`studio`/`accounting`/
`manufacturing`/`resources`) it has access to. Existing orgs default to the
four core modules; `manufacturing` and `resources` are opt-in, assigned per
org by a platform admin via the **Modules** card on
`/admin/customers/[orgId]` (`PATCH /api/admin/organisations/[id]/modules`)
— not a self-service toggle, since each is a vertical the org has bought
into, not a preference.

- **`lib/modules.ts`** is client-safe (no `db` import) — `MODULE_KEYS`,
  `MODULES` (label/description/`core` metadata), `hasModule(enabledModules,
  key)`. Used by the sidebar (`components/sidebar.tsx`) to gate the
  Production workspace + the Accounting nav's "Manufacturing" group, and by
  the Accounting reports hub (`app/(app)/accounting/reports/page.tsx`) to
  gate the Stock/Purchasing/Sales report groups — `orgSettings.enabledModules`
  reaches both via the existing `data-provider.tsx` context (populated by
  `GET /api/org/settings`, same plumbing that already carries
  `reportingEnabled`).
- **`lib/modules-server.ts`** is server-only — `requireModule(orgId, key)`,
  mirroring `requireOrg()`'s `{ error }` return shape:
  ```ts
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  ```
  Call it in every manufacturing-only API route (`app/api/inventory/**` except
  `items`/`skus`/`supplier-skus`, which are Products & Services master data
  every org uses regardless of vertical) — this is defense in depth, not just
  hiding a nav link, so a non-manufacturing org gets a real 403 hitting the
  route directly.
- **Keep the two files separate.** `lib/modules-server.ts` imports `db` —
  importing that from a client component would bundle server code into the
  client. Anything a client component needs (the admin modules card, the
  sidebar, the reports hub) must come from `lib/modules.ts` only.
- `organisations.reporting_enabled` (the original, one-off precedent for this
  pattern — a self-service boolean toggled in Settings, checked ad hoc in one
  API route and one nav spot) is intentionally **not** folded into this
  registry — it's a separate, working, unrelated feature. Don't extend it
  further; new gated features should use the module registry instead.

## Resource Management module (Phase 1: capacity & scheduling, 2026-09-09)

Requested explicitly as a NEW module, with an explicit constraint to check
first: "ensure you are not duplicating any existing thing, as we already
have projects in place." An audit confirmed `projects` is a pure
customer/invoice-grouping label (no dates/budget/resource columns),
`employees` is pure contact master-data, `reps` is a sales-collections
hierarchy, and `job_work_orders`/`manufacturing_orders`/`production_runs`
track quantities and only a `createdBy` audit stamp — nothing anywhere
modeled people/equipment capacity, scheduling, or allocation. This module
is additive, not a rebuild.

- **`resources`** (`db/schema.ts`) — a bookable person or piece of
  equipment. `type` discriminates `person`/`equipment`. `employeeId`
  (nullable) LINKS a person resource to an existing `employees` row rather
  than re-storing name/email — the resource always keeps its own `name` too
  so equipment (and a person whose linked employee is later removed) still
  displays correctly. `dailyCapacity` is hours/day for a person or
  slots/day for equipment (usually 1 = exclusive booking).
- **`resource_assignments`** — books one resource against a Project,
  Manufacturing Order, or Job Work order over a `[startDate, endDate]`
  range (`endDate` null = open-ended) at some `allocationPercent` of the
  resource's capacity. `assignableType`/`assignableId` is a **no-FK
  polymorphic reference**, same tradeoff as `transactionLinks.fromType/
  fromId` — adding a fourth assignable type later (e.g. Sales Orders) is a
  one-line addition to the type list, not a schema change. Over-allocation
  (>100% of capacity on an overlapping range) is computed at query time in
  `GET /api/resources/assignments`, not stored.
- **Module key `resources`** (`lib/modules.ts`) — opt-in, same precedent as
  `manufacturing`. The admin Modules card picks it up automatically (it
  iterates `MODULE_KEYS` generically, no per-key admin code).
- **Phase 1 is scheduling-only.** Time-tracking (actual hours logged) and
  any billing integration (billable time → invoice line) are explicitly
  deferred to a later phase — don't build them in without a fresh ask, the
  Phase 1 data model doesn't carry a rate or a billable flag.
- **UI**: a new top-level workspace (`components/sidebar.tsx`, pink accent,
  `CalendarClock` icon) — Resource Board (`/resources/board`, a from-scratch
  date-axis grid; confirmed no prior calendar/gantt component existed
  anywhere to adapt — `mo-console.tsx` is a status Kanban, not a date
  grid) and a collapsible Setup group (People, Equipment —
  `components/resource-list.tsx`, one component parameterized by `type`).
  `components/assigned-resources-panel.tsx` is a small read-only panel
  (module-gated, renders nothing if `resources` isn't enabled) added to a
  Project's detail page and reusable on MO/Job Work detail pages later.

## Stripe recurring billing — invoice-first two-step flow (2026-09-09)

A real customer invoice (14-day terms configured in the admin form) showed
Stripe's due date as the same day it was issued, and was later voided by
Stripe — root-caused against Stripe's own API docs, not guessed:

- **`days_until_due` only applies when `collection_method='send_invoice'`.**
  The old subscription-mode code
  (`app/api/admin/billing/create-invoice/route.ts`) created the Stripe
  subscription with `collection_method:'charge_automatically'` and never
  passed `days_until_due` at all — the admin form's "Payment terms" field
  was silently discarded for Recurring mode (it only ever reached the
  one-off branch).
- **The real bug, and the reason the invoice was voided**: Stripe's docs
  state, verbatim, for a `charge_automatically` subscription: "If the first
  invoice is not paid within **23 hours**, the subscription transitions to
  `incomplete_expired`. This is a terminal status, the open invoice will be
  voided and no further invoices will be generated." Nothing to do with the
  14-day field — it's fixed Stripe behavior for that collection method, and
  it isn't configurable away. `due_date`/`collection_method` also "can only
  be updated on `draft` invoices," so an already-finalized invoice like this
  one can't be patched after the fact — that's a manual/support matter, not
  a code fix.
- **Fix — two-step "invoice first, subscribe after payment"**, since a
  `send_invoice`-collected invoice and a `charge_automatically` subscription
  can't be the same object (and Stripe activates `send_invoice`
  subscriptions immediately regardless of payment, which would break
  `activateOrgOnPayment`'s payment-gated access):
  1. **`create-invoice` route, subscription mode**: creates a **standalone**
     Stripe invoice (`collection_method:'send_invoice'`, real
     `days_until_due`) for the first period's amount — same shape as the
     one-off branch (`invoices.create` → `invoiceItems.create` →
     `finalizeInvoice` → `sendInvoice`). Our `subscriptions` row is inserted
     as before (`status:'incomplete'`), but **no Stripe subscription object
     exists yet** — nothing for Stripe to auto-expire in 23 hours, and
     nothing for an admin to accidentally auto-cancel by voiding (see the
     `[id]/create-invoice/route.ts` comment below — that landmine no longer
     applies to invoices created after this fix).
  2. **`app/api/webhooks/stripe/route.ts`'s `invoice.paid` handler**: when
     the paid invoice carries `metadata.purpose ===
     'subscription_first_invoice'`, it retrieves the PaymentIntent's
     payment method, sets it as the customer's default, and creates the
     REAL subscription (`collection_method:'charge_automatically'`,
     `default_payment_method` set explicitly, `trial_end` one interval out
     so the period already paid for manually isn't billed again — the
     subscription just starts `trialing` and auto-charges cleanly at
     period 2). `activateOrgOnPayment` already runs unconditionally later
     in the same handler, so access-gating is untouched.
- **Guard against a second subscription**: if an org already has a live
  Stripe subscription when "Create Stripe invoice" is used again, the route
  now returns a 400 pointing at `/api/admin/subscriptions/[id]/create-invoice`
  (the existing "generate a new invoice for an existing subscription" tool)
  instead of silently starting a competing one. A dead subscription
  (`canceled`/`incomplete_expired`) doesn't block — it's cleared and a fresh
  invoice is issued.

## AR invoice emails — QBO "Pay online" link (2026-09-09)

Reported: invoices sent directly from QuickBooks Online carry a clickable
"Review and pay" link; the same invoice re-sent from this app (chase emails,
the AI chat "send invoices" command) did not. Root cause: every AR-email
path attaches the raw PDF pulled from QBO/Xero's plain PDF-export endpoint
— a different artifact from QBO's own emailed "online invoice" page, and one
that never carries a payment link. The only link this app ever added was
our own portal (`lib/portal.ts`'s `createPortalToken` → `/portal/[token]`,
rendered by `lib/ar-email.ts`'s `portalButton`) — which only supports
promise-to-pay/dispute, **not payment**; it was never meant to be a payment
link, and isn't one.

Fixed by surfacing QBO's own link rather than building payment collection
ourselves (that's a materially bigger, separate feature — Stripe
Checkout/Payment Links for AR invoices, needed for Xero/native orgs too —
deliberately out of scope here):

- **`lib/qbo-token.ts`'s `fetchQboInvoiceLink(orgId, invoice)`** — QBO only
  returns `Invoice.InvoiceLink` when a single-invoice GET explicitly asks for
  it via `?include=invoiceLink`; it is **never** present on a bulk `/query`
  response (confirmed against Intuit's docs), so this is one extra
  per-invoice GET, done only at send time — not during the routine
  `lib/qbo-sync.ts` sync, and no new schema column. Returns `null` (silently
  — email still sends without the button) when QBO Online
  Invoicing/Payments isn't enabled for the org, the invoice has no billing
  email, or it's a Xero/native/credit-memo invoice — this is QBO-only, by
  the same scoping decision as the fix itself.
- **`lib/ar-email.ts`'s `ArEmailRow.payUrl`** — the shared branded template
  renders a small "Pay online →" link under the balance when present; `null`
  renders exactly as before this existed.
- Wired into the four automated AR-email send paths that already share this
  template and an existing PDF-fetch loop: `app/api/chat/route.ts`,
  `inngest/functions/chase.ts` (daily chase), `app/api/cron/route.ts`
  (legacy chase), `app/api/cron/trigger/route.ts` (manual trigger — skips
  the fetch in `dryRun`, matching how it already skips PDF attachments).
- **There are SEVEN send paths, not four — grep `renderInvoiceEmail` before
  assuming you've covered them.** The first fix wired only the four
  server-side ones and shipped, and the customer still saw no button,
  because the paths they actually use render the branded template
  **client-side**, in the browser, where there is no QBO token:
  `components/send-invoices-modal.tsx` (the "Send invoices" modal) and the
  bulk sender in `components/feature.tsx`. Both now fetch links first from
  **`POST /api/invoices/pay-links`** (bulk sibling of the single-invoice
  route; org- and rep-scoped) and pass `payUrl` per row — the same
  fetch-before-render they already did for the portal token.
- The seventh is the free-text composer (`EmailComposer`), which sends
  whatever the user typed with no branded table at all. Rather than push
  HTML into a textarea the user edits, **`app/api/email/send/route.ts`
  appends the pay button server-side** when the email names a single
  `invoiceId` — and skips it when the body already contains that URL, so
  the branded senders (which draw their own per-row buttons) don't end up
  with two. That makes it the safety net for any future caller too.
### Multi-tenant: orgs that can't (or won't) take online payments

Two real clients, opposite needs: one has QuickBooks Payments on and wants
"Pay now" everywhere; the other doesn't, and a pay button would mislead
their customers. Handled on two levels:

- **Self-gating by default — no config.** QBO only mints an `InvoiceLink`
  when the company has online payments enabled, so a non-payments org gets
  `null` everywhere. Every surface hides the *whole* affordance rather than
  rendering a dead one: `anyPay` drops the email column
  (`lib/ar-email.ts`), `anyPayable` drops the portal column
  (`app/portal/[token]/page.tsx`), `stampQboPayButton` returns the PDF
  untouched, and `/api/email/send` appends nothing. Enable payments in QBO
  and buttons appear on their own; disable and they vanish.
- **`organisations.pay_links_enabled`** (migration `0082`, default **true**)
  is an opt-OUT for the org that *can* take online payments but would rather
  customers didn't self-pay. Deliberately not opt-in: an opt-in toggle
  invites "I switched it on and still see nothing" tickets, because QBO
  won't issue links regardless unless payments are enabled there.
- **Enforce it at the choke point, not per surface.** Every path
  (emails, PDFs, portal, pay-links endpoints) resolves links through
  `fetchQboInvoicePayInfo`, so the org opt-out and the company-payments
  check live there and cover all seven send paths at once. Don't re-check
  in individual surfaces.
- **Cost control matters here.** Before this, we asked QBO for a link once
  *per invoice* even for orgs that can never have one — a chase run burned
  one call per invoice and a portal load up to 20, against that company's
  QBO rate limit, for nothing. Both the org flag and the company
  `ETransactionPaymentEnabled` preference are now cached in-process (60s /
  10min) and short-circuit before any per-invoice call.
- The internal "Pay online" button on the invoice detail page is hidden when
  the org opts out; the QBO-disabled case still shows it but explains itself
  via `PAY_LINK_MESSAGES`.

- **The customer-facing portal** (`app/portal/[token]/`) had no way to pay
  at all — it only ever offered "promise a date" or "raise a query", which
  is what the portal button in the email leads to. `GET
  /api/portal/[token]` now returns `payUrl` per open invoice (resolved in
  parallel, capped at 20 since it's a public endpoint) and the page renders
  a "Pay now" column beside the PDF one. The column is hidden entirely when
  nothing is payable, so a Xero/native org's portal is unchanged.
- `app/(app)/invoices/[id]/page.tsx`'s "Download PDF" button has a sibling
  **"Pay online"** button (`GET /api/invoices/[id]/pay-link`) that opens
  QBO's hosted payment page directly.

### The PDF itself — stamped, not left to QBO (2026-09-10)

**A correction to an earlier claim in this file**: it previously said the
downloaded PDF "can never carry this link". That was asserted without
verification and it's wrong — a customer demonstrated that a PDF downloaded
from QBO's own UI *does* show a payment link, while the same invoice
downloaded from this app didn't. Don't re-derive the old conclusion.

We don't control how QBO renders its `/invoice/{id}/pdf` export, so rather
than depend on it, **we stamp the button on ourselves**:

- **`lib/qbo-pay-button.ts`'s `stampPayButtonOnPdf(pdf, payUrl)`** — draws a
  green "Review and pay online" button with `pdf-lib` (already used by
  `lib/statement-pdf.ts` / `lib/approval-pdf.ts`) on an opaque white
  backdrop, plus a real `/Link` annotation over it so it's clickable — the
  drawn rectangle alone is just ink. **Idempotent**: re-stamping a PDF that
  already carries the same URI is a no-op, because these buffers pass
  through several layers (fetch → attach → send). Returns the PDF
  *unchanged* on any error — a missing button is a disappointment, a
  corrupted invoice PDF is an incident.
- **Placement is found, not assumed.** It sits immediately left of the
  "Balance due" figure (a button in the footer read as an afterthought), and
  that block moves down the page as line items are added — so there is no
  safe fixed coordinate. `pdf-lib` can only write, not read, so **`unpdf`**
  (serverless-friendly pdfjs build) extracts page text to locate the label;
  it matches `balance due`/`amount due`/`total due`, handles the label being
  split across runs ("BALANCE" + "DUE"), and searches every page since
  totals land on the last one. Text-item coordinates come back in the *same*
  space pdf-lib draws in (bottom-left origin, y = baseline) — verified
  empirically with a probe, no viewport transform. If the label isn't found,
  or extraction throws, it falls back to the old bottom-margin position, so
  a button always appears.
- **`unpdf` is in `serverComponentsExternalPackages`** (`next.config.js`).
  Its bundled pdfjs uses `import.meta` directly, which webpack flags as a
  "Critical dependency" warning and risks breaking at runtime if bundled —
  keep it a real Node import.
- **`lib/qbo-token.ts`'s `stampQboPayButton(orgId, invoice, pdf)`** resolves
  the link then stamps. `fetchQboInvoicePdf` now does this **by default**
  (opt out with `{ payButton: false }`), which covers the chase crons,
  Inngest chase, owner notifications and the bulk ZIP in one place. The
  three routes that fetch QBO PDFs inline rather than via that helper —
  `app/api/invoices/[id]/pdf/route.ts` (the detail-page download),
  `app/api/email/send/route.ts` (composer attachments) and
  `app/api/chat/route.ts` — call it explicitly.
- **Why a link is missing is now reported, not shrugged at.** Intuit's docs
  give three preconditions: the company must be payments-enabled
  (`Preferences.SalesFormsPrefs.ETransactionPaymentEnabled`), the invoice's
  `AllowOnlineCreditCardPayment`/`AllowOnlineACHPayment` must be set, and the
  invoice needs a valid `BillEmail`. `fetchQboInvoicePayInfo` checks all
  three and returns a `QboPayLinkReason`, which the invoice page turns into
  an actionable message (`PAY_LINK_MESSAGES`) — each precondition has a
  different fix, so "no link available" was a dead end.

## ⚠️ Gotchas that have bitten us

- **neon-http has NO transactions.** `db.transaction()` throws. Use
  pre-validation + a single multi-row statement, or compensating deletes with
  loud error logs. Never assume atomicity across statements.
- **Hand-written migrations** in `db/migrations/` need `--> statement-breakpoint`
  between statements, and the `meta/_journal.json` entry's `when` must be
  GREATER than the previous (drizzle skips entries with an older/equal `when` —
  this silently dropped a table in prod once). Latest is `0097` at `when`
  `1790500000000`; keep incrementing. (Keep this line current — it sat at
  "0025" for 50 migrations once already, which is worse than no note.)
  **Each chunk between breakpoints must be exactly ONE command** — neon-http
  sends each as a PREPARED statement and Postgres rejects two with
  `cannot insert multiple commands into a prepared statement`. A `DO $$ … $$`
  block counts as one however many semicolons it contains. This failed the 0087
  deploy: two blocks were appended with no breakpoint between them, every test
  passed, tsc was clean, and it died in `vercel-build` AFTER the push — because
  migrations run during the build. `tests/architecture.test.ts` now guards all
  three properties (one command per chunk, strictly increasing `when`,
  journal/file correspondence), proven to fail on the real defect.
  Two pre-existing violations are grandfathered by name, deliberately: 0016/0017
  carry `when` values older than 0015 and were skipped (hence
  `0085_heal_skipped_0016_0017`), and `0018_invoice_escalation.sql` is on disk
  but absent from the journal, so it has never run — its columns reached prod by
  hand or `drizzle-kit push`. **Do not "fix" 0018 by adding it**: its bare
  `ADD COLUMN` statements would fail against a database that already has those
  columns, and migrations run inside `vercel-build`, so that breaks every future
  deploy rather than one.
- **Tailwind `content` globs must include `lib/**`** — classes defined in shared
  lib files were silently unstyled until it was added.
- **`npm run db:verify` proves a database matches `db/schema.ts`** — run it
  after every migration instead of trusting the migrator's ✓.
  `scripts/verify-schema.ts` walks every table and column drizzle declares and
  asks the database whether it really has them, at the right width and
  nullability. It is READ-ONLY (information_schema + the drizzle journal), so
  pointing it at production is the intended use:
  `npm run db:verify -- --env .env.production.vercel`. It catches both documented
  failure modes — a column the app writes that no migration ever created, and a
  column NARROWER than the code believes (the 0088 truncation class) — neither of
  which `tsc` or the unit suite can see. Not in CI: CI has no database.
  It knows 0016/0017 are permanently skipped and reports them as expected, and
  it skips nullability on VIEWS (`customers`/`ap_suppliers`), because Postgres
  reports every view column as nullable regardless of the underlying table.
- **There is ONE Neon project, `raspy-credit-72518363`, with TWO branches** —
  and they are not two projects, which an earlier version of this note got
  wrong and cost a session of confusion:
  - **`production`** (default) / `br-autumn-bird-abruo99q` / endpoint
    **`ep-royal-rice-abr9rxnv`** — **PRODUCTION**. 6 orgs, ~18k invoices, includes **ACC (A Continuous
    Charity)** and **Aberny**, which exist NOWHERE else. Reached by
    `.env.production.vercel` (whose `DATABASE_URL` is a Vercel *Secret* and so
    pulls as empty or `[SENSITIVE]` — the usable string is
    `DATABASE_URL_UNPOOLED`).
  - **`vercel-dev`** / `br-snowy-feather-abkp51u5` / endpoint
    **`ep-ancient-math-ab44z2jn`** — a stale copy, ~10 migrations behind, holding its own convincing-looking
    data (9 orgs, an older EDC, a `Shirt - Black` with SKUs that production's
    `T-Shirt - Black - M` never had). This is what `.env.local` points at.
  - **Deleting the PROJECT destroys production.** `vercel-dev` is a Vercel-
    created dev fork, so the fix for its drift is **Reset from parent**, not
    deletion — that keeps the endpoint, so `.env.local` and the Vercel dev
    environment keep working while the data and schema become current again.
  - The `preview/*` branches are created by the Vercel-Neon integration and are
    paired with per-branch `DATABASE_URL` env vars in Vercel. **Idle is not
    abandoned**: all three of their git branches still exist, so deleting a
    Neon branch would break the next preview deploy of that branch at
    `db:migrate`. Let the integration retire them when the git branch goes.
- **`npm run db:whoami` answers "which database is this?" in one command**
  (`scripts/db-identity.ts`). Neon exposes `neon.endpoint_id`,
  `neon.project_id` and `neon.branch_id` as ordinary Postgres settings, so the
  identity is readable over the same connection — no console or API key. The
  same block heads every `db:verify` run. **Use it before drawing any
  conclusion from a query or a screenshot**: two branches with overlapping real
  data have already been mistaken for each other more than once, including a
  "why did this item lose its SKUs?" investigation that turned out to be two
  different items in two different branches.
- **Known, latent, not yet fixed**: `user_organisations.user_id`/`org_id` are
  NOT NULL in `db/schema.ts` but nullable in production. No bad data exists
  (28 rows, 0 nulls, 0 orphans), so it is a missing constraint rather than an
  incident, and tightening it is safe whenever a migration next touches it.
- Test migrations/backfills on a **Neon branch** before prod. Don't run
  destructive steps (NOT NULL, deletions) until a backfill is verified on prod.
- **`.env.local` can be many migrations behind production — verify before
  believing a local query.** A local DB here was missing 6 applied migrations
  while `vercel inspect --logs` truthfully reported "✓ Migrations applied"
  (to the real DB). Because the stale copy still held real-looking org data,
  a whole set of reconciliation findings looked credible and were wrong. Check
  `select max(created_at) from drizzle.__drizzle_migrations` against
  `meta/_journal.json`, or just use the in-app path (`/admin/reconcile`) which
  always runs server-side against production.
- **`invoices.source` / `ap_bills.source` do NOT reliably mean "native".**
  Both default to `'native'` and the provider syncs don't consistently
  overwrite them, so thousands of QBO/Xero-synced rows are labelled native
  while carrying a `qbo_id`. To tell ours from theirs use
  `journal_entry_id`/`entry_id` (ours) and the provider id columns (theirs).
  Filtering on `source` turns any ledger report into noise.

## Accounting foundation — invariants to preserve

The native transaction model is **already QBO-shaped**: `journal_entries` IS
the transaction header (`sourceType` is the `txn_type` discriminator, plus
`docNumber`/`dueDate`/`reference`/`txnNo`/`entryNumber`/`status`/
`sourcePayload`) and `journal_lines` ARE the typed lines, carrying full
dimensions (class/location/cost-centre/customer/project, QBO's Entity ref as
`nameType`/`nameId`/`nameLabel`, plus currency/exchangeRate/fx). There is no
need for separate `transactions`/`transaction_lines` tables. `lib/ledger.ts`'s
`postJournalEntry` is the single GL writer — immutable, reversal-only, which
is *stricter* than QBO's silent-edit-plus-SyncToken model. Adopt QBO's shape;
do not adopt its wire quirks (sparse updates, `Line`-append-on-update,
create-only `Balance`) — those belong quarantined in the sync/batch adapters.

- **One path per document type.** A document must have exactly one creation
  path, and it must post. Payables' bill endpoint used to insert a lines-less
  `ap_bills` header that never reached the GL (a liability visible in the UI
  and absent from the books); it's gone. Native bills post via `postDocument`
  and are mirrored into `ap_bills` by `bridgeNativeBill`; provider-synced
  bills are NOT posted (their ledger lives in QBO/Xero — posting ours
  double-counts).
- **The bridges must never fail silently.** `bridgeNativeInvoice` /
  `bridgeNativeBill` mirror a posted GL entry into the collections/Payables
  modules. `bridgeNativeInvoice` used to `return` quietly without a
  `partyId`, which left an invoice in the A/R control account with no
  receivable row — invisible to collections and AR aging. An Invoice now
  *requires* a picked customer (QBO mandates `CustomerRef` for the same
  reason) and the bridge logs loudly.
- **Derived state has exactly one writer.** `invoices.paid`/`paymentStatus`
  are a CACHE of the settlement links graph, written only by
  `syncNativeInvoicePaid` (native) or the provider sync (mirrored). It once
  had four competing writers, including a route that added to `paid` with no
  link, no journal entry and no cash account. `paidAt` must come from the
  settling document's `entryDate`, never `new Date()` — stamping "today"
  corrupts every historical-dated AR aging run.
- **Prove it, don't assert it.** `lib/accounting/reconcile.ts` checks, per
  org: entries balance; A/R and A/P control accounts agree with their
  subledgers; nothing is posted-but-missing-from-its-subledger; nothing is
  off-ledger; `invoices.paid` agrees with the links graph. Surfaced at
  `/admin/reconcile` (runs server-side against production) and as
  `scripts/reconcile-foundation.ts` for CI (exit 1 on failure). Run it after
  any change to posting, bridging or settlement.
- **Two settlement graphs — but ALREADY BRIDGED on the read side (corrected
  2026-09-13; the old note here said otherwise and cost a session a wrongly
  planned migration).** `transaction_links` (native, `numeric`) and
  `payment_applications` (QBO-mirror, `real`, raw-QBO-id keyed, written only by
  `lib/qbo-sync.ts`; Xero writes neither). `lib/ar-aging.ts` reads **both**: a
  raw-SQL query over `transaction_links` for native invoices, keyed on
  `journal_entry_id` and date-filtered on the settling entry's `entry_date`,
  and `payment_applications` for provider-mirrored ones, discriminated by
  `isNative`. **A grep for the Drizzle symbol `transactionLinks` in
  `ar-aging.ts` returns nothing — the query is raw SQL. Don't conclude from
  that grep that the native path is missing.** `linksForAny` bridges the same
  split for the Linked Transactions panel.
  **The two graphs key on DIFFERENT ids for the same invoice** — this is the
  real obstacle, not the table count: `payment_applications.invoice_id` is an
  `invoices.id`, while `transaction_links.to_id` is a **`journal_entries.id`**.
  Join them through `invoices.journal_entry_id`. Open balance also
  has two answers: GL truth (`lib/accounting/payments.ts`) vs
  `invoices.qboBalance ?? total − paid`. Collapsing these onto
  `transaction_links` with `payment_applications` as a compatibility view is
  the next planned step.
- **A VIEW has no primary key — so `GROUP BY view.id` FAILS.** Postgres only
  treats other selected columns as functionally dependent on a grouped column
  when that column is a real primary key. On `customers`/`ap_suppliers` it
  isn't, so `GROUP BY apSuppliers.id` while selecting org_id/name/email/… dies
  with `column "s.org_id" must appear in the GROUP BY clause` — a **500 on the
  page**, invisible to `tsc` and to every no-database unit test. This is exactly
  how Payables → Suppliers broke. **Aggregate in a subquery and join it**, don't
  list every column in the GROUP BY: the list version works until someone adds a
  column to the select and forgets, and then it is a 500 again.
  `tests/architecture.test.ts` guards the pattern (proven to fail on a real
  violation, not merely to pass).
- **`customers` and `ap_suppliers` are compatibility VIEWS, not real tables**
  (migration `0079_unify_parties.sql`, 2026-09-06): both party types now
  live in one physical `parties` table (`party_type` discriminator), because
  Accounting's Customer/Supplier screens had drifted into a third, thinner
  copy of the same concept — see the module-IA note above. INSTEAD OF
  triggers on each view forward INSERT/UPDATE/DELETE/`.returning()` into
  `parties`, so every existing query against `customers`/`ap_suppliers` is
  unaffected — **except** a *new* foreign key can no longer target
  `customers.id`/`ap_suppliers.id` (Postgres can't FK to a view); target
  `parties.id` instead. `customers_legacy`/`ap_suppliers_legacy` hold the
  pre-migration data as an audit trail, not yet dropped. `ON CONFLICT` also
  doesn't work through a trigger-backed view — `lib/sage-sync.ts`'s one
  `onConflictDoNothing()` against `customers` was switched to plain
  check-then-insert; if you add a new sync/importer, insert into `customers`/
  `ap_suppliers` the same plain way, not with `onConflictDoUpdate/DoNothing`.

## A date is a date — never `new Date()` on a date-only value (2026-09-17)

Reported by ACC: QuickBooks showed an invoice due **15 Sep 2026**, our app
showed **14 Sep 2026**. Their standard, and now ours: *"If it is because of the
timezone difference — this should not happen. Date is the date."*

The data was never wrong. `invoices.due_date` is a `varchar(16)` holding the
literal `"2026-09-15"`, copied verbatim from QBO's `DueDate` by
`lib/qbo-sync.ts` — no Date object touches the write path. The bug was entirely
in rendering: **`new Date("2026-09-15")` is parsed by ECMAScript as UTC
midnight**, and every formatter then read it back with LOCAL getters. Anywhere
west of Greenwich that is the previous day, so for a US client *every* date-only
field in the app read one day early. It never reproduced for us because Vercel
and our own machines run east of or on UTC.

- **`lib/format.ts` is the single rule.** `dateParts()` detects a date-only
  shape and reads the YYYY-MM-DD components **literally, never building a
  Date**. `formatDate` / `formatDateShort` / `formatDateLong` / `formatDateUS` /
  `formatDateUSLong` / `fmt.date` / `fmt.shortDate` all go through it. Use them;
  do not hand-roll `.toLocaleDateString()` on a due/invoice/txn/promise date —
  that is exactly how it drifted into a dozen components.
- **`+ "T00:00:00Z"` is NOT the fix, it is the same bug.** It names the identical
  instant and still renders locally. Three components carried it and were wrong
  in precisely the same way. (`+ "T00:00:00"`, no `Z`, *is* local midnight and
  happens to be correct — but nobody should have to work out which of the two
  they wrote, so both are gone.) `tests/architecture.test.ts` guards the `Z`
  form, and that guard found six offenders the manual sweep had missed.
- **The detector is deliberately NARROW**: a bare `YYYY-MM-DD`, or one with an
  explicit **midnight** time (a `date` column serialises through JSON as
  `"2026-09-15T00:00:00.000Z"`, which is still a calendar date). A timestamp
  with a real time — `created_at`, `sent_at` — stays on the Date path, because
  `2026-09-16T02:00:00Z` genuinely *is* the evening of the 15th in New York.
  Widening it would introduce a new off-by-one in the opposite direction.
- **Server-rendered surfaces were latent, not safe.** `lib/statement-pdf.ts` and
  `lib/approval-pdf.ts` had the same pattern and only looked right because the
  process runs in UTC. These are documents a debtor or approver receives — the
  worst place for a date to be a day out — so they no longer depend on where
  they run.
- `mobile/src/format.ts` already had this right (it pins both parse and render
  to UTC). The web app did not. If you add a date renderer anywhere, match the
  mobile helper's intent or import the web one; don't invent a third rule.
- `tests/date-display.test.ts` asserts every formatter across seven timezones
  spanning UTC−8 to UTC+14 (including a half-hour offset and DST boundaries).
  It was **proven to fail on the old implementation** with the exact reported
  symptom, `expected '14 Sep 2026' to be '15 Sep 2026'` — not merely to pass.

## Receivables are reported AS AT a date (2026-09-12)

**A receivable exists from the day it is invoiced.** An invoice dated after the
report date has not been issued yet, so it is not receivable then. Every AR
surface obeys this; `lib/format.ts`'s **`isWithinAsAt(invoiceDate, asAt)`** is
the single rule and the only place to change it.

- **Don't "fix" the filter back out.** `ar-snapshot`'s live path used to skip it
  on the argument that "a post-dated invoice is still owed" — while
  `computeArAging` filtered `invoiceDate <= asOf` for historical dates. Same
  report, two answers depending on the date picked. A client that raises
  invoices ahead of time to track a collection schedule saw $2.6m of
  not-yet-issued invoices reported as receivable, burying the $700 actually
  owed (Receivable Composition read 100% "not yet due"). The two paths now
  agree.
- **The real bug behind that old comment was timezone, not date logic.** `asOf`
  was UTC (`toISOString().slice(0,10)`), so near midnight it could sit a day
  behind the user's local date and drop genuinely-issued invoices. Use
  **`localToday()`**, never `today()`, for anything compared against an
  invoice/due date — `today()` is UTC and shifts the day either side of
  Greenwich. `matchesDueFilter` already carried this warning; it generalises.
- **`live=1` on `/api/reports/ar-snapshot`** means "this IS the caller's now" →
  use live provider balances instead of reconstructing a historical position.
  It exists because the client now sends a LOCAL date: comparing that to the
  server's UTC today would send every dashboard load west of Greenwich down the
  historical (QBO API) path. Callers omitting it behave as before.
- **A row with no invoice date is always in scope.** Absence of a date is not
  evidence a document is post-dated; excluding those under-counts real debt.
- **No "show future invoices" control on report surfaces — moving the As at
  date forward IS the affordance.** So the Dashboard's date input deliberately
  has **no `max`**, and `max={todayIso}` was removed from `/reports`' picker;
  re-adding it would leave an org that post-dates invoices no way to see them.
- **The Collections Board is the exception: a toggle, not a date picker.** It
  hides future-dated rows by default with "Show future-dated (N)". The board
  MUTATES state (drag to change stage, log a call), so acting on it while
  viewing a historical position would write today's changes against a past
  view. The cutoff is applied in ONE derived list that both the card and list
  views read — apply it in both places and they will drift.
- Fixing this at `ar-snapshot` fixes every Dashboard widget at once: they all
  read `effectiveInvoices` from that one snapshot, which is also what keeps the
  Dashboard reconciling with the Reports pages.

## Provider transactions into our own GL (in progress, 2026-09-13/14)

Goal, from the product owner: **no duplication — everything QBO has should live
in our model.** Master registers already do (`accounts`, `ap_items`,
`ap_tax_rates`, `ap_dimensions`, `employees` all carry `external_id`);
transactions were the one thing that got a parallel mirror instead. This closes
that.

**Status: SHADOW ONLY. Nothing is wired up.** `ingestOrgTransactions` is called
from `scripts/qbo-gl-ingest.ts` and nowhere else — not the sync, not a cron, not
the webhook handler. It writes `journal_entries`/`journal_lines` and no mirror
table, so a paying client is unaffected whether it runs or not. **A full sync
today still puts nothing in the GL, and the native Trial Balance is still empty
for a QBO org.**

- `lib/accounting/qbo-gl.ts` — PURE mapping, 12 posting entities, no db/network,
  so money-path logic is provable in tests. Two rules it enforces: never drop a
  line (every QBO txn is internally balanced, so a dropped line unbalances the
  entry, `postJournalEntry` rejects it, and the ledger silently gains a hole —
  unresolvable accounts go to Suspense instead); and refuse to plug an imbalance
  over 5c, because absorbing a real gap makes the books balance *and be wrong*.
- `QBO_NON_POSTING` names Estimate/PurchaseOrder/TimeActivity explicitly, and
  `mapQboTransaction` THROWS on an unknown entity. "Decided to skip" must stay
  distinguishable from "forgot" — that is the difference between a complete
  ledger and a quietly incomplete one.
- **Mirrored entries are REPLACED, not reversed.** The GL is immutable and
  reversal-only for entries *we* author; for a mirrored one QBO is the book of
  record. Five edits in QBO must not become eleven entries here. Guarded by the
  partial unique index on `(org_id, external_source, external_id)` (migration
  `0086`) — without it a webhook replay is not a duplicate row, it is a wrong
  trial balance.
- **Suspense (`1999`) is created ON DEMAND**, not seeded in `SYSTEM_ACCOUNTS`.
  `ensureSystemAccounts` is called from many paths, so listing it there made a
  new account appear in every org's Chart of Accounts — including a paying
  client's — from work meant to be invisible. Caught by verifying against a real
  database, not by reading the code.
- **The QBO mirror is HEADER-ONLY** — `invoices` has no line detail and no raw
  payload. A GL cannot be built by transforming what we already hold; every
  transaction must be re-read from QBO in full. That is the real scope here.

### Trial Balance: ours, never QuickBooks' (settled 2026-09-14)

**A Trial Balance (or P&L, or Balance Sheet) we show anyone comes from our own
`journal_lines`.** `lib/accounting/financials.ts` must stay computable with no
network at all — that is what makes it ours rather than a proxy.

- `lib/accounting/qbo-gl-verify.ts` calls QBO's `TrialBalance` report, and that
  is the ONLY sanctioned use: proving our ingested ledger matches their books,
  account by account, before anything reads from it. It is a test fixture
  reached from the CLI (`--verify`), never from the app.
- **`tests/architecture.test.ts` enforces this**, and the guard has been proven
  to fail on a real violation, not just to pass. It also pins the ingestion to
  the CLI. **When the ingestion is finally wired into the sync, that test is the
  thing to update — deliberately, in the same commit.**
- `/reporting/trial-balance` is a QBO passthrough and is currently the only TB a
  QBO org can see. Leave it until the native one reconciles, then retire it.
  Removing it first takes away a working report and gives nothing back.
- **Open decision: history cutoff.** Ingesting from a cutoff date needs an
  opening-balance journal at that date or the TB will not tie; that is not
  built. Ingesting all history avoids it. Recommendation on record: all history.

## Key domain concepts

- **Collections Board** (`app/(app)/board/`, `components/board-list.tsx`): the
  daily working screen. Rows = open invoices, grouped Customer→Project.
- **Stage** is the single dynamic state per invoice. The pill shows the richest
  state: Escalated (`→ Owner · Type`), Disputed (`· reason`), **Broken
  commitment** (a promise whose date has passed — shown in red, NOT "Committed"),
  Committed (`· date`), or a plain stage. Escalation/Committed/Disputed each open
  an inline picker. Stage & customer response are unified: `recomputeInvoiceState`
  in `lib/portal.ts` syncs promise→Committed / dispute→Disputed and reverts.
- **Colour on the board means EXCEPTION, nothing else.** `lib/stages.ts` owns
  the rule: `isExceptionStage()` (Disputed / Escalated / On Hold — keyed on the
  immutable `key`, never the renameable label) earns a filled chip via
  `stageChipClass()`; every other stage is quiet text plus a `stageDotClass()`
  hue dot. Four places render a stage (invoice row, customer band, project
  band, the activity popover's stage-change event) and all four go through
  these helpers, so a stage can't gain or lose colour depending on which branch
  drew it. Derived states rank above plain ones: **Broken commitment is
  deliberately hotter than Disputed** (the customer named a date and missed
  it); a live Committed reads quiet, because a commitment is good news.
  ⚠️ **Never use `STAGE_COLOR_CLASSES[...].badge` on a dark surface** — the
  `bg-stone-100 text-stone-700` pair is LIGHT-mode steps, and under the default
  dark `:root` `--st-100` is rgb(245 245 244), so it renders as a near-WHITE
  pill on the near-black board. Worse for accents: `accentSteps` only routes
  200–500 through CSS variables, so `bg-blue-100` falls through to a literal
  Tailwind pastel that ignores the theme entirely. Only the 200–500 steps
  (`.dot`) are theme-aware.
- **Escalation types** (`lib/escalation-types.ts`): stage stays "Escalated"; the
  *type* (Handed Over, Final Account, Retention, Legal, etc.) is the "why".
- **Promise lifecycle** (`invoice_promises.status`): `Active` on creation →
  `Superseded` when a newer promise replaces it (response route) → `Broken` or
  `Met`, both written by the daily cron sweeps in `app/api/cron/route.ts`. The
  kept sweep runs BEFORE the broken one so an invoice paid *on* its promise
  date counts as kept. `Met` had no writer at all until 2026-09-15 — kept
  promises just stayed `Active` forever, which made the ledger one-sided
  (only evidence against customers) and would have skewed any kept-rate or
  reliability metric built on it. Both sweeps skip soft-deleted invoices
  (`invoices.deleted_at`) — flipping a promise to Broken on an invoice
  QuickBooks has deleted blames a customer for a document that no longer
  exists. On-time vs late comes from `invoices.paidAt`
  (the settling document's own date), sliced as a string — it's a YYYY-MM-DD
  varchar, and round-tripping it through `Date()` re-introduces the timezone
  shift that column exists to avoid.
- **Linked transactions** (`transaction_links` table, `lib/accounting/links.ts`):
  a bidirectional, amount-tracking relationship graph — the native equivalent
  of QBO's `LinkedTxn`. Used for Estimate/PO→Invoice/Bill conversion,
  Payment/BillPayment→Invoice/Bill (incl. credit application), GR→Bill,
  Shipment→Invoice, and Deposit→Payment sweeps (`relation: "deposit_sweep"`,
  wired in `lib/accounting/documents.ts`'s Deposit branch via the form's
  optional payment picker). `fromLineId`/`toLineId` (migration `0064`) let a
  link target a specific `journal_lines`/`trade_document_lines` row, not just
  a document header — matching QBO's `TxnLineId`. No FK on `from_id`/`to_id`
  (or the line variants) — the type is polymorphic across
  `trade_documents`/`journal_entries`/their line tables, so a real FK isn't
  possible without a discriminated schema; same tradeoff QBO itself accepts.
  QBO/Xero-synced orgs use a **separate, parallel** mechanism —
  `paymentApplications` (`lib/qbo-sync.ts`, raw-QBO-id-keyed, feeds
  `lib/ar-aging.ts`) — because their invoices/payments live in their own
  mirror tables (`invoices`/`payments`), not the native GL; this is the
  already-tracked, much larger Accounting Core unification, not solved here.
  `linksForAny()` bridges the two on the READ side only (merges
  `transaction_links` with a `paymentApplications` lookup into one
  `RelatedDoc[]` shape) so a "Linked transactions" panel works for either kind
  of org without touching the QBO sync write path — see
  `app/(app)/accounting/transactions/[id]/page.tsx` (native) and
  `app/(app)/invoices/[id]/page.tsx` (QBO-mirror) for the two consumers.
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
- **Inventory & manufacturing (perpetual, FIFO by lot):**
  - **Item kinds** (`lib/inventory/item-kinds.ts`) are the single source of truth
    for accounting behaviour. `apItems.productType` ∈ FinishedProduct | StockItem
    | RawMaterial | WorkInProgress | NonInventory | Service. Each declares
    tracked/sellable/buyable/producible/consumable. `kindOf()` normalises;
    `qboItemType()` keeps the legacy `itemType` (Service/Non-Inventory/Inventory)
    in sync for reporting. Tracked items carry `assetAccountId` + `cogsAccountId`
    (default to the **Inventory Asset** / **COGS** system accounts, added to
    `SYSTEM_ACCOUNTS`, resolved by subtype `Inventory` / `SuppliesMaterialsCogs`).
  - **Valuation engine** (`lib/inventory/valuation.ts`): a LOT (`inventory_lots`)
    is a dated FIFO cost layer. `commitReceipt` creates one on purchase/production;
    `planIssue`/`commitIssue` relieve oldest-first (or specific picked lots) at
    exact cost; `reverseInventoryByEntry` unwinds a document's lots/movements
    (refuses if stock was consumed downstream). `recalcItemCache` recomputes the
    cached `on_hand_qty`/`inv_value` from open lots after every change (neon has
    no transactions — plan read-only, then commit, then recalc). Every movement
    is logged in `inventory_movements`.
  - **Posting** (`lib/accounting/documents.ts`): Bill/Expense of a tracked item
    routes the debit to its Inventory Asset (not expense) and creates a receipt
    lot; Invoice/SalesReceipt appends **Dr COGS / Cr Inventory** at FIFO cost
    (home currency, appended after `toHome`) on top of Dr AR/Bank–Cr Revenue.
    Credit notes / vendor credits (returns) don't move stock yet — known TODO.
    The form now carries `itemId` (+ lot no/expiry on purchase lines) to posting.
  - **BOM** (`boms`/`bom_lines`, `/api/inventory/boms*`, `components/bom-register.tsx`,
    `/accounting/bom`): recipe of output←input items. **Production build**
    (`lib/inventory/production.ts`, `/api/inventory/production`,
    `components/production-console.tsx`, `/production/build`) consumes picked
    input lots and produces an output lot at the summed cost — Dr output Inventory
    / Cr each input Inventory, no P&L. `production_runs`/`production_consumptions`
    record it. "Production" is a numbered DocType (BUILD- series).
  - **Procure-to-pay (three-way match):** PO (`trade_documents`, non-accounting)
    → **Goods Receipt** (`goods_receipts`/`_lines`, `lib/inventory/receiving.ts`
    `postGoodsReceipt`: Dr Inventory / Cr **GR/IR** clearing + FIFO lot, lot #
    captured here) → **Bill from receipt** (`billFromReceipts`: reuses
    postDocument with GR/IR-clearing lines → Dr GR/IR / Cr A/P). GR/IR is a
    system account (subtype `GRIRClearing`). PO lines carry pack-level ordering
    (`order_uom`/`pack_level`/`units_per_order_unit`/`ordered_base_qty`) +
    `received_qty`/`billed_qty`. UI: `/accounting/receiving`
    (`receiving-console.tsx`). Reports: Open POs / Expected Bills (open GR/IR) /
    Open Bills + inventory Expected-Qty (`/api/inventory/procurement-reports`,
    `components/procurement-reports.tsx`). Every step is bypassable (receive
    with no PO; a direct Bill with inventory items still posts Dr Inventory /
    Cr A/P and makes lots).
  - **Order-to-cash (sales mirror):** Sales Order (`trade_documents` kind
    `SalesOrder`, non-accounting, pack-level ordering from finished-product SKUs)
    → **Shipment** (`sales_shipments`/`shipment_lines`, `lib/inventory/shipping.ts`
    `postShipment`: **COGS at shipment** — Dr COGS / Cr Inventory at FIFO cost)
    → **Invoice from shipment** (`invoiceFromShipments`: Dr A/R / Cr Revenue;
    invoice lines carry no `itemId` so COGS is NOT re-posted). UI:
    `/accounting/shipping` (`shipping-console.tsx`). SOs are fulfilled via
    Shipping, never converted. Reports: Open SOs / Awaiting Invoicing / Open
    Invoices (`/api/inventory/sales-reports`, `components/sales-reports.tsx`);
    Stock Status shows Committed (on SO) and Available = on-hand+expected−committed.
    Bypassable: ship with no SO; a direct Invoice with inventory items still
    posts revenue + COGS itself. (`receivedQty`/`billedQty` on trade lines are
    reused as shipped/invoiced for SOs.)
  - **Job work / subcontracting** (`job_work_orders`, `lib/inventory/jobwork.ts`,
    UI `/accounting/jobwork`): send owned material to a vendor for external
    processing (knitting, dyeing, ...) and receive it back transformed, still
    owned throughout — neither a purchase (fresh cost, ownership transfers)
    nor a sale (ownership leaves) fits this, so it's its own pattern.
    `dispatchToJobWorker` relieves the sent item's FIFO lots into a new system
    account, **Materials with Job Worker** (subtype `JobWorkMaterials`) — Dr
    clearing / Cr Inventory, no COGS/revenue since ownership never transfers.
    `receiveFromJobWork` creates a lot for the RECEIVED item at (carried
    material cost from that clearing account + a processing fee), and records
    the **fee-only** portion into the ordinary `goods_receipts`/
    `goods_receipt_lines` tables so the ALREADY-EXISTING three-way-match Bill
    flow (`billFromReceipts`) bills the job worker for their charge completely
    unchanged — the material cost never touches GR/IR, so it's never billed
    (correctly: you don't owe the vendor for material you already own).
    Proven end-to-end on a 100k-unit textile scenario (Yarn → Knitter → Grey
    Fabric → Dyer → Dyed Fabric → in-house cut-&-sew production → Shirts):
    the Job Work clearing account nets to **exactly zero** once every dispatch
    is matched by its receipt.
  - **Not yet:** UoM conversion on Bill/invoice/BOM lines (qty assumed base UoM
    outside PO/SO/receiving/shipping); sales/purchase-return inventory;
    standard-cost variances; multicurrency GR/IR & AR/AP FX variance.
  - **Order-linked traceability & delay tracking** (Phase 1-3 of the textile
    roadmap, `lib/inventory/manufacturing-orders.ts`/`jobwork.ts`/
    `lib/accounting/trade-documents.ts`, `app/(app)/accounting/trade/
    sales-orders/[id]/page.tsx`, `inngest/functions/chase.ts`'s
    `supplyChainWatchdog`): `manufacturingOrders`, `jobWorkOrders`, and
    PurchaseOrder-kind `tradeDocuments` all carry an optional `salesOrderId`
    — set at creation via a picker in each console/form, never required, so
    an org not doing make-to-order manufacturing sees nothing new. The
    **Order Production Tracker** (`/accounting/trade/sales-orders/[id]`,
    reached via a "Track" link on each Sales Order row) aggregates every
    linked PO/Job Work/MO plus shipments (`shipment_lines.so_id`, already
    existed) into one timeline — no new per-document detail views, it only
    aggregates existing ones. `jobWorkOrders.expectedReturnDate` (new) and
    PurchaseOrder's existing `expiryDate` (already labeled "Delivery date"
    in the PO form — reused rather than duplicated) are what the daily
    `supplyChainWatchdog` cron compares against `today`, upserting
    `supply_chain_alerts` (resolved, never deleted, once the doc closes or
    the date clears) — same one-sweep-across-every-org shape as the existing
    `brokenPromiseSweep`. Surfaced three places off the one `GET
    /api/inventory/alerts` list: the Tracker's per-step badges, the
    **Delivery Risk** report (`/accounting/reports/delivery-risk`), and a
    new header bell (`components/alert-bell.tsx`) — the first in-app
    notification surface in the app (previously chase-email-only). Material
    reservation/reallocation and planned-vs-actual costing are the next
    phases, designed for but not built — see the roadmap plan for the full
    picture.

## Inventory Chart-of-Accounts mapping — roles & posting groups (2026-09-24)

Phase 2 of the inventory-accounting spec (GAP_REPORT.md is Phase 1). **Posting
never names an account.** It names a ROLE (18 of them, `lib/accounting/account-roles.ts`)
and the item's POSTING GROUP says which of the tenant's accounts plays it.

- **Four group types**: RM, WIP, FP and **TRADING** (`StockItem`, bought and
  resold — decided with the product owner; it sells as goods, so it uses the
  FG roles, but it has its own group and its own seeded stock/sales/COGS
  accounts). `groupTypeForKind` maps kinds; untracked kinds have no group.
- **`lib/accounting/account-roles-server.ts` is the one resolver.**
  `loadItemCostInfo` (valuation.ts) resolves every tracked item through it, so
  `item.assetAccountId` / `cogsAccountId` / `incomeAccountId` on an
  `ItemCostInfo` are the RESOLVED accounts (group role, validated override on
  top) — not the raw item columns. Non-item roles (GRNI, WIP_OPEN_ORDERS,
  SCRAP_LOSS, …) come from `roleAccount(item, role)`.
- **The block lives in `loadItemCostInfo`**: a tracked item whose group has any
  unmapped role throws `AccountMappingError` (a `LedgerValidationError`, so every
  route already returns 400) before anything is planned. One choke point, like
  `resolveLocationId`. Guarded in `tests/architecture.test.ts`, along with "no
  poster looks an account up by subtype" and "no `?? invAssetId` fallback" —
  both proven against the pre-Phase-2 posters.
- **`INV_SUBTYPE` is gone, and the five inventory accounts left
  `SYSTEM_ACCOUNTS`.** `systemAccountId(org, "Inventory")` returned the FIRST
  match, and listing stock accounts in `SYSTEM_ACCOUNTS` seeded a stock ledger
  into every Receivables-only tenant (it runs from ~20 paths). Orgs that have
  the old 1200/5000/5900/2150/1250 keep them.
- **Provisioning is lazy** (`ensureInventoryAccounting`), same rule as locations
  and Suspense. A **native** chart gets the 18 default accounts (+3 trading, +
  an `Inventories` header, blank codes, `is_system_default`, `default_role`)
  and the four default groups. **Existing GR/IR, COGS and Inventory Adjustments
  are ADOPTED**, not duplicated — GR/IR carries every open receipt. The old
  catch-all "Inventory Asset" is deliberately NOT adopted; the R-10 script
  reclasses it. A **synced** chart (any account with `source <> 'native'` —
  judged by the chart, not the token: AM MERCHADISING holds a Xero token and
  keeps its books here) gets the groups only; the tenant maps roles to its own
  accounts, and "Create missing default accounts" creates them LOCALLY. Nothing
  is ever pushed to QuickBooks/Xero.
- **Control accounts**: an account mapped to RM / WIP stock / WIP open orders /
  FG is refused by `postJournalEntry` for `Manual`, `Opening`, `Deposit` and
  `Transfer` entries (mirrored provider entries exempt), and by `postDocument`
  for any ACCOUNT line (no stocked item) on a sales/purchase document. Header
  accounts can never be posted to.
- **What each poster now does**: receipts Cr the item group's GRNI (a receipt
  may credit several); bill-from-receipt Dr the GRNI of each line's item;
  shipments/invoices use COGS_FG or COGS_SURPLUS and SALES_FG / SALES_SURPLUS
  by group, so raw material sold as surplus is no longer refused for "no
  income account"; credit notes on stocked items Dr SALES_RETURNS (stock still
  does not move back — P-14 is a known gap); builds post Cr components → Dr/Cr
  WIP_OPEN_ORDERS → Dr output, netting to zero; job work dispatch/receive/close
  use the SENT item's WIP_OPEN_ORDERS (the received item isn't known at
  dispatch, and the three must hit one account), wastage → SCRAP_LOSS, a gain →
  PRODUCTION_VARIANCE; **transfers post nothing** (P-18) — the per-location
  `inventory_account_id` is no longer read. **A PO line for a stocked item
  cannot be converted straight to a Bill** (`convertTradeDoc`) — that was how
  BILL-0004 double-counted €20,000.
- **Item form**: a tracked item picks a posting group (blank = default of its
  type); its accounts are shown read-only from the group, with an admin-only
  override limited to accounts of the role's type (`components/item-accounting.tsx`,
  server re-checks in `prepareItemAccounting`). An override equal to the group's
  account is not stored. Changing the stock account of an item that holds value
  is refused — remap the group instead. "Purchase cost" is now "Default purchase
  price". There is no separate Finance Admin permission; `company_admin` /
  `super_admin` play that part, as they already gate every item edit.
- **Remap (R-08)**: changing a stock role's account returns 409 with the
  reclass for confirmation; confirmed, it posts a `Reclass` entry dated on the
  effective date, THEN saves the mapping. Whole balance if the old account was
  exclusive to that role; this group's stock value if shared; a shared WIP
  account with a balance is refused.
- **Reports (R-09)**: `/accounting/reports/stock-vs-gl` (per inventory ACCOUNT,
  with the groups posting to it — the GL can only be compared per account) and
  open job-work vs WIP. The same comparison is reconcile check
  `inventory_vs_gl`. Both read-only (`provision: false`): looking at an org must
  never seed its chart. As-at stock value comes from `inventory_movements`
  (transfers excluded); a void deletes its movements, so an as-at date between
  a document and its void can disagree with the GL.
- **Migration 0095** creates the tables and clears item asset/COGS fields that
  merely pointed at the old system Inventory Asset / COGS (a form default, not a
  choice — left in place it would read as an override and keep everything on
  the catch-all). **`scripts/migrate-inventory-accounting.ts`** is R-10: dry run
  by default, `--commit` to apply, idempotent. It reclasses the old account at
  stock valuation per type and REPORTS the residual (AM: €20,180.01, the BILL-0004
  double count + GRN-0035 — GAP_REPORT §C), never plugs it.
  **Run with `--commit` for AM MERCHADISING on 2026-09-24** (JE-0001: 4,427.61
  → Finished Goods Inventory, 15,199.00 → Trading Goods Inventory, 616.00 →
  Raw Materials Inventory; 20,180.01 left in the old 1200 by design). After it,
  `inventory_vs_gl` passes on all four role accounts. The old 1200 is not a
  role account, so that report does not show its residual — look at the
  account itself. The four synced tenants have NOT been run: they would only
  get groups, which lazy provisioning also creates on first use.
- **A group maps only what something posts to** (`rolesForGroupType`,
  2026-09-24, product owner's rule: "only accounts that are practically
  applicable — keep it friendly without compromising what is important"). Raw
  material 8, semi-finished 11, finished 13, trading 8. Each group has its OWN
  stock / sales / cost-of-sales role (never a sibling's — a Raw Materials group
  showing "Finished goods inventory" was reported as confusing). Labour,
  overhead, production variance and scrap loss only on what is PRODUCED
  (semi-finished, finished); purchase price variance only on what is BOUGHT
  (not semi-finished); returns only on finished and trading; WIP open orders on
  everything that can go to a job worker or be built (not trading). **Scrap
  sales is on no group** — scrap is never stock; its income account belongs on
  the non-stock scrap item. Where an ORDER needs a role the item's type lacks
  (trading goods sent to a job worker; a job-work order whose output is raw
  material), `orderRoleAccount` falls back to the default Finished Goods group.
  Job-work wastage/gain at close now read the OUTPUT item's group, as the spec
  says order accounts should. The screen lays each group out by
  `groupRoleSections` (empty sections dropped). 0096 and 0097 pruned the rows
  the lists exclude; the accounts themselves were never touched.
- **Provisioning is idempotent across adoption**: an adopted account keeps its
  own name, so it stands in for its role's base default by `default_role`, not
  by name. Without that, the second run created a duplicate "Cost of Sales –
  Finished Goods" beside the adopted 5000 (caught on the production re-run).
- **Not built (recorded, not forgotten)**: P-03 invoice-price variance into lot
  cost, P-05/P-14 returns to the original lot, P-10 yield-aware scrap, P-11 MO
  close, P-15/P-16 stock count & write-down (their roles exist and are mapped,
  nothing posts to them yet), labour/overhead rates (P-06 — none exist), per-item
  can-be-sold/purchased flags, two tax fields. The QBO/Xero account sync still
  omits Other Current Asset/Liability, Income and Bank types, so a synced
  tenant may not find its external Inventory account to map yet.

## Supplier sourcing — who may supply an item (2026-09-21)

Two objects, deliberately apart. Every mature system splits them the same way
(SAP purchasing info record vs source list; Oracle supplier-item attributes vs
ASL status; NetSuite item-vendor sublist; Odoo `product.supplierinfo`) and
collapsing them is the mistake this design exists to avoid:

- **`item_supplier_skus` is COMMERCIAL** — what this vendor charges, in what
  unit, in what packs, how long they take. **Never restrictive by itself.**
- **`ap_items.sourcing_policy` is AUTHORISATION** — `restricted` (default: only
  linked suppliers) or `open` (anyone, base UoM, **no pack configuration**).

**`open` cannot live on a link row.** Such a row would carry the `supplier_id`
it is simultaneously claiming not to have. It is a property of the ITEM — where
SAP also puts it. The UI still renders the toggle at the head of the item's
Suppliers panel, because that is where the question is asked.

- **Pack configuration is withheld from `open` items, not merely unused.** A
  pack describes one *named* vendor's packaging; an open item has no vendor to
  name. `allowsPackConfiguration` is always the inverse of `allowsAnySupplier`
  and `tests/sourcing.test.ts` pins that pairing — nothing may re-derive it.
- **`open` and "no link yet" are different facts.** `open` = anyone may supply
  it. A missing link on a `restricted` item = the decision has not been
  recorded. Don't collapse them; the error message says how to record it rather
  than only refusing.
- **Enforced on `PurchaseOrder`, `Bill` and `Expense` — every document that
  ACQUIRES goods, not just the PO.** A Bill with a tracked item posts Dr
  Inventory and creates FIFO lots with no PO anywhere, so a PO-only rule is
  advisory: the first person in a hurry posts a Bill instead.
  - **`VendorCredit` is exempt** — a *return*, not a purchase; blocking it
    strands a legitimate return once a link is tidied away.
  - **Job work is exempt** — material sent to a knitter was never bought from
    them.
  - **Goods receipts are exempt, deliberately.** The goods are physically on
    the dock; refusing to record stock that exists is the same failure the
    unlocated-stock rule already rejects ("drift is better than refusing to let
    physical stock move"). `billFromReceipts` is naturally exempt too — its
    lines are GR/IR clearing lines with `itemId: null`, so nothing is stranded.
- **`lib/inventory/sourcing.ts` (pure, client-safe) vs
  `lib/inventory/sourcing-server.ts` (imports `db`)** — same split, and same
  reason, as `lib/modules.ts` / `lib/modules-server.ts`. Guarded in
  `tests/architecture.test.ts`, along with both posting paths calling the check
  and the check running BEFORE any line is built. Proven to fail on a real
  regression.
- **The form's narrowed picker is help, not the control.** It can be bypassed
  by a direct API call, the mobile client, or its own "Show all items" escape.
  The client-side check exists only so the buyer hears it before pressing Post.
- **Prices are quoted per ONE SUPPLIER UoM**, matching the vendor's own price
  list — a record you can't check against the price list is one nobody
  maintains. A line charges per *order* unit, which varies by pack level, so
  the two reconcile through the base unit: `price/base = unit_price ÷
  base-units-per-supplier-unit`, then `rate = price/base × units_per_order_unit`.
  Every level derives from one figure, so `rate × qty` is the same money
  whichever unit was ordered in — separately rounded pack prices would drift and
  GR/IR would stop netting off. `numeric(18,6)`, because 100 over 3 kg doesn't
  divide evenly.
- **A supplier price is only defaulted when its currency matches the
  document's.** Defaulting across a currency boundary silently misstates a line.
- **Existing items were linked from purchase history, not left blocked**
  (migration `0090`, 2026-09-22). Production had 249 tracked items and one
  link, so `restricted` alone would have refused every purchase those orgs
  already make. `0090` links each item to every supplier the system shows it
  was bought from (purchase lots, goods receipts, trade-doc POs, Payables POs,
  and synced + native bills — `ap_bill_lines.item_id` is the PROVIDER's id,
  mapped via `external_id` for QBO and `code` for Xero, keyed on
  `qbo_id`/`xero_id`, never `source`). Links are item + supplier only, with no
  invented UoM or price. **An item with no purchase history gets nothing — by
  design**: the user links the supplier before the first PO. Don't "fix" that
  by opening such items up.
- **A price is quoted AT A LEVEL, in the SUPPLIER's currency** (migration
  `0092`). `quoted_price` + `price_basis` (`unit | inner | outer`) hold the
  price exactly as quoted — "300 per 30-litre bottle" — and `unit_price` is
  its per-supplier-UoM equivalent, derived on every save. The quote is KEPT,
  not just converted, because conversion is lossy: 100 per 3-litre bottle is
  33.333333/litre at 6dp, which multiplies back to 99.999999. PO pricing
  (`basePriceOf` in `lib/inventory/sourcing.ts`, used by `orderOptions`) works
  from the quote at its own level, so ordering at the quoted level returns the
  quote exactly and ordering by the litre is the same figure divided down.
  `tests/price-basis.test.ts` pins it. A link's `currency` is always its
  supplier's, set server-side — never the form's; the drawer shows it
  read-only. **A supplier's currency is set once**: `PATCH
  /api/payables/suppliers/[id]` refuses to change a non-empty one (every
  document and link price is in it; changing it restates them all without
  converting a figure). `""` = not set yet, and may still be set.
- **Purchase Order and Bill lines are split into ITEMS and ACCOUNTS**
  (`SPLIT_TYPES` in `components/new-document-form.tsx`; every other document
  keeps the single mixed table). An item line picks the supplier's SKU, shows
  its pack configuration, and takes Qty as [number | unit] and Rate as
  [number | per-unit] — the two units may differ ("5 cartons at 2.00 per m").
  `rate` stays per ORDER unit, derived by `ratePerOrderUnit`, so qty × rate =
  amount for every reader downstream; the entered price and its unit are kept
  (`price_input`, `price_level`, `units_per_price_unit` on trade lines, 0094;
  in `sourcePayload` for a Bill) so a reopened document shows what was typed.
  The SKU's saved price fills in at the level it was quoted.
- **A Bill line's quantity is converted to BASE units before it becomes
  stock** (`baseQtyOfLine`, used by `postDocument`'s inventory plan). Before
  this, posting took qty as-is, so a Bill of "5 cartons" of 600 m would have
  received 5 m at 600× the cost per metre. The edit loader must bring
  `unitsPerOrderUnit` back with each line, or a reopened pack-level Bill would
  re-post in base units. PO `ordered_base_qty` was also rounded to 2dp
  (`round2`) — now `roundQty`, like every quantity.
- **Item names are unique per org, case- and space-insensitive**
  (`lib/inventory/item-name.ts`), checked on create, rename and the Accounting
  quick-add. App-level, not an index: existing duplicates may already be in
  the data and an index would fail to build against them.
- `is_preferred` is one-per-item via a **partial unique index**, not application
  logic — two concurrent saves can't both win and neon-http has no transaction
  to hold. Same reasoning as 0087's default-location race.
- **`apItems.unitCost`/`unitPrice` are still `real()`** — 4-byte floats holding
  money, now sitting beside a `numeric(18,6)` supplier price. Known, flagged,
  not yet fixed: changing them flips the Drizzle type from `number` to `string`
  and ripples through every consumer, so it wants its own commit.

## Barcodes & GS1 — the foundation for labels and scanning (2026-09-22)

Groundwork for printing GS1-128 labels and, later, filling receiving in from a
mobile-camera scan. Nothing prints or scans yet; the data model and the rules
are what this lays down.

- **`item_identifiers` (migration `0091`) holds every barcode, one row per
  code** — not columns on the SKU tables, because the one question a scanner
  asks is "what is THIS code?", and that must be ONE indexed lookup
  (`item_identifiers_code_idx`). Owner = a sales SKU (`item_sku_id`), a
  supplier link (`supplier_sku_id`), or neither (the item's base unit). Pack
  level `unit | inner | addl_inner | outer`, matching the levels the two SKU
  tables already describe. A pallet is not a level: it is a logistic unit,
  identified per shipment by an SSCC (AI 00), not a trade item with a GTIN.
- **GTINs are stored normalised to 14 digits** (`lib/gs1.ts`
  `normaliseGtin`), so an EAN-13 and the same number scanned as GTIN-14 match.
  Non-GS1 barcodes are scheme `OTHER`, kept as entered.
- **`classifyBarcode` (`lib/inventory/identifiers.ts`) is the one rule**, used
  by every field and the API: anything GTIN-SHAPED (all digits, 8/12/13/14)
  must pass its check digit or it is REFUSED — never quietly filed as OTHER,
  where a typo would silently never match the real box.
- **Uniqueness is per OWNER, deliberately not per org.** A GTIN is the
  manufacturer's, not the distributor's: the same yarn bought from two
  suppliers carries one GTIN on both links. The hard rule — one code never
  points at two different ITEMS — is enforced in
  `lib/inventory/identifiers-server.ts` (`prepareIdentifiers`), and a scan will
  be disambiguated by the supplier on the receipt. Every write goes through
  `prepareIdentifiers` (validate, no writes) then `writeIdentifiers` —
  neon-http has no transactions, so check everything first.
- **Supplier batch ≠ our lot number.** `inventory_lots.lot_no` is ours and
  unique org-wide (traceability depends on it). The supplier's batch used to
  be typed straight into it, so two suppliers both printing "2401" collided and
  the second receipt failed — scanning would make that routine. It now has its
  own column, `supplier_batch_no` (AI 10, not unique, indexed), beside
  `production_date` (AI 11), `best_before_date` (AI 15) and the existing
  `expiry_date` (AI 17). Captured on the Receiving console.
- **`lib/gs1.ts` is pure and shared** (web, server, mobile): GTIN check digit,
  GS1-128 element-string parse (raw with GS separators and symbology prefix,
  or the human-readable "(01)…(17)…" form) and build (fixed-length AIs first,
  GS only between variable ones). It REPORTS an unknown AI instead of guessing,
  because mis-splitting one field corrupts every field after it. Dates are
  read literally (a date is a date) with GS1's century window and DD=00 =
  month end. `tests/gs1.test.ts` uses GS1's own reference numbers and pins the
  build → parse round trip.
- **SKUs and supplier links are now editable** (PATCH on
  `/api/inventory/skus` and `/api/inventory/supplier-skus`). Once documents
  use one, the fields that decide QUANTITY freeze (unit, pack sizes,
  conversion factor) because they already decided how much stock those lines
  became; names, codes, price, lead time and barcodes stay editable. A link's
  supplier never changes — it is the link's identity.
- `item_skus.upc` was carried into `item_identifiers` by 0091 (valid GTIN →
  GTIN, anything else → OTHER) and is no longer read or written. Drop it in a
  later migration.
- **Next, not built:** label printing from a lot (GTIN + batch + expiry via
  `buildGs1`), SSCC for pallets/shipments, GLNs on parties and locations, a
  GS1 company prefix on the org to allocate GTINs for our own finished
  products, serial numbers (per-unit tracking is its own feature), and the
  mobile scan → `parseGs1` → identifier lookup → receiving line.

## Item kinds — audit findings (2026-09-21)

`ITEM_KINDS` flags are load-bearing: posting picks asset vs expense from
`tracked`, production refuses a non-`producible` output, the Products register
decides which panels an item has, and purchasing refuses a non-`buyable` line.
A flag changed carelessly does not fail loudly. `tests/item-kinds.test.ts` pins
the invariants other modules already assume (producible/consumable ⇒ tracked,
lot-tracked ⇒ tracked, every kind acquirable somehow, every kind in
`ITEM_KIND_LIST`), each proven to fail on a real regression.

- **Work in Progress is the kind every branch forgets** — tracked, but neither
  bought nor sold. It opened the register to a completely blank panel, and the
  Phase 3 purchasing check told the buyer to "link it on the Suppliers panel",
  which WIP does not have and never will.
- **The register's expanded panel is now DERIVED from the flags**, with the
  explanation as the remainder, so it is exhaustive by construction. The old
  hand-written fallback (`!tracked && !buyable`) was satisfiable by **no kind at
  all** — both untracked kinds are buyable — so that text never once rendered.
  Don't reinstate the simpler-looking condition; a test keeps the evidence.
- **`PATCH /api/inventory/items/[id]` now mirrors POST's system-account
  fallback.** The edit drawer offers "Inventory Asset (system default)" as a
  blank option; without the fallback it wrote NULL, and the item then failed on
  every document with "no expense account set" — naming a field that kind does
  not even show. Evaluated against the kind the item *will* have, so a Service
  changed to a Raw Material lands with its accounts already correct.
- **`buyable` is enforced on purchase documents; `sellable` is deliberately
  NOT enforced on sales.** Buying a Work in Progress is incoherent — it is
  created by a build. Selling a Raw Material is merely unusual: scrap and waste
  sales are real, and textile orgs do them routinely. Enforce what is
  impossible, not what is uncommon.
- **Still unenforced server-side: `consumable`.** Only `producible` (in
  `lib/inventory/production.ts`) and now `buyable` are checked. Flagged rather
  than fixed — BOM lines are the place it would belong.

## Stock locations (Supply Chain completion, Phase 1, 2026-09-21)

Stock is location-aware. Until migration `0087`, `inventory_lots` and
`inventory_movements` carried NO location — `location_id` existed only on
`journal_lines`/`trade_document_lines`, where it is a GL *reporting dimension*,
not a place. A business with a raw store, a WIP floor and a finished-goods
warehouse could not say where anything was.

- **The lot stays the cost layer and the identity; location is a physical
  overlay.** `inventory_lot_locations` (lot → location → qty) records where a
  lot's remaining balance sits. Splitting lots per location was the alternative
  and was rejected: it multiplies lot codes, breaks the org-wide unique lot
  number that traceability depends on, and makes FIFO ordering ambiguous.
- **The invariant**: `inventory_lots.remaining_qty` = Σ its
  `inventory_lot_locations.qty`. "No rows" counts as zero, so a depleted lot is
  correctly consistent. Checked by `lib/accounting/reconcile.ts`
  (`lot_placement_balances`), alongside `placement_tenancy`, which proves no
  org's stock sits in another org's location.
- **`resolveLocationId()` in `lib/inventory/locations.ts` is the tenancy choke
  point.** Every stock-moving path resolves through it, so the "does this id
  belong to this org?" check lives in ONE place rather than in each caller —
  same principle as `fetchQboInvoicePayInfo` for pay links. A Postgres FK proves
  a location row exists, not whose it is. `tests/architecture.test.ts` enforces
  both that only `locations.ts` mutates the placement table and that every mover
  calls the resolver; both guards were proven to fail on a real violation.
- **FIFO is decided by LOT; location only narrows what is reachable inside a
  lot.** It never reorders the cost layers — that ordering is what makes cost
  deterministic. Within a lot, slices are taken in location-code order so a plan
  built twice picks the same way. `reachableSlices` is exported and unit-tested
  (`tests/stock-locations.test.ts`) because it is the whole rule.
- **Quarantine is never picked by FIFO.** `NON_ISSUABLE_TYPES` excludes it from
  unscoped picking; naming it explicitly is refused by
  `resolveLocationId({ forIssue: true })`. **A transfer deliberately does NOT
  pass `forIssue`** — moving stock OUT of Quarantine is the release step. Note
  the subtle trap the tests guard: the unlocated-gap calculation counts
  Quarantine as *placed*, because computing the gap from issuable placements
  only would report that stock as unlocated and FIFO would then draw it anyway,
  defeating the exclusion entirely.
- **Unlocated stock is drawn and flagged, never refused.** If a lot's placements
  don't cover its balance, the shortfall is issued with `locationId: null` and
  reported in `IssuePlan.unlocatedQty`. Drift is an integrity break the
  reconciliation reports — but refusing to let physical stock leave the building
  because a row is missing is a worse failure than the drift.
- **`commitIssue` spills.** The lot balance comes down first, so the placement
  must follow or the two disagree; if a concurrent write emptied the named
  location since planning, it takes what is there and spills the rest across the
  lot's other placements before logging loudly.
- **A transfer changes WHERE, never WHAT IT COST.** `lib/inventory/transfers.ts`
  does not use `commitReceipt`/`commitIssue` — both change the lot's remaining
  balance, which would be wrong here and would also re-date the cost layer,
  quietly corrupting FIFO order. It moves placements only. The GL is touched
  **only** when the two locations map to different inventory accounts
  (`stock_locations.inventory_account_id`, falling back to the item's asset
  account); otherwise nothing changed in the books and a self-cancelling entry
  would be noise. New `StockTransfer` doc series (`STF-`) — deliberately NOT the
  existing `Transfer` (`TFR-`), which is a *bank* transfer.
- **Locations are created on demand, not seeded.** Migration `0087` back-fills a
  "MAIN" store only for orgs that already hold stock; everyone else gets one
  from `ensureDefaultLocation()` at first use. Seeding every org would put a
  "Main Store" in front of every Receivables-only tenant — the same mistake as
  seeding Suspense into every chart of accounts. The race (two first-receipts,
  no transactions) is closed by the partial unique index on
  `(org_id) where is_default`, not by a lock.
- **Deliberate**: an org *without* the manufacturing module that posts a
  document containing a tracked item will still get a default location created,
  because `lib/accounting/documents.ts` is not module-gated. That is correct —
  its stock genuinely needs a home — and invisible to them, since the Locations
  screen is behind the module gate.
- Documents record their own placement: `goods_receipts.location_id`,
  `sales_shipments.location_id`, `production_runs.consume/output_location_id`,
  `job_work_orders.dispatch/receive_location_id`. All nullable — a NULL resolves
  to the org default at posting time, which is what keeps every pre-existing
  path working unchanged.
- **Historical `inventory_movements` are NOT back-filled with a location.** A
  NULL on an old row means "recorded before locations existed"; stamping the
  default onto them would make the movement history assert a physical fact that
  was never observed. Reversal of such a movement restores to the org default,
  because the lot balance goes up and a placement must go up with it.
- **UI**: Supply Chain → Inventory → Stock Transfers and Locations. Both sit in
  Inventory rather than a new "Setup" group — a location is master data about
  where stock lives exactly as Products & Materials is master data about what it
  is, and a two-entry Setup group would split one idea across two places.
- **One picker, four consoles.** `components/location-picker.tsx` holds
  `useStockLocations()` + `<LocationField>`, used by Receiving, Shipping, Build
  and Job Work. Built once for the same reason `resolveLocationId` lives in one
  module: three copies of a control drift, and the one that drifts is the one
  nobody is looking at. **It renders nothing when the org has fewer than two
  active locations** — a single-site business should not be asked to choose
  between one option, and the server resolves the default anyway. Same rule the
  pay-link surfaces follow: hide the affordance, never show a dead one.
  - `issueOnly` hides Quarantine on the *issue* side (ship from, consume from,
    dispatch from). The server refuses it regardless; hiding it stops someone
    finding out only after pressing Post.
  - Receiving and Build-output default to the org default; Shipping, Build-consume
    and Job-Work-dispatch default to blank = "Anywhere", which is the
    pre-locations FIFO behaviour and still right for one site. Job Work receive
    defaults to "As planned at dispatch", falling back to the order's own
    `receiveLocationId`.
- **Stock Status and the by-lot report carry a "Where" column.** Both resolve
  placement in ONE query for the whole org (`placementsByItem`/`placementsByLot`
  in `app/api/inventory/reports/route.ts`) — a per-item round trip would be a
  query storm on a catalogue of any size. A single location shows its code only;
  the quantity split is spelled out only when stock is genuinely in more than one
  place.

## ⚠️ Migration-drift bugs found & fixed (2026-08-29)

Running a from-scratch `npm run db:migrate` against a fresh database (rather
than an already-provisioned one) surfaced two real, previously-latent bugs —
columns the application code has always required that no migration ever
actually created/relaxed. Both are fixed (`0066_external_id_nullable.sql`,
`0067_invoices_source.sql`), but the lesson generalizes: **a schema change
someone applied by hand or via `drizzle-kit push` on a live database, without
also writing the equivalent migration file, is invisible until someone
migrates a truly fresh database.** If a column exists in `db/schema.ts` and
the app writes to it, but you can't find the `ALTER TABLE`/`CREATE TABLE`
that added it in `db/migrations/`, that's this exact bug waiting to happen
again — worth a periodic from-scratch migration test on a throwaway database.

- `accounts`/`ap_items`/`ap_tax_rates.external_id` carried a `NOT NULL` left
  over from before these tables supported native (non-QBO/Xero) records —
  `schema.ts` has declared all three nullable for a long time ("null for
  native records"), and every native insert path has always sent
  `externalId: null`, but no migration ever dropped the constraint. Blocked
  **every** native account/item/tax-rate creation on a fresh database.
- `invoices.source` is written by `lib/qbo-sync.ts`'s QBO ingestion inserts
  AND `lib/accounting/documents.ts`'s `bridgeNativeInvoice`, and read nowhere
  (grepped — no logic depends on it, so backfilling existing rows to
  `'native'` is safe), but the column was never migrated at all. Blocked
  **QBO invoice sync itself**, not just the native bridge — the more
  consequential of the two.

## Data Studio (bulk import/export, `app/(app)/batch/`)

Spreadsheet-driven bulk operations against QBO/Xero — import, export, update,
delete for ~32 entity types. `lib/batch/entities.ts` is the registry: each
entity declares its `columns`, a `build` (sheet → QBO payload), `toRows`
(QBO record → sheet rows), and the `refs`/`reverseRefs` lists to resolve.

**Three things must agree, or a column is a lie:**

1. `columns` — what the header row promises
2. `toRows` — what the export actually fills in
3. `build` — what the import actually reads back

A column present in (1) but missing from (2) exports blank; missing from (3)
means the user's edit is silently discarded on import. Bank Deposits had NINE
such columns (`Received From` most damagingly — the payer name, without which
an export is useless for reclassifying). When adding or touching an entity,
check all three, and prefer a scripted round-trip check (feed a realistic QBO
payload through `toRows` → write the xlsx → `build` it back) over eyeballing.

**Update (modify) always re-reads the record and uses ITS SyncToken, never
the sheet's.** A downloaded sheet's SyncToken is only as current as the
moment it was downloaded — anything touching the record afterward (another
job, a scheduled sync, or just time passing before the edited sheet is
re-uploaded) makes it stale. QuickBooks rejects a stale SyncToken with
"[name] is working on this at the same time" — its generic wording for
"this token isn't current," which fires whether or not anyone is actually
concurrently editing it. `commitOneDoc` (`lib/batch/commit-one.ts`) already
re-reads the record for the estimate-link check and the CustomField merge
(the two full-update fixes above); it just wasn't using that fresh read's
SyncToken in the outgoing payload — still sending the sheet's stale one,
which is exactly what surfaced this false "multiple users" rejection in a
single-user org. Falls back to the sheet's value only if the re-read itself
fails, so a network hiccup doesn't turn into a hard failure when a
plausible token was already in hand.

**Every write operation (import, delete, bulk-edit, update) must go through
ONE shared per-document commit function — `lib/batch/commit-one.ts`'s
`commitOneDoc`.** Fixing a bug in shared logic doesn't help if a second,
independent copy of that logic exists elsewhere and keeps running unfixed.
That's exactly what happened here: `commitOneDoc`'s sparse-vs-full-update
fix (below) was correct, but `commit-runner.ts` — the whole-job runner
behind the dedicated `/batch/modify` screen (`/api/batch/upload/commit`,
used whenever a job is small enough to run inline, ≤100 docs) — had its
OWN independent inline copy of build+estimate-safety-check+sparse+qboPost,
never updated. A user editing a two-line deposit down to one line and
re-uploading through `/batch/modify` kept hitting the still-broken copy,
appending the edited line on top of the original two. `commit-runner.ts`
now calls `commitOneDoc` like `chunk-runner.ts` already did — one
implementation, not two. **Lesson: after any correctness fix to shared
logic, grep the whole tree for the pattern you just fixed** (`sparse`, in
this case) to confirm there isn't a second copy still doing the old thing.

**Update (modify) on a line-item entity must NOT be a sparse patch —
`lib/batch/commit-one.ts`'s `shapeModifyPayload`.** QuickBooks' documented
sparse-update rule for the `Line` collection: a line without its own
line-level `Id` is a NEW line; anything not mentioned is left alone. Data
Studio never round-trips QBO's per-line ids (only the document-level
`Id`/`SyncToken`), so every line in an update payload is always id-less —
under `sparse:true` that meant every "Update" on a downloaded, edited sheet
APPENDED the sheet's lines instead of replacing the old ones (the actual
bug behind "I edited the lines and QuickBooks shows extra ones now"). Fix:
whenever the built payload carries a `Line` array, do a FULL (non-sparse)
update instead — QBO then treats the submitted lines as the complete new
truth. The cost of going full is that any header field QBO tracks that the
builder doesn't send gets reset; the sales/purchase builders already model
tax fields (`GlobalTaxCalculation`, per-line `TaxCodeRef`) on both create
and update, so that wasn't a new gap — `CustomField` was the one real one,
now merged forward from the existing record. Entities with no `docKey`
(list entities, Transfer, TimeActivity, …) never carry a `Line` array and
are untouched — still a correct, safe sparse patch.

**Open investigation — removing a line from a QBO Deposit.** A full update on a
Deposit returns **200 OK but keeps every line omitted from the payload** (seen in
the importer and in a controlled `deposit-reduce` diagnostic that echoed QBO's own
line objects back). A first delete+recreate fix was reverted: it gives the deposit
a NEW internal Id and resets its bank reconciliation, which isn't acceptable. Still
being determined (via the read-only-plus-one-mutation `deposit-reduce` diagnostic,
now using a real `?operation=update` and reporting the response Id) is whether an
in-place line delete is possible at all, or whether the earlier tests were confounded
by omitting `?operation=update`. Don't ship another deposit-line-removal fix on the
money path until that's settled. Verify any change here
with `shapeModifyPayload` directly (pure, no I/O) rather than a live script
against `qboPost`/`qboReadOne` — tsx's module interop doesn't preserve ESM
live bindings for named function imports, so monkey-patching those from
outside the module silently no-ops and the real functions run instead.

**Every write operation (import, delete, bulk-edit) runs on ONE shared,
resumable engine — `lib/batch/lease.ts`.** It didn't used to: upload had a
lease/cursor design (chunk-runner.ts), delete ran its whole loop synchronously
in the HTTP handler with a single `db.update` at the very end, and bulk-edit
`await`ed its whole job inline before the response returned (its client-side
poll() was dead code — the job was always already "done" by the time the
first poll fired). Both of the non-upload paths meant: past a few hundred
records, or any hiccup, the platform could kill the function mid-loop with
an unknown number of QuickBooks writes already done and **zero record of
which ones**. For delete that's worse than it sounds — there's no source
file left afterward to diff against and see what's missing.

The fix generalized upload's pattern rather than inventing three fixes:
`claimChunk`/`recordItem`/`finishChunkCall`/`runChunkLoop` in `lease.ts` are
the whole primitive (atomic UPDATE-based, since neon-http has no
transactions — see the gotcha below). `chunk-runner.ts` (upload/modify),
`delete-chunk-runner.ts`, and `fieldedit-chunk-runner.ts` are thin adapters:
each just supplies "what is item N" and "how do I process one item."

**Processing is server-driven, not browser-driven.** The client used to
`while(!done)`-loop calling `/api/batch/upload/chunk` itself — so closing the
tab, a laptop sleeping, or a flaky connection outlasting the retry budget
silently stopped the import at whatever cursor it reached. `runBatchChunkLoop`
(`inngest/functions/batch.ts`) now drives every chunked job via Inngest event
self-chaining (`step.sendEvent` back to itself until `done`), independent of
any browser tab. The client still fires one best-effort "nudge" after
starting a job (matching the existing dual-trigger pattern in
`commit-runner.ts`) and then just polls `GET /api/batch/jobs/[id]` for
progress — the same poll() function now works for all four flows, not just
Xero's legacy whole-job path.

**`lib/batch/reap.ts` resumes before it gives up.** The old reaper (in both
`GET /jobs` and `GET /jobs/[id]`, duplicated) only ever flipped a stuck job to
"failed" after 5 minutes, with a vague "stopped part-way" message that never
said how many records were never even attempted — which is the exact shape
of the reported bug (a 300-row import showing 70 success / 1 failed, with the
other 229 unaccounted for anywhere). Now: a stuck CHUNKED job (leaseUntil is
the structural marker — set, already-expired, at job creation by every
chunked start route) gets nudged via the same Inngest event rather than
failed outright, and only gives up after ~20 minutes of failed nudges, with
an honest count (`"71 of 300 attempted — the remaining 229 were never
attempted"`). A `batchJobWatchdog` cron (every 2 minutes) does the same thing
independent of anyone opening Job History, so an interrupted run self-heals
without a human noticing. Legacy whole-job runners (Xero commit, scheduled
QBO imports) never set `leaseUntil` — that's what tells the reaper/watchdog
they're not chunk-resumable, so they still just age out at the original
5-minute cutoff. **This distinction matters**: a watchdog query that also
matched `leaseUntil IS NULL` would treat every *healthy, currently-running*
legacy job as "stale" on every tick and fire a second, concurrent processor
at it — a real duplicate-QBO-writes bug caught during review, not shipped.

**One narrow, pre-existing risk this doesn't close**: if the QBO write for
one item succeeds but the process is killed before `recordItem` commits that
result, a retry reprocesses the same item — a possible duplicate create, and
if it happens the id is also never logged, so Undo can't find it either. This
was already true of the original upload-only design; extracting it to a
shared engine didn't add or remove the exposure. It's rare (the window is one
DB write, not the whole chunk) but real — worth a proper idempotency-key
design if it ever shows up in practice.

**Dropdowns live in `lib/batch/dropdowns.ts`, shared by the template AND the
export.** They were originally only in the template route, which is backwards:
the export is the file people actually edit, so it's the file that most needs
valid picks. `refKindForColumn` (`lib/batch/ref-columns.ts`) maps a column name
to its QBO list; `UNION_COLUMNS` handles columns that legitimately accept more
than one kind (a deposit's "Received From" may be a customer, vendor OR
employee — offering only customers makes a real vendor refund look invalid).
CSV can't carry validations, so xlsx is the format to prefer for round trips.

`RefResolver.preload` is parallel and swallows per-list failures, so adding
kinds costs ~the slowest list, not the sum.

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
- `mobile/` — React Native (Expo) mobile app, separate `npm` project (its own
  `package.json`/`node_modules`, not part of the Next.js build). Organised by
  **department** (`mobile/src/departments.ts`, role-gated): **Operations**
  (Receiving / Production / Shipping) and **Receivables** (the rep portal —
  overview, invoice list + detail with promise/dispute/note/stage actions,
  escalations, customers). See `mobile/CLAUDE.md`. Talks
  to the same `app/api/` routes as the web app, but via a bearer-token auth
  path (`app/api/mobile/auth/*`, `lib/mobile-auth.ts`) since RN can't use the
  httpOnly session cookie — `lib/api.ts`'s `requireOrg()`/`requireAuth()`
  accept `Authorization: Bearer <token>` as a fallback, re-validated against
  the DB exactly like the cookie path. Not yet run on a device/simulator.

## Working style

- Commit messages are detailed and explain the *why* — a fresh session should be
  able to reconstruct recent work from `git log`.
- Branch off `main` for anything non-trivial; `main` auto-deploys.
- End commit messages with the Co-Authored-By trailer.
