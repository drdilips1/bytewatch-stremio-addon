import { describe, it, expect, vi } from 'vitest';
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'web', isPluginAvailable: () => false, isNativePlatform: () => false }, registerPlugin: () => ({ addListener: () => {} }) }));
vi.mock('../src/lib/player.js', () => ({ getState: () => ({}), subscribe: () => {} }));
vi.mock('../src/lib/store.js', () => ({ persisted: (k, v) => ({ get: () => v, set: () => {}, subscribe: () => {} }) }));
const m = await import('../src/lib/transcript.js').catch((e) => ({ err: e }));

describe('heard lines', () => {
  it('takes out a line heard twice at the same moment', () => {
    expect(m.err).toBeUndefined();
    const segs = [
      { start: 1, end: 3, text: 'This episode is brought to you by a sponsor.' },
      { start: 1.2, end: 3.1, text: 'This episode is brought to you by a sponsor.' },
      { start: 4, end: 5, text: 'History.' },
      { start: 4.1, end: 5, text: 'history' },
      { start: 90, end: 91, text: 'History.' },
    ];
    expect(m.withoutRepeats(segs).map((s) => s.start)).toEqual([1, 4, 90]);
  });
});
