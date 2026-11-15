import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/store.js', () => {
  const mk = (v) => {
    const subs = new Set();
    return { get: () => v, set: (n) => ((v = typeof n === 'function' ? n(v) : n), subs.forEach((f) => f(v))), subscribe: (f) => (subs.add(f), () => subs.delete(f)) };
  };
  return { persisted: (k, v) => mk(v), summarize: (b) => b, progress: mk({}) };
});
vi.mock('../src/lib/taste.js', () => ({ rateBook: () => {}, markAlreadyRead: () => {}, myRatings: { get: () => ({}) }, alreadyRead: { get: () => ({}) }, rateKey: () => '' }));
const { readLater, readLaterGone, toggleReadLater, removeReadLater, withoutGone } = await import('../src/lib/readlists.js');

describe('read later', () => {
  it('removing records it, so a synced copy of the list does not bring it back', () => {
    const b = { uid: 'tb:1', title: 'Cosmos', author: 'Carl Sagan' };
    toggleReadLater(b);
    const old = { ...readLater.get() }; // another device's copy, from before the removal
    removeReadLater(b);
    expect(readLater.get()['tb:1']).toBeUndefined();
    expect(withoutGone({ ...old, ...readLater.get() })['tb:1']).toBeUndefined();
  });
  it('adding it again later keeps it', () => {
    const b = { uid: 'tb:1', title: 'Cosmos', author: 'Carl Sagan' };
    toggleReadLater(b);
    expect(readLaterGone.get()['tb:1']).toBeUndefined();
    expect(withoutGone(readLater.get())['tb:1']).toBeTruthy();
  });
  it('removes the other copies of the same book too', () => {
    readLater.set({ 'tb:2': { book: { uid: 'tb:2', title: 'Me Before You', author: 'Jojo Moyes' }, at: 1 }, 'abs:9': { book: { uid: 'abs:9', title: 'Me Before You (Unabridged)', author: 'Jojo Moyes' }, at: 2 } });
    removeReadLater({ uid: 'tb:2', title: 'Me Before You', author: 'Jojo Moyes' });
    expect(Object.keys(readLater.get())).toEqual([]);
  });
});
