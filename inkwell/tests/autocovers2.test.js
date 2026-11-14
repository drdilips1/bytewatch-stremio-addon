import { describe, it, expect, vi } from 'vitest';

// Only Apple audiobooks answers, with the real titles.
vi.mock('../src/lib/http.js', async (orig) => ({
  ...(await orig()),
  getJson: async (url) => {
    if (!url.includes('media=audiobook')) throw new Error('offline');
    const term = decodeURIComponent(url.match(/term=([^&]*)/)[1].replace(/\+/g, ' ')).toLowerCase();
    if (term.includes('half')) return { results: [{ collectionName: 'Harry Potter and the Half-Blood Prince', artistName: 'J.K. Rowling', artworkUrl100: 'https://x/hbp/100x100bb.jpg' }] };
    if (term.includes('steve')) return { results: [{ collectionName: 'Steve Jobs', artistName: 'Walter Isaacson', artworkUrl100: 'https://x/jobs/100x100bb.jpg' }] };
    return { results: [] };
  },
}));
vi.mock('../src/sources/catalogs.js', () => ({ audible: { search: async () => [] }, googleBooks: { search: async () => [] }, audibleRating: async () => null }));
const { firstCover } = await import('../src/lib/meta.js');

describe('firstCover with messy names', () => {
  it('a shortened title with the series as the author', async () => {
    expect(await firstCover({ uid: 'loc:a', title: 'Half blood', author: 'Harry Potter' })).toBe('https://x/hbp/600x600bb.jpg');
  });
  it('an author spelled a little differently', async () => {
    expect(await firstCover({ uid: 'loc:b', title: 'Steve jobs', author: 'Walter issacson' })).toBe('https://x/jobs/600x600bb.jpg');
  });
});
