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

### 🔴 BLOCKER — money is stored as single-precision float in 51 columns

`real` is a 4-byte IEEE-754 float with roughly 7 significant decimal digits.
Demonstrated against a live Postgres, not argued from theory:

| Expression | Result |
|---|---|
| `2967704.55::real` | **`2.9677045e+06`** — the 55 cents is gone |
| `99999999.99::real` | **`1e+08`** — a cent short of €100m becomes exactly €100m |
| `sum` of 10,000 × `0.07::real` | **`700.0593`**, not `700.00` — drift **`0.059`** |

The first row is not hypothetical: **€2,967,704.55 is the order of magnitude of
the paying client's own AR total.** It cannot be stored exactly in the column
that holds it.

This fails the brief's Step 3.9 assertion outright — cumulative rounding drift
is **not** zero, and it grows with row count.

**Where it bites, and where it does not.** The native GL is correct:
`journal_lines` uses `numeric(14,2)`. It is the **provider mirror** that is
float — `invoices.total`, `invoices.paid`, `invoices.qbo_balance`,
`ap_bills.balance`, `payments.total_amount`, and critically
`payment_applications.amount_applied`, which feeds `lib/ar-aging.ts`. So every
AR/AP figure a connected customer sees today is computed from floats.

**Severity: Blocker for native go-live and arguably already a live defect.**

**Proposed remediation — needs approval before I touch it.** Convert the money
columns from `real` to `numeric(14,2)`.

- Postgres can do this in place: `ALTER TABLE … ALTER COLUMN … TYPE numeric(14,2)`.
- It **rewrites the table** and takes an ACCESS EXCLUSIVE lock. On `invoices`
  and `ap_bills` at this client's row counts that is seconds, not minutes — but
  it is **not zero-downtime** and must be scheduled.
- It is **not a clean round-trip**: values already corrupted by float storage
  (the lost 55 cents) cannot be recovered by the migration. They have to be
  re-synced from QBO afterwards, which for a read-only mirror is safe and is
  the natural repair.
- Drizzle's `schema.ts` types change with it (`real()` → `numeric()`), and
  Drizzle returns `numeric` as a **string** — so every read site needs a
  `Number()` or a decimal type. That is the largest part of the work and the
  part most likely to introduce a regression.

**Recommended sequencing:** convert `payment_applications.amount_applied`,
`invoices.*` and `ap_bills.*` first (they drive every reported figure), on a
Neon branch, with the reconcile suite green before and after.

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
