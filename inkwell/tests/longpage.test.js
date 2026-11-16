import { describe, it, expect, vi } from 'vitest';
const askAi = vi.fn();
const getText = vi.fn();
vi.mock('../src/lib/ai.js', () => ({ askAi, askAiImage: vi.fn(), aiReady: () => true, canSeeImages: () => true, parseJson: JSON.parse }));
vi.mock('../src/lib/http.js', () => ({ getJson: vi.fn(), getText, qs: () => '' }));
vi.mock('../src/lib/store.js', () => ({ persisted: (k, v) => ({ get: () => v, set: () => {} }), library: { get: () => ({}) }, progress: { get: () => ({}) } }));
vi.mock('../src/lib/downloads.js', () => ({ downloads: { get: () => ({}) } }));
vi.mock('../src/sources/local.js', () => ({ localCfg: { get: () => ({}) } }));
const { booksInText, textPieces } = await import('../src/lib/findbooks.js');

describe('a long web page of books', () => {
  it('is read whole, in pieces, and every book comes back in order', async () => {
    // 100 entries, each with a long paragraph about it (like a "100 best" list).
    const entries = Array.from({ length: 100 }, (_, i) => `<h2>${i + 1}. Book Number ${i + 1}</h2><p>by Author ${i + 1}. ${'A long description of why this book matters. '.repeat(25)}</p>`);
    getText.mockResolvedValueOnce(`<title>The 100 Best Books</title>${entries.join('')}`);
    askAi.mockImplementation(async (prompt) => {
      const nums = [...prompt.matchAll(/Book Number (\d+)/g)].map((m) => +m[1]);
      return JSON.stringify({ books: [...new Set(nums)].map((n) => ({ title: `Book Number ${n}`, author: `Author ${n}` })) });
    });
    const r = await booksInText('https://example.com/100-best');
    expect(r.parts).toBeGreaterThan(1);
    expect(r.books).toHaveLength(100);
    expect(r.books[0].title).toBe('Book Number 1');
    expect(r.books[99].title).toBe('Book Number 100');
  });
  it('a short text is one piece', () => {
    expect(textPieces('Atomic Habits by James Clear')).toHaveLength(1);
  });
});
