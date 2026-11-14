import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/transcript.js', () => ({ heardLines: () => [], bookTextBefore: () => '' }));
vi.mock('../src/lib/player.js', () => ({ getState: () => ({ tracks: [] }), renameBookmark: () => {} }));
vi.mock('../src/lib/ai.js', () => ({ aiReady: () => false, askAi: async () => '' }));
vi.mock('../src/lib/store.js', () => ({ bookmarks: { get: () => ({}) } }));
const { tellingWords } = await import('../src/lib/bookmarkname.js');

describe('tellingWords', () => {
  it('picks the names and repeated words of a moment, not its first words', () => {
    const text = 'And then it was late. Mara walked to the harbour. The lantern was cold. Mara lifted the lantern and looked at the harbour again, where the ferry waited for Mara.';
    const tw = tellingWords(text);
    expect(tw[0]).toBe('Mara');
    expect(tw).toContain('harbour');
    expect(tw).toContain('lantern');
    expect(tw).not.toContain('then');
  });
});
