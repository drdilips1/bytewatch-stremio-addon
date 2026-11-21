// Services that refuse us get left alone for a while instead of being asked again and again.
//
// On 21 Nov the relay worker carried 15,000 Goodreads requests in a day and Goodreads refused
// every one (it blocks Cloudflare), plus ~1,000 iTunes and many Hardcover requests that were
// refused too. Every book tile asked again, and again 8–15 s later. Now:
// - a request a service refused isn't sent again for a while (Goodreads: 3 days for that book);
// - after a few refusals in a row the whole service is paused (Goodreads 1 hour; iTunes and
//   Hardcover 10 minutes, doubling up to 2 hours while they keep refusing).
// Pure: the caller keeps the state (http.js saves it on the device) and passes the time.

const HOUR = 3600e3;
export const POLICY = {
  'www.goodreads.com': { again: 72 * HOUR, streak: 3, pause: HOUR, max: HOUR },
  'itunes.apple.com': { again: 6 * HOUR, streak: 3, pause: 10 * 60e3, max: 2 * HOUR },
  'api.hardcover.app': { again: 6 * HOUR, streak: 3, pause: 10 * 60e3, max: 2 * HOUR },
};

/** A "no" from the service (blocked, rate-limited, busy) — not "this book isn't there" (404). */
export const isRefusal = (status) => status === 429 || status === 503 || (status >= 400 && status < 500 && status !== 404);

const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

export function emptyBackoff() {
  return { hosts: {}, asks: {} };
}

/**
 * Should this request wait? → null (go ahead) or { until, why } where why is 'paused' (the
 * service refused several times in a row) or 'refused' (it refused this very request).
 * `key` identifies the request (the URL, plus the body for a POST).
 */
export function waitFor(state, url, key = url, now = Date.now()) {
  const host = hostOf(url);
  if (!POLICY[host]) return null;
  const h = state.hosts[host];
  if (h?.until > now) return { until: h.until, why: 'paused' };
  const a = state.asks[key];
  if (a > now) return { until: a, why: 'refused' };
  return null;
}

/**
 * Note how a request went. Returns true when the state changed (so the caller saves it).
 * `retryAfter`: seconds from a 429's Retry-After header, when given.
 */
export function noteAnswer(state, url, key, status, now = Date.now(), retryAfter = 0) {
  const host = hostOf(url);
  const p = POLICY[host];
  if (!p) return false;
  const h = state.hosts[host] || { streak: 0, until: 0, pause: 0 };
  if (!isRefusal(status)) {
    if (!h.streak && !h.pause && !state.asks[key]) return false;
    state.hosts[host] = { streak: 0, until: 0, pause: 0 };
    delete state.asks[key];
    return true;
  }
  state.asks[key] = now + p.again;
  h.streak += 1;
  // Paused before and no success since: refusing again right after the pause pauses it again, longer.
  if (h.streak >= p.streak || h.pause || retryAfter > 0) {
    h.pause = Math.min(p.max, h.pause ? h.pause * 2 : p.pause);
    h.until = now + Math.max(h.pause, Math.min(p.max, retryAfter * 1000));
    h.streak = 0;
  }
  state.hosts[host] = h;
  // Keep it small: drop asks that have run out, and the oldest beyond 600.
  const keys = Object.keys(state.asks);
  if (keys.length > 600) {
    for (const k of keys) if (state.asks[k] <= now) delete state.asks[k];
    const left = Object.keys(state.asks).sort((x, y) => state.asks[x] - state.asks[y]);
    for (const k of left.slice(0, Math.max(0, left.length - 600))) delete state.asks[k];
  }
  return true;
}
