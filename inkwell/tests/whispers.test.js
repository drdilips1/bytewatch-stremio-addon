// Whisper Notes: which voice note to give back at a moment of the book.
import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/store.js', () => ({ persisted: (k, v) => ({ get: () => v, set: () => {}, subscribe: () => () => {} }) }));
const { whisperAt } = await import('../src/lib/whispers.js');

describe('whisperAt', () => {
  const list = [{ id: 'a', global: 100 }, { id: 'b', global: 500 }];
  it('offers a note from just before its moment until 20 s after', () => {
    expect(whisperAt(list, 99.5)?.id).toBe('a');
    expect(whisperAt(list, 115)?.id).toBe('a');
    expect(whisperAt(list, 130)).toBe(null);
    expect(whisperAt(list, 505)?.id).toBe('b');
  });
  it('once per listen', () => {
    expect(whisperAt(list, 105, { done: new Set(['a']) })).toBe(null);
  });
});
