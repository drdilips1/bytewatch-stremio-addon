// Usenet, two ways:
//  - Easynews: its own search; files play straight from Easynews over HTTPS with your Easynews
//    username and password (kept on this phone). Multi-part sets are put together into one book.
//  - Newznab indexers (NZBgeek, NinjaCentral, Treasure Maps…): search the audiobook (3030) and
//    ebook (7020) categories with your API key; an NZB you pick goes to TorBox's Usenet downloader,
//    then it plays like any TorBox book.
// Every language is kept (German books matter to some listeners).
import { getJson, getText, qs } from '../lib/http.js';
import { persisted } from '../lib/store.js';
import { bookKey } from '../lib/rdgroups.js';
import { matches, mainTitle, words } from '../lib/match.js';

export const usenetCfg = persisted('usenet', { indexers: [], easynews: { user: '', pass: '' } });
const cfg = () => usenetCfg.get() || {};
export const easynewsOn = () => !!(cfg().easynews?.user && cfg().easynews?.pass);
export const indexersOn = () => (cfg().indexers || []).some((x) => x.url && x.apikey);
export const usenetOn = () => easynewsOn() || indexersOn();

const AUDIO = /\.(mp3|m4b|m4a|aac|ogg|opus|flac)$/i;
const EBOOK = /\.(epub|pdf|mobi|azw3)$/i;
const fmtOf = (name) => (/\.([a-z0-9]{2,4})$/i.exec(name || '')?.[1] || '').toUpperCase();
const basic = () => 'Basic ' + btoa(unescape(encodeURIComponent(`${cfg().easynews.user}:${cfg().easynews.pass}`)));

// Easynews books you've opened (so Continue can reopen them): uid -> { title, files }.
export const easynewsBooks = persisted('easynewsBooks', {});

// ---------------- Easynews ----------------
const EN = 'https://members.easynews.com';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', Atilde: 'Ã', Acirc: 'Â', copy: '©', eacute: 'é', egrave: 'è', ccedil: 'ç', uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß', ntilde: 'ñ', aacute: 'á', iacute: 'í', oacute: 'ó', uacute: 'ú', reg: '®', laquo: '«', raquo: '»', ndash: '–', mdash: '—' };
/**
 * A file name as Easynews sends it, readable: HTML entities undone, and UTF-8 read twice by
 * mistake put right — "Bren&Atilde;&Acirc;&copy; Brown" → "Brené Brown".
 */
export function cleanName(raw) {
  let s = String(raw || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n] ?? m);
  for (let i = 0; i < 3 && /[ÃÂ][\u0080-\u00ff]/.test(s); i++) {
    try {
      s = decodeURIComponent(escape(s)); // bytes read as Latin-1 → read again as UTF-8
    } catch {
      // Read wrongly twice, with a byte lost on the way ("ÃÂ©"): without the stray "Â" it reads.
      if (!/Â/.test(s)) break;
      s = s.replace(/Â/g, '');
    }
  }
  return s.replace(/\s+/g, ' ').trim();
}

/** Easynews files for these words, grouped into books: [{ key, title, files: [{ name, size, url }] }]. */
export async function easynewsSearch(query, { limit = 250, timeout = 45000, ebooks = false } = {}) {
  if (!easynewsOn()) return [];
  // Easynews' search can take half a minute: give it time (the usual wait is 15 s).
  // An audiobook's page: audio files only; an ebook's: EPUB / PDF.
  const fex = ebooks ? 'epub pdf' : 'm4b m4a mp3';
  const r = await getJson(`${EN}/2.0/search/solr-search/?${qs({ fly: 2, gps: query, pby: limit, pno: 1, sS: 5, s1: 'dsize', s1d: '-', fex, safeO: 0 })}`, { headers: { Authorization: basic() }, fresh: true, timeout });
  const down = r?.downURL || `${EN}/dl`;
  const groups = new Map();
  for (const it of r?.data || []) {
    const hash = it['0'] || it.hash;
    const ext = it['11'] || it.extension || '';
    const rawBase = it['10'] || it.filename || '';
    const base = cleanName(rawBase);
    const name = `${base}${ext}`;
    if (!hash || !(AUDIO.test(name) || EBOOK.test(name))) continue;
    const url = `${down}/${r.dlFarm}/${r.dlPort}/${hash}${ext}/${encodeURIComponent(rawBase)}${ext}`;
    const key = bookKey(name);
    if (!key) continue;
    const g = groups.get(key) || { key, title: base.replace(/[\s._-]+\d{1,3}$/, '').replace(/[._]+/g, ' ').trim() || base, files: [], kind: AUDIO.test(name) ? 'audio' : 'ebook', format: fmtOf(name) };
    if (!g.files.some((f) => f.url === url)) g.files.push({ name, size: Number(it.rawSize) || 0, url });
    groups.set(key, g);
  }
  return [...groups.values()];
}

/** An Easynews book, ready to open: kept so Continue can reopen it. */
export function easynewsBook(g, book = {}) {
  const uid = `en:${g.key.slice(0, 80)}`;
  easynewsBooks.set((all) => {
    const keys = Object.keys(all);
    const next = keys.length > 200 ? Object.fromEntries(keys.slice(-150).map((k) => [k, all[k]])) : { ...all };
    next[uid] = { title: book.title || g.title, author: book.author || '', cover: book.cover || '', files: g.files };
    return next;
  });
  return { uid, source: 'en', kind: g.files.some((f) => AUDIO.test(f.name)) ? 'audio' : 'text', title: book.title || g.title, author: book.author || '', cover: book.cover || '', rawName: g.files[0]?.name || '', parts: g.files.length, format: fmtOf(g.files.find((f) => AUDIO.test(f.name))?.name) };
}

/**
 * An Easynews ebook, opened in the reader: fetched once with your sign-in (the reader can't send
 * it), then kept on the phone like any ebook you open.
 */
export async function easynewsReaderBook(g, book = {}) {
  const f = g.files.find((x) => /\.(epub|pdf)$/i.test(x.name));
  if (!f) throw new Error('No EPUB or PDF in this one');
  const res = await fetch(f.url, { headers: { Authorization: basic() } });
  if (!res.ok) throw new Error(`Easynews answered HTTP ${res.status}`);
  const blobUrl = URL.createObjectURL(new Blob([await res.arrayBuffer()]));
  const format = fmtOf(f.name);
  return {
    uid: `en:${g.key.slice(0, 80)}#ebook`,
    source: 'en',
    kind: 'text',
    title: book.title || g.title,
    author: book.author || '',
    cover: book.cover || '',
    ebookName: f.name,
    ebookFormat: format,
    ebookFile: { name: f.name, format, size: f.size, resolve: async () => blobUrl },
  };
}

/** Playable details of an Easynews book: its files in order, with your sign-in. */
export async function details(book) {
  const x = easynewsBooks.get()[book.uid];
  if (!x) throw new Error('This Easynews book is no longer saved — search for it again on its page');
  if (!easynewsOn()) throw new Error('Sign in to Easynews in Settings → Usenet to play this');
  const headers = { Authorization: basic() };
  const sorted = x.files.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const audio = sorted.filter((f) => AUDIO.test(f.name));
  const ebooks = sorted.filter((f) => EBOOK.test(f.name)).map((f) => ({ name: f.name, format: fmtOf(f.name), size: f.size, resolve: async () => f.url, headers }));
  return {
    ...book,
    title: book.title || x.title,
    author: book.author || x.author,
    cover: book.cover || x.cover,
    kind: audio.length ? 'audio' : 'text',
    description: `${audio.length || ebooks.length} file${(audio.length || ebooks.length) === 1 ? '' : 's'} on Easynews.`,
    tracks: audio.map((f, i) => ({ title: f.name.replace(AUDIO, ''), index: i, size: f.size, url: f.url, headers })),
    ebooks,
  };
}

// ---------------- Newznab indexers ----------------
/** "https://api.nzbgeek.info/" or ".../api" → "https://api.nzbgeek.info". */
export const apiBase = (url) => String(url || '').trim().replace(/\/+$/, '').replace(/\/api$/i, '');

/** One indexer's answer (JSON or RSS / XML) → [{ title, nzb, size, date, category }]. */
export function parseNewznab(body) {
  const out = [];
  if (body && typeof body === 'object') {
    const items = [].concat(body.channel?.item || body.item || body.rss?.channel?.item || []);
    for (const it of items) {
      const attrs = [].concat(it.attr || it['newznab:attr'] || []).map((a) => a['@attributes'] || a);
      const attr = (n) => attrs.find((a) => a.name === n)?.value;
      const enc = it.enclosure?.['@attributes'] || it.enclosure || {};
      out.push({ title: String(it.title || ''), nzb: enc.url || it.link || '', size: Number(enc.length || attr('size')) || 0, date: Date.parse(it.pubDate || '') || 0, category: String(attr('category') || it.category || '') });
    }
    return out.filter((x) => x.title && x.nzb);
  }
  // RSS / XML
  const text = String(body || '');
  for (const m of text.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const it = m[0];
    const tag = (n) => (new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`, 'i').exec(it)?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const attr = (n) => new RegExp(`name="${n}"\\s+value="([^"]*)"`, 'i').exec(it)?.[1];
    const encTag = /<enclosure\b[^>]*>/i.exec(it)?.[0] || '';
    const enc = [null, /url="([^"]+)"/i.exec(encTag)?.[1], /length="(\d+)"/i.exec(encTag)?.[1]];
    const unent = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    out.push({ title: unent(tag('title')), nzb: unent(enc?.[1] || tag('link')), size: Number(enc?.[2] || attr('size')) || 0, date: Date.parse(tag('pubDate')) || 0, category: attr('category') || '' });
  }
  return out.filter((x) => x.title && x.nzb);
}

/** One indexer: its results, or an error it gave (a wrong API key says so). */
export async function searchIndexer(ix, query) {
  const url = `${apiBase(ix.url)}/api?${qs({ t: 'search', q: query, cat: '3030,7020,3000,7000', apikey: ix.apikey, extended: 1, limit: 60, o: 'json' })}`;
  let body;
  try {
    body = await getJson(url, { fresh: true, timeout: 20000 });
  } catch {
    body = await getText(url.replace('&o=json', ''), { timeout: 20000 }); // indexers that only speak XML
  }
  const err = (typeof body === 'object' ? body?.error?.['@attributes']?.description || body?.['@attributes']?.description : /<error[^>]*description="([^"]+)"/i.exec(String(body))?.[1]) || '';
  if (err) throw new Error(err);
  return parseNewznab(body).map((r) => ({ ...r, indexer: ix.name || apiBase(ix.url).replace(/^https?:\/\//, '') }));
}

/** Every indexer at once: [{ ...result, indexer }]. */
export async function indexerSearch(query) {
  const list = (cfg().indexers || []).filter((x) => x.url && x.apikey);
  const all = await Promise.all(list.map((ix) => searchIndexer(ix, query).catch(() => [])));
  return all.flat();
}

// ---------------- both, for a book page ----------------
/**
 * Usenet results for a book: { easynews: [books], indexers: [results] } — only those whose name has
 * the title's words (German titles kept: no language filter).
 */
export async function searchUsenet(title, author = '', { ebooks = false } = {}) {
  const t = mainTitle(title);
  const sn = words(String(author).split(/,|&/)[0]).slice(-1)[0] || '';
  const q = `${t} ${sn}`.trim();
  const fits = (name) => matches(t, name);
  const [en, ix] = await Promise.all([easynewsSearch(q, { ebooks }).catch(() => []), indexerSearch(q).catch(() => [])]);
  // Few hits with the author's name too: the title alone.
  const enMore = en.length < 2 && sn ? await easynewsSearch(t, { ebooks }).catch(() => []) : [];
  const ixMore = ix.length < 2 && sn ? await indexerSearch(t).catch(() => []) : [];
  const seen = new Set();
  return {
    easynews: [...en, ...enMore].filter((g) => fits(g.title) && !seen.has(g.key) && seen.add(g.key)),
    indexers: [...ix, ...ixMore].filter((r) => fits(r.title) && !seen.has(r.nzb) && seen.add(r.nzb)).sort((a, b) => b.date - a.date),
  };
}
