// Which origin does the MCP server call back into?
//
// Each tool call is replayed as an HTTP request to OUR OWN /api, carrying a
// short-lived token for the connecting user. If the origin came straight from the
// incoming Host header, a forged header would make us send that token to an
// attacker's server — so the origin is pinned to configuration, and the request's
// own origin is trusted only on a developer machine.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function internalOrigin(requestUrl: string, env: Record<string, string | undefined> = process.env): string | null {
  for (const key of ["NEXTAUTH_URL", "AUTH_URL", "NEXT_PUBLIC_APP_URL"]) {
    const raw = env[key];
    if (!raw) continue;
    try {
      const u = new URL(raw);
      if (u.protocol === "https:" || LOCAL_HOSTS.has(u.hostname)) return u.origin;
    } catch { /* try the next one */ }
  }
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  try {
    const u = new URL(requestUrl);
    if (LOCAL_HOSTS.has(u.hostname)) return u.origin;
  } catch { /* fall through */ }
  return null;
}

/** The origin a client sees — used only to describe ourselves in OAuth metadata. */
export function publicOrigin(requestUrl: string, forwardedHost: string | null, forwardedProto: string | null): string {
  const u = new URL(requestUrl);
  const host = forwardedHost?.split(",")[0]?.trim();
  if (host && /^[a-z0-9.-]+(:\d+)?$/i.test(host)) {
    const proto = forwardedProto?.split(",")[0]?.trim() === "http" && LOCAL_HOSTS.has(host.split(":")[0]) ? "http" : "https";
    return `${proto}://${host}`;
  }
  return u.origin;
}
