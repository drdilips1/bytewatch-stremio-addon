// Small fetch wrapper: timeout, JSON/text helpers and a short-lived memory cache.
// On Android, Capacitor's native HTTP patches fetch(), so sources without CORS work too.

const cache = new Map();
const TTL = 10 * 60 * 1000;

async function request(url, { timeout = 15000, headers, method = 'GET', body } = {}) {
  const ctrl = new AbortController();
  let timer;
  // Android's native HTTP ignores abort signals, so also race a timer:
  // a slow server then fails with a clear error instead of hanging forever.
  const timedOut = new Promise((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      const e = new Error(`Timed out after ${Math.round(timeout / 1000)}s — pull down to try again`);
      e.timeout = true;
      reject(e);
    }, timeout);
  });
  try {
    const res = await Promise.race([fetch(url, { method, headers, body, signal: ctrl.signal }), timedOut]);
    if (!res.ok) {
      let detail = '';
      try {
        const text = await res.text();
        try {
          const j = JSON.parse(text);
          detail = j.message || j.detail || j.error_description || (typeof j.error === 'string' ? j.error : '') || '';
        } catch {}
        if (!detail) detail = text.slice(0, 160).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      } catch {}
      const err = new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
      err.url = url.replace(/([?&](token|apikey|api_key)=)[^&]+/gi, '$1…');
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

// Remove whitespace and invisible characters that phone keyboards like to insert
// (e.g. "http:// 192.168.1.2"), and add a scheme when one is missing.
export function cleanUrl(u, defaultScheme = 'https') {
  u = String(u || '').replace(/[\s\u200B-\u200D\uFEFF\u00A0]+/g, '');
  if (u && !/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = `${defaultScheme}://${u}`;
  return u;
}

export function sendForm(url, method, params, headers = {}) {
  return request(url, {
    method,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: qs(params),
  }).then((r) => (r.status === 204 ? null : r.json().catch(() => null)));
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
