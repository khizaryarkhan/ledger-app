/**
 * The next free lot suggestion, stepping past numbers other unposted rows already hold (client-safe).
 *
 * `GET /api/inventory/lot-suggestion` only PEEKS the next number. Without `used`, every row of one visit was
 * pre-filled with the SAME number and, lot numbers being unique org-wide, all but the first failed to create a
 * lot — the root cause of stock missing behind a posted receipt (fixed server-side in ffb878d2 as well).
 */
export async function suggestLot(used: (string | null | undefined)[]): Promise<string | null> {
  const taken = used.map(u => (u ?? "").trim()).filter(Boolean);
  const q = taken.length ? `?skip=${encodeURIComponent(taken.join(","))}` : "";
  const s = await fetch(`/api/inventory/lot-suggestion${q}`).then(r => r.json()).catch(() => null);
  return s?.code ?? null;
}
