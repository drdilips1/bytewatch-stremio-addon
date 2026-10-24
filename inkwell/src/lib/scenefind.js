// Finding a scene in the book's own words (its ebook), then the same moment in the audio.
// The AI names a few distinctive words of the scene ("Dumbledore", "House Cup", "points");
// the passage where they gather is the scene. The ebook's chapter headings, matched to the
// audiobook's chapter titles, tie a place in the text to a time in the audio.

const STOP = new Set('the a an and or of to in on at by for with from as is was were be been his her he she they them their it its that this then than but not no so up out into over who what when where which while had has have did do does said says will would could should'.split(' '));
const GENERIC = new Set(['chapter', 'part', 'track', 'disc', 'cd', 'book', 'section', 'volume', 'vol', 'unabridged', 'audiobook', 'mp3', 'm4b']);
const norm = (s) => String(s || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}'\s]/gu, ' ').split(/\s+/).filter(Boolean);

const ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
/** 17 → ['seventeen'], 42 → ['forty', 'two'] (how a heading spells it out). */
function numberWords(n) {
  if (n < 20) return [ONES[n]];
  if (n < 100) return n % 10 ? [TENS[Math.floor(n / 10)], ONES[n % 10]] : [TENS[n / 10]];
  return [String(n)];
}

/** Every position where these words come one after another in the book. */
function phraseAt(keys, words) {
  const out = [];
  if (!words.length) return out;
  for (let i = 0; i + words.length <= keys.length; i++) {
    let ok = true;
    for (let k = 0; k < words.length && ok; k++) ok = keys[i + k] === words[k] || keys[i + k].replace(/-/g, '') === words[k];
    if (ok) out.push(i);
  }
  return out;
}

/** How the ebook might spell a chapter's heading: its own words, or "chapter 17" / "chapter seventeen". */
function headingVariants(title, bookTitle) {
  // "Harry Potter and the Philosopher's Stone - 04 - The Man with Two Faces": the part that
  // isn't the book's name or a number is the chapter's own title.
  const bookWords = new Set(norm(bookTitle));
  const parts = String(title).split(/\s+[-–—:|]\s+|_/).map((p) => norm(p).filter((w) => !GENERIC.has(w) && !/^\d+$/.test(w)));
  const own = parts.filter((w) => w.length >= 2 && w.filter((x) => !bookWords.has(x)).length >= Math.ceil(w.length / 2)).pop();
  const out = [];
  if (own) out.push(own);
  const n = (String(title).match(/(\d+)(?!.*\d)/) || [])[1];
  if (n && +n < 200) out.push(['chapter', String(+n)], ['chapter', ...numberWords(+n)]);
  return out;
}

/**
 * Places in the text tied to times in the audio: [{ tok, g }], in order. Contents pages list
 * every heading close together — those are skipped (a heading counts only when the next
 * chapter's heading comes well after it).
 */
export function anchorsFor(bt, chapters, total, bookTitle) {
  const keys = bt.keys;
  const occ = chapters.map((c) => [...new Set(headingVariants(c.title || '', bookTitle).flatMap((v) => phraseAt(keys, v)))].sort((a, b) => a - b));
  const anchors = [{ tok: 0, g: 0 }];
  let pos = 0;
  for (let i = 0; i < chapters.length; i++) {
    const next = occ.slice(i + 1).find((o) => o.length);
    const cands = occ[i].filter((t) => t > pos);
    let pick = null;
    if (!next) pick = cands[cands.length - 1] ?? null;
    else
      for (const t of cands) {
        const after = next.find((x) => x > t);
        if (after == null || after - t > 300) {
          pick = t;
          break;
        }
      }
    if (pick != null && chapters[i].start > anchors[anchors.length - 1].g) {
      anchors.push({ tok: pick, g: chapters[i].start });
      pos = pick;
    }
  }
  anchors.push({ tok: keys.length, g: total });
  return anchors;
}

/** The audio time of a place in the text (between the nearest anchors, in proportion). */
export function timeOf(anchors, tok) {
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1];
    const b = anchors[i];
    if (tok <= b.tok) return a.g + ((tok - a.tok) / Math.max(1, b.tok - a.tok)) * (b.g - a.g);
  }
  return anchors[anchors.length - 1].g;
}

/**
 * Where the scene starts in the text (a word position), from its distinctive words — the
 * 300-word stretch where most of them gather (rare words count more). `range` [from, to]
 * (the chapter the AI named, when known) is preferred. null when the words aren't there.
 */
export function sceneInText(bt, keywords, range = null) {
  const keys = bt.keys;
  const want = [...new Set((keywords || []).flatMap((k) => norm(k)).filter((w) => w.length > 2 && !STOP.has(w)))];
  if (want.length < 2) return null;
  const count = new Map(want.map((w) => [w, 0]));
  for (const k of keys) if (count.has(k)) count.set(k, count.get(k) + 1);
  const weight = new Map([...count].filter(([, c]) => c > 0).map(([w, c]) => [w, 1 / Math.log(2 + c)]));
  if (weight.size < 2) return null;
  const W = 300;
  const inWin = new Map();
  let score = 0;
  let distinct = 0;
  let best = null;
  const addTok = (w, d) => {
    if (!weight.has(w)) return;
    const n = (inWin.get(w) || 0) + d;
    inWin.set(w, n);
    if (d > 0 && n === 1) (score += weight.get(w)), distinct++;
    if (d < 0 && n === 0) (score -= weight.get(w)), distinct--;
  };
  for (let i = 0; i < keys.length; i++) {
    addTok(keys[i], 1);
    if (i >= W) addTok(keys[i - W], -1);
    const start = Math.max(0, i - W + 1);
    const bonus = range && start >= range[0] && start < range[1] ? 1.25 : 1;
    const s = score * bonus;
    if (distinct >= 2 && (!best || s > best.s + 1e-9)) best = { s, start, distinct };
  }
  if (!best || best.distinct < Math.min(2, weight.size)) return null;
  // The scene starts at the first of its words in that stretch.
  for (let i = best.start; i < Math.min(keys.length, best.start + W); i++) if (weight.has(keys[i])) return i;
  return best.start;
}

/** The chapter the AI named, as a stretch of the text (between its anchor and the next). */
export function rangeOf(anchors, chapters, ci) {
  if (ci < 0 || !chapters[ci]) return null;
  const a = anchors.find((x) => x.g === chapters[ci].start);
  if (!a) return null;
  const b = anchors.find((x) => x.tok > a.tok);
  return [a.tok, b ? b.tok : Infinity];
}
