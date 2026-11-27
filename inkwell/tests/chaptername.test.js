// The player's chapter button shows the chapter's real name, tidied.
import { describe, it, expect } from 'vitest';
import { chapterName } from '../src/lib/chaptername.js';

describe('chapter names', () => {
  it('keeps real names, tidied', () => {
    expect(chapterName('The Slug Club')).toBe('The Slug Club');
    expect(chapterName('03 - The Slug Club')).toBe('The Slug Club');
    expect(chapterName('Track 7: Hermione’s Helping Hand')).toBe('Hermione’s Helping Hand');
    expect(chapterName('"Part one. Positive psychology at work..."')).toBe('"Part one. Positive psychology at work..."');
    expect(chapterName('1984')).toBe('');
  });
  it('drops the book title and the file type from file names', () => {
    expect(chapterName('The Happiness Advantage-Part01.mp3', 'The Happiness Advantage - The Seven Principles')).toBe('Part 01');
    expect(chapterName('Dune - 03 - The Desert Planet', 'Dune')).toBe('The Desert Planet');
  });
  it('no name when it is only a number', () => {
    expect(chapterName('Track 03')).toBe('');
    expect(chapterName('12')).toBe('');
    expect(chapterName('')).toBe('');
  });
});
