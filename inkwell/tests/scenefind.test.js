import { describe, it, expect } from 'vitest';
import { quoteAt, sceneInText, anchorsFor, timeOf, headingsInText } from '../src/lib/scenefind.js';

const tok = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, ' ').split(/\s+/).filter(Boolean);
const filler = (n, seed = 'river') => Array.from({ length: n }, (_, i) => ['the', 'road', 'went', 'on', seed, 'stone', 'quiet', 'morning', 'light'][i % 9]).join(' ');
const book = (parts) => ({ keys: tok(parts.join(' ')) });

describe('quoteAt', () => {
  it('finds a remembered line word for word', () => {
    const bt = book([filler(400), 'Mara lifted the brass lantern above the flooded stair and waited', filler(400)]);
    const at = quoteAt(bt, 'lifted the brass lantern above the flooded stair');
    expect(bt.keys.slice(at, at + 4)).toEqual(['lifted', 'the', 'brass', 'lantern']);
  });
  it('gives nothing for a line that is not there', () => {
    expect(quoteAt(book([filler(500)]), 'a sentence that never appears in this text at all')).toBe(null);
  });
});

describe('sceneInText', () => {
  it('prefers where a two-word name appears as a phrase', () => {
    // "glass" and "harbour" are scattered early; "Glass Harbour" together comes later.
    const bt = book([filler(300), 'glass', filler(120), 'harbour', filler(600), 'they reached Glass Harbour at dusk and the ferryman counted coins', filler(600)]);
    const at = sceneInText(bt, ['Glass Harbour', 'ferryman', 'coins']);
    expect(bt.keys.slice(at, at + 2)).toEqual(['glass', 'harbour']);
  });
});

describe('anchorsFor', () => {
  it('pairs the ebook\'s chapter headings with "Track" chapters in order', () => {
    // Opening credits, then three chapters of 600 words each, each 10 minutes long.
    const bt = book(['Chapter One', filler(600), 'Chapter Two', filler(600), 'Chapter Three', filler(600)]);
    const chapters = [
      { title: 'Track 01', start: 0, end: 60 },
      { title: 'Track 02', start: 60, end: 660 },
      { title: 'Track 03', start: 660, end: 1260 },
      { title: 'Track 04', start: 1260, end: 1860 },
    ];
    expect(headingsInText(bt).length).toBe(3);
    const anchors = anchorsFor(bt, chapters, 1860, 'Some Book', 0);
    // The start of "Chapter Two" in the text lands at the start of Track 03 in the audio.
    const two = bt.keys.indexOf('two');
    expect(Math.round(timeOf(anchors, two - 1))).toBe(660);
  });
  it('numbered tracks with no credits line up one to one', () => {
    const bt = book(['Chapter 1', filler(500), 'Chapter 2', filler(500), 'Chapter 3', filler(500)]);
    const chapters = [
      { title: 'Part 1', start: 0, end: 500 },
      { title: 'Part 2', start: 500, end: 1000 },
      { title: 'Part 3', start: 1000, end: 1500 },
    ];
    const anchors = anchorsFor(bt, chapters, 1500, 'Some Book', 0);
    expect(Math.round(timeOf(anchors, headingsInText(bt)[2]))).toBe(1000);
  });
  it('starts at the thick of the scene, not its first stray word', () => {
    // "lantern" appears once early in the stretch; the scene itself (lantern, harbour, ferryman) comes later.
    const bt = book([filler(400), 'lantern', filler(150), 'the lantern swung as the ferryman reached the harbour and the ferryman raised the lantern over the harbour', filler(400)]);
    const at = sceneInText(bt, ['lantern', 'ferryman', 'harbour']);
    expect(bt.keys.slice(at, at + 3)).toEqual(['lantern', 'swung', 'as']);
  });
});
