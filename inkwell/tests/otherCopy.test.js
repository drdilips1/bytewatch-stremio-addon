// Tapping a book whose copy is gone (here: no longer in your TorBox) plays another copy of the
// same book — never a red "Can't play" while you have one. The real player, a pretend engine.
import { describe, it, expect, vi } from 'vitest';

// Just enough of a page for the player to start.
const noop = () => {};
const el = () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop }, setAttribute: noop, appendChild: noop, addEventListener: noop, removeEventListener: noop, remove: noop, dataset: {} });
vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: noop, removeEventListener: noop, createElement: el, querySelector: () => null, querySelectorAll: () => [], body: el(), head: el(), documentElement: el(), hidden: false, title: '' });
vi.stubGlobal('window', globalThis);
globalThis.addEventListener ??= noop;
globalThis.removeEventListener ??= noop;
globalThis.dispatchEvent ??= noop;
globalThis.CustomEvent ??= class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
globalThis.requestAnimationFrame ??= (f) => setTimeout(f, 0);
globalThis.cancelAnimationFrame ??= (t) => clearTimeout(t);
globalThis.localStorage ??= { getItem: () => null, setItem: noop, removeItem: noop };

const mem = (v) => {
  let val = v;
  const subs = new Set();
  return { get: () => val, set: (x) => ((val = typeof x === 'function' ? x(val) : x), subs.forEach((f) => f(val))), patch: (p) => (val = { ...val, ...p }), subscribe: (f) => (subs.add(f), () => subs.delete(f)) };
};
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'web', isNativePlatform: () => false, isPluginAvailable: () => false }, registerPlugin: () => new Proxy({}, { get: () => async () => ({}) }) }));
vi.mock('../src/lib/engine.js', () => ({ createEngine: () => new Proxy({}, { get: (t, k) => (k === 'duration' ? () => 3600 : () => Promise.resolve()) }) }));
vi.mock('../src/lib/store.js', () => ({
  progress: mem({}), bookmarks: mem({}), settings: mem({ skipBack: 15, skipForward: 30, speed: 1 }),
  summarize: (b) => ({ uid: b.uid, title: b.title, author: b.author, source: b.source, kind: b.kind }),
  persisted: (k, v) => mem(v), removeBookmark: () => {}, library: mem({}), useStore: () => ({}),
}));
vi.mock('../src/sources/audiobookshelf.js', () => ({ syncProgress: async () => {}, switchTracks: () => {}, closeSession: async () => {}, serverPlace: async () => null, mirrorPlace: () => {}, connected: () => false }));
vi.mock('../src/sources/debrid.js', () => ({ fetchStatus: async () => null }));
vi.mock('../src/lib/downloads.js', () => ({ applyLocal: (d) => d, isDownloaded: () => false, downloads: mem({}) }));
vi.mock('../src/sources/local.js', () => ({ localCfg: mem({ books: [] }), localUrl: (u) => u }));
vi.mock('../src/lib/meta.js', () => ({ fixFor: () => null }));
vi.mock('../src/lib/stats.js', () => ({ start: () => {}, stop: () => {}, tick: () => {}, note: () => {} }));
vi.mock('../src/lib/report.js', () => ({ logError: () => {} }));

const gone = { uid: 'tb:t:1', source: 'tb', kind: 'audio', title: 'Project Hail Mary', author: 'Andy Weir' };
const other = { uid: 'rd:2', source: 'rd', kind: 'audio', title: 'Project Hail Mary', author: 'Andy Weir' };
const getDetails = vi.fn(async (b) => {
  if (b.uid === gone.uid) throw new Error('This item is no longer in your TorBox account');
  return { ...b, tracks: [{ url: 'https://x/1.mp3', title: 'Part 1', duration: 3600 }] };
});
vi.mock('../src/sources/index.js', () => ({
  getDetails: (...a) => getDetails(...a),
  findOwned: async () => ({ server: [], cloud: [other] }),
  searchSources: async () => {},
  localSrc: { localCfg: { get: () => ({ books: [] }) } },
  cloud: { preferredProvider: () => null, tbConnected: () => false },
}));

describe('a copy that is gone', () => {
  it('plays your other copy of the book instead of an error', async () => {
    const player = await import('../src/lib/player.js');
    await player.openAndPlay(gone, getDetails);
    await vi.waitFor(() => expect(player.getState().book?.uid).toBe(other.uid), { timeout: 3000 });
    expect(player.getState().error).toBeFalsy();
  });
});
