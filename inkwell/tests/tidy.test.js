import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/store.js', () => ({ library: {}, progress: { get: () => ({}) }, useStore: () => ({}), hideFromContinue: () => {}, persisted: () => ({ get: () => ({}), set: () => {} }) }));
vi.mock('../src/lib/downloads.js', () => ({ downloads: { get: () => ({}) }, removeDownload: () => {} }));
vi.mock('../src/lib/meta.js', () => ({ needsCover: (b) => !b.cover, autoCovers: vi.fn(), setFix: vi.fn(), fixFor: () => null, typedCovers: {} }));
vi.mock('../src/components/common.jsx', () => ({ TopBar: () => null, Cover: () => null, toast: () => {} }));
vi.mock('../src/lib/nav.js', () => ({ nav: {} }));
const { tidyFindings } = await import('../src/screens/Tidy.jsx');

const bk = (uid, title, author, source, cover = 'c') => ({ uid, title, author, source, cover });

describe('tidy up', () => {
  it('finds the same book twice from one place, not copies from different places', () => {
    const lib = { a: bk('tb:1', 'The Salt Orchard', 'Mira Okafor', 'tb'), b: bk('tb:2', 'The Salt Orchard (Unabridged)', 'Mira Okafor', 'tb'), c: bk('loc:3', 'The Salt Orchard', 'Mira Okafor', 'loc') };
    const f = tidyFindings(lib, {}, {});
    expect(f.dupes.length).toBe(1);
    expect(f.dupes[0].map((b) => b.uid).sort()).toEqual(['tb:1', 'tb:2']);
  });
  it('finds one author spelled two ways and picks the commonest', () => {
    const lib = { a: bk('1', 'One', 'J.K. Marsh', 'tb'), b: bk('2', 'Two', 'J.K. Marsh', 'tb'), c: bk('3', 'Three', 'J K Marsh', 'loc') };
    const f = tidyFindings(lib, {}, {});
    expect(f.authors[0].best).toBe('J.K. Marsh');
    expect(f.authors[0].books.map((b) => b.uid)).toEqual(['3']);
  });
  it('finds books left alone for months and finished books still downloaded', () => {
    const old = Date.now() - 200 * 24 * 3600e3;
    const prog = { x: { book: bk('x', 'X', 'A', 'tb'), global: 500, total: 9000, updatedAt: old }, y: { book: bk('y', 'Y', 'A', 'loc'), finished: true } };
    const f = tidyFindings({}, prog, { y: { status: 'done', bytes: 3e8 } });
    expect(f.stale.map((s) => s.uid)).toEqual(['x']);
    expect(f.big[0].bytes).toBe(3e8);
  });
});
