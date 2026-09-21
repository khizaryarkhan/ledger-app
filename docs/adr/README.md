# Architecture Decision Records

Short records of decisions that shaped this system, written **after the fact**
from evidence in the code, comments, tests and commit history. None of these
were written at the time the decision was made.

Each record marks its rationale:

- **[EVIDENCED]** — the reasoning is stated in the repository (a code comment, `CLAUDE.md`, a test's purpose, a commit message).
- **[INFERRED]** — the decision is visible in the code but its reasoning is not written down anywhere; the "why" here is a reconstruction.

| # | Decision | Rationale |
|---|---|---|
| [0001](0001-serverless-monolith-on-vercel-and-neon.md) | Serverless modular monolith on Vercel + Neon | [INFERRED] |
| [0002](0002-no-transactions-compensating-writes.md) | Live without database transactions | [EVIDENCED] |
| [0003](0003-immutable-reversal-only-ledger.md) | An immutable, reversal-only general ledger | [EVIDENCED] |
| [0004](0004-database-revalidated-authorisation.md) | Re-derive authorisation from the database on every request | [EVIDENCED] |
| [0005](0005-dates-are-strings.md) | A date-only value is a string, never a `Date` | [EVIDENCED] |
| [0006](0006-unit-tests-only-plus-production-smoke.md) | Unit tests with no database, plus a production smoke test | [EVIDENCED] |
| [0007](0007-mirror-providers-do-not-post-them.md) | Mirror provider transactions; do not post them to our ledger | [EVIDENCED] |
