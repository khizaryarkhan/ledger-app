/**
 * Lot-number rules for one receipt. Pure, so the rule is provable without a database.
 *
 * Lot numbers are unique across the organisation (a physical tag). The Receiving screen PEEKS the next
 * number without consuming it, so every row staged in one visit is pre-filled with the same code. Before this
 * rule, the second and later lines of such a receipt failed to create a lot (unique index) while the journal
 * entry had already posted: the ledger carried stock the lots did not (found on a production org, 732.00).
 */

const norm = (v: string | null | undefined): string => (v ?? "").trim().toLowerCase();

/**
 * Indexes of lines whose requested lot number repeats an EARLIER line's in the same receipt
 * (case-insensitive, blanks ignored). The first line keeps its number; a repeat has to be given a fresh one.
 */
export function repeatedLotLines(requested: (string | null | undefined)[]): Set<number> {
  const seen = new Set<string>();
  const repeats = new Set<number>();
  requested.forEach((raw, i) => {
    const n = norm(raw);
    if (!n) return;
    if (seen.has(n)) repeats.add(i); else seen.add(n);
  });
  return repeats;
}

/** The distinct, trimmed lot numbers a receipt asks for, ignoring the lines in `skip` (their number is being replaced). */
export function requestedLotNumbers(requested: (string | null | undefined)[], skip: Set<number> = new Set()): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  requested.forEach((raw, i) => {
    const t = (raw ?? "").trim();
    if (!t || skip.has(i) || seen.has(norm(t))) return;
    seen.add(norm(t)); out.push(t);
  });
  return out;
}
