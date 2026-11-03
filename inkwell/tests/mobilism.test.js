// Mobilism: a topic counts only when its own breadcrumb ends eBooks » Audiobooks, forum 124.
import { describe, it, expect, vi } from 'vitest';
vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({}), Capacitor: { getPlatform: () => 'web', isPluginAvailable: () => false } }));
const { inAudiobooks } = await import('../src/sources/mobilism.js');

describe('inAudiobooks', () => {
  it('accepts eBooks » Audiobooks (f=124)', () => {
    expect(inAudiobooks([{ text: 'Board index', f: '' }, { text: 'eBooks', f: '106' }, { text: 'Audiobooks', f: '124' }])).toBe(true);
  });
  it('rejects Audiobooks with another forum id', () => {
    expect(inAudiobooks([{ text: 'eBooks', f: '106' }, { text: 'Audiobooks', f: '125' }])).toBe(false);
  });
  it('rejects other forums', () => {
    expect(inAudiobooks([{ text: 'eBooks', f: '106' }, { text: 'Magazines', f: '123' }])).toBe(false);
    expect(inAudiobooks([{ text: 'Audiobooks', f: '124' }])).toBe(false); // not under eBooks
    expect(inAudiobooks([])).toBe(false);
  });
});
