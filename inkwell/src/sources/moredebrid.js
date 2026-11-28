// More debrid services: AllDebrid, Premiumize and Debrid-Link, next to TorBox and Real-Debrid.
// Each does the same few things: connect with your key, list the audiobooks in your cloud,
// open one (its files, each link fetched fresh when played), and fetch a torrent picked from
// your sources (a cached one plays at once; otherwise it's "downloading — play when ready").
import { mimeFor } from '../lib/mime.js';
import { getJson, sendForm, qs } from '../lib/http.js';
import { debrid } from '../lib/store.js';
import { cleanTitle, splitAuthor, audioFormat, looksLikeVideo, EBOOK } from './debrid.js';

const AUDIO = /\.(mp3|m4b|m4a|aac|ogg|opus|flac|wav)$/i;
const AGENT = 'audiohub';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const natural = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' });

/** provider id → { key (in Settings' debrid store), source (uid prefix), name, keyUrl } */
export const MORE = {
  alldebrid: { source: 'ad', name: 'AllDebrid', keyHint: 'alldebrid.com/apikeys', keyUrl: 'https://alldebrid.com/apikeys/' },
  premiumize: { source: 'pm', name: 'Premiumize', keyHint: 'premiumize.me/account', keyUrl: 'https://www.premiumize.me/account' },
  debridlink: { source: 'dl', name: 'Debrid-Link', keyHint: 'debrid-link.com/webapp/apikey', keyUrl: 'https://debrid-link.com/webapp/apikey' },
};
const BY_SOURCE = Object.fromEntries(Object.entries(MORE).map(([id, p]) => [p.source, id]));
export const isMore = (provider) => !!MORE[provider];
export const keyOf = (provider) => String(debrid.get()[provider] || '').trim();
export const moreConnected = (provider) => isMore(provider) && !!keyOf(provider);
/** The new services you've connected: ['alldebrid', …]. */
export const connectedMore = () => Object.keys(MORE).filter(moreConnected);

// ---------------- talking to each service ----------------
const AD = 'https://api.alldebrid.com/v4';
const PM = 'https://www.premiumize.me/api';
const DL = 'https://debrid-link.com/api/v2';

const ad = (path, params = {}, key = keyOf('alldebrid')) => getJson(`${AD}${path}?${qs({ agent: AGENT, apikey: key, ...params })}`, { fresh: true }).then(okAd);
function okAd(r) {
  if (r?.status !== 'success') throw Object.assign(new Error(`AllDebrid: ${r?.error?.message || 'no answer'}`), { status: /auth|apikey/i.test(r?.error?.code || '') ? 401 : 0 });
  return r.data || {};
}
const pm = (path, params = {}, key = keyOf('premiumize')) => getJson(`${PM}${path}?${qs({ apikey: key, ...params })}`, { fresh: true }).then(okPm);
const pmPost = (path, fields, key = keyOf('premiumize')) => sendForm(`${PM}${path}?${qs({ apikey: key })}`, 'POST', fields, {}).then(okPm);
function okPm(r) {
  if (r?.status !== 'success') throw Object.assign(new Error(`Premiumize: ${r?.message || 'no answer'}`), { status: /auth|key/i.test(r?.message || '') ? 401 : 0 });
  return r;
}
const dlHeaders = (key = keyOf('debridlink')) => ({ Authorization: `Bearer ${key}` });
const dl = (path, params = {}, key) => getJson(`${DL}${path}${Object.keys(params).length ? `?${qs(params)}` : ''}`, { headers: dlHeaders(key), fresh: true }).then(okDl);
const dlPost = (path, fields) => sendForm(`${DL}${path}`, 'POST', fields, dlHeaders()).then(okDl);
function okDl(r) {
  if (!r?.success) throw Object.assign(new Error(`Debrid-Link: ${r?.error || 'no answer'}`), { status: /token|auth/i.test(r?.error || '') ? 401 : 0 });
  return r;
}

/** Check a key: resolves the account's name (for "Connected as …"). */
export async function verifyMore(provider, key) {
  const k = String(key || '').trim();
  if (provider === 'alldebrid') return (await ad('/user', {}, k)).user?.username || 'AllDebrid account';
  if (provider === 'premiumize') return (await pm('/account/info', {}, k)).customer_id ? 'Premiumize account' : 'Premiumize account';
  if (provider === 'debridlink') return (await dl('/account/infos', {}, k)).value?.pseudo || 'Debrid-Link account';
  throw new Error('Unknown service');
}

// ---------------- books ----------------
/** A book from a cloud item: { uid, source, kind, title, author, rawName, parts, format }. */
function bookOf(provider, id, name, files = [], extra = {}) {
  const { author, title } = splitAuthor(cleanTitle(name));
  const audio = files.filter((f) => AUDIO.test(f.name || ''));
  const ebookOnly = files.length > 0 && !audio.length && files.some((f) => EBOOK.test(f.name || ''));
  const format = audioFormat(audio) || audioFormat([{ name }]);
  return { uid: `${MORE[provider].source}:${id}`, source: MORE[provider].source, kind: ebookOnly ? 'text' : 'audio', title, author, cover: '', rawName: name, parts: audio.length || files.length || 1, ...(format ? { format } : {}), ...extra };
}
// Items already listed (their files), so opening one doesn't ask again.
const seen = new Map();

/** The audiobooks in one service's cloud, newest first. */
export async function moreLibrary(provider) {
  if (!moreConnected(provider)) return [];
  let items = [];
  if (provider === 'alldebrid') {
    const magnets = Object.values((await ad('/magnet/status')).magnets || {});
    items = magnets
      .filter((m) => Number(m.statusCode) === 4)
      .map((m) => ({ id: m.id, name: m.filename, files: (m.links || []).map((l) => ({ name: l.filename, size: Number(l.size) || 0, link: l.link })), at: (Number(m.completionDate || m.uploadDate) || 0) * 1000 }));
  } else if (provider === 'premiumize') {
    const list = (await pm('/transfer/list')).transfers || [];
    items = list.filter((t) => t.status === 'finished' && (t.folder_id || t.file_id)).map((t) => ({ id: t.folder_id ? `f-${t.folder_id}` : `i-${t.file_id}`, name: t.name, files: null, at: 0 }));
  } else if (provider === 'debridlink') {
    for (let page = 0; page < 5; page++) {
      const r = await dl('/seedbox/list', { perPage: 50, page });
      for (const t of r.value || []) if (Number(t.downloadPercent) >= 100) items.push({ id: t.id, name: t.name, files: (t.files || []).map((f) => ({ name: f.name, size: Number(f.size) || 0, url: f.downloadUrl })), at: (Number(t.created) || 0) * 1000 });
      if (!r.pagination?.next && r.pagination?.next !== 0) break;
    }
  }
  return items
    .filter((x) => x.name && !looksLikeVideo(x.name))
    .filter((x) => !x.files || x.files.some((f) => AUDIO.test(f.name || '') || EBOOK.test(f.name || '')))
    .map((x) => {
      const b = bookOf(provider, x.id, x.name, x.files || [], { addedAt: x.at });
      if (x.files) seen.set(b.uid, x.files);
      return b;
    })
    // Newest first (the service's own order when it gives no dates).
    .map((b, i) => ({ b, i }))
    .sort((x, y) => (y.b.addedAt || 0) - (x.b.addedAt || 0) || x.i - y.i)
    .map((x) => x.b);
}

/** A Premiumize folder's files (its sub-folders too, a few levels down). */
async function pmFolder(id, depth = 0) {
  const r = await pm('/folder/list', { id });
  const out = [];
  for (const c of r.content || []) {
    if (c.type === 'folder' && depth < 3) out.push(...(await pmFolder(c.id, depth + 1)));
    else if (c.type === 'file') out.push({ name: c.name, size: Number(c.size) || 0, url: c.link });
  }
  return out;
}

/** The files of a cloud book: [{ name, size, link? | url? }]. */
async function filesOf(book) {
  if (seen.has(book.uid)) return seen.get(book.uid);
  const provider = BY_SOURCE[book.source];
  const id = book.uid.slice(book.source.length + 1);
  let files = [];
  if (provider === 'alldebrid') {
    const m = (await ad('/magnet/status', { id })).magnets || {};
    files = (m.links || []).map((l) => ({ name: l.filename, size: Number(l.size) || 0, link: l.link }));
  } else if (provider === 'premiumize') {
    if (id.startsWith('f-')) files = await pmFolder(id.slice(2));
    else {
      const it = await pm('/item/details', { id: id.slice(2) });
      files = [{ name: it.name, size: Number(it.size) || 0, url: it.link }];
    }
  } else if (provider === 'debridlink') {
    const t = ((await dl('/seedbox/list', { ids: id })).value || [])[0];
    files = (t?.files || []).map((f) => ({ name: f.name, size: Number(f.size) || 0, url: f.downloadUrl }));
  }
  seen.set(book.uid, files);
  return files;
}

/** A file's playable link: Premiumize and Debrid-Link give it; AllDebrid unlocks it each time. */
async function linkOf(f) {
  if (f.url) return f.url;
  return (await ad('/link/unlock', { link: f.link })).link;
}

/** Playable details: the audio files in order (and any ebooks in it). */
export async function moreDetails(book) {
  const files = (await filesOf(book)).slice().sort(natural);
  const audio = files.filter((f) => AUDIO.test(f.name || ''));
  const ebooks = files.filter((f) => EBOOK.test(f.name || '')).map((f) => ({ name: f.name, format: (/\.([a-z0-9]+)$/i.exec(f.name)?.[1] || '').toUpperCase(), size: f.size, resolve: () => linkOf(f) }));
  const name = MORE[BY_SOURCE[book.source]]?.name || 'your cloud';
  if (!audio.length && !ebooks.length) throw new Error(`No audio or ebook files in this one in your ${name}`);
  if (!audio.length) return { ...book, kind: 'text', description: `${ebooks.length} ebook file${ebooks.length === 1 ? '' : 's'} in your ${name}.`, tracks: [], ebooks };
  return {
    ...book,
    description: `${audio.length} audio file${audio.length === 1 ? '' : 's'} in your ${name}.`,
    ebooks,
    tracks: audio.map((f, i) => ({ title: String(f.name).replace(AUDIO, ''), mime: mimeFor(f.name), index: i, size: f.size || 0, resolve: () => linkOf(f) })),
  };
}

// ---------------- fetching a torrent from your sources ----------------
/**
 * Put a magnet in the service and wait a little: a book stub when it's ready, else an error
 * with `pending` (the app's "play when ready" list takes over), as for TorBox / Real-Debrid.
 */
export async function morePrepare(provider, magnet, hash, title, onStatus) {
  const name = MORE[provider].name;
  const pending = (progress = 0) => Object.assign(new Error(`Downloading on ${name} (${Math.round(progress * 100)}%)`), { pending: { provider, hash, progress } });
  onStatus?.(`Adding to ${name}…`, null);
  if (provider === 'premiumize') {
    // Already cached: its files at once, no transfer needed.
    const direct = await pmPost('/transfer/directdl', { src: magnet }).catch(() => null);
    const files = (direct?.content || []).map((c) => ({ name: String(c.path || '').split('/').pop(), size: Number(c.size) || 0, url: c.link }));
    if (files.length) {
      const b = bookOf(provider, `h-${hash}`, title || files[0].name, files);
      seen.set(b.uid, files);
      return b;
    }
    await pmPost('/transfer/create', { src: magnet });
    throw pending(0);
  }
  if (provider === 'alldebrid') {
    const up = ((await ad('/magnet/upload', { 'magnets[]': magnet })).magnets || [])[0];
    if (!up?.id) throw new Error(`${name} didn't take this torrent${up?.error?.message ? ` (${up.error.message})` : ''}`);
    for (let i = 0; i < 10; i++) {
      const m = (await ad('/magnet/status', { id: up.id })).magnets || {};
      if (Number(m.statusCode) === 4) {
        const files = (m.links || []).map((l) => ({ name: l.filename, size: Number(l.size) || 0, link: l.link }));
        const b = bookOf(provider, m.id, m.filename || title, files);
        seen.set(b.uid, files);
        return b;
      }
      if (Number(m.statusCode) > 4) throw new Error(`${name} couldn't fetch this torrent (${m.status || 'error'})`);
      onStatus?.(`${name} is fetching it…`, m.size ? (Number(m.downloaded) || 0) / Number(m.size) : null);
      await sleep(i < 4 ? 1000 : 2500);
    }
    throw pending(0);
  }
  // Debrid-Link
  const added = (await dlPost('/seedbox/add', { url: magnet, async: true })).value || {};
  for (let i = 0; i < 10; i++) {
    const t = ((await dl('/seedbox/list', { ids: added.id })).value || [])[0] || added;
    if (Number(t.downloadPercent) >= 100 && (t.files || []).length) {
      const files = t.files.map((f) => ({ name: f.name, size: Number(f.size) || 0, url: f.downloadUrl }));
      const b = bookOf(provider, t.id, t.name || title, files);
      seen.set(b.uid, files);
      return b;
    }
    onStatus?.(`${name} is fetching it…`, (Number(t.downloadPercent) || 0) / 100);
    await sleep(i < 4 ? 1000 : 2500);
  }
  throw pending(0);
}

/**
 * A Usenet download (an NZB link from your indexer) sent to Premiumize, which downloads Usenet too
 * (asked for on Reddit: until now only TorBox took them). Waits a little: { book } when it's done,
 * else { pending: true } — it then shows in Your Premiumize when finished.
 */
export async function sendNzbToPremiumize(nzbUrl, name, onStatus) {
  if (!moreConnected('premiumize')) throw new Error('Connect Premiumize in Settings to send Usenet downloads there');
  onStatus?.('Sending to Premiumize…');
  const r = await pmPost('/transfer/create', { src: nzbUrl });
  for (let i = 0; i < 12; i++) {
    const t = ((await pm('/transfer/list').catch(() => null))?.transfers || []).find((x) => x.id === r.id);
    if (t?.status === 'finished' && (t.folder_id || t.file_id)) {
      return { book: bookOf('premiumize', t.folder_id ? `f-${t.folder_id}` : `i-${t.file_id}`, t.name || name) };
    }
    if (t && /error|deleted|banned|timeout/i.test(t.status || '')) throw new Error(`Premiumize couldn't download it${t.message ? ` (${t.message})` : ''}`);
    onStatus?.(`Premiumize is fetching it… ${t?.progress ? Math.round(t.progress * 100) + '%' : ''}`.trim());
    await sleep(2500);
  }
  return { pending: true };
}
