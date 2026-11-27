// A chapter's name as a person would say it, for the player's chapter button (28 Nov: "if there is
// a name of the chapter, show it"). Names taken from file names repeated the book's title and the
// file type ("The Happiness Advantage-Part01.mp3"), and track numbers ("03 - The Slug Club").

/** The readable name, or '' when there's no real name (just a number). */
export function chapterName(title, bookTitle = '') {
  let t = String(title || '').trim();
  t = t.replace(/\.(mp3|m4a|m4b|aac|flac|ogg|opus|wav|wma|mp4)$/i, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  // The book's own title in front ("The Happiness Advantage-Part01", "Dune - 03 - The Desert").
  const bt = String(bookTitle || '').split(/\s[-–—]\s|[:(\[]/)[0].trim();
  if (bt.length > 3 && t.toLowerCase().startsWith(bt.toLowerCase())) t = t.slice(bt.length).replace(/^[\s\-–—_.:,]+/, '');
  // A track number in front ("03 - The Slug Club", "Track 3: …"), but not a name that is a number ("1984").
  t = t.replace(/^(track|disc|cd)\s*\d+\s*[-–—.:)]\s*/i, '').replace(/^\d{1,3}\s*[-–—.:)]\s+(?=\D)/, '');
  if (!t || /^(track|chapter|part)?\s*\d+$/i.test(t)) return /^part\s*\d+$/i.test(t) ? t.replace(/^part\s*/i, 'Part ') : '';
  return t;
}
