const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/**
 * A date-only value is a CALENDAR DATE, not an instant — so it must never be
 * parsed with `new Date()`.
 *
 * This is the bug a client reported: QuickBooks showed an invoice due
 * 15 Sep 2026 and we showed 14 Sep 2026. Nothing was wrong with the data.
 * `invoices.due_date` is a `varchar` holding the literal "2026-09-15", copied
 * verbatim from QBO's `DueDate` — but every display path did
 * `new Date("2026-09-15")`, which ECMAScript parses as **UTC midnight**, and
 * then rendered it with local getters. Anywhere west of Greenwich that is the
 * previous day. The client is in the US, so every date-only field in the app
 * read one day early for them.
 *
 * Appending "T00:00:00Z" does NOT fix it — that is the same instant, still
 * rendered locally. (Several components did exactly that.) The only correct
 * handling is to never build a Date at all: read the YYYY-MM-DD components
 * literally, because a due date has no time and no timezone.
 *
 * Real timestamps (`created_at`, `sent_at`, a Date object) DO name an instant
 * and must still be shown in the viewer's timezone — so those keep the old
 * behaviour. The discriminator is the shape of the value, which is exactly
 * what distinguishes the two kinds in this schema.
 */
/*
 * Deliberately NARROW: a bare YYYY-MM-DD, or one with an explicit MIDNIGHT
 * time. Both carry no time-of-day information — a `date` column serialises
 * through JSON as "2026-09-15T00:00:00.000Z", so that form is a calendar date
 * too, and treating it as an instant is the same bug one layer along.
 *
 * It must NOT match a timestamp with a real time. "2026-09-16T02:00:00Z" IS an
 * instant: in New York that is the evening of the 15th, and showing it as the
 * 16th would be a new off-by-one in the opposite direction, introduced by the
 * fix for this one. Anything with a non-midnight time falls through to Date.
 */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ]00:00(?::00(?:\.0+)?)?Z?$)/;

type Parts = { day: number; month: number; year: number } | null;

function dateParts(d: string | Date | null | undefined): Parts {
  if (!d) return null;
  if (typeof d === "string") {
    const m = DATE_ONLY.exec(d.trim());
    // "2026-09-15" and "2026-09-15T00:00:00" alike: the date portion is taken
    // literally. A date-only string with a midnight time carries no more
    // information than the date, and treating it as an instant is what broke.
    if (m) return { year: +m[1], month: +m[2] - 1, day: +m[3] };
  }
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return null;
  return { day: dt.getDate(), month: dt.getMonth(), year: dt.getFullYear() };
}

/**
 * Format a date according to an org's chosen date format.
 * Supported formats:
 *   DD MMM YYYY  → 07 May 2026  (default)
 *   DD/MM/YYYY   → 07/05/2026
 *   MM/DD/YYYY   → 05/07/2026
 *   YYYY-MM-DD   → 2026-05-07
 *   MMM DD, YYYY → May 07, 2026
 */
export function formatDate(d: string | Date | null | undefined, format = "DD MMM YYYY"): string {
  const p = dateParts(d);
  if (!p) return "—";
  const day = p.day.toString().padStart(2, "0");
  const month = p.month;
  const year = p.year;
  const mm = (month + 1).toString().padStart(2, "0");
  switch (format) {
    case "DD MMM YYYY":  return `${day} ${MONTH_SHORT[month]} ${year}`;
    case "DD/MM/YYYY":   return `${day}/${mm}/${year}`;
    case "MM/DD/YYYY":   return `${mm}/${day}/${year}`;
    case "YYYY-MM-DD":   return `${year}-${mm}-${day}`;
    case "MMM DD, YYYY": return `${MONTH_SHORT[month]} ${day}, ${year}`;
    default:             return `${day} ${MONTH_SHORT[month]} ${year}`;
  }
}

/**
 * The shared short renderer: "15 Sep 2026". Timezone-safe for date-only
 * strings by construction, because it never builds a Date for them.
 *
 * Use this (or fmt.date) rather than hand-rolling `.toLocaleDateString()` on a
 * due/invoice/txn date — that is what drifted into nine components and
 * reproduced the off-by-one in each of them.
 */
export function formatDateShort(d: string | Date | null | undefined, opts?: { year?: boolean }): string {
  const p = dateParts(d);
  if (!p) return "—";
  const day = p.day.toString().padStart(2, "0");
  return opts?.year === false
    ? `${day} ${MONTH_SHORT[p.month]}`
    : `${day} ${MONTH_SHORT[p.month]} ${p.year}`;
}

const MONTH_LONG = ["January","February","March","April","May","June","July","August","September","October","November","December"];

/** "15 September 2026" — the long form used on approval PDFs. */
export function formatDateLong(d: string | Date | null | undefined): string {
  const p = dateParts(d);
  if (!p) return "—";
  return `${p.day} ${MONTH_LONG[p.month]} ${p.year}`;
}

/** "Sep 5, 2026" — US order, unpadded day. Used on the marketing blog. */
export function formatDateUS(d: string | Date | null | undefined): string {
  const p = dateParts(d);
  if (!p) return "—";
  return `${MONTH_SHORT[p.month]} ${p.day}, ${p.year}`;
}

/** "September 15, 2026" — US long form. Used on blog posts. */
export function formatDateUSLong(d: string | Date | null | undefined): string {
  const p = dateParts(d);
  if (!p) return "—";
  return `${MONTH_LONG[p.month]} ${p.day}, ${p.year}`;
}

/** Pick a sensible English locale for a given ISO 4217 currency code. */
function currencyLocale(ccy: string): string {
  if (ccy === "GBP") return "en-GB";
  if (ccy === "EUR") return "en-IE";
  if (ccy === "AUD") return "en-AU";
  if (ccy === "NZD") return "en-NZ";
  if (ccy === "SGD") return "en-SG";
  if (ccy === "ZAR") return "en-ZA";
  if (ccy === "NOK" || ccy === "DKK" || ccy === "SEK") return "en-US"; // use US formatting for Scandinavian currencies
  return "en-US"; // USD, CAD, CHF, AED, etc.
}

// ── Number display rules (set 2026-09-21) ─────────────────────────────────
//
// MONEY   minimum 2 decimals, up to 6, trailing zeros beyond the 2nd stripped.
// QTY     up to 5 decimals, no padding at all.
//
// The two instructions behind this — "at least N decimals" and "no trailing
// zeros" — pull against each other, and the resolution differs by kind because
// the kinds differ:
//
//   money  100      -> 100.00      the 2 is a FLOOR: currency always shows cents
//          1234.5   -> 1,234.50
//          1.234500 -> 1.2345      zeros beyond the floor are stripped
//          1.234567 -> 1.234567    unit costs are numeric(18,6); show what is there
//
//   qty    10       -> 10          no floor: a count of ten is "10", not "10.00000"
//          10.5     -> 10.5
//          10.12345 -> 10.12345
//
// This REVERSES the previous rule, which this file and CLAUDE.md both recorded
// as deliberate: fmt.money rounded to whole numbers "for scannability". That
// was overruled — an accounting product that hides cents is not scannable, it
// is wrong. num2 existed only to work around it and is now an alias.
const MONEY_MIN_DP = 2;
const MONEY_MAX_DP = 6;   // matches the widest money column, numeric(18,6)
const QTY_MAX_DP = 5;

/**
 * A value that is not zero must never print as zero.
 *
 * `maximumFractionDigits` rounds, so 0.000001 formats as "0" — which tells the
 * reader there is no stock when there is some. Rare, but it is a lie rather
 * than an imprecision, so it gets its own branch.
 */
function tinyButNotZero(n: number, maxDp: number): string | null {
  if (n === 0 || !isFinite(n)) return null;
  if (Math.abs(n) >= Math.pow(10, -maxDp) / 2) return null;
  return n > 0 ? `<${Math.pow(10, -maxDp)}` : `>-${Math.pow(10, -maxDp)}`;
}

export const fmt = {
  money: (n: number | null | undefined, ccy = "EUR") => {
    if (n == null || isNaN(n)) return "—";
    // Guard against invalid/placeholder currency codes (e.g. "?") which throw RangeError
    const safeCcy = /^[A-Z]{3}$/.test(ccy ?? "") ? ccy : "EUR";
    try {
      return new Intl.NumberFormat(currencyLocale(safeCcy), {
        style: "currency", currency: safeCcy,
        minimumFractionDigits: MONEY_MIN_DP,
        maximumFractionDigits: MONEY_MAX_DP,
      }).format(n);
    } catch {
      return `${safeCcy} ${fmt.num2(n)}`;
    }
  },
  /**
   * Money with no currency symbol — ledger and report columns where the
   * currency is stated once in a header. Same decimal rule as `money`, so a
   * figure does not change shape depending on which column it lands in.
   */
  num2: (n: number | string | null | undefined) =>
    Number(n ?? 0).toLocaleString(undefined, {
      minimumFractionDigits: MONEY_MIN_DP,
      maximumFractionDigits: MONEY_MAX_DP,
    }),
  /** Quantity — up to 5 decimals, never padded. */
  qty: (n: number | string | null | undefined) => {
    const v = Number(n ?? 0);
    if (isNaN(v)) return "—";
    return tinyButNotZero(v, QTY_MAX_DP)
      ?? v.toLocaleString(undefined, { maximumFractionDigits: QTY_MAX_DP });
  },
  // Always includes year — use formatDate(d, orgSettings.dateFormat) for org-specific format.
  // Goes through formatDateShort, so a YYYY-MM-DD due date is rendered as the
  // date it literally is, not as a UTC instant re-read in the viewer's zone.
  date: (d: string | Date | null | undefined) => formatDateShort(d),
  // Short date — now includes year for clarity
  shortDate: (d: string | Date | null | undefined) => formatDateShort(d),
  relative: (d: string | Date | null | undefined) => {
    if (!d) return "—";
    const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 0) return `in ${Math.abs(days)}d`;
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
  },
};

/**
 * Whole CALENDAR days a date is in the past. Positive = overdue, 0 = today.
 *
 * This used to be `Math.floor((Date.now() - new Date(dueDate)) / 86400000)`,
 * which mixed two different clocks: `new Date("2026-09-14")` parses as UTC
 * midnight, while `Date.now()` is the current instant. The answer therefore
 * depended on the TIME OF DAY as well as the date, so east of Greenwich every
 * invoice was misclassified for the first hour after local midnight — "Due
 * Today" reading as "Due Soon", and genuinely overdue invoices reading as due
 * today. On a collections board that is the difference between chasing and not.
 *
 * Both sides are now reduced to a calendar date first and differenced as whole
 * days, so the result changes only when the date changes. Comparing the two as
 * UTC midnights makes the subtraction exact and immune to DST, while the dates
 * themselves come from the viewer's local calendar via localToday().
 */
export const daysOverdue = (dueDate: string | null | undefined) => {
  if (!dueDate) return 0;
  const due = String(dueDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return 0;
  return Math.round((ymdToUtcMs(localToday()) - ymdToUtcMs(due)) / 86400000);
};

/** A YYYY-MM-DD as UTC midnight — a stable anchor for whole-day arithmetic. */
const ymdToUtcMs = (s: string) =>
  Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));

export const getDueStatus = (inv: any) => {
  if (inv.paymentStatus === "Paid") return "Paid";
  if (inv.paymentStatus === "Written Off") return "Written Off";
  const d = daysOverdue(inv.dueDate);
  if (d > 0) return "Overdue";
  if (d === 0) return "Due Today";
  if (d >= -7) return "Due Soon";
  return "Not Due";
};

/** Local YYYY-MM-DD (never toISOString — that shifts the day across timezones). */
export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Last day of the current week (Sunday) and of the current month, inclusive. */
const endOfWeekYmd = () => { const d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); return ymd(d); };
const endOfMonthYmd = () => { const d = new Date(); return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };

/**
 * Due-date filter options. "Due This Week"/"Due This Month" are CALENDAR
 * windows (through Sunday / through month end), deliberately not rolling ones:
 * "Due Soon" already means "within 7 days", so a rolling week would just
 * duplicate it.
 *
 * The board variant drops Paid/Written Off — it only ever shows open AR, so
 * offering them there would be two filters that always return nothing.
 */
export const DUE_FILTERS = ["Not Due", "Due Soon", "Due Today", "Due This Week", "Due This Month", "Overdue", "Paid", "Written Off"];
export const DUE_FILTERS_OPEN = ["Not Due", "Due Soon", "Due Today", "Due This Week", "Due This Month", "Overdue"];

/**
 * Unlike getDueStatus, which puts an invoice in exactly one bucket, the two
 * calendar windows OVERLAP the others (something due Thursday is both "Due
 * Soon" and "Due This Week"), so this is a predicate rather than an equality
 * check.
 */
export const matchesDueFilter = (inv: any, filter: string): boolean => {
  if (!filter) return true;
  if (filter === "Due This Week" || filter === "Due This Month") {
    if (inv.paymentStatus === "Paid" || inv.paymentStatus === "Written Off") return false;
    if (!inv.dueDate) return false;
    const due = String(inv.dueDate).slice(0, 10);
    // ymd(new Date()), not today(): today() is UTC-based, and mixing it with
    // these local dates flips the comparison by a day near midnight.
    if (due < ymd(new Date())) return false; // already overdue — Overdue covers those
    return due <= (filter === "Due This Week" ? endOfWeekYmd() : endOfMonthYmd());
  }
  return getDueStatus(inv) === filter;
};

export const getAgingBucket = (inv: any) => {
  const d = daysOverdue(inv.dueDate);
  if (d <= 0) return "Current";
  if (d <= 30) return "1-30";
  if (d <= 60) return "31-60";
  if (d <= 90) return "61-90";
  return "90+";
};

export const today = () => new Date().toISOString().slice(0, 10);

/**
 * The user's LOCAL today, as YYYY-MM-DD.
 *
 * Use this — not today() — for anything compared against an invoice/due date.
 * today() is UTC-based, so west of Greenwich it reads a day behind for most of
 * the evening and east of it a day ahead near midnight; comparing that to a
 * plain date string silently shifts results by a day.
 */
export const localToday = () => ymd(new Date());

/**
 * Is this document within scope of an "as at" report date?
 *
 * A receivable exists from the day it is invoiced. An invoice dated after the
 * report date has not been issued yet as at that date, so it is not receivable
 * then — which is exactly what an A/R aging report as at a date means, and what
 * lib/ar-aging.ts has always done for historical dates (`invoiceDate <= asOf`).
 *
 * This matters commercially: a client that raises invoices ahead of time to
 * track a collection schedule saw its entire future order book counted as
 * receivable today, burying the ~$700 actually owed under ~$2.6m that wasn't.
 *
 * A row with NO invoice date is always in scope — absence of a date is not
 * evidence the document is post-dated, and dropping it would under-count real
 * debt. Comparison is on the date portion only, so a timestamp is safe.
 */
export const isWithinAsAt = (invoiceDate: string | null | undefined, asAt: string): boolean => {
  if (!invoiceDate) return true;
  return String(invoiceDate).slice(0, 10) <= asAt;
};
export const daysFromNow = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

// ── Source discriminator helpers ──────────────────────────────────────────────
export type RecordSource = "native" | "qbo" | "xero" | "sage";

const SOURCE_LABELS: Record<string, string> = {
  native: "Native",
  qbo:    "QBO",
  xero:   "Xero",
  sage:   "Sage",
};
const SOURCE_VARIANTS: Record<string, string> = {
  native: "stone",
  qbo:    "blue",
  xero:   "green",
  sage:   "amber",
};

export function sourceLabel(source: string | null | undefined): string {
  if (!source) return "Native";
  return SOURCE_LABELS[source.toLowerCase()] ?? source;
}

export function sourceBadgeVariant(source: string | null | undefined): string {
  if (!source) return "stone";
  return SOURCE_VARIANTS[source.toLowerCase()] ?? "stone";
}

export function isConnectedRecord(source: string | null | undefined): boolean {
  return !!source && source !== "native";
}
