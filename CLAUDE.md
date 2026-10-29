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

## Visual-consistency sweep — screens should match the Collections Board (started 2026-10-21)

Client feedback, verbatim in substance: "the app does not feel like a
product — everything is scattered." Rather than a full redesign, the
decision is to adjust **page by page**, matching each screen's chrome to
the app's most-polished, most-used screen: the **Collections Board**
(`app/(app)/board/page.tsx` + `components/board-list.tsx`). Treat the
Board as the reference shell for any work-surface screen (search, filter,
create — not a simple form) that doesn't already match it:

- **Full-height, fixed-header/scrollable-body shell**: `flex flex-col
  h-[calc(100vh-44px)]` (44px = the app shell's own `h-11` top bar,
  `app/(app)/layout.tsx`), header `px-6 py-4 border-b border-stone-800
  bg-stone-950 flex-shrink-0`, content `flex-1 overflow-y-auto px-6 py-4`
  — not a centered, page-scrolling `max-w-* mx-auto` settings layout.
- **Header**: `h1` is `text-xl font-semibold text-white tracking-tight`
  (NOT `font-bold`) naming the actual screen, subtitle `text-sm
  text-stone-400 mt-0.5`.
- **Toolbar controls** are compact (`h-8`, `text-xs`), built from
  `components/form-kit.tsx`'s `control`/`SelectField`, never a
  hand-rolled input class string — form-kit's own doc comment already
  names this exact problem ("the inconsistency everyone can see comes
  from the ~2/3 of components that bypass form-kit"). A binary toggle
  (like the Board's "Show future-dated (N)") is a pill: `h-8 ... rounded-md
  ring-1`, active = `ring-stone-600 bg-stone-700 text-stone-100`, inactive
  = `ring-stone-700 bg-stone-800 text-stone-400 hover:text-stone-200` —
  not a bare checkbox-and-label.
- **Drawer form fields use `controlInset` (bg-stone-950), never `control`
  (bg-stone-900)** — the Drawer panel itself is `bg-stone-900`
  (`form-kit.tsx`'s `Drawer`), so a field styled with `control` is the
  SAME colour as the panel it sits on and nearly disappears. This is a
  real, previously-shipped bug, not just a style nit — caught while fixing
  the first screen below, so check for it specifically whenever auditing
  another screen's drawer.
- **No breadcrumb back to a parent section once a screen is reached via
  the sidebar** — the sidebar already provides that nav (the Board has no
  "← Receivables" link). Keep a breadcrumb only at a screen's OWN
  standalone settings-page entry point, if it still has one separate from
  the sidebar-driven route.
- **First screen done**: Chart of Accounts / Accounting Setup
  (`app/(app)/settings/accounting/_lists.tsx`'s `AccountingLists` —
  one shared component serving Chart of Accounts, Products & Services,
  Tax Rates, Classes, Locations, Cost Centres and Custom Fields, all
  reached from the Accounting sidebar's Setup group via
  `app/(app)/accounting/[list]/page.tsx`, plus the standalone
  `/settings/accounting` entry point). Fixed exactly the five points
  above. **Not yet done**: every other screen in the app — this is a
  page-by-page sweep, not a one-shot redesign; pick the next screen when
  asked, using this section as the checklist rather than re-deriving the
  Board's pattern from scratch each time.
- **Second screen done (2026-10-22)**: Products & Services
  (`components/products-register.tsx`'s `ProductsRegister`, at
  `/accounting/products`). This one was ALREADY on the shared `ListPage`/
  `ListPageHeader` system (`components/list-view.tsx`) — that system
  already implements this exact shell (confirmed by reading it: same
  `h-[calc(100vh-44px)]`, same header classes, same `h1` size/weight) — so
  there was no shell rewrite needed, only its own page-level toolbar
  controls (the search box and type filter sitting in `ListPageHeader`'s
  children) were hand-rolled and off: they used `controlInset`
  (bg-stone-950) on a bg-stone-950 header — the SAME invisible-control bug
  as the Chart of Accounts drawer, just on a page toolbar instead of a
  drawer — and the type filter was a raw `<select>`, missing the custom
  chevron. Fixed to `control` + `SelectField`, compact `h-8`/`text-[12px]`
  sizing matching the Board's own toolbar. **Any OTHER screen already built
  on `ListPage`/`ListPageHeader`** (grep for the import) likely only needs
  this same narrow toolbar-control check, not a shell rewrite — check that
  first before assuming every screen needs Chart of Accounts' full treatment.
- **Third surface done (2026-10-22): the whole Accounting Reports section.**
  Prompted by: "The reports are not competent enough" + "All reports pages
  should follow the theme we use in the Collection Board." Unlike the first
  two screens, this wasn't one page — every report under `/accounting/
  reports/*` rendered inside a centered, page-scrolling `p-6 max-w-5xl`/
  `max-w-3xl` div (the exact anti-pattern this sweep exists to fix), because
  nearly all of them (Aging, Tax Liability, Stock Valuation/Status, Stock vs
  GL, all Purchasing/Sales reports, Lot Traceability, Subcontractor Yield,
  Delivery Risk — 14 report pages in total) share ONE component,
  `components/ui.tsx`'s `ReportShell`. Fixing `ReportShell` once — full-height
  `flex flex-col h-[calc(100vh-44px)]` shell, fixed `bg-stone-950
  border-b border-stone-800` header (back-link, icon, title, refresh button),
  `flex-1 overflow-y-auto` scrolling body — fixed all 14 at once, the same
  "one shared component, many callers" leverage the `Drawer` consolidation
  used earlier. **Four reports did NOT go through `ReportShell` and needed
  their own fix**: `components/cash-flow-report.tsx` and
  `components/fx-report.tsx` each hand-rolled an exact duplicate of
  `ReportShell`'s old header (now switched to use `ReportShell` itself,
  removing the duplication); `app/(app)/accounting/reports/general-ledger/
  page.tsx` and `app/(app)/accounting/reports/[statement]/page.tsx` (Trial
  Balance/P&L/Balance Sheet/Comprehensive Income/Changes in Equity) hand-rolled
  their own header AND their own filter controls — raw `<select>`s with no
  chevron (the same "never rely on the native OS select arrow" rule
  form-kit's own doc comment states) and a hand-built input class string
  instead of form-kit's `control`/`SelectField` — both switched to
  `ReportShell` + `control`/`SelectField`. The **Reports hub itself**
  (`app/(app)/accounting/reports/page.tsx`) was also the old centered
  pattern with a hand-rolled search input; converted to `ListPage`/
  `ListPageHeader` (the same primitives the Board, Products & Services and
  this shell all now share) with the search box on `controlCompactIcon`.
  **Not done in this pass, flagged as the actual answer to "not competent
  enough" rather than guessed at**: no report (financial statement or
  otherwise) can be exported or printed; the financial statements have no
  comparative-period column (this period vs last); General Ledger/[statement]
  date pickers have no quick-range presets besides "This financial year" on
  the period statements only. These are feature gaps, not styling, and need
  their own scoped pass once prioritised. **The comparative-period and
  quick-preset gaps were closed the same week** — see "QBO-parity reporting
  controls" below.

## QBO-parity reporting controls — Phase 1: period presets, columns, compare-to (2026-10-22)

Prompted directly against a live QBO report builder (screenshots of its
Report period / Display columns by / Compare to / Customize controls), with
an explicit brief: "We have to make much better than QBO — but minimum is
QBO... visually a bit different but all functionality has to be the same."
Confirmed scope via AskUserQuestion before building: Phase 1 =
"Period shortcuts + time-bucket columns + Compare-to", applied to all five
financial statements (`app/(app)/accounting/reports/[statement]/page.tsx`).

- **`lib/accounting/report-periods.ts`** (new, pure, no `db` import — same
  client-safe split as `account-roles.ts`/`modules.ts`) is the whole date-math
  layer: fiscal-year-aware range presets (This/Last month, This/Last quarter,
  This fiscal year to date, Last fiscal year, This/Last calendar year),
  as-of presets for point-in-time statements (Today, End of last month/
  quarter/fiscal year), "Display columns by" bucket-splitting (tile a
  `[from,to]` window into Month/Quarter/Year sub-ranges, clipped at both
  ends — a quarter starting mid-range is NOT padded out to its full quarter),
  and Compare-to period derivation (Previous period = same-length window
  immediately before with no overlap; Previous year = both ends shifted back
  exactly one year). 19 tests in `tests/report-periods.test.ts`, including
  the FY-wrap, December→January, and Q1→Q4-prior-year edge cases.
  **Month-label generation deliberately avoids `new Date(...)
  .toLocaleDateString()`** — not just as a style choice: it tripped
  `tests/architecture.test.ts`'s "nothing pins a date string to UTC midnight
  and then formats it locally" guard on the first run (the guard flags the
  literal pattern regardless of an explicit `timeZone: "UTC"` override, which
  would in fact have been safe here) — fixed by building the `"Jul 2026"`-style
  label from a plain month-abbreviation array instead, which is both
  guard-clean and locale-independent.
- **`lib/accounting/financials.ts` gained two wrapper functions**,
  `multiPeriodProfitAndLoss` and `multiAsOfBalanceSheet` — each calls the
  EXISTING, completely unchanged `profitAndLoss`/`balanceSheet` once per
  column (sub-period or compare-period) and zips the per-account lines
  together by `accountId` (falling back to name for a synthetic line like
  "Profit for the period", which carries `accountId: null`). Every existing
  caller of `profitAndLoss`/`balanceSheet` — Cash Flow, reconcile, every
  existing test — is untouched regardless of whether the new wrappers are
  ever invoked, because neither single-period function's signature or body
  changed at all.
- **`GET /api/financials`** gained two optional query params, `columns`
  (`total|month|quarter|year`) and `compareTo` (`none|previous_period|
  previous_year`), read only by the `profit-loss` and `balance-sheet`
  branches. **Left at their defaults, the response is byte-identical to
  before this change** — no `table` key is added — so `general-ledger` and
  every other branch, and any caller that doesn't yet know these params
  exist, are unaffected. `meta` also gained `fiscalYearStartMonth`, read by
  the client to compute fiscal-year presets correctly instead of the page's
  old hardcoded "Pakistan FY starts July" assumption.
- **The report page**: a "Report period" preset dropdown (range presets for
  Profit & Loss/Comprehensive Income/Changes in Equity, as-of presets for
  Trial Balance/Balance Sheet) replaces the old bare date inputs as the
  default; picking "Custom" reveals the raw From/To (or As at) fields exactly
  as before. Profit & Loss and Balance Sheet additionally get "Display
  columns by" and "Compare to" dropdowns. When more than one column results,
  the page switches from the single-column, centred "the way a CA presents
  it" statement view to a new wide, horizontally-scrollable multi-column
  table (`MultiProfitLoss`/`MultiBalanceSheet`) — drilling into a cell still
  opens the General Ledger scoped to THAT column's own date window, not the
  primary period's.
- **Scope deliberately narrower than all five statements getting the full
  engine**: Trial Balance, Comprehensive Income and Changes in Equity get the
  period-preset dropdown only, not Display-columns-by/Compare-to, for
  structural reasons rather than by omission — Trial Balance already shows
  both debit AND credit per line (doubling to per-column debit/credit pairs
  is a materially different table shape), and Changes in Equity already
  shows opening/movement/closing in one row per category (adding more
  columns on top of three already-wide columns doesn't fit the same way
  Profit & Loss/Balance Sheet's single-figure-per-line shape does).
- **Not built in this pass — the rest of the QBO screenshot brief** (Class/
  Location dimension columns were built the next day — see "Phase 1b" below):
  "Display columns by" DIMENSION breakdown for Customer/Vendor/Product/
  Employee (only Class/Location were requested and built), the full
  "Customize" side panel (filters by account/customer/vendor/product/class,
  Active/All/Non-zero row and column visibility, calculated fields, number
  format, editable section titles), export/print, and a Cash vs Accrual
  accounting-method toggle (explicitly declined by the client: "Accounting
  Method (Not Required)"). Each is its own scoped phase, same pattern as the
  sales-document refactor's Phase 1/2/3a/3b/3c staging above.

## QBO-parity reporting controls — Phase 1b: Display columns by Class/Location (2026-10-23)

Prompted the day after Phase 1, alongside a real bug report: "I AM NOT ABLE
TO EDIT CLASSES or LOCATIONS... Unrecognized key(s) in object: 'parentId'" —
plus "these things has to be appear on every forms - if a user has enabled
them... any unclassified transaction would appear as unclassified column."
Confirmed scope via AskUserQuestion: fix the Deposit gap now, dimension
columns next, Custom Fields (see below) deferred.

- **The `parentId` bug, fixed**: `_lists.tsx`'s `openEdit()` spreads the
  whole row (`{...r}`) into form state regardless of tab, so `form` always
  carries `parentId` — but Classes/Locations/Cost Centres/Custom Fields (all
  the `apDimensions`/"dimensions" entity) have no parent-picker UI at all,
  and `app/api/accounting/[entity]/[id]/route.ts`'s `"dimensions"` PATCH
  schema is `.strict()` with no `parentId` field. Every dimension edit — not
  just ones with a parent — 400'd. `apDimensions.parentId` DOES exist in the
  schema (a real column, set only by a QBO/Xero sync for a genuine
  sub-class/sub-location); there's just no UI to edit it locally, so `save()`
  now strips it from the payload for every tab except `"accounts"` (which has
  a real parent-account picker and already handled this correctly).
- **The Deposit gap, fixed**: `new-document-form.tsx`'s `showDims` (whether
  Class/Location columns render on the line table) was gated on
  `cfg.mode === "lineItems"` only — excluding Bank Deposit (`mode:
  "deposit"`) even though Deposit's "Sources" section renders through the
  EXACT SAME shared line table (confirmed by reading the JSX: one `<Section>`
  covers both modes). The backend (`lib/accounting/documents.ts`'s
  `lineCommon()`) already reads `classId`/`locationId` generically off every
  line regardless of document type, so this was a pure frontend display
  gap — fixed by widening `showDims` to `cfg.mode === "lineItems" ||
  cfg.mode === "deposit"`. Every OTHER document type already showed these
  columns correctly (gated on "the org has at least one Class/Location at
  all," matching the new reports work below); Payment/BillPayment (no line
  table, just an allocation list) and Transfer (two bare accounts, no lines)
  genuinely have nowhere to put a per-line dimension and are unaffected.
- **"Display columns by" now also offers Class and Location** on Profit &
  Loss and Balance Sheet (only when the org actually has at least one Active
  Class/Location — fetched once from `GET /api/accounting/dimensions`, same
  gate the New Document form itself uses). Picking one produces one column
  per Class/Location value **plus a synthetic "Unclassified" column** for
  every line with that dimension left blank — never silently dropped or
  folded into a value that was never chosen.
  - **`lib/accounting/financials.ts`**: `balances()` gained an optional
    `dim?: DimFilter` (`{ column: "classId"|"locationId"; value: string |
    null }`, `value: null` meaning "this line has no value for this
    dimension at all" via `isNull()`, not `eq()`) — threaded through
    `profitAndLoss`/`balanceSheet` as a new, optional trailing parameter, so
    every existing call site (both signatures were already being called
    with 2–3 positional args everywhere in this codebase) is unaffected.
    `multiDimensionProfitAndLoss`/`multiDimensionBalanceSheet` enumerate the
    org's Active dimension rows, call the single-column function once per
    value **plus once more for `value: null`** (Unclassified), and reuse the
    exact same `assemblePL`/`assembleBS` shape-builders the time-bucket
    columns (Phase 1) already use — extracted from
    `multiPeriodProfitAndLoss`/`multiAsOfBalanceSheet` into shared helpers
    for this reuse, with zero behaviour change to either.
  - **Balance Sheet's Retained Earnings / "Profit for the period" lines are
    deliberately NOT dimension-filtered** — equity movements don't carry a
    class/location in practice (confirmed: QBO's own "Balance Sheet by
    Class" has the identical gap), so splitting a single org-wide profit
    figure across every class column would misattribute it. Only the
    ordinary asset/liability/equity account balances are filtered per
    column.
  - **Compare-to and dimension columns don't combine in this pass** — the
    UI hides the "Compare to" control entirely when "Display columns by" is
    Class or Location, rather than silently ignoring a selection (the route
    would ignore it anyway: the `columns === "class" || columns ===
    "location"` branch in `app/api/financials/route.ts` is checked before
    the bucket/compare branch).
  - Multi-org consolidation lists every org's own dimension rows side by
    side with no cross-org name-matching — the same simplification every
    other multi-org figure in this file already makes.

## Class/Location on the CONTROL-account line (A/R, A/P, Bank) — not just the item lines (2026-10-23)

Raised directly: "our Forms have a double entry impact... Our Forms only
showing classes & Location at the item level... how would we do the same for
the debtor (A/R) account?" — followed by the decision: "line level is fine -
but we should be able to classify class & Locations for the AP/AR & Asset
Accounts." Confirmed by reading the posting code: every document was already
(deliberately — see the Phase 1b section above) posting its A/R/A/P/Bank
control line as ONE line with no class/location at all, matching QBO's own
behaviour (QBO's "Balance Sheet by Class" is notorious for lumping A/R, A/P,
Bank and Equity into "Not Specified" for exactly this reason). The decision
here is to go further than QBO: keep per-line Class/Location on the revenue/
expense/item lines exactly as-is, and ADD an explicit, user-chosen
Class/Location for the document's own control line.

- **`PostDocInput` gained `controlClassId?`/`controlLocationId?`** —
  deliberately NOT named `classId`/`locationId` at this level, because
  `PostDocInput.locationId` already exists and means something completely
  different (the PHYSICAL stock/warehouse location for inventory-tracked
  lines, references `stock_locations`) — reusing the name would have been a
  real, silent collision. Header-level, like `projectId`: the control line is
  ONE line, so it can only ever carry one class and one location, set
  explicitly rather than derived from the (possibly multiple, possibly
  differently-classed) revenue/expense lines above it.
- **Wired into every control-line push** in `lib/accounting/documents.ts`:
  `buildSalesPurchaseLines`'s A/R line (Invoice/CreditNote), A/P line (Bill/
  VendorCredit) and Bank line (SalesReceipt/RefundReceipt/Expense);
  `settlePayment`'s bank leg and A/R-or-A/P leg (Payment/BillPayment); both
  legs of a Transfer; and Deposit's aggregate Bank debit line. The realized
  FX gain/loss line (Payment/BillPayment, foreign currency) and the tax
  control line are deliberately left unclassified, matching how the sales
  tax line already isn't classified on sales/purchase documents.
- **A real, separate bug found and fixed in the same pass**: Deposit's
  "Sources" line table already SHOWED a Class/Location picker per line (the
  Phase 1b Deposit fix, previous section) — but `postDocument`'s Deposit
  branch never read `l.classId`/`l.locationId` when building the credit
  lines, so a value picked there was silently discarded on save and never
  reached the ledger. Fixed in the same edit as the control-line wiring.
- **UI**: one Class/Location picker pair in `new-document-form.tsx`'s
  Memo/totals row (`showHeaderDims`, gated on "org has at least one of
  either" — no document-mode restriction, since every document type posts
  SOME control-account line, including Payment/BillPayment/Transfer which
  have no line-item table at all to host a per-line picker). Labelled
  "Class/Location (A/R, A/P & Bank)" with a hint naming what it does and
  does not affect, so it reads as a different control from the per-line
  pickers above it rather than a duplicate of them.

## Products & Services item creation — audited and fixed (2026-10-22)

Prompted by: "can you have a look on the product & service — the way we are
creating items. Are you comfortable with that?" An investigation (not a
report) found one real functional gap and two UX-complexity issues, all
fixed in the same pass as the toolbar restyle above.

- **Real gap: `POST /api/inventory/items` was admin-only, but is now
  reachable from ANY transaction form's "+ Add new item…" quick-add**
  (since the quick-add-consolidation fix earlier this week routed it
  through `NewItemDrawer`, the real drawer, instead of a separate thinner
  form). A non-admin company user can fully create and post an Invoice —
  `/api/documents/*` has NO role check at all — but would 403 trying to
  add one new service line to it, with no explanation. Fixed by removing
  the `company_admin`/`super_admin` gate from item CREATE only; PATCH/
  DELETE in `[id]/route.ts` (editing or deactivating an EXISTING item's
  accounting) stay admin-gated. `prepareItemAccounting` still fully
  validates the result regardless of who created it, so this doesn't
  loosen what can actually be saved, only who can reach the form.
- **`NewItemDrawer` gained a `simple` prop**, passed only from
  `new-document-form.tsx`'s inline quick-add (`initialProductType="Service"
  elevated simple`). When set: the Item Type grid narrows to the three
  untracked kinds (Service/Non-Inventory/Other Charge) — a one-off invoice
  line is never inventory — and the Sourcing Policy toggle (which supplier
  may bill for it) is skipped entirely, since it is never relevant for a
  quick line and would be one more decision in the way of finishing it.
  The full Products & Services page's own "+ New item" button passes
  no `simple` flag and keeps every control.
- **Fixed regardless of `simple`, in BOTH `NewItemDrawer` and
  `EditItemDrawer`**: "Base UoM" and "Min required on-hand qty" now only
  render when the item's kind `tracked` (`lib/inventory/item-kinds.ts`) —
  they are physical-stock concepts with zero meaning for a Service/
  Non-Inventory/Other Charge item, in the full catalog page just as much
  as in quick-add, so this wasn't gated on `simple` at all.

## "Quick-add" inline drawers were silently a SECOND, thinner form (2026-10-21)

Reported directly: clicking "+ Add new customer…" (or "+ Add new item…")
from inside the Invoice/Bill/etc. form did not open the same drawer used to
add a customer from the Customers page — and the user was right to read that
as an integrity question, not a cosmetic one.

- **What was actually happening**: `components/quick-add.tsx`'s `QuickAdd`
  carried its OWN stripped-down copies of the customer/supplier form (name,
  email, currency only — no address, payment terms, tax number) and the
  item form (name, income account, price, tax only — no item kind, no trade
  flags, no posting group), posting to the SAME endpoints
  (`/api/parties/customers|suppliers`, `/api/accounting/items`) as the real
  forms but via a parallel, incomplete field set. The real forms already
  existed: `components/party-drawer.tsx`'s `PartyDrawer` (used from
  `components/party-list.tsx` — Customers/Suppliers/Employees) and
  `components/products-register.tsx`'s `NewItemDrawer` (used from the real
  Products & Services page, `/accounting/products`).
  - **The item side was a real, not just thinner, correctness gap**:
    `/api/accounting/items` (the legacy entity-CRUD route QuickAdd posted to)
    inserts straight into `apItems` with none of the Phase-1 account-mapping
    validation (`prepareItemAccounting` — see the "sales document refactor"
    Phase 1 section above) that `/api/inventory/items` (what `NewItemDrawer`
    posts to) enforces, and leaves the newer `productType`/`canBeSold`/
    `canBePurchased`/`sourcingPolicy` columns at their bare defaults instead
    of the kind-appropriate values the real item-creation path computes. A
    quick-added item was a quietly less-validated, less-complete row in the
    exact same table.
- **The fix is NOT a third drawer** — every caller now renders the one real
  drawer directly for Customer/Supplier and Item, and `QuickAdd` no longer
  accepts `"customer"`/`"supplier"`/`"item"` as a kind at all (its
  `QuickAddKind` union was narrowed to exactly the kinds that have no richer
  drawer elsewhere: Chart of Accounts entries, tax rates, classes,
  locations). Three call sites changed:
  - `components/new-document-form.tsx`'s party/item "+ Add new…" pickers now
    render `<PartyDrawer type="customers"|"suppliers">` / `<NewItemDrawer
    initialProductType="Service">` directly (Service, not the drawer's own
    default FinishedProduct, since an ad-hoc invoice line is almost always a
    service — still fully editable in the drawer).
  - `components/products-register.tsx`'s `SupplierSkuDrawer` (the "+ Add new
    supplier…" while linking a supplier to an item) now renders `PartyDrawer`
    the same way, instead of `QuickAdd kind="supplier"`.
  - Both `PartyDrawer` and `NewItemDrawer` gained an `elevated` prop
    (passed through to form-kit's `Drawer`) — needed only when opened from
    inside the New Document form, which is a full-page document sheet, not a
    drawer itself; without it, the new drawer would share the page's
    ordinary z-50 and DOM order would decide which element wins. `onCreated`
    on both was widened from `() => void` to `(row?: any) => void` so the
    document form can auto-select the freshly created record — their other,
    pre-existing callers (`party-list.tsx`, the Products page's own "+ New
    item" button) ignore the argument and are unaffected.
  - **Avoided a circular import deliberately**: `NewItemDrawer` itself
    renders `QuickAdd` internally for ITS OWN income/expense-account and tax
    quick-adds (kinds `QuickAdd` still handles) — so `QuickAdd` must never
    import `PartyDrawer`/`NewItemDrawer` back. The dependency only runs one
    way: `new-document-form.tsx` → `products-register.tsx` →
    `quick-add.tsx`/`party-drawer.tsx`. Verified with a standalone ESM
    `import()` smoke test (not just `tsc`, which cannot catch a genuine
    module-execution-order cycle) before shipping.
- **Not fixed by this change, and not forgotten**: `QuickAdd`'s remaining
  kinds (Chart of Accounts account, tax rate, class, location) are STILL a
  thinner inline form than their own standalone pages
  (`app/(app)/settings/accounting/_lists.tsx`'s own create drawers — Detail
  type/subtype, parent account, currency for accounts; full tax type for tax
  rates). Left alone deliberately: those are genuinely lightweight,
  low-stakes records to create mid-line-entry (you're picking a GL account
  while typing an invoice line, not managing the Chart of Accounts), unlike
  Customer and Item, which the user specifically flagged and which carry
  real downstream consequences (collections, inventory valuation). Revisit
  if the same complaint is raised about any of these four.

## List pages match the Invoices page (started 2026-10-29)

The Invoices page is the reference list. The TABLE (sort, column filters, chips,
footer totals) was already shared (`components/list-view.tsx`); what only
Invoices had was the chrome around it. That is now shared too:

- **`components/list-chrome.tsx`** — `ListSearch`, `usePeriodFilter` +
  `ListPeriodFilter`, `useRowSelection` + `ListSelectionBar`, `ListExportButton`
  and `exportRowsToExcel`. The export names its own columns, so it can carry
  fields the table does not show.
- **`lib/list-period.ts`** (pure) — the period presets. It was copy-pasted into
  six pages. It compares `YYYY-MM-DD` strings and never builds a `Date` from a
  document's own date ("A date is a date"); an undated row is always kept.
- **Done**: Invoices (refactored onto the shared pieces, same behaviour) and
  `components/trade-doc-list.tsx`, which serves Estimates, Purchase Orders and
  Sales Orders. It gained search, a status filter, a date period, row selection
  with bulk Delete, and Export Excel, and **kept every row action** (Confirm,
  Partial, Convert, Track, PDF, Print, Delete). Its period opens on **All Time**,
  not Invoices' last month: a default must never hide an open order.
- **Still to move onto the shared period module** (each carries its own
  `getPeriodRange`; `tests/list-chrome.test.ts` pins the list and fails if a file
  is migrated but its entry is left, or a new copy appears): Payables Bills,
  Payment Runs, Purchase Orders, Supplier Queries; Receivables `/reports` is a
  different shape (also returns the prior period).
- **Not yet given the chrome**: Customers, Projects, Suppliers, the Receiving /
  Shipping / Job Work consoles, Journal. Customers, Projects and Suppliers
  already have selection; none of those has Export or a date period.
- Bulk actions are per page, not generic: Invoices has stage change and send
  email; trade documents have Delete. Do not add a bulk action a page's rows do
  not already support one at a time.
- **`app/(app)/estimates/page.tsx` is a legacy list of QuickBooks-synced
  estimates** with no inbound link in code. It is not the same data as the native
  Estimates in Accounting, so it is NOT safe to delete as a duplicate until it is
  known whether any synced org relies on it.

## Accounting sidebar: one workspace for the trade cycle (2026-10-29)

Product owner's layout for the Accounting workspace (`components/sidebar.tsx`'s
`accountingSections`): **Dashboard** first, ungrouped; **Sales** — Customers,
Projects, Estimates, Sales Orders, Shipping, Invoices; **Purchases** — Suppliers,
Purchase Orders, Goods Receipts, Bills, Job Work; **Others** (was "Ledger") —
Journal, Reconcile, Approvals, Accounting Reports; **Setup** (collapsible) now
also holds Opening Balances. "Trial Balance (our ledger)" is no longer a
top-level link — it is one of the statements in Accounting Reports.

- **Module keys, gates and routes are unchanged.** This is navigation only: the
  Supply Chain workspace still exists untouched. Merging the *navigation* does not
  merge the *modules* — `manufacturing` stays the unit that is sold per org and
  gated in `lib/modules.ts`, which is what a future per-user "allowed areas"
  list would intersect with.
- **Each cross-module link shows only when its owner module is on**: Sales Orders,
  Shipping, Purchase Orders, Goods Receipts and Job Work need `manufacturing`;
  Invoices needs `receivables`; Bills needs `payables`. Otherwise the link would
  land on ModuleGate's notice. Sales/Purchase Orders were previously reachable
  only from the Supply Chain nav, so they are not newly shown to orgs without it.
- **Every Accounting link to another module's URL must be in `isSharedEntity`**,
  or clicking it snaps the whole sidebar into the owning workspace (the third
  time this bit: Customers, Stock Status, now `/invoices`, `/payables/bills`,
  `/supply-chain/shipping`, `/supply-chain/receiving`). `tests/accounting-nav.test.ts`
  enforces it and was shown failing on exactly those four before the carve-out.
- **Not verified**: Bills rows open `/payables/bills/[id]`; whether that screen
  opens a native (ledger-posted) bill cleanly was not checked in a browser. The
  Supplier transactions feed once had to link native bills to
  `/accounting/transactions/[id]` for this reason.

## One creation path per record — invoices and customers (2026-10-29)

Reported: the Invoices page's "New invoice" opened a different form from
Create → Invoice, and the same shape turned up for customers. A second form is
never just a cosmetic duplicate: it carries its own fields, its own endpoint and
its own bugs.

- **Invoice**: `/accounting/new/Invoice` → `postDocument` is the only path. The
  legacy `InvoiceModal` inserted straight into `invoices` via `POST /api/invoices`
  with no journal entry — an off-ledger receivable. Modal, `addInvoice` and the
  POST handler are deleted; `/api/invoices` is read-only. The Invoices page
  button just navigates.
- **Customer**: `components/party-drawer.tsx` → `/api/parties/customers` is the
  only form, opened from the Customers list, the customer's Edit, Accounting and
  quick-add. `CustomerModal`, `addCustomer`/`updateCustomer` and
  `POST /api/customers` are deleted (`GET`/`PATCH /api/customers/[id]` stay — the
  detail page's inline edits and Automations use them).
  - Customer-only fields (code, risk rating, status incl. **On Hold**, credit
    limit, payment method, country) live in `lib/party-customer-fields.ts`
    (pure, shared by POST and PATCH) and in the drawer's separate `x` state, so a
    supplier edit can never carry a `status` that re-activates it.
  - **Country is stored as `countryId` (the org's list — what regions and rep
    books group by) AND its name in `country` (what the detail page and printed
    documents read).** The old modal sent `countryId` to a POST schema and a PATCH
    allowlist that both ignored it, so the dropdown never saved. If the org has
    no country list the drawer falls back to free text.
  - **A customer's currency is left blank until chosen.** The server then
    defaults it to home, or — under multi-currency — leaves it to lock on the
    first transaction. Pre-filling home in the browser locked it before the
    customer had transacted. PATCH ignores a blank customer currency
    (`customers.currency` is NOT NULL).
  - **Any org user may create or edit a customer** (collectors add them);
    suppliers and employees stay admin-only, as does DELETE.
- **Project**: one form already (`ProjectModal`), but it offered start / end /
  projected-end dates that the table has no columns for and POST/PATCH discard.
  Removed. Add them back only together with columns and route support.
- `tests/single-invoice-creation-path.test.ts` and
  `tests/single-customer-creation-path.test.ts` pin all of this, each proven to
  fail on the old code. **Do not "fix" the other `InvoiceDrawer`/`CreateInvoice`**:
  shipping-console's is invoice-from-shipments (posts via `invoiceFromShipments`)
  and admin's is a Stripe billing invoice for our own customers.
- **Still open, found not fixed**: `quick-add.tsx` still has thinner Chart of
  Accounts / tax rate / class / location forms (see its own section); and
  customers created from Accounting or the New Document quick-add go through
  `PartyDrawer` without calling `data-provider`'s `refresh()`, so the Customers
  list may not show them until its next load (not verified in a browser).

## Invoice/SalesReceipt/CreditNote/RefundReceipt can now carry a Project (2026-10-21)

Reported alongside the quick-add issue above: the party picker on these
forms had no way to also pick a Project, even though `PostDocInput.projectId`
(`lib/accounting/documents.ts`) already existed, explicitly commented as
"header-level project (matches the form's single picker — never per-line)"
— the backend was built expecting a picker that `new-document-form.tsx`
never actually got.

- **Added**: a "Project" field next to the Customer field, shown only for
  `party === "Customer" && mode === "lineItems" && !trade` (Invoice,
  SalesReceipt, CreditNote, RefundReceipt) — **not** Estimate/SalesOrder,
  whose `trade_documents` table has no `project_id` column at all (a
  separate, larger gap: adding it needs a migration plus wiring into
  `lib/accounting/trade-documents.ts`'s `createTradeDoc`, neither of which
  exists). Showing the field there would have silently discarded the
  selection — worse than not having it.
- **Scoped to the selected customer**: `projects.customerId` is a required
  FK (a project cannot exist without exactly one owning customer, QBO's
  sub-customer/Job model), so the picker fetches `GET /api/projects?
  customerId=<partyId>` whenever the party changes, and is cleared whenever
  the customer changes (in `onParty` AND in the quick-add-created-customer
  path, `onQuickCreated`) — a project selected for Customer A must never
  silently ride along onto Customer B.
- **A second, real bug found and fixed while wiring this through**:
  `projectId` was already read into `journalLines.projectId` by `withTax`'s
  `lineCommon()`, but `bridgeNativeInvoice`'s `common` object — the function
  that mirrors a posted Invoice into the `invoices` table the Collections
  Board actually reads — never included it. Even with the picker wired up,
  a selected project would have posted to the ledger correctly but the
  Board would never have shown it. Fixed by adding `projectId: input.projectId
  ?? null` to that `common` object, the same way `customerId: input.partyId`
  already works there. Only `bridgeNativeInvoice` needed this — SalesReceipt/
  CreditNote/RefundReceipt don't bridge into `invoices` via this function at
  all (only `type === "Invoice"` does), so adding the field to them only
  benefits the General Ledger's own `projectId` dimension on those three,
  not the Board.
- Round-trips correctly on edit: the form's full submit payload (including
  `projectId`) is already stored verbatim as `journalEntries.sourcePayload`
  and replayed by `documentPayload()` on reopen — no changes needed there.

### Superseded the same day: Project folded into the Customer dropdown

The separate "Project" field two paragraphs above shipped, then was
immediately replaced per explicit feedback: "no need for a separate field
for the project — it could come up under the Customer dropdown (as a
tree)… less clicks would make the app liked by users." `partyId`/`projectId`
as two pieces of STATE are unchanged (still exactly what `supportsProject`
gates and what the payload sends) — only the UI collapsed back to one
`<select>`:

- **`allProjects`** (new state) replaces the old per-customer
  `GET /api/projects?customerId=...` fetch-on-select — the WHOLE org's
  project list is fetched once, alongside parties/accounts/items, in the
  same startup `Promise.all` (only when `supportsProject`, so Vendor-side
  forms never fetch it). `projectsByCustomer` (a `useMemo` grouping by
  `customerId`) drives the tree without a round trip per customer clicked.
- **One dropdown, two option shapes.** Each customer renders as its normal
  `<option value={customerId}>`, immediately followed by its own projects as
  indented child options `<option value="project:<id>">    ↳ CODE · Name`.
  A native `<select>` can't nest interactive options under a non-selectable
  group the way a real tree view could — `<optgroup>` labels aren't
  selectable — so the indentation + `↳` glyph on an ordinary, still-flat
  option list is what "as a tree" means here, matching how
  `_lists.tsx`'s nested Chart-of-Accounts TABLE rows already signal depth
  with a `└` prefix instead of real nesting, for the same reason (no real
  nesting primitive to reach for).
- **`onPartyOrProject(raw)`** is the dropdown's one `onChange` handler: a
  `project:<id>` value resolves the project, then calls `onParty(customerId,
  projectId)` — a new SECOND, optional parameter on `onParty` itself, so
  picking a project sets both pieces of state in the one state update that
  already runs for a customer pick, rather than two sequential calls whose
  ordering would have to be reasoned about. Picking a bare customer option
  still calls `onParty(customerId)` with no second argument, which keeps the
  existing "switching customer clears any previously-picked project" rule
  (now the one-argument default inside `onParty`, not a separate effect).
  The dropdown's own `value` is derived (`projectId ? `project:${projectId}`
  : partyId`), so reopening a document that has a project selected shows the
  right indented option selected with no extra wiring.
- **Did not change**: `cfg.party === "Customer" && !cfg.trade && cfg.mode
  === "lineItems"` still gates which document types get this at all —
  Estimate/SalesOrder still don't, for the same `trade_documents`-has-no-
  `project_id`-column reason as before.

## Calculator-in-a-field for Qty/Rate/Amount (2026-10-21)

Reported: "I don't see the purpose of having arrows in the value box" (the
native number-input spin buttons on the New Document form's Rate field) —
"we can have a calculator in these fields, similar to what QBO have."

- **`lib/calc.ts`'s `evalArithmetic(input)`** — a hand-written recursive-
  descent parser (tokenize → parse `+ - * /` with precedence, parentheses,
  unary minus, decimals), deliberately NOT `eval`/`new Function`. It can
  only ever produce a number from a fixed grammar; there is no path from a
  string like `"); fetch(...)"` or `"process.exit(1)"` to anything executing
  — pinned in `tests/calc.test.ts`, including that exact kind of input.
  Returns `null` (never throws) for anything that isn't valid arithmetic,
  including division by zero — the caller's job on `null` is to revert, not
  to crash the field.
- **`components/form-kit.tsx`'s `CalcInput`** — the drop-in replacement for
  `<input type="number">`. Renders `type="text"` / `inputMode="decimal"`,
  which is WHY the spin buttons disappear — they're purely a `type="number"`
  artifact, and a native number input can't even accept `+`/`*` characters
  in the first place, so the calculator feature requires leaving that type
  behind, not just hiding the arrows with CSS. A plain number still commits
  live on every keystroke (`onChange` fires immediately, byte-identical to
  the old behaviour); an expression (anything with an operator or
  parentheses) only evaluates on blur or Enter, so typing `100+5` doesn't
  get fought mid-keystroke — exactly QBO's own timing. The evaluated result
  is rounded to 6dp before being turned back into a string, to avoid handing
  a field `0.30000000000000004` from `0.1+0.2`.
- **Wired into every Qty/Rate/Amount field on `components/new-document-
  form.tsx`** (line-item Qty/Rate/Amount, the account-mode line Amount,
  header Amount/Exchange rate/Amount received, and the payment/credit
  allocation cells) — all eight `type="number"` inputs on that form, so the
  feature (and the arrow removal) is uniform across the whole screen rather
  than present on some fields and not others.
- **Not yet done**: every OTHER numeric field in the app still uses a plain
  `type="number"` input (Receiving/Shipping/BOM/MO/Products drawers, etc.) —
  this pass scoped to the screen the report was about. `CalcInput` is a
  general-purpose form-kit export now, so extending it elsewhere is a
  mechanical swap (`<input type="number" .../>` → `<CalcInput value={...}
  onChange={...} className={...} />`, dropping the now-inert `step`/`min`/
  `max` attributes), not a new feature to design.

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

**No sidebar or Create-menu group may be named "Other", "More" or "Misc"** (one deliberate exception: the Accounting sidebar's "Others" group, set at the product owner's explicit request on 2026-10-29 — see "Accounting sidebar: one workspace for the trade cycle").
If something doesn't obviously belong in a named group, that's a signal a
named group is missing from the design — say so and ask, don't invent a bin
to dump it in. (The Create menu's old "Other" group — Journal entry, Bank
deposit, Transfer, Bill of Materials, Manufacturing order, Production build,
Reconcile account, Add product/service, Add account, all mixed together — is
exactly the anti-pattern this rule exists to prevent.)

- **Supply Chain** (renamed from "Production" — same orange accent, same
  `manufacturing` module gate; UI-layer rename only, internal identifiers
  (`production_runs`, `/api/inventory/production`, the `BUILD-` numbering
  series) are untouched) — four sections:
  - **Purchasing**: Purchase Orders (`/accounting/trade/purchase-orders` — shared
    with Accounting, not moved), Goods Receipts (`/supply-chain/receiving`),
    Purchasing Reports (links to the shared `/accounting/reports` hub — there's
    no dedicated single page per report group, only per-report pages inside it).
  - **Manufacturing**: Production Schedule and Production Orders BOTH point at
    `/supply-chain` on purpose, not a bug — `components/mo-console.tsx` already
    IS the combined schedule/orders board, there's no separate screen for one
    without the other. Bill of Materials (`/supply-chain/bom`). "Build" — an
    ad-hoc production run against a BOM with no scheduling or allocation — was
    a separate, second entry here until it was removed (2026-09-27, see the
    "Build was removed" section below); a Manufacturing Order is now the only
    way to produce stock.
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
  genuine setup/reference lists — split into **Ledger** (Journal, Opening
  Balances, Trial Balance — always-expanded, core nav, not reference data)
  and **Setup** (Chart of Accounts, Tax Rates, Classes, Locations, Cost
  Centres, Custom Fields, Employees, Products & Services — kept as the
  collapsible flyout "Master Data" used to be). **Chart of Accounts moved
  from Ledger into Setup on 2026-10-21 at the client's request** — it was
  originally called out as the one Ledger item that is "core nav, not
  reference data"; that's no longer the product decision, so don't move it
  back on the strength of this file's own earlier wording. Sales/Purchases
  sections now hold only
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
  without that context. Payables' own PO is also the one purchase document
  type exempt from the sourcing policy check below — see that section for why.
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
- **The core four are gated too (2026-09-26).** Until then only manufacturing
  and resources were honoured: Receivables/Payables/Accounting/Studio were drawn
  unconditionally and no route checked them, so unticking one in the admin
  portal did nothing (reported on Foodready.ai: Accounting + Studio showing with
  only Receivables + Payables ticked). Now **`PAGE_OWNERS` / `API_OWNERS` in
  `lib/modules.ts` are the single answer to "which module owns this URL?"**,
  read by three places that therefore cannot disagree: the sidebar switcher
  (and its fallback when `lastDept` names a module the org lacks), the page
  guard `components/module-gate.tsx` (wraps every page in the app shell), and
  **`requireOrg()`**, which refuses an owned API route with a 403 — one choke
  point instead of a `requireModule` call per route. It learns the path from the
  `x-app-path` header that `middleware.ts` SETS on every authenticated request
  (overwriting any client value, so it can't be spoofed to dodge the check).
  - **Gate only what one module owns outright.** Much of the app is borrowed
    across modules — Customers/Suppliers/Projects, `/accounting/products`, tax
    rates, currencies, PO/SO screens, the reports hub, the document page
    `/accounting/transactions/[id]` (+ `/api/ledger/journal/[id]`), document
    posting, `/api/batch/jobs` (Receivables' bulk invoice send runs on it), and
    everything the app-wide data provider loads. Those are `owner: null`
    carve-outs, listed ABOVE the prefix they carve from (first match wins).
    Gating `/accounting/*` by prefix would break Supply Chain.
  - The Create menu hides itself when its module (Accounting, or Supply Chain on
    `/supply-chain`) is off. `reporting_enabled` is untouched.
  - `tests/module-gating.test.ts` pins the carve-outs, their ordering, that every
    rule names a path that exists (a typo gates nothing), and that the header is
    both stamped and read — each proven to fail on the real defect.
  - Production at the time: ACC, EDC and EDC London had Accounting unticked
    deliberately (`billing_audit_logs`, `organisation_modules_updated`) and zero
    native journal entries, so enforcing it removed nothing in use.
  - **The registry is now complete, not partial (2026-09-28).** `/api/production`
    (the real Manufacturing Order backend), `/api/inventory` (bar the shared
    `items`/`items/[id]`/`skus`/`supplier-skus` master data) and `/api/resources`
    were entirely missing from `API_OWNERS` — every one of their routes already
    called `requireModule()` itself, so nothing broke at runtime, but a
    bookmarked/typed URL to them (or to `/supply-chain`/`/resources`, missing
    from `PAGE_OWNERS` for the same reason) rendered with no gate at all. All
    are registered now, changing no runtime behaviour, only closing the gap.
  - **`tests/module-gating.test.ts`'s reverse-completeness check is what closes
    this class of gap for good.** The tests above only ever checked ONE
    direction — that a registered rule names a real path. They never checked
    the reverse: that every real route under `app/api/**/route.ts` and
    `app/(app)/**/page.tsx` is accounted for. It now globs both trees and
    requires each real route to be either matched by a `PAGE_OWNERS`/
    `API_OWNERS` rule (owned or explicit `owner: null`) or named in the test's
    own `UNOWNED_API`/`UNOWNED_PAGES` allowlist, each entry a `{ path, why }`
    pair — no bare strings, every entry must justify itself. Also asserted:
    every OWNED api route calls `requireOrg`/`requireModule`/`requireReadScope`/
    `verifyOAuthState` somewhere in its source (so a future registered-but-
    unenforced route is caught too), no allowlist entry is stale (matches no
    real route), and no allowlist entry is an ancestor of an owned rule's path
    (a broad entry like `/api/mobile` must never be able to shadow a more
    specific path registered as owned later). All were proven against the
    pre-fix registry first — the reverse check correctly reported every one of
    `/api/production/*`, `/api/inventory/*` (bar the four master-data routes),
    `/api/resources/*`, `/supply-chain/*` and `/resources/*` as unaccounted for
    before the registry entries above were added.
  - **`/api/mobile` is in the allowlist, deliberately deferred, not gated.**
    The mobile client has no module-awareness yet — gating it now would break
    the mobile Receivables screen for any org with that module disabled, since
    the client never checks `enabledModules` before calling these routes. A
    companion mobile-client fix is required before `/api/mobile/**` can be
    safely added to `API_OWNERS`; don't gate it without that fix landing first.
  - `findRule(rules, pathname)` (`lib/modules.ts`) is the shared path-matcher
    both `moduleForPage`/`moduleForApi` and the reverse-completeness test use —
    written once so the test's notion of "matches a rule" can never drift from
    the real runtime lookup.
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

### Hardening pass after a real incident — ACC stuck for a month (2026-10-14)

ACC paid its first invoice Sep 10, 2026; no recurring subscription was ever
created, and nobody noticed until Oct 8 — because every failure in this path
was swallowed with `console.error` only, so `stripeWebhookEvents.status`
still showed "processed" and `webhook-health` reported a clean delivery. Root
cause was simpler than a code bug: ACC never ticked "save my payment info" on
Stripe's Hosted Invoice Page, so no reusable payment method was ever attached
to the customer — by default (accounts created after 2026-05-30), Stripe
does **not** save a one-time invoice payment method unless the customer
explicitly opts in, or the account sets `hosted_payment_method_save` to
"always" (Settings → Billing → Invoices → turn off "Ask customers before
saving"). **That account setting is the actual fix for future customers —
code cannot force it per-invoice.**

What changed, so the next occurrence (for ACC or anyone) is visible and
recoverable instead of silent:

- **Every subscription-sync catch block now writes to `billing_audit_logs`,
  not just `console.error`** — both the `subscription_first_invoice` path
  (`subscription_activation_failed`) and the generic
  `customer.subscription.created`/`.updated` sync (`subscription_sync_failed`,
  added 2026-10-14 — it had the identical silent-failure shape and nobody had
  hit it yet by luck, not by design).
- **A Subscription Schedule (`sub_sched_...`) is a different Stripe object
  from a Subscription (`sub_...`), and this bit us directly**: scheduling a
  future-dated subscription from Stripe Dashboard (ACC, started 2026-11-09,
  to avoid double-billing the already-paid Sep10→Nov8 period) gives you the
  schedule's id, not the subscription's — the real Subscription doesn't exist
  (`schedule.subscription` is `null`) until the schedule actually activates.
  The admin **"Link Stripe subscription"** tool
  (`/api/admin/billing/org/:orgId/link-subscription`,
  `/admin/customers/[orgId]`) now accepts either id: given a schedule id, it
  resolves to the real subscription if started, or returns a clear "hasn't
  started yet, come back after DATE" error instead of a generic 404.
  `subscription_schedule.created` is also now logged to the audit trail on
  arrival, so a schedule created directly in Stripe doesn't need a one-off
  script to leave a record of it.
- **The generic `customer.subscription.created`/`.updated` webhook handler is
  what's actually relied on to self-heal a Dashboard-created subscription or
  schedule activation** — it already matched any subscription to an org by
  `stripeCustomerId` (not just ones from our own `create-invoice` flow), so in
  most cases no manual "Link" step should even be needed once the real
  subscription exists; it's a safety net, not the primary path.
- **A client cannot see or submit a self-serve cancellation request anymore**
  (Settings → Billing) — product decision, separate from the above but part
  of the same hardening pass. Ending a subscription is now exclusively an
  admin-portal action (`/admin/customers/[orgId]`'s "Cancel & revoke").
  `/api/billing/cancel-request` still exists and is still role-gated, just
  unreachable from any UI now.
- **Full Access (`company_user`) can view billing, pay, manage the payment
  method, and view invoices** — it could not before, which was inconsistent
  with that role's own stated description ("can do everything except create
  or delete users"). Cancelling stays `company_admin`/`super_admin` only.
- **The client-facing invoice list hid voided invoices and fixed a real
  display bug**: it was showing `amount_paid` as "the amount" — which is
  correctly `$0.00` on an invoice nobody has paid yet, so every new Open
  invoice displayed as $0.00. Now shows `total` (the actual invoice amount,
  correct regardless of status) plus, once paid, the real payment amount and
  date separately.

## "Last Email Ref" showed a ref that was never actually emailed (2026-10-21)

Reported by the client: the board's "Last Email Ref" column showed
`AR-261006-BMY5` for an invoice, but that string appears nowhere in their
inbox — the real email (confirmed via the invoice's Activity log) carried
`AR-261006-GOMK` in its subject instead.

Root cause: `components/send-invoices-modal.tsx` (the "Send invoices" bulk
composer) built its default subject as `` `Open Invoices — Ref ${baseRef}` ``
where `baseRef = genEmailRef()` ran **in the browser**. That literal ref was
sent to the server as plain subject text. The server
(`lib/bulk-send.ts`'s `sendGroupEmail`) then generated its **own**, unrelated
`ref = genEmailRef()` per recipient group and stored *that* as the
communication's `refNumber` — the field the board's "Last Email Ref" column
reads (`app/(app)/board/page.tsx`'s `lastSentByInv`). Since
`fillTemplate` (`lib/email-template.ts`) only substitutes a literal `{ref}`
token — and the client had already expanded it to plain text, not a token —
the subject that actually went out kept the browser's ref, while the
dashboard recorded a ref that was never printed anywhere a customer could see
it. For a multi-customer bulk send this was worse: every recipient's subject
carried the *same* client-generated ref, while each got a *different*
`refNumber` recorded against their own invoices.
- **Fix**: the modal's default subject now reads
  `` `Open Invoices — Ref {ref}` `` — a live placeholder, resolved
  server-side by the same `fillTemplate` call that already fills it in before
  sending, using the exact `ref` value that gets stored as `refNumber`. No
  ref is ever generated client-side any more. `tests/email-ref-template.test.ts`
  pins this (asserts the component source never reintroduces
  `genEmailRef()`/a baked `${baseRef}`, and that `fillTemplate` resolves the
  placeholder the same way the server does when sending).
- **Not affected**: `lib/bulk-send.ts`/`inngest/functions/chase.ts` (ref
  generated once, used identically in both the subject and `refNumber`) and
  `components/feature.tsx`'s free-text composer (same single-generation
  pattern) were already self-consistent — this bug was isolated to the one
  path that pre-baked a ref into a default subject string before handing it
  to the server.

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

- **A native `<select>`'s OPTION POPUP is NOT controlled by the CSS
  `color-scheme` property the way it's commonly assumed to be — it is NOT
  controlled by Tailwind classes either.** Added `color-scheme: dark`/`light`
  to `app/globals.css` first (2026-10-23) on the assumption that would fix a
  reported white dropdown on the dark theme ("Count in" pack-unit picker on
  Receiving); it didn't — the report came back "drop still not fixed" with
  the fix already live. **The real rule, confirmed against Firefox's own bug
  tracker and matching Chrome/Windows in practice: the popup's light/dark
  rendering is inferred from the SELECT ELEMENT'S OWN `background-color`,
  not from `color-scheme`.** `form-kit.tsx`'s `QtyUnitField` had its unit
  `<select>` set to `bg-transparent` (it sits on a shell that draws the real
  background), so the element had nothing dark to report and the browser
  fell back to its light default, even though `color-scheme` was correctly
  set and the control visually looked dark. Fixed by giving the select an
  explicit, opaque `bg-stone-950` — visually identical, since the shell
  behind it was already that colour, but now the SELECT ITSELF truthfully
  reports it. **Check every native `<select>` this way, not with
  `color-scheme`, if one ever renders its popup off-theme again** — the
  `color-scheme` property is still correct to keep (it governs scrollbars,
  date pickers, and is the right signal to set regardless), it just isn't
  the lever for this specific symptom.
- **neon-http has NO transactions.** `db.transaction()` throws. Use
  pre-validation + a single multi-row statement, or compensating deletes with
  loud error logs. Never assume atomicity across statements.
- **Hand-written migrations** in `db/migrations/` need `--> statement-breakpoint`
  between statements, and the `meta/_journal.json` entry's `when` must be
  GREATER than the previous (drizzle skips entries with an older/equal `when` —
  this silently dropped a table in prod once). Latest is `0116` at `when`
  `1792400000000`; keep incrementing. (Keep this line current — it sat at
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
- **A bill in the GL with no Payables row** (posted before `bridgeNativeBill`
  existed) is invisible to Payables and aged payables. `ap_posted_unbridged` in
  the reconcile flags it; `scripts/rebridge-bills.ts` (dry run by default)
  mirrors it from the entry's own `sourcePayload`. Run for AM MERCHADISING on
  2026-09-25 (BILL-0001..0003, 23,000) — every reconcile check now passes
  there. BILL-0004 (the PO→Bill double count, GAP_REPORT §C) is still in its
  books by design: historic errors are reported, not rewritten.
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

## Accounting data points — credit reasons, journal purpose, bill receipt, last edit (2026-10-28)

Audit of the native ledger found it already records payment method, terms,
due dates, reconciliation, dimensions and FX. Four gaps closed (migration
`0116`, `journal_entries`, additive only; rules in
`lib/accounting/entry-reasons.ts`, 13 tests):

- **`reason_code`** — fixed codes, never free text. `CREDIT_REASONS` for
  CreditNote / RefundReceipt / VendorCredit; `JOURNAL_REASONS` (accrual,
  prepayment, depreciation, reclass, correction, …) for Manual journals. The
  list is chosen by the document type, never by the caller.
  - **Required only where a PERSON creates the document**: `POST
    /api/documents/[type]` passes `requireReason: true` to `postDocument`, and
    `POST /api/ledger/journal` requires a purpose. System callers that reach
    `postDocument` directly — recurring templates, receipt/shipment matching —
    are NOT forced, or a recurring credit-note template made before 0116 would
    start failing. Edits never force it (a pre-0116 credit must stay
    correctable); a given code is still validated.
- **`received_date`** on Bill / Expense / VendorCredit — when the supplier's
  document arrived. Not before the document's date, not in the future (the
  server allows UTC-today + 1 so a user west of Greenwich is never refused).
  Gives bill capture lag.
- **`updated_at` / `updated_by`** — stamped by `updateDocument` on every
  in-place edit. `audit_events` already logged edits; this makes "edited after
  posting" queryable on the entry itself.
- Report: **Credits & Adjustments** (`/accounting/reports/credits-adjustments`,
  `/api/accounting/adjustments`): credits by reason (and as % of sales),
  supplier credits by reason, journals by purpose, bill capture lag, edits
  after posting. Excludes mirrored QBO/Xero entries (`external_id` set).
  "Not recorded" shows in amber.

## Production data points — planned vs actual, delay, downtime, scrap reasons (2026-10-28)

Same audit as the delivery work below, for Manufacturing Orders and job work.
Migration `0115`, additive only. `lib/inventory/production-performance.ts`
(pure, 19 tests) is the rule set; `/accounting/reports/production-performance`
(`/api/production/performance`) is the report.

- **Planned vs actual**: MO = `scheduledDate → dueDate` vs `startedAt →
  completedAt` (both already existed); job work = `dispatchDate →
  expectedReturnDate` vs close date. `classifyOrderTiming` scores an order
  only when finished or open past due — same rule as OTIF lines.
- **The first due date is kept** (`manufacturing_orders.original_due_date` /
  `reschedule_count`, `job_work_orders.original_expected_return_date` /
  `return_revisions`), via `applyReschedule`, which wraps the PO line's
  `applyPromise`. An order that had a due date before 0115 treats it as the
  original, so its first move still counts. Setting a first date is not a move.
- **Reasons are fixed codes, never free text** — `DELAY_REASONS`,
  `DOWNTIME_REASONS` (each flagged planned/unplanned), `SCRAP_REASONS`; a note
  carries detail. Unrecorded reasons show as "Not recorded" in amber in the
  Pareto, so the gap is visible rather than hidden.
- **Required where it matters**: a completion run with a rejected quantity is
  refused without `rejectReason` (`completeMoRun` only — NOT preview, which
  runs while the user is still typing); closing a job work order with lost
  material is refused without `wastageReason`. Delay reasons are optional
  (set from the MO drawer's Schedule panel / job work "Dates…" drawer).
- **Actual hours per operation** are now stored on each run
  (`production_runs.operation_hours`, `[{operationId, name, hours}]`). Before,
  only labour/overhead COST was kept, which can't be read back as time once
  rates differ. Planned hours for a run = the operation's planned hours × the
  run's share of the order; efficiency = planned ÷ actual.
- **Downtime** is its own table (`production_downtime`): work centre and/or
  MO, start/end instants (end null = still down), reason. Logged from the
  report's Downtime tab ("Log downtime"); API `/api/production/downtime`.
  Records time only — nothing posts.
- Runs posted before 0115 have no hours or reject reason; they count toward
  yield but show as "Not recorded".

## Delivery data points — confirmation, promised dates, OTIF (2026-10-28)

Asked for directly: "real data points are missing... Statuses missing... if
someone created the PO - someone has to confirm the status and put the
expected time of delivery... I want to ensure that we have right data points in
place so we can produce world class reporting." Migration `0114`, all
additive (nullable or defaulted — no existing row changes meaning).

- **Three dates per PO/SO line, kept apart on purpose** (`trade_document_lines`):
  `requested_date` (what we / the customer asked for), `promised_date` (what the
  counterparty committed to — may move), `original_promised_date` (the FIRST
  promise, never overwritten) + `promise_revisions` (how many times it moved).
  **"On time" against the current promise alone is gameable** — a supplier who
  re-dates every order the day before it is due would score 100% — so Delivery
  Performance shows "vs first promise" beside "on time". `applyPromise` owns
  that rule (re-saving the same date is not a revision; clearing keeps history).
- **Lead time: supplier SKU link first, supplier register default second**
  (`resolveLeadTimeDays`) — SAP's order (info-record planned delivery time
  before the vendor default). `item_supplier_skus.lead_time_days` already
  existed; `parties.lead_time_days` is new, edited in `PartyDrawer` (suppliers
  only). **It is on `parties`, NOT the `ap_suppliers` view** — the view was not
  recreated, so read/write it on `parties` directly, as the parties routes do.
- **`requested_date` is stamped at PO/SO creation** (`createTradeDoc` →
  `requestedDatesFor`): an explicit header delivery date wins; otherwise a PO
  line gets order date + resolved lead time; nothing is invented when neither
  exists. Estimates get none — a quote commits to no delivery.
- **Confirmation** (`trade_documents.party_ref/sent_at/confirmed_at/confirmed_by/
  promised_date`): `party_ref` is the supplier's confirmation no. on a PO and
  the customer's own PO no. on an SO. Recorded via `confirmTradeDoc` / `PATCH
  /api/trade-documents/[kind]/[id]/confirm` from a Confirm drawer on the PO/SO
  lists, which also gained a status column (Unconfirmed / Sent / Confirmed).
  Any company user may record it — it moves no quantity or money, same as
  receiving. Validated in full before any write (no transactions).
- **The watchdog now measures PO lateness against the promise**
  (`coalesce(promised_date, expiry_date)` in `supplyChainWatchdog`) — a
  re-promised PO is not "late" until the new date passes; the slip is still
  visible in Delivery Performance.
- **Receipt / shipment paperwork**: `goods_receipts.delivery_note_no` (the
  supplier's delivery note / ASN — captured on the staged-receipt banner),
  `sales_shipments.carrier/tracking_no` (both ship forms) and
  `delivered_date` (proof of delivery — inline date cell on the shipments list,
  `PATCH /api/inventory/shipping/[id]`, refused before the ship date).
- **Report**: `/accounting/reports/delivery-performance` (`?side=customer` for
  customers) — OTIF, on time, vs first promise, in full, avg days late, actual
  lead time, overdue, re-promised and unconfirmed-order counts per party, plus
  an exceptions-first line list. API `GET /api/inventory/delivery-performance`;
  pure rules in `lib/inventory/delivery-performance.ts`
  (`tests/delivery-performance.test.ts`). A line scores only once complete
  (fully delivered, or closed short — closed short is never "in full") or once
  overdue. Lines without a stocked item are excluded.
- **Also fixed in the same pass**: `receiving-console.tsx` (the 2026-10-27/28
  iOS-style drawer commits already on main) violated two
  `tests/architecture.test.ts` guards — off-scale text sizes (14px/16px) and
  radii above the 8px ceiling (rounded-xl/2xl). CI on main was red; mapped to
  13px/15px and rounded-lg.
- **Not done, deliberately**: no line-level date entry on the New Document form
  itself (the Confirm drawer is the one place promises are set — a second entry
  point would need the same revision rule); no supplier e-mail/portal for the
  supplier to confirm themselves; "sent" is not stamped automatically when a PO
  is e-mailed (the Email/Send modal could call the confirm route with
  `markSent: true` — small follow-up).

## Deleting a receipt-matched Bill never un-billed the GRN — permanently stuck (2026-10-26)

Reported directly: "I am not able to delete the receipt of the item... 'this
receipt has been billed - reverse the bill first' However, I have already
deleted the bill." The stale wording ("reverse") was the smaller problem —
the real one is that `deleteDocument` never reverted `goods_receipts
.billedAmount`/`goods_receipt_lines.billedQty` for a Bill created via
`billFromReceipts`/`editBillFromReceipts`, so deleting the ONLY bill against a
receipt left it reading "billed" forever, with `voidGoodsReceipt`'s own guard
(`billedAmount > 0.005`) now permanently un-passable since the bill that
would need deleting is already gone.

- **Root cause**: `deleteDocument` deletes every `transactionLinks` row tied
  to the entry (line ~1348, `or(contextEntryId=entryId, fromId=entryId,
  toId=entryId)`) WITHOUT first reading the `receipt_bill`/`po_bill` links to
  revert what they represent — unlike `editBillFromReceipts` (built the day
  before), which carefully reverts-then-reapplies per line. Full deletion
  was the one path that never got this treatment at all; this bug predates
  yesterday's matching-table work (it's existed since `billFromReceipts`
  itself) but was only now hit in practice.
- **Fixed in `deleteDocument`**: for a Bill entry, BEFORE the links are
  deleted, every `receipt_bill` link is read and reverted — `goods_receipt
  _lines.billedQty` (and `trade_document_lines.billedQty` if PO-linked) by
  the link's own `qty`, `goods_receipts.billedAmount` by its `amount` —
  using `greatest(0, … - delta)` so a concurrent edit can never drive a
  counter negative. `po_bill` links are reverted too (same function, same
  bug applies to a Bill staged from a Purchase Order's lines): since that
  link carries only one aggregate total per PO (no per-line breakdown), the
  per-line amounts are re-read from the Bill's own `sourcePayload.lines`
  (`poLineId`+`amount`) — the exact source `closePoLinesOnBill` read when it
  first advanced them, so this is reverting from the same record, not
  reconstructing a guess — and each affected PO's status is recomputed
  (`Closed`/`Partial`/`Open`) from the refreshed totals.
- **Every other stale "reverse the ___ first" message yesterday's Reverse-
  removal sweep missed** — it only touched `lib/accounting/documents.ts`;
  `lib/inventory/void.ts` (voidGoodsReceipt/voidShipment/voidProductionRun/
  voidJobWorkOrder/voidStockAdjustment) and `lib/inventory/valuation.ts`'s
  `reverseInventoryByEntry` — the function whose own thrown message is what
  actually surfaces through `err(e?.message || fallback)` in every caller,
  making the void.ts fallback text dead code in practice — had eight more,
  all reworded to "delete"/"undo" to match reality.
- **A SYMMETRIC gap confirmed, NOT fixed in this pass**: `invoiceFromShipments`
  (the sales-side mirror of `billFromReceipts`) has the identical shape —
  one `shipment_invoice` link per shipment with `amount` hardcoded to `0`
  and no `fromLineId`/`qty` at all — so deleting an Invoice created from a
  Shipment will leave `sales_shipments.invoicedAmount`/`shipment_lines
  .invoicedQty` stuck exactly the same way, with `voidShipment`'s own guard
  then permanently un-passable. Fixing it properly needs the same per-line
  `transactionLinks` rework `billFromReceipts` got yesterday (fromLineId +
  qty), which wasn't done for shipments. Flagged here rather than guessed
  at with an incomplete partial fix — the next person to hit "this shipment
  has been invoiced" after deleting the invoice should start here, not
  rediscover this from scratch.
- **`scripts/_fix_orphaned_grn_billed_amounts.ts`** (dry-run by default,
  `--commit` to apply) finds every `goods_receipts` row with `billedAmount >
  0` and NO surviving `receipt_bill` link, and clears its billed counters —
  a one-time repair for any receipt already stuck by this bug before the
  fix shipped. Confirmed it correctly leaves a receipt alone when its link
  is still live (found one genuinely still-billed receipt plus one
  genuinely orphaned one on a test run) — not run against production, since
  the specific stuck receipt reported here lives in whichever database the
  reporter's own session points at, not the `vercel-dev` branch this
  session has credentials for.
- tsc clean, 694/694 tests pass.

## A Bill-from-receipt gets a real matching table, and can be edited in place (2026-10-25)

Direct feedback on a "View bill" screenshot of a Bill created via `billFromReceipts`
(see "'Add to Bill' reworked" above): "I am not comfortable with the Bill
created against GRNs... On the Bill user would only see - Items in the Memo -
which is weird... The interesting part is Entry behind this form is correct.
But the way this form has been visualized is not acceptable... At the end of
the day user would be interested to see What was the PO QTY, What was
received & What was billed... this is a very classic case in the accounting
world." Scoped carefully before building (three rounds of confirmation) given
the GRN/Bill period-independence question this raised.

- **Root cause, confirmed by reading the code, not guessed**: `billFromReceipts`
  has always posted each receipt line as a plain Account line (`itemId: null`,
  `accountId` = the item's GRNI/GR-IR clearing role) — correct for the ledger,
  but on reopening, the Accounts-tab account picker (`lineAccounts` in
  `new-document-form.tsx`) only lists Expense-classified accounts for a
  purchase document, so GR/IR (a liability) was never in the list and the
  select rendered blank. The Accounts table also has no Qty/Rate columns at
  all. The only place a decent matching table DID exist —
  `new-document-form.tsx`'s "Goods receipts on this bill" block — was pure
  client state shown only while staging, before Save; it was discarded the
  moment the document was saved and reopened. A second, smaller gap bundled
  into the same fix: `billFromReceipts` hardcoded the `receipt_bill` link's
  `amount` to `0`, so the Related Transactions panel always showed 0.00.
- **The GRN/Bill period-safety question, resolved by the architecture itself,
  not by adding new checks**: a Goods Receipt and the Bill billing it are
  TWO SEPARATE journal entries, each dated and period-locked independently —
  that is the entire reason a GR/IR clearing account exists (to bridge
  receipt and invoice landing in different periods without either restating
  the other). Editing a Bill's qty/price only ever touches the Bill's OWN
  entry (gated on the Bill's own `bookCloseDate` check, exactly like every
  other edit) and the receipt line's running "billed so far" counters, which
  are bookkeeping metadata, not a dated posting — so a closed GRN period has
  no bearing on editing a later Bill against it.
- **`transaction_links` gained a `qty` column** (migration `0113`, nullable,
  used only by `receipt_bill`) — `journal_lines` has no quantity column at
  all (the GL is pure debit/credit), so this is the one place a Bill-from-
  receipt's per-line billed qty survives for display and for editing.
  `billFromReceipts` now creates ONE link PER RECEIPT LINE (not per receipt),
  each carrying `fromLineId` (the `goods_receipt_lines.id`), `toLineId` (the
  exact `journal_lines.id` that line produced — recovered via `postedGrniRows`,
  which relies on the proven invariant that `buildSalesPurchaseLines`' Bill
  branch preserves `input.lines` order for every debit line and appends tax/
  control lines strictly afterward), `qty`, and the REAL `amount` (fixing the
  0.00 bug as a side effect). `lib/accounting/links.ts`'s `linksFor()` now
  collapses rows sharing `(direction, other document, relation)` into one,
  summing amounts — every other relation only ever produced one row per pair
  anyway, so this is a no-op for them; it's what turns N per-line
  `receipt_bill` rows back into one sane "Related transactions" row.
- **The matching table** (Item · PO Qty · Received · Billed so far (every
  bill) · This bill's Qty · Rate · Amount) is now the SAME component used
  both while staging (enhanced with the PO Qty/Billed-so-far columns it
  didn't have before) and when reopening an already-posted receipt-matched
  Bill — `GET /api/inventory/receiving/bill?billEntryId=X` (new mode on the
  existing route) joins the per-line links back to `goods_receipt_lines`/
  `trade_document_lines`/`goods_receipts`. It replaces the generic Items/
  Accounts editor entirely for such a Bill (gated in `new-document-form.tsx`
  on `postedReceiptMatch.length > 0`, the same pattern `stagedReceipts.length`
  already uses for the pre-save case) — a "View journal entry" toggle reveals
  the underlying Dr/Cr rows read-only for anyone auditing, built from the
  already-loaded `lines` state, so the actual GL entry is never hidden, only
  not the default view.
- **Editing is true in-place — same Bill id, same `BILL-` number** (QBO
  parity, deliberately unlike a Goods Receipt's own void-and-repost
  correction — a Bill already edits in place everywhere else in this app).
  New `editBillFromReceipts()` (`lib/inventory/receiving.ts`, parallel to
  `billFromReceipts`, not routed through the generic `updateDocument` line-
  item path directly — though it CALLS `updateDocument` as its "replace lines
  in place" engine, since inventory never moves again at bill-edit time, only
  at receipt time, so `updateDocument`'s unconditional
  `reverseInventoryByEntry`/`planDocumentInventory` calls are safely no-ops
  here). A line NOT named in the edit request is reproduced BYTE-IDENTICAL
  from the Bill's own stored `sourcePayload.lines` (which IS the exact
  `billLines` array from creation, pre-tax/pre-control-line) — this is also
  how an unedited line's own already-applied price-variance (P-03) survives
  an edit to a DIFFERENT line on the same Bill, with no separate record of
  "what price was used" needed: the original posted line already is that
  record. `updateDocument` gained an optional `opts?: {revaluations}` param
  (mirroring `postDocument`'s own, previously edit-only-missing) so a price
  correction on edit gets the exact same lot-revaluation treatment as on
  create. Every existing `receipt_bill` link for the Bill is deleted and
  recreated after each edit (not just the edited lines') because
  `updateDocument`'s delete+reinsert of `journal_lines` invalidates every
  `toLineId`, not only the changed ones'.
- **Scope held deliberately narrow, per explicit confirmation**: only
  quantity and invoice price are editable per line; which receipts/lines are
  ON a Bill can't change via this path (add/remove is a delete-and-recreate
  case, consistent with every other structural document change in this app).
  `hasSettlementLink` (now exported from `documents.ts`) gates this exactly
  like every other Bill edit — a receipt-matched Bill with a payment or
  credit applied can't be corrected here until that's removed first.
- Migration verified clean against the dev branch (`npm run db:verify`) —
  the new column introduces zero drift; the 2 pre-existing failures and 32
  warnings are the same unrelated, already-documented legacy drift this file
  describes elsewhere. tsc clean, 694/694 tests pass.

## Reverse removed everywhere — Edit/Delete only, gated on real settlement (2026-10-25)

Prompted directly, with screenshots of a "View bill" header and a blank "New
bill" form: "Remove the reverse function fully... When someone opens the
saved forms in QBO they open up in the editable window. Right now it is
not... The right-hand suggestions window should be collapsable... Amount
fields are not aligned... for the buttons we should only use the bottom
line... this needs to be done across all the forms." Clarified before
building: "Remove Reverse Everywhere. Allow delete instead only if nothing is
linked [to] a prior doc. Bill should not be deleted if the payment is linked
with the bill. But it can be deleted if only linked with prior docs in the
chain, like GRN."

- **The user-facing Reverse feature is gone, not just hidden.**
  `app/api/ledger/journal/[id]/reverse/route.ts` (the HTTP endpoint) is
  deleted outright. `lib/ledger.ts`'s `reverseJournalEntry` and
  `lib/accounting/documents.ts`'s `onEntryReversed` are **kept** — they're
  the internal mechanism `lib/accounting/period-close.ts` still uses to
  reopen a closed period (its own system-generated Closing entry is reversed,
  never user-facing). Removing those would have broken period reopening for
  an unrelated reason.
- **Edit/Delete are now gated on SETTLEMENT, not on any link at all.**
  `updateDocument`'s line-item branch used to refuse editing if the document
  had *any* row in `transactionLinks` — which blocked editing a Bill that
  merely came from a Goods Receipt, with no payment anywhere near it. The new
  `hasSettlementLink(orgId, entryId)` (in `lib/accounting/documents.ts`,
  immediately above `updateDocument`) checks only for a `payment`/`credit`
  relation — exactly the two `deleteDocument` already distinguished in its
  own inbound/outUsed checks. `updateDocument` and `deleteDocument` now share
  this one rule instead of `updateDocument` using a stricter one than
  `deleteDocument`; `app/(app)/accounting/transactions/[id]/page.tsx` mirrors
  the identical check client-side (`hasSettlementLink` there, computed from
  `data.links`) so the button the user sees and the server's own refusal
  never disagree. A provenance link (`po_bill`, `receipt_bill`, `conversion`,
  …) is explicitly **not** a reason to block a correction — per the user's
  own rule, a Bill linked only to its GRN can still be deleted or edited; one
  with a Payment or Credit applied cannot, until that's removed first.
- **View and Edit are merged — QBO parity.** Opening a saved document used to
  always render read-only (`readOnly` was hardcoded true) with a separate
  "Edit" button that navigated to `/accounting/new/[type]?edit=...`. Now
  `transactions/[id]/page.tsx` passes `readOnly={!canEdit}` straight into the
  same `NewDocumentForm` instance — a document free to correct opens directly
  editable, no extra click; one that's been settled opens inert, same as
  before. The "Edit" button and its `Pencil` icon are gone entirely; there is
  no second entry point to reach an edit.
- **Every action lives in the bottom bar now — nothing but a status badge and
  Close in the header.** `NewDocumentForm` gained a `headerBadge?: ReactNode`
  prop (the status pill only) alongside the existing `actions?: ReactNode`
  prop (Download/Print/Email/Make-recurring/Delete), and the footer changed
  from `justify-end` to `justify-between`: a left-aligned group (the
  trade-document Download/Print/Email buttons, formerly self-rendered in the
  header, plus whatever `actions` the caller passed) and a right-aligned
  group (Cancel/Save, or Close when read-only) — exactly the user's "only use
  the bottom line" ask, applied once in the shared component so it covers
  every document type without a second place to miss.
- **The Add-to-Bill suggestions panel is collapsible, which also fixed the
  Amount-column misalignment** the user attributed to it. New
  `suggestionsCollapsed` state renders either the full `w-[320px]` panel
  (with a `ChevronRight` collapse toggle in its own header row) or a slim
  `w-10` strip with a vertical label to re-expand — the Items/Accounts table
  gets its full width back once collapsed, which was indeed squeezing the
  Amount column.
- **A second, independent Reverse surface was found and fixed in the same
  pass**: `app/(app)/settings/accounting/journal/page.tsx` (Settings →
  Accounting → General Ledger, the raw manual-journal-entry screen — a
  completely different page from the document forms above, with no Edit
  concept of its own) had its own `reverse()` function calling the same now-
  deleted route. A grep for the route path after deleting it is what caught
  this — it would otherwise have 404'd silently on click. Manual JEs have no
  delete button there either until now; fixed by wiring a `del()` function
  to the already-existing `DELETE /api/ledger/journal/[id]` route (which
  already calls `deleteDocument` and already enforces the same settlement
  rule) — one more caller of an endpoint that already existed, not new
  server logic. The page's copy ("Entries are immutable — corrections are
  posted as reversals") and its file-header comment were updated to match.
- **Every other stray "reverse it instead" error message in
  `lib/accounting/documents.ts` was reworded**, not just the two load-bearing
  checks — the doc comment above `updateDocument`, the payment-edit path's
  own two guards (unapplied credit used elsewhere; settlement amount ≤ 0),
  the inventory-already-consumed guard on both the edit and delete paths, and
  the "this transaction type can't be edited in place" guard for non-editable
  source types. None of these changed behavior — they were already correctly
  refusing the action — only the guidance text, which used to tell the user
  to do something (Reverse) that no longer exists.
- `tests/module-gating.test.ts`'s `API_OWNERS`/`UNOWNED_API` allowlist had
  `"/api/ledger/journal/abc/reverse"` as a "never gated" example path — now
  removed since the route is gone; the reverse-completeness check (which
  derives real routes from files on disk) needed no other change, since
  deleting the route file is what it actually watches for.
- 56 test files / 694 tests pass; `tsc --noEmit` is clean. Live browser
  verification of the UI changes was attempted but blocked by an unrelated
  dev-environment issue: the Next.js dev server process couldn't reach Neon
  (`neon fetch failed`, 100% of attempts) while a standalone `tsx` script in
  the same shell connected successfully every time — a sandboxed dev-server
  networking quirk, not a regression from this change. Verified instead by
  full reading of the diffs plus the automated test suite above.

## Correcting an already-posted GRN (2026-10-24)

Follow-up to the receiving two-GRN fix above: the user asked for a GRN to be
openable and correctable, "similar to the PO form," with the correction
adjusting the linked PO's quantity automatically — confirmed before building
that this would be implemented as void-and-repost, since this ledger has no
in-place edit anywhere (reversal-only, see "Accounting foundation" below).

- **`lib/inventory/receiving.ts`'s new `editGoodsReceipt(orgId, receiptId,
  input, actorId)`**: runs `preflightReceipt` (the same up-front, read-only
  checks `postGoodsReceipt` itself does — date format, lines present, items
  resolve and are tracked, currency/rate — deliberately duplicated rather
  than extracted into `postGoodsReceipt`'s body, so the create path stays
  untouched) BEFORE calling `voidGoodsReceipt`, so a mistake in the
  correction itself is caught before the original receipt is gone, not
  after. `voidGoodsReceipt`'s own guards apply unchanged: refused if the
  receipt has been billed, or if the received stock has since been
  consumed/sold on. On success, `postGoodsReceipt` posts the corrected
  lines as a fresh receipt (new `GRN-` number) — the PO's `receivedQty` is
  restored by the void and re-advanced by the repost, landing correct
  either way.
- **New `PATCH /api/inventory/receiving/[id]`** calls `editGoodsReceipt`.
  `GET /api/inventory/receiving/[id]` was extended to also join
  `inventory_lots` for `supplierBatchNo`/`productionDate`/`bestBeforeDate` —
  those GS1 fields live on the LOT, not `goods_receipt_lines` (which only
  has `lotNo`/`expiryDate`), so the edit form couldn't otherwise resume
  what was originally entered.
- **UI**: `components/receiving-console.tsx`'s new `EditReceiptDrawer` — a
  flat, `AdhocReceive`-styled multi-line editor (not the PO-drilldown's
  per-line `LotCapture`, which is built around an *open* PO line's
  remaining-quantity context that doesn't apply to an already-posted
  receipt) pre-filled from `GET .../[id]`. A PO-linked line's item is
  locked (changing which item a PO line received doesn't make sense without
  also changing which PO line it's linked to); qty, lot/batch, expiry, and
  the GS1 fields are all editable, and lines can be added or removed.
  Supplier is read-only — changing a receipt's supplier on a "correction"
  would re-attribute PO-linked lines to a PO they don't belong to; that's a
  void-and-re-receive-under-the-right-PO case, not an edit.
- **Entry point**: a Pencil icon per row on the Receiving list, next to the
  existing void (Trash) icon — shown live only when `billedAmount <= 0.005`
  (dimmed with a tooltip otherwise, matching the exact condition
  `voidGoodsReceipt` itself enforces, so the UI never offers an edit the
  server would refuse).
- **Not done**: editing a receipt whose lines were already partially billed
  is refused outright (reverse the bill first) — there's no partial-edit
  path that only touches the still-unbilled portion of a receipt. This
  matches how every other correction in this app already works (void,
  don't partially patch).

## QBO form-parity sweep — Phase 3: voucher print template for Transfer/Journal Entry (2026-10-25)

Closes the one gap Phase 1 deliberately deferred: Manual (Journal Entry) and
Transfer had Print/Download nowhere, because forcing them through the
invoice-shaped template (`components/print-document-sheet.tsx`) would have
produced a nonsensical document — no party to put in the party box, no
"goods and services" line items, no balance-due concept.

- **`lib/accounting/document-print.ts` gained a `VOUCHER_TYPES` branch**
  (`Manual`, `Transfer`) inside `loadLedgerDocumentForPrint`, returning early
  with a new `voucherLines: PrintVoucherLine[]` field (`account`, `name`,
  `description`, `debit`, `credit`) built straight from `journal_lines` —
  the EXACT same Account/Name/Description/Debit/Credit shape the on-screen
  generic ledger view (`transactions/[id]/page.tsx`'s non-form-view branch)
  already renders, so the printed copy and the on-screen view can never
  show different data for the same entry.
- **`PrintSheetBody` branches on the new `doc.isVoucher` flag**: the masthead
  and footer are shared with every other document type (same company
  header, same styling), but the middle of the page swaps the party-box +
  item-lines + balance-due block for a plain debit/credit table with a
  totals row — reusing the existing `.lines`/`.totwrap` CSS rather than a
  parallel stylesheet. `showBank` (our own bank details panel) is suppressed
  for a voucher too — a Transfer or Journal Entry has no counterparty to
  send money to.
- **`transactions/[id]/page.tsx`'s `canPrint`** now includes `Manual` and
  `Transfer` alongside the existing line-item/settlement/Deposit types —
  this is the last document type gap from the original Phase 1 audit.
- **Not extended to Email/Send** — these have no party, so "email this
  document" has nothing to send it to; `EMAILABLE` stays as scoped.
  Attachments and Audit history already worked for Manual/Transfer
  unconditionally (both were wired into the generic ledger view with no
  type restriction back in Phases 4/5), so nothing needed to change there.

This closes the full six-phase QBO form-parity sweep: Print/Download, Email/
Send, Attachments, Audit history, Make Recurring, and this voucher template —
every gap identified in the original audit is now built. tsc clean, 694/694
tests pass.

## QBO form-parity sweep — Phase 6: Make Recurring (2026-10-25)

The last of the six phases the client asked for, in order. A saved document
can now be turned into a template that auto-posts a fresh copy on a
schedule, the way QBO's own "Make recurring" works.

- **`recurring_templates`** (migration `0112`) stores a `payload` that is the
  SAME `PostDocInput` shape already stored in `journal_entries.sourcePayload`
  — built via `lib/accounting/documents.ts`'s existing `documentPayload()`
  (the same reconstruction logic the edit/reopen path already uses), minus
  `date`/`docNumber`/`dueDate`: a fresh run always sets its own date, gets a
  freshly allocated number, and (if the original had `termsDays` rather than
  a fixed `dueDate`) computes its own due date relative to the NEW date
  rather than repeating one fixed date forever. Generating an occurrence is
  therefore just `postDocument(orgId, {...payload, date}, createdBy)` —
  the one posting engine, not a second one.
- **Scoped to `RECURRABLE_TYPES`** (`lib/accounting/recurring.ts`, shared by
  both the client button and the API route so the two can never drift apart)
  — Invoice/SalesReceipt/CreditNote/RefundReceipt/Bill/Expense/VendorCredit,
  the same set `transactions/[id]/page.tsx` already calls `LINE_EDITABLE`.
  Payment/BillPayment/Deposit/Transfer/Manual Journal Entry are deliberately
  excluded — their "amount" varies occurrence to occurrence in a way that
  makes a templated copy misleading rather than useful. Trade documents
  (Estimate/PO/SO) aren't recurring in this phase either.
- **`inngest/functions/recurring.ts`'s two functions mirror `chase.ts`'s own
  shape exactly** — a cron scheduler (`06:00 UTC`, before the `08:00` chase
  run) fans out one event per org, a per-org handler processes it in
  isolation with each template wrapped in its own `step.run` (so a failed
  template doesn't block the rest of the org, and a retry doesn't
  regenerate an already-created occurrence). Gated on
  `requireActiveSubscription`, same as chase. Uses `today()` (UTC), not
  `localToday()` — this runs with no viewer, so there is no "local" to be
  relative to; matches `chase.ts`'s own precedent exactly.
- **Scheduling math is pure and tested** (`lib/accounting/recurring.ts`'s
  `nextOccurrence`/`isTemplateFinished`, `tests/recurring.test.ts`) — reuses
  `report-periods.ts`'s existing `addMonthsToDate`/`addDays` (the latter
  widened from file-private to exported) rather than a second date-math
  implementation. Covers the month-end clamp (Jan 31 + 1 month → Feb 28),
  a leap-day source date, and all three end conditions.
- **Auto-send reuses the Phase 2 Email/Send defaults, duplicated
  deliberately rather than an HTTP round-trip**: `sendRecurringEmail()`
  builds the same subject/body `components/document-email-modal.tsx` would,
  from the same `loadLedgerDocumentForPrint` data, then renders the PDF via
  the same `renderLedgerDocumentPdf` Download/Email already use — because
  this runs server-side already, inside a background job with no browser,
  so calling the HTTP API route would just be routing through itself.
- **`components/make-recurring-modal.tsx`** turns an EXISTING saved document
  into a template (there is no "make recurring" option on a brand-new,
  unsaved document in this phase — QBO offers that too, but it's a
  materially different integration point into the create flow, deliberately
  deferred). **`/accounting/recurring`** (new sidebar entry, Accounting →
  Setup) lists/pauses/resumes/deletes templates — it does not create one;
  that always starts from a document's own screen.
- **Not done in this phase**: no "Reminder" or "Unscheduled" template modes
  (QBO's other two besides "Scheduled", which is what this builds) — an
  always-active automatic schedule is the only kind; no custom email body
  per template (auto-send always uses the same default wording Email/Send
  does); editing a template's own future dates/amounts mid-schedule is
  pause-then-delete-then-recreate, not an in-place content edit (only name/
  frequency/interval/end-condition/auto-send/active are PATCH-able).

Migration applied and verified clean on the dev branch (110/112 applied, 153
tables, 2131 columns checked, no new warnings). tsc clean, 694/694 tests pass.

## QBO form-parity sweep — Phase 5: Audit history per document (2026-10-25)

Client picked this as the next phase. Reused existing infrastructure rather
than inventing a fourth logging mechanism: the app already had `audit_events`
— a generic "track & trace" log covering Receivables (`email_sent`,
`stage_changed`, `promise_to_pay`, …) and Payables (`bill_approved`,
`purchase_order_submitted`, …) workflow events, keyed on `customerId`/
`projectId`/`invoiceId`, written by `lib/audit.ts`'s `logEvent()`.

- **`audit_events` gained the same `(docType, docId)` discriminator** Print/
  Download, Email/Send and Attachments already use (migration `0111`,
  nullable columns + an index) — NOT a new table. One log now serves both
  its original purpose (Receivables/Payables workflow, via customerId/
  projectId/invoiceId) and per-document history for every type, including
  ones with no invoiceId at all (a Bill, a Payment, a Journal Entry).
  `document_emailed` is deliberately its own event type, separate from the
  existing `email_sent`/`email_manual` (the Receivables chase-email
  timeline, keyed on invoiceId) — conflating the two would have mixed an
  AR-specific timeline with a generic one keyed completely differently.
- **Seven new event types**: `document_created`/`edited`/`reversed`/
  `deleted`, `document_emailed`, `attachment_added`/`removed`. Logged at the
  SAME single choke points this whole sweep has built on: `lib/accounting/
  documents.ts`'s `postDocument`/`updateDocument`/`deleteDocument` (native),
  `lib/accounting/trade-documents.ts`'s `createTradeDoc`/`deleteTradeDoc`
  (trade — `deleteTradeDoc` gained an `actorId` param it didn't have before,
  its one caller updated in the same change), the reverse route (`/api/
  ledger/journal/[id]/reverse`), `/api/email/send`'s new `attachDocument`
  branch, and both Attachment routes. Every `logEvent()` call is fire-and-
  forget with its own `.catch` — this history must never be able to break
  the action it's describing, the same rule `lib/audit.ts`'s own doc comment
  already states.
- **Actor name is resolved fresh at READ time, not trusted from the write.**
  `documents.ts`'s create/edit/delete/reverse calls only ever have an
  `actorId` (a bare user id), not a full session with a name — rather than
  plumb a name lookup into every one of those call sites, `GET /api/
  documents/audit` joins `users` once and resolves it there, so every row
  shows a correct, current name regardless of which write path logged it.
  Attachment/Email events, which DO have a session in scope at the route
  level, still pass `actorName` too — redundant with the join, but harmless,
  and consistent with how the pre-existing Receivables/Payables event types
  already populate it.
- **A deleted document's own history is intentionally still readable.**
  `deleteDocument` logs `document_deleted` using the entry's data captured
  BEFORE the row is removed — but the row is genuinely gone afterward, so
  `docBelongsToOrg` (the same ownership check Attachments introduced) would
  otherwise 404 the whole audit list. `GET /api/documents/audit` falls back
  to "does at least one event exist for this org+doc?" when ownership fails,
  so the one event that explains why the document can no longer be opened is
  never the one thing you can't see. In practice this matters less for the
  per-document panel (nothing is left to open once deleted) than for the
  existing `/admin` audit-event export, which this change feeds unchanged.
- **`components/document-audit-panel.tsx`** is self-contained, the same
  `{kind, id}` shape as every other panel in this sweep — wired into the
  same two places, unconditionally like Attachments (not scoped like
  Email/Send's `EMAILABLE` set — history matters for every document type).
- **Not done in this phase**: no field-level diff ("Amount changed from X to
  Y") on `document_edited` — it records only that an edit happened, not
  what changed; QBO's own audit log does show field diffs, and building
  that would mean capturing a before/after snapshot per edit, a materially
  bigger change than reusing the existing log. No read-access logging
  (opening/viewing a document is not an event here, matching QBO itself,
  which also doesn't log views).

## QBO form-parity sweep — Phase 4: file Attachments per document (2026-10-25)

Client picked this as the next phase. New data model, unlike Phases 1–2
(Print/Download, Email/Send), which only ever reused what already existed —
genuinely new storage and a new table, scoped tightly to stay "build once."

- **`document_attachments`** (migration `0110`) is polymorphic on
  `(docType, docId)` — the SAME "ledger" | "trade" discriminator and id space
  Print/Download and Email/Send already use (`journal_entries.id` or
  `trade_documents.id`), not a third one. No FK on `docId`, same tradeoff
  `transaction_links.fromId/toId` already accepts, for the same reason (the
  id is polymorphic across two different tables).
- **Upload goes straight from the browser to Vercel Blob**
  (`app/api/documents/attachments/blob-token/route.ts`, mirroring the
  existing `/api/batch/upload/blob-token` pattern verbatim) — never through
  one of our own serverless functions, which cap request bodies at ~4.5 MB
  with no app-level override, and a scanned receipt or multi-page PDF can
  easily exceed that.
- **`blobUrl` is never returned to the client** — `GET /api/documents/
  attachments` (the list) only ever returns id/filename/contentType/
  sizeBytes/createdAt/uploadedBy; a download goes through `GET /api/
  documents/attachments/[id]`, which re-checks org ownership and proxies the
  file server-side. Vercel Blob URLs are public-by-default (the random
  suffix is obscurity, not access control) — these can be scanned receipts
  or signed POs, as sensitive as the ledger entry they're attached to, so
  access control lives in our own layer, not the storage provider's.
- **The row is created by the client's own follow-up call, not Vercel's
  `onUploadCompleted` webhook** — that webhook is a server-to-server call
  from Vercel's infrastructure that doesn't fire reliably on localhost (the
  batch-upload route's own comment already states this and deliberately does
  nothing in it); depending on it here would mean an uploaded file with no
  record of it existing, some of the time, with no visible error. The client
  calls `POST /api/documents/attachments` itself immediately after the blob
  upload finishes, which is also where the one new access-control check
  lives: `lib/document-attachments.ts`'s `docBelongsToOrg` — called before
  issuing the upload token (refusing to let an org attach anything to a
  document it doesn't own) and again before the row is created, the same
  "one choke point" pattern `resolveLocationId`/`fetchQboInvoicePayInfo`
  already use for their own single-decision rules.
- **`components/document-attachments-panel.tsx`** is self-contained, the
  same shape as `DocumentEmailModal` before it — given only `{kind, id}` it
  lists/uploads/downloads/deletes everything itself. Wired into the SAME two
  places: `new-document-form.tsx` for trade documents (Estimate/PO/SO, which
  have no detail page of their own) and `transactions/[id]/page.tsx`'s
  `afterContent`/generic ledger view for every native document — deliberately
  **unconditional** there, unlike Email/Send's `EMAILABLE` scoping, because
  QBO itself lets you attach a file to any document type including Bills and
  Journal Entries; attaching is not a "this goes out to someone" action the
  way sending is.
- **Not done in this phase**: no activity-log entry records who attached or
  removed a file (Phase 5 — Audit history territory); no virus/malware
  scanning of uploaded content; no preview-in-browser for images/PDFs (a
  download is always a save-to-disk today).

## QBO form-parity sweep — Phase 2: Email/Send inline from the document form (2026-10-24)

Client chose this as the next piece after Phase 1 (Print/Download). Built as
a genuinely generic capability, not an Invoice-only one — reused everything
Phase 1 already built rather than inventing a parallel data path.

- **`components/document-email-modal.tsx`** (new) is self-contained: given
  only `{kind: "ledger"|"trade", id}`, it fetches the document's print-ready
  shape from the SAME `GET /api/print/document` endpoint the `/print/...`
  preview pages already use — which already resolves company name, party
  email, and the document's label/number — and prefills To/Subject/Body from
  it. No new data plumbing was needed for this: every field the modal shows
  was already computed by the Print/Download work.
- **`POST /api/email/send` gained an `attachDocument: {kind, id, filename?}`
  field.** The server renders the exact PDF `/api/print/pdf` would produce
  (same `lib/pdf/document-pdf.ts` functions) and attaches it directly —
  deliberately NOT routed through the existing `extraAttachments` (base64)
  field, which would mean the client fetching the PDF, base64-encoding it
  (~33% size bloat) and re-uploading it, for no benefit over rendering it
  once, server-side, where it was going to be rendered anyway.
  `export const runtime = "nodejs"` was added explicitly (headless Chromium
  cannot run on the Edge runtime — the same constraint `/api/print/pdf`
  already states) even though Node was already the implicit default.
- **Scope matches QBO's own action bar, not "every document type."**
  Invoice/Sales Receipt/Credit Note/Refund Receipt/Payment/Bill Payment (to a
  Customer) and Estimate/Purchase Order/Sales Order (to a Customer or
  Supplier) can be emailed. **Bill/Expense/Supplier Credit deliberately
  cannot** — those are purchase documents received FROM a supplier, not sent
  to one; QBO's own action bar has no "Send" on a Bill either, and adding one
  here would imply a workflow (negotiating a bill by email from inside the
  app) nobody asked for.
- **Wired into two places, not a shared page**, because trade documents and
  native ledger documents are opened differently: `components/new-document-
  form.tsx` carries its own Email button (self-contained, reading its own
  `editId`/`cfg.trade` state) for Estimate/PO/SO, which have no detail page
  of their own — the SAME reasoning the Phase 1 Print/Download buttons there
  already followed. `app/(app)/accounting/transactions/[id]/page.tsx` carries
  the native-document Email button in its shared `actionsBar` (both the
  read-only form view and the generic ledger view render it), gated by a new
  `EMAILABLE` set alongside the existing `LINE_EDITABLE`/`PAYMENT_EDITABLE`.
- **This is still Phase 2 of several** — no outbound record of an emailed
  Bill/Estimate/PO is kept anywhere (no `communications` row, no activity
  timeline entry) the way an Invoice's AR emails already are; that's Phase 5
  (Audit history) territory, not solved here. Recipients are always typed or
  taken from the party's own email on file — there is no template/customize
  system for these bodies yet (Receivables already has one, for AR chase
  emails specifically; extending it to every document type is a separate,
  unscoped ask).

## QBO form-parity sweep — Phase 1: Print + Download everywhere (2026-10-24)

Client: *"Can you match all forms with the QBO?... Every form is missing even
basic functions: Like Print Button, Download Button."* Audited every document
type against QBO's own action bar before building anything (Print, Save as
PDF, Email/Send, Make Recurring, Duplicate, Attachments, Audit history) —
confirmed via explicit scope question that "full QBO parity" is the goal,
staged the same way every other large spec in this file is staged (Phase
1/2/3…), starting with the piece the client named directly.

**What was actually true before this pass** (corrected a wrong first
assumption — not literally "every form" was missing these): Invoice, Sales
Receipt, Credit Note, Refund Receipt, Bill, Expense, Supplier Credit already
had Print + Download PDF once reopened via `/accounting/transactions/[id]`.
Estimate/PO/SO had them too, but only as small icons in the list row
(`components/trade-doc-list.tsx`), never on the document's own open/edit
screen. **Payment, Bill Payment, Transfer, Bank Deposit, and Manual Journal
Entry had neither anywhere** — confirmed by reading `DOC_META` in
`lib/accounting/document-print.ts`, which had no entry for any of them.

- **Payment / Bill Payment now print as what they actually are: a receipt /
  remittance, not an invoice.** The old journal-line fallback
  (`loadLedgerDocumentForPrint`'s "no stored payload" branch) excludes
  Accounts Receivable/Payable AND Bank lines to keep item lines clean on a
  real invoice — but a Payment's only two lines ARE exactly Bank and A/R (or
  A/P), so that fallback would have produced a blank, $0.00 "receipt" the
  moment anyone clicked Print. Caught and fixed before it shipped, not after:
  a new `SETTLEMENT_TYPES` branch builds the printed lines from what the
  payment was actually **applied to** (`linksFor`'s "payment"/"credit"
  relations — the same data that already feeds the Collections Board's
  Linked Transactions panel), one row per invoice/bill settled, with any
  unapplied remainder shown as "Unapplied (on account)". The accent total box
  reads "Amount received"/"Amount paid" (new `doc.totalLabel` field on
  `PrintDocument`, defaulting to the existing "Balance due"/"Total due"
  wording for every other type) rather than "Balance due" — a Payment has no
  balance of its own. `showBank` (our own bank details panel) is suppressed
  for a Payment receipt specifically — telling a customer who already paid
  where to send money reads backwards.
- **Bank Deposit works through the EXISTING payload-based path untouched** —
  its lines are already stored in the same generic `{accountId, amount,
  description}` shape `decorateLines` expects (confirmed by reading
  `documents.ts`'s Deposit branch), so adding its `DOC_META` entry was the
  entire fix; no new branch needed. Its party box reads "—" (no single
  depositor for a multi-source deposit) rather than misattributing it to
  whichever source line happened to post first — correct, not a gap.
  `app/(app)/accounting/transactions/[id]/page.tsx`'s `canPrint` now covers
  it alongside the existing line-item types and Payment/BillPayment.
- **Transfer and Manual Journal Entry are deliberately NOT included in this
  phase.** Both are debit/credit-shaped with no party and no "goods and
  services" or settlement concept — forcing them through the invoice-shaped
  template (`components/print-document-sheet.tsx`) would produce a
  misleading or broken-looking document (no "amount due" makes sense, a
  Transfer has no counterparty to put in the party box). They need their own
  small "journal voucher" template (the same Account/Name/Description/
  Debit/Credit table the on-screen generic ledger view already renders) —
  flagged as the next piece of this phase, not silently skipped.
- **Estimate/PO/SO's own open/edit screen** (`components/new-document-
  form.tsx` — the only place these are ever viewed; they have no standalone
  detail page) now carries its own Download/Print buttons, self-contained
  (reads `cfg.trade` + the component's own `editId` state, needs nothing
  passed in by the page wrapper) rather than requiring every opener to supply
  an `actions` prop the way native documents do. Reuses the exact
  `/api/print/pdf?kind=trade` + `/print/trade/[kind]/[id]` routes the list
  row's own icons already use — no new PDF logic, just a second place to
  reach it from.
- **Not done yet, named rather than silently dropped**: Email/Send inline
  from any document form (would reuse the AR email infrastructure that
  already exists for Invoices, extended to Bills/Estimates/POs — needs a
  sender template + party email resolution per type), Make Recurring (new
  schedule/template data model + an Inngest job), file Attachments (new
  table + storage), and an Audit history panel per document (new event log).
  Each is its own scoped phase, same staging this file already uses
  throughout for large specs.

## The GL nets same-account lines per document — one line per account+dimension, not per item (2026-10-24)

Raised directly against the "Add to Bill" work above: a single Bill against one
Goods Receipt (3 lines: Chicken/Chicken/Salt, all clearing the same GR/IR
account) posted **three separate debit lines to GR/IR** instead of one —
correct in total, but not how a real accounting system presents it, and the
client's own words on this: *"Accounting system is the solid stone for any
organisation: they will never tolerate anything which does not make sense."*
Researched against SAP, Oracle, NetSuite and Odoo before building, per the
explicit ask to "build once rather than back & forth changes":

- **The majority pattern (SAP FI document summarization, NetSuite's GL Impact
  view, Oracle Subledger Accounting) posts ONE GL line per account+dimension
  combination per document** — PO/receipt-line-level matching detail lives in
  a subledger/assignment field, not as separate GL rows. Odoo is the outlier
  (one journal item per invoice line even on a shared account). The decision
  here follows the majority: the GL is a summary of financial impact, not a
  transcript of line items — this app's own Items table on the document,
  `goods_receipt_lines`, and `transaction_links` already ARE that subledger,
  so nothing is lost by not re-exploding the GL.
- **`lib/ledger.ts`'s `postJournalEntry` — the single GL writer every poster in
  the app goes through — now runs every entry's lines through `netLines`
  before validating/inserting.** It collapses lines that share the exact same
  `accountId` + **every** posting dimension (class/location/cost centre/
  project/name/currency/exchange rate) into one row, summing debit/credit (and
  `fxDebit`/`fxCredit` where present); a debit and a credit on the same
  account+dimensions net to one line in whichever direction survives, and a
  group that fully cancels out within one document is dropped entirely. **A
  singleton group — the overwhelming majority of documents, which never put
  two lines on the same account — is returned completely untouched**, so this
  changes nothing for any document type unless it genuinely has two+ lines
  landing on the same account+dimensions. Built ONCE at the engine level
  (not per-poster) deliberately: `billFromReceipts` was the reported case, but
  the identical pattern (two lines on one account) can happen on an Invoice,
  Expense, or any other document type — fixing it in one choke point is what
  "build once" means here, matching how `resolveLocationId`/
  `fetchQboInvoicePayInfo` already centralize their own single-decision rules.
- **The netted line's description is the document's own memo** (e.g. "Bill for
  goods received (GRN-0003)"), not a comma-joined item list — confirmed with
  the client before building. Falls back to the first line's own description
  only when no memo is given (e.g. a bare manual entry).
- **Verified safe to do at the engine level, not just assumed**: grepped every
  `createLink`/`transactionLinks` call site — none keys a link to a specific
  `journal_lines` row by its position in the array posted to
  `postJournalEntry` (every link is header-level, `toId: entry.id`, amount-
  based). Every report (`financials.ts`, `reconcile.ts`, trial balance,
  general ledger) aggregates by account over however many rows exist, so
  fewer, larger rows produce byte-identical totals — confirmed by the full
  686-test suite passing unchanged plus 11 new tests
  (`tests/ledger-netting.test.ts`) pinning the merge, the per-dimension
  non-merge cases (class/location/cost centre/project/name/FX rate), the
  description rule, and the fully-self-cancelling-group drop.
- **Not the same bug, fixed in the same session**: the Bill's "Related
  transactions" panel linked every row (including `GoodsReceipt`/
  `PurchaseOrder`/`Estimate`) to `/accounting/transactions/[id]`, which is a
  `journal_entries.id` route — those three types' `id` points at
  `goods_receipts`/`trade_documents` instead, so opening a GRN from a Bill
  errored. Fixed in `app/(app)/accounting/transactions/[id]/page.tsx`
  (`relatedRow()`): those three render as plain non-clickable rows (the same
  "no detail page yet" rule the Supplier/Customer transaction feeds already
  use), and `SalesOrder` — which DOES have a real detail page — now links
  there instead of to the wrong route.

## "Add to Bill" reworked: stage, don't post — and a view-link fix (2026-10-24)

Direct feedback on the first version (previous section, below, kept for the
history): *"The bill automatically added the lines and saved the bill —
didn't give user chance to review any other thing - I even did not put the
bill number which is supposed to be the supplier's number."* Plus: *"A user
could create a bill for multiple GRNs"* and *"Suggestions needs to be on the
right side."* All three are now fixed — the "immediate post" design in the
section below is **superseded**, not just extended.

- **"Add" now STAGES, it never posts.** A Purchase Order's addable
  (non-stocked) lines are pushed straight into the Bill's own, still-editable
  Items table (`addPoToBill`), tagged with `poId`/`poLineId` — the user can
  edit qty/rate/tax, add another PO's lines, type the Supplier ref/Bill No.,
  pick the date, then press the form's own Save. A Goods Receipt is added to
  a `stagedReceipts` list (`addReceiptToBill`) instead — several receipts can
  be staged and billed together in ONE call. Nothing touches the server until
  Save.
- **Save branches, once, at the top of `submit()`**: if any receipts are
  staged, it calls `billFromReceipts` (`receiptIds`, the form's own
  `date`/`dueDate`/`reference`/`memo`) and returns — the Items/Accounts
  sections are hidden whenever a receipt is staged (shown in their place:
  a read-only "Goods receipts on this bill" list, fetched from the existing
  `GET /api/inventory/receiving/bill?ids=`) for the same reason the two can't
  combine in one entry: a receipt's lines post to GR/IR clearing, not a
  normal expense/item account. With no receipts staged, Save posts the Bill
  exactly as before — PO-staged lines are now ordinary payload lines, just
  carrying `poLineId`.
- **Closing out a staged PO line's progress** — advancing its billed amount,
  recomputing the PO's status, creating the `po_bill` link — now happens
  inside `lib/accounting/documents.ts`'s `postDocument` itself
  (`closePoLinesOnBill`, called from the existing Bill-bridging tail), since
  lines from SEVERAL POs can land on one Bill here, unlike `convertTradeDoc`
  which only ever closes one PO at a time. **Deliberately duplicates a small
  piece of `convertTradeDoc`'s own tail logic rather than importing it** —
  `trade-documents.ts` already imports `postDocument` FROM `documents.ts`, so
  the reverse import would be circular. The one simplification versus
  `convertTradeDoc`: this path's `po_bill` link amount is net-only, no
  tax-rate lookup, since the net `invoicedAmount` — not the link's own amount
  — is what actually decides whether a PO line counts as billed.
- **Panel moved to the right side of the form**, QBO-style, running the full
  height of the header + Items area (Memo/Totals/footer stay full width below
  it). The sheet widens to `max-w-[1560px]` only for Bill, so the panel adds
  space rather than squeezing the existing columns. Implemented with a
  `display: contents` wrapper for every OTHER document type, so nothing about
  Invoice/PO/Expense/etc.'s layout changed — only Bill's own two-column
  branch is new.
- `bill-suggestions`' PO lines now carry full editable-line data (item, qty,
  rate, tax, dimensions), not just `{lineId, amount}` — needed so a staged
  line is a real, editable Items row rather than an opaque lump sum. A line
  with nothing billed yet shows its true ordered qty/rate; a line a PRIOR
  bill already partly covered (via `convertTradeDoc` or an earlier staged
  bill) degrades to one lump-sum row at qty 1, since there's no "remaining
  quantity" to attach a rate to without risking double-counting.
- **Separately, a real bug in the unified Supplier Transactions feed (shipped
  the same day, prior section)**: every Bill row's "View" linked to
  `/payables/bills/[id]` — the QBO/Xero-sync approval-workflow screen — even
  for a **native** bill, which has no approval record there and so can't be
  opened from it. A native bill's real document lives in `journal_entries`,
  viewed at `/accounting/transactions/[entryId]` — the exact page the same
  feed's Expense/VendorCredit/BillPayment rows already link to. Fixed by
  branching on `apBills.source`: `"native"` → `/accounting/transactions/
  [entryId]`, anything else → the existing `/payables/bills/[id]`.

## "Add from purchase order or goods receipt" on the New Bill screen — v1, superseded above (2026-10-24)

Requested directly against QBO's own "Add to Bill" panel (screenshots of a QBO
Bill form listing open POs down the right side, each with an "Add" button that
links its lines onto the bill). Built as `GET /api/accounting/bill-suggestions
?supplierId=` + a panel in `components/new-document-form.tsx`, shown on the
Bill screen once a supplier is picked.

- **This version's central scope decision — immediate posting on "Add" rather
  than staging into a reviewable draft — was reversed the same day** (see the
  section above). Kept here only for the historical reasoning: the trade-off
  was single-source `convertTradeDoc`/`billFromReceipts` calls (simple, zero
  new posting logic) versus a multi-source staged draft (what was actually
  wanted, and what shipped above instead).
- **A PO line for a stocked item is never offered — this part is unchanged.**
  See `convertTradeDoc`'s own doc comment a few sections below — billing a
  stocked item straight from a PO (skipping the Goods Receipt) is exactly how
  BILL-0004 double-counted stock in production. `bill-suggestions` computes,
  per PO, which lines are addable (`!isTracked`) vs which still need
  receiving first (`hasStockedRemaining`, shown as a note rather than
  hidden).
- Registered in `lib/modules.ts`'s `API_OWNERS` (owner `"accounting"`) —
  `tests/module-gating.test.ts`'s reverse-completeness check catches an
  unregistered route exactly like this, which is how the omission was caught
  before shipping.

## Receiving two items in one visit was creating two GRNs (2026-10-24)

Reported: "In a single receiving - I received two items: but it created two
GRNs." Traced to the UI, not the backend — `lib/inventory/receiving.ts`'s
`postGoodsReceipt` already fully supports a multi-item, multi-line receipt in
one document (`lines: ReceiptLineInput[]`, one journal entry, one `GRN-`
number), and `AdhocReceive` (the "Receive without a PO" path) already uses
it correctly. The PO-linked path did not: `ItemsHub` (the PO's line list) →
click ONE line → `LotCapture` (lot/batch capture for that line) → its old
`submit()` POSTed immediately. Two lines touched in the same visit meant two
separate POSTs, each its own GRN, PO-linked but otherwise unrelated documents.

- **Fix: stage, don't post, per line.** `LotCapture`'s action is now
  `stage()` — it validates and builds the same `payloadLines` as before, but
  hands them to a new `onStage(lineId, draft)` callback instead of calling
  `fetch`, then returns to `ItemsHub` via the existing `onBack`. `ReceiveDrawer`
  holds the staged lines in `drafts: Record<lineId, DraftLine>` (`DraftLine`
  = `{ itemName, baseUom, qty, lines }`), keyed by PO line id so re-opening an
  already-staged line resumes exactly what was entered (qty stays in BASE
  units — the convention every row already used — so the unit picker
  re-displays correctly once `unitOpts` loads; the lot-suggestion `useEffect`
  is skipped for a reopened draft so it can't silently overwrite a lot number
  already typed).
- **One `postReceipt()` in `ReceiveDrawer`** combines every staged line
  (`Object.values(drafts).flatMap(d => d.lines)`) into a single POST to
  `/api/inventory/receiving` — exactly the shape `AdhocReceive` already sends,
  just assembled from several `LotCapture` visits instead of one flat form.
  Approval-threshold staging (`requiresApproval`/`pending`) now applies to the
  combined receipt total, not per line — the right scope, since it's one
  document.
- **`ItemsHub` is now the staging ground**: each line shows a "Staged: X qty"
  badge (green border) with a "Remove staged" action once captured, a banner
  summarizing how many items are staged, and a sticky `DrawerFooter` with
  "Post receipt (N items)" — disabled until at least one line is staged.
  Drafts are cleared on leaving the PO (`backToHub`/`openPo`) or once the
  combined receipt actually posts; a failed post leaves drafts intact so nothing
  typed is lost on retry.
- **Not changed**: `AdhocReceive` (already correct), `postGoodsReceipt` itself
  (already multi-line), PO progress/`receivedQty` advancement, the Goods
  Receipt detail/void routes. This was purely the PO-linked capture UI's
  immediate-post habit.

## Unified Supplier/Customer Transactions — every document lands under the party (2026-10-24)

Reported by the client, after I'd proposed a narrower fix (just add Goods
Receipts to the Supplier tab): **"Thats not correct — Every supplier related
transaction should land under supplier, similar to QBD, same for the
Customers."** Scope was confirmed via explicit question before building:
every document type where a Supplier is specified (Bills, Expenses, Vendor
Credits, Bill Payments, Purchase Orders, Goods Receipts), plus closing the
two gaps already known to exist on the Customer side (Sales Orders,
Shipments) in the same pass.

- **The Customer feed (`app/api/customers/[id]/transactions/route.ts`)
  already existed and was the template** — it aggregates Invoice/Credit
  Memo/Payment/Refund Receipt/Journal Entry/Deposit/Cheque Expense/Estimate
  into one chronological feed, QBO's own Customer → Transactions tab shape.
  It only had two gaps: Sales Orders and Shipments (both native,
  non-accounting document types with no prior feed at all) — both added.
- **The Supplier side had NO equivalent** — `app/(app)/payables/suppliers/
  [id]/page.tsx` had a Bills-only "Transactions" tab and a completely
  separate "Purchase Orders" tab, with Expense/Vendor Credit/Bill Payment/
  Goods Receipt appearing nowhere on the supplier at all. New
  `app/api/payables/suppliers/[id]/transactions/route.ts` mirrors the
  customer route's shape exactly, sourced from:
  - **Bills** — `ap_bills.supplierId`, already the bridge/mirror table for
    BOTH native-bridged (`bridgeNativeBill`) and QBO/Xero-synced bills, so
    this alone covers both org types.
  - **Expense / Vendor Credit / Bill Payment** — these have **no bridge
    table at all** (only Bills are mirrored). They're read straight from
    `journal_lines`/`journal_entries`, filtered on
    `nameType="Vendor" AND nameId=<supplierId>` (the document's own control
    line, stamped by `lib/accounting/documents.ts`'s `name()` helper) and
    `sourceType IN (Expense, VendorCredit, BillPayment)`. **This is
    native-only by construction** — a QBO/Xero-synced org has no local copy
    of these transaction types, so the query correctly returns nothing for
    them rather than guessing or faking a row.
  - **Purchase Orders** — BOTH of the two real PO tables this app carries
    are shown (see "known, deliberate duplication" below in this file):
    Payables' own `purchase_orders` (has a confirmed detail page,
    `/payables/purchase-orders/[id]`) and the native `trade_documents` kind
    `"PurchaseOrder"` (feeds Receiving; no confirmed standalone detail page
    yet, so its row's `viewHref` is `null` — shown read-only rather than
    linking somewhere unverified).
  - **Goods Receipts** — `goods_receipts.supplierId`; also `viewHref: null`
    for the same reason (no confirmed detail page).
  - Sign convention mirrors the Customer feed: Bill is "+" (increases what's
    owed), Expense/Vendor Credit/Bill Payment are "-" (reduce it) — the same
    relationship Payment/Credit Memo have to Invoice on the AR side.
- **`components/transactions-tab.tsx` (the shared `TransactionsTab`
  component, already used by Customer and Project detail pages) gained a
  `scope="supplier"` mode** rather than a second component being built —
  `CUSTOMER_FILTERS`/`SUPPLIER_FILTERS`/`typeFiltersFor(scope)` for the type
  dropdown, a `viewHref?: string | null` field on `Txn` so a row can declare
  its own "View" destination (or explicitly declare it has none, vs. a
  customer row that never sets the field and falls back to the old
  Invoice/Credit-Memo-only logic), and the summary strip's "open balance"
  type switches to `"Bill"` for supplier scope (was hardcoded `"Invoice"`).
- **The old Supplier page's separate "Purchase Orders" tab was removed
  entirely** — POs now appear inline in the one unified feed, matching how
  Estimates already sit inside the Customer feed rather than their own tab.
  `PurchaseOrder` interface, `pos` state, `POsTab`, the old `SupplierTransactions`
  component, and their now-dead helpers (`txnStatusBadge`, `withinDateRange`)
  were deleted from `app/(app)/payables/suppliers/[id]/page.tsx`. The `bills`
  state/fetch was KEPT — the Overview tab's aging buckets still depend on it.

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
- **Board composition strip — per currency, and a click is the segment itself**
  (2026-09-25). One strip per currency (`classifyCompositionByCurrency`); it
  used to sum every currency into one total labelled with the largest. Clicking
  a segment sets `cf.comp` (+ `cf.compCcy`) and filters with
  `compositionKeyOf` — the SAME first-match rule the strip counts with. The old
  click applied stage/response filters that ignored the rule's priority (an
  escalated invoice with a promise is not "Committed"; an overdue disputed one
  is not "In Collection"), so the board showed a different set than the count.
- **Due dates on the board, Payables, AR report, both portals' escalation
  screens, the customer statement and the bill PDF** now go through
  `formatDateShort`. Each built `new Date(dueDate)` — UTC midnight, a day early
  west of Greenwich — which the old guard missed because it only knew the
  `+ "T00:00:00Z"` form. A new guard covers `new Date(<dueDate>)` and local
  `fmtDate` helpers built on `new Date()`, with an allowlist for real timestamps.
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
    `/accounting/bom`): recipe of output←input items. Producing stock against a
    BOM is done through a **Manufacturing Order** (see the dedicated section
    below) — `lib/inventory/mo-completion.ts`'s `completeMoRun` consumes the
    lots allocated to the order and produces an output lot at the summed cost,
    into the same `production_runs`/`production_consumptions`/
    `production_outputs` tables and the same "Production" `BUILD-` numbered
    series a standalone "Build" console used to write to directly (removed
    2026-09-27 — see below); the tables and series predate the MO and are
    unchanged by its removal.
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
  can-be-sold/purchased flags, two tax fields. (Several of these were built on
  2026-09-25 — see the sections below.)
- **The QBO and Xero account syncs now mirror the WHOLE chart** (2026-09-25).
  QBO fetched only six expense-side types and Xero a similar list, so a synced
  tenant had none of its own stock, GRNI, income or bank accounts to map a role
  to. Xero types are stored translated into the app's vocabulary
  (`xeroAccountType`; Xero's code stays in `raw.Type`) — before, a Xero account
  could never pass role validation. Both syncs now set `classification`. Pickers
  filter by type, so the extra accounts only reach the lists they belong in.

### Correction (2026-10-23): native orgs no longer get the 18-account template automatically

The "Provisioning is lazy" bullet above — "a native chart gets the 18 default
accounts (+3 trading)... a synced chart... gets the groups only" — is now
**stale on the native half**. Raised directly: "the inventory account has to
be chosen by the User, not by us... they might want to map [WIP] under a
finished product — and that account they want to create themselves — why are
we creating that? ... Clearing Account is fine — which is really a need."

- **The real distinction isn't native-vs-synced, it's mechanical-vs-structural.**
  GR/IR Clearing and Suspense are genuine plumbing — there is no accounting
  judgment call behind them, a user couldn't design them differently even if
  asked, and they rightly stay system-created on demand (see the sections
  above). Finished Goods Inventory, Raw Materials Inventory, Semi-finished
  Goods Inventory, Trading Goods Inventory, their Sales/COGS splits, Labour/
  Overhead Absorbed, Production/Purchase Price Variance, Scrap & Yield Loss,
  Inventory Adjustments/Write-downs are NOT plumbing — whether to split
  inventory by category at all, and how, is a real chart-of-accounts design
  decision QuickBooks itself deliberately leaves to the user (confirmed: QBO's
  own hard-coded system accounts are a short, fixed list — A/R, A/P,
  Undeposited Funds, Opening Balance Equity, Retained Earnings, Exchange Gain
  or Loss, Reconciliation Discrepancies, Sales Tax Payable — and creating your
  first Inventory item in QBO asks you to pick or create the Asset/COGS
  accounts; QBO never invents a category split or cost-accounting variance
  accounts on your behalf).
- **`ensureInventoryAccounting`** (`lib/accounting/account-roles-server.ts`)
  now calls `provisionInventoryAccounting(orgId, { withAccounts: false })`
  unconditionally — every tenant, native or synced, gets the four default
  GROUPS on first use, every role left UNMAPPED. This is the exact path a
  synced tenant already went through (R-03: never duplicate an external
  chart); native tenants simply weren't routed through it before. Nothing
  breaks on an unmapped role: `loadItemCostInfo` already refuses to post a
  tracked item whose group has one, naming Posting Groups as where to fix it
  — the same safety net synced orgs have always relied on.
  "Create missing default accounts" on the Posting Groups mapping screen
  (`POST /api/accounting/posting-groups/provision`, still passing
  `withAccounts: true` explicitly) is now the ONLY way our suggested accounts
  get created — an explicit ask, never automatic, for every tenant.
- **A quieter side effect, consistent with the same principle**:
  `ensureScrapItem` (creates the "Scrap & offcuts" item against the
  SCRAP_SALES role account) only ran as part of the `withAccounts: true`
  branch, so it no longer fires automatically either — a native org that
  hasn't explicitly provisioned accounts gets no auto-created Scrap Sales
  account OR item, matching the same "nothing invented until asked" rule.
- **Changed with zero production orgs live on native accounting** (confirmed
  directly before making this change — the one paying client is Receivables
  + QBO), so there was no existing data to migrate, reclass or risk orphaning.
  `scripts/migrate-inventory-accounting.ts` (the R-10 one-time reclass script
  for orgs that already had the old catch-all "Inventory Asset") is untouched
  — it's an explicit, dry-run-by-default CLI tool, not a live path, and its
  own `withAccounts: !synced` call still matters for a tenant actually being
  migrated off a pre-existing catch-all account.

## Receiving — count in packs, and manually close an unfulfillable PO line (2026-10-23)

Two related gaps raised against the Receiving screen: "Receive stock" forced
every quantity into the item's raw base unit (type "2560" instead of "4
case"), and there was no way to stop a partially-received PO line from
staying open forever once a supplier would never deliver the rest.

- **Partial receiving across multiple visits already worked before this** —
  `app/api/inventory/po-open/route.ts` only drops a line once its
  `remainingQty` hits zero, so a PO stays on the "In progress" tab and keeps
  offering what's left until it's fully received. That was never the gap;
  the gap was having no way to manually stop expecting the rest.
- **"Count in" picker (`components/receiving-console.tsx`'s `LotCapture`)**
  reuses `orderOptions()` (`lib/inventory/order-options.ts`) — the same
  supplier-scoped pack-conversion helper Manufacturing Order consumption/
  output capture already use — to offer base UoM + the supplier's own unit +
  inner/outer pack, defaulting to whichever unit the PO line was actually
  raised in (matched by `packLevel`). The row's stored `qty` stays in BASE
  units throughout (unchanged `total`/`over`/payload logic); only the
  displayed/entered number is converted live by the chosen unit's
  `unitsPerOrderUnit` — switching units mid-entry re-reads correctly because
  the base value was never lost.
- **Manual per-line close** (`POST /api/inventory/po-lines/[id]/close`,
  "Close remaining" on each line in the PO drilldown): requires a reason —
  this is a buyer giving up on part of an order, not a routine action, and
  it's worth a record. It does **not** touch `orderedBaseQty`/`receivedQty`
  (the true ordered-vs-received history stays honest); `po-open` just treats
  a closed line's `remainingQty` as 0, so it stops being offered and the PO
  drops off the hub once every line is closed-or-fully-received. Scoped
  per-line, not per-PO, by explicit product decision — one short-shipped item
  shouldn't force closing lines still genuinely expected.
- Migration `0109_po_line_close.sql` adds `closed`/`close_reason`/`closed_at`
  to `trade_document_lines`, purely additive (every existing row defaults to
  unclosed) — verified against production with `npm run db:verify` before
  shipping; no other drift introduced.

## Manufacturing orders — nothing posts until Completed; lots are allocated (2026-09-24)

The product owner's lifecycle, and now the only one:

| MO status | Entry | Stock |
|---|---|---|
| Scheduled / Released | none | the output is EXPECTED stock (Stock Status "Expected (PO / MO)") |
| In Progress | none | production picks lots per material; those quantities are ALLOCATED (`lot_allocations`) — on hand, in their stock account, but no other MO, shipment, sale, build or job work can issue them |
| Completed | the one entry | exactly the allocated lot quantities are consumed at their own cost; the output lot is produced; allocations deleted |
| Cancelled | none | allocations released |

- **Allocation is by QUANTITY**, so a lot can be split across MOs. Suggested
  first-expiry-first-out (`lib/inventory/allocation.ts`, pure and tested); the
  user may change it, and `suggested` records whether they kept the proposal.
- **What is allocated is what was used.** Completion consumes the allocations,
  which may differ from the plan; the drawer says by how much. It refuses to
  complete while any stocked material has nothing allocated, and it never falls
  back to FIFO or to a typed cost (`planIssue`'s `exactPicks` mode reports a
  shortfall instead of costing one). That closes the worst gap in the MO path:
  completion used to draw shortages at `apItems.unitCost`, driving stock
  negative in the GL only.
- **`planIssue` subtracts other orders' allocations by default.** Only a stock
  transfer passes `ignoreAllocations` — moving an allocated lot changes where it
  is, not whose — and `tests/architecture.test.ts` pins that.
- **The MO keeps its own copy of its materials** (`mo_materials`, 0098), taken
  from the BOM on creation and re-taken when its outputs or BOM change, which is
  refused once anything is allocated. A later BOM edit therefore never changes
  an order already planned. Orders from before 0098 get their copy the first
  time they are opened. (The per-pack COST split at completion still reads the
  BOM's output lines — the quantities are the MO's.)
- **In Progress → Released is refused while lots are allocated** (the stock
  would stay reserved for an order nobody is working); cancelling releases them.
- The work-in-progress account is not used while an MO is open — the allocated
  stock stays in its raw-material account until completion, which keeps total
  stock right at any month-end.
- **An order reads as Input / Output tabs** (2026-09-27, both the guided
  Process MO drawer and the row-click detail drawer — shared `MoTabs` /
  `InputPanel` / `OutputPanel` in `components/mo-console.tsx`, so they can't
  drift). Input = one card per material (expected qty); a card opens its lots
  as cards (available, planned = FEFO share, actual). **Actual is counted in
  any unit the lot came in** — `consumptionUnits` (`lib/inventory/order-options.ts`)
  offers base UoM + the lot's OWN supplier's packs (scoped like `orderOptions`:
  another vendor's "bag" is a different size) + our item-SKU packs, and the
  client sends `entered × perUnit` in BASE units, so the server and
  `lot_allocations` never see a pack unit. Lots show read-only before In Progress.
  **Output is the same shape**: a card per output pack (expected / actual);
  opening one captures what was ACTUALLY produced, in the pack, the SKU's
  higher levels (shrink, carton) or the base unit — `outputCaptureUnits`,
  anchored on the MO's own `unit_content` (not the SKU's `innerUnitPackSize`,
  which may be blank), so everything converts to PACKS. The capture is drawer
  state only: it pre-fills Complete production's "good packs" and posts
  nothing itself; a posted run clears it.
  **Lot selection has two saves**, because an order is often completed over
  several runs: *Save for later* only reserves (allocation, nothing posts);
  *Save & complete a run* saves, then opens completion preset to consume
  EXACTLY what is allocated (not the server's pro-rata partial default) —
  the order stays In Progress unless every output is done. `runBlocker` says
  which material still has no lots instead of opening a drawer that can only
  fail. Both drawers set the order and its allocations in one state update,
  so the run never opens on pre-save allocations.

### Stock is issued from lots or not at all (2026-09-25)

`planIssue` REFUSES a shortage (`refuseShortfall`) for every caller — sale,
shipment, build, job work, transfer. It used to fill the gap with a lot-less
pick costed at `apItems.unitCost`, so stock could leave that never existed and
the GL drifted from stock with nothing to show where. The error names what is
available and how much is allocated to MOs. Exact-picks mode still returns a
shortfall for its caller to word. Quick Build now consumes the lots AND
quantities the user picked (it used to keep only the lot ids and refill them
FIFO). Guarded in `tests/architecture.test.ts`.

### MOs on BOMs without output packs; BOM line units (2026-09-25)

- **A BOM with no output packs** (all of AM's — the shape the standalone
  "Build" console produced before its removal, see below) can now be planned
  as an MO: it produces the item's BASE unit, stored as an MO output
  with a null SKU and unit content 1. `mo-completion.ts` keys outputs with
  `K(skuId)` ("" for base) and writes null back; void handles it too.
- **BOM line units are converted when the line is saved**
  (`/api/inventory/bom-lines`): a line entered in another unit of the same kind
  is converted to the item's base unit (500 g of a kg item → 0.5 kg); a unit
  that can't be converted (litres of a kg item) is refused. Every consumer reads
  base units, so this closes the "2 cones read as 2 kg" gap. No existing line in
  production used a non-base unit.

### "Build" was removed — a Manufacturing Order is the only way to produce stock (2026-09-27)

Product owner's call: an ad-hoc production run against a BOM (`/supply-chain/build`,
`components/production-console.tsx`, `lib/inventory/production.ts`'s
`buildProduction`/`buildProductionMulti`) sat alongside the Manufacturing Order
lifecycle as a second, lighter way to produce stock — no schedule, no lot
allocation, no labour/overhead, post immediately. Kept for the same reason a
small operation doesn't want the ceremony of Draft → Scheduled → Released
before recording "I made 50 units today." Decided that convenience wasn't
worth two production-posting engines: removed rather than kept as a shortcut.

- **What actually left**: the nav entry, the Create-menu entry, the
  `/supply-chain/build` page/console, the POST handler on
  `/api/inventory/production` (creation), `lib/inventory/production.ts`
  itself, and the `"production_build"`/`"production_build_multi"` approval
  resume cases. Mobile's ENTIRE "Production" department item goes with it —
  it was built on this same ad-hoc engine (`postProduction` →
  `/api/inventory/production`), not on Manufacturing Orders, which mobile
  never supported at all. Scheduling one needs lot allocation and a status
  board a phone screen has no room for, so mobile's floor workflows are
  Receiving and Shipping only until it gets a real production workflow.
- **What did NOT move an inch, because it's shared infrastructure the MO
  lifecycle depends on, not "Build" ephemera**: the `production_runs`/
  `production_consumptions`/`production_outputs` tables (`mo-completion.ts`
  writes them directly — it never called `buildProduction`, despite an old
  comment in `manufacturing-orders.ts` implying otherwise, now fixed), the
  `"Production"` `BUILD-` numbering series, `lib/inventory/void.ts`'s
  `voidProductionRun` (handles both an MO-linked run and a pre-0099 build the
  same function always did), `lib/inventory/genealogy.ts`'s lot-trace reports,
  `lib/inventory/references.ts`'s delete-blocking count, and the
  `"production_build"` approval entity type — `mo-completion.ts` still checks
  its configured threshold directly (`requiresApproval(orgId,
  "production_build", …)`), so an org's existing threshold amount survives
  the removal unchanged; only `"production_build_multi"` (confirmed zero rows
  ever, in production) was removed outright.
- **Voiding a completed MO's run moved from the (now-gone) Build console into
  the MO's own detail drawer** — `components/mo-console.tsx`'s "Built ✓" line
  is now a real button calling the same `DELETE /api/inventory/production/
  [id]` route unchanged; `voidProductionRun` doesn't care whether the run it's
  voiding came from a build or a completion.
- Checked before removing anything: production had exactly 4 `production_runs`
  (all pre-MO, `moId` null) and one resolved (`Rejected`, not pending)
  `production_build` approval row — nothing pending would have been stranded.

### Can be sold / can be purchased, per item (2026-09-25, 0101)

`ap_items.can_be_sold` / `can_be_purchased` are NULLABLE: null = the item
kind's own flag (`itemCanBeSold` / `itemCanBePurchased` in item-kinds.ts), so
every item made before them behaves exactly as before and nothing was
back-filled. New items get the spec's defaults (`defaultTradeFlags`: RM bought
not sold, WIP neither, FP sold not bought, trading / non-inventory / service
both), switchable per item — which is how the old "RM sold as surplus"
decision survives. Enforced: purchase documents (via the sourcing check),
Invoice / Sales receipt, Shipment, Sales Order. Credit notes and returns are
exempt — taking back what was sold must always work. `purchase_tax_rate_id` is
the default PURCHASE tax (the form uses it on the purchase side);
`tax_rate_id` stays the sales tax. The item form shows prices, tax fields and
the Suppliers toggle only for the directions the item is switched on for.

### Stock counts and write-downs (2026-09-25)

`lib/inventory/adjustments.ts`, Supply Chain → Inventory → Stock Adjustments.
A COUNT sets a lot to what was counted; the difference moves at that lot's cost
(loss issued out, gain put back in) against Inventory adjustments, and stock
with no lot becomes a new lot at a stated cost. A count may not go below what
MOs have allocated from the lot. A WRITE-DOWN lowers ONE lot's unit cost with a
reason (NRV / Expiry / Damage / Recall / Other) against Inventory write-downs;
a write-up is refused. Both are one entry (ADJ- series, sourceType StockCount /
WriteDown) and voidable exactly (`voidStockAdjustment`). Verified end to end on
the dev branch, including void.

### Returns and invoice price differences (2026-09-25)

- **"Goods returned" is a document-level switch** on Credit note, Refund receipt
  and Vendor credit (`PostDocInput.goodsReturned`, a checkbox on the form).
  Unticked = a price credit: no stock moves. A vendor credit on a stocked item
  then goes to Purchase price variance, never to the inventory account (it
  used to credit inventory with no lot behind it).
- **Customer return (P-14)** goes back into the lots it was SOLD to that
  customer from — invoices and shipments, most recent first, net of earlier
  returns (`planCustomerReturn`) — at each lot's current cost, reversing cost of
  sale. Returning more than was sold through lots is refused.
- **Supplier return** leaves the lots THAT supplier supplied, at lot cost; the
  gap between the credit's amount and that cost goes to purchase price variance,
  so the stock account moves by exactly the lot cost.
- **Invoice price ≠ receipt price (P-03)**: `billFromReceipts` takes an invoice
  price per receipt line (the bill drawer's "Invoice prices" column). GR/IR still
  clears at the receipt's value; the difference is its own line to purchase price
  variance, and the share on stock still in the lot (remaining ÷ original) moves
  into the lot's cost via `revalueLot` — an internal `postDocument` option, never
  read from a request body, because it posts to a control account.
- **Bills from receipts are in the receipts' currency, at their rate (P-02).**
  Before, no currency was passed, so a foreign-currency receipt could not be
  billed at all. Receipts in different currencies or rates must be billed
  separately. The FX difference belongs to the payment. (A cent of rounding can
  remain on GR/IR for a foreign receipt: its home value is converted to the bill
  currency and back.)
- `reverseInventoryByEntry` now undoes a stock INCREASE into an existing lot
  (a return, a count gain — refused if since issued) and a revaluation (the unit
  cost steps back), so deleting or editing such a document is clean.
- Bill/Expense lines may be negative (posted as a credit), for a discount or an
  invoice below the receipt price.
- Verified end to end on the dev branch: return into the same lot with cost of
  sale reversed; over-return refused; price credit moves nothing; supplier
  return with 2.00 to PPV; bill at 5 against a receipt at 4 with 40% of the lot
  used → 4 to PPV, 6 into stock, lot cost 4 → 5; deleting the bill restores 4.

### Completion runs, labour & overhead, yield (2026-09-24, 0099)

- **Each completion is its own run and its own entry**
  (`lib/inventory/mo-completion.ts`). A run reports good packs, a rejected
  quantity, the lots it used (out of the order's allocations only) and hours per
  operation — every field defaults ("the rest of the order, everything
  allocated", hours in proportion). A partial run leaves the order In Progress
  with its allocations reduced; a FINAL run releases whatever is still
  allocated, which is how unused material goes back to stock — no entry, it
  never left. `?preview=1` returns the server's own costing of exactly that
  input, and the drawer shows it before posting.
- **The entry**: Cr components (exact lots) → Dr WIP; Dr WIP / Cr Labour
  absorbed + Overhead absorbed; Dr output stock / Cr WIP; Dr Scrap & yield loss
  / Cr WIP. WIP nets to zero on every run. Order accounts come from the OUTPUT
  item's group.
- **Rates live on WORK CENTRES** (labour + overhead per hour, Supply Chain →
  Manufacturing → Work Centres), **time on the BOM's OPERATIONS** (hours per
  batch). Not on the item: one item on two lines costs differently, and a wage
  change is one edit. The MO copies operations WITH the rates when planned, so a
  later rate change never re-costs an order in flight.
- **Yield** (`lib/inventory/mo-costing.ts`, pure, 9 tests): with expected yield
  y, a run of G good + R rejected may lose (G+R)(1−y) normally — absorbed into
  the good units. Rejects above that are abnormal and go to Scrap & yield loss
  at the SAME unit cost, so good units carry the normal loss and never the
  abnormal. No yield on the BOM = 100% (every reject is abnormal). Packaging is
  outside the yield: a pack holds only good product.
- **The MO's copy now holds everything a completion reads**: materials per item
  and per pack (`mo_materials.for_sku_id`), operations with rates, each pack's
  base content (`mo_outputs.unit_content`) and the yield — nothing at completion
  reads the live BOM.
- **Void** of a completion run takes its packs back off the order and reopens it
  In Progress; the consumed lots return to stock but are NOT re-allocated —
  production picks them again, knowingly.
- Verified end to end on the vercel-dev branch (migrated to 0099 for it):
  allocate → partial run with rejects → final run → void both, WIP zero after
  each step, every entry balanced. The E2E-prefixed fixture items remain there.

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
  - **Payables' own `purchase_orders`/`purchase_order_lines` (the
    `/payables/purchase-orders` screen — see the duplication note above) is
    exempt too, but for a different reason: it acquires nothing locally. Its
    only outlet is `lib/po-push.ts`, which pushes a header+lines straight to
    QuickBooks/Xero — nothing converts it to a local Bill or receipt, no
    lot/movement/journal-entry is ever created from it, and `ap_bills.
    purchase_order_id` is never written by any code path. Its `item_id`
    column is also the wrong shape for the check: it holds the PROVIDER's
    item id (QBO `ItemRef.value` / Xero `ItemCode`), not `ap_items.id`, so
    wiring the check in naively would 500 every item line
    (`findSourcingViolations` does `inArray(apItems.id, itemIds)` against a
    uuid column fed a QBO/Xero string). A Bill raised later for the same
    goods — by hand, or from a Bill created inside QuickBooks/Xero off the
    pushed PO — IS checked: a hand-raised Bill goes through `postDocument`
    like any other, and a provider-mirrored Bill is never posted at all (see
    "one path per document type" below), so neither one is this exemption
    quietly reappearing under another name. The exemption lasts only while
    that premise does — the moment this path starts reaching a posting or
    stock engine, or gains a second reader, it needs re-examining, not just
    re-documenting. `tests/architecture.test.ts` asserts the premise itself
    (the files named here still exist, still import no posting/stock engine,
    still reference no posting/bridge table, and `purchase_order_lines` still
    has no other reader), so it fails the moment any of that stops holding.
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

## Chart of Accounts wiring — a real, latent Xero misclassification bug (2026-10-21)

Prompted by: "no active users on native accounting yet, the one paying client
is Receivables + QBO" — the point being that right now is the cheapest moment
to audit the Chart-of-Accounts → financial-statement wiring, before anyone
depends on its current (wrong, in one place) behaviour. This is NOT a
hypothetical IFRS-nicety finding — it's a concrete bug in a translation table,
confirmed against Xero's own documented `AccountType` enum and a read-only
production scan.

- **The bug**: `lib/xero-ap-sync.ts`'s `xeroAccountType()` mapped the key
  `PAYGLIAB` to `"Other Current Liability"`. **`PAYGLIAB` was never a real
  Xero `AccountType` value** — Xero's actual enum uses `PAYGLIABILITY` (and a
  separate bare `PAYG` in some API responses). The key could never match a
  real account, so any AU/NZ org's PAYG withholding-tax liability fell
  through to `map[acc.Type] ?? acc.Type`, storing the raw, unrecognized
  string `"PAYGLIABILITY"` as the account's `type`. `SUPERANNUATIONLIABILITY`
  (pension liability, the counterpart to the already-mapped
  `SUPERANNUATIONEXPENSE`) was missing from the map entirely — same failure.
- **What that did downstream**: `lib/accounting/financials.ts`'s `place()`
  couldn't find either unrecognized string in `account-types.ts`'s 15-type
  taxonomy, and its own fallback defaulted to **"Current Assets, debit-
  normal"** — a payroll/pension LIABILITY silently shown as an ASSET on the
  Balance Sheet, with inverted sign, in the wrong statement section.
- **Verified NOT currently live**: a read-only scan of all 898 production
  `accounts` rows (`scripts/_scan_unrecognized_account_types.ts`) found zero
  rows with an unrecognized `type` — no org synced so far happens to carry a
  PAYG or superannuation liability account. Latent, not active; fixed now
  while it costs nothing to fix.
- **Fixed at the root**: the map now has `PAYGLIABILITY`, `PAYG`, and
  `SUPERANNUATIONLIABILITY`, all → `"Other Current Liability"`.
- **Fixed the symptom too, for next time**: `place()`'s fallback branch now
  `console.error`s when BOTH `type` and `classification` are unrecognized,
  instead of silently returning the same guess it always did. The guess
  itself is unchanged (still has to return *something* so report generation
  doesn't crash on one bad account) — what changed is that this class of gap
  can no longer go unnoticed. `tests/financials-place.test.ts` pins that the
  15 canonical types and a recognized `classification` alone never log, and
  that an unrecognized combination always does.
- **QBO side checked too, and is clean**: `lib/qbo-ap-sync.ts` passes QBO's
  `AccountType` straight through with no translation map — and QBO's
  documented `AccountType` enum has exactly the 15 values
  `account-types.ts` models (`account-types.ts` is explicitly built on QBO's
  vocabulary), so there's no equivalent typo risk on that side.
- **What this does NOT fix** (separate, larger conversation, see the earlier
  "IFRS basis" discussion above this section): no Other Comprehensive Income
  concept, no Statement of Changes in Equity, no first-class Provisions line.
  Those are real IFRS-completeness gaps, not wiring bugs — nothing is
  currently miswired because of them, there's just no home for those items
  yet if/when a native IFRS preparer needs one.
- **A second, independent instance of the same bug class, found by actually
  running all three statements against every production org** (not just unit
  tests): `lib/accounting/analysis.ts`'s `cashFlow()` decided "is this
  account's balance change part of net income?" by reading the stored
  `classification` **column** directly — a different, narrower check than
  `place()`'s type-first resolution. A real production account (EDC London,
  "Export Sales", `type="Income"`, `classification=null` — correctly synced
  type, stale/never-populated classification column) was therefore excluded
  from net income and had its balance movement leak into the **Financing**
  bucket of the Cash Flow statement instead, even though P&L/Balance Sheet
  classified the same account correctly via `place()`. Fixed by having
  `cashFlow()` resolve classification the same way — `classificationForType(m.type)
  ?? m.classification` — so type is authoritative everywhere, not just in
  `place()`. Pinned in `tests/analysis-cashflow.test.ts`.
- **Actually verified, not just fixed**: `scripts/_verify_statements.ts`
  (read-only) runs `profitAndLoss`/`balanceSheet`/`cashFlow` for every real
  org against production and checks `balanced`/`reconciles` plus whether any
  account logs an unrecognized-type warning. Before the `cashFlow` fix above,
  it caught the EDC London case live. After both fixes: **all 7 production
  orgs — ACC, EDC, Aberny, MSQ, Test Organisation, EDC London, Foodready.ai —
  show P&L ok, Balance Sheet balanced, Cash Flow reconciles, and zero
  unrecognized-type warnings.** This is the concrete answer to "are P&L,
  Balance Sheet and Cash Flow good now": yes, confirmed against real data,
  not asserted from reading the code.

## IFRS structural gaps — OCI, Statement of Changes in Equity, Provisions (2026-10-21)

Built at the client's explicit request, after the Chart of Accounts wiring
audit above: "no active users on native accounting yet" was the stated
reason it's cheap to build this now rather than later. These are presentation
additions on top of the existing 15-type taxonomy, not a redesign — every
existing account's GL placement (`place()`'s `statement`/`section`/`normal`)
is byte-identical before and after; only how a NATIVE org's own statements
choose to PRESENT certain accounts changes.

- **The design choice**: classify by `accounts.subtype` string, not a new
  schema column or a 16th top-level AccountType. `subtype` is already a free
  `varchar(64)` with no constraint (same pattern `taxLiability()` already uses
  for `salesTaxPayable`), so this needed **zero migration** and changes
  nothing about QBO/Xero sync compatibility — `ACCOUNT_TYPE_NAMES` (the 15
  canonical `type` strings) is completely untouched; only the `subtypes`
  arrays under Equity/Long Term Liability/Other Current Liability gained new
  entries. `lib/accounting/ifrs.ts` (new, pure, no `db` import — same split as
  `account-roles.ts`/`modules.ts`) is the one place that recognizes these
  subtype strings: `isOciReserve`, `isOtherReserve`, `isEquityDistribution`,
  `isShareCapital`, `isRetainedEarningsAccount`, `isProvision`, and
  `equityCategory()` (the SOCE row a subtype belongs to, defaulting to
  `shareCapital` for anything unrecognized — same "must land somewhere" rule
  `place()` follows for GL placement).
- **New subtypes** (`account-types.ts`, additive only): Equity gained `Share
  Premium`, `Revaluation Surplus`, `Foreign Currency Translation Reserve`,
  `Fair Value Reserve`, `General Reserve`, `Dividends Paid`. Both `Long Term
  Liability` and `Other Current Liability` gained `Provisions` (IAS 37 wants
  both current and non-current shown).
- **Provisions (IAS 37)**: `balanceSheet()` now peels `Provisions`-subtype
  accounts out of ordinary Non-current/Current Liabilities into their own
  `provisions: { nonCurrent, current, total }` line — already folded into
  `liabilities.total`/`totalEquityAndLiabilities` so a caller that only reads
  `liabilities` (the existing report page, before this change) still sees a
  balanced total; it's purely a more granular additional view. The `pred`
  parameter added to `balanceSheet()`'s internal `bySection()` helper is
  shared by both the "exclude provisions" and "only provisions" filters, so
  they can't silently drift into double-counting or dropping an account.
- **`lib/accounting/financials.ts`'s `comprehensiveIncome(orgIds, from, to)`**
  (new) wraps `profitAndLoss()` and adds an `oci: { lines, total }` section —
  the period movement on `isOciReserve`-subtype equity accounts, read via the
  same `natural()` credit-positive direction every other equity line uses —
  plus `totalComprehensiveIncome = netProfit + ociTotal`. Nothing currently
  posts to a revaluation/translation/fair-value account (no such posting path
  exists yet), so on every org today this is a correct zero OCI section added
  on top of an otherwise-unchanged P&L.
- **`statementOfChangesInEquity(orgIds, from, to)`** (new): for the period,
  shows each of four categories (Share capital & premium / Retained earnings
  / Other reserves / Distributions) as opening → movement → closing. Profit
  for the period rolls into Retained earnings' movement — there is still no
  period-close journal entry that actually moves P&L into a Retained Earnings
  account (same live-computed approach `balanceSheet()`'s own "Profit for the
  period" line already uses, documented at the top of this file), so this
  computes it the same way rather than inventing a second method that could
  disagree. `plNet()` (the P&L-net-movement helper) was extracted from inside
  `balanceSheet()` to module scope specifically so both functions compute
  "what counts as profit" identically — it was a local closure before this.
- **Wired through, not just built**: `GET /api/financials?statement=
  comprehensive-income|changes-in-equity` (new cases in the existing route,
  same `requireLedgerAuthority` gate as every other statement),
  `app/(app)/accounting/reports/[statement]/page.tsx` renders both (`isPL`
  generalized to `isPeriod` covering all three period-based statements;
  `BalanceSheet`'s render gained the two new Provisions sections), and the
  Reports hub (`app/(app)/accounting/reports/page.tsx`) lists both — a report
  that exists but isn't linked from anywhere is as good as not built.
  `lib/modules.ts`'s `ACCOUNTING_REPORTS` list gained the two new slugs —
  `tests/module-gating.test.ts`'s reverse-completeness check would otherwise
  flag both new pages as unowned, exactly as intended.
- **Actually verified against production, not just unit-tested**:
  `scripts/_verify_statements.ts` now also runs `comprehensiveIncome()` and
  `statementOfChangesInEquity()` for every real org and asserts the SOCE's
  closing total **ties exactly to `balanceSheet()`'s own `equity.total`** for
  the same org and date — a real cross-check between the new statement and
  the pre-existing engine, not just "it returned *a* number". Confirmed
  2026-10-21: all 7 production orgs show Comprehensive Income computing
  cleanly and Changes in Equity tying to the Balance Sheet exactly, with zero
  unrecognized-account-type warnings. `tests/ifrs.test.ts` pins the pure
  classifiers (including that every new subtype string is actually
  registered in `account-types.ts`, so the classifier can't quietly become
  dead code if a subtype name is ever renamed there without updating here).
- **Not built, deliberately out of scope for this pass**: a real
  revaluation/translation/fair-value POSTING path (nothing currently debits
  or credits an OCI reserve account — this pass builds the presentation
  layer and the classification rule, not a new transaction type), a
  period-close journal entry that actually moves P&L into Retained Earnings
  (both `balanceSheet()` and the new SOCE compute it live instead, by
  deliberate consistency with the existing design), and IFRS 9 reclassification
  rules (which OCI items eventually recycle through profit or loss on
  derecognition vs. never reclassify) — `comprehensiveIncome()`'s OCI section
  is presented as one undifferentiated total, not split by that distinction.

## Sales document refactor — Phase 3d (trimmed): inclusive pricing + TaxProvider (2026-10-21)

Scoped down from the original 3d (inclusive/exclusive toggle, rounding-mode
setting, reverse-charge PDF wording, tax-label localization, `TaxProvider`)
to just the toggle and the interface, by explicit choice at the time — this
session's cost had crossed into territory where shipping a smaller, fully
verified slice beat pushing through the whole remaining list. **Rounding-mode
setting, reverse-charge PDF wording and tax-label localization are still not
built.**

- **Inclusive/exclusive pricing, end to end**: `PostDocInput.pricing` (new,
  optional, defaults to `"exclusive"` — byte-identical to every document ever
  posted) flows into `withTax()`, which now backs the net out of a tax-
  inclusive line amount for BOTH the native (`taxCodeId`) and legacy flat
  (`taxRateId`) paths, using the same math so a document can mix the two
  without them disagreeing on what "inclusive" means. UI: a per-document
  toggle next to "Line items" in `new-document-form.tsx`.
- **A real bug caught and fixed in the same pass, not introduced by this
  phase**: the client-side totals preview (`new-document-form.tsx`'s `totals`
  useMemo) only ever read `l.taxRateId` — a line using Phase 3c's new native
  `taxCodeId` showed **zero tax in the live total** even though the server
  posted it correctly. Fixed by reusing `calcLineTax` client-side (it's pure
  and already safe to import) against a locally-resolved `TaxCodeRates` built
  from the already-fetched tax-codes/components lists — an approximation that
  ignores a component's effective-dating (reasonable for a document being
  composed today) while the server stays authoritative at post time.
- **`TaxProvider` interface** (`lib/accounting/tax-engine.ts`) — the seam
  spec section 4.3 asks for, so a US-sales-tax engine (Avalara/Stripe Tax/
  TaxJar) could be plugged in later without `documents.ts` caring which engine
  answered. **Not wired into posting** — `withTax()` still talks to
  `calcLineTax`/`resolveTaxCodes` directly. `createNativeTaxProvider()` wraps
  the existing engine in the interface shape, proving it's implementable and
  giving a reference to compare a future external adapter against.

## Sales document refactor — Phase 3c: admin UI + line picker (2026-10-21)

Builds the UI that actually makes Phase 3a/3b reachable: admin screens to
create tax agencies/components/codes, and a picker on sales document lines
that lets a native org choose a code (sending the `taxCodeId` field Phase 3b
added) alongside the existing legacy tax-rate picker.

- **`/accounting/tax-codes`** (`components/tax-codes.tsx`, new sidebar entry
  under Setup next to Tax Rates and Posting Groups) — three stacked sections:
  Agencies, Components, Codes. A synced (QuickBooks/Xero) org sees a notice
  and nothing else, same rule Posting Groups already follows. No remap/
  reclass flow like Posting Groups has — a tax code carries no balance of its
  own to strand, so delete is a straight refuse-if-referenced check.
- **`lib/accounting/tax-engine-server.ts`** gained the CRUD/listing functions
  (`listTaxSetup`, `createTaxAgency`, `createTaxComponent`, `createTaxCode`,
  `updateTaxCode`, the three `delete*` functions). Account-type validation
  reuses Phase 1's `accountTypeError`/`UNTRACKED_EXPENSE_TYPES`/
  `untrackedIncomeTypes` from `account-roles.ts` verbatim — a component's
  sales account is the same "Income/Other Income" rule an untracked item's
  income account already follows; its purchase account the same expense rule.
- **Dedicated routes, not the generic `/api/accounting/[entity]` CRUD** —
  `tax-agencies`, `tax-components`, `tax-codes` (+ `[id]`) under
  `app/api/accounting/`. The generic route is flat single-table CRUD; a tax
  code is a parent with an ordered child list (its components), which doesn't
  fit that shape — same reasoning that already gave Posting Groups its own
  routes rather than folding into the generic one.
- **The document-form picker** (`new-document-form.tsx`): one combined
  `<select>` per tax cell, `<optgroup>`-separated into "Tax codes" (native,
  only shown when the org isn't synced) and "Tax rates" (the existing flat
  list, labelled "(legacy)" once codes exist). The two are mutually
  exclusive per line — picking one clears the other — so a line is never
  ambiguous between them. No Zod schema strips the new `taxCodeId` field on
  either the create or edit route; both already pass the body through to
  `postDocument`/`updateDocument` unfiltered, so no route change was needed
  there.
- **Registered in `lib/modules.ts`** (`PAGE_OWNERS`/`API_OWNERS`, owner
  `"accounting"`) — `tests/module-gating.test.ts`'s reverse-completeness check
  caught these as unaccounted-for before this was added, exactly as it's
  meant to. It also caught a `new Date().toISOString().slice(0,10)` in the
  component form's date default — fixed to `localToday()` from `lib/format.ts`
  before it could become the next "a date is a date" bug this file already
  has two sections about.
- **Not done in 3c**: the inclusive/exclusive pricing toggle (still hardcoded
  `"exclusive"` in `withTax()`), the company-level rounding-mode setting
  (still hardcoded `"perLine"`), reverse-charge PDF wording, tax-label
  localization, and the `TaxProvider` interface — Phase 3d.

## Sales document refactor — Phase 3b: wired into posting (2026-10-21)

Wires Phase 3a's tax engine into `lib/accounting/documents.ts`'s posting path.
**Caught and fixed a real bug before it shipped**, which is as important to
record as the feature itself.

- **The bug**: the first version branched `withTax()` on `isSyncedOrg(orgId)`
  — "native org → new engine, synced org → old flat `apTaxRates` lookup
  unchanged." That's wrong, and the reason is the same fact Phase 3a's own
  investigation had already surfaced and should have been applied here:
  `apTaxRates` is ONE shared table used by **every** org, not a synced-only
  mirror — a native org has its own `source: 'native'` rows in it today, and
  every existing native-org Invoice/Bill's `taxRateId` points at one of them.
  Branching on chart-sync-status would have resolved those exact same ids
  against the brand-new, **empty** `tax_codes` table instead — silently
  zeroing the tax on every native org's invoices and bills the moment this
  shipped, with no error (an unrecognised id just resolves to nothing).
- **The fix**: the native engine is opt-in **per line**, through a new
  `taxCodeId` field on `DocLineInput`, never a chart-sync-status branch.
  `taxRateId` — what every existing document and every org uses today —
  keeps resolving through `apTaxRates` completely unconditionally. Nothing
  sends `taxCodeId` yet (no UI exists for it — that's Phase 3c), so this
  phase changes **zero** behaviour for any document that exists today or gets
  created before 3c ships. `tests/tax-engine-wiring.test.ts` pins this
  exact failure mode so it can't quietly come back.
- **`lib/accounting/tax-engine-server.ts`** (new) is the `db`-touching half —
  same split as `account-roles.ts`/`account-roles-server.ts`. Its
  `resolveTaxCodes(orgId, codeIds, asOf)` resolves a `tax_code`'s components
  effective on `asOf` (the DOCUMENT's date, never "today" — a backdated
  document must use the rate that applied then), falling back from a
  component's own sales/purchase account to its agency's liability account.
- **Posting**: `buildSalesPurchaseLines`'s four `if (taxTotal) lines.push({accountId: taxId!, ...})`
  call sites (Invoice/SalesReceipt, CreditNote/RefundReceipt, Bill/Expense,
  VendorCredit) are now one shared `pushTax(direction, label)` — when a
  line's tax resolved through `taxCodeId` and has a component breakdown, it
  posts **one journal line per resolved component's account**; otherwise
  (every document today) it falls through to the exact same single
  `taxId` control-account line as before. A resolved component with no
  account at all (neither its own, nor its agency's liability account) is
  refused by name rather than silently dropped or guessed.
- **Not done in 3b**: there's still no way to actually create a `tax_code` or
  pick one on a line — that UI, plus exposing the inclusive/exclusive toggle
  (pricing is hardcoded `"exclusive"` here, matching the old calc's existing
  behaviour exactly) and a company-level rounding-mode setting (hardcoded
  `"perLine"` here), are Phase 3c/3d.

## Sales document refactor — Phase 3a: native tax engine, schema + pure calc (2026-10-21)

Phase 3 is staged (it's by far the largest phase of the spec): **3a** schema +
pure calculation engine (this section) — **3b** wiring into
`lib/accounting/documents.ts`'s posting — **3c** UI (tax code picker,
inclusive/exclusive toggle, admin screens) — **3d** reverse-charge PDF
wording, tax-label localization, `TaxProvider` interface. Only 3a is done.
**Nothing from this section is wired into posting or the UI yet** — the
engine exists and is fully tested, but every document still posts through
the old flat `apTaxRates`/`withTax()` path exactly as before.

- **New tables, `apTaxRates` untouched**: `tax_agencies`, `tax_components`,
  `tax_codes`, `tax_code_components` (migration `0108_native_tax_engine`).
  `apTaxRates` is confirmed (not assumed) to be the live QBO/Xero sync mirror
  — `lib/qbo-ap-sync.ts`/`xero-ap-sync.ts` upsert into it directly, keyed on
  `(org_id, external_id, source)` — so it stays exactly as it is; a synced
  org's tax behaviour is completely unaffected by this refactor, matching the
  native-only scope already decided for the whole spec.
- **The model**: `tax_agencies` (who tax is remitted to + its liability
  account) → `tax_components` (one named, DATED rate — "IE Standard 23%" from
  2026-01-01 — with its own sales/purchase accounts; a rate change creates a
  NEW component row rather than editing one in place, so a historical
  document's tax is never restated) → `tax_codes` (what a user actually picks
  — "IE Standard 23%", "EU B2B Reverse Charge" — carrying a `treatment` and a
  `compound` flag) → `tax_code_components` (which components make up a code,
  in what order).
- **`lib/accounting/tax-engine.ts`** is the pure calculation half (client-safe,
  no `db` import — same split as `account-roles.ts`/`account-roles-server.ts`;
  the server-side resolver that picks which `tax_components` are effective for
  a code on a document's date doesn't exist yet, that's 3b).
  - **`compound` is the whole distinction** between India's CGST+SGST (both
    9% computed on the SAME net, `compound: false`) and a true cascading tax
    (each component computed on net PLUS every earlier component's amount,
    `compound: true`) — confirmed there was zero prior precedent for either in
    this codebase (grepped for CGST/SGST/compound/reverse_charge: nothing).
  - **`treatment` decides whether components charge anything.** `standard`/
    `reduced` post the computed amount; `zero_rated`/`exempt`/`out_of_scope`/
    `export`/`reverse_charge` zero it on the document but still expose a
    `notionalTotal` (what the components would have computed) for future
    self-assessment/reporting use — never posted, never shown as owed.
  - **Inclusive pricing backs the net out of a tax-inclusive gross** via the
    same multiplier used to compute tax forward (sum of rates for non-compound,
    product of `(1+rate/100)` per component for compound) — one function,
    both directions, so they can never compute a different combined rate.
  - **Two rounding modes**, `aggregateDocumentTax`'s `"perLine"` (sum each
    line's already-rounded tax) vs `"perDocument"` (sum every line's
    UNROUNDED amount per component first, round once) — the latter is the
    standard VAT-return convention and is the only one that doesn't lose a
    cent on many small same-rate lines; pinned by a test where three lines
    each round to 0 individually but correctly total 0.01 together.
- **Verified**: migration applied and `npm run db:verify`'d clean against the
  dev branch (zero drift on the four new tables; the 2 pre-existing failures
  and 32 warnings are the unrelated, already-documented legacy drift this file
  describes elsewhere). 25 new unit tests in `tests/tax-engine.test.ts` cover
  single-rate, compound, split/non-compound, both pricing modes, every
  treatment, and both rounding modes.

## Sales document refactor — Phase 2: item-only lines (2026-10-21)

Removes the Chart-of-Accounts line selector from **Invoice, Estimate,
SalesReceipt, CreditNote, RefundReceipt** and closes the `accountOverride`/
silent-fallback escape hatch for the four that post (Estimate is non-posting —
its own check is separate). SalesOrder and PurchaseOrder were already
item-only via `isOrderDoc`; Bill/Expense/VendorCredit keep their items/
accounts `SPLIT_TYPES` tab, untouched.

- **`components/new-document-form.tsx`**: a new `isItemOnlySales` flag
  (`["Invoice","Estimate","SalesReceipt","CreditNote","RefundReceipt"]`) feeds
  `showAccountCol` (now `false` whenever `isOrderDoc || isItemOnlySales`,
  removing the whole account cell AND its `accountOverride` "Change"/"Reset"
  buttons) and widens `showItemCol` so the Product/Service column — and its
  "+ Add new item…" option — shows even when the org has **zero** items yet,
  rather than falling back to an account column the way `isOrderDoc` still
  does for Sales/Purchase Orders. That fallback was deliberately NOT carried
  over here: the spec wants these five always item-driven, and the one
  pre-existing production document group that relied on a bare account line
  (see below) was accepted as a known, narrow exception rather than a reason
  to keep the escape hatch open for everyone.
- **`lib/accounting/documents.ts`**: `buildSalesPurchaseLines`'s `accountFor()`
  gained `ITEM_ONLY_SALES_TYPES = new Set(["Invoice","SalesReceipt",
  "CreditNote","RefundReceipt"])`. For these four: a line with no item is
  refused outright (no more "caller's account stands"), `accountOverride` is
  ignored even when an item IS present, and an item whose resolved income/
  expense account is still null (a pre-Phase-1 item nobody has re-saved) is
  refused by name rather than silently falling through to `l.accountId` or
  vanishing from the posted entry. `updateDocument` (edit) calls the exact
  same function as `postDocument` (create) — one implementation, so this
  closes the hole on both create and edit in one place.
- **`lib/accounting/trade-documents.ts`**: `createTradeDoc` gained an
  `if (kind === "Estimate")` block requiring every line to carry an `itemId`,
  mirroring the existing `SalesOrder` "can be sold" check right above it.
  Estimate still doesn't require a *resolved account* yet (same as Sales/
  Purchase Order) — nothing posts until conversion, which re-resolves the
  item's account fresh at that point.
- **Verified against production before shipping** (read-only query,
  `.env.production.vercel`): across every Invoice/SalesReceipt/CreditNote/
  RefundReceipt/Estimate line in the database, exactly **5 lines on 3
  Invoices, all at Foodready.ai**, have no `item_id` — a pure account line.
  Also confirmed **zero** lines anywhere have ever actually used
  `accountOverride: true` with an item present — the override escape hatch
  has never been exercised in production, so closing it has zero blast
  radius. The 3 Foodready.ai invoices become **un-resavable until an item is
  added to those 5 lines** — the same "surface the gap on next touch, don't
  silently carry it forward" precedent Phase 1 established for items missing
  their account mapping. They remain viewable; nothing about already-posted
  history changes.
- **Not done in Phase 2**: the native tax engine (agencies/components/
  compound codes/inclusive pricing/`TaxProvider`), the shared
  `SalesDocumentLines` component (the five types still share
  `new-document-form.tsx`'s single implementation, which is arguably already
  the "shared component" the spec asks for, just not factored into its own
  file), discount/header fields (billing/shipping address, tax registration
  no., place of supply), and richer per-document-type statuses. Those are
  later phases of the same spec.

## Sales document refactor — Phase 1: item account mapping completeness (2026-10-21)

Client spec: Invoices/Sales Orders/Estimates should be item-only (no Chart of
Accounts on sales lines), with posting derived entirely from each item's
account mapping. **Scope confirmed native-only** — QuickBooks/Xero-synced
orgs own their own tax/account mapping and their invoices are never posted
locally (see "One path per document type" above); this refactor cannot and
does not touch them. Phase 1 is the first of several phases; it closes the
gap that made the rest of the spec unsafe to build on.

- **The gap, exactly**: `prepareItemAccounting` (`lib/accounting/account-roles-server.ts`)
  has always resolved a TRACKED item's accounts through its posting group
  (RM/WIP/FP/TRADING — see the "Inventory Chart-of-Accounts mapping" section
  below), fully validated. For an UNTRACKED item (Service, Non-Inventory) it
  took a one-line early return: `incomeAccountId` was stored verbatim, with
  **zero presence check and zero account-type check** — a Service item could
  be saved with no income account at all, or with its income account pointed
  at a Bank account. `expenseAccountId` wasn't even routed through this
  function; it was written raw by both item API routes.
  This is exactly how `buildSalesPurchaseLines`'s `accountFor()`
  (`lib/accounting/documents.ts:188-207`) was already documented to behave —
  "falls back to the account the caller supplied" when an item has no account
  configured — a deliberate grandfather clause for items that predate this
  rule, not a safety net to keep leaning on for new ones.
- **Fixed**: `prepareItemAccounting`'s untracked branch now requires an income
  account when the item `canBeSold`, an expense account when it
  `canBePurchased`, and type-checks whichever is set — Income/Other Income for
  Service/Non-Inventory (never Bank/AR/AP/Tax), Expense/COGS/Other Expense on
  the purchase side. The check is shared with the tracked path's `roleAccountError`
  via a new `accountTypeError(label, allowedTypes, account)` in
  `lib/accounting/account-roles.ts` — same three mistakes (wrong type, header,
  inactive), same message shape, one implementation.
- **New item kind: Other Charge** (`lib/inventory/item-kinds.ts`) — freight,
  recharges, fees, deposits. Untracked, sellable, buyable, like Service/
  Non-Inventory, but its income side may ALSO be a liability account (a
  deposit held until earned) — `untrackedIncomeTypes(kind)` in
  `account-roles.ts` is the one place that distinction lives.
  `qboItemType()` maps it to legacy `"Non-Inventory"` — there's no fourth
  bucket in that field, and this is the closest untracked, non-service shape.
- **Enforced at both create and edit** (`app/api/inventory/items/route.ts`,
  `app/api/inventory/items/[id]/route.ts`), and the client-side drawers
  (`components/products-register.tsx`) check the same rule first, so the
  error lands next to the field instead of after a round trip. The edit
  route's `touchesAccounting` gate — already presence-based, already re-runs
  `prepareItemAccounting` on every save including unrelated ones, since the
  edit form always sends every accounting field — now also fires on
  `expenseAccountId`/`canBeSold`/`canBePurchased` changes, for the same
  reason. **This deliberately means an existing item missing its mapping gets
  blocked on its NEXT edit**, not just new items — the spec wants no
  unmapped item going forward, and surfacing the gap on touch is the chosen
  way to get there, not a side effect to work around.
- **Verified against production before shipping**: a read-only scan
  (`scripts/_scan_missing_item_accounts.ts`) found exactly one item that would
  have been newly blocked — the system-seeded **"Scrap & offcuts"**
  (`ensureScrapItem` in `account-roles-server.ts`), whose `canBePurchased` had
  never been set and so inherited Non-Inventory's `canBePurchased: true`
  default, even though nobody buys scrap and the item never had an expense
  account. Fixed at the source (the seeder now sets `canBeSold: true,
  canBePurchased: false` explicitly) and backfilled on the one existing
  production row (Foodready.ai) via `scripts/_backfill_scrap_item_flags.ts`.
  Re-scanning confirms zero items are blocked.
- **Not done in Phase 1, deliberately**: removing the Chart-of-Accounts column
  from Invoice/Estimate/SalesReceipt/CreditNote/RefundReceipt lines (those are
  still `lineMode: "both"` in `new-document-form.tsx` — only SalesOrder/
  PurchaseOrder are already item-only via `isOrderDoc`), killing the
  `accountOverride`/silent-fallback escape hatch in `accountFor()`, the native
  tax engine (agencies/components/compound codes/inclusive pricing), the
  shared `SalesDocumentLines` component, discount/header fields, and the
  richer per-document-type statuses. Those are later phases of the same spec.

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
- **Still unenforced server-side: `consumable`.** `producible` is checked, but
  only client-side, at BOM registration (`components/bom-register.tsx` filters
  which items can be picked as a BOM's output) — not by any poster. `buyable`
  is enforced server-side. Flagged rather than fixed — BOM lines are the place
  `consumable` would belong.

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

### Projects in Data Studio — and why they carry no custom fields (2026-10-08/09)

Requested: bring QBO Projects into Data Studio. A `project` entity exists
(`lib/batch/entities.ts`, "list" group) for exactly this — import, export,
update. Custom field support was attempted and then **deliberately removed**
once proven impossible; read this before trying again.

- **QBO has no separate "Project" API object.** A Project IS a Customer
  record with `Job: true` and a `ParentRef` — exactly the sub-customer model
  `lib/qbo-sync.ts` already treats as a project (see "STEP 5: Sub-customers
  as projects" there). The `project` entity reuses `qboEntity: "customer"` /
  `qboReadName: "Customer"` with a `qboClientFilter` of `Job === true ||
  !!ParentRef?.value` — the same disambiguation pattern Expense/Check/
  CreditCardCredit already use to share the "purchase" QBO entity.
  `buildProject` (builders.ts) requires a parent Customer only on CREATE
  (QBO itself refuses a parentless Job); an update doesn't re-require it,
  since the sparse patch leaves an omitted field alone. `mapProjectRow`
  (row-mappers.ts) is a trimmed `mapCustomerRow` — only the fields a Project
  actually uses (name, parent, contact info, address), not Title/Terms/
  ResaleNumber/etc.
- **Custom fields were built, then proven unreachable and removed —
  don't re-add them without reading this first.** The investigation went
  through three layers before landing on ground truth:
  1. First hypothesis: QBO's newer "App Foundations" GraphQL platform
     (`https://qb.api.intuit.com/graphql`, `appFoundationsCustomFieldDefinitions`)
     backs Customer/Vendor/Project custom fields, gated behind Intuit's own
     Silver+ partner tier — confirmed real (Intuit's docs, the
     `IntuitDeveloper/Sampleapp-Customfields-Nodejs` sample), but a dead end
     for *reading an already-set value*, since that only gates *managing
     definitions* via GraphQL — reading a value off a record is a plain REST
     concern.
  2. Second hypothesis: the field shows on Invoices/Estimates (confirmed
     working, user-verified) and is "the same field" on Projects, so it
     should be sitting in the Customer record's own `CustomField` array,
     readable with no new scope. Tested directly against production data:
     **0 of 1833 Customer records in a real connected org carry any
     `CustomField` at all** (`/api/batch/debug/record?entity=customer&list=1&
     withCustomFields=1`), including the specific project being tested.
     Ruled out.
  3. **Ground truth, proven by matching record IDs across two systems**: QBO's
     modern Projects feature (even for a standalone company, not just
     QuickBooks Online Accountant's practice-management one) stores
     everything that makes a Project a Project — `status`, `startDate`,
     `dueDate`, `completedDate`, `projectNumber`, `projectSettings`
     (cost method, retainage %), **and custom fields** — in a separate,
     undocumented internal system (`Work_Project` / `Network_Contact`
     objects, Intuit's own "Work Management" GraphQL schema, custom field
     values as a JSON blob on an `externalReferences` entry:
     `externalKey: "CUSTOM_FIELDS"`, `externalBlob:
     '{"QBO":{"udcf_1000000004":"1"}}'`). Confirmed definitively: a captured
     browser payload for project "TEST 2026XXX" decoded to
     `ParentRef.value = 3755`; the SAME project's REST Customer record
     (`Id: 3756`) independently shows `ParentRef: {value: "3755"},
     customFieldCount: 0`. Same project, two systems, only one reachable.
     This schema appears nowhere in the public Accounting API or the App
     Foundations docs — it's Intuit's own first-party web client talking to
     its own backend, almost certainly authenticated by browser session, not
     an OAuth bearer token a third-party app holds. **Not pursued**:
     reverse-engineering an undocumented internal endpoint into a
     production financial app's money-adjacent code is not something to do
     on a guess, and there is no legitimate way for this app to reach it.
  - **What this means going forward**: the `project` entity can only ever
    carry the thin "shadow" Customer fields (name, parent, contact info,
    address) — never status, dates, budget, or custom fields, for ANY org,
    not just this one. That's a permanent architectural ceiling, not a TODO.
    If a future request asks for Project status/dates/budget/custom fields
    in Data Studio, this is why it can't be built, and the proof is above —
    don't re-run the investigation from scratch.
  - **Reverted, cleanly, once proven dead**: `qboCustomFieldsInclude`
    (`BatchEntity`, `lib/batch/types.ts`), the `include` parameter threaded
    through `qboReadOne`/`qboQueryAll`/`qboQueryPage`
    (`lib/batch/qbo-client.ts`), the Custom Field Name/Value columns and
    `__customFieldEdits` wiring on `project` (entities.ts, builders.ts,
    row-mappers.ts) — all removed rather than left as dead, misleading
    infrastructure. What's still live and unaffected: the classic
    `CustomField` splice mechanism itself (`readCustomFieldEdits`,
    `putCustomFields`, `shapeModifyPayload`) — still exactly what powers the
    already-working Invoice/Estimate/PO custom field columns, untouched.
  - **One genuine, permanent bug fix survives from this investigation**:
    `shapeModifyPayload` used to read `__customFieldEdits` off the payload
    and silently discard it for every no-lines (list) entity — `Customer`,
    `Vendor`, `Transfer`, `TimeActivity`, any future list entity — because
    only the has-lines branch ever applied the splice. No existing entity
    happened to trigger it (transactions always have lines), but it was a
    live landmine for the next one that would. Fixed to splice onto the
    sparse patch too, pinned in `tests/batch-custom-fields.test.ts`'s
    "no-lines (sparse) entity" describe block, proven against the pre-fix
    behavior. Kept — this is real, general-purpose correctness, independent
    of Projects ever having custom fields.
- **Bulk Edit (`/batch/bulk-edit`) was deliberately NOT extended to
  Project** — moot now that there's no custom field to bulk-set, but also
  true for Class/Location/Email: its UI is built around TRANSACTION shape
  (`bulk-edit/search`'s query filters on `TxnDate`/`CustomerRef`, fields
  Customer/Project records don't have). The spreadsheet Update flow
  (download → edit → re-upload) is the supported path for bulk Project edits.
- **There are TWO unrelated things both called "Projects" in the QBO
  ecosystem** — don't conflate them if this comes up again:
  1. **Per-company sub-customer Projects** — what the `project` entity
     targets, reached via the public Accounting REST API.
  2. **QuickBooks Online ACCOUNTANT's practice-management Projects** — the
     firm-side tool an accounting practice (like Prime Accountax itself)
     uses to track its own engagements with clients. This is where the
     `Work_Project`/`Practice_Client` payload above was captured FROM — a
     different screen than a connected client's own company Projects
     feature, though it turned out both ultimately store their rich data
     the same way (ground truth #3 above covers both).

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
