// Send your TorBox / Real-Debrid audiobooks home: the app hands each one's
// magnet to your own qBittorrent (Web UI, e.g. over Tailscale), saved into your
// Audiobookshelf library folder. qBittorrent then downloads it by itself, and
// Audiobookshelf picks the finished folder up.
import { Capacitor, CapacitorCookies, registerPlugin } from '@capacitor/core';
import { persisted } from '../lib/store.js';
import { requestText, requestFull, cleanUrl } from '../lib/http.js';
import { readTorrent } from '../lib/torrentfile.js';
import { infoHash, magnetFor, torboxLibrary, realdebridLibrary, tbConnected, rdConnected } from './debrid.js';

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

// Well-known public trackers. A magnet with only an info-hash makes qBittorrent
// hunt for peers through DHT alone, which often leaves it stuck at
// "Downloading metadata"; trackers let it find peers straight away.
const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'https://tracker.tamersunion.org:443/announce',
  'http://tracker.opentrackr.org:1337/announce',
];
export function withTrackers(magnet) {
  const have = new Set([...String(magnet).matchAll(/[?&]tr=([^&]+)/g)].map((m) => decodeURIComponent(m[1])));
  const extra = TRACKERS.filter((t) => !have.has(t)).map((t) => '&tr=' + encodeURIComponent(t)).join('');
  return magnet + extra;
}

/** Add one cloud item (needs its info-hash) to qBittorrent. */
export async function send(book) {
  if (!available) throw new Error('Sending to qBittorrent works in the Android app');
  if (!configured()) throw new Error('Set up qBittorrent first (Settings → Home server)');
  const hash = String(book.hash || '').toLowerCase();
  if (!hash) throw new Error('Only torrents can be sent (this item has no magnet)');
  const { savePath, category } = qbit.get();
  const magnet = withTrackers(magnetFor(book.magnet, hash, book.rawName || book.title));
  const { body, contentType } = multipart({ urls: magnet, savepath: savePath, category, tags: 'kathava', autoTMM: savePath ? 'false' : undefined });
  if (!session && !apiKey()) await login();
  const remember = () => qbitSent.set((s) => ({ items: { ...s.items, [hash]: { title: book.title, author: book.author || '', at: Date.now() } } }));
  let text = '';
  try {
    text = await api('torrents/add', { method: 'POST', body, contentType });
  } catch (e) {
    // 409 = nothing was added — usually because qBittorrent already has it.
    if (e.status !== 409) throw e;
    const have = await existing(hash);
    if (have) {
      remember();
      return `Already in qBittorrent — ${describe(have)}`;
    }
    throw new Error("qBittorrent didn't add it (409). Check that the save folder exists and the drive is connected, then try again");
  }
  // "Ok." up to 5.2.2; from 5.2.3 a JSON summary ({ success_count, … }).
  let added = !/fail/i.test(text);
  try {
    const j = JSON.parse(text);
    if (j && typeof j.success_count === 'number') added = j.success_count > 0;
  } catch {}
  if (!added) {
    const have = await existing(hash);
    if (have) {
      remember();
      return `Already in qBittorrent — ${describe(have)}`;
    }
    throw new Error("qBittorrent didn't add it");
  }
  remember();
  return `Sent to qBittorrent${savePath ? ` → ${savePath}` : ''}`;
}

/** A torrent qBittorrent already has, or null. */
async function existing(hash) {
  try {
    const list = JSON.parse((await api('torrents/info?' + new URLSearchParams({ hashes: hash }))) || '[]');
    return list[0] || null;
  } catch {
    return null;
  }
}

const STATES = { downloading: 'downloading', stalledDL: 'waiting for peers', metaDL: 'fetching details', forcedMetaDL: 'fetching details', queuedDL: 'queued', pausedDL: 'paused', stoppedDL: 'paused', uploading: 'done, sharing', stalledUP: 'done', pausedUP: 'done', stoppedUP: 'done', queuedUP: 'done', checkingDL: 'checking', checkingUP: 'checking', error: 'error', missingFiles: 'files missing', moving: 'moving' };
export const stateLabel = (st) => STATES[st] || st || '';
function describe(t) {
  const pct = Math.round((t.progress || 0) * 100);
  return `${pct >= 100 ? 'finished' : `${pct}% · ${stateLabel(t.state)}`}${t.save_path ? ` · ${t.save_path}` : ''}`;
}

/** Send a pasted magnet link. */
export async function sendMagnet(magnet) {
  if (!/^magnet:\?/i.test(magnet)) throw new Error('Paste a magnet link (magnet:?…), or tap + with the box empty to pick a .torrent file');
  const hash = infoHash(magnet, '');
  if (!hash) throw new Error("That magnet link doesn't have a valid hash");
  const dn = (/[?&]dn=([^&]+)/.exec(magnet) || [])[1];
  const title = dn ? decodeURIComponent(dn.replace(/\+/g, ' ')) : 'Torrent';
  return send({ hash, magnet, title, rawName: title });
}

/** Upload a .torrent file to qBittorrent (same folder and category as magnets). */
export async function sendFile(file) {
  if (!available) throw new Error('Sending to qBittorrent works in the Android app');
  if (!configured()) throw new Error('Set up qBittorrent first (Settings → Home server)');
  if (!file) throw new Error('No file chosen');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { name, hash } = await readTorrent(bytes);
  const { savePath, category } = qbit.get();
  const form = new FormData();
  form.append('torrents', new Blob([bytes], { type: 'application/x-bittorrent' }), file.name || 'book.torrent');
  if (savePath) {
    form.append('savepath', savePath);
    form.append('autoTMM', 'false');
  }
  if (category) form.append('category', category);
  form.append('tags', 'kathava');
  if (!session && !apiKey()) await login();
  const post = async () => {
    const res = await fetch(base() + '/api/v2/torrents/add', { method: 'POST', headers: headersFor(await cookie()), body: form });
    return { status: res.status, text: await res.text().catch(() => '') };
  };
  let r = await post();
  if ((r.status === 401 || r.status === 403) && !apiKey()) {
    await login();
    r = await post();
  }
  const remember = () => hash && qbitSent.set((s) => ({ items: { ...s.items, [hash]: { title: name || file.name, author: '', at: Date.now() } } }));
  if (r.status === 409 || /fail/i.test(r.text)) {
    const have = hash ? await existing(hash) : null;
    if (have) {
      remember();
      return `Already in qBittorrent — ${describe(have)}`;
    }
    throw new Error("qBittorrent didn't add it — check the save folder and that the drive is connected");
  }
  if (r.status >= 400) throw new Error(`qBittorrent: HTTP ${r.status}${r.text ? ` — ${r.text.slice(0, 80)}` : ''}`);
  remember();
  return `Sent “${name || file.name}” to qBittorrent${savePath ? ` → ${savePath}` : ''}`;
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

/**
 * Unstick what we've sent: add trackers and re-announce (stuck at metadata /
 * no peers), and re-check torrents in an error or missing-files state.
 */
export async function fixStuck() {
  const hashes = Object.keys(qbitSent.get().items);
  if (!hashes.length) return 'Nothing sent yet';
  const list = JSON.parse((await api('torrents/info?' + new URLSearchParams({ hashes: hashes.join('|') }))) || '[]');
  if (!list.length) return 'None of the sent torrents are in qBittorrent any more';
  const form = (fields) => ({ method: 'POST', body: new URLSearchParams(fields).toString(), contentType: 'application/x-www-form-urlencoded' });
  const urls = TRACKERS.join('\n');
  for (const t of list) await api('torrents/addTrackers', form({ hash: t.hash, urls })).catch(() => {});
  const all = list.map((t) => t.hash).join('|');
  await api('torrents/reannounce', form({ hashes: all })).catch(() => {});
  const broken = list.filter((t) => /error|missingFiles/i.test(t.state));
  if (broken.length) await api('torrents/recheck', form({ hashes: broken.map((t) => t.hash).join('|') })).catch(() => {});
  // Paused/stopped ones: start them again (5.x uses start, older versions resume).
  const stopped = list.filter((t) => /^(paused|stopped)DL$/.test(t.state)).map((t) => t.hash).join('|');
  if (stopped) await api('torrents/start', form({ hashes: stopped })).catch(() => api('torrents/resume', form({ hashes: stopped })).catch(() => {}));
  return `Added trackers to ${list.length} torrent${list.length === 1 ? '' : 's'}${broken.length ? ` · re-checking ${broken.length} with errors` : ''}`;
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

// ---- Tracker tab: a site you sign in to, whose downloads go to qBittorrent ----
export const tracker = persisted('tracker', { url: '' });
const Web = registerPlugin('InkwellWeb');
const canBrowse = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellWeb');

/** Open the tracker site in the in-app browser; its .torrent downloads and magnets come here. */
export function openTracker() {
  const url = String(tracker.get().url || '').trim();
  if (!url) throw new Error('Add your tracker site address first');
  if (!canBrowse) return window.open(url, '_blank');
  // The browser screen sends captured downloads itself (the app is paused behind it).
  const c = qbit.get();
  const qb = JSON.stringify({ url: cleanUrl(c.url, 'http'), apiKey: c.apiKey || '', username: c.username || '', password: c.password || '', savePath: c.savePath || '', category: c.category || '', trackers: TRACKERS });
  return Web.open({ url: /^https?:\/\//i.test(url) ? url : 'https://' + url, title: '', capture: true, qbit: qb });
}

const nativeToast = (text) => (canBrowse ? Web.toast({ text }).catch(() => {}) : Promise.resolve());

// Downloads caught in the in-app browser: the browser screen already sent them to
// qBittorrent; here we only note them so they show under "Downloads at home".
if (canBrowse) {
  Web.addListener('captured', async (e) => {
    if (!e.sent) return;
    try {
      let hash = '';
      let title = e.name || 'Torrent';
      if (e.type === 'magnet') {
        hash = infoHash(e.url, '');
        const dn = (/[?&]dn=([^&]+)/.exec(e.url) || [])[1];
        if (dn) title = decodeURIComponent(dn.replace(/\+/g, ' '));
      } else {
        const bin = atob(e.data || '');
        const info = await readTorrent(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
        hash = info.hash;
        title = info.name || title;
      }
      if (hash) qbitSent.set((s) => ({ items: { ...s.items, [hash]: { title: title.replace(/\.torrent$/i, ''), author: '', at: Date.now() } } }));
    } catch {}
  });
}
