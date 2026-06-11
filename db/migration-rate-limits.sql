-- Fixed-window rate limiting (see lib/rate-limit.ts).
-- One row per limiter key; the row is reset in-place when its window expires.
CREATE TABLE IF NOT EXISTS rate_limits (
  key        text        PRIMARY KEY,
  count      integer     NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL
);

-- Lets a periodic cleanup prune expired rows cheaply (optional).
CREATE INDEX IF NOT EXISTS rate_limits_expires_idx ON rate_limits (expires_at);
