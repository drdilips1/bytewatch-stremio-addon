// Voice command: "play when Harry first boards the Hogwarts Express". Your AI service
// works out the book and where the scene is (which chapter, how far in, a line from it);
// the book is found on your phone, in your downloads, books you've played, then your
// Audiobookshelf and TorBox / Real-Debrid; it starts 30 seconds before the scene.
import { askAi, parseJson } from './ai.js';
import { mainTitle, matches, words } from './match.js';
import { progress, settings } from './store.js';
import { downloads } from './downloads.js';
import { localCfg } from '../sources/local.js';
import { getDetails, findOwned } from '../sources/index.js';
import { heardLines } from './transcript.js';
import * as player from './player.js';
import { findOrder, placeOf } from './findorder.js';
import { STOPWORDS } from './scenefind.js';

const LEAD = 30; // seconds before the scene
const NOISE = new Set(['unabridged', 'abridged', 'audiobook', 'audio', 'book', 'a', 'novel', 'edition', 'mp3', 'm4b', 'by', 'read', 'narrated', 'the', 'and']);
const surname = (a) => String(a || '').split(',')[0].trim().split(/\s+/).pop()?.toLowerCase() || '';
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);

/** What was asked for: { title, author, scene, chapter, chapterTitle, at, quote } (title '' if not a book request). */
async function understand(said) {
  const now = player.getState().book;
  const playing = now && now.source !== 'pod' ? `\nThey are listening to "${now.title}"${now.author ? ` by ${now.author}` : ''}: if they don't name another book, they mean this one.` : '';
  const raw = await askAi(
    `Someone said to their audiobook app: "${said}"${playing}
It comes from speech recognition, so it may be misheard: Indian-accented English, Hindi or Hinglish, names written as they sounded ("dumble door" = Dumbledore, "harry potter ki pehli train" = Harry boarding the Hogwarts Express). Work out what they meant.
Work out which book they mean and where in it the moment they describe happens. The JSON is always in English, with names spelled as in the book.
Return JSON: {"title":"the book's title","book":"","author":"","moment":true,"scene":"the moment, in under 12 words","chapter":0,"chapterTitle":"","at":0.0,"quote":"","keywords":[""]}
- moment: false when they only ask to play the book itself ("play The Secret by Rhonda Byrne") — then leave scene, chapter, quote and keywords empty.
- title: the single book the moment is in (in a series, that volume: "Harry Potter and the Philosopher's Stone", not "Harry Potter"); book: the same title as printed in the UK edition, if different.
- chapter: the chapter number in that book (0 if it's in a prologue or you don't know).
- chapterTitle: that chapter's title, if it has one.
- at: how far into that chapter the moment starts, from 0.0 (its start) to 1.0 (its end).
- quote: 6–12 words of the book's own text from the start of that moment, only if you're sure of them, else "".
- keywords: 5–8 words that appear in the book's own text right at that moment and rarely elsewhere — names, places, objects, unusual words (for "Dumbledore awards the House Cup": "Dumbledore", "House Cup", "points", "Neville", "Slytherin", "decorations"). Not common words.
If they don't name or describe a book you can identify, return {"title":""}.`,
    { json: true }
  );
  return parseJson(raw);
}

/**
 * Your own copies of the book, in the order set in Settings (by default: TorBox / Real-Debrid
 * — your default one first — then the phone, Audiobookshelf, anything else you've played).
 * The book playing now always comes first (nothing to reopen).
 */
async function findCopies(want) {
  const t = mainTitle(want.title || '');
  const sn = surname(want.author);
  const audio = (b) => b && b.kind !== 'text' && !String(b.uid || '').endsWith('#ebook') && (!sn || !b.author || String(b.author).toLowerCase().includes(sn));
  // The book's own title: "The Secret" is not "The Secret History" — extra words are allowed
  // only when they're the author's name, a year or the usual noise ("Unabridged").
  const authorWords = new Set(words(want.author));
  const fits = (title) => {
    if (!title || !matches(t, title)) return false;
    const mine = new Set(words(t));
    return words(mainTitle(title)).every((w) => mine.has(w) || authorWords.has(w) || NOISE.has(w) || /^\d+$/.test(w));
  };
  const same = (b) => fits(b.title) || (!b.title && fits(b.rawName));
  // The whole series in one audiobook ("Harry Potter (Pottermore)" for "Harry Potter and the
  // Philosopher's Stone"): it has the book too, tried after copies of the book itself.
  const series = (b) => !!mainTitle(b.title || '') && matches(mainTitle(b.title || ''), t);
  const out = [];
  const add = (b, local = false) => audio(b) && (same(b) || series(b)) && !out.some((x) => x.b.uid === b.uid) && out.push({ b, local, loose: !same(b) });
  add(player.getState().book);
  for (const b of localCfg.get().books || []) add(b, true);
  for (const d of Object.values(downloads.get() || {})) if (d?.status === 'done') add(d.book, true);
  try {
    const owned = await findOwned({ title: want.title, author: want.author || '' });
    for (const b of [...owned.cloud, ...owned.server]) add(b);
  } catch {}
  for (const p of Object.values(progress.get() || {}).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))) add(p.book);
  const first = settings.get().debridPreferred === 'realdebrid' ? 'rd' : 'tb';
  const src = (b) => String(b.source || b.uid || '').split(':')[0];
  const order = findOrder('audio');
  const rank = ({ b, local, loose }) => {
    if (b.uid === player.getState().book?.uid) return -1;
    const place = placeOf(b, local);
    // Within TorBox / Real-Debrid: your default one first.
    return (loose ? 100 : 0) + order.indexOf(place) * 2 + (place === 'debrid' && src(b) !== first ? 1 : 0);
  };
  return out.sort((x, y) => rank(x) - rank(y)).map((x) => x.b);
}

/** The chapter the AI named, in this audiobook's own chapter list. */
function pickChapter(chapters, want) {
  if (!chapters.length) return -1;
  const n = Number(want.chapter) || 0;
  const tt = norm(want.chapterTitle).filter((w) => w.length > 2);
  if (tt.length) {
    const scored = chapters.map((c, i) => [i, norm(c.title).filter((w) => tt.includes(w)).length / tt.length]).sort((a, b) => b[1] - a[1]);
    if (scored[0][1] >= 0.6) return scored[0][0];
  }
  if (n > 0) {
    // "Chapter 7", "7", "07 - …", "Chapter Seven" is rarer — numbers first.
    const re = new RegExp(`(^|\\D)0*${n}(\\D|$)`);
    const byNum = chapters.findIndex((c) => re.test(c.title || '') && !/part|disc|cd/i.test((c.title || '').replace(/chapter/i, '')));
    if (byNum >= 0) return byNum;
    // Opening credits / prologue before chapter 1 shift the count.
    const first = chapters.findIndex((c) => !/credit|intro|prolog|dedicat|title|opening|copyright/i.test(c.title || ''));
    return Math.min(chapters.length - 1, Math.max(0, first) + n - 1);
  }
  return /prolog/i.test(want.chapterTitle || '') ? Math.max(0, chapters.findIndex((c) => /prolog/i.test(c.title || ''))) : 0;
}

/** The moment in what you've heard with the transcript on (book seconds), if the quote is there. */
function findHeard(uid, quote, part) {
  // Only the quote's telling words count ("the", "and", "Harry" match anything); most must be there.
  const q = [...new Set(norm(quote).filter((w) => w.length > 3 && !STOPWORDS.has(w)))];
  if (q.length < 4) return null;
  const from = part[0]?.start ?? 0;
  const to = part[part.length - 1]?.end ?? Infinity;
  let best = null;
  for (const l of heardLines(uid)) {
    const g = player.trackOffset(l.track) + l.start;
    if (g < from || g > to) continue;
    const w = new Set(norm(l.text));
    const hit = q.filter((x) => w.has(x)).length / q.length;
    if (hit >= 0.8 && (!best || hit > best.hit)) best = { hit, g };
  }
  return best?.g ?? null;
}

/**
 * The parts of the audio that are this book. A series in one audiobook ("Harry Potter
 * (Pottermore)") holds several books: only the parts named after the one asked for.
 */
function volumeOf(chapters, book, want) {
  const names = [want.title, want.book].filter(Boolean);
  const isIt = (text) => names.some((n) => matches(mainTitle(n), text || ''));
  if (isIt(book.title) || !chapters.length) return chapters;
  const own = chapters.filter((c) => isIt(c.title));
  return own.length ? own : chapters;
}

const loaded = () =>
  new Promise((resolve) => {
    let un = null;
    const done = (v) => (un && un(), resolve(v));
    un = player.subscribe((s) => {
      if (s.error) done(false);
      else if (!s.loading && s.tracks.length && (s.duration > 0 || s.playing)) done(true);
    });
    // A copy that hasn't started within 25 s: on to the next one.
    setTimeout(() => done(false), 25e3);
  });

/** The scene's time, found in the book's ebook (when there is one): { g, where } or null. */
async function inEbook(book, want, part) {
  const { ebookFor, ebookByTitle, autoFindEbook, textOfEbook } = await import('./booktext.js');
  const names = [want.title, want.book].filter(Boolean);
  const fits = (eb) => eb && names.some((n) => matches(mainTitle(n), `${eb.title || ''} ${eb.ebookName || ''}`));
  // The ebook of the book asked for — never another book of the same series.
  let eb = [ebookFor(book)].find(fits) || names.map((n) => ebookByTitle(n, want.author)).find(Boolean) || null;
  if (!eb && names.some((n) => matches(mainTitle(n), book.title || ''))) eb = await Promise.race([autoFindEbook(book), new Promise((r) => setTimeout(() => r(null), 40e3))]);
  if (!fits(eb)) return null;
  const bt = await textOfEbook(eb);
  const total = player.totalDuration();
  if (!total || !part.length) return null;
  const { anchorsFor, timeOf, sceneInText, rangeOf } = await import('./scenefind.js');
  const end = part[part.length - 1].end || total;
  const anchors = anchorsFor(bt, part, end, want.title, part[0].start);
  const ci = want.chapterTitle || want.chapter ? pickChapter(part, want) : -1;
  const tok = sceneInText(bt, [...(want.keywords || []), want.quote || ''], rangeOf(anchors, part, ci));
  if (tok == null) return null;
  const g = timeOf(anchors, tok);
  const at = part.findIndex((c) => g >= c.start && g < (c.end || Infinity));
  return { g, where: `${part[at]?.title || 'found'} · from the ebook` };
}

/**
 * Do it. `step(text)` reports progress. Resolves { book, scene, where } or throws
 * an Error whose `want` (when set) is the book to search the sources for.
 */
export async function playScene(said, step = () => {}) {
  step('Working out the book and the scene…');
  const want = await understand(said);
  if (!want?.title) throw new Error(`Couldn't tell which book you meant — try "play when … in <book title>"`);
  step(`Looking for ${want.title}…`);
  // A copy can be gone (removed from TorBox, an old link): then the next one.
  let details = null;
  const copies = await findCopies(want);
  const now = player.getState();
  for (const book of copies) {
    // Already playing this book: just move to the scene, nothing to reopen.
    if (book.uid === now.book?.uid && now.tracks.length && !now.error) {
      details = now.book;
      break;
    }
    step(`Opening ${book.title}…`);
    try {
      details = await getDetails(book, { fast: true });
      if (details?.tracks?.length || details?.resolveTracks) {
        player.playBook(details);
        if (await loaded()) break;
      }
    } catch {}
    details = null;
  }
  if (!details) {
    const e = new Error(copies.length ? `Couldn't open your copy of ${want.title} — showing it in Search` : `${want.title} isn't in your library — showing it in Search`);
    e.want = want;
    throw e;
  }
  // Where: the line heard before (exact), else the scene found in the ebook's words,
  // else the chapter the AI named and how far into it.
  // Just the book, no moment asked for: it plays from where you left off.
  if (want.moment === false || (!want.scene && !(want.keywords || []).filter(Boolean).length && !want.chapter && !want.chapterTitle)) {
    if (!player.getState().playing) player.toggle();
    return { book: details, scene: details.title, where: 'from where you left off' };
  }
  let g = null;
  let where = '';
  const chapters = volumeOf(player.chapters(), details, want);
  step('Finding the scene in the book…');
  const hit = await inEbook(details, want, chapters).catch(() => null);
  if (hit) ({ g, where } = hit);
  if (g == null) {
    g = findHeard(details.uid, want.quote, chapters);
    if (g != null) where = 'where you heard it';
  }
  if (g == null) {
    const ci = pickChapter(chapters, want);
    if (ci >= 0) {
      const c = chapters[ci];
      const len = Math.max(0, (c.end || c.start) - c.start);
      const at = Math.min(0.95, Math.max(0, Number(want.at) || 0));
      g = c.start + at * len;
      where = `${c.title || `Part ${ci + 1}`} · a guess (no ebook)`;
    }
  }
  if (g != null) player.playAt(g - LEAD);
  else if (!player.getState().playing) player.toggle();
  return { book: details, scene: want.scene || '', where };
}
