// Anna's Archive: whatever is typed as the site address becomes the site's address only.
import { it, expect, vi } from 'vitest';
vi.mock('../src/lib/report.js', () => ({ logError: () => {} }));
vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({}), Capacitor: { getPlatform: () => 'web', isPluginAvailable: () => false } }));
const { normBase } = await import('../src/sources/annas.js');

it('adds https:// and keeps only the address', () => {
  expect(normBase('annas-archive.li')).toBe('https://annas-archive.li');
  expect(normBase(' https://annas-archive.li/search?q=x ')).toBe('https://annas-archive.li');
  expect(normBase('ANNAS-ARCHIVE.SE/')).toBe('https://annas-archive.se');
});
it('falls back to the default for nothing or nonsense', () => {
  expect(normBase('')).toBe('https://annas-archive.pk');
  expect(normBase('hello')).toBe('https://annas-archive.pk');
});

const { formatIn } = await import('../src/sources/annas.js');
it('reads the file type from the facts line, not from words elsewhere', () => {
  expect(formatIn('English [en] · EPUB · 1.7MB · 2005 · 📘 Book (non-fiction)')).toBe('EPUB');
  expect(formatIn('English [en] · .pdf · 3.4MB · 2005')).toBe('PDF');
  expect(formatIn('lgli/txt/Taleb - Fooled by Randomness · English [en] · epub · 1.7MB')).toBe('EPUB');
  expect(formatIn('English [en] · MOBI · 1.1MB')).toBe('MOBI');
});

const { slowLinkIn } = await import('../src/sources/annas.js');
it('finds the slow server’s download link once the countdown is over', () => {
  const at = 'https://annas-archive.li/slow_download/abc/0/0';
  expect(slowLinkIn('<p>Please wait 30 seconds</p>', at)).toBe('');
  expect(slowLinkIn('<a href="https://x.partner.net/d/abc/Fooled.epub">📚 Download now</a>', at)).toBe('https://x.partner.net/d/abc/Fooled.epub');
  expect(slowLinkIn('<p>Use: <a href="https://y.example.org/b/123/Fooled.pdf">https://y.example.org/b/123/Fooled.pdf</a></p><a href="/md5/abc">back</a>', at)).toBe('https://y.example.org/b/123/Fooled.pdf');
});
