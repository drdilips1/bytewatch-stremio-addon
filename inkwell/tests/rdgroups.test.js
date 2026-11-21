// Real-Debrid Downloads as books: what another phone (the iPhone) sees of books sent from Mobilism.
import { describe, it, expect } from 'vitest';
import { bookKey, groupDownloads } from '../src/lib/rdgroups.js';

describe('bookKey', () => {
  it('puts the parts of one book together', () => {
    expect(bookKey('Atomic Habits 01.mp3')).toBe(bookKey('Atomic Habits 02.mp3'));
    expect(bookKey('01 - Atomic Habits.mp3')).toBe(bookKey('Atomic Habits 12.mp3'));
    expect(bookKey('Atomic_Habits_05 of 12.mp3')).toBe(bookKey('Atomic Habits 01.mp3'));
  });

  it('keeps numbers that are the title', () => {
    expect(bookKey('1984.m4b')).toContain('1984');
    expect(bookKey('Catch-22 01.mp3')).toContain('22');
  });

  it('keeps different books apart', () => {
    expect(bookKey('Dune 01.mp3')).not.toBe(bookKey('Dune Messiah 01.mp3'));
  });
});

describe('groupDownloads', () => {
  const list = [
    { filename: 'Dune 02.mp3', filesize: 2, link: 'https://rg.to/b', generated: '2026-11-19T10:00:00Z' },
    { filename: 'Dune 01.mp3', filesize: 1, link: 'https://rg.to/a', generated: '2026-11-19T09:00:00Z' },
    { filename: 'Sapiens.epub', filesize: 3, link: 'https://rg.to/c', generated: '2026-11-18T09:00:00Z' },
    { filename: 'Movie.mkv', filesize: 9, link: 'https://rg.to/d', generated: '2026-11-20T09:00:00Z' },
    { filename: 'Dune 01.mp3', filesize: 1, link: 'https://rg.to/a', generated: '2026-11-19T11:00:00Z' },
  ];

  it('one book per title, audio and ebooks only, newest first, no repeats', () => {
    const g = groupDownloads(list);
    expect(g.map((x) => x.files.length)).toEqual([2, 1]);
    expect(g[0].title).toBe('Dune');
    expect(g[1].files[0].name).toBe('Sapiens.epub');
  });

  it('leaves out links this phone already keeps as a book', () => {
    expect(groupDownloads(list, new Set(['https://rg.to/a', 'https://rg.to/b'])).map((x) => x.title)).toEqual(['Sapiens']);
  });
});
