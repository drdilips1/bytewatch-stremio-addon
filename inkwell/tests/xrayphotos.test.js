// X-Ray photos: only the right Wikipedia page (this person; a character page only for characters).
import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/http.js', () => ({ getJson: vi.fn(), qs: () => '' }));
vi.mock('../src/lib/store.js', () => ({ persisted: (k, v) => ({ get: () => v, set: () => {}, subscribe: () => () => {} }) }));
const { pickPage, pickFandom, wikisFor, wikiName, photoFor } = await import('../src/lib/xrayphotos.js');
const http = await import('../src/lib/http.js');

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

describe('fan wiki photos (characters)', () => {
  it('the fan wiki page with this name, not another character or a gallery of something else', () => {
    const pages = [pg('Leto Atreides I', '', 'leto.jpg'), pg('Paul Atreides/Gallery', '', 'gal.jpg'), pg('Paul Atreides', '', 'paul.jpg')];
    // The exact page wins over a gallery listed before it.
    expect(pickFandom(pages, 'Paul Atreides')).toEqual({ url: 'paul.jpg', page: 'Paul Atreides' });
    expect(pickFandom(pages.slice(0, 2), 'Paul Atreides')).toEqual({ url: 'gal.jpg', page: 'Paul Atreides/Gallery' });
    expect(pickFandom([pg('Leto Atreides I', '', 'leto.jpg')], 'Paul Atreides')).toBe(null);
    expect(pickFandom([pg('Paul Atreides', '', null)], 'Paul Atreides')).toBe(null);
    expect(pickFandom([pg('Paul Atreides', '', 'paul.jpg')], 'Paul')).toEqual({ url: 'paul.jpg', page: 'Paul Atreides' });
  });
  it('which wikis: the one the X-Ray named, else a guess from series or title', () => {
    expect(wikiName('https://Dune.fandom.com/wiki/Main')).toBe('dune');
    expect(wikiName('not a wiki!')).toBe('');
    expect(wikisFor({ title: 'Dune: Deluxe Edition' }, '')).toEqual(['dune']);
    expect(wikisFor({ title: 'A Game of Thrones', series: 'A Song of Ice and Fire' }, 'awoiaf')).toEqual(['awoiaf', 'asongoficeandfire']);
  });
  it('a character: the fan wiki first; a real person: Wikipedia only', async () => {
    http.getJson.mockReset();
    http.getJson.mockResolvedValueOnce({ query: { pages: { 1: { index: 1, title: 'Gurney Halleck', thumbnail: { source: 'gurney.jpg' } } } } });
    expect(await photoFor({ name: 'Gurney Halleck', kind: 'fictional' }, { title: 'Dune' }, 'dune')).toMatchObject({ url: 'gurney.jpg', from: 'Fandom' });
    http.getJson.mockReset();
    http.getJson.mockResolvedValueOnce({ query: { pages: { 1: { index: 1, title: 'Winston Churchill', description: 'Prime Minister of the United Kingdom', thumbnail: { source: 'wc.jpg' } } } } });
    expect(await photoFor({ name: 'Winston Churchill', kind: 'real' }, { title: 'The Splendid and the Vile' })).toMatchObject({ url: 'wc.jpg', from: 'Wikipedia' });
    expect(http.getJson).toHaveBeenCalledTimes(1);
  });
  it('a page about the book (or film, game) of the same name is never the character', () => {
    const pages = [pg('Harry Potter (book series)', '', 'boxset.jpg'), pg('Harry Potter (film series)', '', 'film.jpg'), pg('Harry Potter', '', 'harry.jpg')];
    expect(pickFandom(pages, 'Harry Potter')).toEqual({ url: 'harry.jpg', page: 'Harry Potter' });
    expect(pickFandom(pages.slice(0, 2), 'Harry Potter')).toBe(null);
    expect(pickFandom([pg('Gandalf (character)', '', 'g.jpg')], 'Gandalf')).toEqual({ url: 'g.jpg', page: 'Gandalf (character)' });
  });
  it('a page about their mother, family or wand is never their photo', () => {
    const pages = [pg("Hermione Granger's mother", '', 'mum.jpg'), pg('Granger family', '', 'fam.jpg'), pg('Hermione Granger', '', 'hermione.jpg')];
    expect(pickFandom(pages, 'Hermione Granger')).toEqual({ url: 'hermione.jpg', page: 'Hermione Granger' });
    expect(pickFandom(pages.slice(0, 2), 'Hermione Granger')).toBe(null);
    expect(pickFandom([pg("Harry Potter's wand", '', 'w.jpg')], 'Harry Potter')).toBe(null);
    // A fuller name is still them.
    expect(pickFandom([pg('Hermione Jean Granger', '', 'h2.jpg')], 'Hermione Granger')).toEqual({ url: 'h2.jpg', page: 'Hermione Jean Granger' });
  });
});
