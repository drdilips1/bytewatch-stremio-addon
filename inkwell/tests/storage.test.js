// Storage: unpacked books that nothing plays from any more can be found and cleared.
import { describe, it, expect } from 'vitest';
import { fmtSize, unpackedRows, leftoverBytes } from '../src/lib/storage.js';

describe('storage', () => {
  it('sizes read like the phone shows them', () => {
    expect(fmtSize(500 * 1024)).toBe('500 KB');
    expect(fmtSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(fmtSize(420 * 1024 * 1024)).toBe('420 MB');
    expect(fmtSize(3.73 * 1024 ** 3)).toBe('3.7 GB');
  });
  it('an unpacked folder a download plays from is a book; one nothing plays from is a leftover', () => {
    const base = '/storage/emulated/0/Android/data/app.audiohub.player/files/Unpacked';
    const folders = [
      { name: 'Dune', path: `${base}/Dune`, size: 400e6 },
      { name: 'Circe', path: `${base}/Circe`, size: 300e6 },
      { name: 'Half done', path: `${base}/Half done`, size: 900e6 },
    ];
    const downloads = {
      'mob:1': { folder: `${base}/Dune`, book: { title: 'Dune' }, tracks: [] },
      // Known only by its files (file:// addresses, encoded).
      'mob:2': { book: { title: 'Circe (Unabridged)' }, tracks: [{ uri: `file://${base}/Circe/01%20Part.mp3` }] },
    };
    const rows = unpackedRows(folders, downloads);
    expect(rows.map((r) => [r.name, r.leftover, r.uid])).toEqual([
      ['Half done', true, ''],
      ['Dune', false, 'mob:1'],
      ['Circe', false, 'mob:2'],
    ]);
    expect(rows[2].title).toBe('Circe (Unabridged)');
    expect(leftoverBytes(rows)).toBe(900e6);
  });
});
