// Usenet: reading Newznab indexers' answers (JSON and XML) and their addresses.
import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/lib/store.js', () => ({ persisted: (k, v) => ({ get: () => v, set: () => {}, subscribe: () => {} }) }));
vi.mock('../src/lib/http.js', () => ({ getJson: vi.fn(), getText: vi.fn(), qs: (o) => new URLSearchParams(o).toString() }));
const { parseNewznab, apiBase } = await import('../src/sources/usenet.js');

describe('apiBase', () => {
  it('takes the address with or without /api or a slash', () => {
    expect(apiBase('https://api.nzbgeek.info/')).toBe('https://api.nzbgeek.info');
    expect(apiBase(' https://indexer.example/api ')).toBe('https://indexer.example');
  });
});

describe('parseNewznab', () => {
  it('reads a JSON answer (enclosure, size, date, category)', () => {
    const body = { channel: { item: [{ title: 'Die Verwandlung - Franz Kafka (Hörbuch) MP3', link: 'https://ix/get/1', pubDate: 'Mon, 17 Nov 2025 10:00:00 +0000', enclosure: { '@attributes': { url: 'https://ix/nzb/1', length: '123456' } }, attr: [{ '@attributes': { name: 'category', value: '3030' } }] }] } };
    expect(parseNewznab(body)).toEqual([{ title: 'Die Verwandlung - Franz Kafka (Hörbuch) MP3', nzb: 'https://ix/nzb/1', size: 123456, date: Date.parse('Mon, 17 Nov 2025 10:00:00 +0000'), category: '3030' }]);
  });

  it('reads an XML (RSS) answer', () => {
    const xml = `<rss><channel><item><title><![CDATA[Atomic Habits - James Clear M4B]]></title><link>https://ix/get/2</link><pubDate>Tue, 18 Nov 2025 09:00:00 +0000</pubDate><enclosure url="https://ix/nzb/2?a=1&amp;b=2" length="999" type="application/x-nzb"/><newznab:attr name="category" value="3030"/></item></channel></rss>`;
    const [r] = parseNewznab(xml);
    expect(r).toMatchObject({ title: 'Atomic Habits - James Clear M4B', nzb: 'https://ix/nzb/2?a=1&b=2', size: 999, category: '3030' });
  });

  it('nothing found: empty', () => {
    expect(parseNewznab({ channel: {} })).toEqual([]);
    expect(parseNewznab('<rss><channel></channel></rss>')).toEqual([]);
  });
});

describe('cleanName (Easynews file names)', () => {
  it('undoes HTML entities and doubly read UTF-8', async () => {
    const { cleanName } = await import('../src/sources/usenet.js');
    expect(cleanName('Bren&Atilde;&Acirc;&copy; Brown - Daring Greatly')).toBe('Brené Brown - Daring Greatly');
    expect(cleanName('BrenÃ© Brown')).toBe('Brené Brown');
    expect(cleanName('Tom &amp; Jerry')).toBe('Tom & Jerry');
    expect(cleanName('Plain Title')).toBe('Plain Title');
  });
});

describe('Easynews through your relay', () => {
  it('routes only Easynews addresses, and only when a relay is set', async () => {
    const { viaEasynewsRelay } = await import('../src/sources/usenet.js');
    const f = 'https://members.easynews.com/dl/auto/443/abc.m4b/Atomic%20Habits.m4b';
    expect(viaEasynewsRelay(f, '')).toBe(f);
    expect(viaEasynewsRelay(f, 'https://en.example.workers.dev')).toBe(`https://en.example.workers.dev/fetch?url=${encodeURIComponent(f)}`);
    expect(viaEasynewsRelay('https://api.torbox.app/x', 'https://en.example.workers.dev')).toBe('https://api.torbox.app/x');
  });
  it('the relay passes on Easynews and nothing else', async () => {
    const { allowed } = await import('../workers/easynews-relay.js');
    expect(allowed('https://members.easynews.com/2.0/search/solr-search/?gps=x')).toBeTruthy();
    expect(allowed('https://iad-dl-08.easynews.com/news/x.m4b')).toBeTruthy();
    expect(allowed('https://easynews.com.evil.example/x')).toBe(null);
    expect(allowed('http://members.easynews.com/x')).toBe(null);
    expect(allowed('https://example.com/?u=easynews.com')).toBe(null);
  });
});
