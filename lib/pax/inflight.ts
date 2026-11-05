// A small cap on how many messages one user (or one conversation) can have
// running at once. Each message can fan out into several internal API calls, so
// without a cap a single user could multiply load on the database, and two
// answers racing in one conversation could interleave what is stored.
//
// Per server instance: serverless gives no shared memory, so this is a brake,
// not a guarantee — the database-backed rate limit (30 messages per 5 minutes)
// is the other half.

const running = new Map<string, number>();
export const MAX_INFLIGHT_PER_USER = 2;

/** Returns a release function, or null when this key already has the maximum running. */
export function acquire(key: string, max = MAX_INFLIGHT_PER_USER): (() => void) | null {
  const n = running.get(key) ?? 0;
  if (n >= max) return null;
  running.set(key, n + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (running.get(key) ?? 1) - 1;
    if (left <= 0) running.delete(key); else running.set(key, left);
  };
}
