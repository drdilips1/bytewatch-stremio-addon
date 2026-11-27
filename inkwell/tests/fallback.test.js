// A copy that won't open: another copy is looked for (not a red "Can't play").
import { describe, it, expect } from 'vitest';
import { shouldTryOtherCopy, switchingLine, unavailableNote } from '../src/lib/fallback.js';

describe('another copy when one fails', () => {
  it('looks for one whatever the reason the copy failed', () => {
    const tb = { uid: 'tb:t:1', source: 'tb' };
    for (const msg of ['This item is no longer in your TorBox account', 'No audio tracks found for this title', 'Not available', 'HTTP 404', 'Failed to fetch', "Couldn't play this track"])
      expect(shouldTryOtherCopy(tb, new Error(msg))).toBe(true);
    expect(shouldTryOtherCopy({ uid: 'lv:1', source: 'lv' }, 'anything')).toBe(true);
    expect(shouldTryOtherCopy({ uid: 'loc:1', source: 'loc' }, 'file missing')).toBe(true);
  });
  it('not for one-of-a-kind things, or an open you cancelled', () => {
    expect(shouldTryOtherCopy({ uid: 'pod:1', source: 'pod' }, 'x')).toBe(false);
    expect(shouldTryOtherCopy({ uid: 'tts:1', source: 'tts' }, 'x')).toBe(false);
    expect(shouldTryOtherCopy({ uid: 'tb:1', source: 'tb' }, new Error('The operation was aborted'))).toBe(false);
    expect(shouldTryOtherCopy(null, 'x')).toBe(false);
  });
  it('says what it is doing, and the book page stays calm', () => {
    expect(switchingLine({ source: 'tb' }, 'on this phone')).toBe('That copy isn’t available — playing your copy on this phone…');
    expect(switchingLine({ source: 'abs' }, 'in TorBox')).toMatch(/^Your server isn’t answering/);
    expect(unavailableNote({ source: 'tb', kind: 'audio' })).toMatch(/Listen plays another copy/);
    expect(unavailableNote({ source: 'tb', kind: 'text' })).toMatch(/Read opens another copy/);
  });
});
