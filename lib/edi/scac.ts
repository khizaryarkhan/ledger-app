/**
 * A carrier's SCAC (Standard Carrier Alpha Code): two to four capital letters. Pure. Never guessed from the carrier's
 * name: a wrong code routes a ship notice to the wrong carrier's tracking, so only what a person typed is kept.
 */

export function normaliseScac(v: unknown): { ok: true; scac: string | null } | { ok: false; error: string } {
  const s = v == null ? "" : String(v).trim().toUpperCase();
  if (!s) return { ok: true, scac: null };
  if (!/^[A-Z]{2,4}$/.test(s)) return { ok: false, error: "A carrier code (SCAC) is 2 to 4 letters, e.g. UPSN." };
  return { ok: true, scac: s };
}
