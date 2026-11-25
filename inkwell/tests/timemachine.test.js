// Time Machine: one search across heard lines, bookmarks, highlights and saved ideas.
import { describe, it, expect } from 'vitest';
import { searchMoments, snippet } from '../src/lib/timemachine.js';

const src = {
  heard: [{ book: { uid: 'a', title: 'Dune' }, track: 2, at: 5, lines: [{ s: 40, t: 'Fear is the mind-killer, said the Reverend Mother.' }, { s: 90, t: 'The spice must flow.' }] }],
  bookmarks: { a: [{ label: 'Gom jabbar test', note: 'fear litany here', track: 1, time: 10, createdAt: 9 }] },
  books: { a: { uid: 'a', title: 'Dune' } },
  highlights: { b: [{ text: 'Fear cuts deeper than swords.', note: '', book: { uid: 'b', title: 'A Game of Thrones' }, at: 7 }] },
  ideas: [{ text: 'Habits compound like interest.', title: 'Atomic Habits', at: 3 }],
};
describe('searchMoments', () => {
  it('finds a word everywhere, your own notes first', () => {
    const r = searchMoments('fear', src);
    expect(r.map((m) => m.kind)).toEqual(['bookmark', 'highlight', 'heard']);
    expect(r[2]).toMatchObject({ track: 2, time: 40, book: { title: 'Dune' } });
  });
  it('every word must be there, accents and case ignored', () => {
    expect(searchMoments('SPICE flow', src)).toHaveLength(1);
    expect(searchMoments('spice fear', src)).toHaveLength(0);
    expect(searchMoments('habits', src)[0].kind).toBe('idea');
  });
  it('shows the words around the hit', () => {
    expect(snippet('a '.repeat(80) + 'needle in the haystack', ['needle'], 40)).toMatch(/^….*needle/);
  });
});
