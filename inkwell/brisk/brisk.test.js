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
