// The public addons worker: its files point at itself, nothing personal, searches kept and limited.
import { describe, it, expect } from 'vitest';
import worker, { overLimit, searchKey, abbParse, abbAnswered } from '../workers/public-addons.js';
import { readFileSync } from 'node:fs';

const ctx = { waitUntil: () => {} };
const get = (p) => worker.fetch(new Request('https://addons.example.workers.dev' + p), {}, ctx);

describe('public addons worker', () => {
  it('lists the four public addons, each pointing at sources.booksources.workers.dev', async () => {
    const all = await (await get('/addons/all.json')).json();
    expect(all.addons).toEqual(['audiobookbay', 'knaben-audiobooks', 'knaben-ebooks', 'libgen-epub'].map((n) => `https://sources.booksources.workers.dev/addons/${n}.json`));
    for (const link of all.addons) {
      const a = await (await get(new URL(link).pathname)).json();
      expect(a.adapters.source.request.url.startsWith('https://sources.booksources.workers.dev/')).toBe(true);
      expect(a.id.startsWith('public-')).toBe(true);
    }
    expect((await get('/addons/extto.json')).status).toBe(404);
  });
  it('has nothing personal in it', () => {
    const code = readFileSync(new URL('../workers/public-addons.js', import.meta.url), 'utf8');
    expect(code).not.toMatch(/dilip|audiohubapp|drdilip|\/sync\/|env\.[A-Z]/);
  });
  it('one search, whatever its spacing or capitals; 30 a minute per address', () => {
    expect(searchKey('knaben-ebooks', ' Atomic  HABITS ')).toBe(searchKey('knaben-ebooks', 'atomic habits'));
    let refused = 0;
    for (let i = 0; i < 31; i++) if (overLimit('203.0.113.7', 1000)) refused++;
    expect(refused).toBe(1);
    expect(overLimit('203.0.113.7', 61000)).toBe(false);
  });
  it("reads AudiobookBay's search page", () => {
    const html = '<div class="post"><div class="postTitle"><h2><a href="/abss/atomic-habits/">Atomic Habits - James Clear</a></h2></div><p>Language: English Posted: 17 Aug 2024 Format: M4B / Bitrate: 64 Kbps File Size: 153.12 MBs</p></div>';
    const [r] = abbParse(html, 'audiobookbay.lu');
    expect(r).toMatchObject({ title: 'Atomic Habits - James Clear', pageUrl: 'https://audiobookbay.lu/abss/atomic-habits/', format: 'M4B', date: '17 Aug 2024', language: 'English' });
    expect(r.sizeBytes).toBeGreaterThan(150 * 1024 * 1024);
  });
  it("a search with no results is still AudiobookBay answering (not 'down')", () => {
    const empty = '<!DOCTYPE html><html lang="en"><head><title>Search Results for xqzv | AudioBook Bay</title></head><body>' + 'x'.repeat(2000) + '<div id="content"><h2>Sorry, but you are looking for something that isn\'t here.</h2></div></body></html>';
    expect(abbAnswered(200, empty)).toBe(true);
    expect(abbAnswered(200, '<div class="post">…</div>')).toBe(true);
    expect(abbAnswered(526, empty)).toBe(false);
    expect(abbAnswered(200, '<html><title>Just a moment...</title>' + 'x'.repeat(2000) + 'audiobook</html>')).toBe(false);
    expect(abbAnswered(200, 'short')).toBe(false);
  });
});
