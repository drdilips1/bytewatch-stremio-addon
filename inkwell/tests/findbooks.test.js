import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/ai.js', () => ({ askAi: vi.fn(), askAiImage: vi.fn(), aiReady: () => false, canSeeImages: () => false, parseJson: JSON.parse }));
vi.mock('../src/lib/http.js', () => ({ getJson: vi.fn(), getText: vi.fn(), qs: () => '' }));
vi.mock('../src/lib/store.js', () => ({ persisted: (k, v) => ({ get: () => v, set: () => {} }), library: { get: () => ({}) }, progress: { get: () => ({}) } }));
vi.mock('../src/lib/downloads.js', () => ({ downloads: { get: () => ({}) } }));
vi.mock('../src/sources/local.js', () => ({ localCfg: { get: () => ({}) } }));
const { booksInList, bookForQuote } = await import('../src/lib/findbooks.js');
const http = await import('../src/lib/http.js');

describe('find books in a pasted list', () => {
  it('reads numbered lines with "by" or a dash, drops repeats', () => {
    const got = booksInList('1. The Salt Orchard by Mira Okafor\n2) Lanterns of Vell – Ana Reyes\n• Quiet Engines\n3. The Salt Orchard by Mira Okafor');
    expect(got).toEqual([
      { title: 'The Salt Orchard', author: 'Mira Okafor' },
      { title: 'Lanterns of Vell', author: 'Ana Reyes' },
      { title: 'Quiet Engines', author: '' },
    ]);
  });
});

describe('which book a page is from', () => {
  it('finds it by the words on the page, skipping summaries and study guides', async () => {
    http.getJson.mockResolvedValueOnce({ items: [{ volumeInfo: { title: 'Summary of The Salt Orchard', authors: ['Quick Reads'] } }, { volumeInfo: { title: 'The Salt Orchard', authors: ['Mira Okafor'] } }] });
    expect(await bookForQuote('and the orchard lay white under the salt wind as the boats came in')).toEqual({ title: 'The Salt Orchard', author: 'Mira Okafor' });
  });
  it('null when nothing is found', async () => {
    http.getJson.mockResolvedValue({ items: [] });
    expect(await bookForQuote('a few words that are in no book at all here')).toBe(null);
  });
});
