// Deleted bookmarks stay deleted when another device (or the cloud copy) still has them (GitHub #9).
import { describe, it, expect } from 'vitest';
import { markKey, mergeGone, mergeBookmarks } from '../src/lib/marks.js';

const a = { createdAt: 1, global: 10, label: 'a' };
const b = { createdAt: 2, global: 20, label: 'b' };

describe('mergeBookmarks', () => {
  it('keeps one of each bookmark from both devices, in book order', () => {
    expect(mergeBookmarks({ tb: [b] }, { tb: [a, b] })).toEqual({ tb: [a, b] });
  });
  it('a bookmark deleted on this phone does not come back from the cloud copy', () => {
    const gone = { [markKey('tb', 1)]: 100 };
    expect(mergeBookmarks({ tb: [b] }, { tb: [a, b] }, gone)).toEqual({ tb: [b] });
  });
  it('a bookmark deleted on the other device goes here too', () => {
    const gone = { [markKey('tb', 2)]: 100 };
    expect(mergeBookmarks({ tb: [a, b] }, { tb: [a] }, gone)).toEqual({ tb: [a] });
  });
});

describe('mergeGone', () => {
  it('keeps the later time of each deletion and forgets ones older than half a year', () => {
    const now = 400 * 24 * 3600e3;
    const old = now - 200 * 24 * 3600e3;
    expect(mergeGone({ x: now - 5, y: old }, { x: now - 1 }, now)).toEqual({ x: now - 1 });
  });
});
