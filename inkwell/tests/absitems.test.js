// Audiobookshelf: the whole library, page by page (it stopped at 500 — a library of 800 showed 500).
import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/store.js', () => ({ abs: { get: () => ({}) }, persisted: (k, v) => ({ get: () => v, set: () => {}, subscribe: () => () => {} }) }));
vi.mock('../src/lib/http.js', () => ({ getJson: vi.fn(), sendJson: vi.fn(), qs: () => '', cleanUrl: (u) => u }));

describe('allPages', () => {
  it('keeps asking until every book is in', async () => {
    const { allPages } = await import('../src/sources/audiobookshelf.js');
    const books = Array.from({ length: 812 }, (_, i) => i);
    const pages = [];
    const got = await allPages(async (page) => (pages.push(page), { results: books.slice(page * 500, page * 500 + 500), total: 812 }));
    expect(got.length).toBe(812);
    expect(pages).toEqual([0, 1]);
  });
  it('one short page is the end', async () => {
    const { allPages } = await import('../src/sources/audiobookshelf.js');
    const got = await allPages(async () => ({ results: [1, 2, 3] }));
    expect(got).toEqual([1, 2, 3]);
  });
});
