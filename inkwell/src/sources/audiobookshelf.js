// Audiobookshelf — connect your self-hosted server: browse libraries, stream,
// and sync listening progress back to the server.
import { getJson, sendJson, qs, cleanUrl } from '../lib/http.js';
import { abs } from '../lib/store.js';

const cfg = () => abs.get();
const auth = () => ({ Authorization: `Bearer ${cfg().token}` });
const base = () => cfg().server.replace(/\/+$/, '');
export const connected = () => !!(cfg().server && cfg().token);

function normalizeServer(server) {
  const bare = cleanUrl(server, '').replace(/^:\/\//, '');
  // LAN servers are almost always plain http, so default to that when no scheme is typed.
  const isLocal = /^((\d{1,3}\.){3}\d{1,3}|localhost|[^/:]+\.local)([:/]|$)/i.test(bare);
  return cleanUrl(server, isLocal ? 'http' : 'https').replace(/\/+$/, '').replace(/\/login$/i, '');
}

// Authenticated GET/POST that transparently refreshes short-lived access
// tokens (Audiobookshelf 2.26+) once before giving up.
async function call(path, { method = 'GET', body, fresh } = {}) {
  const run = () =>
    method === 'GET' ? getJson(base() + path, { headers: auth(), fresh }) : sendJson(base() + path, method, body, auth());
  try {
    return await run();
  } catch (e) {
    if (e.status === 401 && cfg().refreshToken && (await refresh())) return run();
    if (e.status === 401) throw new Error('Audiobookshelf session expired — please sign in again');
    throw e;
  }
}

async function refresh() {
  try {
    const res = await sendJson(base() + '/auth/refresh', 'POST', undefined, { 'x-refresh-token': cfg().refreshToken });
    const token = res?.user?.accessToken;
    if (!token) return false;
    abs.patch({ token, refreshToken: res.user.refreshToken || cfg().refreshToken });
    return true;
  } catch {
    return false;
  }
}

async function pickLibrary() {
  const libs = await libraries();
  const book = libs.find((l) => l.mediaType === 'book') || libs[0];
  abs.patch({ libraryId: book?.id || '' });
  return libs;
}

export async function login(server, username, password) {
  server = normalizeServer(server);
  let res;
  try {
    res = await sendJson(server + '/login', 'POST', { username: username.trim(), password }, { 'x-return-tokens': 'true' });
  } catch (e) {
    if (e.status === 401) throw new Error('Wrong username or password');
    if (!e.status) throw new Error(`Can't reach ${server} — check the address and that your phone is on the same network`);
    throw e;
  }
  const u = res?.user || {};
  // Prefer the long-lived legacy token when the server still issues one.
  const token = u.token || u.accessToken;
  if (!token) throw new Error('Login failed — the server returned no token');
  abs.set({ server, token, refreshToken: u.token ? '' : u.refreshToken || '', username: u.username || username, libraryId: '' });
  return pickLibrary();
}

// Sign in with an API key (Settings → API Keys in Audiobookshelf 2.26+) or a legacy token.
export async function loginWithKey(server, key) {
  server = normalizeServer(server);
  const token = String(key).trim().replace(/^Bearer\s+/i, '');
  const me = await getJson(server + '/api/me', { headers: { Authorization: `Bearer ${token}` }, fresh: true }).catch((e) => {
    throw new Error(e.status === 401 ? 'That API key was rejected' : `Can't reach ${server}`);
  });
  abs.set({ server, token, refreshToken: '', username: me.username || 'API key', libraryId: '' });
  return pickLibrary();
}

export function logout() {
  abs.set({ server: '', token: '', refreshToken: '', username: '', libraryId: '' });
}

export async function libraries() {
  const data = await call('/api/libraries', { fresh: true });
  return data.libraries || [];
}

function toBook(item) {
  const li = item.libraryItem || item;
  const md = li.media?.metadata || {};
  return {
    uid: 'abs:' + li.id,
    source: 'abs',
    kind: li.media?.numAudioFiles === 0 && li.media?.ebookFormat ? 'text' : 'audio',
    title: md.title || li.name || 'Untitled',
    author: md.authorName || (md.authors || []).map((a) => a.name).join(', '),
    cover: li.media?.coverPath ? `${base()}/api/items/${li.id}/cover?${qs({ token: cfg().token, width: 400 })}` : '',
    year: md.publishedYear || '',
    duration: li.media?.duration || 0,
  };
}

export async function recent() {
  if (!connected() || !cfg().libraryId) return [];
  const data = await call(`/api/libraries/${cfg().libraryId}/items?` + qs({ limit: 30, sort: 'addedAt', desc: 1, minified: 1 }));
  return (data.results || []).map(toBook);
}

export async function inProgress() {
  if (!connected()) return [];
  const data = await call('/api/me/items-in-progress?limit=20', { fresh: true });
  return (data.libraryItems || []).map(toBook);
}

export async function search(term) {
  if (!connected() || !cfg().libraryId || !term.trim()) return [];
  const data = await call(`/api/libraries/${cfg().libraryId}/search?` + qs({ q: term, limit: 25 }));
  return (data.book || data.podcast || []).map(toBook);
}

export async function details(book) {
  const id = book.uid.slice(4);
  const li = await call(`/api/items/${id}?expanded=1`);
  const b = toBook(li);
  const md = li.media?.metadata || {};
  return {
    ...book,
    ...b,
    description: md.description || '',
    subjects: md.genres || [],
    narrator: md.narratorName,
    series: md.seriesName,
    chaptersMeta: (li.media?.chapters || []).map((c) => ({ title: c.title, start: c.start, end: c.end })),
    tracks: null, // resolved at play time through a playback session
    resolveTracks: () => startSession(id),
    link: `${base()}/item/${id}`,
  };
}

async function startSession(id) {
  const s = await call(`/api/items/${id}/play`, { method: 'POST', body: {
    deviceInfo: { clientName: 'Inkwell', deviceId: 'inkwell-android' },
    forceDirectPlay: true,
    mediaPlayer: 'html5',
    supportedMimeTypes: ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/webm', 'audio/x-m4b'],
  } });
  const tok = cfg().token;
  const tracks = (s.audioTracks || []).map((t, i) => ({
    title: t.title || t.metadata?.filename || `Part ${i + 1}`,
    url: (/^https?:/.test(t.contentUrl) ? t.contentUrl : base() + t.contentUrl) + (t.contentUrl.includes('?') ? '&' : '?') + qs({ token: tok }),
    duration: t.duration,
    offset: t.startOffset,
    index: i,
  }));
  return { tracks, sessionId: s.id, startTime: s.currentTime || 0 };
}

export async function syncProgress(uid, currentTime, duration, isFinished = false) {
  if (!connected() || !uid.startsWith('abs:')) return;
  try {
    await call(`/api/me/progress/${uid.slice(4)}`, {
      method: 'PATCH',
      body: { currentTime, duration, progress: duration ? Math.min(1, currentTime / duration) : 0, isFinished },
    });
  } catch {}
}
