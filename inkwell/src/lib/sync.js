// Account + cloud sync. Two services: Audiohub's own (the api.audiohubapp.com Worker, data
// encrypted on the phone with your password — see cfsync.js; the default) or a Supabase
// project (the older way: email/password or Google; one row per user in
// `public.user_data` protected by row-level security). `account.backend` says which.
//
// Each synced store is a "section" with its own timestamp; lists that can be
// edited on several devices (progress, library, bookmarks, addons) merge item
// by item, everything else takes the newest copy.
import { qbit, qbitSent, tracker, mamSession } from '../sources/qbit.js';
import { annas } from '../sources/annas.js';
import { metaFixes } from './meta.js';
import { preferredCopy } from './editions.js';
import { readLater, readLaterGone, withoutGone } from './readlists.js';
import { upNext } from './upnext.js';
import { ideas } from './askbook.js';
import { moreLike } from './shelves.js';
import { following } from './people.js';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App as CapApp } from '@capacitor/app';
import { podcasts, showPrefs, episodeVotes } from '../sources/podcasts.js';
import { libby, libbyAccount } from '../sources/libby.js';
import { ai } from './ai.js';
import { persisted, settings, library, progress, bookmarks, addons, abs, debrid, hardcover, goodreads, removedBooks, mergeRemoved, cleanLibrary, cleanProgress, kindle, bookTags, highlights, mergeHighlights } from './store.js';
import { cleanUrl } from './http.js';
import { ttsCfg } from './tts.js';
import { myRatings, notInterested, alreadyRead } from './taste.js';

const BAKED_URL = import.meta.env.VITE_SUPABASE_URL || '';
const BAKED_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const REDIRECT = 'app.inkwell.books://auth';

export const account = persisted('account', {
  url: BAKED_URL,
  anonKey: BAKED_KEY,
  email: '',
  name: '',
  userId: '',
  accessToken: '',
  refreshToken: '',
  expiresAt: 0,
  lastSync: 0,
  syncKeys: true, // also sync TorBox / Real-Debrid / ABS / Hardcover credentials
  status: '',
  // Audiohub's own sync: kept on this phone only (never synced). cfKey opens your data.
  backend: '', // 'cf' | 'supabase' ('' = Supabase if signed in there from before, else cf)
  cfUser: '',
  cfAuth: '',
  cfKey: '',
  cfToken: '',
  cfVersion: 0,
});
import * as cf from './cfsync.js';
// The app's own sync server is built in: a device that saved an empty one earlier
// (or never had it) gets it back, so nobody is ever asked to set up a server.
if (BAKED_URL && (!account.get().url || !account.get().anonKey)) account.patch({ url: account.get().url || BAKED_URL, anonKey: account.get().anonKey || BAKED_KEY });

const SECTIONS = {
  settings: { store: settings },
  // Removals first, so the merges below can drop books removed on any device.
  removedBooks: { store: removedBooks, merge: mergeRemoved },
  library: { store: library, merge: (l, r) => cleanLibrary(mergeById(l, r)) },
  progress: { store: progress, merge: (l, r) => cleanProgress(mergeNewest(l, r)) },
  bookmarks: { store: bookmarks, merge: mergeBookmarks },
  addons: { store: addons },
  goodreads: { store: goodreads },
  myRatings: { store: myRatings, merge: mergeNewest },
  libby: { store: libby },
  libbyAccount: { store: libbyAccount, secret: true },
  podcasts: { store: podcasts },
  qbit: { store: qbit, secret: true },
  qbitSent: { store: qbitSent, merge: mergeSent },
  ai: { store: ai, secret: true },
  abs: { store: abs, secret: true },
  debrid: { store: debrid, secret: true },
  hardcover: { store: hardcover, secret: true },
  tts: { store: ttsCfg, secret: true },
  kindle: { store: kindle, secret: true, merge: mergeKindle },
  bookTags: { store: bookTags },
  highlights: { store: highlights, merge: mergeHighlights },
  // Your own fixes and choices: edited titles / narrators, the copy Play uses, Read later,
  // Up next, saved ideas, taste (not interested, already heard, more like this), podcast prefs.
  metaFixes: { store: metaFixes, merge: mergeById },
  preferredCopy: { store: preferredCopy, merge: mergeById },
  // Removals from Read later first (newest of each side), so the list below can drop them.
  readLaterGone: { store: readLaterGone, merge: mergeLatest },
  readLater: { store: readLater, merge: (l, r) => withoutGone(mergeById(l, r)) },
  upNext: { store: upNext },
  savedIdeas: { store: ideas },
  notInterested: { store: notInterested, merge: mergeById },
  alreadyRead: { store: alreadyRead, merge: mergeById },
  moreLike: { store: moreLike },
  podcastShowPrefs: { store: showPrefs, merge: mergeById },
  episodeVotes: { store: episodeVotes, merge: mergeById },
  following: { store: following },
  // Logins and addresses for the book sources (with "Sync logins" on).
  tracker: { store: tracker, secret: true },
  mamSession: { store: mamSession, secret: true },
  annas: { store: annas, secret: true },
};

// Installs from before the server was built in saved an empty address — use the built-in one.
if (BAKED_URL && !account.get().url) account.patch({ url: BAKED_URL, anonKey: BAKED_KEY });

const stamps = persisted('syncStamps', {}); // section -> last local change time
let applying = false;

// ---- merging ------------------------------------------------------------------
function mergeById(local, remote) {
  return { ...remote, ...local };
}
// uid -> time: the later time of the two sides.
function mergeLatest(local, remote) {
  const out = { ...(remote || {}) };
  for (const [k, t] of Object.entries(local || {})) out[k] = Math.max(Number(t) || 0, Number(out[k]) || 0);
  return out;
}
function mergeNewest(local, remote) {
  const out = { ...local };
  for (const [k, v] of Object.entries(remote || {})) if (!out[k] || (v?.updatedAt || 0) > (out[k]?.updatedAt || 0)) out[k] = v;
  return out;
}
// Sent-to-qBittorrent list: keep every hash from both sides, and the latest "Clear list"
// from either device, so a cleared list doesn't come back from an older copy.
function mergeSent(local, remote) {
  const items = { ...(remote?.items || {}) };
  for (const [h, v] of Object.entries(local?.items || {})) {
    const r = items[h];
    items[h] = !r ? v : { ...r, ...v, at: Math.max(v?.at || 0, r?.at || 0), removed: !!(v?.removed || r?.removed) || undefined, hidden: !!(v?.hidden || r?.hidden) || undefined };
  }
  return { ...remote, ...local, items, clearedAt: Math.max(local?.clearedAt || 0, remote?.clearedAt || 0) };
}
// Kindles and Gmail senders: both lists kept (by address) — an empty or older list from
// another device must never wipe the ones on this phone.
function mergeKindle(local, remote) {
  const byEmail = (a = [], b = []) => {
    const out = [...a];
    for (const x of b || []) if (x?.email && !out.some((y) => y.email?.toLowerCase() === x.email.toLowerCase())) out.push(x);
    return out;
  };
  return { ...local, targets: byEmail(local?.targets, remote?.targets), senders: byEmail(local?.senders, remote?.senders) };
}

function mergeBookmarks(local, remote) {
  const out = { ...local };
  for (const [k, list] of Object.entries(remote || {})) {
    const seen = new Set((out[k] || []).map((b) => b.createdAt));
    out[k] = [...(out[k] || []), ...(list || []).filter((b) => !seen.has(b.createdAt))].sort((a, b) => (a.global || 0) - (b.global || 0));
  }
  return out;
}

// ---- auth -----------------------------------------------------------------------
const cfg = () => account.get();
// A real server address (https://xxxx.supabase.co) — not an email typed into the wrong box.
export const goodServer = (u) => /^https?:\/\/[^/@\s]+\.[^/@\s]+/i.test(String(u || '').trim()) && !String(u).includes('@');
/** A server address was saved but it isn't one (e.g. an email) — Settings asks for it again. */
export const badServer = () => !!cfg().url && !goodServer(cfg().url);
/** Which sync service: Audiohub's own (encrypted) unless you're signed in to Supabase from before. */
export const backend = () => cfg().backend || (cfg().refreshToken ? 'supabase' : 'cf');
const supaConfigured = () => !!(cfg().url && cfg().anonKey) && goodServer(cfg().url);
export const configured = () => backend() === 'cf' || supaConfigured();
export const signedIn = () => (backend() === 'cf' ? !!(cfg().cfKey && cfg().cfUser) : !!cfg().refreshToken);

async function api(path, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(cfg().url.replace(/\/+$/, '') + path, {
    method,
    headers: {
      apikey: cfg().anonKey,
      Authorization: `Bearer ${token || cfg().anonKey}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) {
    const msg = data?.msg || data?.error_description || data?.message || data?.error || `HTTP ${res.status}`;
    const e = new Error(msg);
    e.status = res.status;
    throw e;
  }
  return data;
}

function saveSession(s) {
  account.patch({
    accessToken: s.access_token,
    refreshToken: s.refresh_token,
    expiresAt: Date.now() + (s.expires_in || 3600) * 1000,
    userId: s.user?.id || cfg().userId,
    email: s.user?.email || cfg().email,
    // The name your sign-in gives (Google), for Home's greeting.
    name: s.user?.user_metadata?.full_name || s.user?.user_metadata?.name || cfg().name || '',
  });
}

export function configure(url, anonKey) {
  if (!goodServer(cleanUrl(url))) throw new Error('That isn’t a server address — paste the Project URL from Supabase (https://xxxx.supabase.co), not your email.');
  account.patch({ url: cleanUrl(url).replace(/\/+$/, ''), anonKey: anonKey.trim() });
}

export async function signUp(email, password) {
  const r = await api('/auth/v1/signup', { method: 'POST', body: { email: email.trim(), password } });
  if (r?.access_token) {
    saveSession(r);
    await syncNow({ first: true });
    return 'Account created — you are signed in';
  }
  account.patch({ email: email.trim() });
  return 'Check your email to confirm the account, then sign in';
}

export async function signIn(email, password) {
  const r = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: email.trim(), password } });
  saveSession(r);
  await syncNow({ first: true });
  return 'Signed in — your data is synced';
}

/** Which sign-in methods the server has switched on, e.g. { email: true, google: false }. */
export async function providers() {
  try {
    const r = await api('/auth/v1/settings');
    return { email: r?.external?.email !== false, google: !!r?.external?.google };
  } catch {
    return { email: true, google: false };
  }
}

export async function resetPassword(email) {
  await api('/auth/v1/recover', { method: 'POST', body: { email: email.trim() } });
  return 'Password reset email sent';
}

/** Google (or other OAuth providers enabled in Supabase) via the system browser. */
export async function signInWith(provider = 'google') {
  const url = `${cfg().url}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(Capacitor.isNativePlatform() ? REDIRECT : location.href.split('#')[0])}`;
  if (Capacitor.isNativePlatform()) await Browser.open({ url });
  else location.href = url;
}

async function handleRedirect(href) {
  const frag = (href.split('#')[1] || href.split('?')[1] || '').trim();
  const p = new URLSearchParams(frag);
  if (p.get('error_description')) throw new Error(p.get('error_description'));
  const access = p.get('access_token');
  const refresh = p.get('refresh_token');
  if (!access || !refresh) return false;
  const user = await api('/auth/v1/user', { token: access });
  saveSession({ access_token: access, refresh_token: refresh, expires_in: +p.get('expires_in') || 3600, user });
  await syncNow({ first: true });
  return true;
}

// ---- Audiohub's own sync (encrypted) --------------------------------------------
async function cfStart(email, password, create) {
  if (String(password || '').length < 8) throw new Error('Use a password of at least 8 characters');
  account.patch({ status: 'Securing your account…' });
  const k = await cf.deriveKeys(email, password);
  const r = create ? await cf.signup(k.user, k.auth) : await cf.login(k.user, k.auth);
  account.patch({ backend: 'cf', email: email.trim(), cfUser: k.user, cfAuth: k.auth, cfKey: k.key, cfToken: r.token, cfVersion: 0, status: '' });
  await syncNow({ first: true });
}
export async function cfSignUp(email, password) {
  await cfStart(email, password, true);
  return 'Account created — your data is encrypted and synced';
}
export async function cfSignIn(email, password) {
  await cfStart(email, password, false);
  return 'Signed in — your data is synced';
}
/** From Supabase to Audiohub's own sync: this phone's data (already merged) goes up encrypted. */
export async function moveToOwn(password) {
  const email = cfg().email;
  if (!email) throw new Error('No email on this account');
  try {
    await syncNow(); // the latest from Supabase first
  } catch {}
  const k = await cf.deriveKeys(email, password);
  let r;
  try {
    r = await cf.signup(k.user, k.auth);
  } catch (e) {
    if (e.status !== 409) throw e;
    r = await cf.login(k.user, k.auth); // already moved from another device
  }
  account.patch({ backend: 'cf', cfUser: k.user, cfAuth: k.auth, cfKey: k.key, cfToken: r.token, cfVersion: 0, accessToken: '', refreshToken: '', expiresAt: 0 });
  await syncNow({ first: true });
  return 'Moved — Supabase is no longer used';
}
/** A sign-in token for the Worker (signing in again by itself when it ran out). */
async function cfToken(force = false) {
  if (!force && cfg().cfToken) return cfg().cfToken;
  const r = await cf.login(cfg().cfUser, cfg().cfAuth);
  account.patch({ cfToken: r.token });
  return r.token;
}
async function cfSync(first) {
  let tok = await cfToken();
  let remote;
  try {
    remote = await cf.getData(tok);
  } catch (e) {
    if (e.status !== 401) throw e;
    tok = await cfToken(true);
    remote = await cf.getData(tok);
  }
  if (remote.blob) apply(await cf.open(remote.blob, cfg().cfKey));
  let base = remote.version || 0;
  // Saved by another device in between: merge its copy, then try again (twice at most).
  for (let i = 0; i < 3; i++) {
    try {
      const r = await cf.putData(tok, await cf.seal(snapshot(), cfg().cfKey), base);
      account.patch({ cfVersion: r.version, lastSync: Date.now(), status: first ? 'Synced' : '' });
      lastCfPush = Date.now();
      return;
    } catch (e) {
      if (e.status !== 409 || i === 2) throw e;
      if (e.data?.blob) apply(await cf.open(e.data.blob, cfg().cfKey));
      base = e.data?.version || 0;
    }
  }
}
let lastCfPush = 0;

/** A backup file of your data (keys and logins only when asked): JSON text. */
export function exportBackup(withKeys = false) {
  const sections = {};
  for (const [k, sec] of Object.entries(SECTIONS)) {
    if (sec.secret && !withKeys) continue;
    sections[k] = { t: stamps.get()[k] || 0, v: sec.store.get() };
  }
  return JSON.stringify({ app: 'audiohub', kind: 'backup', at: Date.now(), withKeys, sections });
}
/** Bring a backup file back: merged with what's on this phone, as another device's copy would be. */
export function importBackup(text) {
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    throw new Error("That isn't an Audiohub backup file");
  }
  if (d?.app !== 'audiohub' || !d.sections) throw new Error("That isn't an Audiohub backup file");
  // Its own keys and logins come back even with "Sync service keys" off.
  const keep = cfg().syncKeys;
  if (d.withKeys) account.patch({ syncKeys: true });
  apply(d.sections);
  if (d.withKeys && !keep) setTimeout(() => account.patch({ syncKeys: keep }), 600);
  return `Backup from ${new Date(d.at).toLocaleDateString()} brought back`;
}
/** Delete your synced copy and account on the server (this phone keeps everything). */
export async function deleteOwnAccount() {
  await cf.deleteAccount(await cfToken());
  account.patch({ backend: '', cfUser: '', cfAuth: '', cfKey: '', cfToken: '', cfVersion: 0, lastSync: 0, status: '' });
  return 'Your synced copy was deleted — everything stays on this phone';
}

export async function signOut() {
  if (backend() === 'cf') {
    await cf.logout(cfg().cfToken);
    account.patch({ backend: '', cfUser: '', cfAuth: '', cfKey: '', cfToken: '', cfVersion: 0, lastSync: 0, status: '' });
    return;
  }
  try {
    if (cfg().accessToken) await api('/auth/v1/logout', { method: 'POST', token: cfg().accessToken });
  } catch {}
  account.patch({ userId: '', accessToken: '', refreshToken: '', expiresAt: 0, lastSync: 0, status: '' });
}

async function token(force = false) {
  if (!signedIn()) throw new Error('Not signed in');
  if (!force && Date.now() < cfg().expiresAt - 60e3) return cfg().accessToken;
  const r = await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: cfg().refreshToken } });
  saveSession(r);
  return r.access_token;
}

// ---- sync ----------------------------------------------------------------------
function snapshot() {
  const out = {};
  for (const [k, s] of Object.entries(SECTIONS)) {
    if (s.secret && !cfg().syncKeys) continue;
    out[k] = { t: stamps.get()[k] || 0, v: s.store.get() };
  }
  return out;
}

function apply(remote) {
  applying = true;
  try {
    for (const [k, s] of Object.entries(SECTIONS)) {
      const r = remote?.[k];
      if (!r || (s.secret && !cfg().syncKeys)) continue;
      const localT = stamps.get()[k] || 0;
      const local = s.store.get();
      if (s.merge) s.store.set(s.merge(local, r.v));
      else if ((r.t || 0) > localT) s.store.set(Array.isArray(r.v) ? r.v : { ...local, ...r.v });
      stamps.set((st) => ({ ...st, [k]: Math.max(localT, r.t || 0) }));
    }
  } finally {
    // store writes are debounced; release after they flush
    setTimeout(() => (applying = false), 400);
  }
}

let syncing = null;
export function syncNow({ first = false } = {}) {
  if (!configured() || !signedIn()) return Promise.resolve();
  if (syncing) return syncing;
  syncing = (async () => {
    if (backend() === 'cf') {
      try {
        account.patch({ status: 'Syncing…' });
        await cfSync(first);
      } catch (e) {
        account.patch({ status: 'Sync failed: ' + e.message });
        throw e;
      } finally {
        syncing = null;
      }
      return;
    }
    try {
      account.patch({ status: 'Syncing…' });
      let tok = await token();
      const uid = cfg().userId;
      const read = () => api(`/rest/v1/user_data?select=data,updated_at&user_id=eq.${uid}`, { token: tok });
      let rows;
      try {
        rows = await read();
      } catch (e) {
        // The sign-in pass ran out early (phone clock off, or the phone slept): renew it and retry once.
        if (e.status !== 401 && !/jwt/i.test(e.message)) throw e;
        tok = await token(true);
        rows = await read();
      }
      if (rows?.[0]?.data) apply(rows[0].data);
      await api('/rest/v1/user_data', {
        method: 'POST',
        token: tok,
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: { user_id: uid, data: snapshot(), updated_at: new Date().toISOString() },
      });
      account.patch({ lastSync: Date.now(), status: first ? 'Synced' : '' });
    } catch (e) {
      const hint = /relation .*user_data.* does not exist|42P01/i.test(e.message) ? ' — run the setup SQL in Supabase first' : '';
      account.patch({ status: 'Sync failed: ' + e.message + hint });
      if (e.status === 400 || e.status === 401) {
        if (/refresh/i.test(e.message)) account.patch({ refreshToken: '' });
      }
      throw e;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

// Push local edits a few seconds after they happen; pull again on resume.
let pushTimer = null;
for (const [k, s] of Object.entries(SECTIONS)) {
  s.store.subscribe(() => {
    if (applying) return;
    // Newer than anything seen so far, even if another device's clock runs ahead of this one's:
    // otherwise a copy stamped "in the future" would undo every change made here.
    stamps.set((st) => ({ ...st, [k]: Math.max(Date.now(), (st[k] || 0) + 1) }));
    if (!signedIn()) return;
    clearTimeout(pushTimer);
    // Audiohub's own sync: at most every 3 minutes (the server's free plan allows about a
    // thousand saves a day; progress changes all the time while a book plays). Closing or
    // leaving the app sends the rest at once.
    const wait = backend() === 'cf' ? Math.max(8000, 180e3 - (Date.now() - lastCfPush)) : 8000;
    pushTimer = setTimeout(() => syncNow().catch(() => {}), wait);
  });
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && signedIn() && Date.now() - cfg().lastSync > 60e3) syncNow().catch(() => {});
  // Leaving the app: what changed since the last save goes now.
  if (document.visibilityState === 'hidden' && signedIn() && pushTimer && Date.now() - lastCfPush > 20e3) {
    clearTimeout(pushTimer);
    pushTimer = null;
    syncNow().catch(() => {});
  }
});
if (Capacitor.isNativePlatform()) {
  CapApp.addListener('appUrlOpen', ({ url }) => {
    if (!url.startsWith(REDIRECT)) return;
    Browser.close().catch(() => {});
    handleRedirect(url).catch((e) => account.patch({ status: 'Sign-in failed: ' + e.message }));
  });
} else if (/access_token=/.test(location.hash)) {
  handleRedirect(location.href).then(() => history.replaceState(null, '', location.pathname)).catch(() => {});
}
setTimeout(() => signedIn() && syncNow().catch(() => {}), 2500);

export const SETUP_SQL = `create table if not exists public.user_data (
  user_id uuid primary key references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_data enable row level security;
drop policy if exists "own data" on public.user_data;
create policy "own data" on public.user_data
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);`;
