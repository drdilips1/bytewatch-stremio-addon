import { describe, it, expect } from 'vitest';
import { catchUpFor } from '../src/lib/resume.js';

describe('back a little when you carry on', () => {
  it('5 s after a call, 30 s after hours, nothing after a quick pause or when turned off', () => {
    const now = 1e12;
    expect(catchUpFor({ at: now - 20e3, call: true }, now)).toBe(5);
    expect(catchUpFor({ at: now - 3 * 3600e3, call: false }, now)).toBe(30);
    expect(catchUpFor({ at: now - 3 * 3600e3, call: true }, now)).toBe(30);
    expect(catchUpFor({ at: now - 60e3, call: false }, now)).toBe(0);
    expect(catchUpFor({ at: now - 500, call: true }, now)).toBe(0);
    expect(catchUpFor({ at: now - 20e3, call: true }, now, { resumeRewind: false })).toBe(0);
  });
});
