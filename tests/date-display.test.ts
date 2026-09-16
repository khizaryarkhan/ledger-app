/**
 * A due date is a CALENDAR DATE. It must read the same in every timezone.
 *
 * Reported by a client: QuickBooks showed an invoice due 15 Sep 2026, our app
 * showed 14 Sep 2026. Their words, and the standard this file enforces:
 * "If it is because of the timezone difference — this should not happen. Date
 * is the date."
 *
 * The stored data was never wrong. `invoices.due_date` is a varchar holding
 * "2026-09-15", copied verbatim from QBO's DueDate by lib/qbo-sync.ts. The bug
 * was entirely in rendering: `new Date("2026-09-15")` is parsed as UTC
 * midnight, and every formatter then read it with local getters. West of
 * Greenwich that is the previous day — so for a US client, every date-only
 * field in the app was one day early.
 *
 * These tests run the formatters under real timezones on both sides of
 * Greenwich. Under the old code the US cases returned the 14th.
 */
import { describe, it, expect, afterEach } from "vitest";
import { formatDate, formatDateShort, fmt } from "@/lib/format";

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => { process.env.TZ = ORIGINAL_TZ; });

/**
 * Node reads process.env.TZ per Date/Intl call in recent versions, but the
 * formatters are also re-imported per assertion here rather than cached across
 * a timezone switch, so a stale offset can't make a failing case pass.
 */
const inTz = <T>(tz: string, fn: () => T): T => {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally { process.env.TZ = prev; }
};

// Deliberately spans both hemispheres of the meridian, plus a half-hour zone.
const ZONES = [
  "UTC",
  "America/Los_Angeles", // UTC-7/-8 — the failing direction
  "America/New_York",    // UTC-4/-5 — where the client actually is
  "Europe/Dublin",
  "Asia/Karachi",        // UTC+5
  "Pacific/Kiritimati",  // UTC+14, the extreme east
  "Asia/Kolkata",        // UTC+5:30 — half-hour offset
];

describe("a date-only value renders as itself in every timezone", () => {
  it("fmt.date — the reported invoice", () => {
    for (const tz of ZONES) {
      expect(inTz(tz, () => fmt.date("2026-09-15")), `fmt.date in ${tz}`).toBe("15 Sep 2026");
    }
  });

  it("formatDateShort", () => {
    for (const tz of ZONES) {
      expect(inTz(tz, () => formatDateShort("2026-09-15")), tz).toBe("15 Sep 2026");
      expect(inTz(tz, () => formatDateShort("2026-09-15", { year: false })), tz).toBe("15 Sep");
    }
  });

  it("formatDate, in every org date format", () => {
    for (const tz of ZONES) {
      expect(inTz(tz, () => formatDate("2026-09-15", "DD MMM YYYY")), tz).toBe("15 Sep 2026");
      expect(inTz(tz, () => formatDate("2026-09-15", "DD/MM/YYYY")), tz).toBe("15/09/2026");
      expect(inTz(tz, () => formatDate("2026-09-15", "MM/DD/YYYY")), tz).toBe("09/15/2026");
      expect(inTz(tz, () => formatDate("2026-09-15", "YYYY-MM-DD")), tz).toBe("2026-09-15");
      expect(inTz(tz, () => formatDate("2026-09-15", "MMM DD, YYYY")), tz).toBe("Sep 15, 2026");
    }
  });

  it("a date column serialised through JSON is still a date, not an instant", () => {
    // Drizzle `date`/`timestamp` columns arrive as "2026-09-15T00:00:00.000Z".
    // Midnight carries no time-of-day information, so this is the same
    // calendar date — treating it as an instant is the same bug one layer on.
    for (const tz of ZONES) {
      expect(inTz(tz, () => fmt.date("2026-09-15T00:00:00.000Z")), tz).toBe("15 Sep 2026");
      expect(inTz(tz, () => fmt.date("2026-09-15T00:00:00")), tz).toBe("15 Sep 2026");
    }
  });

  it("year boundaries, where an off-by-one is also an off-by-a-year", () => {
    for (const tz of ZONES) {
      expect(inTz(tz, () => fmt.date("2026-01-01")), tz).toBe("01 Jan 2026");
      expect(inTz(tz, () => fmt.date("2025-12-31")), tz).toBe("31 Dec 2025");
    }
  });

  it("does not shift across a DST transition", () => {
    // US DST ends 2026-11-01; EU clocks change 2026-10-25.
    for (const d of ["2026-11-01", "2026-10-25", "2026-03-08"]) {
      for (const tz of ZONES) {
        expect(inTz(tz, () => formatDate(d, "YYYY-MM-DD")), `${d} in ${tz}`).toBe(d);
      }
    }
  });
});

describe("a real timestamp is still shown in the viewer's timezone", () => {
  /**
   * The fix must not overshoot. A `sent_at` or `created_at` genuinely names an
   * instant, and 02:00 UTC really is the previous evening in New York. Showing
   * it as the following day would be a new off-by-one introduced by the fix
   * for this one.
   */
  it("keeps local rendering for a non-midnight time", () => {
    expect(inTz("America/New_York", () => fmt.date("2026-09-16T02:00:00Z"))).toBe("15 Sep 2026");
    expect(inTz("UTC",              () => fmt.date("2026-09-16T02:00:00Z"))).toBe("16 Sep 2026");
    expect(inTz("Asia/Karachi",     () => fmt.date("2026-09-15T21:00:00Z"))).toBe("16 Sep 2026");
  });

  it("still handles a Date object", () => {
    const d = new Date(2026, 8, 15, 13, 30); // local 15 Sep 2026
    expect(formatDate(d, "YYYY-MM-DD")).toBe("2026-09-15");
  });
});

describe("empty and malformed input", () => {
  it("renders an em dash rather than 'Invalid Date'", () => {
    for (const v of [null, undefined, "", "not a date"]) {
      expect(fmt.date(v as any)).toBe("—");
      expect(formatDate(v as any)).toBe("—");
      expect(formatDateShort(v as any)).toBe("—");
    }
  });
});
