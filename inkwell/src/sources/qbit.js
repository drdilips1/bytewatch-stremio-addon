// Send your TorBox / Real-Debrid audiobooks home: the app hands each one's
// magnet to your own qBittorrent (Web UI, e.g. over Tailscale), saved into your
// Audiobookshelf library folder. qBittorrent then downloads it by itself, and
// Audiobookshelf picks the finished folder up.
import { Capacitor, CapacitorCookies } from '@capacitor/core';
import { persisted } from '../lib/store.js';
import { requestText, requestFull, cleanUrl } from '../lib/http.js';
import { magnetFor, torboxLibrary, realdebridLibrary, tbConnected, rdConnected } from './debrid.js';

export const qbit = persisted('qbit', { url: '', username: '', password: '', apiKey: '', savePath: '', category: 'audiobooks', auto: false });

// qBittorrent 5.2+ API key (qbt_…): sent on every call, no login or cookie needed.
const apiKey = () => String(qbit.get().apiKey || '').trim();
// Hashes already sent (so auto-send never repeats one), newest last.
export const qbitSent = persisted('qbitSent', { items: {} });

export const configured = () => !!qbit.get().url;
export const available = Capacitor.isNativePlatform();

const base = () => cleanUrl(qbit.get().url, 'http').replace(/\/+$/, '');
// qBittorrent refuses API calls whose Referer/Origin don't match its own address.
const headersFor = (extra = {}) => ({ Referer: base() + '/', Origin: base(), ...extra });

// The session cookie: "SID" up to qBittorrent 5.1, "QBT_SID_<port>" from 5.2.
let session = '';
const isSession = (k) => k === 'SID' || /^QBT_SID/i.test(k);
function takeSetCookie(headers) {
  const raw = headers?.get?.('set-cookie') || '';
  const m = /((?:QBT_)?SID[^=;,\s]*)=([^;,\s]+)/i.exec(raw);
  if (m) session = `${m[1]}=${m[2]}`;
}
async function cookie() {
  if (apiKey()) return { Authorization: `Bearer ${apiKey()}` };
  try {
    const c = await CapacitorCookies.getCookies({ url: base() });
    const found = Object.entries(c || {}).filter(([k]) => isSession(k));
    if (found.length) session = found.map(([k, v]) => `${k}=${v}`).join('; ');
  } catch {}
  return session ? { Cookie: session } : {};
}

async function login() {
  if (apiKey()) return;
  const { username, password } = qbit.get();
  if (!username && !password) return; // Web UI set to skip login for this network
  const body = new URLSearchParams({ username, password }).toString();
  const r = await requestFull(base() + '/api/v2/auth/login', {
    method: 'POST',
    timeout: 15000,
    headers: headersFor({ 'Content-Type': 'application/x-www-form-urlencoded' }),
    body,
  }).catch((e) => {
    if (e.status === 401) throw new Error('qBittorrent rejected the username or password');
    if (e.status === 403) throw new Error('qBittorrent has temporarily banned this device after failed logins — wait a while, or check the Web UI settings');
    throw new Error(`Couldn't reach qBittorrent at ${base()} — is Tailscale on and the Web UI enabled? (${e.message})`);
  });
  takeSetCookie(r.headers);
  // Success is "Ok." (up to 5.1) or an empty 204 reply (5.2 and later).
  if (r.status === 204 || /^\s*ok/i.test(r.text)) return;
  throw new Error('qBittorrent rejected the username or password');
}

/** Call the Web API, signing in first (and again once if the session expired). */
async function api(path, { method = 'GET', body, contentType } = {}) {
  const go = async () =>
    requestText(base() + '/api/v2/' + path, {
      method,
      timeout: 20000,
      headers: headersFor({ ...(await cookie()), ...(contentType ? { 'Content-Type': contentType } : {}) }),
      body,
    });
  try {
    return await go();
  } catch (e) {
    if (e.status !== 403 && e.status !== 401) throw e;
    if (apiKey()) throw new Error('qBittorrent rejected the API key — copy it again from the Web UI settings');
    await login();
    return go().catch((e2) => {
      if (e2.status === 401 || e2.status === 403)
        throw new Error("Signed in, but qBittorrent didn't accept the session on the next step. Use an API key instead (qBittorrent 5.2+: Web UI settings → API key), or allow your Tailscale devices without a password (bypass authentication for 100.64.0.0/10) and leave username/password empty here.");
      throw e2;
    });
  }
}

/** Check the connection; resolves with qBittorrent's version. */
export async function test() {
  if (!available) throw new Error('Sending to qBittorrent works in the Android app');
  await login();
  const v = (await api('app/version')).trim();
  qbit.set((c) => ({ ...c, version: v, checkedAt: Date.now() }));
  return `Connected to qBittorrent ${v}`;
}

function multipart(fields) {
  const boundary = '----kathava' + Math.random().toString(16).slice(2);
  const body =
    Object.entries(fields)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)
      .join('') + `--${boundary}--\r\n`;
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

/** Add one cloud item (needs its info-hash) to qBittorrent. */
export async function send(book) {
  if (!available) throw new Error('Sending to qBittorrent works in the Android app');
  if (!configured()) throw new Error('Set up qBittorrent first (Settings → Home server)');
  const hash = String(book.hash || '').toLowerCase();
  if (!hash) throw new Error('Only torrents can be sent (this item has no magnet)');
  const { savePath, category } = qbit.get();
  const magnet = magnetFor(book.magnet, hash, book.rawName || book.title);
  const { body, contentType } = multipart({ urls: magnet, savepath: savePath, category, tags: 'kathava', autoTMM: savePath ? 'false' : undefined });
  if (!session && !apiKey()) await login();
  const text = await api('torrents/add', { method: 'POST', body, contentType });
  if (/fail/i.test(text)) throw new Error('qBittorrent refused it (it may already be there)');
  qbitSent.set((s) => ({ items: { ...s.items, [hash]: { title: book.title, author: book.author || '', at: Date.now() } } }));
  return `Sent to qBittorrent${savePath ? ` → ${savePath}` : ''}`;
}

export const wasSent = (hash) => !!qbitSent.get().items[String(hash || '').toLowerCase()];

/** All torrent-based audiobooks in your clouds that haven't been sent yet. */
export async function unsent() {
  const lists = await Promise.all([tbConnected() ? torboxLibrary().catch(() => []) : [], rdConnected() ? realdebridLibrary().catch(() => []) : []]);
  const seen = new Set();
  return lists.flat().filter((b) => b.hash && !b.fetching && !wasSent(b.hash) && !seen.has(b.hash) && seen.add(b.hash));
}

/** Send everything not sent yet; returns a summary line. */
export async function sendAll(onProgress) {
  const list = await unsent();
  if (!list.length) return 'Nothing new to send';
  await login();
  let ok = 0;
  let failed = 0;
  for (const [i, b] of list.entries()) {
    try {
      await send(b);
      ok++;
    } catch {
      failed++;
    }
    onProgress?.(i + 1, list.length);
  }
  return `Sent ${ok} to qBittorrent${failed ? ` · ${failed} failed` : ''}`;
}

/** Progress of what we've sent, straight from qBittorrent. */
export async function status() {
  const hashes = Object.keys(qbitSent.get().items);
  if (!hashes.length) return [];
  const text = await api('torrents/info?' + new URLSearchParams({ hashes: hashes.slice(-50).join('|') }));
  const list = JSON.parse(text || '[]');
  return list
    .map((t) => ({ hash: t.hash, name: t.name, progress: t.progress, state: t.state, eta: t.eta, speed: t.dlspeed, savePath: t.save_path }))
    .sort((a, b) => (qbitSent.get().items[b.hash]?.at || 0) - (qbitSent.get().items[a.hash]?.at || 0));
}

// Auto-send: when the app opens (at most every 15 minutes), forward new cloud audiobooks.
let lastAuto = 0;
export async function autoForward() {
  const cfg = qbit.get();
  if (!available || !cfg.url || !cfg.auto || Date.now() - lastAuto < 15 * 60e3) return '';
  lastAuto = Date.now();
  try {
    // Only items added to your cloud after auto-send was switched on.
    const list = (await unsent()).filter((b) => (b.addedAt || 0) >= (cfg.autoSince || 0));
    if (!list.length) return '';
    await login();
    let ok = 0;
    for (const b of list) await send(b).then(() => ok++, () => {});
    return ok ? `Sent ${ok} new audiobook${ok === 1 ? '' : 's'} to qBittorrent` : '';
  } catch {
    return '';
  }
}
