/**
 * Shared numeric rounding helpers for the inventory/manufacturing engines.
 * These return NUMBERS rounded to a fixed number of decimals (banker's-agnostic
 * half-up via Math.round). For string-formatted output use `.toFixed()` at the
 * call site — valuation.ts keeps its own `toFixed` variants deliberately.
 */
export const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
export const round4 = (n: number) => Math.round((Number(n) || 0) * 1e4) / 1e4;
export const round6 = (n: number) => Math.round((Number(n) || 0) * 1e6) / 1e6;

/**
 * QUANTITY rounding — 6 decimals, matching the widened numeric(_,6) quantity
 * columns (migration 0088).
 *
 * Deliberately its own name rather than an alias of round6: a call site reading
 * `roundQty(x)` says the value is a quantity, and that is the distinction the
 * whole change turns on. `round4` stays for money at numeric(_,4) — amounts and
 * movement totals — and using the wrong one is how two decimals of stock went
 * missing before.
 */
export const roundQty = (n: number) => Math.round((Number(n) || 0) * 1e6) / 1e6;

/**
 * The smallest quantity the database can represent — quantity columns are
 * numeric(_,6) since migration 0088.
 *
 * Use it for "is this remainder effectively zero?" tests (a PO line fully
 * received, a lot depleted, a shipment complete). It is deliberately tied to the
 * column scale rather than picked by feel: anything the database cannot tell
 * from zero is zero, and anything it can is a real outstanding quantity that a
 * user is entitled to see. These tests were all written as a bare 0.0001 back
 * when the columns held 4 decimals, which would now hide a genuine 0.00005.
 */
export const QTY_EPSILON = 1e-6;
