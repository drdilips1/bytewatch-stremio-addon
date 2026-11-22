// Goodreads shelves through the hidden browser: the feed is found inside the page it saw.
import { describe, it, expect, vi } from 'vitest';
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'web', isPluginAvailable: () => false, isNativePlatform: () => false }, registerPlugin: () => ({}) }));

describe('rssFromPage', () => {
  it('takes the feed out of the page, and nothing from a page without one', async () => {
    const { rssFromPage } = await import('../src/sources/goodreads.js');
    const page = '<html><body><div id="webkit-xml-viewer-source-xml"><rss version="2.0"><channel><item><title>Atomic Habits</title></item></channel></rss></div></body></html>';
    expect(rssFromPage(page)).toBe('<rss version="2.0"><channel><item><title>Atomic Habits</title></item></channel></rss>');
    expect(rssFromPage('<html><title>Sign in</title></html>')).toBe('');
  });
});
