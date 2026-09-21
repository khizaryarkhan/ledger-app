# ADR 0007 — Mirror provider transactions; do not post them to our ledger

- **Status:** Accepted, with a planned successor that is built but not in force
- **Rationale:** [EVIDENCED] — stated in `CLAUDE.md`'s accounting invariants and enforced by `tests/architecture.test.ts`.
- **Last verified against:** commit `3eec3df` (2026-09-17)
- **Primary sources:** `lib/qbo-sync.ts`, `lib/accounting/documents.ts`, `lib/accounting/qbo-gl.ts`, `lib/accounting/financials.ts`, `lib/ar-aging.ts`, `tests/architecture.test.ts`, `CLAUDE.md`

## Context

Most organisations keep their books in QuickBooks Online or Xero. The app
mirrors their customers, invoices and payments so it can run collections. It
also has its own general ledger, for organisations that want to keep books in
the app. The question is what happens when both exist.

## Decision

**Mirrored provider transactions are not posted to our general ledger.** Their
ledger lives in the provider; posting ours would double-count. They live in
mirror tables (`invoices`, `payments`, `payment_applications`, `ap_bills`).

**Native documents post to the GL first**, then `bridgeNativeInvoice` /
`bridgeNativeBill` mirror them *into* the receivables and payables tables so
collections and aging see them.

**Any financial statement shown to anyone comes from our own `journal_lines`.**
`lib/accounting/financials.ts` must stay computable with no network at all —
that is what makes it ours rather than a proxy. The one sanctioned use of
QuickBooks' own `TrialBalance` report is `lib/accounting/qbo-gl-verify.ts`,
proving an ingested ledger matches their books account by account before
anything reads from it. It is a test fixture reached from the CLI, never from
the app. `tests/architecture.test.ts` enforces both halves, and each guard has
been proven to fail on a real violation.

## Consequences

- **Two settlement graphs.** `transaction_links` (native, `numeric`, keyed on `journal_entries.id`) and `payment_applications` (QuickBooks mirror, `real`, keyed on `invoices.id` plus the raw QBO id). They are bridged on the **read** side by `lib/ar-aging.ts` and `linksForAny()`; joining them means going through `invoices.journal_entry_id`. Unification onto `transaction_links`, with `payment_applications` as a compatibility view, is the next planned step.
- **A QuickBooks organisation's native trial balance is empty.** `/reporting/trial-balance` is a QuickBooks passthrough and is currently the only trial balance such an organisation can see. Leave it until the native one reconciles — removing it first takes away a working report and gives nothing back.
- **The QuickBooks mirror is header-only.** `invoices` carries no line detail and no raw payload, so a general ledger cannot be built by transforming what is already held. Every transaction must be re-read from QuickBooks in full. That is the real scope of the successor.

## The successor: built, not wired

`lib/accounting/qbo-gl.ts` maps 12 posting entities as **pure** functions (no
database, no network), so money-path logic is provable in tests.
`ingestOrgTransactions` writes real `journal_entries` and `journal_lines` and no
mirror table — but it is called only from `scripts/qbo-gl-ingest.ts`, and a test
pins it there. Nothing in the running system reads it, so a paying client is
unaffected whether it runs or not.

Three rules from that work are worth carrying forward regardless:

1. **Never drop a line.** Every QuickBooks transaction is internally balanced, so a dropped line unbalances the entry, `postJournalEntry` rejects it, and the ledger silently gains a hole. Unresolvable accounts go to a Suspense account instead — created **on demand**, never seeded, so it does not appear in every organisation's chart of accounts.
2. **Refuse to plug an imbalance over five cents.** Absorbing a real gap makes the books balance *and* be wrong.
3. **"Decided to skip" must stay distinguishable from "forgot".** `QBO_NON_POSTING` names Estimate, PurchaseOrder and TimeActivity explicitly, and `mapQboTransaction` throws on an unknown entity.

**When the ingestion is finally wired into the live sync,
`tests/architecture.test.ts` is the thing to update — deliberately, in the same
commit.** An open decision blocks it: the history cutoff (see
[11-risks-debt-and-open-questions.md](../11-risks-debt-and-open-questions.md),
question 1).
