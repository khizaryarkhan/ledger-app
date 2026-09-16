# QBO → Native Accounting Data Integrity Audit

**Status: Step 0 complete, Step 1 partial. Not yet an acceptance gate.**
Started 2026-09-16. Every finding below was taken from the code or a live
database query, never from QBO's documentation alone. Where a fact could not be
verified it says so.

---

## Step 0 — Blocking ambiguities (RESOLVED)

Three questions were put to the product owner and answered. They are recorded
here because every later step depends on them.

### 1. What is the native DB for a QBO-connected org?

**Decision: a read-only mirror, permanently.** QBO stays the book of record; the
native GL is a derived copy that may be replaced wholesale on re-sync. Native
mode remains the system of record only for orgs with no provider connected.

*Code as found:* one-way already, and no path exists to change that. Only
`lib/batch/*` writes to QuickBooks — **no AR/AP management action writes back**.
Stages, promises, disputes and communications are local-only state layered on
the mirror. There is no "disconnect and go native" flow anywhere.

*Consequence:* no conflict resolution is needed, and idempotency reduces to
"replace by external id", which is what `lib/accounting/qbo-ingest.ts` already
does. This is the cheapest of the three options by a wide margin.

### 2. Studio bulk import for a connected org — native or push-back?

**Decision: add a native write path.** Native orgs post through
`postDocument`/`postJournalEntry`; QBO/Xero orgs keep pushing to their provider
unchanged. Explicitly NOT dual-write.

*Code as found:* **Studio has no native mode at all.** Every route gates on a
provider token and returns *"QuickBooks is not connected for this
organisation"*; there are zero references to native anywhere in `lib/batch`. So
the brief's premise — "must work identically for native, QBO-connected and
Xero-connected users" — is not met today. **This is a Blocker and it is a build,
not a fix:** every entity builder in `lib/batch/builders.ts` emits a QBO payload
shape, not our document shape.

### 3. Chart-of-accounts system of record

**Decision: QBO owns it while a provider is connected.** Native account
creation is to be refused for connected orgs; only our protected system
accounts may be injected, flagged as ours. Native orgs keep a fully editable
COA.

*Code as found:* **ambiguous — currently both, with no reconciliation.**
QBO-synced accounts carry `external_id`; `POST /api/accounting/accounts`
creates native accounts with `external_id` null in the same table for the same
org; the list endpoint returns "synced + native" together. `ensureSystemAccounts`
injects control accounts that may not exist in QBO. Nothing decides which wins.

---

## Step 1 — Inventory (partial)

### ⚠️ The local database is 8 migrations behind production

`drizzle.__drizzle_migrations` shows **78 applied locally**; the repo journal is
at **0086**. CLAUDE.md already records this failure mode — a stale local copy
holding real-looking data once produced a whole set of credible, wrong
reconciliation findings.

**Every count below must be re-taken against a Neon branch of production before
it is quoted as fact.** In particular the soft-delete inventory is certainly
wrong: it reports only `journal_entry_ar_lines.voided`, yet `invoices.deleted_at`
was added in migration 0083 and is in active use.

### Shape of the schema (local, 78 migrations)

| | |
|---|---|
| Base tables | 126 |
| Views | 3 (`customers`, `ap_suppliers`, + 1) |
| Foreign keys | 250 |
| Unique constraints | 67 |
| Check constraints | **2** |

Two check constraints across 126 tables is very low for a double-entry system.
No database-level guarantee exists that, for example, a journal line carries a
debit **or** a credit but not both — that rule lives only in
`lib/ledger.ts`'s `validateEntry`. Any writer that bypasses `postJournalEntry`
bypasses it entirely.

### Multi-tenant isolation

27 base tables have no `org_id`. Most are legitimately global (`organisations`,
`sessions`, `fx_rates`, `rate_limits`, `stripe_webhook_events`, `guide_pages`)
or belong to the admin CRM (`lead_*`, `crm_*`). Three warrant a decision rather
than an assumption: **`catalog_items`, `forecast_snapshots`,
`crm_field_values`** — a forecast snapshot with no tenant column is the kind of
thing that silently leaks one org's numbers into another's view.

### Idempotency (Step 3.4)

Better than expected. **14 unique indexes** cover an external id, including
`journal_entries (org_id, external_source, external_id) WHERE external_id IS NOT
NULL` added for the GL ingestion.

Gaps found — no unique index on the provider id:

- `parties.qbo_id` / `parties.xero_id` — the physical table behind the
  `customers` and `ap_suppliers` views. **A re-sync can duplicate a customer or
  supplier.**
- `projects.qbo_id` / `projects.xero_id`
- `purchase_orders.qbo_id` / `purchase_orders.xero_id`

---

## Findings

### 🔴 BLOCKER for native go-live — 🟢 LOW for ACC today — money stored as float

51 columns hold money as `real` (4-byte IEEE-754, ~7 significant digits).

**Correction to the first version of this document.** It demonstrated the problem
with the literal `2967704.55` and implied the paying client's AR total was being
mangled. That was over-stated: no single stored value is that large, and the
totals are not summed the way that demo implied. Measured properly below. The
finding is real; the severity for the live client is not what I first wrote.

#### What is actually stored

Individual values are stored to roughly 7 significant digits, so a float4 holding
`1000.01` is really `1000.01000977`. Across real synced data about half of all
money values are not exact cent figures:

| column | rows | not clean cents | max |
|---|---|---|---|
| `invoices.total` | 10,490 | 5,414 | 2.5e+06 |
| `invoices.paid` | 10,490 | 4,883 | 2.5e+06 |
| `invoices.qbo_balance` | 10,490 | 216 | 132,187 |
| `ap_bills.total` | 17,384 | 7,233 | 933,302 |
| `payments.total_amount` | 7,835 | 3,542 | 1.2e+06 |

At display precision each one still *renders* correctly. The error only shows up
in aggregate.

#### What the live client actually sees

Receivables totals are summed in **JavaScript** (`reduce`), which is float64, not
in SQL. Measured on two real orgs:

| org | rows | shown to user | exact | error |
|---|---|---|---|---|
| efab2493 | 6,776 | 2,696,073.69 | 2,696,073.704763 | **−€0.0148** |
| 11280fac | 3,700 | 1,459,798.70 | 1,459,798.698280 | **+€0.0017** |

**About 1.5 cents on €2.7m.** `fmt.money()` rounds to whole numbers for display,
so it is invisible in the product. **ACC is not exposed to a blocker here.**

The one place that *is* meaningfully worse is SQL aggregation, because
`sum(real)` accumulates in float4 (confirmed: `pg_typeof(sum(real)) = real`):
−€0.20 and −€0.10 on the same two orgs, roughly 10× the JS error. **The only such
aggregate over customer money is the platform-admin health page**
(`app/api/admin/customers/health/route.ts`), which no customer sees. Fixed in this
pass by casting to `numeric` before summing — no migration, no risk.

#### Why it is still a Blocker for native go-live

A general ledger has to tie exactly. "Off by two cents" fails the Step 4
zero-variance acceptance gate by definition, and the error is not stable — it
moves as rows are added, so a reconciliation that passes today can fail
tomorrow for no reason anyone can trace. The native GL itself is already correct
(`journal_lines` is `numeric(14,2)`); it is the provider mirror that is not.

#### Best practice, and the target

- **Never store money in a binary float.** `real`/`double precision` cannot
  represent most decimal fractions, and `sum()` compounds it.
- Two accepted designs: **`numeric`/`decimal`** (PostgreSQL's own recommendation,
  exact decimal arithmetic) or **integer minor units** (cents in a `bigint` —
  what most payment processors do; JS `Number` is exact for integers to 2^53, so
  no decimal library is needed).
- **Avoid PostgreSQL's `money` type** — locale-dependent and fixed-precision,
  which breaks multi-currency.
- Drivers return `numeric` as a **string** on purpose, because converting to a JS
  `Number` would reintroduce float64. Keep it a string or convert deliberately.
- Never aggregate in float, even over exact columns — cast first.

**Target for this codebase: `numeric(14,2)`**, not integer cents — `journal_lines`
already uses it, and a mixed model would be worse than either single choice.

#### Migration — still needs approval, but NOT urgent

Nothing here justifies rushing a table rewrite on a live client. Proposed order,
on a Neon branch first, with the reconcile suite green either side:
`payment_applications.amount_applied` → `invoices.*` → `ap_bills.*` → the rest.

- `ALTER TABLE … TYPE numeric(14,2)` rewrites the table under an ACCESS EXCLUSIVE
  lock. Seconds at this row count, but not zero-downtime.
- It cannot recover already-lost precision. **Because the mirror is read-only by
  decision, a re-sync from QBO afterwards restores exact values** — that is the
  safety net, and it is only available because of the Step 0 decision.
- The real regression risk is not the migration: Drizzle returns `numeric` as a
  string, so every read site needs deliberate conversion. That is the bulk of
  the work.

### 🟠 HIGH — Studio cannot serve native orgs at all

See Step 0 Q2. Blocks the stated launch requirement. Effort is a build across
every entity builder, not a patch.

### 🟠 HIGH — no unique index on `parties` provider ids

A re-sync can duplicate customers and suppliers. Cheap to fix (partial unique
index, same shape as `invoices`), but needs a duplicate sweep first — adding the
index will fail if duplicates already exist.

### 🟡 MEDIUM — only 2 check constraints across 126 tables

Double-entry invariants are enforced in application code only. Worth adding at
least: debit XOR credit on `journal_lines`, and non-negative amounts.

---

## Not yet started

| Step | Blocker to starting |
|---|---|
| 2 — field-level mapping matrix | none; next |
| 3 — integrity assertions as tests | partly written already for the GL mapping |
| 4 — reconciliation acceptance gate | **needs a QBO sandbox company with a year of data.** No Intuit credentials are available to this workstream, and production is off-limits by the brief's own rule. Cannot start. |
| 5 — module coverage | none |
| 6 — Studio import tests | blocked behind the Studio native build |
| 7 — manufacturing gap analysis | none |

---

## Honest assessment

The GL mapping work already in the tree (`lib/accounting/qbo-gl*.ts`, 12 posting
entities, 201 tests) is a real head start on Steps 2–4. But the float-money
finding means **the acceptance gate in Step 4 cannot pass as things stand** —
not because the mapping is wrong, but because the columns it is compared against
cannot represent the numbers. That has to be fixed before a zero-variance
reconciliation is even meaningful.
