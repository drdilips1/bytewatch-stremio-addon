// Ebooks kept in Downloads/Audiohub/Ebooks get names a person can find in the file manager.
import { describe, it, expect, vi } from 'vitest';
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'android', isPluginAvailable: () => true, convertFileSrc: (u) => 'https://localhost/_capacitor_content_/' + u }, registerPlugin: () => ({}) }));
const { fileName, folderFor, mimeOf } = await import('../src/lib/sharedfiles.js');

describe('ebooks in the file manager', () => {
  it('named "Title - Author.epub", safe for any phone', () => {
    expect(fileName({ title: 'Sapiens', author: 'Yuval Noah Harari' }, 'EPUB')).toBe('Sapiens - Yuval Noah Harari.epub');
    expect(fileName({ title: 'AC/DC: Live?' }, 'PDF')).toBe('AC DC Live.pdf');
    expect(fileName({}, 'EPUB')).toBe('Book.epub');
  });
  it('ebooks in Audiohub/Ebooks', () => {
    expect(folderFor('EPUB')).toBe('Audiohub/Ebooks');
    expect(folderFor('PDF')).toBe('Audiohub/Ebooks');
    expect(mimeOf('epub')).toBe('application/epub+zip');
  });
});
