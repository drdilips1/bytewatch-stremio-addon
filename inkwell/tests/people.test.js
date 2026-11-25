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


describe('mentionsBook', () => {
  it('tells the right Robert Greene by his books', async () => {
    const { mentionsBook } = await import('../src/lib/people.js');
    const mine = ['The 48 Laws of Power', 'Mastery: The Path to Excellence'];
    expect(mentionsBook('Robert Greene is an American author known for his books on strategy, power and seduction, including The 48 Laws of Power…', mine)).toBe(true);
    expect(mentionsBook('Robert Greene (1558–1592) was an English author popular in his day, now best known for a posthumous pamphlet…', mine)).toBe(false);
    expect(mentionsBook('anything', [])).toBe(false);
    expect(mentionsBook('He wrote It.', ['It'])).toBe(false); // too short to tell
  });
});
