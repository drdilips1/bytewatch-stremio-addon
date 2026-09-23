import * as ia from './archive.js';
import * as lv from './librivox.js';
import * as gb from './gutenberg.js';
import * as ol from './openlibrary.js';
import * as absSrc from './audiobookshelf.js';
import * as addonSrc from './addons.js';
import { settings } from '../lib/store.js';

export const SOURCES = {
  ia: { name: 'Internet Archive', short: 'Archive', hue: 28, kind: 'Listen', blurb: 'LibriVox mirror, old-time radio & spoken word', impl: ia },
  lv: { name: 'LibriVox', short: 'LibriVox', hue: 350, kind: 'Listen', blurb: '20,000+ volunteer-read public-domain audiobooks', impl: lv },
  gb: { name: 'Project Gutenberg', short: 'Gutenberg', hue: 150, kind: 'Read', blurb: '75,000+ free classic ebooks, read in-app', impl: gb },
  ol: { name: 'Open Library', short: 'Open Library', hue: 210, kind: 'Discover', blurb: 'Trending books, rich descriptions & covers', impl: ol },
  abs: { name: 'Audiobookshelf', short: 'My Server', hue: 265, kind: 'Listen', blurb: 'Your self-hosted audiobook server', impl: absSrc },
  addon: { name: 'Addons', short: 'Addon', hue: 185, kind: 'Listen', blurb: 'Community catalog addons', impl: addonSrc },
};

const enabled = (k) => settings.get().sources[k === 'addon' ? 'addons' : k] !== false;

export function sourceOf(uid) {
  const p = uid.split(':')[0];
  return p === 'addon' ? 'addon' : p;
}

export async function getDetails(book) {
  const src = SOURCES[sourceOf(book.uid)];
  return src.impl.details(book);
}

// Search every enabled source in parallel; results stream in per source.
export function searchAll(term, onResult) {
  const jobs = [
    ['ia', () => ia.search(term)],
    ['lv', () => lv.search(term)],
    ['gb', () => gb.search(term)],
    ['ol', () => ol.search(term)],
    ['abs', () => absSrc.search(term)],
    ['addon', () => addonSrc.search(term)],
  ].filter(([k]) => enabled(k) && (k !== 'abs' || absSrc.connected()));
  return Promise.all(
    jobs.map(([k, fn]) =>
      fn()
        .then((items) => onResult(k, items, null))
        .catch((err) => onResult(k, [], err))
    )
  );
}

// Look for listenable / readable editions of a book discovered elsewhere.
export async function findEditions(book) {
  const t = book.title.replace(/[:(].*$/, '').trim();
  const author = (book.author || '').split(',')[0].split(' ').pop();
  const [audio, text] = await Promise.all([
    enabled('ia') ? ia.query(`title:(${t.replace(/[():"]/g, ' ')})${author ? ` AND creator:(${author})` : ''}`, { rows: 8 }).catch(() => []) : [],
    enabled('gb') ? gb.search(`${t} ${author}`).catch(() => []) : [],
  ]);
  return { audio, text: text.slice(0, 8) };
}

export { ia, lv, gb, ol, absSrc, addonSrc, enabled };
