// Free classics: one list from LibriVox and Gutenberg, each book once; Gutenberg's MP3 folder read.
import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/store.js', () => ({ progress: { get: () => ({}) }, persisted: (k, v) => ({ get: () => v, set: () => {}, subscribe: () => () => {} }) }));
vi.mock('../src/lib/downloads.js', () => ({ downloads: { get: () => ({}) } }));
vi.mock('../src/lib/http.js', () => ({ getJson: vi.fn(), getText: vi.fn(), qs: (o) => new URLSearchParams(o).toString() }));
const { mergeFree, iaQuery } = await import('../src/lib/freeclassics.js');
const { mp3Links, details } = await import('../src/sources/gutenbergaudio.js');
const http = await import('../src/lib/http.js');

describe('free classics', () => {
  it('each book once, LibriVox first, labelled', () => {
    const r = mergeFree([
      ['LibriVox', [{ title: 'Pride and Prejudice', author: 'Jane Austen' }, { title: 'Dracula', author: 'Bram Stoker' }]],
      ['Gutenberg', [{ title: 'Pride and Prejudice', author: 'Jane Austen' }, { title: 'The Raven', author: 'Edgar Allan Poe' }]],
    ]);
    expect(r.map((b) => `${b.title}·${b.freeFrom}`)).toEqual(['Pride and Prejudice·LibriVox', 'Dracula·LibriVox', 'The Raven·Gutenberg']);
  });
  it('filters become an Internet Archive search', () => {
    expect(iaQuery('de', 'mystery')).toBe('collection:librivoxaudio AND language:(German OR deu OR ger) AND subject:(mystery)');
    expect(iaQuery()).toBe('collection:librivoxaudio');
  });
  it('reads the MP3 parts from a Gutenberg folder page, in order', () => {
    const html = '<a href="19500-10.mp3">10</a><a href="19500-02.mp3">2</a><a href="?C=N">sort</a><a href="19500-02.mp3">dup</a><a href="readme.txt">x</a>';
    expect(mp3Links(html, 'https://www.gutenberg.org/files/19500/mp3/')).toEqual(['https://www.gutenberg.org/files/19500/mp3/19500-02.mp3', 'https://www.gutenberg.org/files/19500/mp3/19500-10.mp3']);
  });
  it('a Gutenberg book plays its whole-book M4B when there is one', async () => {
    http.getJson.mockResolvedValueOnce({ id: 1, title: 'Dracula', authors: [{ name: 'Stoker, Bram' }], formats: { 'audio/mp4': 'https://www.gutenberg.org/files/1/m4b/dracula.m4b', 'audio/mpeg': 'https://www.gutenberg.org/files/1/mp3/1-01.mp3' } });
    const b = await details({ uid: 'gba:1' });
    expect(b.tracks.map((t) => t.url)).toEqual(['https://www.gutenberg.org/files/1/m4b/dracula.m4b']);
    expect(b.author).toBe('Bram Stoker');
  });
  it('otherwise every MP3 part in its folder, in order; just the one file if the folder can’t be read', async () => {
    const one = 'https://www.gutenberg.org/files/2/mp3/2-01.mp3';
    http.getJson.mockResolvedValue({ id: 2, title: 'The Raven', authors: [], formats: { 'audio/mpeg': one } });
    http.getText.mockResolvedValueOnce('<a href="2-02.mp3"></a><a href="2-01.mp3"></a>');
    expect((await details({ uid: 'gba:2' })).tracks.map((t) => t.url)).toEqual([one, 'https://www.gutenberg.org/files/2/mp3/2-02.mp3']);
    http.getText.mockRejectedValueOnce(new Error('offline'));
    expect((await details({ uid: 'gba:2' })).tracks.map((t) => t.url)).toEqual([one]);
  });
});
