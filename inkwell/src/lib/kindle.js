// Send to Kindle: download the EPUB and hand it to Android's share sheet, where
// the Kindle app ("Send to Kindle") or an email to your @kindle.com address
// picks it up. Amazon accepts EPUB this way.
import { Capacitor, registerPlugin } from '@capacitor/core';

const Web = registerPlugin('InkwellWeb');
const native = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellWeb');

export const canSendToKindle = (book) => !!book?.epubUrl;

export async function sendToKindle(book) {
  const name = `${(book.title || 'Book').slice(0, 80)}${book.author ? ` - ${book.author.split(',')[0]}` : ''}.epub`;
  if (native) return Web.shareFile({ url: book.epubUrl, name, mime: 'application/epub+zip', title: 'Send to Kindle' });
  // Browser: download the EPUB, then upload it at amazon.com/sendtokindle.
  window.open(book.epubUrl, '_blank');
}

const MIME = { EPUB: 'application/epub+zip', PDF: 'application/pdf', MOBI: 'application/x-mobipocket-ebook', AZW3: 'application/vnd.amazon.ebook', AZW: 'application/vnd.amazon.ebook' };

/** Share an ebook file from TorBox / Real-Debrid: Kindle, or any reader app. */
export async function shareEbook(file, book) {
  const url = await file.resolve();
  if (native) return Web.shareFile({ url, name: file.name, mime: MIME[file.format] || 'application/octet-stream', title: `Send "${book.title}" to…` });
  window.open(url, '_blank');
}
