// LibGen straight from the phone: reading the worker's links and LibGen's download page.
import { it, expect, vi } from 'vitest';
vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({}), Capacitor: { getPlatform: () => 'web', isPluginAvailable: () => false } }));
const { workerFileId, getLinkIn } = await import('../src/lib/libgendirect.js');

it('reads the file id from a LibGen worker link', () => {
  expect(workerFileId('https://libgenbooks.x.workers.dev/download?id=4965493')).toBe('4965493');
  expect(workerFileId('https://example.org/book.epub')).toBe('');
});
it('finds the keyed get.php link on the download page', () => {
  const html = '<a href="/ads.php?md5=ABC">x</a><a href="get.php?md5=0123456789abcdef0123456789abcdef&amp;key=XYZ12">GET</a>';
  expect(getLinkIn(html, 'https://libgen.li/ads.php?md5=0123456789abcdef0123456789abcdef')).toBe('https://libgen.li/get.php?md5=0123456789abcdef0123456789abcdef&key=XYZ12');
  expect(getLinkIn('<a href="get.php?md5=abc">no key</a>', 'https://libgen.li/')).toBe('');
});
