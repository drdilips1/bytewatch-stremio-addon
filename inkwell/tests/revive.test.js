// Cloud copies that went inactive: noticed, brought back, and your place follows them.
import { describe, it, expect } from 'vitest';
import { tbGone, rdGone, moveProgress, toKeepReady } from '../src/lib/revive.js';

const H = 'a'.repeat(40);
describe('revive', () => {
  it('knows a gone TorBox torrent from a working one', () => {
    expect(tbGone(null)).toBe(true);
    expect(tbGone({ download_state: 'inactive' })).toBe(true);
    expect(tbGone({ download_state: 'expired', download_present: false })).toBe(true);
    expect(tbGone({ download_finished: true, download_present: false })).toBe(true);
    expect(tbGone({ active: false, download_present: false })).toBe(true);
    expect(tbGone({ download_state: 'cached', download_finished: true, download_present: true })).toBe(false);
    expect(tbGone({ download_state: 'uploading', active: false, download_present: true })).toBe(false);
  });
  it('knows a dead Real-Debrid torrent', () => {
    expect(rdGone(null)).toBe(true);
    expect(rdGone({ status: 'dead' })).toBe(true);
    expect(rdGone({ status: 'magnet_error' })).toBe(true);
    expect(rdGone({ status: 'downloaded' })).toBe(false);
  });
  it('moves your place to the re-added entry', () => {
    const all = { 'tb:t:1': { percent: 42, book: { uid: 'tb:t:1', title: 'Dune' } }, other: { percent: 3 } };
    const next = moveProgress(all, 'tb:t:1', 'tb:t:9');
    expect(next['tb:t:1']).toBeUndefined();
    expect(next['tb:t:9']).toEqual({ percent: 42, book: { uid: 'tb:t:9', title: 'Dune' } });
    expect(next.other).toEqual({ percent: 3 });
    expect(moveProgress(all, 'missing', 'x')).toBe(all);
  });
  it('keeps ready only books you are partway through, listened lately', () => {
    const now = 100 * 864e5;
    const prog = {
      'tb:t:1': { updatedAt: now - 864e5 },
      'tb:t:2': { updatedAt: now - 864e5, finished: true },
      'tb:t:3': { updatedAt: now - 90 * 864e5 },
      'tb:t:4': { updatedAt: now - 864e5 },
    };
    const entries = [
      { uid: 'tb:t:1', hash: H, gone: true },
      { uid: 'tb:t:2', hash: H, gone: true },
      { uid: 'tb:t:3', hash: H, gone: true },
      { uid: 'tb:t:4', hash: H, gone: false },
      { uid: 'tb:t:5', hash: H, gone: true },
    ];
    expect(toKeepReady(entries, prog, now).map((e) => e.uid)).toEqual(['tb:t:1']);
  });
});
