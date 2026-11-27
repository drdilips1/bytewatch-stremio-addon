// A copy that won't open (gone from your TorBox, a file deleted from the phone, a source that
// answers "not available", a server that's down): look for another copy of the same book before
// showing an error — tapping a book in Library used to stop at a red "Can't play" while your
// other sources had it. Pure: the player and the reader do the looking.

// Things that are one of a kind: a podcast episode, a voice reading, a summary, a pasted link.
const ONE_OFF = new Set(['pod', 'tts', 'sum', 'ss', 'url']);

/** Should we look for another copy after this error? Anything but a one-off or a cancelled open. */
export function shouldTryOtherCopy(book, err) {
  if (!book?.uid || ONE_OFF.has(book.source)) return false;
  const msg = String(err?.message || err || '');
  return !/\babort(ed)?\b|cancel(l)?ed|you started something else/i.test(msg);
}

/** What the player says while it switches ("That copy isn't available — playing your copy in TorBox…"). */
export function switchingLine(book, where) {
  const why = book?.source === 'abs' ? 'Your server isn’t answering' : 'That copy isn’t available';
  return `${why} — playing your copy ${where}…`;
}

/** The calm note on a book page whose own copy can't be reached (not a red error). */
export function unavailableNote(book) {
  if (book?.source === 'abs') return "Your Audiobookshelf isn't answering right now. Listen still works: it plays your copy on the phone, downloaded or in TorBox / Real-Debrid, or one ready in your sources.";
  if (book?.kind === 'text') return "This copy can't be opened right now. Read opens another copy of the book when there is one — or pick one below.";
  return "This copy isn't available right now. Listen plays another copy of the book when you have one or a source has it ready — or pick one below.";
}
