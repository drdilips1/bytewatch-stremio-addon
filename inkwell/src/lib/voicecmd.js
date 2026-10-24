// Voice command: "play when Harry first boards the Hogwarts Express". Your AI service
// works out the book and where the scene is (which chapter, how far in, a line from it);
// the book is found on your phone, in your downloads, books you've played, then your
// Audiobookshelf and TorBox / Real-Debrid; it starts 30 seconds before the scene.
import { askAi, parseJson } from './ai.js';
import { mainTitle, matches } from './match.js';
import { progress } from './store.js';
import { downloads } from './downloads.js';
import { localCfg } from '../sources/local.js';
import { getDetails, findOwned } from '../sources/index.js';
import { heardLines } from './transcript.js';
import * as player from './player.js';

const LEAD = 30; // seconds before the scene
const surname = (a) => String(a || '').split(',')[0].trim().split(/\s+/).pop()?.toLowerCase() || '';
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);

/** What was asked for: { title, author, scene, chapter, chapterTitle, at, quote } (title '' if not a book request). */
async function understand(said) {
  const raw = await askAi(
    `Someone said to their audiobook app: "${said}"
Work out which book they mean and where in it the moment they describe happens.
Return JSON: {"title":"the book's title","author":"","scene":"the moment, in under 12 words","chapter":0,"chapterTitle":"","at":0.0,"quote":""}
- chapter: the chapter number in the printed book (0 if it's in a prologue or you don't know).
- chapterTitle: that chapter's title, if it has one.
- at: how far into that chapter the moment starts, from 0.0 (its start) to 1.0 (its end).
- quote: 6–12 words of the book's own text from the start of that moment, only if you're sure of them, else "".
If they don't name or describe a book you can identify, return {"title":""}.`,
    { json: true }
  );
  return parseJson(raw);
}

/** Your own copies of the book, best first: playing now, phone, downloads, played before, then your server and cloud. */
async function findCopies(want) {
  const t = mainTitle(want.title || '');
  const sn = surname(want.author);
  const same = (b) => b && b.kind !== 'text' && !String(b.uid || '').endsWith('#ebook') && matches(t, `${b.title || ''} ${b.rawName || ''}`) && (!sn || !b.author || String(b.author).toLowerCase().includes(sn));
  const out = [];
  const add = (b) => same(b) && !out.some((x) => x.uid === b.uid) && out.push(b);
  add(player.getState().book);
  for (const b of localCfg.get().books || []) add(b);
  for (const d of Object.values(downloads.get() || {})) if (d?.status === 'done') add(d.book);
  for (const p of Object.values(progress.get() || {}).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))) add(p.book);
  try {
    const owned = await findOwned({ title: want.title, author: want.author || '' });
    for (const b of [...owned.server, ...owned.cloud]) add(b);
  } catch {}
  return out;
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
function findHeard(uid, quote) {
  const q = norm(quote).filter((w) => w.length > 2);
  if (q.length < 4) return null;
  let best = null;
  for (const l of heardLines(uid)) {
    const w = new Set(norm(l.text));
    const hit = q.filter((x) => w.has(x)).length / q.length;
    if (hit >= 0.7 && (!best || hit > best.hit)) best = { hit, g: player.trackOffset(l.track) + l.start };
  }
  return best?.g ?? null;
}

const loaded = () =>
  new Promise((resolve) => {
    let un = null;
    const done = (v) => (un && un(), resolve(v));
    un = player.subscribe((s) => {
      if (s.error) done(false);
      else if (!s.loading && s.tracks.length && (s.duration > 0 || s.playing)) done(true);
    });
    setTimeout(() => done(false), 90e3);
  });

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
  // Where: the line heard before (exact), else the chapter and how far into it.
  let g = findHeard(details.uid, want.quote);
  let where = '';
  const chapters = player.chapters();
  if (g == null) {
    const ci = pickChapter(chapters, want);
    if (ci >= 0) {
      const c = chapters[ci];
      const len = Math.max(0, (c.end || c.start) - c.start);
      const at = Math.min(0.95, Math.max(0, Number(want.at) || 0));
      g = c.start + at * len;
      where = c.title || `Part ${ci + 1}`;
    }
  } else where = 'where you heard it';
  if (g != null) player.playAt(g - LEAD);
  else if (!player.getState().playing) player.toggle();
  return { book: details, scene: want.scene || '', where };
}
