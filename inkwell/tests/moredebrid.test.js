// AllDebrid, Premiumize, Debrid-Link: their answers turned into books, files and links
// (sample answers in each service's documented shape; no network).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const keys = { alldebrid: 'k1', premiumize: 'k2', debridlink: 'k3' };
const answers = [];
vi.mock('../src/lib/store.js', () => ({ debrid: { get: () => keys }, persisted: (k, v) => ({ get: () => v, set: () => {}, subscribe: () => {} }), progress: { get: () => ({}) } }));
vi.mock('../src/lib/http.js', () => ({
  qs: (o) => new URLSearchParams(o).toString(),
  getJson: vi.fn(async (url) => answers.find(([re]) => re.test(url))?.[1] ?? {}),
  sendForm: vi.fn(async (url) => answers.find(([re]) => re.test(url))?.[1] ?? {}),
}));
vi.mock('../src/lib/report.js', () => ({ logError: () => {} }));
const m = await import('../src/sources/moredebrid.js');

beforeEach(() => (answers.length = 0));

describe('AllDebrid', () => {
  it('lists ready magnets with audio as books, and plays each file through an unlocked link', async () => {
    answers.push(
      [/magnet\/status/, { status: 'success', data: { magnets: [
        { id: 7, filename: 'James Clear - Atomic Habits (2018) [MP3]', statusCode: 4, links: [{ link: 'https://ad/2', filename: '02.mp3', size: 2 }, { link: 'https://ad/1', filename: '01.mp3', size: 1 }] },
        { id: 8, filename: 'Some Movie 1080p', statusCode: 4, links: [{ link: 'x', filename: 'movie.mkv' }] },
        { id: 9, filename: 'Still going', statusCode: 1, links: [] },
      ] } }],
      [/link\/unlock/, { status: 'success', data: { link: 'https://direct/file.mp3' } }]
    );
    const books = await m.moreLibrary('alldebrid');
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({ uid: 'ad:7', source: 'ad', title: 'Atomic Habits', author: 'James Clear', format: 'MP3', parts: 2 });
    const d = await m.moreDetails(books[0]);
    expect(d.tracks.map((t) => t.title)).toEqual(['01', '02']);
    expect(await d.tracks[0].resolve()).toBe('https://direct/file.mp3');
  });

  it('a wrong key says so', async () => {
    answers.push([/\/user/, { status: 'error', error: { code: 'AUTH_BAD_APIKEY', message: 'The auth apikey is invalid' } }]);
    await expect(m.verifyMore('alldebrid', 'bad')).rejects.toMatchObject({ status: 401 });
  });
});

describe('Premiumize', () => {
  it('a cached torrent plays at once from directdl', async () => {
    answers.push([/transfer\/directdl/, { status: 'success', content: [{ path: 'Dune/Dune 01.mp3', size: 5, link: 'https://pm/1' }] }]);
    const b = await m.morePrepare('premiumize', 'magnet:?xt=urn:btih:abc', 'abc', 'Dune');
    expect(b.uid).toBe('pm:h-abc');
    const d = await m.moreDetails(b);
    expect(await d.tracks[0].resolve()).toBe('https://pm/1');
  });

  it('not cached: added, and "downloading" for play-when-ready', async () => {
    answers.push([/transfer\/directdl/, { status: 'success', content: [] }], [/transfer\/create/, { status: 'success', id: 'x' }]);
    await expect(m.morePrepare('premiumize', 'magnet:?xt=urn:btih:def', 'def', 'Sapiens')).rejects.toMatchObject({ pending: { provider: 'premiumize', hash: 'def' } });
  });
});

describe('Debrid-Link', () => {
  it('lists finished seedbox torrents; their links play as they are', async () => {
    answers.push([/seedbox\/list/, { success: true, value: [{ id: 'z1', name: 'The Hobbit - J.R.R. Tolkien', downloadPercent: 100, files: [{ name: 'Hobbit.m4b', size: 9, downloadUrl: 'https://dl/h.m4b' }] }], pagination: {} }]);
    const [b] = await m.moreLibrary('debridlink');
    expect(b).toMatchObject({ uid: 'dl:z1', format: 'M4B' });
    expect(await (await m.moreDetails(b)).tracks[0].resolve()).toBe('https://dl/h.m4b');
  });
});
