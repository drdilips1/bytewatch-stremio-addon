// Ebooks (and comics) kept in the phone's own storage — Downloads/Audiohub/Ebooks and
// Downloads/Audiohub/Comics, next to the audiobooks — instead of inside the app (ported from AudioYam): one copy, seen in
// the Files app, opened by other apps, and still there after reinstalling the app. Android only
// (iPhone keeps them as before).
import { Capacitor, registerPlugin } from '@capacitor/core';

const Dl = registerPlugin('InkwellDownloads');
export const sharedOk = Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('InkwellDownloads');

const MIME = { EPUB: 'application/epub+zip', PDF: 'application/pdf', CBZ: 'application/vnd.comicbook+zip', CBR: 'application/vnd.comicbook-rar' };
export const mimeOf = (format) => MIME[String(format || '').toUpperCase()] || 'application/octet-stream';

/** Comics in Audiohub/Comics, everything else in Audiohub/Ebooks. */
export const folderFor = (format) => (/^CB[ZR]$/i.test(format || '') ? 'Audiohub/Comics' : 'Audiohub/Ebooks');

/** "Sapiens - Yuval Noah Harari.epub": a name a person can find, safe for any phone. */
export function fileName(book = {}, format = 'EPUB') {
  const clean = (s) =>
    String(s || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const title = clean(book.title).slice(0, 90) || 'Book';
  const author = clean(book.author).slice(0, 50);
  const comic = /^CB[ZR]$/i.test(format);
  return `${title}${author && !comic ? ` - ${author}` : ''}.${String(format || 'epub').toLowerCase()}`;
}

/** The address the app's readers fetch a phone file from (its own file server). */
export const fileUrl = (uri) => Capacitor.convertFileSrc(uri).replace(/^https?:\/\/[^/]+/, '');

const CHUNK = 3 * 1024 * 1024; // 3 MB a piece (4 MB as text): never the whole comic at once
const toBase64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};

/**
 * Write a comic or ebook (bytes or a stored Blob) into Downloads/Audiohub/…; resolves its uri.
 * `onProgress(written, total)`.
 */
export async function writeToDownloads(data, { name, folder, mime }, onProgress = () => {}) {
  const total = data.size ?? data.length ?? 0;
  const { uri } = await Dl.writeStart({ name, folder, mime });
  try {
    for (let at = 0, first = true; at < total || first; at += CHUNK, first = false) {
      const part = data.slice(at, Math.min(at + CHUNK, total));
      const u8 = part instanceof Uint8Array ? part : new Uint8Array(await part.arrayBuffer());
      await Dl.writeChunk({ uri, data: toBase64(u8), first });
      onProgress(Math.min(at + CHUNK, total), total);
      if (!total) break;
    }
    await Dl.writeEnd({ uri });
    return uri;
  } catch (e) {
    await Dl.writeEnd({ uri, failed: true }).catch(() => {});
    throw e;
  }
}


/** Delete one of these files (Settings → Storage → Remove). */
export const removeFile = (uri) => Dl.remove({ uri });
