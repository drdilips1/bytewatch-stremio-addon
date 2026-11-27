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
vi.mock('../src/sources/debrid.js', () => ({
  fetchStatus: async () => null,
  preferredProvider: () => 'torbox',
  providerName: () => 'TorBox',
  prepareMagnet: async (p, r) => ({ uid: 'tb:t:fresh', source: 'tb', kind: 'audio', title: r.title }),
}));
vi.mock('../src/sources/sourceaddons.js', () => ({
  sourceAddons: () => [{ manifest: { name: 'Knaben' } }],
  // A source has the book, ready (cached) in TorBox.
  searchSources: async (q, cb) => cb('Knaben', [{ title: 'Dune', hash: 'abc', magnet: 'magnet:?xt=urn:btih:abc', cache: { torbox: true }, seeders: 40 }]),
}));
const dls = mem({});
vi.mock('../src/lib/downloads.js', () => ({
  downloads: dls,
  isDownloaded: (uid) => dls.get()[uid]?.status === 'done',
  applyLocal: (d) => ({ ...d, tracks: dls.get()[d.uid].tracks.map((t) => ({ url: t.uri, title: t.title, duration: 3600 })), offline: true }),
}));
vi.mock('../src/sources/local.js', () => ({ localCfg: mem({ books: [] }), localUrl: (u) => u }));
vi.mock('../src/lib/meta.js', () => ({ fixFor: () => null }));
vi.mock('../src/lib/stats.js', () => ({ start: () => {}, stop: () => {}, tick: () => {}, note: () => {} }));
vi.mock('../src/lib/report.js', () => ({ logError: () => {} }));

const gone = { uid: 'tb:t:1', source: 'tb', kind: 'audio', title: 'Project Hail Mary', author: 'Andy Weir' };
const other = { uid: 'rd:2', source: 'rd', kind: 'audio', title: 'Project Hail Mary', author: 'Andy Weir' };
const inactive = { uid: 'tb:t:9', source: 'tb', kind: 'audio', title: 'Dune', author: 'Frank Herbert' };
const downloaded = { uid: 'abs:7', source: 'abs', kind: 'audio', title: 'Circe', author: 'Madeline Miller' };
const getDetails = vi.fn(async (b) => {
  if (b.uid === gone.uid) throw new Error('This item is no longer in your TorBox account');
  // In TorBox, but inactive: its link can't be fetched any more.
  if (b.uid === inactive.uid) return { ...b, tracks: [{ title: 'Dune 01', duration: 3600, resolve: async () => { throw new Error('This torrent is inactive in TorBox'); } }] };
  return { ...b, tracks: [{ url: 'https://x/1.mp3', title: 'Part 1', duration: 3600 }] };
});
// The phone answers "not there" for a deleted file.
globalThis.fetch = async (u) => ({ ok: !/deleted/.test(String(u)), status: /deleted/.test(String(u)) ? 404 : 206 });
vi.mock('../src/sources/index.js', () => ({
  getDetails: (...a) => getDetails(...a),
  findOwned: async (b) => ({ server: [], cloud: b.title === other.title ? [other] : [] }),
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

  it('a download whose files were deleted streams from where it came from (and shows as needing a new download)', async () => {
    const player = await import('../src/lib/player.js');
    dls.set({ [downloaded.uid]: { status: 'done', book: downloaded, tracks: [{ uri: 'file:///Downloads/deleted/01.mp3', title: '01' }] } });
    await player.openAndPlay(downloaded, getDetails);
    await vi.waitFor(() => expect(player.getState().tracks[0]?.url).toBe('https://x/1.mp3'), { timeout: 3000 });
    expect(player.getState().error).toBeFalsy();
    expect(dls.get()[downloaded.uid].status).toBe('error');
  });
  it('a TorBox copy gone inactive plays a copy ready in your sources', async () => {
    const player = await import('../src/lib/player.js');
    await player.openAndPlay(inactive, getDetails);
    await vi.waitFor(() => expect(player.getState().book?.uid).toBe('tb:t:fresh'), { timeout: 8000 });
    expect(player.getState().error).toBeFalsy();
  }, 10000);
});
