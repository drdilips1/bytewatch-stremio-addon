import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/store.js', () => ({ persisted: (k, v) => ({ get: () => v, set: () => {}, subscribe: () => {} }), library: { get: () => ({}) }, progress: { get: () => ({}) } }));
vi.mock('../src/lib/downloads.js', () => ({ downloads: { get: () => ({}) } }));
vi.mock('../src/sources/local.js', () => ({ localCfg: { get: () => ({}) } }));
vi.mock('../src/lib/http.js', () => ({ getJson: vi.fn(), qs: () => '' }));
const { namesIn, hasPerson } = await import('../src/lib/people.js');

describe('people', () => {
  it('splits names and drops "full cast"', () => {
    expect(namesIn('Ana Reyes, Tom Hale & Full Cast')).toEqual(['Ana Reyes', 'Tom Hale']);
  });
  it('matches the same person written differently, not someone else with the surname', () => {
    expect(hasPerson('J.K. Marsh', 'J K Marsh')).toBe(true);
    expect(hasPerson('Ana Reyes, Tom Hale', 'Tom Hale')).toBe(true);
    expect(hasPerson('Lena Marsh', 'Paul Marsh')).toBe(false);
    expect(hasPerson('', 'Ana Reyes')).toBe(false);
  });
});
