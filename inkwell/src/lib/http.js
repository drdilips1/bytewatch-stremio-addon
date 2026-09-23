// Small fetch wrapper: timeout, JSON/text helpers and a short-lived memory cache.
// On Android, Capacitor's native HTTP patches fetch(), so sources without CORS work too.

const cache = new Map();
const TTL = 10 * 60 * 1000;

async function request(url, { timeout = 15000, headers, method = 'GET', body } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} for ${url}`);
      err.status = res.status;
      throw err;
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function getJson(url, opts = {}) {
  const key = opts.method && opts.method !== 'GET' ? null : 'j:' + url + JSON.stringify(opts.headers || {});
  if (key && !opts.fresh) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.t < TTL) return hit.v;
  }
  const res = await request(url, opts);
  const v = await res.json();
  if (key) cache.set(key, { t: Date.now(), v });
  return v;
}

export async function getText(url, opts = {}) {
  const key = 't:' + url;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  const res = await request(url, { timeout: 30000, ...opts });
  const v = await res.text();
  cache.set(key, { t: Date.now(), v });
  return v;
}

export function sendJson(url, method, data, headers = {}) {
  return request(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: data === undefined ? undefined : JSON.stringify(data),
  }).then((r) => (r.status === 204 ? null : r.json().catch(() => null)));
}

export function clearHttpCache() {
  cache.clear();
}

export const qs = (params) =>
  Object.entries(params)
    .flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]]))
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
