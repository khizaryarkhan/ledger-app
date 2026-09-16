# QBO → Native Accounting: Data Integrity Audit

**Status: Step 0 gate — three decisions needed before remediation code is written.**
**Date:** 2026-09-16 · **Method:** source + migration inspection only (see *Limits* below).

---

## 0. Limits of this audit — read first

Two things the brief asks for **could not be done in this environment**, and no
part of this document should be read as if they were:

| Asked for | Status | Why |
|---|---|---|
| "Read the code and **the actual database**" | **Not done** | No `.env.local`, no `DATABASE_URL`. Only `db/schema.ts` + `db/migrations/*.sql` were inspected. Per CLAUDE.md, a local DB would be unreliable evidence anyway ("`.env.local` can be many migrations behind production"). |
| Step 4 — sync a QBO sandbox and reconcile 9 reports to 0.00 | **Not run** | `quickbooks.api.intuit.com` is unreachable from here (curl → `000`), and there are no Intuit credentials. |

**Step 4 is the acceptance gate and it has not been passed.** Everything below
is static analysis. It can prove a gap exists; it cannot prove its absence.
Where a finding needs the sandbox to confirm, it says so.

---

## Step 0 — Blocking ambiguities

### Q1. For a QBO-connected user, is native a read-only mirror, bidirectional, or a migration target?

**The code currently does all three, in different places.** This is the ambiguity.

| Direction | Where | What moves |
|---|---|---|
| QBO → native (mirror) | `lib/qbo-sync.ts`, `lib/qbo-ap-sync.ts` | Customer, Invoice, CreditMemo, Payment, RefundReceipt, JournalEntry, Deposit, Purchase, Estimate, Account, Vendor, Item, TaxRate, Bill |
| QBO → native (**GL**) | `lib/accounting/qbo-ingest.ts` | 12 posting entities → `journal_entries`/`journal_lines` |
| native → QBO (**write-back**) | `lib/po-push.ts` | Purchase Orders, created in QBO, external id stored back |
| native → QBO (**bulk write**) | `lib/batch/**` (Data Studio) | ~32 entity types, import/update/delete |

The GL ingestion is **shadow-only and unwired** — `ingestOrgTransactions` is
called from `scripts/qbo-gl-ingest.ts` and nowhere else (verified by
tree-wide grep). CLAUDE.md states this too. So today: **a full sync puts
nothing in the GL, and a QBO org's native Trial Balance is empty.**

**Decision needed.** These three postures need different machinery:

- **Read-only mirror** — QBO always wins; native is a reporting projection.
  `po-push` and Studio's QBO writes are then *outside* the mirror and need an
  explicit "these are the only write-backs" boundary + a test asserting it.
- **Bidirectional** — needs conflict resolution that does not exist anywhere in
  the tree: no `updated_at` comparison, no vector clock, no last-writer rule.
  The mirror currently overwrites unconditionally on `Metadata.LastUpdatedTime`.
- **Migrate-off** — needs a cutover date, an opening-balance journal at that
  date, and a switch that stops the sync. None exist.

I recommend **read-only mirror + explicit migrate-off event**, because it is
closest to what is built and the only one that does not require inventing
conflict resolution. **I have not assumed it.**

### Q2. Does a Studio bulk import by a QBO-connected user write native, or push back to QBO?

**Answered by the code, unambiguously: QBO/Xero only. Never native.**
`lib/batch/**` contains no reference to `postDocument`, `postJournalEntry` or
`journalEntries` (verified by grep). Every write goes through
`lib/batch/commit-one.ts` → `qboPost`/`qboBatch`.

**Consequence, and it is a launch blocker for native mode:** for an org with no
QBO/Xero connection, Data Studio has nothing to write to. The brief's
requirement — "must work identically for native, QBO-connected, and
Xero-connected users" — is **not met today, for the native case, at all.**
This is not a bug to fix; it is a module that does not exist for native.

### Q3. System of record for the chart of accounts, per mode?

| Mode | Writer | Conflict |
|---|---|---|
| QBO-connected | `lib/qbo-ap-sync.ts` syncs `Account` → `accounts.external_id` | — |
| Native | `lib/accounting/system-accounts.ts` (`ensureSystemAccounts`) + `POST /api/accounts/seed` | — |
| **Both at once** | **Undefined** | A QBO org that also has native system accounts seeded (Inventory Asset, COGS, GR/IR, Job Work clearing, Suspense) now has accounts QBO has never heard of. |

The manufacturing feature set *requires* those native-only accounts. So a
QBO-connected manufacturing org necessarily has a chart of accounts that is a
**superset** of QBO's. A Trial Balance reconciliation against QBO will
therefore show those accounts as unmatched **by design** — which must be an
explicit, named exclusion in the reconciliation, not a variance to chase.

**Decision needed:** are native-only accounts (a) permitted and excluded from
reconciliation, (b) pushed up to QBO so both sides agree, or (c) forbidden for
QBO-connected orgs — which would mean manufacturing is native-only?

---

## Step 1 — Inventory

### Entity coverage

| QBO entity | Mirrored (AR/AP tables) | Mapped to GL | Notes |
|---|---|---|---|
| Account | ✅ `qbo-ap-sync` | n/a (is the CoA) | |
| Customer | ✅ `qbo-sync` | n/a | sub-customers resolved via `topLevelId()` recursion |
| Vendor | ✅ `qbo-ap-sync` | n/a | |
| Item | ✅ `qbo-ap-sync` | n/a | |
| TaxRate | ✅ `qbo-ap-sync` | n/a | |
| Invoice | ✅ | ✅ `mapQboInvoice` | |
| CreditMemo | ✅ | ✅ | |
| Payment | ✅ | ✅ | |
| RefundReceipt | ✅ | ✅ | |
| Deposit | ✅ | ✅ | |
| Purchase | ✅ | ✅ | |
| JournalEntry | ✅ | ✅ | |
| Estimate | ✅ | — (declared non-posting) | correct |
| Bill | ✅ `qbo-ap-sync` | ✅ | |
| SalesReceipt | ❌ **not mirrored** | ✅ | GL-only |
| BillPayment | ❌ **not mirrored** | ✅ | GL-only |
| VendorCredit | ❌ **not mirrored** | ✅ | GL-only |
| Transfer | ❌ **not mirrored** | ✅ | GL-only |
| PurchaseOrder | ❌ | — (declared non-posting) | correct |
| TimeActivity | ❌ | — (declared non-posting) | correct |
| **InventoryAdjustment** | ❌ | ❌ **neither mapped nor declared** | **see F-2** |
| **Attachable** | ❌ | ❌ | never synced |
| Class / Department | partial (`ap_dimensions`) | not on GL lines from QBO | |
| Term / PaymentMethod / TaxAgency / CustomField / Employee | ❌ | ❌ | |
| Currency / ExchangeRate | on txn only | `fx_debit`/`fx_credit` exist | untested end-to-end |

### API version

**Inconsistent.** `minorversion=65` in `lib/qbo-sync.ts` and friends (9 sites);
`minorversion=73` in `lib/batch/qbo-client.ts`. Two versions of the same API in
one product is a latent behaviour difference — QBO changes field semantics
between minor versions.

### Sync mechanics

- **Incremental** via `Metadata.LastUpdatedTime >= ts` (`qboFetchAllSafe`), full
  sync via no filter. No CDC endpoint use.
- **Pagination** `STARTPOSITION`/`MAXRESULTS 500`, 300ms sleep between pages.
- **Rate limiting** documented for the Batch endpoint (40/min/realm) with a
  cross-job semaphore; the *sync* path uses a fixed sleep only.
- **DB write batching** `runBatched(..., 25)` — neon-http opens one HTTP
  connection per query, and unbounded `Promise.all` killed a 4,000-invoice sync.
- **Idempotency** exists **only for the GL path** — migration `0086` adds a
  partial unique index on `(org_id, external_source, external_id)` where
  `external_id IS NOT NULL`. **The mirror tables have no equivalent.**

---

## Step 2 — Mapping matrix (entity level; field level needs the sandbox)

Status legend: Mapped / Partial / Unmapped / **Lossy** / n/a.

| Area | Status | Evidence |
|---|---|---|
| Invoice header → `journal_entries` | Mapped | `mapQboInvoice` |
| Invoice **lines** → `journal_lines` | Mapped (GL) / **Unmapped (mirror)** | CLAUDE.md: "the QBO mirror is HEADER-ONLY — `invoices` has no line detail and no raw payload" |
| Discount / subtotal / markup lines | **Unverified** | needs sandbox fixtures |
| Automated sales tax vs manual override | **Unverified** | `mapQboInvoice` handles `TxnTaxDetail`; behaviour under AST unproven |
| `LinkedTxn` (payment→invoice, credit application, bill→PO) | **Partial / split** | two graphs: `transaction_links` (native, `numeric`) and `payment_applications` (QBO, `real`, raw-QBO-id keyed). Keyed on *different ids* for the same invoice — join via `invoices.journal_entry_id`. |
| Over-payment / unapplied | Partial | `payments.unapplied_amount` exists (`real`) |
| SyncToken | Mapped (GL) | `journal_entries.external_sync_token`, drives `ingestDecision` |
| Void vs delete | **Partial** | `invoices.deleted_at` = soft delete (QBO deletion). Void handling unverified. |
| Multi-currency | Partial | `journal_lines.fx_debit/fx_credit` `numeric(14,2)`; `exchange_rate` is `real` |
| Money precision | **LOSSY — see F-1** | |

---

## Step 3 — Integrity findings

### F-1 · **BLOCKER** · Money is stored as `real` (float4) across the AR/AP/mirror schema

`db/schema.ts` declares **49** money-ish columns as Drizzle `real`, which emits
Postgres `real` = **float4, single precision, ~7 significant decimal digits**.
Confirmed in `0000_curvy_steel_serpent.sql` (`"total" real`, `"paid" real`,
`"amount" real`).

Affected includes: `invoices.amount / tax_amount / total / paid / qbo_balance`,
`payments.total_amount / unapplied_amount / exchange_rate`,
`payment_applications.amount_applied`, `ap_bills` totals, all
`trade_documents` / line totals, `invoice_promises.amount`.

**Why this is a blocker, not a nit.** float4 gives ~7 significant digits. A
balance of `€2,713,188.45` needs 9. Cents are **not representable** at that
magnitude — the value silently rounds. Step 3.9 of the brief ("assert
cumulative rounding drift = 0") **cannot pass** against these columns, and no
amount of application-side rounding fixes a storage type that cannot hold the
value.

The GL itself is correct — `journal_lines.debit/credit` were moved to
`numeric(14,2)` in migration `0023`. **So the ledger is sound and the mirror
that feeds every AR report is not.** Any tie-out between them will disagree at
scale, and the disagreement will look like a mapping bug.

*Fix:* `ALTER TABLE … ALTER COLUMN … TYPE numeric(14,2)`. Reversible, but a
rewrite lock on large tables → **needs approval and a maintenance window**.
Not written yet, per the rules.

### F-2 · **HIGH** · `InventoryAdjustment` is in neither bucket

`QBO_MAPPERS` has 12 entities; `QBO_NON_POSTING` names
Estimate/PurchaseOrder/TimeActivity. `InventoryAdjustment` appears in neither,
and `mapQboTransaction` **throws** on an unknown entity. By the file's own
stated standard — "decided to skip must stay distinguishable from forgot" —
this is in the *forgot* bucket. It is also the entity that moves inventory
value, i.e. exactly what a manufacturing-bound product cannot lose.

It is not in `INGEST_ENTITIES` either, so today it is silently never scanned
rather than loudly rejected.

### F-3 · **HIGH** · The mirror has no idempotency constraint

`0086` protects `journal_entries` only. `invoices`, `payments`,
`payment_applications`, `ap_bills` have no unique index on
`(org_id, source, external_id)`. Re-running a full sync relies on
application-level check-then-update. Step 3.4 ("running a full sync twice
produces zero duplicates") is **unproven** and, given `runBatched` concurrency
of 25, a race is plausible.

### F-4 · **HIGH** · Data Studio has no native write path

See Q2. `lib/batch/**` writes only to QBO/Xero. Native-mode Studio does not
exist.

### F-5 · **MEDIUM** · Two API minor versions in one product (65 / 73).

### F-6 · **MEDIUM** · Customer/Account **merge** is untested

Step 3.5 calls merges "a common silent corruption source". `topLevelId()`
resolves sub-customer parents but nothing handles a QBO merge event (the losing
id disappears). No test exists. Needs the sandbox to prove either way.

### F-7 · **LOW / credit** · The parties migration did *not* lose referential integrity

Worth recording because it looks like a risk and isn't: `0079_unify_parties.sql`
dynamically drops every FK pointing at `customers`/`ap_suppliers` and recreates
21 against `parties(id)` — a superset of the 19 that historically existed. No FK
was lost. (`customers`/`ap_suppliers` are now **views**; a *new* FK must target
`parties(id)`.)

### Verified-good

- **Double-entry is enforced at the writer.** `lib/ledger.ts` rejects
  `|Σdr − Σcr| > 0.005` before writing (`postJournalEntry`).
- **Mirrored entries are replaced, not duplicated**, guarded by the `0086`
  partial unique index.
- **Suspense (`1999`) is created on demand**, not seeded into every org's CoA.

---

## Prioritised remediation plan

| # | Item | Severity | Blocks native go-live? | Est. |
|---|---|---|---|---|
| 1 | Decide Q1/Q2/Q3 | — | **Yes** | your call |
| 2 | F-1 money → `numeric(14,2)` + backfill + read-path audit | Blocker | **Yes** | 3–5 d + window |
| 3 | F-4 Studio native write path (or scope it out of native launch) | Blocker | **Yes** | 5–10 d |
| 4 | F-2 `InventoryAdjustment`: map it, or declare it non-posting | High | Yes | 1–2 d |
| 5 | F-3 unique indexes on mirror tables + dupe backfill check | High | Yes | 2 d |
| 6 | Step 4 reconciliation harness + sandbox company | — | **Yes (it is the gate)** | 5–8 d |
| 7 | F-5 single minorVersion | Medium | No | 0.5 d |
| 8 | F-6 merge tests | Medium | No | 2 d |

**Nothing above has been implemented.** Items 2 and 5 are schema migrations,
which the brief requires be approved before shipping; item 1 gates the rest.

## Step 7 — Manufacturing readiness (gap analysis only)

Mirroring QBO's shape has **not** constrained the inventory model much, because
that model was built native-first: `inventory_lots` (FIFO cost layers),
`inventory_movements`, `boms`, `production_runs`, `job_work_orders`,
`goods_receipts` with a GR/IR clearing account. QBO has none of these and they
do not try to round-trip.

The real constraints are:

1. **F-1 again** — `real` on `trade_documents` and inventory line totals.
   Standard-cost variance and landed cost are *differences of differences*;
   float4 makes them noise.
2. **No multi-warehouse dimension.** `inventory_lots` has no location column;
   `ap_dimensions` carries Class/Location as *accounting* dimensions, not stock
   locations. Adding `location_id` to lots/movements later means rewriting every
   FIFO query — cheaper now.
3. **No lot/serial distinction.** A lot is a cost layer that happens to carry a
   lot number. Serial tracking (qty-1 lots) would work but scale badly.
4. **WIP is an account, not a state.** `WorkInProgress` is an `apItems.productType`;
   there is no WIP *balance per order*. Planned-vs-actual costing needs one.

Recommend (do not implement): add `location_id` to `inventory_lots` /
`inventory_movements` now, nullable, defaulted to a single implicit location.

---

## What I need from you

1. **Q1** — mirror, bidirectional, or migrate-off?
2. **Q2** — does native-mode Studio ship, or is it explicitly out of scope for launch?
3. **Q3** — native-only accounts on a QBO org: permit+exclude, push up, or forbid?
4. **Approval** for the F-1 migration (table rewrite, needs a window) before I write it.
5. **A QBO sandbox realm + credentials**, or confirmation that Step 4 runs elsewhere —
   without it the acceptance gate cannot be executed by me at all.
