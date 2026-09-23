// Audiobookshelf — connect your self-hosted server: browse libraries, stream,
// and sync listening progress back to the server.
import { getJson, sendJson, qs } from '../lib/http.js';
import { abs } from '../lib/store.js';

const cfg = () => abs.get();
const auth = () => ({ Authorization: `Bearer ${cfg().token}` });
const base = () => cfg().server.replace(/\/+$/, '');
export const connected = () => !!(cfg().server && cfg().token);

export async function login(server, username, password) {
  server = server.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(server)) server = 'https://' + server;
  const res = await sendJson(server + '/login', 'POST', { username, password });
  const token = res?.user?.accessToken || res?.user?.token;
  if (!token) throw new Error('Login failed — check your credentials');
  abs.set({ server, token, username, libraryId: '' });
  const libs = await libraries();
  const book = libs.find((l) => l.mediaType === 'book') || libs[0];
  abs.patch({ libraryId: book?.id || '' });
  return libs;
}

export function logout() {
  abs.set({ server: '', token: '', username: '', libraryId: '' });
}

export async function libraries() {
  const data = await getJson(base() + '/api/libraries', { headers: auth(), fresh: true });
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
  const data = await getJson(
    `${base()}/api/libraries/${cfg().libraryId}/items?` + qs({ limit: 30, sort: 'addedAt', desc: 1, minified: 1 }),
    { headers: auth() }
  );
  return (data.results || []).map(toBook);
}

export async function inProgress() {
  if (!connected()) return [];
  const data = await getJson(`${base()}/api/me/items-in-progress?limit=20`, { headers: auth(), fresh: true });
  return (data.libraryItems || []).map(toBook);
}

export async function search(term) {
  if (!connected() || !cfg().libraryId || !term.trim()) return [];
  const data = await getJson(`${base()}/api/libraries/${cfg().libraryId}/search?` + qs({ q: term, limit: 25 }), { headers: auth() });
  return (data.book || data.podcast || []).map(toBook);
}

export async function details(book) {
  const id = book.uid.slice(4);
  const li = await getJson(`${base()}/api/items/${id}?expanded=1`, { headers: auth() });
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
  const s = await sendJson(`${base()}/api/items/${id}/play`, 'POST', {
    deviceInfo: { clientName: 'Inkwell', deviceId: 'inkwell-android' },
    forceDirectPlay: true,
    mediaPlayer: 'html5',
    supportedMimeTypes: ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/webm', 'audio/x-m4b'],
  }, auth());
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
    await sendJson(`${base()}/api/me/progress/${uid.slice(4)}`, 'PATCH', {
      currentTime,
      duration,
      progress: duration ? Math.min(1, currentTime / duration) : 0,
      isFinished,
    }, auth());
  } catch {}
}
