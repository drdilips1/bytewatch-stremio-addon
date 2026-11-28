import { describe, it, expect } from 'vitest';
import { ownDescription, isStandIn } from '../src/lib/describe.js';

describe("a cloud copy's stand-in description", () => {
  it('is recognised', () => {
    expect(isStandIn('1 audio file in your TorBox torrents.')).toBe(true);
    expect(isStandIn('3 ebook files in your TorBox web downloads.')).toBe(true);
    expect(isStandIn('A brief history of humankind.')).toBe(false);
  });
  it("gives way to the found details' description", () => {
    expect(ownDescription({ description: '1 audio file in your TorBox torrents.' }, { description: 'How Homo sapiens came to rule.' })).toBe('How Homo sapiens came to rule.');
  });
  it('is nothing when nothing better is known (Goodreads fills in)', () => {
    expect(ownDescription({ description: '1 audio file in your TorBox torrents.' }, null)).toBe('');
  });
  it("keeps the book's own real description", () => {
    expect(ownDescription({ description: 'Sapiens tells the story.' }, { description: 'Other.' })).toBe('Sapiens tells the story.');
  });
});

import { tidyDescription } from '../src/lib/describe.js';
describe("a description's opening shouting", () => {
  it('is removed, with the empty lines', () => {
    expect(tidyDescription('OVER TEN MILLION COPIES SOLD\n\n#1 INTERNATIONAL BESTSELLER\n\nWhat are the most valuable things?\n\nAcclaimed psychologist…')).toBe('What are the most valuable things?\nAcclaimed psychologist…');
  });
  it('leaves a normal description alone', () => {
    expect(tidyDescription('Harry Potter has no idea how famous he is.')).toBe('Harry Potter has no idea how famous he is.');
  });
  it('keeps an all-caps description rather than emptying it', () => {
    expect(tidyDescription('A NOVEL')).toBe('A NOVEL');
  });
});

import { sourceLink } from '../src/lib/describe.js';
describe('where "Source: …" links to', () => {
  it("is the book's Audible page when its id is known", () => {
    expect(sourceLink('Audible', { asin: 'B0F1', title: 'X' })).toBe('https://www.audible.com/pd/B0F1');
  });
  it('is a search on that site otherwise', () => {
    expect(sourceLink('Apple Books', { title: 'Sapiens', author: 'Yuval Noah Harari, X' })).toBe('https://books.apple.com/search?term=Sapiens%20Yuval%20Noah%20Harari');
  });
  it('is nothing for an unknown source', () => {
    expect(sourceLink('Somewhere', { title: 'X' })).toBe('');
  });
});
