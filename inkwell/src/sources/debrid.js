// Debrid cloud libraries — stream the audiobooks already sitting in your
// TorBox or Real-Debrid account, and add new magnets / links to it.
import { getJson, sendForm, qs } from '../lib/http.js';
import { debrid } from '../lib/store.js';
import { matches } from '../lib/match.js';

const AUDIO = /\.(mp3|m4a|m4b|aac|flac|ogg|oga|opus|wav|wma|mka|mp4a)$/i;
const TB = 'https://api.torbox.app/v1/api';
const RD = 'https://api.real-debrid.com/rest/1.0';

const tbKey = () => debrid.get().torbox.trim();
const rdKey = () => debrid.get().realdebrid.trim();
export const tbConnected = () => !!tbKey();
export const rdConnected = () => !!rdKey();

const naturalSort = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
const baseName = (p) => String(p).split('/').pop();

// "Author - Title (Unabridged) [64kbps] {MP3}" -> "Author - Title"
export function cleanTitle(name) {
  return String(name)
    .replace(/\.(zip|rar|7z|m4b|mp3|epub)$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/[\[({][^\])}]*[\])}]/g, ' ')
    .replace(/\b(unabridged|abridged|audiobook|audio ?book|\d{2,3} ?kbps|mp3|m4b|aac|flac|retail|vbr|cbr)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–]+|[\s\-–]+$/g, '')
    .trim() || String(name);
}

function splitAuthor(title) {
  const m = /^(.+?)\s[-–]\s(.+)$/.exec(title);
  return m && m[1].length < 40 ? { author: m[1], title: m[2] } : { author: '', title };
}

function toBook(prefix, source, id, name, files, extra = {}) {
  const clean = cleanTitle(name);
  const { author, title } = splitAuthor(clean);
  return {
    uid: `${prefix}:${id}`,
    source,
    kind: 'audio',
    title,
    author,
    cover: '',
    rawName: name,
    parts: files.length,
    ...extra,
  };
}

// ---------------- TorBox ----------------
const tbHeaders = () => ({ Authorization: `Bearer ${tbKey()}` });

async function tbList(kind) {
  const data = await getJson(`${TB}/${kind}/mylist?bypass_cache=true`, { headers: tbHeaders(), fresh: true });
  return Array.isArray(data?.data) ? data.data : [];
}

const TB_KINDS = [
  ['torrents', 't', 'torrent_id'],
  ['usenet', 'u', 'usenet_id'],
  ['webdl', 'w', 'web_id'],
];

const memo = {};
const remember = (key, fn) => {
  const hit = memo[key];
  if (hit && Date.now() - hit.t < 60e3) return hit.p;
  const p = fn().catch((e) => {
    delete memo[key];
    throw e;
  });
  memo[key] = { t: Date.now(), p };
  return p;
};
export const forget = () => Object.keys(memo).forEach((k) => delete memo[k]);

export const torboxLibrary = () => (tbConnected() ? remember('tb', torboxLibraryRaw) : Promise.resolve([]));
export const realdebridLibrary = () => (rdConnected() ? remember('rd', realdebridLibraryRaw) : Promise.resolve([]));

async function torboxLibraryRaw() {
  const lists = await Promise.all(TB_KINDS.map(([k]) => tbList(k).catch(() => [])));
  const out = [];
  lists.forEach((items, i) => {
    const [, code] = TB_KINDS[i];
    for (const it of items) {
      const files = (it.files || []).filter((f) => AUDIO.test(f.name || f.short_name || ''));
      if (!files.length) continue;
      out.push({ ...toBook('tb', 'tb', `${code}:${it.id}`, it.name, files), addedAt: Date.parse(it.created_at) || 0 });
    }
  });
  return out.sort((a, b) => b.addedAt - a.addedAt);
}

async function tbDetails(book) {
  const [, code, id] = book.uid.split(':');
  const [kind, , param] = TB_KINDS.find(([, c]) => c === code);
  const items = await tbList(kind);
  const it = items.find((x) => String(x.id) === id);
  if (!it) throw new Error('This item is no longer in your TorBox account');
  const files = (it.files || [])
    .filter((f) => AUDIO.test(f.name || f.short_name || ''))
    .map((f) => ({ ...f, name: f.short_name || baseName(f.name) }))
    .sort(naturalSort);
  return {
    ...book,
    description: `${files.length} audio file${files.length === 1 ? '' : 's'} in your TorBox ${kind === 'webdl' ? 'web downloads' : kind}.`,
    tracks: files.map((f, i) => ({
      title: f.name.replace(AUDIO, ''),
      index: i,
      // Download links expire, so they're requested right before playback.
      resolve: async () => {
        const r = await getJson(`${TB}/${kind}/requestdl?` + qs({ token: tbKey(), [param]: id, file_id: f.id, redirect: 'false' }), { fresh: true });
        if (!r?.data) throw new Error(r?.detail || 'TorBox did not return a link');
        return r.data;
      },
    })),
  };
}

async function tbAdd(link) {
  const isMagnet = /^magnet:/i.test(link);
  const path = isMagnet ? '/torrents/createtorrent' : '/webdl/createwebdownload';
  const r = await sendForm(TB + path, 'POST', isMagnet ? { magnet: link } : { link }, tbHeaders());
  if (r && r.success === false) throw new Error(r.detail || 'TorBox rejected the link');
  return r?.detail || 'Added to TorBox';
}

// ---------------- Real-Debrid ----------------
const rdHeaders = () => ({ Authorization: `Bearer ${rdKey()}` });

async function realdebridLibraryRaw() {
  const items = await getJson(`${RD}/torrents?limit=200`, { headers: rdHeaders(), fresh: true });
  // The list endpoint has no file names, so show finished torrents whose name looks
  // like an audiobook; the detail view filters to audio files.
  return (items || [])
    .filter((t) => t.status === 'downloaded')
    .filter((t) => AUDIO.test(t.filename) || !/\.(mkv|avi|mp4|iso|exe|apk)$/i.test(t.filename))
    .map((t) => ({ ...toBook('rd', 'rd', t.id, t.filename, t.links || []), addedAt: Date.parse(t.added) || 0 }));
}

async function rdDetails(book) {
  const id = book.uid.slice(3);
  const info = await getJson(`${RD}/torrents/info/${id}`, { headers: rdHeaders(), fresh: true });
  // Links map 1:1 onto the selected files, in file order.
  const selected = (info.files || []).filter((f) => f.selected).sort((a, b) => a.id - b.id);
  const files = selected
    .map((f, i) => ({ name: baseName(f.path), link: (info.links || [])[i] }))
    .filter((f) => f.link && AUDIO.test(f.name))
    .sort(naturalSort);
  if (!files.length) throw new Error('No audio files in this Real-Debrid torrent');
  return {
    ...book,
    description: `${files.length} audio file${files.length === 1 ? '' : 's'} in your Real-Debrid cloud.`,
    tracks: files.map((f, i) => ({
      title: f.name.replace(AUDIO, ''),
      index: i,
      resolve: async () => {
        const r = await sendForm(`${RD}/unrestrict/link`, 'POST', { link: f.link }, rdHeaders());
        if (!r?.download) throw new Error('Real-Debrid did not return a link');
        return r.download;
      },
    })),
  };
}

async function rdAdd(link) {
  if (/^magnet:/i.test(link)) {
    const r = await sendForm(`${RD}/torrents/addMagnet`, 'POST', { magnet: link }, rdHeaders());
    if (!r?.id) throw new Error('Real-Debrid rejected the magnet');
    await sendForm(`${RD}/torrents/selectFiles/${r.id}`, 'POST', { files: 'all' }, rdHeaders()).catch(() => {});
    return 'Added to Real-Debrid';
  }
  const r = await sendForm(`${RD}/unrestrict/link`, 'POST', { link }, rdHeaders());
  if (!r?.download) throw new Error('Real-Debrid could not unrestrict that link');
  return 'Link unrestricted';
}

// ---------------- shared ----------------
export async function verify(provider, key) {
  key = key.trim();
  if (provider === 'torbox') {
    const r = await getJson(`${TB}/user/me`, { headers: { Authorization: `Bearer ${key}` }, fresh: true });
    return r?.data?.email || 'TorBox account';
  }
  const r = await getJson(`${RD}/user`, { headers: { Authorization: `Bearer ${key}` }, fresh: true });
  return `${r?.username || 'Real-Debrid'}${r?.type ? ` · ${r.type}` : ''}`;
}

export const addLink = (provider, link) => (provider === 'torbox' ? tbAdd(link.trim()) : rdAdd(link.trim()));

export function details(book) {
  return book.uid.startsWith('tb:') ? tbDetails(book) : rdDetails(book);
}

export async function search(term) {
  const [a, b] = await Promise.all([torboxLibrary().catch(() => []), realdebridLibrary().catch(() => [])]);
  return [...a, ...b].filter((x) => matches(term, `${x.title} ${x.author} ${x.rawName || ''}`));
}
