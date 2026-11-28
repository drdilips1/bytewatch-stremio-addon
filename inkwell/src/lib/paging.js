// Ebook pages like a book (Text settings → Layout: Pages). The text is laid out in columns one
// screen wide; turning a page moves along by one screen. Pure arithmetic here (tested); the reader
// measures and scrolls.

/** Columns per page: two side by side on a tablet or a phone held sideways, else one. */
export const columnsFor = (width) => (width >= 900 ? 2 : 1);

/**
 * The column layout for a page `width` wide with `margin` on each side:
 * { colW, gap, articleW } — articleW is the text block (width minus the outer margins),
 * and one page is exactly `width` along.
 */
export function pageLayout(width, margin) {
  const cols = columnsFor(width);
  const gap = margin * 2;
  const articleW = Math.max(100, width - gap);
  const colW = Math.max(80, (articleW - gap * (cols - 1)) / cols);
  return { cols, colW, gap, articleW };
}

/** How many pages, from how far the text reaches sideways. */
export const pageCount = (scrollWidth, width) => (width > 0 ? Math.max(1, Math.round(scrollWidth / width)) : 1);

/** The page something sits on, from where it starts along the text (x, from the first page's left). */
export const pageOf = (x, width) => (width > 0 ? Math.max(0, Math.floor((x + 2) / width)) : 0);

/** The page after a turn, kept inside the book. */
export const turnTo = (page, dir, count) => Math.min(Math.max(page + dir, 0), Math.max(count - 1, 0));

/** Which way a swipe turns: -1 back, 1 forward, 0 not a swipe (too short, or more up/down). */
export function swipeDir(dx, dy) {
  if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.3) return 0;
  return dx < 0 ? 1 : -1;
}
