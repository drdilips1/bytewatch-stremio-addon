import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/player.js', () => ({ getState: () => ({ rate: 1 }), chapters: () => [], globalTime: () => 0 }));
vi.mock('../src/lib/ai.js', () => ({ askAi: vi.fn(), parseJson: JSON.parse, aiReady: () => false }));
vi.mock('../src/lib/store.js', () => ({ progress: { get: () => ({}) }, settings: { get: () => ({}) }, bookmarks: { get: () => ({}), set: () => {} }, persisted: () => ({ get: () => ({}), set: () => {} }) }));
vi.mock('../src/lib/downloads.js', () => ({ downloads: { get: () => ({}) } }));
vi.mock('../src/sources/local.js', () => ({ localCfg: { get: () => ({}) } }));
vi.mock('../src/sources/index.js', () => ({ getDetails: vi.fn(), findOwned: vi.fn() }));
vi.mock('../src/lib/transcript.js', () => ({ heardLines: () => [] }));
vi.mock('../src/lib/findorder.js', () => ({ findOrder: () => [], placeOf: () => '' }));
const { isCommand } = await import('../src/lib/voicecmd.js');

describe('quick voice commands', () => {
  it('takes "where am I" and "remember this" as commands, not questions', () => {
    for (const s of ['where am I', 'Where are we?', 'remember this', 'save that for later', 'what chapter is this']) expect(isCommand(s)).toBe(true);
  });
  it('leaves scenes and questions alone', () => {
    for (const s of ['who is the grey clerk', 'why did she leave']) expect(isCommand(s)).toBe(false);
  });
});
