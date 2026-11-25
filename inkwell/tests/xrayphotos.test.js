// X-Ray photos: only the right Wikipedia page (this person; a character page only for characters).
import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/http.js', () => ({ getJson: vi.fn(), qs: () => '' }));
vi.mock('../src/lib/store.js', () => ({ persisted: (k, v) => ({ get: () => v, set: () => {}, subscribe: () => () => {} }) }));
const { pickPage } = await import('../src/lib/xrayphotos.js');

const pg = (title, description, img = 'x.jpg') => ({ title, description, thumbnail: img ? { source: img } : undefined });
describe('pickPage', () => {
  it('a character photo only from that character’s page', () => {
    const pages = [pg('Harry Potter (film series)', 'Film series'), pg('Rubeus Hagrid', 'Fictional character in Harry Potter', 'hagrid.jpg')];
    expect(pickPage(pages, 'Rubeus Hagrid')).toEqual({ url: 'hagrid.jpg', page: 'Rubeus Hagrid' });
    expect(pickPage(pages, 'Hagrid')).toEqual({ url: 'hagrid.jpg', page: 'Rubeus Hagrid' });
    expect(pickPage([pg('Robbie Coltrane', 'Scottish actor (1950–2022)')], 'Rubeus Hagrid')).toBe(null);
  });
  it('a real person from their own page, not a character of the same name', () => {
    expect(pickPage([pg('Winston Churchill (character)', 'Fictional character'), pg('Winston Churchill', 'Prime Minister of the United Kingdom', 'wc.jpg')], 'Winston Churchill', 'real')).toEqual({ url: 'wc.jpg', page: 'Winston Churchill' });
  });
  it('no picture, no match', () => {
    expect(pickPage([pg('Mira Ardent', 'Fictional character', '')], 'Mira Ardent')).toBe(null);
    expect(pickPage([pg('John Smith (explorer)', 'English explorer', 'js.jpg')], 'Mira Smith', 'real')).toBe(null);
  });
});
