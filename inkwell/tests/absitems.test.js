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
  it('a big library: the other pages at once, still in order', async () => {
    const { allPages } = await import('../src/sources/audiobookshelf.js');
    const books = Array.from({ length: 3200 }, (_, i) => i);
    let open = 0, most = 0;
    const got = await allPages(async (page) => {
      open++, (most = Math.max(most, open));
      await new Promise((r) => setTimeout(r, (7 - page) * 3)); // later pages answer first
      open--;
      return { results: books.slice(page * 500, page * 500 + 500), total: 3200 };
    });
    expect(got).toEqual(books);
    expect(most).toBeGreaterThan(1);
  });
  it('no total from the server: page by page until a short one', async () => {
    const { allPages } = await import('../src/sources/audiobookshelf.js');
    const books = Array.from({ length: 1100 }, (_, i) => i);
    const pages = [];
    const got = await allPages(async (page) => (pages.push(page), { results: books.slice(page * 500, page * 500 + 500) }));
    expect(got).toEqual(books);
    expect(pages).toEqual([0, 1, 2]);
  });
});
