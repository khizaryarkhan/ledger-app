// Small guards shared by every PAX Console route.

/** A state-changing request must come from this site's own pages. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host === host.split(",")[0].trim(); } catch { return false; }
}

/** A token minted for an AI call (via: "mcp") must never drive the console itself. */
export const isAiCall = (session: unknown): boolean => (session as { user?: { via?: string } } | null)?.user?.via === "mcp";

export const userIdOf = (session: unknown): string => (session as { user: { id: string } }).user.id;
