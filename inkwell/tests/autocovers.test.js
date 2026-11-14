import { describe, it, expect, vi } from 'vitest';

// Apple audiobooks has only a different book; Apple Books has this one; Audible would too.
vi.mock('../src/lib/http.js', async (orig) => ({
  ...(await orig()),
  getJson: async (url) => {
    if (url.includes('media=audiobook')) return { results: [{ collectionName: 'A Different Story', artistName: 'Someone Else', artworkUrl100: 'https://x/wrong/100x100bb.jpg' }] };
    if (url.includes('media=ebook')) return { results: [{ trackName: 'The Quiet Harbour', artistName: 'Mara Ellis', artworkUrl100: 'https://x/right/100x100bb.jpg' }] };
    throw new Error('offline');
  },
}));
vi.mock('../src/sources/catalogs.js', () => ({
  audible: { search: async () => [{ title: 'The Quiet Harbour', author: 'Mara Ellis', cover: 'https://x/audible.jpg' }] },
  googleBooks: { search: async () => [] },
  audibleRating: async () => null,
}));
const { firstCover } = await import('../src/lib/meta.js');

describe('firstCover', () => {
  it('takes the first place that has this book, skipping a different book', async () => {
    expect(await firstCover({ uid: 'loc:1', title: 'The Quiet Harbour', author: 'Mara Ellis' })).toBe('https://x/right/600x600bb.jpg');
  });
  it('finds nothing for a book no place has', async () => {
    expect(await firstCover({ uid: 'loc:2', title: 'Zzqx Nowhere Book', author: 'Nobody At All' })).toBe('');
  });
});
