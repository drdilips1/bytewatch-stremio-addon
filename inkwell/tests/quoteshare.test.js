// Quote postcards: the chapter of a shared moment, carried in the link.
import { describe, it, expect, vi } from 'vitest';
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, isPluginAvailable: () => false, getPlatform: () => 'web' }, registerPlugin: () => ({}), CapacitorHttp: {} }));
vi.mock('../src/lib/store.js', () => ({ persisted: (k, v) => ({ get: () => v, set: () => {}, subscribe: () => () => {} }), library: { get: () => ({}) }, progress: { get: () => ({}) } }));
vi.mock('../src/lib/works.js', () => ({ sameWork: () => false, preferred: (l) => l[0] }));

describe('postcards', () => {
  it('the chapter a moment falls in', async () => {
    const { chapterAt } = await import('../src/lib/quoteshare.js');
    const list = [{ title: 'Opening Credits', start: 0 }, { title: 'Chapter 1: The Boy', start: 40 }, { title: 'Chapter 2', start: 900 }];
    expect(chapterAt(list, 500)).toBe('Chapter 1: The Boy');
    expect(chapterAt(list, 900)).toBe('Chapter 2');
    expect(chapterAt([], 5)).toBe('');
  });
  it('the chapter travels in the link', async () => {
    const { quoteLink, parseQuoteLink } = await import('../src/lib/quoteshare.js');
    const q = parseQuoteLink(quoteLink({ kind: 'audio', title: 'Dune', quote: 'Fear is the mind-killer.', note: 'Chills', global: 1200, chapter: 'Chapter 1' }));
    expect(q).toMatchObject({ chapter: 'Chapter 1', note: 'Chills', global: 1200 });
  });
});
