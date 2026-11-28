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
