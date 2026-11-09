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
