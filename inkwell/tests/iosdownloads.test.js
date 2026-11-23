// iPhone downloads after an update (new folder address) or after parts were deleted in the Files app.
import { describe, it, expect, vi } from 'vitest';
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, isPluginAvailable: () => false, getPlatform: () => 'web' }, registerPlugin: () => ({}) }));
vi.mock('../src/lib/store.js', () => ({ persisted: (k, v) => ({ get: () => v, set: () => {}, subscribe: () => () => {} }), settings: { get: () => ({}) }, summarize: (b) => b }));
vi.mock('../src/lib/meta.js', () => ({ metaNow: () => null }));
const { afterFiles } = await import('../src/lib/downloads.js');

const d = { status: 'done', done: 3, tracks: [1, 2, 3].map((n) => ({ rel: `A/B/00${n}.mp3`, uri: `file:///old/00${n}.mp3`, size: 10 })) };
const now = Object.fromEntries(d.tracks.map((t) => [t.rel, `file:///new/${t.rel}`]));

describe('afterFiles', () => {
  it('after an update: same parts, today’s addresses, still downloaded', () => {
    const r = afterFiles(d, now, new Set());
    expect(r.status).toBe('done');
    expect(r.tracks.map((t) => t.uri)).toEqual(['file:///new/A/B/001.mp3', 'file:///new/A/B/002.mp3', 'file:///new/A/B/003.mp3']);
  });
  it('part 2 deleted in Files: not downloaded any more, Resume starts at part 2', () => {
    const r = afterFiles(d, now, new Set(['A/B/002.mp3']));
    expect(r.status).toBe('error');
    expect(r.done).toBe(1);
    expect(r.tracks).toHaveLength(1);
    expect(r.bytes).toBe(10);
  });
});
