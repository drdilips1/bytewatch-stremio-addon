import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/store.js', () => ({ persisted: (k, v) => ({ get: () => v, set: () => {}, subscribe: () => {} }), library: { get: () => ({}) }, progress: { get: () => ({}) } }));
vi.mock('../src/lib/downloads.js', () => ({ downloads: { get: () => ({}) } }));
vi.mock('../src/sources/local.js', () => ({ localCfg: { get: () => ({}) } }));
vi.mock('../src/lib/http.js', () => ({ getJson: vi.fn(), qs: () => '' }));
const { namesIn, hasPerson, voiceSample } = await import('../src/lib/people.js');

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

describe('voiceSample (hear the person on their page)', () => {
  const books = [
    { title: 'Dune', narrator: 'Scott Brick, Euan Morton', sample: 'https://a/dune.mp3' },
    { title: 'Atomic Habits', narrator: 'James Clear', sample: 'https://a/atomic.mp3' },
    { title: 'No Sample', narrator: 'James Clear' },
  ];
  it('a narrator: a book they read', () => {
    expect(voiceSample('Scott Brick', books)).toEqual({ url: 'https://a/dune.mp3', title: 'Dune' });
  });
  it('an author: only a book they read themselves', () => {
    expect(voiceSample('James Clear', books)?.title).toBe('Atomic Habits');
    expect(voiceSample('Frank Herbert', books)).toBe(null);
  });
});

