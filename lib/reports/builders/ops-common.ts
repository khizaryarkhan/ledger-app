/**
 * Small shared helpers for the stock / operations report builders. PURE.
 * No Date is built here: a date is the literal "YYYY-MM-DD" string.
 */
import { formatDate } from "@/lib/format";
import type { Cell } from "../export-model";

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MIDNIGHT_DATE = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0+)?Z?$/;

/**
 * A date column cell. A plain date (or a date column serialised at midnight) is carried as the literal date;
 * anything with a real time of day is the screen's own formatted text, so the file never shifts a day.
 */
export function dateCell(v: unknown): Cell {
  if (v == null || v === "") return null;
  const s = String(v);
  if (PLAIN_DATE.test(s)) return s;
  const m = MIDNIGHT_DATE.exec(s);
  if (m) return m[1];
  return formatDate(s);
}

/** The screen's colour band for a percentage: below 95 is an exception (amber/red). */
export function pctFlag(n: number | null | undefined): boolean {
  return n != null && n < 95;
}

export function text(v: unknown): string | null {
  if (v == null || v === "") return null;
  return String(v);
}
