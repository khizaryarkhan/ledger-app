/**
 * "Last Email Ref" for a customer or project band on the Collections Board
 * (pure, client-safe).
 *
 * A band must agree with the invoice rows inside it. Each invoice row reads its
 * last OUTBOUND email or chase (`lastSent` / `lastRef`, built in
 * app/(app)/board/page.tsx from channel "Email" | "Chase"). The band used to
 * read only chases logged by hand, so an email sent today left the band saying
 * "108 days ago" right above an invoice that said "today". The band is now the
 * newest of: any invoice's last email/chase, an invoice-level logged chase, and
 * a chase logged on the band itself.
 */

export interface BandContactInput {
  /** Per invoice in the band: last outbound email/chase (ISO) and its ref. */
  invoices: { lastSent: string | null; lastRef: string | null; chaseMs?: number | null }[];
  /** Newest chase logged on the customer/project itself, if any. */
  entityChase?: { at: string; label: string } | null;
}

export interface BandContact { days: number; activityType: string; ref: string | null; at: number }

const ms = (iso: string | null | undefined): number => {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
};

export function latestBandContact(input: BandContactInput, nowMs: number = Date.now()): BandContact | null {
  let best: { at: number; activityType: string; ref: string | null } | null = null;
  const consider = (at: number, activityType: string, ref: string | null) => {
    if (at > 0 && (!best || at > best.at)) best = { at, activityType, ref };
  };
  for (const inv of input.invoices) {
    consider(ms(inv.lastSent), "Email", inv.lastRef ?? null);
    consider(inv.chaseMs ?? 0, "Chase", null);
  }
  if (input.entityChase) consider(ms(input.entityChase.at), input.entityChase.label || "Chase", null);
  if (!best) return null;
  const b = best as { at: number; activityType: string; ref: string | null };
  return { ...b, days: Math.max(0, Math.floor((nowMs - b.at) / 86400000)) };
}
