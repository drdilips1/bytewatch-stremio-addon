// The progress bar as Book / Chapter / File: positions and seeking.
import { describe, it, expect } from 'vitest';
import { barModes, pickMode, barView } from '../src/lib/barview.js';

const chapters = [{ start: 0, end: 600 }, { start: 600, end: 1500 }, { start: 1500, end: 3000 }];
describe('progress bar views', () => {
  it('offers what makes sense', () => {
    expect(barModes({ chapters, files: 6 })).toEqual(['book', 'chapter', 'file']);
    expect(barModes({ chapters: [], files: 1 })).toEqual(['book']);
    // Chapters that are just the files: Book and File.
    expect(barModes({ chapters, files: 3 })).toEqual(['book', 'file']);
    expect(barModes({ chapters, files: 1 })).toEqual(['book', 'chapter']);
    expect(pickMode('file', ['book', 'chapter'])).toBe('book');
    expect(pickMode('chapter', ['book', 'chapter'])).toBe('chapter');
  });
  it('the whole book, the chapter you are in, or the current file', () => {
    const at = { t: 100, dur: 1000, g: 900, total: 3000, chapters };
    expect(barView('book', at)).toEqual({ pos: 900, max: 3000, base: 0 });
    expect(barView('chapter', at)).toEqual({ pos: 300, max: 900, base: 600 });
    expect(barView('file', at)).toEqual({ pos: 100, max: 1000, base: null });
    // Length of the book not known yet: the file.
    expect(barView('book', { ...at, total: 0 })).toEqual({ pos: 100, max: 1000, base: null });
  });
});
