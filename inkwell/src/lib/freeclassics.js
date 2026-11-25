// "Free classics": public-domain audiobooks to browse — LibriVox's catalogue (on the Internet
// Archive) and Project Gutenberg's human-read audiobooks — in one list, each book once (the
// LibriVox copy first when both have it), labelled with where it plays from.
import { sameWork } from './works.js';

export const LANGS = [
  ['', 'Any language', '', ''],
  ['en', 'English', 'English OR eng', 'en'],
  ['hi', 'Hindi', 'Hindi OR hin', 'hi'],
  ['de', 'German', 'German OR deu OR ger', 'de'],
  ['fr', 'French', 'French OR fre OR fra', 'fr'],
  ['es', 'Spanish', 'Spanish OR spa', 'es'],
  ['it', 'Italian', 'Italian OR ita', 'it'],
];
export const GENRES = [
  ['', 'All'],
  ['mystery', 'Mystery'],
  ['adventure', 'Adventure'],
  ['romance', 'Romance'],
  ['science fiction', 'Sci-fi'],
  ['children', 'Children'],
  ['poetry', 'Poetry'],
  ['history', 'History'],
  ['philosophy', 'Philosophy'],
  ['short stories', 'Short stories'],
  ['humor', 'Humour'],
];

/** The Internet Archive search for the LibriVox catalogue with these filters. */
export function iaQuery(lang = '', genre = '') {
  const l = LANGS.find((x) => x[0] === lang)?.[2];
  return `collection:librivoxaudio${l ? ` AND language:(${l})` : ''}${genre ? ` AND subject:(${genre.replace(/[():"]/g, ' ')})` : ''}`;
}

/** Lists from several places → one list, each book once, the earlier list's copy kept. */
export function mergeFree(lists) {
  const out = [];
  for (const [label, books] of lists)
    for (const b of books || []) if (b?.title && !out.some((x) => sameWork(x, b))) out.push({ ...b, freeFrom: label });
  return out;
}
