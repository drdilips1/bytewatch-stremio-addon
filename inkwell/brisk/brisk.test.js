import { describe, it, expect } from 'vitest';
import { rankResults, fitsWords, syncSources, copyFacts, backAfterInterruption, thumb, placeOf } from './logic.js';
import bundle from './audio-sources.json';

describe('Audibrisk search order', () => {
  it('a word anywhere in the title beats a title that only starts like it', () => {
    const list = [
      { uid: 'au:1', title: 'Everything Was Beautiful and Nothing Hurt', author: 'Ben Reeves' },
      { uid: 'au:2', title: 'Every Summer After', author: 'Carley Fortune' },
      { uid: 'au:3', title: 'The Design of Everyday Things', author: 'Don Norman' },
    ];
    expect(rankResults(list, 'everyday')[0].title).toBe('The Design of Everyday Things');
  });
  it('keeps the catalogue order within a group and drops duplicates', () => {
    const list = [
      { uid: 'a', title: 'Dune', author: 'Frank Herbert' },
      { uid: 'b', title: 'Dune Messiah', author: 'Frank Herbert' },
      { uid: 'a', title: 'Dune', author: 'Frank Herbert' },
    ];
    expect(rankResults(list, 'dune').map((b) => b.uid)).toEqual(['a', 'b']);
  });
  it('free books need every word you typed', () => {
    expect(fitsWords({ title: 'Pride and Prejudice', author: 'Jane Austen' }, 'pride austen')).toBe(true);
    expect(fitsWords({ title: 'Prejudice and Pride of Lions', author: 'Someone Else' }, 'pride austen')).toBe(false);
  });
});

describe('Audibrisk built-in sources', () => {
  it('the names people see: AudiobookBay, Knaben AudioBooks and Deep Search (Ink & Echo, renamed)', () => {
    expect(bundle.addons.map((a) => a.name)).toEqual(['AudiobookBay', 'Knaben AudioBooks', 'Deep Search']);
    expect(JSON.stringify(bundle.addons.map((a) => [a.name, a.description]))).not.toMatch(/ink|echo/i);
  });
  it('only the public worker and Deep Search — nothing personal', () => {
    const text = JSON.stringify(bundle.addons);
    expect(text).not.toMatch(/audiohubapp|drdilip|extto|rutracker/i);
    expect(bundle.addons.map((a) => a.id)).toEqual(['public-audiobookbay', 'public-knaben-audiobooks', 'inkandecho-v2-bestsearch-audiobook']);
  });
  it('an existing install swaps the old sources for the new ones by itself', () => {
    const old = ['my-audiobookbay', 'my-knaben-audiobooks', 'extto-audiohub', 'rutracker-english-audiobooks'].map((id) => ({ kind: 'source', url: '', manifest: { id } }));
    const ie = { kind: 'source', url: '', manifest: { id: 'inkandecho-v2-bestsearch-audiobook', version: 'old' } };
    const out = syncSources([...old, ie], bundle);
    expect(out.map((a) => a.manifest.id).sort()).toEqual(['inkandecho-v2-bestsearch-audiobook', 'public-audiobookbay', 'public-knaben-audiobooks']);
    expect(syncSources(out, bundle)).toBe(out); // nothing to do the next time
    // Your own EXTto, added from its link, stays (only the old built-in copy, with no link, goes).
    const mine = { kind: 'source', url: 'https://example.org/addons/extto.json', manifest: { id: 'extto-audiohub' } };
    expect(syncSources([...out, mine], bundle).some((a) => a.manifest.id === 'extto-audiohub')).toBe(true);
  });
});

describe('Audibrisk copies and playback', () => {
  it('a copy box shows instant or seeds, size and format — no site name', () => {
    expect(copyFacts({ cache: { any: true }, sizeBytes: 153e6, format: 'M4B' }).line).toBe('Instant · 153 MB · M4B');
    expect(copyFacts({ seeders: 42, size: 1.2e9, title: 'Book [MP3]' }).line).toBe('42 seeds · 1.2 GB · MP3');
  });
  it('5 seconds back after a call or a notification, once', () => {
    expect(backAfterInterruption(600, 600.4)).toBe(5);
    expect(backAfterInterruption(600, 595)).toBe(0); // the player already went back
    expect(backAfterInterruption(600, 900)).toBe(0); // moved on meanwhile
  });
});

describe('Audibrisk covers', () => {
  it('small covers ask for small pictures', () => {
    expect(thumb('https://m.media-amazon.com/images/I/51abc._SL500_.jpg', 160)).toBe('https://m.media-amazon.com/images/I/51abc._SL160_.jpg');
    expect(thumb('https://m.media-amazon.com/images/I/51abc.jpg', 160)).toBe('https://m.media-amazon.com/images/I/51abc._SL160_.jpg');
    expect(thumb('https://is1-ssl.mzstatic.com/image/thumb/a/b/600x600bb.jpg', 160)).toBe('https://is1-ssl.mzstatic.com/image/thumb/a/b/160x160bb.jpg');
    expect(thumb('https://archive.org/services/img/x', 160)).toBe('https://archive.org/services/img/x');
  });
});

describe('Audibrisk library labels', () => {
  it('says where each book plays from', () => {
    expect(placeOf({ uid: 'tb:t:1', source: 'tb' }).label).toBe('TorBox');
    expect(placeOf({ uid: 'rd:abc', source: 'rd' }).label).toBe('Real-Debrid');
    expect(placeOf({ uid: 'loc:x', source: 'loc' }).label).toBe('Phone');
    expect(placeOf({ uid: 'tb:t:1', source: 'tb' }, true).label).toBe('Saved'); // saved here: plays offline
    expect(placeOf({ uid: 'lv:12' }).label).toBe('Free');
  });
});

describe('Audibrisk public build (Android side)', () => {
  it('empties a method without breaking strings or comments around it', async () => {
    const { emptyMethods, publicJava } = await import('./publicjava.mjs');
    const java = [
      'class A {',
      '    /** Bookshare: get a book */',
      '    public void bookshareGet(PluginCall call) {',
      '        String js = "if (a) { b(); } // not a comment";',
      "        char c = '}';",
      '        c.setRequestProperty("Accept", "*/*"); // Bookshare',
      '    }',
      '    public void keep(PluginCall call) { String u = "https://forum.mobilism.org/x"; }',
      '}',
    ].join('\n');
    const out = publicJava(emptyMethods(java, ['bookshareGet']));
    expect(out).toContain('public void siteBookGet(PluginCall call) {\n        call.reject("Not part of Audibrisk");\n    }');
    expect(out).toContain('public void keep(PluginCall call) { String u = "https://forum.site-a.invalid/x"; }');
    expect(out).not.toMatch(/bookshare|mobilism/i);
  });
});

describe('Audibrisk updates', () => {
  it('compares versions as numbers', async () => {
    const { newer } = await import('./logic.js');
    expect(newer('1.0.12', '1.0.9')).toBe(true);
    expect(newer('1.0.9', '1.0.9')).toBe(false);
    expect(newer('1.0.8', '1.0.10')).toBe(false);
  });
});

describe('Audibrisk free books and Deep Search', () => {
  it('puts two free books inside the top 10, the rest at the end', async () => {
    const { mixFree } = await import('./logic.js');
    const paid = Array.from({ length: 12 }, (_, i) => ({ uid: `p${i}` }));
    const free = [{ uid: 'f0' }, { uid: 'f1' }, { uid: 'f2' }];
    const out = mixFree(paid, free).map((b) => b.uid);
    expect(out.indexOf('f0')).toBe(2);
    expect(out.indexOf('f1')).toBe(6);
    expect(out[out.length - 1]).toBe('f2');
    expect(mixFree(paid, free, { hasDebrid: false })[0].uid).toBe('f0');
    expect(mixFree([{ uid: 'p0' }], free).map((b) => b.uid)).toEqual(['p0', 'f0', 'f1', 'f2']);
  });
  it('Deep Search follows your service', async () => {
    const { deepSearchFor } = await import('./logic.js');
    const deep = bundle.addons.find((a) => a.name === 'Deep Search');
    const rd = deepSearchFor(deep, 'realdebrid').adapters.source.request.url;
    expect(rd).toMatch(/debrid=realdebrid/);
    expect(rd).not.toMatch(/torboxTier/);
    expect(deepSearchFor(deep, 'torbox')).toBe(deep); // already TorBox: unchanged
    const back = deepSearchFor(deepSearchFor(deep, 'realdebrid'), 'alldebrid').adapters.source.request.url;
    expect(back).toMatch(/debrid=torbox/);
    expect(back).toMatch(/torboxTier=standard/);
  });
});

describe('Audibrisk: a copy that will not play', () => {
  it('tries ready copies first, never the ones already tried, four at most', async () => {
    const { rescueOrder } = await import('./logic.js');
    const copies = [{ hash: 'A' }, { hash: 'B', cache: { any: true } }, { hash: 'C' }, { hash: 'D', cache: { any: true } }, { hash: 'E' }, { hash: 'F' }];
    expect(rescueOrder(copies, new Set(['b'])).map((r) => r.hash)).toEqual(['D', 'A', 'C', 'E']);
  });
});

describe('Audibrisk chapters, series and what worked', () => {
  it('knows meaningless file names', async () => {
    const { genericPart } = await import('./logic.js');
    for (const t of ['Track 01', '02', 'Part 3', 'CD1 Track 04', 'The Hobbit 07.mp3', 'Disc 2 - 05']) expect(genericPart(t, 'The Hobbit')).toBe(true);
    for (const t of ['Chapter One: An Unexpected Party', 'Prologue']) expect(genericPart(t, 'The Hobbit')).toBe(false);
  });
  it('names files by their chapters, or marks chapters by time when lengths match', async () => {
    const { applyChapters } = await import('./logic.js');
    const d = { title: 'X', tracks: [{ title: 'Track 01', duration: 600 }, { title: 'Track 02', duration: 600 }] };
    expect(applyChapters(d, [{ title: 'Opening', lengthMs: 600e3 }, { title: 'The End', lengthMs: 600e3 }]).tracks.map((t) => t.title)).toEqual(['Opening', 'The End']);
    const three = [{ title: 'A', lengthMs: 400e3 }, { title: 'B', lengthMs: 400e3 }, { title: 'C', lengthMs: 400e3 }];
    expect(applyChapters(d, three).chaptersMeta.map((c) => [c.title, Math.round(c.start)])).toEqual([['A', 0], ['B', 400], ['C', 800]]);
    const other = [{ title: 'A', lengthMs: 900e3 }, { title: 'B', lengthMs: 900e3 }, { title: 'C', lengthMs: 900e3 }];
    expect(applyChapters(d, other)).toBe(d); // another edition: left alone
    const named = { title: 'X', tracks: [{ title: 'Prologue' }, { title: 'Chapter 1: Start' }] };
    expect(applyChapters(named, [{ title: 'a' }, { title: 'b' }])).toBe(named);
  });
  it('finds the next book of a series', async () => {
    const { seriesOf, nextInSeries } = await import('./logic.js');
    expect(seriesOf('The Expanse #3')).toEqual({ name: 'The Expanse', n: 3 });
    expect(seriesOf('Mistborn, Book 2')).toEqual({ name: 'Mistborn', n: 2 });
    expect(nextInSeries([{ seriesN: 1 }, { seriesN: 4, t: 'd' }, { seriesN: 3.5, t: 'c' }], 3).t).toBe('c');
    expect(nextInSeries([{ seriesN: 1 }], 1)).toBe(null);
  });
  it('copies that played go up, ones that failed go down', async () => {
    const { healthBonus } = await import('./logic.js');
    expect(healthBonus({ ok: 1 })).toBeGreaterThan(0);
    expect(healthBonus({ ok: 2, fail: 1 })).toBeLessThan(0);
    expect(healthBonus({}, { fail: 10 })).toBe(-40);
  });
});

describe('Audibrisk ratings and your own books in search', () => {
  it('shows Audible’s rating as one short line', async () => {
    const { fmtRating } = await import('./logic.js');
    expect(fmtRating({ rating: 4.83, ratings: 120456 })).toBe('★ 4.8 · 120k');
    expect(fmtRating({ rating: 4.5, ratings: 2300000 })).toBe('★ 4.5 · 2.3M');
    expect(fmtRating({ rating: 4, ratings: 12 })).toBe('★ 4.0 · 12');
    expect(fmtRating({})).toBe('');
  });
  it('finds your own books that fit the words you typed', async () => {
    const { libraryMatches } = await import('./logic.js');
    const mine = [{ uid: 'rd:1', title: 'Atomic Habits', author: 'James Clear' }, { uid: 'tb:2', title: 'Dune', author: 'Frank Herbert' }, { uid: 'rd:1', title: 'Atomic Habits' }];
    expect(libraryMatches(mine, 'atomic').map((b) => b.uid)).toEqual(['rd:1']);
    expect(libraryMatches(mine, 'herbert dune').map((b) => b.uid)).toEqual(['tb:2']);
  });
});

describe('Audibrisk library order', () => {
  it('sorts by title, author surname and series', async () => {
    const { sortBooks } = await import('./logic.js');
    const l = [
      { title: 'The Hobbit', author: 'J. R. R. Tolkien' },
      { title: 'Dune', author: 'Frank Herbert', series: 'Dune #1' },
      { title: "Caliban's War", author: 'James S. A. Corey', series: 'The Expanse #2' },
      { title: 'Leviathan Wakes', author: 'James S. A. Corey', series: 'The Expanse #1' },
    ];
    expect(sortBooks(l, 'title').map((b) => b.title)).toEqual(["Caliban's War", 'Dune', 'The Hobbit', 'Leviathan Wakes']);
    expect(sortBooks(l, 'author').map((b) => b.author.split(' ').pop())[0]).toBe('Corey');
    expect(sortBooks(l, 'series').map((b) => b.title)).toEqual(['Dune', 'Leviathan Wakes', "Caliban's War", 'The Hobbit']);
    expect(sortBooks(l, 'recent')).toBe(l);
  });
});

describe('Audibrisk problem report', () => {
  it('fills in version, phone, service names and the book — never a key', async () => {
    const { reportUrl } = await import('./logic.js');
    const u = new URL(reportUrl({ version: '1.0.15', platform: 'Android 14', services: ['TorBox'], book: { title: 'Dune', author: 'Frank Herbert', source: 'tb' }, error: 'HTTP 503 — hoster_unavailable' }));
    expect(u.host).toBe('github.com');
    expect(u.pathname).toBe('/drdilips1/audibrisk/issues/new');
    const body = u.searchParams.get('body');
    expect(body).toContain('Audibrisk: 1.0.15');
    expect(body).toContain('Services: TorBox');
    expect(body).toContain('Book: Dune — Frank Herbert (tb)');
    expect(u.searchParams.get('title')).toBe('Problem: HTTP 503 — hoster_unavailable');
  });
});

describe('Audibrisk listening line and backups', () => {
  it('says how much you listened, quietly', async () => {
    const { listeningLine } = await import('./logic.js');
    expect(listeningLine(12 * 3600 + 900, 3)).toBe('12 h listened this month · 3 books finished');
    expect(listeningLine(25 * 60, 1)).toBe('25 min listened this month · 1 book finished');
    expect(listeningLine(0, 0)).toBe('');
  });
  it('backs up places and choices — never debrid keys — and reads them back', async () => {
    const { makeBackup, readBackup } = await import('./logic.js');
    const saved = { progress: '{"rd:1":{"percent":0.5}}', briskLinks: '{"au:1":{"uid":"rd:1"}}', debrid: '{"torbox":"SECRET"}' };
    const text = makeBackup((k) => saved[k] ?? null, new Date('2026-11-26T00:00:00Z'));
    expect(text).not.toContain('SECRET');
    const back = Object.fromEntries(readBackup(text));
    expect(JSON.parse(back.progress)['rd:1'].percent).toBe(0.5);
    expect(back.debrid).toBeUndefined();
    expect(() => readBackup('{"app":"other"}')).toThrow('Audibrisk backup');
    expect(() => readBackup('not json')).toThrow('Audibrisk backup');
  });
});

describe('Audibrisk keeps your place when the copy changes', () => {
  const same = (a, b) => a.title.toLowerCase() === b.title.toLowerCase();
  it('takes the latest place from an earlier copy of the same book', async () => {
    const { earlierPlace } = await import('./logic.js');
    const all = {
      'rd:old': { percent: 0.4, global: 4000, total: 10000, updatedAt: 100, book: { title: 'Dune' } },
      'rd:older': { percent: 0.2, global: 2000, total: 10000, updatedAt: 50, book: { title: 'Dune' } },
      'tb:t:x': { percent: 0.9, updatedAt: 200, book: { title: 'Atomic Habits' } },
    };
    expect(earlierPlace(all, { title: 'Dune' }, 'rd:new', same)).toEqual({ from: 'rd:old', percent: 0.4, global: 4000, total: 10000 });
  });
  it('keeps the copy’s own place when it is newer, and ignores finished books', async () => {
    const { earlierPlace } = await import('./logic.js');
    const all = { 'rd:new': { percent: 0.5, updatedAt: 300, book: { title: 'Dune' } }, 'rd:old': { percent: 0.4, updatedAt: 100, book: { title: 'Dune' } } };
    expect(earlierPlace(all, { title: 'Dune' }, 'rd:new', same)).toBe(null);
    expect(earlierPlace({ 'rd:old': { percent: 1, finished: true, updatedAt: 1, book: { title: 'Dune' } } }, { title: 'Dune' }, 'rd:new', same)).toBe(null);
  });
});

describe('Audibrisk finish line and coming back', () => {
  it('says when you will likely finish', async () => {
    const { finishText } = await import('./logic.js');
    const mon = new Date('2026-11-23T10:00:00'); // a Monday
    expect(finishText(1, mon)).toBe('Finish tomorrow');
    expect(finishText(3, mon)).toBe('Finish by Thursday');
    expect(finishText(12, mon)).toBe('Finish in about 12 days');
    expect(finishText(0, mon)).toBe('');
  });
  it('welcomes you back after a while, with your last note', async () => {
    const { awayText } = await import('./logic.js');
    const now = Date.parse('2026-11-26T10:00:00');
    expect(awayText({ updatedAt: now - 9 * 864e5, percent: 0.42 }, 'Watch the uncle', now)).toBe('Back after 9 days — you were 42% in · your note: “Watch the uncle”');
    expect(awayText({ updatedAt: now - 21 * 864e5, percent: 0.1 }, '', now)).toBe('Back after 3 weeks — you were 10% in');
    expect(awayText({ updatedAt: now - 2 * 864e5, percent: 0.4 }, '', now)).toBe('');
  });
});

describe('Audibrisk names for books saved under a torrent id', () => {
  it('spots a torrent id in place of a name', async () => {
    const { isCodeName } = await import('./logic.js');
    expect(isCodeName('f02291ff3ffb630e00c9e056513f2a7b11c0d9e4')).toBe(true);
    expect(isCodeName('The Pull of the Stars')).toBe(false);
  });
  it('finds the name the parts share', async () => {
    const { nameFromParts } = await import('./logic.js');
    expect(nameFromParts(['The Searcher 01', 'The Searcher 02', 'The Searcher 03'])).toBe('The Searcher');
    expect(nameFromParts(['01 - The Searcher - Part 1.mp3', '02 - The Searcher - Part 2.mp3'])).toBe('The Searcher');
    expect(nameFromParts(['The Searcher.m4b'])).toBe('The Searcher');
    expect(nameFromParts(['Track 01', 'Track 02'])).toBe('');
    expect(nameFromParts(['Opening Credits', 'Chapter One: Arrival', 'Chapter Two: Home'])).toBe('');
  });
});

describe('Audibrisk part order', () => {
  it('reads book and chapter numbers, Roman or not', async () => {
    const { partKey } = await import('./logic.js');
    expect(partKey('Book I - Chapter 08 - Fog on the Barrow Downs')).toEqual([1, 8]);
    expect(partKey('Book 1 - Chapter 8')).toEqual([1, 8]);
    expect(partKey('Book II - Chapter 01 - Many Meetings')).toEqual([2, 1]);
    expect(partKey('Prologue')).toBe(null);
  });
  it('puts an unevenly named chapter back in its place', async () => {
    const { orderParts } = await import('./logic.js');
    const t = (title) => ({ title });
    const list = [t('Book 1 - Chapter 08 - Fog on the Barrow Downs'), t('Book I - Chapter 01 - A Long Expected Party'), t('Book I - Chapter 02 - The Shadow of the Past'), t('Book I - Chapter 07 - In the House of Tom Bombadil'), t('Book I - Chapter 09 - At the Sign of the Prancing Pony')];
    const out = orderParts(list);
    expect(out.map((x) => x.title.slice(0, 22))).toEqual(['Book I - Chapter 01 - ', 'Book I - Chapter 02 - ', 'Book I - Chapter 07 - ', 'Book 1 - Chapter 08 - ', 'Book I - Chapter 09 - ']);
    expect(out[3].was).toBe(0);
  });
  it('leaves books alone when the names don’t clearly say', async () => {
    const { orderParts } = await import('./logic.js');
    const plain = [{ title: 'Opening' }, { title: 'The Road' }, { title: 'Home' }];
    expect(orderParts(plain)).toBe(plain);
    const dup = [{ title: 'Chapter 1' }, { title: 'Chapter 1' }, { title: 'Chapter 2' }];
    expect(orderParts(dup)).toBe(dup);
  });
});

describe('Audibrisk Home touches', () => {
  it('gives a book without a cover the same colour every time, different from others', async () => {
    const { hueOf } = await import('./logic.js');
    expect(hueOf('Sapiens')).toBe(hueOf('sapiens'));
    expect(hueOf('Sapiens')).not.toBe(hueOf('Dune'));
    expect(hueOf('')).toBeGreaterThanOrEqual(0);
    expect(hueOf('A very long title about something')).toBeLessThan(360);
  });
  it('puts the book in the player first in Continue listening', async () => {
    const { nowFirst } = await import('./logic.js');
    const list = [{ uid: 'a', title: 'Fellowship' }, { uid: 'b', title: 'Sapiens' }, { uid: 'c', title: 'Dune' }];
    expect(nowFirst(list, { uid: 'b', title: 'Sapiens' }).map((b) => b.uid)).toEqual(['b', 'a', 'c']);
    expect(nowFirst(list, { uid: 'a', title: 'Fellowship' })).toBe(list);
    // Another copy of the same book in the player: found by title.
    const same = (x, y) => x.title === y.title;
    expect(nowFirst(list, { uid: 'z', title: 'Dune' }, same).map((b) => b.uid)).toEqual(['c', 'a', 'b']);
    // Not in the list yet: in front.
    expect(nowFirst(list, { uid: 'n', title: 'New' }).map((b) => b.uid)).toEqual(['n', 'a', 'b', 'c']);
    expect(nowFirst(list, null)).toBe(list);
  });
});
