# ADR 0005 — A date-only value is a string, never a `Date`

- **Status:** Accepted (2026-09-17)
- **Rationale:** [EVIDENCED] — the incident, the diagnosis and the rule are all recorded in `CLAUDE.md` and in `lib/format.ts`.
- **Last verified against:** commit `3eec3df` (2026-09-17)
- **Primary sources:** `lib/format.ts`, `tests/date-display.test.ts`, `tests/architecture.test.ts`, `db/schema.ts`, `lib/statement-pdf.ts`, `CLAUDE.md`

## Context

A client reported that QuickBooks showed an invoice due **15 Sep 2026** while
the app showed **14 Sep 2026**. Their standard, now adopted: *"If it is because
of the timezone difference — this should not happen. A date is the date."*

The stored data was never wrong. `invoices.due_date` is a `varchar(16)` holding
the literal `"2026-09-15"`, copied verbatim from QuickBooks by `lib/qbo-sync.ts`
— no `Date` object touches the write path. The defect was entirely in rendering:
**`new Date("2026-09-15")` is parsed by ECMAScript as UTC midnight**, and every
formatter then read it back with local getters. Anywhere west of Greenwich that
is the previous day, so for a US client *every* date-only field read one day
early. It never reproduced in-house because Vercel and the team's machines run
on or east of UTC.

## Decision

1. **Store date-only values as `YYYY-MM-DD` strings**, copied verbatim from the source.
2. **`lib/format.ts` is the single rendering rule.** `dateParts()` detects a date-only shape and reads the components **literally, never building a `Date`**. `formatDate`, `formatDateShort`, `formatDateLong`, `formatDateUS`, `formatDateUSLong`, `fmt.date` and `fmt.shortDate` all go through it.
3. **Never hand-roll `.toLocaleDateString()`** on a due, invoice, transaction or promise date — that is exactly how the bug spread to a dozen components.
4. **`+ "T00:00:00Z"` is not the fix — it is the same bug.** It names the identical instant and still renders locally. Three components carried it. (`+ "T00:00:00"` without the `Z` *is* local midnight and happens to be correct, but nobody should have to work out which of the two they wrote, so both are gone.)

## Scope of the detector — deliberately narrow

A bare `YYYY-MM-DD`, or one with an explicit **midnight** time (a `date` column
serialises through JSON as `"2026-09-15T00:00:00.000Z"`, which is still a
calendar date). A timestamp with a real time — `created_at`, `sent_at` — stays
on the `Date` path, because `2026-09-16T02:00:00Z` genuinely *is* the evening of
the 15th in New York. Widening the detector would introduce a new off-by-one in
the opposite direction.

## Consequences

- Server-rendered documents (`lib/statement-pdf.ts`, `lib/approval-pdf.ts`) no longer depend on where the process runs. These are documents a debtor or an approver receives — the worst place for a date to be a day out.
- `tests/date-display.test.ts` asserts every formatter across seven timezones spanning UTC−8 to UTC+14, including a half-hour offset and DST boundaries. It was **proven to fail on the old implementation** with the exact reported symptom, `expected '14 Sep 2026' to be '15 Sep 2026'`.
- `tests/architecture.test.ts` guards the `T00:00:00Z` form — and that guard found six offenders the manual sweep had missed.
- A related rule follows: anything compared against an invoice or due date must use `localToday()`, never `today()` (which is UTC and shifts the day either side of Greenwich).
- `mobile/src/format.ts` already pinned both parse and render to UTC and was correct. If you add a date renderer anywhere, import the web helper or match the mobile one's intent — do not invent a third rule.
