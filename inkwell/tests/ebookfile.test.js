// Which results open straight in the reader: a real file link yes, a forum post never.
import { describe, it, expect, vi } from 'vitest';
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'web', isPluginAvailable: () => false, isNativePlatform: () => false }, registerPlugin: () => ({}) }));

describe('directEbookFile', () => {
  it('opens an EPUB link, not a Mobilism post that says EPUB', async () => {
    const { directEbookFile } = await import('../src/lib/epub.js');
    expect(directEbookFile({ title: 'Atomic Habits', format: 'EPUB', link: 'https://bookhunt.example/file?md5=abc&ext=epub' })?.format).toBe('EPUB');
    const post = { title: 'Atomic Habits - James Clear (EPUB)', format: 'EPUB', link: 'https://forum.mobilism.org/viewtopic.php?t=1', downloads: [{ host: 'rapidgator.net', url: 'https://rapidgator.net/file/x' }] };
    expect(directEbookFile(post)).toBe(null);
  });
});
