import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/ai.js', () => ({ askAi: vi.fn(), askAiImage: vi.fn(), aiReady: () => false, canSeeImages: () => false, parseJson: JSON.parse }));
vi.mock('../src/lib/http.js', () => ({ getJson: vi.fn(), getText: vi.fn(), qs: () => '' }));
vi.mock('../src/lib/store.js', () => ({ persisted: (k, v) => ({ get: () => v, set: () => {} }), library: { get: () => ({}) }, progress: { get: () => ({}) } }));
vi.mock('../src/lib/downloads.js', () => ({ downloads: { get: () => ({}) } }));
vi.mock('../src/sources/local.js', () => ({ localCfg: { get: () => ({}) } }));
const { booksInList } = await import('../src/lib/findbooks.js');

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
