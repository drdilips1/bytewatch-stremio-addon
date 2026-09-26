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
