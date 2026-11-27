import { describe, it, expect } from 'vitest';
import { isFanfic } from '../src/lib/fanfic.js';

describe('isFanfic', () => {
  it('spots fan fiction from the EPUB details or the name', () => {
    expect(isFanfic('www.fanfiction.net')).toBe(true);
    expect(isFanfic('https://archiveofourown.org/works/123')).toBe(true);
    expect(isFanfic('Batman: Under the Red Hood (AO3)')).toBe(true);
    expect(isFanfic('Fanfiction; Batman')).toBe(true);
  });
  it('leaves real books and comics alone', () => {
    expect(isFanfic('DC Comics')).toBe(false);
    expect(isFanfic('Batman - Under the Red Hood (2011)')).toBe(false);
    expect(isFanfic('Penguin Random House')).toBe(false);
    expect(isFanfic('')).toBe(false);
  });
});
