import { describe, it, expect, vi } from 'vitest';
const store = () => ({ get: () => ({}), set: () => {}, subscribe: () => () => {} });
vi.mock('../src/lib/store.js', () => ({ persisted: () => store(), progress: store(), library: store(), addons: store(), settings: store() }));
vi.mock('../src/lib/epub.js', () => ({ loadCloudEbook: vi.fn(), savedEbooks: store(), isBadEbook: () => false, cloudReaderBook: vi.fn() }));
vi.mock('../src/sources/local.js', () => ({ localCfg: store() }));
const { wordIndex, locate } = await import('../src/lib/booktext.js');
const { quoteAt } = await import('../src/lib/scenefind.js');

const filler = (n) => Array.from({ length: n }, (_, i) => `Filler sentence number ${i} talks about nothing much at all.`);
const page = 'Courage is rare, but justice is rarer still. Marcus Aurelius wrote that the good man does not wait for applause; he simply does the right thing, right now, and moves on to the next task before him.';
const bt = wordIndex(['Chapter One', ...filler(400), page, ...filler(400)]);
const at = bt.keys.indexOf('courage');

describe('a page photo found in the ebook', () => {
  it('word for word', () => {
    expect(quoteAt(bt, page.slice(0, 120))).toBe(at);
  });
  it('with a word misread and a line-end hyphen, by its three-word pieces', () => {
    const read = 'Courage is rare, but jus- tice is rarer still. Marcus Aurelius wrote that the good rnan does not wait for applause; he simply does the right thing';
    const l = locate(bt, read);
    expect(l && Math.abs(l.from - at)).toBeLessThan(3);
  });
});
