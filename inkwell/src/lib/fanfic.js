// Fan fiction: stories written by fans about existing books, comics and films, packaged as
// EPUBs by tools like FanFicFare ("Publisher: www.fanfiction.net"). They turn up in ebook
// searches under the real title ("JUSTICE(1) Batman: Under the Red Hood" by Floop23) and are
// never "the ebook" of the book or comic you asked for.

const FANFIC = /fanfiction\.net|fictionpress|archiveofourown|\bao3\b|wattpad|ficwad|spacebattles|sufficientvelocity|questionablequesting|royalroad|\bfan ?fiction\b|\bfanfic\b/i;

/** True when a name or an EPUB's details (publisher, source, subjects) say it's fan fiction. */
export const isFanfic = (text) => FANFIC.test(String(text || ''));
