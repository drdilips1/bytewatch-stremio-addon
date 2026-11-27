// The player's progress bar as the whole Book, the current Chapter or the current File (28 Nov,
// after Kelp's Book / Chapter switch). It used to show only the current file — for a book in six
// files the bar was a sixth of the book. Pure: the player passes where it is.

/** Which views make sense: Book always; Chapter with real chapters; File with more than one file. */
export function barModes({ chapters = [], files = 1 } = {}) {
  // A book without chapters of its own gets one "chapter" per file: then Chapter and File would be
  // the same bar, so only File is offered.
  const ownChapters = chapters.length > 1 && chapters.length !== files;
  return ['book', ...(ownChapters ? ['chapter'] : []), ...(files > 1 ? ['file'] : [])];
}

/** The view to show: the one you chose when it makes sense here, else the whole book. */
export const pickMode = (want, modes) => (modes.includes(want) ? want : modes[0]);

/**
 * The bar for a view: { pos, max, base } — `pos` and `max` in seconds along the bar, `base` the
 * book time where the bar starts (null for File: positions are inside the current file).
 * t / dur: the place in the current file and its length; g / total: in the whole book.
 */
export function barView(mode, { t = 0, dur = 0, g = 0, total = 0, chapters = [] } = {}) {
  if (mode === 'chapter') {
    const c = chapters.find((x) => g >= x.start && g < (x.end || Infinity)) || chapters[chapters.length - 1];
    if (c) {
      const end = c.end > c.start ? c.end : total || c.start + 1;
      return { pos: Math.max(0, g - c.start), max: Math.max(1, end - c.start), base: c.start };
    }
  }
  if (mode === 'book' && total > 0) return { pos: Math.min(g, total), max: total, base: 0 };
  return { pos: t, max: dur || 1, base: null };
}
