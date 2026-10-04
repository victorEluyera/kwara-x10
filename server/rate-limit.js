/**
 * Fixed-window rate limiting for the unauthenticated endpoints.
 *
 * Its own module so it can be tested directly -- importing index.js would
 * start a server. This guards login, where usernames follow a published
 * pattern (SEN-<FIRSTNAME>-01) and accounts are handed out with a shared
 * starting password, so an unthrottled login is genuinely guessable.
 *
 * In-process and per-instance: it resets on redeploy and does not coordinate
 * across instances. That is enough friction to defeat scripted guessing, and
 * is not a substitute for a WAF if this ever needs one.
 */
export function makeLimiter(windowMs, limit, now = () => Date.now()) {
  const attempts = new Map();
  return function isOverLimit(key) {
    const t = now();
    // Opportunistic sweep so a flood of distinct keys cannot grow the map
    // without bound.
    if (attempts.size > 10_000) {
      for (const [k, v] of attempts) if (t > v.resetAt) attempts.delete(k);
    }
    const entry = attempts.get(key);
    if (!entry || t > entry.resetAt) {
      attempts.set(key, { count: 1, resetAt: t + windowMs });
      return false;
    }
    entry.count++;
    return entry.count > limit;
  };
}
