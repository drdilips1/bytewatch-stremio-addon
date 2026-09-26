// Small fetch wrapper: timeout, JSON/text helpers and a short-lived memory cache.
// On Android, Capacitor's native HTTP patches fetch(), so sources without CORS work too.

import { Capacitor, CapacitorHttp } from '@capacitor/core';

const cache = new Map();
const TTL = 10 * 60 * 1000;

// ---- Web app (iPhone / iPad) --------------------------------------------------
// Browsers block services that don't allow cross-site requests (CORS). The web
// app sends those through a small relay (a Supabase Edge Function, see
// inkwell/relay/). The Android app talks to everything directly.
const WEB = !Capacitor.isNativePlatform();
const RELAY_HOSTS = /^(api\.hardcover\.app|api\.audible\.[a-z.]+|www\.goodreads\.com|(www\.)?getstoryshots\.com|itunes\.apple\.com)$/i;
const DEFAULT_RELAY = import.meta.env.VITE_SUPABASE_URL ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/relay` : '';

export function relayUrl() {
  try {
    const v = localStorage.getItem('inkwell:relayUrl');
    if (v === 'off') return '';
    return v || DEFAULT_RELAY;
  } catch {
    return DEFAULT_RELAY;
  }
}
export function setRelayUrl(v) {
  try {
    localStorage.setItem('inkwell:relayUrl', v);
  } catch {}
}
export const isWeb = WEB;

// Hosts the relay will forward to (keep in step with relay/index.ts). Anything
// else — e.g. your own Audiobookshelf server — must allow the web app directly.
const RELAY_ALLOWED = /^(api\.hardcover\.app|api\.audible\.[a-z.]+|www\.goodreads\.com|(www\.)?getstoryshots\.com|itunes\.apple\.com|api\.torbox\.app|api\.real-debrid\.com|openlibrary\.org|www\.googleapis\.com|archive\.org|gutendex\.com|standardebooks\.org|librivox\.org|jsonkeeper\.com|([a-z0-9-]+\.)*knaben\.(org|eu|net|cc)|[a-z0-9.-]+\.workers\.dev)$/i;
function relayable(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && RELAY_ALLOWED.test(u.hostname);
  } catch {
    return false;
  }
}

const viaRelay = (url) => `${relayUrl()}?url=${encodeURIComponent(url)}`;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
// Supabase checks its own Authorization header, so the service's headers travel
// JSON-encoded in x-relay-headers and the relay puts them back.
const relayHeaders = (headers) => ({
  ...(ANON ? { Authorization: `Bearer ${ANON}`, apikey: ANON } : {}),
  'x-relay-headers': JSON.stringify(Object.fromEntries(Object.entries(headers || {}).filter(([k]) => !/^content-type$/i.test(k)))),
  ...Object.fromEntries(Object.entries(headers || {}).filter(([k]) => /^content-type$/i.test(k))),
});
function needsRelay(url) {
  if (!WEB || !relayUrl()) return false;
  try {
    return RELAY_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function request(url, { timeout = 15000, headers, method = 'GET', body, feed = false } = {}) {
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
    const go = (u, h) => Promise.race([fetch(u, { method, headers: h, body, signal: ctrl.signal }), timedOut]);
    // Podcast feeds live on countless hosts: the relay fetches those read-only (?feed=1, XML only).
    const relayed = () => go(viaRelay(url) + (feed ? '&feed=1' : ''), relayHeaders(headers));
    let res;
    if (needsRelay(url)) res = await relayed();
    else {
      try {
        res = await go(url, headers);
      } catch (e) {
        // In a browser a CORS block looks like a network error: try the relay once.
        if (!WEB || e.timeout || !relayUrl() || !(relayable(url) || (feed && /^https:/i.test(url)))) throw e;
        res = await relayed();
      }
    }
    if (!res.ok) {
      let detail = '';
      try {
        const text = await res.text();
        try {
          const j = JSON.parse(text);
          detail = j.message || j.detail || j.error_description || (typeof j.error === 'string' ? j.error : '') || (typeof j.result === 'string' ? j.result : '') || '';
        } catch {}
        if (!detail) detail = text.slice(0, 160).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      } catch {}
      const relayMissing = WEB && res.status === 404 && /\/functions\/v1\/relay/.test(res.url || '') && /function/i.test(detail);
      const err = new Error(relayMissing ? 'This service needs the web relay — see Settings → Web app' : `HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
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

/** Download a file's bytes (ebooks etc.). On Android the native layer returns binary as base64. */
export async function getBytes(url) {
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.request({ url, method: 'GET', responseType: 'arraybuffer', readTimeout: 120000, connectTimeout: 20000 });
    if (r.status >= 400) throw new Error(`Download failed (HTTP ${r.status})`);
    if (typeof r.data !== 'string') throw new Error('Download failed (unexpected reply)');
    const bin = atob(r.data);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

// Remove whitespace and invisible characters that phone keyboards like to insert
// (e.g. "http:// 192.168.1.2"), and add a scheme when one is missing.
export function cleanUrl(u, defaultScheme = 'https') {
  u = String(u || '').replace(/[\s\u200B-\u200D\uFEFF\u00A0]+/g, '');
  if (u && !/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = `${defaultScheme}://${u}`;
  return u;
}

/** Any request, returning the response text (no caching). */
export async function requestText(url, opts = {}) {
  const res = await request(url, opts);
  return res.text();
}

/** Any request, returning { status, text, headers } (no caching). */
export async function requestFull(url, opts = {}) {
  const res = await request(url, opts);
  return { status: res.status, text: await res.text().catch(() => ''), headers: res.headers };
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

/** Web app: is the relay deployed, and which version? */
export async function probeRelay() {
  const url = relayUrl();
  if (!url) return { ok: false, error: 'Relay is switched off' };
  try {
    const res = await fetch(viaRelay('https://itunes.apple.com/search?term=habit&media=audiobook&limit=1'), { headers: relayHeaders({ Authorization: 'Bearer test' }) });
    const version = res.headers.get('x-relay-version') || '1';
    if (res.status === 404) return { ok: false, error: 'No function named "relay" in your Supabase project' };
    if (res.status === 401) return { ok: false, error: 'Supabase refused the request (401) — redeploy the relay with the new code' };
    if (!res.ok) return { ok: false, error: `Relay answered HTTP ${res.status}` };
    return { ok: version >= '2', version, error: version >= '2' ? '' : 'Old relay code — copy the new code and deploy it again' };
  } catch (e) {
    return { ok: false, error: `Can't reach the relay (${e.message}) — copy the new code and deploy it again` };
  }
}
