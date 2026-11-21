// Real-Debrid's Downloads list (every file-host link opened through it — Rapidgator, Nitroflare…)
// as books. The phone that sent a book keeps its group, but another phone (the iPhone) only
// sees Real-Debrid's flat list of files: files of one book are put back together by their
// names — "Atomic Habits 01.mp3", "Atomic Habits 02.mp3" → "Atomic Habits", 2 files.
import { searchTitle } from './match.js';

const AUDIO = /\.(mp3|m4b|m4a|aac|ogg|opus|flac|wav)$/i;
const EBOOK = /\.(epub|pdf|mobi|azw3?)$/i;

/** The book a file belongs to: its name without the extension, part / track numbers and noise. */
export function bookKey(filename) {
  const plain = String(filename || '')
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/^\s*\d{1,3}\s*[-._)\]]\s*/, '') // "01 - Title"
    .replace(/[\s._-]+\d{1,3}\s*(of\s*\d{1,3})?\s*$/i, ''); // "Title 01", "Title_05 of 12"
  return searchTitle(plain).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Real-Debrid downloads → books: [{ key, title, files: [{ name, size, link }], at }], newest
 * first. Only audio and ebook files; links the phone already keeps in a book of its own
 * (`known`) are left out, so nothing shows twice.
 */
export function groupDownloads(list, known = new Set()) {
  const groups = new Map();
  for (const d of list || []) {
    const name = String(d?.filename || '');
    if (!d?.link || known.has(d.link) || !(AUDIO.test(name) || EBOOK.test(name))) continue;
    const key = bookKey(name);
    if (!key) continue;
    const g = groups.get(key) || { key, title: searchTitle(name.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[\s._-]+\d{1,3}\s*$/, '')) || name, files: [], at: 0 };
    if (!g.files.some((f) => f.link === d.link)) g.files.push({ name, size: Number(d.filesize) || 0, link: d.link });
    g.at = Math.max(g.at, Date.parse(d.generated) || 0);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.at - a.at);
}
