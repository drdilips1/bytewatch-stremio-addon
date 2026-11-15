import { describe, it, expect, vi } from 'vitest';
const askAiImage = vi.fn();
vi.mock('../src/lib/ai.js', () => ({ askAi: vi.fn(), askAiImage, aiReady: () => true, canSeeImages: () => true, parseJson: JSON.parse }));
vi.mock('../src/lib/http.js', () => ({ getJson: vi.fn(), getText: vi.fn(), qs: () => '' }));
vi.mock('../src/lib/store.js', () => ({ persisted: (k, v) => ({ get: () => v, set: () => {} }), library: { get: () => ({}) }, progress: { get: () => ({}) } }));
vi.mock('../src/lib/downloads.js', () => ({ downloads: { get: () => ({}) } }));
vi.mock('../src/sources/local.js', () => ({ localCfg: { get: () => ({}) } }));
const { booksInImage } = await import('../src/lib/findbooks.js');

describe('a page photo taken as a cover', () => {
  it('comes back as a page, with the words to start from', async () => {
    askAiImage.mockResolvedValueOnce(JSON.stringify({ page: { title: 'The Happiness Hypothesis', author: 'Jonathan Haidt', quote: 'The mind is divided into parts that sometimes conflict, like a rider on the back of an elephant', page: '4' } }));
    const r = await booksInImage('data:image/jpeg;base64,x', 'cover');
    expect(r.books).toEqual([]);
    expect(r.page).toMatchObject({ title: 'The Happiness Hypothesis', page: 4 });
    expect(askAiImage.mock.calls[0][0]).toMatch(/page of text from inside a book/);
  });
  it('a cover stays a cover', async () => {
    askAiImage.mockResolvedValueOnce(JSON.stringify({ books: [{ title: 'The Happiness Hypothesis', author: 'Jonathan Haidt' }] }));
    const r = await booksInImage('data:image/jpeg;base64,x', 'cover');
    expect(r.page).toBe(null);
    expect(r.books[0].title).toBe('The Happiness Hypothesis');
  });
});
